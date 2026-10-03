import { defineStore } from 'pinia'
import type { AuditEvent, BoundaryWindow, ExitCondition, FieldMessage, GateRecord, Permit } from '~/types'
import { auditEvents as seedAudit, fieldMessages as seedMessages, gateRecords as seedGateRecords, permits as seedPermits } from '~/utils/mock'

const STORAGE_KEY = 'yy52-permit-ops-v2'

function now() { return Date.now() }
function timeStr() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export const useOperationsStore = defineStore('operations', () => {
  const permits = ref<Permit[]>(structuredClone(seedPermits))
  const audit = ref<AuditEvent[]>(structuredClone(seedAudit))
  const connection = ref<'在线' | '重连中'>('在线')
  const pendingRetry = ref(0)
  const latestAlert = ref('18:00–20:00 LINE-A2 存在跨班组重叠作业')
  const loaded = ref(false)

  // 门禁记录 / 现场报文 / 设备维护
  const gateRecords = ref<GateRecord[]>(structuredClone(seedGateRecords))
  const fieldMessages = ref<FieldMessage[]>(structuredClone(seedMessages))
  const maintenance = ref<Record<string, string>>({})
  const seq = ref(0)

  // ---- 持久化：看板、隔离页、审计读同一份候选状态，重开后待续项与阻断原因仍在 ----
  function persist() {
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        permits: permits.value, audit: audit.value,
        gateRecords: gateRecords.value, fieldMessages: fieldMessages.value,
        maintenance: maintenance.value, seq: seq.value,
      }))
    }
  }
  function restore() {
    if (!import.meta.client || loaded.value) return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const d = JSON.parse(raw)
      permits.value = d.permits
      audit.value = d.audit
      gateRecords.value = d.gateRecords ?? []
      fieldMessages.value = d.fieldMessages ?? []
      maintenance.value = d.maintenance ?? {}
      seq.value = d.seq ?? 0
    }
    loaded.value = true
  }

  function addAudit(actor: string, action: string, target: string, detail: string) {
    audit.value.unshift({ id: `AE-${Date.now().toString().slice(-5)}`, time: timeStr(), actor, action, target, detail })
    persist()
  }

  // ---- 边界窗口（派生）：先到者独占，后到者候场 ----
  function boundaryWindow(boundary: string): BoundaryWindow {
    const records = gateRecords.value
      .filter((r) => r.boundary === boundary && r.status !== '已释放')
      .sort((a, b) => a.claimedAt - b.claimedAt)
    const holder = records.find((r) => r.status === '独占中') ?? records[0]
    const waitlist = records
      .filter((r) => r.id !== holder?.id)
      .map((r) => ({ gateRecordId: r.id, claimedAt: r.claimedAt }))
    return { boundary, holderGateId: holder?.id, waitlist }
  }
  function boundaryHolder(boundary: string) {
    return gateRecords.value.find((r) => r.id === boundaryWindow(boundary).holderGateId)
  }
  function boundaryWaiters(boundary: string) {
    const w = boundaryWindow(boundary)
    return w.waitlist.map((item) => gateRecords.value.find((r) => r.id === item.gateRecordId)).filter(Boolean) as GateRecord[]
  }

  // ---- 门禁记录：把作业许可、隔离点、班组交接绑成同一份记录 ----
  function boundaryOf(permit: Permit): string | undefined {
    return permit.isolationPoints.find((p) => p.boundary)?.boundary
  }
  function buildExitConditions(permit: Permit): ExitCondition[] {
    const conds: ExitCondition[] = permit.isolationPoints
      .filter((p) => p.boundary)
      .map((p) => ({ id: `EC-${p.id}`, label: `恢复 ${p.device} ${p.label}`, satisfied: p.state === '已恢复' }))
    conds.push({ id: 'EC-HANDOVER', label: '班组交接签字', satisfied: false })
    conds.push({ id: 'EC-CLOSE', label: '许可关闭', satisfied: permit.status === '已完成' })
    return conds
  }

  /** 抢占边界窗口：先到者取得独占窗口，后到者候场并看到前组退出条件 */
  function claimBoundary(permitId: string) {
    const permit = permits.value.find((p) => p.id === permitId)
    if (!permit || permit.withdrawn) return
    const boundary = boundaryOf(permit)
    if (!boundary) { latestAlert.value = '该许可不涉及共用母线边界，无需抢占窗口'; return }
    const existing = gateRecords.value.find((r) => r.permitId === permitId && r.boundary === boundary && r.status !== '已释放')
    if (existing) { latestAlert.value = `${permit.id} 已登记门禁记录（${existing.status}）`; return }

    const holder = boundaryHolder(boundary)
    const inMaintenance = !!maintenance.value[boundary]
    const status: GateRecord['status'] = inMaintenance ? '候场中' : holder ? '候场中' : '独占中'
    const record: GateRecord = {
      id: `GR-${Date.now().toString().slice(-6)}`,
      permitId, crew: permit.crew, boundary,
      isolationPointIds: permit.isolationPoints.filter((p) => p.boundary).map((p) => p.id),
      window: permit.window, status, claimedAt: now(),
      exitConditions: buildExitConditions(permit),
      handover: { from: permit.crew, to: holder?.crew ?? '', signed: false },
    }
    gateRecords.value.push(record)
    if (status === '独占中') {
      addAudit('值班负责人', '抢占窗口', `${permit.id} / ${boundary}`, `先到者 ${permit.crew} 取得 ${boundary} 独占窗口`)
      latestAlert.value = `${permit.crew} 取得 ${boundary} 独占窗口`
    } else {
      const conds = holder?.exitConditions.filter((c) => !c.satisfied).map((c) => c.label).join('；')
      addAudit('值班负责人', '候场登记', `${permit.id} / ${boundary}`, `${permit.crew} 候场，前组 ${holder?.crew} 退出条件：${conds ?? '—'}`)
      latestAlert.value = `${permit.crew} 候场，等待 ${holder?.crew} 退出 ${boundary}`
    }
    persist()
  }

  /** 释放窗口并重算候场 */
  function releaseWindow(gateRecordId: string, reason: string) {
    const record = gateRecords.value.find((r) => r.id === gateRecordId)
    if (!record || record.status === '已释放') return
    const wasHolder = record.status === '独占中'
    record.status = '已释放'
    addAudit('值班负责人', '释放窗口', `${record.permitId} / ${record.boundary}`, reason)
    if (wasHolder) recomputeWaitlist(record.boundary)
    persist()
  }

  function recomputeWaitlist(boundary: string) {
    const w = boundaryWindow(boundary)
    if (!w.holderGateId && w.waitlist.length) {
      const next = gateRecords.value.find((r) => r.id === w.waitlist[0]!.gateRecordId)
      if (next) {
        next.status = '独占中'
        addAudit('系统', '候场递进', `${next.permitId} / ${boundary}`, `前组退出，${next.crew} 取得 ${boundary} 独占窗口`)
      }
    }
    persist()
  }

  // ---- 许可撤回 / 设备维护 / 边界修改 → 窗口立即释放并重算候场 ----
  function withdrawPermit(permitId: string) {
    const permit = permits.value.find((p) => p.id === permitId)
    if (!permit) return
    permit.withdrawn = true
    permit.status = '已撤回'
    const record = gateRecords.value.find((r) => r.permitId === permitId && r.status !== '已释放')
    if (record) releaseWindow(record.id, '许可撤回，窗口立即释放')
    addAudit('值班负责人', '撤回许可', permitId, '作业许可撤回，边界窗口立即释放并重算候场')
    latestAlert.value = `${permitId} 已撤回，${record?.boundary ?? ''} 窗口释放并重算候场`
  }
  function registerMaintenance(boundary: string, reason: string) {
    maintenance.value[boundary] = reason
    gateRecords.value.filter((r) => r.boundary === boundary && r.status !== '已释放').forEach((r) => {
      r.status = '已释放'
      addAudit('值班负责人', '设备维护', `${r.permitId} / ${boundary}`, `设备维护登记：${reason}，窗口立即释放`)
    })
    addAudit('值班负责人', '登记维护', boundary, reason)
    latestAlert.value = `${boundary} 进入设备维护，所有窗口释放并重算候场`
    persist()
  }
  function modifyBoundary(boundary: string, change: string) {
    gateRecords.value.filter((r) => r.boundary === boundary && r.status !== '已释放').forEach((r) => {
      const wasHolder = r.status === '独占中'
      r.status = '已释放'
      addAudit('值班负责人', '修改边界', `${r.permitId} / ${boundary}`, `边界修改：${change}，窗口立即释放`)
      if (wasHolder) recomputeWaitlist(boundary)
    })
    addAudit('值班负责人', '修改边界', boundary, change)
    latestAlert.value = `${boundary} 边界已修改，窗口释放并重算候场`
    persist()
  }

  // ---- 现场报文：操作号 + 设备读数摘要，重放沿用最初凭据 ----
  function nextOperationNo(permitId: string) {
    seq.value += 1
    return `OP-${permitId}-${String(seq.value).padStart(2, '0')}`
  }

  /** 现场确认机械动作：在线→已确认（设检查点）；断网→待重放（续办） */
  function confirmAction(gateRecordId: string, pointId: string, action: FieldMessage['action'], readingDigest: string, operator: string) {
    const record = gateRecords.value.find((r) => r.id === gateRecordId)
    if (!record) return
    const operationNo = nextOperationNo(record.permitId)
    const msg: FieldMessage = {
      id: `FM-${Date.now().toString().slice(-6)}`,
      operationNo, gateRecordId, permitId: record.permitId, pointId, action, readingDigest,
      credentials: { operator, confirmedAt: now() },
      status: connection.value === '在线' ? '已确认' : '待重放',
      checkpoint: false,
    }
    fieldMessages.value.push(msg)
    if (msg.status === '已确认') {
      fieldMessages.value.filter((m) => m.gateRecordId === gateRecordId).forEach((m) => { m.checkpoint = false })
      msg.checkpoint = true
      addAudit(operator, '现场确认', `${record.permitId} / ${pointId}`, `${action} · ${readingDigest} · 操作号 ${operationNo}`)
    } else {
      pendingRetry.value += 1
      addAudit(operator, '确认失败', `${record.permitId} / ${pointId}`, `断网确认失败 · 操作号 ${operationNo} 待从检查点续办`)
    }
    persist()
  }

  /** 最后确认的机械动作 = 续办检查点 */
  function lastCheckpoint(gateRecordId: string) {
    return [...fieldMessages.value].reverse().find((m) => m.gateRecordId === gateRecordId && m.status === '已确认' && m.checkpoint)
  }
  /** 待续项：所有待重放报文 */
  function pendingReplays() {
    return fieldMessages.value.filter((m) => m.status === '待重放')
  }

  /** 网络恢复后从最后确认的机械动作续办，重放沿用最初凭据 */
  function replayPending() {
    const pending = pendingReplays()
    pending.forEach((m) => {
      // 沿用最初凭据（operator + confirmedAt），不改写
      m.status = '已确认'
      const cp = lastCheckpoint(m.gateRecordId)
      addAudit('系统', '断网续办', `${m.permitId} / ${m.pointId}`,
        `从检查点（操作号 ${cp?.operationNo ?? '—'}）续办 · 操作号 ${m.operationNo} 重放 · 沿用 ${m.credentials.operator} 最初凭据`)
    })
    pendingRetry.value = 0
    connection.value = '在线'
    addAudit('系统', '重试成功', '实时通道', `断线期间 ${pending.length} 项现场确认已从最后检查点续办补传`)
    persist()
  }

  function markOffline() { connection.value = '重连中' }
  function markOnline() { connection.value = '在线' }
  function retryPending() { replayPending() }

  // ---- 班组交接签字 ----
  function signHandover(gateRecordId: string) {
    const record = gateRecords.value.find((r) => r.id === gateRecordId)
    if (!record) return
    record.handover.signed = true
    record.handover.signedAt = now()
    const cond = record.exitConditions.find((c) => c.id === 'EC-HANDOVER')
    if (cond) cond.satisfied = true
    addAudit('值班负责人', '交接签字', `${record.permitId} / ${record.boundary}`,
      `${record.handover.from} → ${record.handover.to || '下一组'} 班组交接已签字`)
    persist()
  }

  // ---- 阻断原因：后组候场时可见前组退出条件与维护状态 ----
  function blockingReasons(gateRecordId: string): string[] {
    const record = gateRecords.value.find((r) => r.id === gateRecordId)
    if (!record) return []
    const reasons: string[] = []
    if (record.status === '候场中') {
      const holder = boundaryHolder(record.boundary)
      if (holder && holder.id !== record.id) {
        reasons.push(`${record.boundary} 边界由 ${holder.crew} 独占中（先到者窗口）`)
        const unmet = holder.exitConditions.filter((c) => !c.satisfied)
        if (unmet.length) reasons.push(`前组退出条件未满足：${unmet.map((c) => c.label).join('；')}`)
      }
    }
    if (maintenance.value[record.boundary]) reasons.push(`${record.boundary} 设备维护中：${maintenance.value[record.boundary]}`)
    return reasons
  }

  // ---- 兼容旧 action ----
  function advancePermit(id: string) {
    const permit = permits.value.find((p) => p.id === id)
    if (!permit || permit.withdrawn) return
    const flow: Record<string, Permit['status']> = { 待复核: '待执行', 待执行: '执行中', 执行中: '待结束', 待结束: '待关闭', 待关闭: '已完成' }
    const next = flow[permit.status]
    if (!next) return
    if (permit.status === '待复核' && permit.reviewRequired && !confirm('该许可存在待复核冲突，确认由值班负责人承担审批责任？')) return
    permit.status = next
    permit.reviewRequired = false
    permit.revision += 1
    const record = gateRecords.value.find((r) => r.permitId === id && r.status !== '已释放')
    if (record) {
      const closeCond = record.exitConditions.find((c) => c.id === 'EC-CLOSE')
      if (closeCond) closeCond.satisfied = next === '已完成'
    }
    addAudit('当前用户', '流程推进', permit.id, `状态由"${Object.keys(flow).find((key) => flow[key] === next)}"变更为"${next}"`)
    persist()
  }
  function toggleStep(permitId: string, stepId: string) {
    const permit = permits.value.find((p) => p.id === permitId)
    const step = permit?.steps.find((s) => s.id === stepId)
    if (!permit || !step) return
    const previous = permit.steps.filter((s) => s.done).length
    step.done = !step.done
    if (previous === 2 && permit.steps.filter((s) => s.done).length === 3 && permit.id === 'WP-260929-018') {
      latestAlert.value = 'WP-260929-018 检测到 LINE-A2 共用母线隔离点，需要复核'
      permit.reviewRequired = true
      const other = permits.value.find((p) => p.id === 'WP-260929-021')
      if (other) other.reviewRequired = true
    }
    addAudit('当前用户', step.done ? '完成步骤' : '撤销步骤', `${permit.id} / ${step.id}`, step.text)
    persist()
  }
  function addPermit(permit: Permit) { permits.value.unshift(permit); addAudit('当前用户', '新建许可', permit.id, permit.title) }
  function acceptAlert() { latestAlert.value = ''; addAudit('值班负责人', '确认冲突', '跨班组重叠', '同意调整 LINE-A2 作业时间，不允许同时开工') }

  restore()
  return {
    permits, audit, connection, pendingRetry, latestAlert, loaded,
    gateRecords, fieldMessages, maintenance,
    boundaryWindow, boundaryHolder, boundaryWaiters,
    claimBoundary, releaseWindow, recomputeWaitlist,
    withdrawPermit, registerMaintenance, modifyBoundary,
    confirmAction, lastCheckpoint, pendingReplays, replayPending,
    signHandover, blockingReasons,
    advancePermit, toggleStep, addPermit, acceptAlert,
    markOffline, markOnline, retryPending, restore,
  }
})

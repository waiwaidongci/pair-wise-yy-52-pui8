import { defineStore } from 'pinia'
import type { AccessGateRecord, AuditEvent, FieldReport, GateParty, MechanicalAction, Permit } from '~/types'
import { accessGates as seedGates, auditEvents as seedAudit, permits as seedPermits } from '~/utils/mock'

const STORAGE_KEY = 'yy52-access-gate-v2'
const statusFlow: Record<Exclude<Permit['status'], '已撤回'>, Permit['status']> = {
  待复核: '待执行',
  待执行: '执行中',
  执行中: '待结束',
  待结束: '待关闭',
  待关闭: '已完成',
  已完成: '已完成',
}
let auditSeq = 0

type ActionSearchResult = { gate: AccessGateRecord; party: GateParty; action: MechanicalAction }

export const useOperationsStore = defineStore('operations', () => {
  const permits = ref<Permit[]>(structuredClone(seedPermits))
  const gates = ref<AccessGateRecord[]>(structuredClone(seedGates))
  const audit = ref<AuditEvent[]>(structuredClone(seedAudit))
  const hasSeedFailure = seedGates.some((gate) => gate.holder?.reports.some((report) => report.status === '失败'))
  const connection = ref<'在线' | '重连中'>(hasSeedFailure ? '重连中' : '在线')
  const retryCount = computed(() => gates.value.reduce((total, gate) => total + (gate.holder?.reports.filter((report) => report.status === '失败').length ?? 0), 0))
  const latestAlert = ref('BUS-A：电气二班候场中，等待线路一班满足退出条件')
  const loaded = ref(false)

  const activeGates = computed(() => gates.value.filter((gate) => gate.status !== '已释放'))
  const exclusiveCount = computed(() => gates.value.filter((gate) => gate.holder).length)
  const waitingCount = computed(() => gates.value.reduce((total, gate) => total + gate.queue.length, 0))
  const resumeCount = computed(() => gates.value.filter((gate) => gate.status === '待续办' || gate.holder?.resumeStatus === '待续办').length)
  const blockingCandidates = computed(() => gates.value.flatMap((gate) => [
    ...(gate.holder?.blockingReasons.length ? [{ gate, party: gate.holder, reasons: gate.holder.blockingReasons }] : []),
    ...gate.queue.flatMap((party) => party.blockingReasons.length ? [{ gate, party, reasons: party.blockingReasons }] : []),
  ]))

  const gateByPermit = (permitId?: string) => gates.value.find((gate) =>
    gate.holder?.permitId === permitId || gate.queue.some((party) => party.permitId === permitId) || gate.history.some((party) => party.permitId === permitId),
  )

  const partyGate = (partyId: string) => gates.value.find((gate) =>
    gate.holder?.id === partyId || gate.queue.some((party) => party.id === partyId) || gate.history.some((party) => party.id === partyId),
  )

  const nextActionForParty = (party: GateParty) => party.actions.find((action) => action.state !== '已确认')

  const findAction = (gateId: string, actionId: string): ActionSearchResult | undefined => {
    const gate = gates.value.find((item) => item.id === gateId)
    if (!gate?.holder) return undefined
    const action = gate.holder.actions.find((item) => item.id === actionId)
    return action ? { gate, party: gate.holder, action } : undefined
  }

  function nowLabel() {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  function stamp() {
    return `09-29 ${nowLabel()}`
  }

  function persist() {
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, JSON.stringify({ permits: permits.value, gates: gates.value, audit: audit.value, connection: connection.value }))
  }

  function restore() {
    if (!import.meta.client || loaded.value) return
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const draft = JSON.parse(raw)
      permits.value = draft.permits ?? structuredClone(seedPermits)
      gates.value = draft.gates ?? structuredClone(seedGates)
      audit.value = draft.audit ?? structuredClone(seedAudit)
      connection.value = draft.connection ?? (seedGates.some((gate) => gate.holder?.reports.some((report) => report.status === '失败')) ? '重连中' : '在线')
    }
    loaded.value = true
  }

  function addAudit(actor: string, action: string, target: string, detail: string) {
    auditSeq += 1
    audit.value.unshift({
      id: `AE-${Date.now().toString().slice(-5)}-${auditSeq}`,
      time: nowLabel(),
      actor,
      action,
      target,
      detail,
    })
    persist()
  }

  function makeActions(permit: Permit): MechanicalAction[] {
    return permit.isolationPoints.map((point, index) => ({
      id: `MA-${point.id}`,
      order: index + 1,
      label: point.state === '已隔离' ? `复核${point.label}` : point.type === '接地' ? `验电并装设${point.label}` : `断开并锁定${point.label}`,
      state: '待确认',
    }))
  }

  function makeParty(permit: Permit, requestedAt = stamp()): GateParty {
    return {
      id: `PARTY-${permit.boundaryId}-${permit.id.slice(-3)}`,
      permitId: permit.id,
      permitTitle: permit.title,
      crew: permit.crew,
      owner: permit.owner,
      credentialId: `CRED-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${Math.floor(1000 + Math.random() * 9000)}`,
      requestedAt,
      ready: false,
      pointIds: permit.isolationPoints.map((point) => point.id),
      boundaryRevision: 1,
      blockingReasons: [],
      actions: makeActions(permit),
      reports: [],
    }
  }

  function waitingReasons(gate: AccessGateRecord, party: GateParty) {
    const reasons: string[] = []
    if (gate.holder) reasons.push(`${gate.holder.crew}持有独占窗口；等待其满足全部退出条件`)
    if (gate.maintenance) reasons.push('设备已转维护，维护解除前不得取得窗口')
    if (party.boundaryRevision !== gate.revision) reasons.push(`边界已修订至 r${gate.revision}，当前候选仍为 r${party.boundaryRevision}`)
    if (!party.ready) reasons.push('尚未到计划开工时间；到场后可申请取得独占窗口')
    return [...new Set(reasons)]
  }

  function recalcGate(gate: AccessGateRecord) {
    gate.revision = gate.revision || 1
    gate.updatedAt = stamp()

    if (gate.holder) {
      const reasons: string[] = []
      if (gate.maintenance) reasons.push('设备转维护，独占窗口已立即释放，等待维护解除后重算')
      if (gate.holder.boundaryRevision !== gate.revision) reasons.push(`边界已修订至 r${gate.revision}，门禁候选需重新挂接`)
      if (gate.holder.actions.some((action) => action.state === '确认失败')) reasons.push('断网确认失败：网络恢复后从最后确认的机械动作续办')
      gate.holder.blockingReasons = [...new Set(reasons)]
      gate.status = gate.holder.blockingReasons.some((reason) => reason.startsWith('断网')) ? '待续办' : '独占中'
      persist()
      return
    }

    gate.queue.forEach((party) => {
      party.blockingReasons = waitingReasons(gate, party)
    })

    const next = gate.queue[0]
    const eligible = next && !gate.maintenance && next.boundaryRevision === gate.revision && next.ready
      && !next.blockingReasons.some((reason) => reason.includes('持有独占窗口') || reason.startsWith('边界已修订'))
    if (eligible) {
      if (!gate.holder) acquireFirstParty(gate)
      else promoteNext(gate)
      return
    }

    gate.status = gate.queue.length || gate.maintenance ? '候场中' : '已释放'
    persist()
  }

  function completeHandoffs(gate: AccessGateRecord, fromPermitId: string, status: '已交接' | '许可撤回' | '维护释放' | '边界作废', note?: string) {
    gate.handoffs.forEach((handover) => {
      if (handover.fromPermitId === fromPermitId && handover.status === '候场待退') {
        handover.status = status
        handover.note = note
      }
    })
  }

  function cancelHandoffsForWaiting(gate: AccessGateRecord, permitId: string) {
    gate.handoffs.forEach((handover) => {
      if (handover.toPermitId === permitId && handover.status === '候场待退') {
        handover.status = '许可撤回'
        handover.note = '候场许可已撤回，窗口释放后不再自动交接'
      }
    })
  }

  function releaseCurrentHolder(gate: AccessGateRecord, releaseReason: string) {
    if (!gate.holder) return
    gate.history.unshift(gate.holder)
    gate.holder = undefined
    gate.status = '候场中'
    gate.releaseReason = releaseReason
    gate.updatedAt = stamp()
  }

  function acquireFirstParty(gate: AccessGateRecord) {
    const next = gate.queue.shift()
    if (!next) {
      gate.status = '已释放'
      persist()
      return
    }
    next.acquiredAt = stamp()
    next.boundaryRevision = gate.revision
    next.blockingReasons = []
    gate.holder = next
    gate.status = '独占中'
    gate.releaseReason = undefined
    gate.updatedAt = stamp()

    gate.handoffs.forEach((handover) => {
      if (handover.toPermitId === next.permitId && handover.status === '候场待退') {
        handover.status = '已交接'
        handover.at = stamp()
      }
    })

    const permit = permits.value.find((item) => item.id === next.permitId)
    if (permit && ['待复核', '待执行'].includes(permit.status)) permit.status = '执行中'

    addAudit('系统', '独占取得', `${gate.id} / ${next.permitId}`, `${next.crew}重算后取得窗口，凭据 ${next.credentialId}`)
    persist()
  }

  function promoteNext(gate: AccessGateRecord) {
    if (!gate.holder) return
    const previous = gate.holder
    previous.blockingReasons = []
    gate.history.unshift(previous)
    gate.holder = undefined

    const next = gate.queue[0]
    const eligible = next && !gate.maintenance && next.ready && next.boundaryRevision === gate.revision
    if (!next) {
      gate.status = '已释放'
      gate.releaseReason = '前一组完成退出，当前无候场班组'
      gate.updatedAt = stamp()
      addAudit('系统', '窗口释放', gate.id, `${previous.crew}退出；无候场班组，门禁窗口已释放`)
      persist()
      return
    }
    if (!eligible) {
      gate.status = '候场中'
      gate.releaseReason = '前一组退出；等待第一候场班组满足取得条件'
      gate.updatedAt = stamp()
      addAudit('系统', '窗口释放', gate.id, `${previous.crew}退出；第一候场班组暂不满足取得条件，候场原因已保留`)
      persist()
      return
    }

    gate.queue.shift()
    next.acquiredAt = stamp()
    next.boundaryRevision = gate.revision
    next.blockingReasons = []
    next.actions = next.actions.map((action) => ({ ...action, state: '待确认' as const, error: undefined }))
    gate.holder = next
    gate.status = '独占中'
    gate.releaseReason = undefined
    gate.updatedAt = stamp()

    gate.handoffs.forEach((handover) => {
      if (handover.toPermitId === next.permitId && handover.status === '候场待退') {
        handover.status = '已交接'
        handover.at = stamp()
      }
    })

    const permit = permits.value.find((item) => item.id === next.permitId)
    if (permit && ['待复核', '待执行'].includes(permit.status)) permit.status = '执行中'

    addAudit('系统', '独占取得', `${gate.id} / ${next.permitId}`, `${next.crew}按先到先得取得窗口；前一组 ${previous.crew} 的退出条件已随交接保留，凭据 ${next.credentialId}`)
    persist()
  }

  function requestForPermit(permitId: string) {
    const permit = permits.value.find((item) => item.id === permitId)
    if (!permit || permit.status === '已撤回') return

    let gate = gates.value.find((item) => item.boundaryId === permit.boundaryId)
    if (!gate) {
      gate = {
        id: `GATE-${permit.boundaryId}`,
        boundaryId: permit.boundaryId,
        boundaryName: permit.boundaryName,
        status: '候场中',
        queue: [],
        history: [],
        handoffs: [],
        exitConditions: ['隔离点机械位置复核一致', '现场报文、操作号和设备读数摘要回传', '完成班组交接签字'],
        revision: 1,
        maintenance: false,
        updatedAt: stamp(),
      }
      gates.value.unshift(gate)
    }

    const existed = gate.holder?.permitId === permit.id || gate.queue.some((party) => party.permitId === permit.id) || gate.history.some((party) => party.permitId === permit.id)
    if (existed) {
      recalcGate(gate)
      return
    }

    const party = makeParty(permit)
    party.ready = true
    party.boundaryRevision = gate.revision
    if (!gate.holder && !gate.maintenance && party.boundaryRevision === gate.revision) {
      party.acquiredAt = party.requestedAt
      gate.holder = party
      gate.status = '独占中'
      if (permit.status === '待执行' || permit.status === '待复核') permit.status = '执行中'
      addAudit(permit.owner, '独占取得', `${gate.id} / ${permit.id}`, `先到班组取得${gate.boundaryName}独占窗口，凭据 ${party.credentialId}`)
    } else {
      gate.queue.push(party)
      gate.status = '候场中'
      addAudit(permit.owner, '候场排队', `${gate.id} / ${permit.id}`, `${permit.crew}已到场；${gate.holder?.crew ?? '现场'}占用边界，已展示前一组退出条件`)
    }
    recalcGate(gate)
  }

  function addPermit(permit: Permit) {
    permits.value.unshift(permit)
    addAudit('当前用户', '新建许可', permit.id, `${permit.title}已绑定${permit.boundaryName}同一份门禁记录`)
    requestForPermit(permit.id)
  }

  function advancePermit(id: string) {
    const permit = permits.value.find((item) => item.id === id)
    if (!permit || permit.status === '已撤回') return
    const next = statusFlow[permit.status]
    if (!next || next === permit.status) return
    if (permit.status === '待复核' && permit.reviewRequired && !confirm('该许可存在待复核阻断，确认由值班负责人承担审批责任？')) return
    const previousStatus = permit.status
    permit.status = next
    permit.reviewRequired = false
    permit.revision += 1
    addAudit('当前用户', '流程推进', permit.id, `状态由“${previousStatus}”变更为“${next}”`)
  }

  function toggleStep(permitId: string, stepId: string) {
    const permit = permits.value.find((item) => item.id === permitId)
    const step = permit?.steps.find((item) => item.id === stepId)
    if (!permit || !step) return
    step.done = !step.done
    addAudit('当前用户', step.done ? '完成步骤' : '撤销步骤', `${permit.id} / ${step.id}`, step.text)
  }

  function exitAndHandover(gateId: string) {
    const gate = gates.value.find((item) => item.id === gateId)
    if (!gate?.holder) return
    const holder = gate.holder
    completeHandoffs(gate, holder.permitId, '已交接', '前一组退出条件、操作号和末次读数摘要已随门禁记录交接')
    addAudit(holder.owner, '班组退出', `${gate.id} / ${holder.permitId}`, `${holder.crew}满足退出条件并完成交接，窗口立即重算`)
    promoteNext(gate)
  }

  function withdrawPermit(permitId: string) {
    const permit = permits.value.find((item) => item.id === permitId)
    const gate = gateByPermit(permitId)
    if (!permit || !gate) return
    permit.status = '已撤回'
    permit.reviewRequired = false

    if (gate.holder?.permitId === permitId) {
      completeHandoffs(gate, permitId, '许可撤回', '许可撤回导致独占窗口立即释放')
      addAudit(permit.owner, '许可撤回', `${gate.id} / ${permitId}`, '许可撤回，窗口立即释放并按候场顺序重算')
      promoteNext(gate)
    } else {
      const index = gate.queue.findIndex((party) => party.permitId === permitId)
      if (index >= 0) {
        const [party] = gate.queue.splice(index, 1)
        gate.history.unshift(party)
      }
      cancelHandoffsForWaiting(gate, permitId)
      addAudit(permit.owner, '候场撤回', `${gate.id} / ${permitId}`, '候场许可撤回，候场队列和交接条件立即重算')
      recalcGate(gate)
    }
  }

  function markMaintenance(gateId: string) {
    const gate = gates.value.find((item) => item.id === gateId)
    if (!gate || gate.maintenance) return
    gate.maintenance = true
    if (gate.holder) {
      const holder = gate.holder
      completeHandoffs(gate, holder.permitId, '维护释放', '设备转维护，独占窗口立即释放')
      releaseCurrentHolder(gate, '设备维护：独占窗口立即释放')
      addAudit('值班负责人', '设备维护', gate.id, `${holder.crew}窗口释放；候场班组保留队列并看到维护阻断原因`)
    } else {
      addAudit('值班负责人', '设备维护', gate.id, '设备转维护，候场顺序保留，维护解除前不得取得窗口')
    }
    recalcGate(gate)
  }

  function clearMaintenance(gateId: string) {
    const gate = gates.value.find((item) => item.id === gateId)
    if (!gate || !gate.maintenance) return
    gate.maintenance = false
    addAudit('值班负责人', '维护解除', gate.id, '设备恢复可用，门禁按既有候场顺序立即重算')
    recalcGate(gate)
  }

  function modifyBoundary(gateId: string, note = '现场拓扑核对后更新母线边界') {
    const gate = gates.value.find((item) => item.id === gateId)
    if (!gate) return
    gate.revision += 1
    const revision = gate.revision

    if (gate.holder) {
      const holder = gate.holder
      completeHandoffs(gate, holder.permitId, '边界作废', `边界修订 r${revision}，原独占凭据窗口立即释放`)
      releaseCurrentHolder(gate, `边界修订 r${revision}：窗口立即释放`)
      addAudit('值班负责人', '边界修改', gate.id, `${note}；${holder.crew}的窗口释放，候场班组需重新挂接 r${revision}`)
    } else {
      addAudit('值班负责人', '边界修改', gate.id, `${note}；候场资格按 r${revision} 立即重算`)
    }

    gate.queue.forEach((party) => {
      party.blockingReasons = waitingReasons(gate, party)
    })
    gate.status = gate.queue.length || gate.maintenance ? '候场中' : '已释放'
    gate.releaseReason = `边界修订 r${revision}`
    gate.updatedAt = stamp()
    persist()
  }

  function rebindParty(partyId: string) {
    const gate = partyGate(partyId)
    const party = gate?.queue.find((item) => item.id === partyId) ?? gate?.history.find((item) => item.id === partyId)
    if (!gate || !party) return
    party.boundaryRevision = gate.revision
    party.blockingReasons = party.blockingReasons.filter((reason) => !reason.startsWith('边界已修订'))
    addAudit(party.owner, '重新挂接', `${gate.id} / ${party.permitId}`, `候场候选已挂接最新边界 r${gate.revision}，继续参与重算`)
    recalcGate(gate)
  }

  function readingForAction(action: MechanicalAction) {
    if (action.label.includes('接地')) return '验电=0V；接地线编号待复核；机械位置=接地到位'
    if (action.label.includes('刀闸')) return '刀闸机械位置=分；验电=0V；五防校验通过'
    if (action.label.includes('开关') || action.label.includes('空开')) return '开关位置=分闸；负载电流=0A；锁具状态=已上锁'
    return '机械位置=锁定；双人员复核=通过；现场照片已采集'
  }

  function arriveAtBoundary(partyId: string) {
    const gate = partyGate(partyId)
    const party = gate?.queue.find((item) => item.id === partyId)
    if (!gate || !party) return
    party.ready = true
    addAudit(party.owner, '到场申请', `${gate.id} / ${party.permitId}`, `${party.crew}已到场，门禁按先到先得重算独占窗口`)
    recalcGate(gate)
  }

  function confirmMechanicalAction(gateId: string, actionId: string, customReading?: string) {
    const found = findAction(gateId, actionId)
    if (!found) return
    const { gate, party, action } = found
    const next = nextActionForParty(party)
    if (!next || next.id !== action.id) {
      addAudit(party.owner, '操作拒绝', `${gate.id} / ${action.id}`, '必须从最后确认的机械动作之后第一步续办，不能跳步')
      return
    }

    const operationNo = `OP-0929-${nowLabel().replace(':', '')}-${String(action.order).padStart(2, '0')}`
    const report: FieldReport = {
      id: `RPT-${Date.now().toString().slice(-6)}`,
      actionId: action.id,
      operationNo,
      credentialId: party.credentialId,
      createdAt: stamp(),
      status: connection.value === '在线' ? '已确认' : '失败',
      readingSummary: customReading || readingForAction(action),
    }
    party.reports.push(report)

    if (connection.value === '在线') {
      action.state = '已确认'
      action.confirmedAt = stamp()
      action.operationNo = operationNo
      party.lastConfirmedActionId = action.id
      party.resumeStatus = undefined
      addAudit(party.owner, '现场报文', `${party.permitId} / ${operationNo}`, `${report.readingSummary}；沿用最初凭据 ${party.credentialId}`)
      recalcGate(gate)
      return
    }

    action.state = '确认失败'
    action.error = '网络中断，现场报文未送达；机械动作不得重复执行'
    party.resumeStatus = '待续办'
    gate.status = '待续办'
    latestAlert.value = `${gate.boundaryName}存在断线失败确认，恢复后从 ${party.lastConfirmedActionId ?? '首个动作'} 续办`
    addAudit(party.owner, '确认失败', `${party.permitId} / ${action.id}`, `操作号 ${operationNo} 已在本地生成；${action.error}`)
    recalcGate(gate)
  }

  function simulateOfflineFailure(gateId: string) {
    const gate = gates.value.find((item) => item.id === gateId)
    const action = gate?.holder ? nextActionForParty(gate.holder) : undefined
    if (!gate || !action) return
    const wasOffline = connection.value === '重连中'
    connection.value = '重连中'
    if (!wasOffline) addAudit('系统', '网络中断', gate.id, '现场确认通道断开，后续报文进入本地待重放队列')
    confirmMechanicalAction(gateId, action.id)
  }

  function goOffline() {
    connection.value = '重连中'
    latestAlert.value = '网络中断：现场仍可机械操作，恢复后按操作号重放并从最后确认动作续办'
    addAudit('系统', '网络中断', '实时通道', '门禁候选状态本地保留；断网确认只允许从最后确认动作续办')
  }

  function reconnect() {
    const failed: { gate: AccessGateRecord; party: GateParty }[] = []
    gates.value.forEach((gate) => {
      if (gate.holder?.reports.some((report) => report.status === '失败')) failed.push({ gate, party: gate.holder })
    })

    connection.value = '在线'
    failed.forEach(({ gate, party }) => {
      const failedAction = party.actions.find((action) => action.state === '确认失败')
      const report = [...party.reports].reverse().find((item) => item.status === '失败' && (!failedAction || item.actionId === failedAction.id))
      if (!failedAction || !report) return

      failedAction.state = '已确认'
      failedAction.confirmedAt = stamp()
      failedAction.operationNo = report.operationNo
      failedAction.error = undefined
      report.status = '已确认'
      report.replayedAt = stamp()
      party.lastConfirmedActionId = failedAction.id
      party.resumeStatus = undefined
      party.blockingReasons = party.blockingReasons.filter((reason) => !reason.startsWith('断网'))
      addAudit('系统', '断线重放', `${party.permitId} / ${report.operationNo}`, `沿用最初凭据 ${report.credentialId}；${report.readingSummary}；下一待办从续办锚点之后计算`)
      recalcGate(gate)
    })

    pendingRetry.value = 0
    latestAlert.value = failed.length ? '断线期间的现场报文已按操作号重放，机械动作未重复执行' : '网络已恢复，看板、隔离页和审计继续读取同一候选状态'
    if (!failed.length) addAudit('系统', '网络恢复', '实时通道', latestAlert.value)
    gates.value.forEach((gate) => recalcGate(gate))
  }

  function acceptAlert() {
    latestAlert.value = ''
    addAudit('值班负责人', '确认提醒', '门禁协调', '已确认候场顺序和阻断原因，不改变独占窗口')
  }

  restore()
  return {
    permits,
    gates,
    audit,
    connection,
    retryCount,
    latestAlert,
    activeGates,
    exclusiveCount,
    waitingCount,
    resumeCount,
    blockingCandidates,
    gateByPermit,
    nextActionForParty,
    restore,
    addAudit,
    addPermit,
    advancePermit,
    toggleStep,
    requestForPermit,
    exitAndHandover,
    withdrawPermit,
    markMaintenance,
    clearMaintenance,
    modifyBoundary,
    rebindParty,
    arriveAtBoundary,
    confirmMechanicalAction,
    simulateOfflineFailure,
    goOffline,
    reconnect,
    acceptAlert,
  }
})

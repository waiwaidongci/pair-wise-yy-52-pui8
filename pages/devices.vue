<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'
import type { AccessGateRecord, GateParty, IsolationPoint, Permit } from '~/types'

const store = useOperationsStore()
const route = useRoute()
const selectedId = ref(String(route.query.gate || store.gates[0]?.id))
const selected = computed<AccessGateRecord | undefined>(() => store.gates.find((gate) => gate.id === selectedId.value) ?? store.gates[0])
const selectedHolder = computed(() => selected.value?.holder)
const selectedPermit = computed(() => store.permits.find((permit) => permit.id === (selectedHolder.value?.permitId ?? selected.value?.queue[0]?.permitId)))
const selectedPoints = computed(() => selectedPermit.value?.isolationPoints ?? [])
const nextAction = computed(() => selectedHolder.value ? store.nextActionForParty(selectedHolder.value) : undefined)
const holderList = computed(() => selectedHolder.value ? [selectedHolder.value] : [])

const allIsolationPoints = computed(() => store.permits.flatMap((permit) => permit.isolationPoints.map((point) => ({ point, permit }))))
function pointsOfParty(party?: GateParty): { point: IsolationPoint; permit: Permit }[] {
  if (!party) return []
  return party.pointIds
    .map((id) => allIsolationPoints.value.find((item) => item.point.id === id))
    .filter((item): item is { point: IsolationPoint; permit: Permit } => Boolean(item))
}
const gateColor = (gate: AccessGateRecord) => gate.status === '独占中' ? 'green' : gate.status === '待续办' ? 'amber' : gate.maintenance ? 'red' : 'blue'
</script>

<template>
  <div class="page">
    <div class="head">
      <div><p class="eyebrow">LOCKOUT / TAGOUT / ACCESS</p><h1 class="page-title">边界隔离与独占门禁</h1><p class="muted">作业许可、隔离点、锁具操作和班组交接写入同一条门禁记录；候场班组可见前一组退出条件。</p></div>
      <div class="inline"><UBadge :color="store.connection === '在线' ? 'green' : 'amber'">{{ store.connection }}</UBadge><UButton color="primary" icon="i-heroicons-plus" @click="navigateTo('/permits?new=1')">申请边界许可</UButton></div>
    </div>

    <div class="gate-grid">
      <button v-for="gate in store.gates" :key="gate.id" class="panel gate-card" :class="{ active: gate.id === selectedId }" @click="selectedId = gate.id">
        <div class="inline justify-between"><UBadge variant="subtle">{{ gate.boundaryId }}</UBadge><UBadge :color="gateColor(gate)" variant="subtle">{{ gate.status }}</UBadge></div>
        <h2>{{ gate.boundaryName }}</h2>
        <p><span>独占班组</span><b>{{ gate.holder?.crew ?? '窗口释放' }}</b></p>
        <p><span>候场队列</span><b>{{ gate.queue.length }} 组</b></p>
        <p><span>隔离点</span><b>{{ (gate.holder?.pointIds.length ?? 0) + gate.queue.reduce((sum, party) => sum + party.pointIds.length, 0) }} 个</b></p>
        <small>r{{ gate.revision }} · {{ gate.updatedAt }}</small>
      </button>
    </div>

    <section v-if="selected" class="grid lower">
      <article class="panel p-4">
        <div class="section-head">
          <div><h2>{{ selected.boundaryName }} · 门禁记录 {{ selected.id }}</h2><p>候选修订 r{{ selected.revision }} · 前一组退出条件对候场班组可见</p></div>
          <UBadge :color="gateColor(selected)" variant="subtle">{{ selected.status }}</UBadge>
        </div>

        <div v-if="selectedHolder" class="owner-card">
          <div><small>当前独占</small><h3>{{ selectedHolder.crew }} · {{ selectedHolder.owner }}</h3><p>{{ selectedHolder.permitId }} · {{ selectedHolder.permitTitle }}</p></div>
          <div class="credential"><span>最初凭据</span><b>{{ selectedHolder.credentialId }}</b></div>
        </div>
        <UAlert v-else color="blue" variant="soft" title="独占窗口当前释放" :description="selected.releaseReason || '候场或维护解除后，按先到顺序重新取得窗口；历史交接仍保留在本记录。'" />

        <h3>绑定隔离点与设备读数</h3>
        <div v-for="item in pointsOfParty(selectedHolder ?? selected.queue[0])" :key="item.point.id" class="point">
          <div class="lock-icon"><UIcon name="i-heroicons-lock-closed" /></div>
          <div><b>{{ item.point.label }}</b><small>{{ item.point.device }} · {{ item.point.type }} · {{ item.point.id }}</small></div>
          <UBadge :color="item.point.state === '已隔离' ? 'green' : 'amber'" variant="subtle">{{ item.point.state }}</UBadge>
        </div>
        <UAlert v-if="!selectedPoints.length && !selected.queue.length" color="gray" title="暂无绑定隔离点" description="新建许可时会把许可与边界隔离点同时写入门禁记录。" />

        <h3>机械动作续办链</h3>
        <div v-for="party in holderList" :key="party.id">
          <div v-for="action in party.actions" :key="action.id" class="action-row" :class="action.state">
            <div><i>{{ action.order }}</i><div><b>{{ action.label }}</b><small>{{ action.id }} · {{ action.operationNo || '未生成操作号' }}</small><p v-if="action.error" class="danger">{{ action.error }}</p></div></div>
            <UBadge :color="action.state === '已确认' ? 'green' : action.state === '确认失败' ? 'red' : 'gray'" variant="subtle">{{ action.state }}</UBadge>
            <UButton v-if="nextAction?.id === action.id && selected.holder" size="xs" color="primary" @click="store.confirmMechanicalAction(selected.id, action.id)">现场确认</UButton>
          </div>
          <div class="action-actions">
            <UButton size="sm" color="amber" variant="soft" icon="i-heroicons-signal-slash" :disabled="!nextAction" @click="store.simulateOfflineFailure(selected.id)">模拟断网确认失败</UButton>
            <UButton size="sm" color="green" variant="soft" icon="i-heroicons-arrow-path-rounded-square" :disabled="!selected.holder" @click="store.exitAndHandover(selected.id)">满足条件并退出交接</UButton>
          </div>
        </div>

        <h3>现场报文</h3>
        <div v-for="report in (selectedHolder?.reports ?? [])" :key="report.id" class="report">
          <div><b>{{ report.operationNo }}</b><small>{{ report.createdAt }}<template v-if="report.replayedAt"> · 重放 {{ report.replayedAt }}</template></small></div>
          <p>{{ report.readingSummary }}</p><small>凭据 {{ report.credentialId }}</small><UBadge :color="report.status === '已确认' ? 'green' : 'red'" size="xs">{{ report.status }}</UBadge>
        </div>
        <p v-if="!selectedHolder?.reports.length" class="muted">暂无报文；报文必须携带操作号、设备读数摘要，并沿用班组最初凭据。</p>
      </article>

      <aside class="grid side">
        <article class="panel p-4">
          <h3>前一组退出条件</h3>
          <ul><li v-for="condition in selected.exitConditions" :key="condition">{{ condition }}</li></ul>
          <div v-for="handover in selected.handoffs" :key="handover.id" class="handover">
            <div class="inline justify-between"><b>{{ handover.fromCrew }} → {{ handover.toCrew ?? '无接替班组' }}</b><UBadge size="xs" :color="handover.status === '已交接' ? 'green' : 'amber'">{{ handover.status }}</UBadge></div>
            <small>{{ handover.at }} · {{ handover.fromPermitId }}</small>
            <p v-for="condition in handover.conditions" :key="condition">{{ condition }}</p>
          </div>
        </article>

        <article class="panel p-4">
          <h3>候场队列与阻断原因</h3>
          <div v-for="(party, index) in selected.queue" :key="party.id" class="waiter">
            <div class="inline justify-between"><b>#{{ index + 1 }} {{ party.crew }}</b><UBadge size="xs" :color="party.ready ? 'green' : 'gray'">{{ party.ready ? '已到场' : '计划候场' }}</UBadge></div>
            <small>{{ party.permitId }} · {{ party.owner }}</small>
            <p v-for="reason in party.blockingReasons" :key="reason">{{ reason }}</p>
            <div class="inline wrap">
              <UButton v-if="!party.ready" size="xs" @click="store.arriveAtBoundary(party.id)">到场申请窗口</UButton>
              <UButton v-if="party.boundaryRevision !== selected.revision" size="xs" color="amber" variant="soft" @click="store.rebindParty(party.id)">挂接 r{{ selected.revision }}</UButton>
              <UButton size="xs" color="red" variant="ghost" @click="store.withdrawPermit(party.permitId)">撤回许可</UButton>
            </div>
          </div>
          <p v-if="!selected.queue.length" class="muted">当前没有候场班组。</p>
        </article>

        <article class="panel p-4 controls">
          <h3>窗口立即释放 / 重算</h3>
          <UButton block color="red" variant="soft" icon="i-heroicons-no-symbol" :disabled="!selected.holder" @click="selectedHolder && store.withdrawPermit(selectedHolder.permitId)">许可撤回</UButton>
          <UButton block class="mt-2" color="amber" variant="soft" icon="i-heroicons-wrench-screwdriver" :disabled="selected.maintenance" @click="store.markMaintenance(selected.id)">设备转维护</UButton>
          <UButton block class="mt-2" color="gray" variant="soft" icon="i-heroicons-wrench" :disabled="!selected.maintenance" @click="store.clearMaintenance(selected.id)">维护解除并重算</UButton>
          <UButton block class="mt-2" color="orange" variant="soft" icon="i-heroicons-pencil-square" @click="store.modifyBoundary(selected.id)">修改边界并重挂候场</UButton>
        </article>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}.gate-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.gate-card{text-align:left;padding:16px;cursor:pointer}.gate-card.active{border-color:#2563eb;box-shadow:0 0 0 2px #dbeafe}.gate-card h2{font-size:16px;margin:14px 0}.gate-card p{display:flex;justify-content:space-between;margin:7px 0;font-size:13px}.gate-card p span{color:#667085}.gate-card small{color:#667085}.lower{grid-template-columns:minmax(0,1.25fr) minmax(330px,.75fr);gap:16px}.section-head{display:flex;justify-content:space-between;gap:12px}.panel h2{font-size:17px;margin:0 0 5px}.section-head p{font-size:12px;color:#667085;margin:0}.panel h3{font-size:15px;margin:18px 0 10px}.owner-card{display:flex;justify-content:space-between;gap:12px;border:1px solid #dbeafe;background:#f8fbff;border-radius:8px;padding:13px;margin:14px 0}.owner-card h3{margin:4px 0}.owner-card p,.owner-card small{color:#667085;margin:0}.credential{text-align:right}.credential span{display:block;color:#667085;font-size:12px}.point{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid #edf0f5}.point>div:nth-child(2){flex:1}.point b,.point small{display:block}.point small{color:#667085;margin-top:4px}.lock-icon{display:grid;place-items:center;width:34px;height:34px;background:#eff6ff;color:#2563eb;border-radius:7px}.action-row{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #e2e8f0;border-radius:8px;padding:11px;margin:8px 0}.action-row>div:first-child{display:flex;gap:10px;align-items:flex-start;flex:1}.action-row i{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#e2e8f0;font-style:normal;font-size:12px}.action-row.已确认 i{background:#22c55e;color:#fff}.action-row.确认失败{border-color:#fecaca;background:#fef2f2}.action-row b,.action-row small{display:block}.action-row small{color:#667085;margin-top:3px}.action-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px}.report{display:grid;grid-template-columns:1fr auto;gap:4px 10px;padding:11px 0;border-bottom:1px solid #edf0f5}.report p{grid-column:1/-1;margin:4px 0;color:#475569}.report small{color:#667085}.side{height:fit-content;gap:14px}ul{margin:0;padding-left:18px;color:#475569;font-size:13px;line-height:1.8}.handover,.waiter{border-top:1px solid #edf0f5;padding:11px 0}.handover p,.waiter p{font-size:12px;color:#b45309;margin:7px 0}.handover small,.waiter small{display:block;color:#667085;margin-top:4px}.controls .mt-2{margin-top:8px}
@media(max-width:1100px){.gate-grid{grid-template-columns:1fr 1fr}.lower{grid-template-columns:1fr}}@media(max-width:650px){.head{flex-direction:column;gap:10px}.gate-grid{grid-template-columns:1fr}.action-row{align-items:flex-start;flex-direction:column}.owner-card{flex-direction:column}.credential{text-align:left}}
</style>

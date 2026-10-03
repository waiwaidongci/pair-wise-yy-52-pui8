<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'

const store = useOperationsStore()
const { data } = await useFetch('/api/operations')
const { reconnect } = useRealtime((event) => {
  if (event.type === 'connection') store.connection = event.payload.startsWith('在线') ? '在线' : '重连中'
  if (event.type === 'permit-update') store.latestAlert = event.payload
})

const counts = computed(() => ({
  active: store.exclusiveCount,
  waiting: store.waitingCount,
  resume: store.resumeCount,
  blocks: store.blockingCandidates.length,
}))

const statusColor = (gate: (typeof store.gates)[number]) => {
  if (gate.status === '待续办') return 'amber'
  if (gate.status === '独占中') return 'green'
  if (gate.maintenance) return 'red'
  return 'blue'
}
</script>

<template>
  <div class="page">
    <div class="head">
      <div>
        <p class="eyebrow">统一门禁候选状态</p>
        <h1 class="page-title">隔离、许可与班组交接总览</h1>
        <p class="muted">作业许可、隔离点、机械动作和交接都挂到同一条边界门禁记录，刷新或重开后仍按同一候选状态展示。</p>
      </div>
      <div class="inline wrap">
        <UButton color="gray" variant="outline" icon="i-heroicons-arrow-path" @click="store.connection === '在线' ? reconnect() : store.reconnect()">检查 / 恢复连接</UButton>
        <UButton color="primary" icon="i-heroicons-document-plus" @click="navigateTo('/permits?new=1')">申请作业许可</UButton>
      </div>
    </div>

    <UAlert
      v-if="store.latestAlert"
      class="mb-4"
      :color="store.connection === '重连中' ? 'amber' : 'blue'"
      variant="soft"
      icon="i-heroicons-shield-exclamation"
      title="门禁候选状态提醒"
      :description="store.latestAlert"
      :actions="[{ label: '已知悉', click: store.acceptAlert }]"
    />

    <section class="grid metrics">
      <article class="panel metric"><span>独占窗口</span><strong>{{ counts.active }}</strong><small>先到班组正在执行</small></article>
      <article class="panel metric"><span>候场班组</span><strong>{{ counts.waiting }}</strong><small>可见前一组退出条件</small></article>
      <article class="panel metric"><span>断线待续办</span><strong class="warning">{{ counts.resume }}</strong><small>锚定最后机械动作</small></article>
      <article class="panel metric"><span>阻断候选原因</span><strong class="danger">{{ counts.blocks }}</strong><small>在线设备 {{ data?.onlineDevices }}/{{ data?.totalDevices }}</small></article>
    </section>

    <section class="grid main-grid">
      <article class="panel p-4">
        <div class="panel-head">
          <div><h2>边界门禁记录</h2><p class="muted">看板、隔离页和审计读取同一份 Pinia 候选状态</p></div>
          <UBadge color="blue" variant="subtle">候选修订最高 r{{ Math.max(...store.gates.map(gate => gate.revision)) }}</UBadge>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>边界 / 许可</th><th>独占班组</th><th>候场</th><th>最后机械动作</th><th>阻断原因</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="gate in store.activeGates" :key="gate.id">
                <td>
                  <b>{{ gate.boundaryName }}</b>
                  <small class="block muted">{{ gate.boundaryId }} · r{{ gate.revision }}</small>
                  <small class="block muted">{{ gate.holder?.permitId ?? gate.queue[0]?.permitId ?? '无候选许可' }}</small>
                </td>
                <td>
                  <template v-if="gate.holder">
                    <b>{{ gate.holder.crew }}</b>
                    <small class="block muted">{{ gate.holder.owner }} · {{ gate.holder.credentialId }}</small>
                  </template>
                  <span v-else class="muted">窗口已释放</span>
                </td>
                <td>
                  <UBadge color="blue" variant="subtle">{{ gate.queue.length }} 组</UBadge>
                  <small v-if="gate.queue[0]" class="block muted mt-1">{{ gate.queue[0].crew }}</small>
                </td>
                <td>
                  <template v-if="gate.holder?.lastConfirmedActionId">
                    <b>{{ gate.holder.actions.find(action => action.id === gate.holder?.lastConfirmedActionId)?.label }}</b>
                    <small class="block muted">续办点：{{ store.nextActionForParty(gate.holder)?.label ?? '全部确认' }}</small>
                  </template>
                  <span v-else class="muted">待取得窗口</span>
                </td>
                <td>
                  <div v-for="reason in gate.holder?.blockingReasons ?? gate.queue[0]?.blockingReasons ?? []" :key="reason" class="reason">{{ reason }}</div>
                  <span v-if="!(gate.holder?.blockingReasons.length ?? gate.queue[0]?.blockingReasons?.length)" class="success">无新增阻断</span>
                </td>
                <td class="inline"><UBadge :color="statusColor(gate)" variant="subtle">{{ gate.status }}</UBadge><UButton size="xs" variant="ghost" @click="navigateTo(`/devices?gate=${gate.id}`)">隔离页</UButton></td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <aside class="grid side-grid">
        <article class="panel p-4">
          <h2>待续办与候场队列</h2>
          <div v-for="item in store.blockingCandidates" :key="item.party.id" class="queue-item">
            <div class="inline justify-between wrap"><b>{{ item.party.crew }}</b><UBadge size="xs" color="amber" variant="subtle">{{ item.gate.boundaryId }}</UBadge></div>
            <p v-for="reason in item.reasons" :key="reason">{{ reason }}</p>
          </div>
          <p v-if="!store.blockingCandidates.length" class="muted">当前没有阻断候选。</p>
        </article>
        <article class="panel p-4">
          <h2>现场条件</h2>
          <div class="condition"><span>轮毂高度风速</span><b>{{ data?.windSpeed }} m/s</b></div>
          <div class="condition"><span>报文重放凭据</span><b>沿用最初凭据</b></div>
          <div class="condition"><span>交接记录</span><b>随边界保留</b></div>
          <div class="condition"><span>连接状态</span><b :class="store.connection === '在线' ? 'success' : 'warning'">{{ store.connection }}</b></div>
        </article>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}.metrics{grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.metric{padding:17px}.main-grid{grid-template-columns:minmax(0,1.65fr) minmax(310px,.7fr);gap:16px}.panel-head{display:flex;justify-content:space-between;margin-bottom:12px}.panel h2{font-size:17px;margin:0 0 12px}.panel-head h2{margin:0}.panel-head p{font-size:12px;margin:3px 0}.block,.device-row small{display:block}.side-grid{gap:14px}.condition{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5;font-size:14px}.condition span{color:#667085}.reason{font-size:12px;color:#b45309;margin:4px 0}.queue-item{padding:11px 0;border-bottom:1px solid #edf0f5}.queue-item p{font-size:12px;color:#667085;margin:7px 0 0}.mt-1{margin-top:4px}
@media(max-width:1100px){.metrics{grid-template-columns:1fr 1fr}.main-grid{grid-template-columns:1fr}}@media(max-width:620px){.head{flex-direction:column}.metrics{grid-template-columns:1fr}}
</style>

<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'

const store = useOperationsStore()
const { data } = await useFetch('/api/operations')
const { reconnect } = useRealtime((event) => {
  if (event.type === 'connection') store.connection = event.payload.startsWith('在线') ? '在线' : '重连中'
  if (event.type === 'permit-update') store.latestAlert = event.payload
})

const counts = computed(() => ({
  active: store.permits.filter((item) => ['执行中', '待结束'].includes(item.status)).length,
  pending: store.permits.filter((item) => ['待复核', '待执行'].includes(item.status)).length,
  conflicts: store.permits.filter((item) => item.reviewRequired).length,
}))

// 同一份候选状态：边界窗口、待续项、阻断原因
const busWindow = computed(() => store.boundaryWindow('BUS-A'))
const busHolder = computed(() => store.boundaryHolder('BUS-A'))
const busWaiters = computed(() => store.boundaryWaiters('BUS-A'))
const pendingReplays = computed(() => store.pendingReplays())
const pendingCount = computed(() => pendingReplays.value.length)

function gateStatus(permitId: string) {
  const rec = store.gateRecords.find((r) => r.permitId === permitId && r.status !== '已释放')
  if (!rec) return { color: 'gray' as const, label: '未登记' }
  const color = rec.status === '独占中' ? 'green' : rec.status === '候场中' ? 'amber' : 'gray'
  return { color, label: `${rec.boundary} · ${rec.status}` }
}

function simulateOffline() {
  store.markOffline()
  store.latestAlert = '模拟断网：现场确认将失败并进入待重放，恢复后从最后检查点续办'
}
function simulateOnline() {
  if (pendingCount.value) store.replayPending()
  else { store.markOnline(); store.latestAlert = '网络已恢复，无待续项' }
}
</script>

<template>
  <div class="page">
    <div class="head">
      <div><p class="eyebrow">现场安全运行</p><h1 class="page-title">隔离与作业许可总览</h1><p class="muted">作业许可、隔离点、班组交接绑成同一份门禁记录；看板、隔离页、审计读同一份候选状态。</p></div>
      <div class="inline wrap"><UButton color="gray" variant="outline" icon="i-heroicons-arrow-path" @click="reconnect">检查连接</UButton><UButton :color="store.connection === '在线' ? 'amber' : 'green'" variant="soft" :icon="store.connection === '在线' ? 'i-heroicons-cloud-slash' : 'i-heroicons-cloud'" @click="store.connection === '在线' ? simulateOffline() : simulateOnline()">{{ store.connection === '在线' ? '模拟断网' : `恢复网络${pendingCount ? ` · 续办 ${pendingCount}` : ''}` }}</UButton><UButton color="primary" icon="i-heroicons-document-plus" @click="navigateTo('/permits?new=1')">申请作业许可</UButton></div>
    </div>
    <UAlert v-if="store.latestAlert" class="mb-4" color="amber" variant="soft" icon="i-heroicons-exclamation-triangle" title="实时冲突提醒" :description="store.latestAlert" :actions="[{ label: '协调并确认', click: store.acceptAlert }]" />
    <section class="grid metrics">
      <article class="panel metric"><span>执行中许可</span><strong>{{ counts.active }}</strong><small>3 个班组在场</small></article>
      <article class="panel metric"><span>待复核 / 待执行</span><strong>{{ counts.pending }}</strong><small>最早 18:00 开工</small></article>
      <article class="panel metric"><span>隔离冲突</span><strong class="danger">{{ counts.conflicts }}</strong><small>必须复核后推进</small></article>
      <article class="panel metric"><span>设备在线</span><strong>{{ data?.onlineDevices }}/{{ data?.totalDevices }}</strong><small>平均风速 {{ data?.windSpeed }} m/s</small></article>
    </section>
    <section class="grid main-grid">
      <article class="panel p-4">
        <div class="panel-head"><div><h2>当前作业状态</h2><p class="muted">按风险和开始时间排序</p></div><UBadge color="blue" variant="subtle">版本 r{{ data?.revision }}</UBadge></div>
        <div class="table-scroll"><table class="data-table"><thead><tr><th>许可 / 作业</th><th>设备</th><th>负责人</th><th>时间窗</th><th>门禁窗口</th><th>状态</th><th></th></tr></thead><tbody>
          <tr v-for="permit in store.permits" :key="permit.id"><td><b>{{ permit.id }}</b><small class="block muted">{{ permit.title }}</small></td><td>{{ permit.device }}</td><td>{{ permit.owner }} · {{ permit.crew }}</td><td>{{ permit.window }}</td><td><UBadge :color="gateStatus(permit.id).color" variant="subtle">{{ gateStatus(permit.id).label }}</UBadge></td><td><UBadge :color="permit.withdrawn ? 'gray' : permit.reviewRequired ? 'red' : permit.status === '执行中' ? 'green' : 'amber'" variant="subtle">{{ permit.withdrawn ? '已撤回' : permit.reviewRequired ? '待复核冲突' : permit.status }}</UBadge></td><td><UButton size="xs" variant="ghost" @click="navigateTo(`/permits?id=${permit.id}`)">进入</UButton></td></tr>
        </tbody></table></div>
      </article>
      <aside class="grid side-grid">
        <article class="panel p-4">
          <div class="panel-head"><h2>BUS-A 边界窗口</h2><UBadge color="blue" variant="subtle">先到者独占</UBadge></div>
          <div v-if="busHolder" class="window-holder"><span class="dot green" /><div><b>{{ busHolder.crew }} 独占中</b><small>{{ busHolder.permitId }} · {{ busHolder.window }}</small></div></div>
          <div v-for="w in busWaiters" :key="w.id" class="window-waiter"><span class="dot amber" /><div><b>{{ w.crew }} 候场中</b><small>{{ w.permitId }} · {{ w.window }}</small></div></div>
          <UAlert v-if="!busHolder && !busWaiters.length" color="gray" variant="soft" title="BUS-A 窗口空闲" description="暂无班组抢占该母线边界。" />
        </article>
        <article class="panel p-4">
          <div class="panel-head"><h2>待续项 / 阻断原因</h2><UBadge v-if="pendingCount" color="amber" variant="subtle">{{ pendingCount }} 项待续办</UBadge></div>
          <div v-if="pendingCount" class="resume-list">
            <div v-for="m in pendingReplays" :key="m.id" class="resume-item"><UIcon name="i-heroicons-arrow-path" /><div><b>{{ m.operationNo }}</b><small>{{ m.permitId }} · {{ m.action }} · {{ m.readingDigest }}</small></div><UBadge color="amber" variant="subtle">待重放</UBadge></div>
            <UButton block color="amber" variant="soft" icon="i-heroicons-play" @click="store.replayPending()">从最后检查点续办</UButton>
          </div>
          <div v-for="w in busWaiters" :key="`${w.id}-reasons`" class="block-reasons"><b>{{ w.crew }} 阻断原因</b><ul><li v-for="(reason, i) in store.blockingReasons(w.id)" :key="i">{{ reason }}</li></ul></div>
          <UAlert v-if="!pendingCount && !busWaiters.length" color="green" variant="soft" title="无待续项" description="所有现场确认已落库，边界无候场班组。" />
        </article>
        <article class="panel p-4"><h2>设备状态</h2><div class="device-row"><span class="dot green" /><div><b>WTG-01 ~ WTG-28</b><small>正常运行</small></div><UBadge color="green">28</UBadge></div><div class="device-row"><span class="dot amber" /><div><b>WTG-03、LINE-A2</b><small>检修隔离中</small></div><UBadge color="amber">2</UBadge></div><div class="device-row"><span class="dot red" /><div><b>BOX-12</b><small>待执行许可</small></div><UBadge color="red">1</UBadge></div></article>
      </aside>
    </section>
  </div>
</template>


<style scoped>
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}.metrics{grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.metric{padding:17px}.main-grid{grid-template-columns:minmax(0,1.65fr) minmax(290px,.7fr);gap:16px}.panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.panel h2{font-size:17px;margin:0 0 12px}.panel-head h2{margin:0}.panel-head p{font-size:12px;margin:3px 0}.block,.device-row small{display:block}.side-grid{gap:14px}.device-row,.condition{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5}.device-row{justify-content:flex-start}.device-row div{flex:1}.dot{width:9px;height:9px;border-radius:50%}.dot.green{background:#22c55e}.dot.amber{background:#f59e0b}.dot.red{background:#ef4444}.condition{font-size:14px}.condition span{color:#667085}.window-holder,.window-waiter{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid #edf0f5}.window-holder div,.window-waiter div{flex:1}.window-holder b,.window-waiter b{font-size:14px}.window-holder small,.window-waiter small{display:block;color:#667085;font-size:12px;margin-top:2px}.resume-list{display:grid;gap:8px}.resume-item{display:flex;align-items:center;gap:9px;padding:9px;border:1px dashed #fbbf24;border-radius:7px;background:#fffbeb}.resume-item>div{flex:1}.resume-item b{font-family:monospace;font-size:12px;color:#92400e}.resume-item small{display:block;color:#667085;font-size:11px;margin-top:2px}.block-reasons{margin-top:12px;padding-top:12px;border-top:1px solid #edf0f5}.block-reasons b{font-size:13px;color:#b45309}.block-reasons ul{margin:6px 0 0;padding-left:18px}.block-reasons li{font-size:12px;color:#667085;margin:3px 0}
@media(max-width:1100px){.metrics{grid-template-columns:1fr 1fr}.main-grid{grid-template-columns:1fr}}@media(max-width:620px){.head{flex-direction:column}.metrics{grid-template-columns:1fr}}
</style>

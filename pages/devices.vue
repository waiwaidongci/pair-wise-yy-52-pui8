<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'
import type { FieldMessage } from '~/types'

const store = useOperationsStore()
const selectedDevice = ref('LINE-A2')
const selectedPoints = computed(() => store.permits.flatMap((permit) => permit.isolationPoints).filter((point) => point.device.includes(selectedDevice.value)))
const devices = [
  { id: 'WTG-03', name: '3 号风力发电机组', state: '检修隔离', load: '0 kW', points: 3, crew: '机务二班' },
  { id: 'LINE-A2', name: 'A2 集电线路', state: '待隔离', load: '0.8 MW', points: 3, crew: '线路一班' },
  { id: 'BOX-12', name: '12 号箱式变压器', state: '运行', load: '2.4 MW', points: 1, crew: '电气一班' },
  { id: 'BUS-A', name: 'A 段 35kV 母线', state: '运行', load: '18.6 MW', points: 1, crew: '公用' },
]

// 同一份候选状态：BUS-A 边界窗口
const busHolder = computed(() => store.boundaryHolder('BUS-A'))
const busWaiters = computed(() => store.boundaryWaiters('BUS-A'))
const busWindow = computed(() => store.boundaryWindow('BUS-A'))

// 当前选中设备相关的门禁记录与现场报文
const selectedPermit = computed(() => store.permits.find((p) => p.isolationPoints.some((pt) => pt.device.includes(selectedDevice.value))))
const selectedGate = computed(() => store.gateRecords.find((r) => r.permitId === selectedPermit.value?.id && r.status !== '已释放'))
const selectedMessages = computed(() => store.fieldMessages.filter((m) => m.gateRecordId === selectedGate.value?.id))
const checkpoint = computed(() => selectedGate.value ? store.lastCheckpoint(selectedGate.value.id) : undefined)

const actionDigest: Record<string, string> = {
  '断开': '开关分位 · 验电 0kV', '合上': '开关合位 · 带电显示正常',
  '验电': '验电 0kV · 放电完成', '接地': '接地刀闸合位 · 接地电阻合格',
  '上锁': '机械锁具已挂 · 钥匙已收', '摘锁': '机械锁具已摘 · 设备恢复',
}

function claim() { if (selectedPermit.value) store.claimBoundary(selectedPermit.value.id) }
function confirm(pointId: string, action: FieldMessage['action']) {
  if (!selectedGate.value) return
  store.confirmAction(selectedGate.value.id, pointId, action, actionDigest[action] ?? '', '孙禾')
}
function release() { if (selectedGate.value) store.releaseWindow(selectedGate.value.id, '作业完成，退出条件已满足') }
function signHandover() { if (selectedGate.value) store.signHandover(selectedGate.value.id) }
function registerMaint() {
  const reason = prompt('请输入设备维护原因', '母线检修维护')
  if (reason) store.registerMaintenance('BUS-A', reason)
}
function modifyBoundary() {
  const change = prompt('请输入边界修改内容', 'BUS-A 边界范围调整为进线侧')
  if (change) store.modifyBoundary('BUS-A', change)
}
</script>

<template>
  <div class="page">
    <div class="head"><div><p class="eyebrow">LOCKOUT / TAGOUT</p><h1 class="page-title">设备隔离与锁定点</h1><p class="muted">隔离点、锁具、验电步骤与跨班组占用状态同一份候选状态；现场报文带操作号与读数摘要，断网从检查点续办。</p></div><UButton color="primary" icon="i-heroicons-plus">登记隔离点</UButton></div>
    <div class="device-grid">
      <article v-for="device in devices" :key="device.id" class="panel device" :class="{ active: selectedDevice === device.id }" @click="selectedDevice = device.id"><div class="inline justify-between"><UBadge variant="subtle">{{ device.id }}</UBadge><UBadge :color="device.state === '运行' ? 'green' : device.state === '检修隔离' ? 'red' : 'amber'" variant="subtle">{{ device.state }}</UBadge></div><h2>{{ device.name }}</h2><div class="kv"><span>当前负荷</span><b>{{ device.load }}</b></div><div class="kv"><span>隔离点</span><b>{{ device.points }} 个</b></div><div class="kv"><span>责任班组</span><b>{{ device.crew }}</b></div></article>
    </div>
    <section class="grid lower">
      <article class="panel p-4">
        <h2>{{ selectedDevice }} · 隔离检查单</h2>
        <div v-for="point in selectedPoints" :key="point.id" class="point">
          <div class="lock-icon"><UIcon name="i-heroicons-lock-closed" /></div>
          <div><b>{{ point.label }}</b><small>{{ point.type }} · {{ point.id }}<template v-if="point.boundary"> · 边界 {{ point.boundary }}</template></small></div>
          <UBadge :color="point.state === '已隔离' ? 'green' : point.state === '已恢复' ? 'gray' : 'amber'" variant="subtle">{{ point.state }}</UBadge>
          <UButton size="xs" variant="ghost" icon="i-heroicons-bolt" @click="confirm(point.id, point.type === '接地' ? '接地' : '断开')">现场确认</UButton>
        </div>
        <UAlert v-if="!selectedPoints.length" color="gray" title="该设备暂无隔离点" description="可在许可中新建隔离点并关联设备。" />

        <h3 class="mt-4">现场报文（操作号 · 读数摘要）</h3>
        <div v-if="selectedMessages.length" class="msg-list">
          <div v-for="m in selectedMessages" :key="m.id" class="msg" :class="{ checkpoint: m.checkpoint, pending: m.status === '待重放' }">
            <div class="msg-op"><b>{{ m.operationNo }}</b><UBadge size="xs" :color="m.status === '已确认' ? 'green' : 'amber'" variant="subtle">{{ m.status }}</UBadge></div>
            <div class="msg-body"><span>{{ m.action }} · {{ m.readingDigest }}</span><small>{{ m.credentials.operator }} · {{ new Date(m.credentials.confirmedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }} 确认<template v-if="m.checkpoint"> · 检查点</template></small></div>
          </div>
        </div>
        <UAlert v-else color="gray" variant="soft" title="暂无现场报文" description="点击“现场确认”生成带操作号与读数摘要的报文。" />
      </article>
      <article class="panel p-4">
        <h2>BUS-A 边界窗口</h2>
        <div v-if="busHolder" class="window-holder"><span class="dot green" /><div><b>{{ busHolder.crew }} 独占中</b><small>{{ busHolder.permitId }} · {{ busHolder.window }}</small></div><UBadge color="green" variant="subtle">先到者</UBadge></div>
        <div v-for="w in busWaiters" :key="w.id" class="window-waiter"><span class="dot amber" /><div><b>{{ w.crew }} 候场中</b><small>{{ w.permitId }} · {{ w.window }}</small></div></div>
        <UAlert v-if="!busHolder && !busWaiters.length" color="gray" variant="soft" title="BUS-A 窗口空闲" description="暂无班组抢占该母线边界。" />

        <h3>前组退出条件</h3>
        <div v-if="busHolder" class="cond-list">
          <div v-for="c in busHolder.exitConditions" :key="c.id" class="cond"><UIcon :name="c.satisfied ? 'i-heroicons-check-circle' : 'i-heroicons-clock'" :class="c.satisfied ? 'ok' : 'wait'" /><span :class="{ done: c.satisfied }">{{ c.label }}</span></div>
        </div>
        <UAlert v-else color="gray" variant="soft" title="无独占班组" description="退出条件在窗口被抢占后展示。" />

        <h3>阻断原因（后组可见）</h3>
        <div v-for="w in busWaiters" :key="`${w.id}-br`" class="block-reasons"><b>{{ w.crew }}</b><ul><li v-for="(reason, i) in store.blockingReasons(w.id)" :key="i">{{ reason }}</li></ul></div>
        <UAlert v-if="!busWaiters.length" color="green" variant="soft" title="无候场班组" description="当前无阻断。" />

        <h3>窗口操作</h3>
        <div class="inline wrap mt-2">
          <UButton size="sm" color="primary" variant="soft" icon="i-heroicons-flag" @click="claim">抢占窗口</UButton>
          <UButton size="sm" color="green" variant="soft" icon="i-heroicons-check-badge" @click="release">释放窗口</UButton>
          <UButton size="sm" color="blue" variant="soft" icon="i-heroicons-pencil-square" @click="signHandover">交接签字</UButton>
          <UButton size="sm" color="amber" variant="soft" icon="i-heroicons-wrench-screwdriver" @click="registerMaint">登记维护</UButton>
          <UButton size="sm" color="gray" variant="soft" icon="i-heroicons-scissors" @click="modifyBoundary">修改边界</UButton>
        </div>

        <h3>锁定器具台账</h3>
        <div class="tool"><span>LK-2107</span><b>WTG-03 · 周野</b></div>
        <div class="tool"><span>LK-2118</span><b>LINE-A2 · 待领用</b></div>
        <div class="tool"><span>GND-042</span><b>17 号杆 · 谭勇</b></div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}.device-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}.device{padding:16px;cursor:pointer}.device.active{border-color:#2563eb;box-shadow:0 0 0 2px #dbeafe}.device h2{font-size:16px;margin:14px 0}.kv{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #edf0f5;font-size:13px}.kv span{color:#667085}.lower{grid-template-columns:1.3fr .7fr;gap:16px}.panel h2{font-size:17px;margin:0 0 14px}.panel h3{font-size:14px;margin:18px 0 10px}.point{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #edf0f5}.point>div:nth-child(2){flex:1}.point b,.point small{display:block}.point small{color:#667085;margin-top:4px}.lock-icon{display:grid;place-items:center;width:34px;height:34px;background:#eff6ff;color:#2563eb;border-radius:7px}.msg-list{display:grid;gap:8px}.msg{display:flex;align-items:center;gap:10px;padding:9px;border:1px solid #e2e8f0;border-radius:7px}.msg.checkpoint{border-color:#22c55e;background:#f0fdf4}.msg.pending{border-style:dashed;border-color:#f59e0b;background:#fffbeb}.msg-op{display:flex;flex-direction:column;align-items:flex-start;gap:3px}.msg-op b{font-family:monospace;font-size:12px;color:#334155}.msg-body{flex:1}.msg-body span{display:block;font-size:13px}.msg-body small{display:block;color:#667085;font-size:11px;margin-top:2px}.window-holder,.window-waiter{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid #edf0f5}.window-holder div,.window-waiter div{flex:1}.window-holder b,.window-waiter b{font-size:14px}.window-holder small,.window-waiter small{display:block;color:#667085;font-size:12px;margin-top:2px}.dot{width:9px;height:9px;border-radius:50%}.dot.green{background:#22c55e}.dot.amber{background:#f59e0b}.cond-list{display:grid;gap:7px}.cond{display:flex;align-items:center;gap:8px;font-size:13px}.cond .ok{color:#16a34a}.cond .wait{color:#d97706}.cond .done{text-decoration:line-through;color:#94a3b8}.block-reasons{margin-top:8px}.block-reasons b{font-size:13px;color:#b45309}.block-reasons ul{margin:4px 0 0;padding-left:18px}.block-reasons li{font-size:12px;color:#667085;margin:3px 0}.tool{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #edf0f5}.tool span{color:#2563eb;font-family:monospace}.tool b{font-size:13px}
@media(max-width:1050px){.device-grid{grid-template-columns:1fr 1fr}.lower{grid-template-columns:1fr}}@media(max-width:600px){.head{flex-direction:column;gap:12px}.device-grid{grid-template-columns:1fr}}
</style>

<script setup lang="ts">
import { useOperationsStore } from '~/stores/operations'
import type { Permit } from '~/types'

const store = useOperationsStore()
const route = useRoute()
const selectedId = ref(String(route.query.id || store.permits[0]?.id))
const modal = ref(route.query.new === '1')
const boundaries = [
  { id: 'BUS-A', name: 'A 段 35kV 母线边界' },
  { id: 'WTG-03', name: '3 号风机塔基边界' },
  { id: 'BOX-12', name: '12 号箱变高压侧边界' },
]
const form = reactive({
  title: '',
  device: '',
  boundaryId: 'BUS-A',
  crew: '电气二班',
  owner: '赵清',
  window: '09-29 20:00 — 24:00',
  risk: '二级' as Permit['risk'],
})
const selected = computed(() => store.permits.find((item) => item.id === selectedId.value) ?? store.permits[0])
const gate = computed(() => store.gateByPermit(selected.value?.id))
const party = computed(() => gate.value?.holder?.permitId === selected.value?.id
  ? gate.value.holder
  : gate.value?.queue.find((item) => item.permitId === selected.value?.id)
    ?? gate.value?.history.find((item) => item.permitId === selected.value?.id))
const completed = computed(() => selected.value ? Math.round(selected.value.steps.filter((step) => step.done).length / selected.value.steps.length * 100) : 0)
const statusIndex = computed(() => ['待复核', '待执行', '执行中', '待结束', '待关闭', '已完成'].indexOf(selected.value?.status ?? ''))

function createPermit() {
  if (!form.title.trim() || !form.device.trim()) return
  const boundary = boundaries.find((item) => item.id === form.boundaryId) ?? boundaries[0]!
  const permit: Permit = {
    id: `WP-0929-${String(store.permits.length + 31).padStart(3, '0')}`,
    ...form,
    boundaryName: boundary.name,
    status: '待复核',
    revision: 1,
    reviewRequired: false,
    isolationPoints: [
      { id: `IP-${Date.now().toString().slice(-4)}`, device: form.boundaryId, label: boundary.name === 'A 段 35kV 母线边界' ? '母线侧隔离刀闸复核点' : '主隔离点', type: '开关', state: '待操作' },
    ],
    steps: [
      { id: `ST-${Date.now().toString().slice(-4)}-1`, text: '核对设备双重编号、许可与门禁边界', done: false, owner: form.owner },
      { id: `ST-${Date.now().toString().slice(-4)}-2`, text: '确认独占窗口、完成隔离锁定和班组交接', done: false, owner: form.owner },
    ],
  }
  store.addPermit(permit)
  selectedId.value = permit.id
  modal.value = false
}
</script>

<template>
  <div class="page">
    <div class="head"><div><p class="eyebrow">许可全生命周期</p><h1 class="page-title">作业许可证与门禁挂接</h1><p class="muted">许可、隔离点和班组交接不再分离：提交许可即按边界读取同一候选状态并参与独占窗口排队。</p></div><UButton icon="i-heroicons-plus" color="primary" @click="modal = true">新建许可</UButton></div>
    <div class="permit-layout">
      <aside class="panel permit-list">
        <button v-for="permit in store.permits" :key="permit.id" :class="{ active: permit.id === selectedId }" @click="selectedId = permit.id"><span><b>{{ permit.id }}</b><small>{{ permit.title }}</small></span><UBadge :color="permit.status === '已撤回' ? 'gray' : permit.reviewRequired ? 'red' : 'amber'" variant="subtle">{{ permit.status === '已撤回' ? '已撤回' : permit.reviewRequired ? '候场阻断' : permit.status }}</UBadge></button>
      </aside>
      <section v-if="selected" class="grid detail-grid">
        <article class="panel p-4">
          <div class="detail-head"><div><small class="muted">{{ selected.id }} · 修订 r{{ selected.revision }}</small><h2>{{ selected.title }}</h2><p>{{ selected.device }} · {{ selected.window }}</p></div><UBadge size="lg" :color="selected.status === '已撤回' ? 'gray' : selected.reviewRequired ? 'red' : 'green'" variant="subtle">{{ selected.status }}</UBadge></div>
          <div class="flow"><div v-for="(step,index) in ['申请','复核','执行','结束','关闭']" :key="step" :class="{ done: index <= statusIndex, current: index === statusIndex }"><i>{{ index + 1 }}</i><span>{{ step }}</span></div></div>
          <UAlert v-if="selected.status === '已撤回'" color="gray" variant="soft" title="许可已撤回" description="该许可的独占或候场窗口已经立即释放，候场队列和交接条件已重新计算。" />
          <UAlert v-else-if="party?.blockingReasons.length" color="red" variant="soft" title="门禁候选存在阻断" :description="party.blockingReasons.join('；')" />
          <h3>操作步骤</h3>
          <div v-for="step in selected.steps" :key="step.id" class="step"><UCheckbox :model-value="step.done" @update:model-value="store.toggleStep(selected.id, step.id)" /><div><b :class="{ completed: step.done }">{{ step.text }}</b><small>责任人 {{ step.owner }} · {{ step.evidence || '尚未上传证据' }}</small></div><UButton size="xs" variant="ghost" icon="i-heroicons-camera">证据</UButton></div>
          <UProgress :value="completed" class="mt-4" /><div class="inline justify-between mt-1"><span class="muted">步骤完成度</span><b>{{ completed }}%</b></div>
        </article>
        <aside class="grid right">
          <article class="panel p-4">
            <h3>同一份门禁记录</h3>
            <template v-if="gate">
              <div class="kv"><span>边界</span><b>{{ gate.boundaryName }}</b></div>
              <div class="kv"><span>候选状态</span><b>{{ gate.status }} r{{ gate.revision }}</b></div>
              <div class="kv"><span>班组凭据</span><b>{{ party?.credentialId ?? '未取得' }}</b></div>
              <div class="kv"><span>隔离点</span><b>{{ party?.pointIds.length ?? 0 }} 个</b></div>
              <div class="kv"><span>候场队列</span><b>{{ gate.queue.length }} 组</b></div>
              <UButton block class="mt-2" size="sm" variant="outline" @click="navigateTo(`/devices?gate=${gate.id}`)">打开隔离页</UButton>
            </template>
            <UAlert v-else color="gray" title="尚未挂接门禁" description="提交或重新申请后会自动加入边界候选。" />
          </article>
          <article class="panel p-4"><h3>流程操作</h3><p class="muted">许可撤回、设备维护或边界修改会让窗口立即释放并重算候场。</p><UButton block color="primary" icon="i-heroicons-arrow-right-circle" :disabled="selected.status === '已撤回'" @click="store.advancePermit(selected.id)">推进到下一状态</UButton><UButton block class="mt-2" color="red" variant="soft" icon="i-heroicons-no-symbol" :disabled="selected.status === '已撤回' || !gate" @click="store.withdrawPermit(selected.id)">撤回许可并释放窗口</UButton><UButton block class="mt-2" color="gray" variant="outline" icon="i-heroicons-arrow-uturn-left">退回补件</UButton></article>
        </aside>
      </section>
    </div>
    <UModal v-model="modal"><article class="p-5"><h2>申请作业许可</h2><p class="muted">提交时自动挂接边界门禁；同一边界按到场先到先得，后到班组进入候场。</p><div class="form-grid"><UFormGroup label="作业名称"><UInput v-model="form.title" /></UFormGroup><UFormGroup label="设备编号"><UInput v-model="form.device" /></UFormGroup><UFormGroup label="门禁边界"><USelect v-model="form.boundaryId" :options="boundaries.map(item => ({ label: item.name, value: item.id }))" value-attribute="value" /></UFormGroup><UFormGroup label="班组"><UInput v-model="form.crew" /></UFormGroup><UFormGroup label="负责人"><UInput v-model="form.owner" /></UFormGroup><UFormGroup label="计划窗口"><UInput v-model="form.window" /></UFormGroup><UFormGroup label="风险等级"><USelect v-model="form.risk" :options="['一级','二级','三级']" /></UFormGroup></div><div class="inline justify-end mt-4"><UButton color="gray" @click="modal = false">取消</UButton><UButton color="primary" :disabled="!form.title || !form.device" @click="createPermit">提交并入门禁候选</UButton></div></article></UModal>
  </div>
</template>

<style scoped>
.head{display:flex;justify-content:space-between;gap:16px;margin-bottom:18px}.head h1{margin:3px 0 7px}.head p{margin:0}.eyebrow{font-size:12px;color:#2563eb;font-weight:700}.permit-layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px}.permit-list{padding:8px;height:fit-content}.permit-list button{width:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:13px 11px;border:0;background:transparent;border-radius:7px;text-align:left;color:inherit;cursor:pointer}.permit-list button:hover,.permit-list button.active{background:#eff6ff}.permit-list b,.permit-list small{display:block}.permit-list small{color:#667085;margin-top:4px;font-size:12px}.detail-grid{grid-template-columns:minmax(0,1.5fr) minmax(280px,.65fr);gap:16px}.right{height:fit-content;gap:14px}.detail-head{display:flex;justify-content:space-between;gap:10px;margin-bottom:16px}.detail-head h2{margin:4px 0}.detail-head p{margin:0;color:#667085}.flow{display:grid;grid-template-columns:repeat(5,1fr);margin:20px 0}.flow>div{position:relative;text-align:center;color:#94a3b8}.flow>div:after{content:"";position:absolute;left:55%;right:-45%;top:13px;height:2px;background:#e2e8f0}.flow>div:last-child:after{display:none}.flow i{position:relative;z-index:1;display:grid;place-items:center;width:28px;height:28px;margin:auto;border-radius:50%;background:#e2e8f0;font-style:normal;font-size:12px}.flow span{display:block;font-size:12px;margin-top:5px}.flow .done{color:#2563eb}.flow .done i{background:#2563eb;color:#fff}.flow .done:after{background:#2563eb}.panel h3{font-size:15px;margin:18px 0 10px}.step{display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5}.step div{flex:1}.step small{display:block;color:#667085;margin-top:4px}.step .completed{text-decoration:line-through;color:#667085}.kv{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #edf0f5;font-size:13px}.kv span{color:#667085}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.mt-2{margin-top:8px}
@media(max-width:980px){.permit-layout{grid-template-columns:1fr}.permit-list{display:flex;overflow:auto}.permit-list button{min-width:230px}.detail-grid{grid-template-columns:1fr}}@media(max-width:620px){.head{flex-direction:column}.form-grid{grid-template-columns:1fr}}
</style>

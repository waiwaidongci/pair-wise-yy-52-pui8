export type PermitStatus = '待复核' | '待执行' | '执行中' | '待结束' | '待关闭' | '已完成' | '已撤回'

export interface IsolationPoint {
  id: string
  device: string
  label: string
  type: '开关' | '刀闸' | '阀门' | '接地'
  state: '已隔离' | '待操作' | '已恢复'
}

export interface Permit {
  id: string
  title: string
  device: string
  boundaryId: string
  boundaryName: string
  crew: string
  owner: string
  window: string
  status: PermitStatus
  risk: '一级' | '二级' | '三级'
  isolationPoints: IsolationPoint[]
  steps: { id: string; text: string; done: boolean; owner: string; evidence?: string }[]
  revision: number
  reviewRequired: boolean
}

export type MechanicalActionState = '已确认' | '待确认' | '确认失败'
export type FieldReportStatus = '已确认' | '失败'
export type GateStatus = '独占中' | '候场中' | '待续办' | '已释放'

export interface MechanicalAction {
  id: string
  order: number
  label: string
  state: MechanicalActionState
  confirmedAt?: string
  operationNo?: string
  error?: string
}

export interface FieldReport {
  id: string
  actionId: string
  operationNo: string
  credentialId: string
  createdAt: string
  replayedAt?: string
  status: FieldReportStatus
  readingSummary: string
}

export interface GateParty {
  id: string
  permitId: string
  permitTitle: string
  crew: string
  owner: string
  credentialId: string
  requestedAt: string
  ready: boolean
  acquiredAt?: string
  pointIds: string[]
  boundaryRevision: number
  blockingReasons: string[]
  actions: MechanicalAction[]
  reports: FieldReport[]
  lastConfirmedActionId?: string
  resumeStatus?: GateStatus
}

export interface Handoff {
  id: string
  at: string
  fromPermitId: string
  fromCrew: string
  toPermitId?: string
  toCrew?: string
  operationNo?: string
  status: '候场待退' | '已交接' | '许可撤回' | '维护释放' | '边界作废'
  conditions: string[]
  note?: string
}

export interface AccessGateRecord {
  id: string
  boundaryId: string
  boundaryName: string
  status: GateStatus
  holder?: GateParty
  queue: GateParty[]
  history: GateParty[]
  handoffs: Handoff[]
  exitConditions: string[]
  revision: number
  maintenance: boolean
  releaseReason?: string
  updatedAt: string
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
}

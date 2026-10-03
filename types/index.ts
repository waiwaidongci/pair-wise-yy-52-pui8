export type PermitStatus = '待复核' | '待执行' | '执行中' | '待结束' | '待关闭' | '已完成' | '已撤回'

export interface IsolationPoint {
  id: string
  device: string
  label: string
  type: '开关' | '刀闸' | '阀门' | '接地'
  state: '已隔离' | '待操作' | '已恢复'
  /** 共用母线边界，如 BUS-A；涉及边界的点才参与窗口抢占 */
  boundary?: string
}

export interface Permit {
  id: string
  title: string
  device: string
  crew: string
  owner: string
  window: string
  status: PermitStatus
  risk: '一级' | '二级' | '三级'
  isolationPoints: IsolationPoint[]
  steps: Step[]
  revision: number
  reviewRequired: boolean
  withdrawn?: boolean
}

export interface Step {
  id: string
  text: string
  done: boolean
  owner: string
  evidence?: string
}

/** 退出条件：前组释放边界窗口前必须满足的条件，后组候场时可见 */
export interface ExitCondition {
  id: string
  label: string
  satisfied: boolean
}

/** 班组交接：绑定在同一份门禁记录上 */
export interface Handover {
  from: string
  to: string
  signed: boolean
  signedAt?: number
}

/**
 * 门禁记录：把作业许可、隔离点、班组交接绑成同一份记录。
 * 一个涉及共用边界的许可对应一份门禁记录。
 */
export interface GateRecord {
  id: string
  permitId: string
  crew: string
  boundary: string
  isolationPointIds: string[]
  window: string
  status: '待生效' | '独占中' | '候场中' | '已释放'
  /** 抢占时间戳，先到者得窗口 */
  claimedAt: number
  exitConditions: ExitCondition[]
  handover: Handover
}

/**
 * 现场报文：带操作号与设备读数摘要。
 * 操作号稳定，断网重放沿用最初凭据（operator + confirmedAt），不重新生成。
 */
export interface FieldMessage {
  id: string
  /** 操作号，重放不变，幂等键 */
  operationNo: string
  gateRecordId: string
  permitId: string
  pointId: string
  action: '断开' | '合上' | '验电' | '接地' | '上锁' | '摘锁'
  /** 设备读数摘要，如 "A2 进线 0kV · 电流 0A · 开关分位" */
  readingDigest: string
  /** 最初凭据，重放沿用，不改写 */
  credentials: { operator: string; confirmedAt: number }
  status: '待确认' | '已确认' | '待重放'
  /** 是否为最后确认的机械动作（续办检查点） */
  checkpoint?: boolean
}

/** 边界窗口：派生自门禁记录，holder 为先到者，waitlist 按抢占时间排序 */
export interface BoundaryWindow {
  boundary: string
  holderGateId?: string
  waitlist: { gateRecordId: string; claimedAt: number }[]
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
}

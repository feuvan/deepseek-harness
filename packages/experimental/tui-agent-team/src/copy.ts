/**
 * English and Chinese copy for the read-only terminal Agent Teams panel. The
 * locale is chosen once from the terminal contribution seam at plugin activation.
 *
 * @module @deepseek-ai/dsh-experimental-tui-agent-team/copy
 */

/** English dictionary; its keys define the copy contract. */
const english = {
  moreRows: (count: number): string => `${String(count)} more ${count === 1 ? 'row' : 'rows'}`,
  team: {
    title: 'Agent Team',
    membersTab: 'Members',
    tasksTab: 'Shared tasks',
    failure: (message: string): string => `Invalid persisted Team record: ${message}`,
    hint: 'Tab/←/→ section · ↑/↓ move · Enter open · Esc close',
    current: 'Current chat',
    model: 'Model',
    memberStatuses: {
      running: 'Running',
      inactive: 'Inactive',
      provisioning: 'Provisioning',
      failed: 'Failed',
    },
    statuses: {
      pending: 'Pending',
      inProgress: 'In progress',
      completed: 'Completed',
    },
    readyLabel: 'Ready',
    blockedLabel: 'Blocked',
    owner: 'Owner',
    unowned: 'Unowned',
    blockedBy: 'Blocked by',
    writeScopes: 'Write scopes',
    emptyTasks: 'No shared tasks yet. Create them through the conversation.',
    taskDetailStatus: 'Status',
    taskDetailId: 'Task',
    detailHint: '↑/↓ scroll · Esc back',
    teammates: (count: number): string => `${String(count)} teammate(s)`,
    running: (count: number): string => `${String(count)} running`,
    tasks: (count: number): string => `${String(count)} task(s)`,
    ready: (count: number): string => `${String(count)} ready`,
    blocked: (count: number): string => `${String(count)} blocked`,
    inProgress: (count: number): string => `${String(count)} in progress`,
    completed: (count: number): string => `${String(count)} completed`,
    unavailable: 'Agent Teams is not composed in this profile. Enable dsh-experimental-agent-team-profile under /config → Experimental capabilities, then restart the terminal.',
    historyUnavailable: 'Teammate history is unavailable in this composition.',
    actionFailed: (message: string): string => `Team action failed: ${message}`,
    memberTitle: (name: string): string => `Teammate ${name}`,
    memberUser: (text: string): string => `› ${text}`,
    memberAssistant: (text: string): string => `  ${text}`,
    memberTool: (name: string): string => `  ⚙ ${name}`,
    memberTurnEnd: (reason: string): string => `  · ${reason}`,
    memberEmpty: 'No recorded events yet.',
    memberHint: '↑/↓ scroll · Esc back to the Agent Team panel',
  },
} as const

type Widen<T> = {
  readonly [K in keyof T]: T[K] extends string ? string
    : T[K] extends readonly unknown[] ? T[K]
      : T[K] extends (...args: infer A) => infer R ? (...args: A) => R
        : T[K] extends object ? Widen<T[K]> : T[K]
}

/** The active dictionary shape. */
export type Copy = Widen<typeof english>

/** Chinese dictionary checked against the English key set. */
const chinese: Copy = {
  moreRows: count => `另外 ${String(count)} 行`,
  team: {
    title: '智能体团队',
    membersTab: '成员',
    tasksTab: '共享任务',
    failure: message => `团队持久记录无效：${message}`,
    hint: 'Tab/←/→ 切换 · ↑/↓ 移动 · Enter 打开 · Esc 关闭',
    current: '当前会话',
    model: '模型',
    memberStatuses: {
      running: '运行中',
      inactive: '未运行',
      provisioning: '准备中',
      failed: '失败',
    },
    statuses: {
      pending: '待处理',
      inProgress: '进行中',
      completed: '已完成',
    },
    readyLabel: '可开始',
    blockedLabel: '被依赖阻塞',
    owner: 'Owner',
    unowned: '未分配',
    blockedBy: '依赖',
    writeScopes: '写入范围',
    emptyTasks: '暂无共享任务，可以通过对话创建',
    taskDetailStatus: '状态',
    taskDetailId: '任务',
    detailHint: '↑/↓ 滚动 · Esc 返回',
    teammates: count => `${String(count)} 名成员`,
    running: count => `${String(count)} 运行中`,
    tasks: count => `${String(count)} 个任务`,
    ready: count => `${String(count)} 可开始`,
    blocked: count => `${String(count)} 阻塞`,
    inProgress: count => `${String(count)} 进行中`,
    completed: count => `${String(count)} 已完成`,
    unavailable: '当前 profile 没有组装 Agent Teams。请在 /config → 实验性能力中启用 dsh-experimental-agent-team-profile，然后重启终端。',
    historyUnavailable: '当前组合无法读取 teammate 历史。',
    actionFailed: message => `Team 操作失败：${message}`,
    memberTitle: name => `Teammate ${name}`,
    memberUser: text => `› ${text}`,
    memberAssistant: text => `  ${text}`,
    memberTool: name => `  ⚙ ${name}`,
    memberTurnEnd: reason => `  · ${reason}`,
    memberEmpty: '还没有记录事件。',
    memberHint: '↑/↓ 滚动 · Esc 返回 Agent Teams 面板',
  },
}

/** Active dictionary, switched once at plugin activation. */
export let copy: Copy = english

/**
 * Select the dictionary for this terminal launch.
 * @param locale - resolved interface locale.
 */
export function setCopyLocale(locale: 'en' | 'zh'): void {
  copy = locale === 'zh' ? chinese : english
}

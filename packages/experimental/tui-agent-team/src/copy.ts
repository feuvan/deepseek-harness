/**
 * English and Chinese copy for the terminal Agent Teams surface. The locale is
 * chosen once from the terminal contribution seam at plugin activation.
 *
 * @module @deepseek-ai/dsh-experimental-tui-agent-team/copy
 */

const english = {
  moreRows: (count: number): string => `${String(count)} more ${count === 1 ? 'row' : 'rows'}`,
  team: {
    title: 'Agent Team',
    membersTab: 'Members',
    tasksTab: 'Tasks',
    hint: 'Tab/←/→ switch · ↑/↓ move · Enter open · m message · a claim · c complete · n new task · Esc close',
    memberHint: '↑/↓ scroll · Esc back to the Team panel',
    memberTitle: (name: string): string => `Teammate ${name}`,
    memberUser: (text: string): string => `› ${text}`,
    memberAssistant: (text: string): string => `  ${text}`,
    memberTool: (name: string): string => `  ⚙ ${name}`,
    memberTurnEnd: (reason: string): string => `  · ${reason}`,
    memberEmpty: 'No recorded events yet.',
    unavailable: 'Agent Teams is not composed in this profile. Enable dsh-experimental-agent-team-profile under /config → Experimental capabilities, then restart the terminal.',
    failure: 'team record rejected',
    emptyMembers: 'No teammates yet.',
    emptyTasks: 'No shared tasks yet.',
    lead: 'lead',
    teammate: 'teammate',
    phases: { provisioning: 'provisioning', active: 'active', failed: 'failed' },
    statuses: { ready: 'ready', blocked: 'blocked', inProgress: 'in progress', completed: 'done' },
    teammates: (count: number): string => `${String(count)} teammate(s)`,
    running: (count: number): string => `${String(count)} running`,
    tasks: (count: number): string => `tasks ${String(count)}`,
    ready: (count: number): string => `${String(count)} ready`,
    blocked: (count: number): string => `${String(count)} blocked`,
    inProgress: (count: number): string => `${String(count)} in progress`,
    completed: (count: number): string => `${String(count)} done`,
    usage: 'Usage: /team [task <subject> | message <member> <text>]',
    taskCreated: (id: string): string => `Created shared task ${id}`,
    taskClaimed: (id: string): string => `Claimed task ${id}`,
    taskCompleted: (id: string): string => `Completed task ${id}`,
    messageSent: (name: string): string => `Message sent to ${name}`,
    historyUnavailable: 'Teammate history is unavailable in this composition.',
    actionFailed: (message: string): string => `Team action failed: ${message}`,
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

const chinese: Copy = {
  moreRows: count => `另外 ${String(count)} 行`,
  team: {
    title: 'Agent Team',
    membersTab: '成员',
    tasksTab: '任务',
    hint: 'Tab/←/→ 切换 · ↑/↓ 移动 · Enter 打开 · m 消息 · a 认领 · c 完成 · n 新建任务 · Esc 关闭',
    memberHint: '↑/↓ 滚动 · Esc 返回 Team 面板',
    memberTitle: name => `Teammate ${name}`,
    memberUser: text => `› ${text}`,
    memberAssistant: text => `  ${text}`,
    memberTool: name => `  ⚙ ${name}`,
    memberTurnEnd: reason => `  · ${reason}`,
    memberEmpty: '还没有记录事件。',
    unavailable: '当前 profile 没有组装 Agent Teams。请在 /config → 实验性能力中启用 dsh-experimental-agent-team-profile，然后重启终端。',
    failure: 'team 记录被拒绝',
    emptyMembers: '还没有 teammate。',
    emptyTasks: '还没有共享任务。',
    lead: 'lead',
    teammate: 'teammate',
    phases: { provisioning: '准备中', active: '活动中', failed: '失败' },
    statuses: { ready: '就绪', blocked: '被阻塞', inProgress: '进行中', completed: '完成' },
    teammates: count => `${String(count)} 名 teammate`,
    running: count => `${String(count)} 运行中`,
    tasks: count => `任务 ${String(count)}`,
    ready: count => `${String(count)} 就绪`,
    blocked: count => `${String(count)} 阻塞`,
    inProgress: count => `${String(count)} 进行中`,
    completed: count => `${String(count)} 完成`,
    usage: '用法：/team [task <subject> | message <member> <text>]',
    taskCreated: id => `已创建共享任务 ${id}`,
    taskClaimed: id => `已认领任务 ${id}`,
    taskCompleted: id => `已完成任务 ${id}`,
    messageSent: name => `已向 ${name} 发送消息`,
    historyUnavailable: '当前组合无法读取 teammate 历史。',
    actionFailed: message => `Team 操作失败：${message}`,
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

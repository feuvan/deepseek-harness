import { afterEach, describe, expect, it } from 'vitest'
import { copy, setCopyLocale } from '../src/copy.ts'

afterEach(() => {
  setCopyLocale('en')
})

/** Collect every leaf path and leaf type of one copy tree. */
function leaves(value: Record<string, unknown>, prefix = ''): [path: string, type: string][] {
  const out: [string, string][] = []
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof entry === 'object' && entry !== null) out.push(...leaves(entry as Record<string, unknown>, path))
    else out.push([path, typeof entry])
  }
  return out
}

describe('moreRows', () => {
  it('pluralizes one row and many rows in English', () => {
    expect(copy.moreRows(1)).toBe('1 more row')
    expect(copy.moreRows(3)).toBe('3 more rows')
  })

  it('localizes the row indicator', () => {
    setCopyLocale('zh')
    expect(copy.moreRows(2)).toBe('另外 2 行')
  })
})

describe('team copy', () => {
  it('formats the English native labels, statuses, and notices', () => {
    expect(copy.team.title).toBe('Agent Team')
    expect(copy.team.membersTab).toBe('Members')
    expect(copy.team.tasksTab).toBe('Shared tasks')
    expect(copy.team.failure('rejected')).toBe('Invalid persisted Team record: rejected')
    expect(copy.team.hint).toBe('Tab/←/→ section · ↑/↓ move · Enter open · Esc close')
    expect(copy.team.current).toBe('Current chat')
    expect(copy.team.model).toBe('Model')
    expect(copy.team.memberStatuses).toEqual({
      running: 'Running',
      inactive: 'Inactive',
      provisioning: 'Provisioning',
      failed: 'Failed',
    })
    expect(copy.team.statuses).toEqual({ pending: 'Pending', inProgress: 'In progress', completed: 'Completed' })
    expect(copy.team.readyLabel).toBe('Ready')
    expect(copy.team.blockedLabel).toBe('Blocked')
    expect(copy.team.owner).toBe('Owner')
    expect(copy.team.unowned).toBe('Unowned')
    expect(copy.team.blockedBy).toBe('Blocked by')
    expect(copy.team.writeScopes).toBe('Write scopes')
    expect(copy.team.emptyTasks).toBe('No shared tasks yet. Create them through the conversation.')
    expect(copy.team.taskDetailStatus).toBe('Status')
    expect(copy.team.taskDetailId).toBe('Task')
    expect(copy.team.detailHint).toBe('↑/↓ scroll · Esc back')
    expect(copy.team.teammates(2)).toBe('2 teammate(s)')
    expect(copy.team.running(1)).toBe('1 running')
    expect(copy.team.tasks(3)).toBe('3 task(s)')
    expect(copy.team.ready(1)).toBe('1 ready')
    expect(copy.team.blocked(1)).toBe('1 blocked')
    expect(copy.team.inProgress(1)).toBe('1 in progress')
    expect(copy.team.completed(1)).toBe('1 completed')
    expect(copy.team.unavailable).toContain('dsh-experimental-agent-team-profile')
    expect(copy.team.historyUnavailable).toBe('Teammate history is unavailable in this composition.')
    expect(copy.team.actionFailed('nope')).toBe('Team action failed: nope')
    expect(copy.team.memberTitle('Worker')).toBe('Teammate Worker')
    expect(copy.team.memberUser('hi')).toBe('› hi')
    expect(copy.team.memberAssistant('ok')).toBe('  ok')
    expect(copy.team.memberTool('bash')).toBe('  ⚙ bash')
    expect(copy.team.memberTurnEnd('blocked')).toBe('  · blocked')
    expect(copy.team.memberEmpty).toBe('No recorded events yet.')
    expect(copy.team.memberHint).toBe('↑/↓ scroll · Esc back to the Agent Team panel')
  })

  it('formats the Chinese native labels and notices', () => {
    setCopyLocale('zh')
    expect(copy.team.title).toBe('智能体团队')
    expect(copy.team.membersTab).toBe('成员')
    expect(copy.team.tasksTab).toBe('共享任务')
    expect(copy.team.failure('x')).toBe('团队持久记录无效：x')
    expect(copy.team.hint).toBe('Tab/←/→ 切换 · ↑/↓ 移动 · Enter 打开 · Esc 关闭')
    expect(copy.team.current).toBe('当前会话')
    expect(copy.team.model).toBe('模型')
    expect(copy.team.memberStatuses).toEqual({
      running: '运行中',
      inactive: '未运行',
      provisioning: '准备中',
      failed: '失败',
    })
    expect(copy.team.statuses).toEqual({ pending: '待处理', inProgress: '进行中', completed: '已完成' })
    expect(copy.team.readyLabel).toBe('可开始')
    expect(copy.team.blockedLabel).toBe('被依赖阻塞')
    expect(copy.team.owner).toBe('Owner')
    expect(copy.team.unowned).toBe('未分配')
    expect(copy.team.blockedBy).toBe('依赖')
    expect(copy.team.writeScopes).toBe('写入范围')
    expect(copy.team.emptyTasks).toBe('暂无共享任务，可以通过对话创建')
    expect(copy.team.taskDetailStatus).toBe('状态')
    expect(copy.team.taskDetailId).toBe('任务')
    expect(copy.team.detailHint).toBe('↑/↓ 滚动 · Esc 返回')
    expect(copy.team.teammates(2)).toBe('2 名成员')
    expect(copy.team.running(1)).toBe('1 运行中')
    expect(copy.team.tasks(3)).toBe('3 个任务')
    expect(copy.team.ready(1)).toBe('1 可开始')
    expect(copy.team.blocked(1)).toBe('1 阻塞')
    expect(copy.team.inProgress(1)).toBe('1 进行中')
    expect(copy.team.completed(1)).toBe('1 已完成')
    expect(copy.team.historyUnavailable).toBe('当前组合无法读取 teammate 历史。')
    expect(copy.team.actionFailed('nope')).toBe('Team 操作失败：nope')
    expect(copy.team.memberTitle('Worker')).toBe('Teammate Worker')
    expect(copy.team.memberUser('hi')).toBe('› hi')
    expect(copy.team.memberAssistant('ok')).toBe('  ok')
    expect(copy.team.memberTool('bash')).toBe('  ⚙ bash')
    expect(copy.team.memberTurnEnd('blocked')).toBe('  · blocked')
    expect(copy.team.memberEmpty).toBe('还没有记录事件。')
    expect(copy.team.memberHint).toBe('↑/↓ 滚动 · Esc 返回 Agent Teams 面板')
  })

  it('keeps identical key paths and leaf types across locales', () => {
    const english = leaves(copy).sort(([a], [b]) => a.localeCompare(b))
    setCopyLocale('zh')
    const chinese = leaves(copy).sort(([a], [b]) => a.localeCompare(b))
    expect(chinese).toEqual(english)
  })
})

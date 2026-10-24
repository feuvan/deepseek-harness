import { afterEach, describe, expect, it } from 'vitest'
import { PendingStrip } from '../../src/components/pending.ts'
import type { FooterSnapshot } from '../../src/components/footer.ts'
import { chinese, copy, english, setCopyLocale } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'
import { visibleLines } from '../support/terminal.ts'

/** @returns whether a value is a nested copy group. */
function isCopyGroup(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Collect every non-formatter string in the copy tree with its dotted path. */
function leafStrings(value: Record<string, unknown>, prefix = ''): [path: string, text: string][] {
  const leaves: [string, string][] = []
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof entry === 'string') leaves.push([path, entry])
    else if (isCopyGroup(entry)) leaves.push(...leafStrings(entry, path))
  }
  return leaves
}

/** One copy formatter found in the tree. */
type Formatter = (...args: never[]) => unknown

/**
 * Collect every formatter in the copy tree with its dotted path.
 * @param value - copy subtree.
 * @param prefix - dotted path prefix.
 * @returns formatter paths and functions.
 */
function leafFunctions(value: Record<string, unknown>, prefix = ''): [path: string, format: Formatter][] {
  const functions: [string, Formatter][] = []
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof entry === 'function') functions.push([path, entry as Formatter])
    else if (isCopyGroup(entry)) functions.push(...leafFunctions(entry, path))
  }
  return functions
}

/**
 * Collect every leaf path of the copy tree with its host type.
 * @param value - copy subtree.
 * @param prefix - dotted path prefix.
 * @returns leaf paths and typeof values.
 */
function leafTypes(value: Record<string, unknown>, prefix = ''): [path: string, type: string][] {
  const leaves: [string, string][] = []
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (isCopyGroup(entry)) leaves.push(...leafTypes(entry, path))
    else leaves.push([path, typeof entry])
  }
  return leaves
}

/** @returns one complete footer snapshot for the strip renders. */
function snapshot(overrides: Partial<FooterSnapshot> = {}): FooterSnapshot {
  return {
    cwd: '/work/repo',
    title: undefined,
    model: 'alpha/m-1',
    effort: 'high',
    effortImplicit: false,
    reasoning: copy.reasoning.label('standard'),
    inputTokens: 0,
    outputTokens: 0,
    cacheRate: undefined,
    contextPercent: undefined,
    permission: 'workspace-write',
    status: copy.status.running,
    elapsedSeconds: undefined,
    pendingSteering: 1,
    pendingQueued: 2,
    ...overrides,
  }
}

afterEach(() => {
  setCopyLocale('en')
})

describe('copy dictionaries', () => {
  it('defines every user-visible string as non-empty text', () => {
    for (const dictionary of [english, chinese]) {
      const leaves = leafStrings(dictionary)
      expect(leaves.length).toBeGreaterThan(0)
      for (const [path, text] of leaves) expect(text.trim(), path).not.toBe('')
    }
  })

  it('keeps identical key paths and leaf types across locales', () => {
    expect(leafTypes(chinese).sort(([left], [right]) => left.localeCompare(right)))
      .toEqual(leafTypes(english).sort(([left], [right]) => left.localeCompare(right)))
  })

  it('defines formatters with the same paths in both locales', () => {
    const paths = (dictionary: Record<string, unknown>): string[] =>
      leafFunctions(dictionary).map(([path]) => path).sort((left, right) => left.localeCompare(right))
    expect(paths(chinese)).toEqual(paths(english))
  })

  it.each([
    ['English', () => english],
    ['Chinese', () => chinese],
  ] as const)('returns strings from every %s formatter', (_label, dictionary) => {
    const functions = leafFunctions(dictionary())
    expect(functions.length).toBeGreaterThan(0)
    for (const [path, format] of functions) expect(typeof format(), path).toBe('string')
  })

  it('formats the Agent Team labels, phases, statuses, and strip segments', () => {
    expect(copy.team.title).toBe('Agent Team')
    expect(copy.team.membersTab).toBe('Members')
    expect(copy.team.tasksTab).toBe('Tasks')
    expect(copy.team.hint).toContain('Tab/←/→ switch')
    expect(copy.team.unavailable).toContain('dsh-experimental-agent-team-profile')
    expect(copy.team.failure).toBe('team record rejected')
    expect(copy.team.emptyMembers).toBe('No teammates yet.')
    expect(copy.team.emptyTasks).toBe('No shared tasks yet.')
    expect(copy.team.lead).toBe('lead')
    expect(copy.team.teammate).toBe('teammate')
    expect(copy.team.phases).toEqual({ provisioning: 'provisioning', active: 'active', failed: 'failed' })
    expect(copy.team.statuses).toEqual({ ready: 'ready', blocked: 'blocked', inProgress: 'in progress', completed: 'done' })
    expect(copy.team.teammates(2)).toBe('2 teammate(s)')
    expect(copy.team.running(1)).toBe('1 running')
    expect(copy.team.tasks(3)).toBe('tasks 3')
    expect(copy.team.ready(1)).toBe('1 ready')
    expect(copy.team.blocked(1)).toBe('1 blocked')
    expect(copy.team.inProgress(1)).toBe('1 in progress')
    expect(copy.team.completed(1)).toBe('1 done')
    expect(copy.commands.team).toBe('Show the Agent Team roster and task board')
    expect(copy.team.hint).toContain('Enter open')
    expect(copy.team.hint).toContain('a claim')
    expect(copy.team.memberHint).toBe('↑/↓ scroll · Esc back to the Team panel')
    expect(copy.team.memberTitle('Worker')).toBe('Teammate Worker')
    expect(copy.team.memberUser('hi')).toBe('› hi')
    expect(copy.team.memberAssistant('ok')).toBe('  ok')
    expect(copy.team.memberTool('bash')).toBe('  ⚙ bash')
    expect(copy.team.memberTurnEnd('aborted')).toBe('  · aborted')
    expect(copy.team.memberEmpty).toBe('No recorded events yet.')
    expect(copy.team.usage).toBe('Usage: /team [task <subject> | message <member> <text>]')
    expect(copy.team.taskCreated('t1')).toBe('Created shared task t1')
    expect(copy.team.taskClaimed('t1')).toBe('Claimed task t1')
    expect(copy.team.taskCompleted('t1')).toBe('Completed task t1')
    expect(copy.team.messageSent('Worker')).toBe('Message sent to Worker')
    expect(copy.team.historyUnavailable).toBe('Teammate history is unavailable in this composition.')
    expect(copy.team.actionFailed('nope')).toBe('Team action failed: nope')
    expect(copy.composer.running).toBe('Enter queues for the next turn; Ctrl+C cancels the turn.')

    setCopyLocale('zh')
    expect(copy.team.title).toBe('Agent Team')
    expect(copy.team.membersTab).toBe('成员')
    expect(copy.team.tasksTab).toBe('任务')
    expect(copy.team.hint).toContain('Tab/←/→ 切换')
    expect(copy.team.unavailable).toContain('dsh-experimental-agent-team-profile')
    expect(copy.team.failure).toBe('team 记录被拒绝')
    expect(copy.team.emptyMembers).toBe('还没有 teammate。')
    expect(copy.team.emptyTasks).toBe('还没有共享任务。')
    expect(copy.team.phases).toEqual({ provisioning: '准备中', active: '活动中', failed: '失败' })
    expect(copy.team.statuses).toEqual({ ready: '就绪', blocked: '被阻塞', inProgress: '进行中', completed: '完成' })
    expect(copy.team.teammates(2)).toBe('2 名 teammate')
    expect(copy.team.running(1)).toBe('1 运行中')
    expect(copy.team.tasks(3)).toBe('任务 3')
    expect(copy.team.ready(1)).toBe('1 就绪')
    expect(copy.team.blocked(1)).toBe('1 阻塞')
    expect(copy.team.inProgress(1)).toBe('1 进行中')
    expect(copy.team.completed(1)).toBe('1 完成')
    expect(copy.commands.team).toBe('显示 Agent Team 成员与任务板')
    expect(copy.team.hint).toContain('Enter 打开')
    expect(copy.team.memberHint).toBe('↑/↓ 滚动 · Esc 返回 Team 面板')
    expect(copy.team.memberTitle('Worker')).toBe('Teammate Worker')
    expect(copy.team.memberUser('hi')).toBe('› hi')
    expect(copy.team.memberAssistant('ok')).toBe('  ok')
    expect(copy.team.memberTool('bash')).toBe('  ⚙ bash')
    expect(copy.team.memberTurnEnd('aborted')).toBe('  · aborted')
    expect(copy.team.memberEmpty).toBe('还没有记录事件。')
    expect(copy.team.usage).toBe('用法：/team [task <subject> | message <member> <text>]')
    expect(copy.team.taskCreated('t1')).toBe('已创建共享任务 t1')
    expect(copy.team.taskClaimed('t1')).toBe('已认领任务 t1')
    expect(copy.team.taskCompleted('t1')).toBe('已完成任务 t1')
    expect(copy.team.messageSent('Worker')).toBe('已向 Worker 发送消息')
    expect(copy.team.historyUnavailable).toBe('当前组合无法读取 teammate 历史。')
    expect(copy.team.actionFailed('nope')).toBe('Team 操作失败：nope')
    expect(copy.composer.running).toBe('Enter 排队到下一轮；Ctrl+C 取消当前轮次。')
  })

  it('formats the queue-dock labels and notices', () => {
    expect(copy.queue.title).toBe('Queued messages')
    expect(copy.queue.hint).toBe('↑/↓ move · Enter steer · e edit · x remove · Esc close')
    expect(copy.queue.queued).toBe('Queued for the next turn')
    expect(copy.queue.steered).toBe('Steered into the running turn')
    expect(copy.queue.steeredAll(2)).toBe('Steered 2 queued message(s)')
    expect(copy.queue.removed).toBe('Removed the queued message')
    expect(copy.queue.editUnsupported).toContain('cannot be edited here')
    expect(copy.queue.editMoved).toBe('Queued message moved into the composer; press Enter to send it.')
    expect(copy.queue.nonText).toBe('non-text content')
    expect(copy.queue.empty).toBe('No queued messages.')
    expect(copy.queue.steerUnavailable).toBe('Steering is available only while the agent is running.')
    expect(copy.commands.steer).toBe('Steer a message into the running turn, or steer all queued messages')
    expect(copy.pending.queueHint).toBe('/queue edits · Ctrl+Enter steers')

    setCopyLocale('zh')
    expect(copy.queue.title).toBe('排队消息')
    expect(copy.queue.hint).toBe('↑/↓ 移动 · Enter 插话 · e 编辑 · x 删除 · Esc 关闭')
    expect(copy.queue.queued).toBe('已排队，下一轮发送')
    expect(copy.queue.steered).toBe('已插话到运行中的轮次')
    expect(copy.queue.steeredAll(3)).toBe('已插话 3 条排队消息')
    expect(copy.queue.removed).toBe('已删除排队消息')
    expect(copy.queue.editUnsupported).toContain('非文本内容')
    expect(copy.queue.editMoved).toContain('按 Enter 发送')
    expect(copy.queue.nonText).toBe('非文本内容')
    expect(copy.queue.empty).toBe('没有排队消息。')
    expect(copy.queue.steerUnavailable).toBe('只有 Agent 运行中才能插话。')
    expect(copy.commands.steer).toBe('把消息插话到运行中的轮次；不带参数时插话全部排队消息')
    expect(copy.pending.queueHint).toBe('/queue 编辑 · Ctrl+Enter 插话')
  })

  it('formats the tool-card visibility labels and notices', () => {
    expect(copy.cards.levels.collapsed).toBe('collapsed')
    expect(copy.cards.levels.expanded).toBe('expanded')
    expect(copy.cards.levels.hidden).toBe('hidden')
    expect(copy.cards.changed('expanded')).toBe('Tool cards: expanded')
    expect(copy.cards.available('collapsed, expanded, hidden'))
      .toBe('Available card modes: collapsed, expanded, hidden')
    expect(copy.commands.cards).toBe('Cycle or set the tool-card visibility')
    expect(copy.statusPanel.cards).toBe('Tool cards')

    setCopyLocale('zh')
    expect(copy.cards.levels.collapsed).toBe('折叠')
    expect(copy.cards.levels.expanded).toBe('展开')
    expect(copy.cards.levels.hidden).toBe('隐藏')
    expect(copy.cards.changed('展开')).toBe('工具卡：展开')
    expect(copy.cards.available('折叠, 展开, 隐藏')).toBe('可用工具卡模式：折叠, 展开, 隐藏')
    expect(copy.commands.cards).toBe('循环或设置工具卡可见性')
    expect(copy.statusPanel.cards).toBe('工具卡')
  })

  it('formats the agent-preset labels, descriptions, and notices', () => {
    expect(copy.prompt.presetTitle).toBe('Agent preset')
    expect(copy.prompt.presetCurrent).toBe('current')
    expect(copy.preset.names['standard']).toBe('Standard')
    expect(copy.preset.names['ptc']).toBe('PTC')
    expect(copy.preset.names['minimal']).toBe('Minimal')
    expect(copy.preset.names['cordis']).toBe('Cordis')
    expect(copy.preset.descriptions['standard']).toContain('Full coding tools')
    expect(copy.preset.selected('Standard')).toBe('Agent preset: Standard')
    expect(copy.preset.locked).toBe('This session has already started; its agent preset is fixed.')
    expect(copy.preset.unavailable).toBe('Agent presets are not composed in this terminal.')
    expect(copy.preset.failed('boom')).toBe('Agent preset unchanged: boom')
    expect(copy.commands.preset).toBe('Show or switch the agent preset')
    expect(copy.statusPanel.preset).toBe('Agent preset')

    setCopyLocale('zh')
    expect(copy.prompt.presetTitle).toBe('Agent preset')
    expect(copy.prompt.presetCurrent).toBe('当前')
    expect(copy.preset.names['standard']).toBe('标准')
    expect(copy.preset.names['minimal']).toBe('精简')
    expect(copy.preset.descriptions['minimal']).toContain('精简提示')
    expect(copy.preset.selected('标准')).toBe('Agent preset：标准')
    expect(copy.preset.locked).toBe('本会话已经开始，agent preset 不能再切换。')
    expect(copy.preset.unavailable).toBe('当前终端没有组装 agent preset。')
    expect(copy.preset.failed('nope')).toBe('agent preset 未更改：nope')
    expect(copy.commands.preset).toBe('显示或切换 agent preset')
    expect(copy.statusPanel.preset).toBe('Agent preset')
  })

  it('formats the bottom-dock and reasoning labels', () => {
    expect(copy.moreRows(1)).toBe('1 more row')
    expect(copy.moreRows(3)).toBe('3 more rows')
    expect(copy.reasoning.title).toBe('Reasoning visibility')
    expect(copy.reasoning.label('detailed')).toBe('reasoning detailed')
    expect(copy.reasoning.changed('compact')).toBe('Reasoning visibility: compact')
    expect(copy.reasoning.available('compact, standard')).toBe('Available visibility levels: compact, standard')
    expect(copy.completion.title).toBe('Completions')
    expect(copy.completion.hint).toContain('Tab insert')
    expect(copy.config.tabHint).toContain('Tab')
    expect(copy.commands.reasoning).toBe('Cycle or set the reasoning visibility')
  })

  it('localizes the new labels in Chinese', () => {
    setCopyLocale('zh')

    expect(copy.moreRows(2)).toBe('另外 2 行')
    expect(copy.reasoning.levels.detailed).toBe('详细')
    expect(copy.completion.title).toBe('补全')
    expect(copy.config.tabHint).toContain('Tab')
  })

  it('uses formatters that react to their arguments', () => {
    expect(copy.prompt.progress(1, 3)).toBe('1/3')
    expect(copy.notice.hiddenLines(1)).toBe('… 1 more line')
    expect(copy.notice.hiddenLines(2)).toBe('… 2 more lines')
    expect(copy.mention.tooMany(4)).toBe('Only 4 images can be attached to one message.')
    expect(copy.model.effort('high')).toBe('Reasoning effort: high')
  })
})

describe('setCopyLocale', () => {
  it('starts in English', () => {
    expect(copy).toBe(english)
  })

  it('switches the live copy binding to Chinese and back', () => {
    setCopyLocale('zh')

    expect(copy).toBe(chinese)
    expect(copy.status.running).toBe('运行中')
    expect(copy.commands.queue).toBe('排队一条消息；不带参数时编辑队列')
    expect(copy.clipboard.unsupported).toBe('剪贴板中没有模型可接受的图片。')

    setCopyLocale('en')

    expect(copy).toBe(english)
    expect(copy.status.running).toBe('running')
  })

  it('makes a component render the active locale', () => {
    setCopyLocale('zh')
    const strip = new PendingStrip(createPalette(false), () => snapshot())

    const line = visibleLines(strip.render(80))[0] ?? ''

    expect(line).toContain(chinese.pending.steering(1))
    expect(line).toContain(chinese.pending.queued(2))
    expect(line).toContain(chinese.pending.hint)
  })
})

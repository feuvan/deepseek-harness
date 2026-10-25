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

  it('formats the configuration dock copy', () => {
    expect(copy.config.subtitle).toBe('Changes save automatically')
    expect(copy.config.action).toBe('Configure ›')
    expect(copy.config.descriptions.modelCurrent).toBe('Current model route for this Session')
    expect(copy.config.descriptions.modelChange).toBe('Choose the model used for this Session')
    expect(copy.config.descriptions.effortCurrent).toBe('Current reasoning effort')
    expect(copy.config.descriptions.effortChange).toBe('Choose how much reasoning the model shows')
    expect(copy.config.descriptions.permission).toContain('workspace')
    expect(copy.config.descriptions.bundle).toContain('restart')
    expect(copy.config.descriptions.cards).toContain('Cycle')
    expect(copy.config.descriptions.reasoning).toContain('compact')
    for (const key of ['color', 'animation', 'previewLines', 'windowBlocks', 'title', 'locale', 'busyEnter', 'screen'] as const) {
      expect(copy.config.descriptions.display[key].length, key).toBeGreaterThan(0)
    }
    expect(copy.config.tabHint).toBe('←/→ group · ↑/↓ move · Enter open · Esc close')
    expect(copy.config.hint).toContain('↑/↓ move')

    setCopyLocale('zh')
    expect(copy.config.subtitle).toBe('修改会自动保存')
    expect(copy.config.action).toBe('配置 ›')
    expect(copy.config.descriptions.modelCurrent).toBe('本会话当前使用的模型')
    expect(copy.config.descriptions.bundle).toContain('重启')
    for (const key of ['color', 'animation', 'previewLines', 'windowBlocks', 'title', 'locale', 'busyEnter', 'screen'] as const) {
      expect(copy.config.descriptions.display[key].length, key).toBeGreaterThan(0)
    }
    expect(copy.config.tabHint).toBe('←/→ 分组 · ↑/↓ 移动 · Enter 打开 · Esc 关闭')
  })

  it('formats the /terminal diagnostics copy', () => {
    expect(copy.commands.terminal).toBe('Show terminal, input, and rendering diagnostics')
    expect(copy.terminal.title).toBe('Terminal diagnostics')
    expect(copy.terminal.environment).toBe('Environment')
    expect(copy.terminal.renderer).toBe('Renderer')
    expect(copy.terminal.transcript).toBe('Transcript')
    expect(copy.terminal.screenInline).toBe('inline (terminal scrollback; no mouse capture)')
    expect(copy.terminal.screenFullscreen).toBe('fullscreen (alternate screen; mouse capture)')
    expect(copy.terminal.keyboardKitty).toBe('kitty')
    expect(copy.terminal.keyboardLegacy).toBe('legacy')
    expect(copy.terminal.focused).toBe('focused')
    expect(copy.terminal.unfocused).toBe('unfocused')
    expect(copy.terminal.focusUnknown).toBe('unknown')
    expect(copy.terminal.wheelNone).toBe('0 — the terminal owns the wheel in inline mode')
    expect(copy.terminal.wheelSeen(3, '1.2s')).toBe('3 (last 1.2s)')
    expect(copy.terminal.transcriptValue(4, 2)).toBe('4 blocks · 2 archived')
    expect(copy.terminal.hint).toContain('keeps history in the terminal scrollback')

    setCopyLocale('zh')
    expect(copy.commands.terminal).toBe('显示终端、输入与渲染诊断信息')
    expect(copy.terminal.title).toBe('终端诊断')
    expect(copy.terminal.environment).toBe('环境')
    expect(copy.terminal.screenInline).toContain('inline')
    expect(copy.terminal.screenFullscreen).toContain('fullscreen')
    expect(copy.terminal.focusUnknown).toBe('未知')
    expect(copy.terminal.wheelSeen(3, '1.2s')).toBe('3（最近 1.2s 前）')
    expect(copy.terminal.transcriptValue(4, 2)).toBe('4 块 · 2 归档')
    expect(copy.terminal.hint).toContain('scrollback')
  })

  it('formats the transcript scrollback labels and help keys', () => {
    expect(copy.composer.scrollToEnd).toBe('↓ Back to bottom · esc')
    expect(copy.commands.helpKeys).toContain(
      '  Esc                interrupt; in fullscreen mode it first returns to the transcript bottom',
    )
    expect(copy.commands.helpKeys).toContain(
      '  PgUp/PgDn          scroll the transcript (fullscreen mode pages older history in)',
    )

    setCopyLocale('zh')
    expect(copy.composer.scrollToEnd).toBe('↓ 回到底部 · esc')
    expect(copy.commands.helpKeys).toContain(
      '  Esc                中断运行中的轮次；fullscreen 模式下先回到 transcript 底部',
    )
    expect(copy.commands.helpKeys).toContain('  PgUp/PgDn          滚动 transcript（fullscreen 模式在顶部载入更早历史）')
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
    expect(copy.config.tabHint).toBe('←/→ group · ↑/↓ move · Enter open · Esc close')
    expect(copy.commands.reasoning).toBe('Cycle or set the reasoning visibility')
  })

  it('localizes the new labels in Chinese', () => {
    setCopyLocale('zh')

    expect(copy.moreRows(2)).toBe('另外 2 行')
    expect(copy.reasoning.levels.detailed).toBe('详细')
    expect(copy.completion.title).toBe('补全')
    expect(copy.config.tabHint).toBe('←/→ 分组 · ↑/↓ 移动 · Enter 打开 · Esc 关闭')
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

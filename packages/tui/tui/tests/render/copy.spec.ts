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
    expect(copy.commands.queue).toBe('把一条消息排到下一轮')
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

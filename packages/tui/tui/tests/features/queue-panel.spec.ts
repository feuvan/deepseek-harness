import { afterEach, describe, expect, it } from 'vitest'
import { QueuePanel, type QueuePanelHandlers, type QueuePanelItem } from '../../src/components/queue-panel.ts'
import { copy, setCopyLocale } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'
import { visibleLines } from '../support/terminal.ts'

/** Keys the queue panel binds. */
const KEY = {
  up: '\u001b[A',
  down: '\u001b[B',
  pageUp: '\u001b[5~',
  pageDown: '\u001b[6~',
  enter: '\r',
  escape: '\u001b',
  delete: '\u001b[3~',
} as const

/** One queue-panel harness with recorded handler calls. */
interface QueueHarness {
  readonly panel: QueuePanel
  readonly steered: QueuePanelItem[]
  readonly edited: QueuePanelItem[]
  readonly removed: QueuePanelItem[]
  readonly closes: number
}

/**
 * Build one queue panel over the recording handlers.
 * @returns the panel and its recordings.
 */
function queueHarness(): QueueHarness {
  const state = {
    steered: [] as QueuePanelItem[],
    edited: [] as QueuePanelItem[],
    removed: [] as QueuePanelItem[],
    closes: 0,
  }
  const handlers: QueuePanelHandlers = {
    steer: (item) => { state.steered.push(item) },
    edit: (item) => { state.edited.push(item) },
    remove: (item) => { state.removed.push(item) },
    close: () => { state.closes += 1 },
  }
  return {
    panel: new QueuePanel(createPalette(false), handlers),
    get steered() { return state.steered },
    get edited() { return state.edited },
    get removed() { return state.removed },
    get closes() { return state.closes },
  }
}

/** @returns numbered queue rows. */
function rows(count: number): QueuePanelItem[] {
  return Array.from({ length: count }, (_, index) => ({ id: `id-${String(index)}`, label: `message ${String(index)}` }))
}

/** @returns one panel rendering its current rows. */
function rendered(panel: QueuePanel): string[] {
  return visibleLines(panel.render(120))
}

/**
 * Whether some rendered line contains the needle.
 * @param lines - rendered lines.
 * @param needle - substring to find.
 * @returns whether a line contains it.
 */
function hasLine(lines: readonly string[], needle: string): boolean {
  return lines.some(line => line.includes(needle))
}

afterEach(() => {
  setCopyLocale('en')
})

describe('QueuePanel', () => {
  it('renders an empty panel as title and hint only', () => {
    const harness = queueHarness()

    expect(harness.panel.active).toBe(false)
    expect(rendered(harness.panel)).toEqual([
      copy.queue.title,
      ` ${copy.queue.hint}`,
    ])
    expect(harness.panel.handleInput(KEY.down)).toBe(false)
  })

  it('lists rows with the selected marker and dispatched descriptions', () => {
    const harness = queueHarness()
    harness.panel.setItems([
      { id: 'a', label: '1. first' },
      { id: 'b', label: '2. second', description: copy.queue.nonText },
    ])

    expect(harness.panel.active).toBe(true)
    const lines = rendered(harness.panel)
    expect(lines[0]).toBe(copy.queue.title)
    expect(hasLine(lines, '❯ 1. first')).toBe(true)
    expect(lines[2]).toBe(`   2. second  ${copy.queue.nonText}`)
    expect(lines.at(-1)).toBe(` ${copy.queue.hint}`)
  })

  it('moves one row per arrow key and wraps', () => {
    const harness = queueHarness()
    harness.panel.setItems(rows(3))

    harness.panel.handleInput(KEY.down)
    expect(hasLine(rendered(harness.panel), '❯ message 1')).toBe(true)
    harness.panel.handleInput(KEY.up)
    expect(hasLine(rendered(harness.panel), '❯ message 0')).toBe(true)
    harness.panel.handleInput(KEY.up)
    expect(hasLine(rendered(harness.panel), '❯ message 2')).toBe(true)
  })

  it('pages by the visible row count and clamps at both ends', () => {
    const harness = queueHarness()
    harness.panel.setItems(rows(9))

    harness.panel.handleInput(KEY.pageDown)
    expect(hasLine(rendered(harness.panel), `  ↑ ${copy.moreRows(3)}`)).toBe(true)
    expect(hasLine(rendered(harness.panel), '❯ message 6')).toBe(true)
    expect(rendered(harness.panel).some(line => line.startsWith('  ↓'))).toBe(false)

    harness.panel.handleInput(KEY.pageDown)
    expect(hasLine(rendered(harness.panel), `  ↑ ${copy.moreRows(3)}`)).toBe(true)
    expect(hasLine(rendered(harness.panel), '❯ message 8')).toBe(true)

    harness.panel.handleInput(KEY.pageUp)
    expect(hasLine(rendered(harness.panel), '❯ message 2')).toBe(true)
    expect(hasLine(rendered(harness.panel), `  ↓ ${copy.moreRows(3)}`)).toBe(true)

    harness.panel.handleInput(KEY.pageUp)
    harness.panel.handleInput(KEY.pageUp)
    expect(hasLine(rendered(harness.panel), '❯ message 0')).toBe(true)
    expect(hasLine(rendered(harness.panel), `  ↓ ${copy.moreRows(3)}`)).toBe(true)
    expect(rendered(harness.panel).some(line => line.startsWith('  ↑'))).toBe(false)
  })

  it('keeps the selection in range when rows shrink', () => {
    const harness = queueHarness()
    harness.panel.setItems(rows(9))
    harness.panel.handleInput(KEY.pageDown)
    harness.panel.handleInput(KEY.pageDown)

    harness.panel.setItems(rows(2))

    expect(hasLine(rendered(harness.panel), '❯ message 1')).toBe(true)
  })

  it('forwards Enter as steer, e as edit, and x/Delete as remove for the selected row', () => {
    const harness = queueHarness()
    harness.panel.setItems(rows(2))
    harness.panel.handleInput(KEY.down)

    expect(harness.panel.handleInput(KEY.enter)).toBe(true)
    expect(harness.steered).toEqual([{ id: 'id-1', label: 'message 1' }])
    expect(harness.panel.handleInput('e')).toBe(true)
    expect(harness.edited).toEqual([{ id: 'id-1', label: 'message 1' }])
    expect(harness.panel.handleInput('x')).toBe(true)
    expect(harness.panel.handleInput(KEY.delete)).toBe(true)
    expect(harness.removed).toHaveLength(2)
  })

  it('closes on Escape and ignores unbound keys', () => {
    const harness = queueHarness()
    harness.panel.setItems(rows(1))

    expect(harness.panel.handleInput('z')).toBe(false)
    expect(harness.panel.handleInput(KEY.escape)).toBe(true)
    expect(harness.closes).toBe(1)
    expect(harness.steered).toEqual([])
  })

  it('does not dispatch after the rows drain', () => {
    const harness = queueHarness()
    harness.panel.setItems(rows(1))
    harness.panel.setItems([])

    expect(harness.panel.handleInput(KEY.enter)).toBe(false)
    expect(harness.panel.handleInput('e')).toBe(false)
    expect(harness.panel.handleInput('x')).toBe(false)
  })

  it('renders the localized title and hint', () => {
    setCopyLocale('zh')
    const harness = queueHarness()

    expect(rendered(harness.panel)[0]).toBe(copy.queue.title)
    expect(rendered(harness.panel).at(-1)).toBe(` ${copy.queue.hint}`)
  })

  it('ignores a stale index past the row list', () => {
    const harness = queueHarness()
    harness.panel.setItems(rows(1))
    Reflect.set(harness.panel, 'index', 4)

    expect(harness.panel.handleInput(KEY.enter)).toBe(false)
    expect(harness.steered).toEqual([])
  })

  it('has no cached state to invalidate', () => {
    const harness = queueHarness()

    expect(() => { harness.panel.invalidate() }).not.toThrow()
  })
})

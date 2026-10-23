import { describe, expect, it, vi } from 'vitest'
import { BottomList, type BottomListItem } from '../../src/bottom-list.ts'
import { copy } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'
import { visibleLines } from '../support/terminal.ts'

/** The keys the list must recognize. */
const KEY = {
  up: '\u001b[A',
  down: '\u001b[B',
  pageUp: '\u001b[5~',
  pageDown: '\u001b[6~',
  enter: '\r',
  escape: '\u001b',
} as const

/** @returns one row with the index in its label. */
function item(index: number, description = false): BottomListItem {
  return {
    value: `value-${String(index)}`,
    label: `Label ${String(index)}`,
    ...(description ? { description: `description ${String(index)}` } : {}),
  }
}

/** One list under test with its recorded callbacks. */
interface ListHarness {
  readonly list: BottomList
  readonly selected: BottomListItem[]
  readonly cancelled: number[]
  readonly requestRender: ReturnType<typeof vi.fn>
}

/**
 * Build one bottom list over the supplied rows.
 * @param items - rows to present.
 * @returns the list harness.
 */
function listHarness(items: readonly BottomListItem[] = [item(0), item(1), item(2)]): ListHarness {
  const selected: BottomListItem[] = []
  const cancelled: number[] = []
  const requestRender = vi.fn()
  const list = new BottomList(createPalette(false), requestRender)
  list.open('Choices', items, (chosen) => { selected.push(chosen) }, () => { cancelled.push(1) })
  return { list, selected, cancelled, requestRender }
}

/**
 * Render one list to visible lines.
 * @param list - the list under test.
 * @param width - available columns.
 * @returns visible lines.
 */
function rendered(list: BottomList, width = 100): string[] {
  return visibleLines(list.render(width))
}

describe('BottomList state', () => {
  it('is inactive before a list opens and closes without a choice', () => {
    const requestRender = vi.fn()
    const list = new BottomList(createPalette(false), requestRender)

    expect(list.active).toBe(false)
    expect(list.handleInput(KEY.down)).toBe(false)
    expect(list.render(80)).toEqual(['', ` ${copy.prompt.selectHint}`])

    list.open('Choices', [item(0)], () => {}, () => {})
    expect(list.active).toBe(true)
    expect(requestRender).toHaveBeenCalledTimes(1)

    list.close()
    expect(list.active).toBe(false)
    expect(list.handleInput(KEY.down)).toBe(false)
    expect(requestRender).toHaveBeenCalledTimes(2)
  })

  it('ignores an empty item list and unrelated keys', () => {
    const requestRender = vi.fn()
    const list = new BottomList(createPalette(false), requestRender)
    list.open('Empty', [], () => {}, () => {})

    expect(list.active).toBe(false)
    expect(list.handleInput('z')).toBe(false)
    expect(list.handleInput(KEY.enter)).toBe(false)
    expect(requestRender).toHaveBeenCalled()
  })
})

describe('BottomList rendering', () => {
  it('renders the title, rows, and hint', () => {
    const harness = listHarness([item(0), item(1)])

    expect(rendered(harness.list)).toEqual([
      'Choices',
      ' ❯ Label 0',
      '   Label 1',
      ` ${copy.prompt.selectHint}`,
    ])
  })

  it('marks the selected row and shows descriptions', () => {
    const harness = listHarness([item(0, true), item(1, true)])

    expect(rendered(harness.list)[1]).toBe(' ❯ Label 0  description 0')
    expect(rendered(harness.list)[2]).toBe('   Label 1  description 1')
  })

  it('marks the selected row through the accent and inverse styles', () => {
    const requestRender = vi.fn()
    const list = new BottomList(createPalette(true), requestRender)
    list.open('Choices', [item(0)], () => {}, () => {})

    const lines = list.render(100)
    expect(lines[1]).toContain('\u001b[36m❯\u001b[39m')
    expect(lines[1]).toContain('\u001b[7mLabel 0\u001b[27m')
  })

  it('renders at most six rows with scroll indicators', () => {
    const items = Array.from({ length: 10 }, (_, index) => item(index))
    const harness = listHarness(items)

    const lines = rendered(harness.list)

    expect(lines[0]).toBe('Choices')
    expect(lines.filter(line => line.includes('Label'))).toHaveLength(6)
    expect(lines).toContain(`  ↓ ${copy.moreRows(4)}`)
    expect(lines.at(-1)).toBe(` ${copy.prompt.selectHint}`)

    for (let step = 0; step < 6; step += 1) harness.list.handleInput(KEY.down)

    const scrolled = rendered(harness.list)
    expect(scrolled).toContain(`  ↑ ${copy.moreRows(3)}`)
    expect(scrolled).toContain(' ❯ Label 6')
  })

  it('truncates every line to the requested width', () => {
    const harness = listHarness([{ value: 'v', label: 'a very long label that does not fit', description: 'long description' }])

    for (const line of rendered(harness.list, 16)) expect(line.length).toBeLessThanOrEqual(16)
  })

  it('has no cached state to invalidate', () => {
    const harness = listHarness()

    expect(() => { harness.list.invalidate() }).not.toThrow()
  })
})

describe('BottomList navigation', () => {
  it('wraps the highlight with the arrow keys', () => {
    const harness = listHarness()

    harness.list.handleInput(KEY.up)
    expect(rendered(harness.list).join('\n')).toContain('❯ Label 2')
    harness.list.handleInput(KEY.down)
    expect(rendered(harness.list)[1]).toBe(' ❯ Label 0')
  })

  it('pages by the visible row count and clamps at both ends', () => {
    const harness = listHarness(Array.from({ length: 10 }, (_, index) => item(index)))

    harness.list.handleInput(KEY.pageDown)
    expect(harness.list.handleInput(KEY.pageDown)).toBe(true)
    expect(rendered(harness.list).join('\n')).toContain('❯ Label 9')
    harness.list.handleInput(KEY.pageDown)
    expect(rendered(harness.list).join('\n')).toContain('❯ Label 9')
    harness.list.handleInput(KEY.pageUp)
    harness.list.handleInput(KEY.pageUp)
    expect(rendered(harness.list).join('\n')).toContain('❯ Label 0')
  })

  it('selects the highlighted row on Enter and closes', () => {
    const harness = listHarness()

    harness.list.handleInput(KEY.down)
    expect(harness.list.handleInput(KEY.enter)).toBe(true)

    expect(harness.selected).toEqual([item(1)])
    expect(harness.list.active).toBe(false)
    expect(harness.cancelled).toEqual([])
  })

  it('cancels on Escape and closes', () => {
    const harness = listHarness()

    expect(harness.list.handleInput(KEY.escape)).toBe(true)

    expect(harness.cancelled).toEqual([1])
    expect(harness.selected).toEqual([])
    expect(harness.list.active).toBe(false)
  })

  it('ignores unrelated keys while the list owns the dock', () => {
    const harness = listHarness()

    expect(harness.list.handleInput('z')).toBe(false)
    expect(harness.list.active).toBe(true)
  })

  it('closes without a selection when the highlight points past the rows', () => {
    const harness = listHarness([item(0)])
    Reflect.set(harness.list, 'index', 4)

    expect(harness.list.handleInput(KEY.enter)).toBe(true)
    expect(harness.selected).toEqual([])
    expect(harness.list.active).toBe(false)
  })

  it('closes without a callback when the selection disappears first', () => {
    const selected: BottomListItem[] = []
    const list = new BottomList(createPalette(false), vi.fn())
    list.open('Choices', [item(0)], (chosen) => { selected.push(chosen) }, () => {})
    list.close()

    expect(list.handleInput(KEY.enter)).toBe(false)
    expect(selected).toEqual([])
  })
})

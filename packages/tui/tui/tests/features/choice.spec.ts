import { describe, expect, it, vi } from 'vitest'
import { SelectList, visibleWidth, type SelectItem } from '@earendil-works/pi-tui'
import { ChoicePanel } from '../../src/components/choice.ts'
import { createSelectListTheme } from '../../src/markdown.ts'
import { createPalette } from '../../src/palette.ts'
import { visibleLines } from '../support/terminal.ts'

const PALETTE = createPalette(false)

/** The entries one chooser presents. */
const ITEMS: readonly SelectItem[] = [
  { value: 'low', label: 'Low', description: 'fast and cheap' },
  { value: 'high', label: 'High', description: 'slower but deeper' },
]

/** One chooser under test with its recorded outcomes. */
interface ChoiceHarness {
  readonly panel: ChoicePanel
  readonly selected: SelectItem[]
  readonly state: { cancels: number }
}

/**
 * Build one choice panel over fixed entries.
 * @param items - selectable entries.
 * @param color - whether the palette styles text.
 * @returns the panel and its recorded outcomes.
 */
function choiceHarness(items: readonly SelectItem[] = ITEMS, color = false): ChoiceHarness {
  const palette = createPalette(color)
  const selected: SelectItem[] = []
  const state = { cancels: 0 }
  const panel = new ChoicePanel(
    'Reasoning effort',
    text => palette.heading(text),
    items,
    createSelectListTheme(palette),
    (item) => { selected.push(item) },
    () => { state.cancels += 1 },
  )
  return { panel, selected, state }
}

/**
 * Render the panel to visible text.
 * @param panel - the panel under test.
 * @param width - available columns.
 * @returns visible lines.
 */
function rendered(panel: ChoicePanel, width = 120): string[] {
  return visibleLines(panel.render(width))
}

describe('ChoicePanel', () => {
  it('renders the styled heading, entries, and descriptions', () => {
    const harness = choiceHarness(ITEMS, true)

    const lines = harness.panel.render(120)

    expect(lines[0]).toBe('\u001b[1m\u001b[36mReasoning effort\u001b[39m\u001b[22m')
    expect(rendered(harness.panel)[0]).toBe('Reasoning effort')
    expect(rendered(harness.panel).join('\n')).toContain('Low')
    expect(rendered(harness.panel).join('\n')).toContain('fast and cheap')
    expect(rendered(harness.panel).join('\n')).toContain('High')
  })

  it('moves the selection with the arrow keys and wraps at both ends', () => {
    const harness = choiceHarness()

    expect(rendered(harness.panel)[1]).toContain('→ Low')
    harness.panel.handleInput('\u001b[B')
    expect(rendered(harness.panel)[2]).toContain('→ High')
    harness.panel.handleInput('\u001b[B')
    expect(rendered(harness.panel)[1]).toContain('→ Low')
    harness.panel.handleInput('\u001b[A')
    expect(rendered(harness.panel)[2]).toContain('→ High')
  })

  it('returns the highlighted entry on Enter', () => {
    const harness = choiceHarness()

    harness.panel.handleInput('\u001b[B')
    harness.panel.handleInput('\r')

    expect(harness.selected).toEqual([ITEMS[1]])
  })

  it('cancels on Escape', () => {
    const harness = choiceHarness()

    harness.panel.handleInput('\u001b')

    expect(harness.state.cancels).toBe(1)
    expect(harness.selected).toEqual([])
  })

  it('ignores unrelated keys', () => {
    const harness = choiceHarness()

    harness.panel.handleInput('z')
    harness.panel.handleInput('\r')

    expect(harness.selected).toEqual([ITEMS[0]])
  })

  it('renders the embedded list no-match row for an empty catalog', () => {
    const harness = choiceHarness([])

    expect(rendered(harness.panel)).toEqual(['Reasoning effort', '  No matching commands'])
  })

  it('narrows the embedded list when its filter changes', () => {
    const harness = choiceHarness()
    const list = Reflect.get(harness.panel, 'list') as SelectList

    list.setFilter('high')

    expect(rendered(harness.panel).join('\n')).toContain('High')
    expect(rendered(harness.panel).join('\n')).not.toContain('Low')
  })

  it('truncates every row to the available width', () => {
    const long: SelectItem = {
      value: 'very-long-value',
      label: 'A label that is much longer than the narrow panel can show',
      description: 'a description that does not fit either',
    }
    const harness = choiceHarness([long])

    for (const line of rendered(harness.panel, 20)) expect(visibleWidth(line)).toBeLessThanOrEqual(20)
  })

  it('has no cached state to invalidate', () => {
    const harness = choiceHarness()

    expect(() => { harness.panel.invalidate() }).not.toThrow()
    expect(rendered(harness.panel)).toHaveLength(3)
  })

  it('selects through the list callback supplied at construction', () => {
    const onSelect = vi.fn()
    const panel = new ChoicePanel(
      'Choice',
      text => text,
      ITEMS,
      createSelectListTheme(PALETTE),
      onSelect,
      () => {},
    )

    panel.handleInput('\r')

    expect(onSelect).toHaveBeenCalledWith(ITEMS[0])
  })
})

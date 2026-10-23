import { describe, expect, it, vi } from 'vitest'
import type { Component } from '@earendil-works/pi-tui'
import { BottomPanel } from '../../src/components/bottom.ts'
import { visibleLines } from '../support/terminal.ts'

/** A component double rendering fixed lines and recording invalidation. */
interface ContentDouble extends Component {
  invalidations: number
}

/**
 * Build one dock surface double.
 * @param lines - lines to render.
 * @returns the component and its invalidation counter.
 */
function contentDouble(lines: readonly string[]): ContentDouble {
  const double: ContentDouble = {
    invalidations: 0,
    render: () => [...lines],
    invalidate: () => { double.invalidations = double.invalidations + 1 },
  }
  return double
}

describe('BottomPanel', () => {
  it('renders nothing while no surface owns the dock', () => {
    const panel = new BottomPanel()

    expect(panel.active).toBe(false)
    expect(panel.render(80)).toEqual([])
  })

  it('renders the active surface lines', () => {
    const panel = new BottomPanel()
    const content = contentDouble(['first', 'second'])

    panel.setContent(content)

    expect(panel.active).toBe(true)
    expect(visibleLines(panel.render(80))).toEqual(['first', 'second'])
    expect(panel.render(80)).toHaveLength(2)
  })

  it('keeps at most sixteen lines from the active surface', () => {
    const panel = new BottomPanel()
    const lines = Array.from({ length: 20 }, (_, index) => `line ${String(index)}`)

    panel.setContent(contentDouble(lines))

    const rendered = panel.render(80)
    expect(rendered).toHaveLength(16)
    expect(visibleLines(rendered).at(-1)).toBe('line 15')
  })

  it('honours an explicit line budget', () => {
    const panel = new BottomPanel(2)

    panel.setContent(contentDouble(['a', 'b', 'c']))

    expect(panel.render(80)).toHaveLength(2)
  })

  it('closes when the surface is cleared', () => {
    const panel = new BottomPanel()
    panel.setContent(contentDouble(['row']))

    panel.setContent(undefined)

    expect(panel.active).toBe(false)
    expect(panel.render(80)).toEqual([])
  })

  it('forwards invalidation to the active surface', () => {
    const panel = new BottomPanel()
    const content = contentDouble(['row'])
    panel.setContent(content)

    panel.invalidate()

    expect(content.invalidations).toBe(1)
  })

  it('tolerates invalidation without a surface', () => {
    const panel = new BottomPanel()
    const forwarded = vi.fn()

    panel.invalidate()

    expect(forwarded).not.toHaveBeenCalled()
    expect(panel.active).toBe(false)
  })
})

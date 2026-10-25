import { describe, expect, it, vi } from 'vitest'
import type { Component } from '@earendil-works/pi-tui'
import { BottomAnchor } from '../../src/components/bottom-anchor.ts'

/** One mutable child component and its render/invalidate counters. */
interface ChildDouble extends Component {
  lines: string[]
  readonly invalidations: number
}

/**
 * Build one child double rendering the supplied lines.
 * @param lines - initial rendered lines.
 * @returns the child double.
 */
function childDouble(lines: readonly string[]): ChildDouble {
  const state = { lines: [...lines], invalidations: 0 }
  return {
    get lines() { return state.lines },
    set lines(next: string[]) { state.lines = next },
    get invalidations() { return state.invalidations },
    render: () => [...state.lines],
    invalidate: () => { state.invalidations += 1 },
  }
}

/**
 * Build one bottom anchor over a mutable terminal height.
 * @param child - stacked child.
 * @param rows - current terminal rows.
 * @returns the anchor and a height setter.
 */
function anchor(child: Component, rows: number): { anchor: BottomAnchor; setRows: (next: number) => void } {
  let current = rows
  return {
    anchor: new BottomAnchor(child, () => current),
    setRows: (next) => { current = next },
  }
}

describe('BottomAnchor', () => {
  it('pads the first frame so the child starts at the bottom', () => {
    const child = childDouble(['a', 'b', 'c'])
    const { anchor: bottom } = anchor(child, 10)

    expect(bottom.render(80)).toEqual(['', '', '', '', '', '', '', 'a', 'b', 'c'])
  })

  it('keeps the padding fixed as the child grows below it', () => {
    const child = childDouble(['a'])
    const { anchor: bottom, setRows } = anchor(child, 5)
    expect(bottom.render(80)).toHaveLength(5)

    child.lines = ['a', 'b', 'c', 'd', 'e', 'f']
    setRows(40)

    expect(bottom.render(80)).toEqual(['', '', '', '', 'a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('adds no padding when the content already fills the terminal', () => {
    const child = childDouble(['1', '2', '3'])
    const { anchor: bottom } = anchor(child, 3)

    expect(bottom.render(80)).toEqual(['1', '2', '3'])
  })

  it('adds no padding when the content exceeds the terminal rows', () => {
    const child = childDouble(['1', '2', '3', '4'])
    const { anchor: bottom } = anchor(child, 2)

    expect(bottom.render(80)).toEqual(['1', '2', '3', '4'])
  })

  it('handles a zero-row terminal', () => {
    const child = childDouble(['one'])
    const { anchor: bottom } = anchor(child, 0)

    expect(bottom.render(80)).toEqual(['one'])
  })

  it('invalidates the child through the anchor', () => {
    const child = childDouble(['a'])
    const { anchor: bottom } = anchor(child, 2)

    bottom.invalidate()

    expect(child.invalidations).toBe(1)
  })

  it('computes the padding once even when the child later shrinks', () => {
    const child = childDouble(['a', 'b', 'c'])
    const { anchor: bottom, setRows } = anchor(child, 10)
    expect(bottom.render(80)).toHaveLength(10)

    child.lines = ['only']
    setRows(2)

    expect(bottom.render(80)).toEqual([...Array.from({ length: 7 }, () => ''), 'only'])
  })

  it('renders the child at the requested width', () => {
    const widths: number[] = []
    const child: Component = {
      render: (width) => { widths.push(width); return [] },
      invalidate: vi.fn(),
    }
    const bottom = new BottomAnchor(child, () => 0)

    bottom.render(42)

    expect(widths).toEqual([42])
  })
})

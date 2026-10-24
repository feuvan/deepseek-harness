import { describe, expect, it } from 'vitest'
import type { Component } from '@earendil-works/pi-tui'
import { ContributedStrips } from '../../src/components/contributed-strips.ts'

/** Build one strip component with a fixed render and an invalidation counter. */
function strip(lines: readonly string[]): { component: Component; invalidations: { count: number } } {
  const invalidations = { count: 0 }
  const component: Component = {
    render: () => [...lines],
    invalidate: () => { invalidations.count += 1 },
  }
  return { component, invalidations }
}

describe('ContributedStrips', () => {
  it('renders zero lines for an empty contribution list', () => {
    const strips = new ContributedStrips([])

    expect(strips.render(80)).toEqual([])
  })

  it('concatenates contributed strips in registration order and skips hidden ones', () => {
    const first = strip([' first '])
    const hidden = strip([])
    const second = strip([' second ', ' second line '])
    const strips = new ContributedStrips([first.component, hidden.component, second.component])

    expect(strips.render(80)).toEqual([' first ', ' second ', ' second line '])
  })

  it('invalidates every contributed strip', () => {
    const first = strip(['a'])
    const second = strip(['b'])
    const strips = new ContributedStrips([first.component, second.component])

    strips.invalidate()

    expect(first.invalidations.count).toBe(1)
    expect(second.invalidations.count).toBe(1)
  })

  it('renders nothing when every strip hides itself', () => {
    const strips = new ContributedStrips([strip([]).component, strip([]).component])

    expect(strips.render(80)).toEqual([])
  })

  it('calls render on every strip at the requested width', () => {
    const widths: number[] = []
    const component: Component = {
      render: (width) => { widths.push(width); return [] },
      invalidate: () => {},
    }

    new ContributedStrips([component]).render(42)

    expect(widths).toEqual([42])
  })

  it('is invalidation-safe with no strips', () => {
    const strips = new ContributedStrips([])

    expect(() => { strips.invalidate() }).not.toThrow()
  })
})

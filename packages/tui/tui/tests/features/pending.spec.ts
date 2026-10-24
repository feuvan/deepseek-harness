import { afterEach, describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { PendingStrip } from '../../src/components/pending.ts'
import type { FooterSnapshot } from '../../src/components/footer.ts'
import { copy, setCopyLocale } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'
import { visibleLines } from '../support/terminal.ts'

/** One complete footer snapshot with no pending input. */
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
    status: copy.status.idle,
    elapsedSeconds: undefined,
    pendingSteering: 0,
    pendingQueued: 0,
    ...overrides,
  }
}

/** @returns a strip over one fixed snapshot. */
function strip(state: FooterSnapshot, color = false): PendingStrip {
  return new PendingStrip(createPalette(color), () => state)
}

afterEach(() => {
  setCopyLocale('en')
})

describe('PendingStrip', () => {
  it('renders nothing while no input is pending', () => {
    expect(strip(snapshot()).render(80)).toEqual([])
  })

  it('renders a steering-only line', () => {
    expect(visibleLines(strip(snapshot({ pendingSteering: 2 })).render(80))).toEqual([
      ` ${copy.pending.steering(2)}`,
    ])
  })

  it('renders a queued-only line with the queue-edit hint', () => {
    expect(visibleLines(strip(snapshot({ pendingQueued: 1 })).render(80))).toEqual([
      ` ${copy.pending.queued(1)} · ${copy.pending.queueHint}`,
    ])
  })

  it('renders both counts in order followed by the queue-edit hint', () => {
    expect(visibleLines(strip(snapshot({ pendingSteering: 1, pendingQueued: 3 })).render(200))).toEqual([
      ` ${copy.pending.steering(1)} · ${copy.pending.queued(3)} · ${copy.pending.queueHint}`,
    ])
  })

  it('adds the interrupt hint before the queue-edit hint while running', () => {
    const line = visibleLines(strip(snapshot({
      pendingSteering: 1,
      pendingQueued: 2,
      status: copy.status.running,
    })).render(120))[0]

    expect(line).toBe(
      ` ${copy.pending.steering(1)} · ${copy.pending.queued(2)} · ${copy.pending.hint} · ${copy.pending.queueHint}`,
    )
  })

  it('adds the interrupt hint only while the agent runs', () => {
    const running = visibleLines(strip(snapshot({ pendingSteering: 1, status: copy.status.running })).render(80))
    expect(running[0]).toBe(` ${copy.pending.steering(1)} · ${copy.pending.hint}`)

    const idle = visibleLines(strip(snapshot({ pendingSteering: 1, status: copy.status.idle })).render(80))
    expect(idle[0]).toBe(` ${copy.pending.steering(1)}`)
  })

  it('styles the strip as a warning', () => {
    const line = strip(snapshot({ pendingQueued: 1 }), true).render(80)[0] ?? ''

    expect(line).toContain('\u001b[33m')
    expect(line).toContain(copy.pending.queued(1))
    expect(line).toContain('\u001b[39m')
  })

  it('truncates the line to the available width', () => {
    const line = strip(snapshot({ pendingSteering: 12, pendingQueued: 34, status: copy.status.running })).render(20)[0] ?? ''

    expect(visibleWidth(line)).toBeLessThanOrEqual(20)
  })

  it('renders the active locale copy', () => {
    setCopyLocale('zh')

    const line = visibleLines(strip(snapshot({ pendingSteering: 1, pendingQueued: 2, status: copy.status.running })).render(200))[0]

    expect(line).toBe(` ${copy.pending.steering(1)} · ${copy.pending.queued(2)} · ${copy.pending.hint} · ${copy.pending.queueHint}`)
  })

  it('has no cached state to invalidate', () => {
    const component = strip(snapshot({ pendingQueued: 1 }))

    expect(() => { component.invalidate() }).not.toThrow()
    expect(component.render(80)).toHaveLength(1)
  })
})

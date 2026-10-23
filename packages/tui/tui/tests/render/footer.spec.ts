import { describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { Footer, type FooterSnapshot } from '../../src/components/footer.ts'
import { copy } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'

const ESC = '\u001b'

/** A complete footer snapshot with every optional segment present. */
function completeSnapshot(overrides: Partial<FooterSnapshot> = {}): FooterSnapshot {
  return {
    cwd: '/work/repo',
    title: 'Session title',
    model: 'deepseek/deepseek-chat',
    effort: 'high',
    effortImplicit: false,
    reasoning: copy.reasoning.label('standard'),
    inputTokens: 1200,
    outputTokens: 345,
    cacheRate: 0.5,
    contextPercent: 0.25,
    permission: 'workspace-write',
    status: copy.status.idle,
    elapsedSeconds: 42,
    pendingSteering: 0,
    pendingQueued: 0,
    ...overrides,
  }
}

/** @returns a footer over one fixed snapshot. */
function footer(snapshot: FooterSnapshot, color = false): Footer {
  return new Footer(createPalette(color), () => snapshot)
}

/** @returns the second footer line for one width. */
function secondLine(snapshot: FooterSnapshot, width: number): string {
  return footer(snapshot).render(width)[1] ?? ''
}

describe('Footer', () => {
  it('renders the Session line and every status segment', () => {
    const lines = footer(completeSnapshot()).render(120)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('session Session title · /work/repo')
    expect(lines[1]).toBe(
      ' deepseek/deepseek-chat · high · reasoning standard · ↑1200 ↓345 · cache 50% · ctx 25% · workspace-write · idle · 42s',
    )
  })

  it('places the effort and reasoning labels directly after the model', () => {
    const explicit = footer(completeSnapshot({
      model: 'alpha/m-1',
      effort: 'high',
      cacheRate: undefined,
      contextPercent: undefined,
      permission: undefined,
      elapsedSeconds: undefined,
    })).render(120)
    expect(explicit[1]).toBe(' alpha/m-1 · high · reasoning standard · ↑1200 ↓345 · idle')

    const effectiveDefault = footer(completeSnapshot({
      model: 'alpha/m-1',
      effort: 'low',
      effortImplicit: true,
      cacheRate: undefined,
      contextPercent: undefined,
      permission: undefined,
      elapsedSeconds: undefined,
    })).render(120)
    expect(effectiveDefault[1]).toBe(' alpha/m-1 · low · reasoning standard · ↑1200 ↓345 · idle')
  })

  it('renders the localized reasoning level', () => {
    const line = secondLine(completeSnapshot({ reasoning: copy.reasoning.label('verbose') }), 200)

    expect(line).toContain(copy.reasoning.label('verbose'))
    expect(line.indexOf(copy.reasoning.label('verbose'))).toBeGreaterThan(line.indexOf('high'))
  })

  it('omits the title separator when the Session has no title', () => {
    const lines = footer(completeSnapshot({ title: undefined })).render(120)
    expect(lines[0]).toBe('session /work/repo')
  })

  it('omits optional segments that carry no value', () => {
    const lines = footer(completeSnapshot({
      effort: undefined,
      cacheRate: undefined,
      contextPercent: undefined,
      permission: undefined,
      elapsedSeconds: undefined,
    })).render(120)
    expect(lines[1]).toBe(' deepseek/deepseek-chat · reasoning standard · ↑1200 ↓345 · idle')
  })

  it('highlights the running status and dims the idle status', () => {
    const running = footer(completeSnapshot({ status: copy.status.running }), true).render(120)[1]
    expect(running).toContain(`${ESC}[33mrunning${ESC}[39m`)
    const idle = footer(completeSnapshot(), true).render(120)[1]
    expect(idle).toContain(`${ESC}[2midle${ESC}[22m`)
  })

  it('rounds cache and context percentages', () => {
    const lines = footer(completeSnapshot({ cacheRate: 0.555, contextPercent: 0.954 })).render(120)
    expect(lines[1]).toContain('cache 56%')
    expect(lines[1]).toContain('ctx 95%')
  })

  it('drops ambient segments in elapsed, cache, tokens, then context order', () => {
    const snapshot = completeSnapshot({ status: copy.status.running, elapsedSeconds: 42 })

    const all = secondLine(snapshot, 300)
    const droppedElapsed = secondLine(snapshot, visibleWidth(all) - 1)
    expect(droppedElapsed).not.toContain('42s')
    expect(droppedElapsed).toContain('cache 50%')
    expect(droppedElapsed).toContain('reasoning standard')
    expect(droppedElapsed).toContain('running')

    const droppedCache = secondLine(snapshot, visibleWidth(droppedElapsed) - 1)
    expect(droppedCache).not.toContain('cache')
    expect(droppedCache).toContain('↑1200 ↓345')
    expect(droppedCache).toContain('ctx 25%')
    expect(droppedCache).toContain('running')

    const droppedTokens = secondLine(snapshot, visibleWidth(droppedCache) - 1)
    expect(droppedTokens).not.toContain('↑1200')
    expect(droppedTokens).toContain('ctx 25%')

    const droppedContext = secondLine(snapshot, visibleWidth(droppedTokens) - 1)
    expect(droppedContext).not.toContain('ctx')
    expect(droppedContext).toContain('running')
    expect(droppedContext).toContain('reasoning standard')
    expect(visibleWidth(droppedContext)).toBeLessThanOrEqual(visibleWidth(droppedTokens) - 1)
  })

  it('keeps the required segments when evicting a running turn', () => {
    const snapshot = completeSnapshot({
      status: copy.status.running,
      cacheRate: undefined,
      contextPercent: undefined,
      elapsedSeconds: undefined,
    })
    const withTokens = secondLine(snapshot, 300)

    const dropped = secondLine(snapshot, visibleWidth(withTokens) - 1)

    expect(dropped).toContain('deepseek/deepseek-chat')
    expect(dropped).toContain('high')
    expect(dropped).toContain('reasoning standard')
    expect(dropped).toContain('workspace-write')
    expect(dropped).toContain('running')
    expect(dropped).not.toContain('↑')
    expect(visibleWidth(dropped)).toBeLessThanOrEqual(visibleWidth(withTokens) - 1)
  })

  it('truncates both lines to the available width', () => {
    const lines = footer(completeSnapshot()).render(20)
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(20)
    expect(lines[0]).not.toContain('Title')
    expect(lines[1]).not.toBe('')
  })

  it('truncates the required segments only after every optional segment is gone', () => {
    const line = secondLine(completeSnapshot(), 12)

    expect(visibleWidth(line)).toBeLessThanOrEqual(12)
    expect(line.startsWith(' ')).toBe(true)
    expect(line).not.toContain('↑')
  })

  it('reads a fresh snapshot on every render', () => {
    let state = completeSnapshot({ status: copy.status.idle, elapsedSeconds: undefined })
    const component = new Footer(createPalette(false), () => state)
    expect(component.render(120)[1]).toContain('idle')
    state = completeSnapshot({ status: copy.status.running, elapsedSeconds: 7 })
    const lines = component.render(120)
    expect(lines[1]).toContain('running')
    expect(lines[1]).toContain('7s')
  })

  it('escapes control characters in the dynamic values', () => {
    const lines = footer(completeSnapshot({ title: 'bad\u0007title', model: 'm\u001b[31m' })).render(120)
    expect(lines[0]).toContain('bad\\x07title')
    expect(lines[1]).toContain('m\\x1b[31m')
  })

  it('has no cached state to invalidate', () => {
    const component = footer(completeSnapshot())
    expect(() => { component.invalidate() }).not.toThrow()
  })
})

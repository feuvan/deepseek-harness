import { afterEach, describe, expect, it } from 'vitest'
import { TeamMemberPanel } from '../../src/components/team-member-panel.ts'
import { copy, setCopyLocale } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'
import { visibleLines } from '../support/terminal.ts'

/** Keys the teammate transcript binds. */
const KEY = {
  up: '\u001b[A',
  down: '\u001b[B',
  pageUp: '\u001b[5~',
  pageDown: '\u001b[6~',
  escape: '\u001b',
} as const

afterEach(() => {
  setCopyLocale('en')
})

/** One teammate panel harness with a close recorder. */
interface MemberHarness {
  readonly panel: TeamMemberPanel
  readonly closes: number
}

/**
 * Build one teammate transcript panel.
 * @returns the panel and its close count accessor.
 */
function memberHarness(): MemberHarness {
  let closes = 0
  return {
    panel: new TeamMemberPanel(createPalette(false), () => { closes += 1 }),
    get closes() { return closes },
  }
}

/** @returns the panel's rendered lines. */
function rendered(panel: TeamMemberPanel, width = 120): string[] {
  return visibleLines(panel.render(width))
}

/** @returns numbered transcript lines. */
function lines(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `line ${String(index)}`)
}

describe('TeamMemberPanel', () => {
  it('renders the empty transcript before any teammate is presented', () => {
    const harness = memberHarness()

    expect(harness.panel.active).toBe(false)
    expect(rendered(harness.panel)).toEqual([
      '',
      `  ${copy.team.memberEmpty}`,
      ` ${copy.team.memberHint}`,
    ])
    expect(harness.panel.handleInput(KEY.down)).toBe(false)
  })

  it('presents the title and every short transcript line', () => {
    const harness = memberHarness()
    harness.panel.setTranscript('Worker', lines(3))

    expect(harness.panel.active).toBe(true)
    expect(rendered(harness.panel)).toEqual([
      copy.team.memberTitle('Worker'),
      'line 0',
      'line 1',
      'line 2',
      ` ${copy.team.memberHint}`,
    ])
  })

  it('follows the end of a long transcript and scrolls with arrows', () => {
    const harness = memberHarness()
    harness.panel.setTranscript('Worker', lines(14))

    expect(Reflect.get(harness.panel, 'offset')).toBe(4)
    harness.panel.handleInput(KEY.down)
    expect(Reflect.get(harness.panel, 'offset')).toBe(4)
    expect(rendered(harness.panel).some(line => line.includes('line 7'))).toBe(true)
    expect(rendered(harness.panel).some(line => line.startsWith('  ↑'))).toBe(true)
    expect(rendered(harness.panel).some(line => line.startsWith('  ↓'))).toBe(false)

    harness.panel.handleInput(KEY.up)
    expect(Reflect.get(harness.panel, 'offset')).toBe(3)
    harness.panel.handleInput(KEY.pageUp)
    expect(Reflect.get(harness.panel, 'offset')).toBe(0)
    harness.panel.handleInput(KEY.up)
    expect(Reflect.get(harness.panel, 'offset')).toBe(0)
    expect(rendered(harness.panel).some(line => line.includes(`  ↓ ${copy.moreRows(4)}`))).toBe(true)

    harness.panel.handleInput(KEY.pageDown)
    expect(Reflect.get(harness.panel, 'offset')).toBe(4)
    harness.panel.handleInput(KEY.down)
    expect(Reflect.get(harness.panel, 'offset')).toBe(4)
  })

  it('follows the end when one event is appended', () => {
    const harness = memberHarness()
    harness.panel.setTranscript('Worker', lines(12))
    harness.panel.handleInput(KEY.pageUp)
    expect(Reflect.get(harness.panel, 'offset')).toBe(0)

    harness.panel.append('line 12')

    expect(Reflect.get(harness.panel, 'offset')).toBe(3)
    expect(rendered(harness.panel).some(line => line.includes('line 12'))).toBe(true)
  })

  it('closes on Escape and ignores unbound keys', () => {
    const harness = memberHarness()
    harness.panel.setTranscript('Worker', ['only'])

    expect(harness.panel.handleInput('z')).toBe(false)
    expect(harness.panel.handleInput(KEY.escape)).toBe(true)
    expect(harness.closes).toBe(1)
  })

  it('renders the Chinese title, empty copy, and hint', () => {
    setCopyLocale('zh')
    const empty = memberHarness()

    expect(rendered(empty.panel)[1]).toBe(`  ${copy.team.memberEmpty}`)
    expect(rendered(empty.panel).at(-1)).toBe(` ${copy.team.memberHint}`)

    const filled = memberHarness()
    filled.panel.setTranscript('Worker', ['你好'])
    expect(rendered(filled.panel)[0]).toBe(copy.team.memberTitle('Worker'))
  })

  it('truncates long lines to the panel width', () => {
    const harness = memberHarness()
    harness.panel.setTranscript('Worker', ['a very long teammate event line that will not fit'])

    for (const line of rendered(harness.panel, 12)) expect(line.length).toBeLessThanOrEqual(30)
  })

  it('has no cached state to invalidate', () => {
    const harness = memberHarness()

    expect(() => { harness.panel.invalidate() }).not.toThrow()
  })
})

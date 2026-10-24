import { afterEach, describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TeamProjection } from '../../src/team.ts'
import { TeamPanel } from '../../src/components/team-panel.ts'
import { copy, setCopyLocale } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'
import { agentTeam, teamMember, teamTask } from '../core/harness.ts'
import { visibleLines } from '../support/terminal.ts'

/** Keys the Team panel binds. */
const KEY = {
  tab: '\t',
  right: '\u001b[C',
  left: '\u001b[D',
  shiftTab: '\u001b[Z',
  up: '\u001b[A',
  down: '\u001b[B',
  pageUp: '\u001b[5~',
  pageDown: '\u001b[6~',
  escape: '\u001b',
} as const

afterEach(() => {
  setCopyLocale('en')
})

/** One Team panel harness with its close recorder. */
interface PanelHarness {
  readonly panel: TeamPanel
  readonly closes: number
}

/**
 * Build one Team panel over the optional initial projection.
 * @param team - initial projection.
 * @returns the panel and its close count accessor.
 */
function panelHarness(team: TeamProjection | undefined = agentTeam()): PanelHarness {
  let closes = 0
  const panel = new TeamPanel(createPalette(false), () => { closes += 1 })
  panel.setTeam(team)
  return {
    panel,
    get closes() { return closes },
  }
}

/** @returns the panel's rendered lines. */
function rendered(panel: TeamPanel, width = 140): string[] {
  return visibleLines(panel.render(width))
}

describe('TeamPanel', () => {
  it('renders a title and tab bar before any projection', () => {
    const harness = panelHarness()
    harness.panel.setTeam(undefined)

    expect(harness.panel.active).toBe(false)
    expect(rendered(harness.panel)).toEqual([
      copy.team.title,
      ` ${copy.team.membersTab}  ${copy.team.tasksTab}`,
    ])
    expect(harness.panel.handleInput(KEY.down)).toBe(false)
  })

  it('renders leader-first member rows with roles, phases, and errors', () => {
    const harness = panelHarness(agentTeam({
      members: [
        teamMember(),
        teamMember({
          id: SessionId('teammate-1'), name: 'Worker', role: 'teammate', phase: 'provisioning',
        }),
        teamMember({
          id: SessionId('teammate-2'), name: 'Broken', role: 'teammate', phase: 'failed', error: 'spawn failed',
        }),
      ],
    }))

    harness.panel.setTeam(agentTeam({
      members: [
        teamMember(),
        teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate', phase: 'provisioning' }),
        teamMember({ id: SessionId('teammate-2'), name: 'Broken', role: 'teammate', phase: 'failed', error: 'spawn failed' }),
      ],
    }))
    const lines = rendered(harness.panel)

    expect(lines[0]).toBe(copy.team.title)
    expect(lines.some(line => line.includes('★ Lead'))).toBe(true)
    expect(lines.some(line => line.includes(`${copy.team.lead} · ${copy.team.phases.active}`))).toBe(true)
    expect(lines.some(line => line.includes('● Worker'))).toBe(true)
    expect(lines.some(line => line.includes(copy.team.phases.provisioning))).toBe(true)
    expect(lines.some(line => line.includes('spawn failed'))).toBe(true)
    expect(lines.at(-1)).toBe(` ${copy.team.hint}`)
  })

  it('renders every task status with owner, blockers, and write-scope warnings', () => {
    const harness = panelHarness()
    harness.panel.setTeam(agentTeam({
      tasks: [
        teamTask({ id: 'ready', subject: 'Ready subject' }),
        teamTask({ id: 'blocked', subject: 'Blocked subject', ready: false, blockedBy: ['other'] }),
        teamTask({ id: 'running', subject: 'Running subject', status: 'in_progress', ownerName: 'Worker' }),
        teamTask({ id: 'done', subject: 'Done subject', status: 'completed', writeScopeWarnings: ['a.ts', 'b.ts'] }),
      ],
    }))

    harness.panel.handleInput(KEY.tab)
    const lines = rendered(harness.panel)

    expect(lines.some(line => line.includes(`○ ${copy.team.statuses.ready}`) && line.includes('Ready subject'))).toBe(true)
    expect(lines.some(line => line.includes(`⊘ ${copy.team.statuses.blocked}`)
      && line.includes('Blocked subject') && line.includes('← other'))).toBe(true)
    expect(lines.some(line => line.includes(`● ${copy.team.statuses.inProgress}`)
      && line.includes('Running subject') && line.includes('@Worker'))).toBe(true)
    expect(lines.some(line => line.includes(`✓ ${copy.team.statuses.completed}`)
      && line.includes('Done subject') && line.includes('!2'))).toBe(true)
  })

  it('switches tabs with Tab/Right and Shift+Tab/Left and resets scrolling', () => {
    const harness = panelHarness(agentTeam({ tasks: Array.from({ length: 9 }, (_, index) => teamTask({ id: `task-${String(index)}` })) }))
    harness.panel.setTeam(agentTeam({ tasks: Array.from({ length: 9 }, (_, index) => teamTask({ id: `task-${String(index)}` })) }))

    harness.panel.handleInput(KEY.tab)
    harness.panel.handleInput(KEY.pageDown)
    expect(rendered(harness.panel).some(line => line.startsWith('  ↑'))).toBe(true)

    harness.panel.handleInput(KEY.left)
    expect(rendered(harness.panel).some(line => line.includes('★ Lead'))).toBe(true)
    harness.panel.handleInput(KEY.right)
    expect(rendered(harness.panel).some(line => line.startsWith('  ↑'))).toBe(false)

    harness.panel.handleInput(KEY.shiftTab)
    expect(rendered(harness.panel).some(line => line.includes('★ Lead'))).toBe(true)
  })

  it('scrolls one row per arrow key and one page per page key with clamping', () => {
    const tasks = Array.from({ length: 9 }, (_, index) => teamTask({
      id: `task-${String(index)}`,
      subject: `Subject ${String(index)}`,
    }))
    const harness = panelHarness()
    harness.panel.setTeam(agentTeam({ tasks }))
    harness.panel.handleInput(KEY.tab)

    expect(rendered(harness.panel).some(line => line.includes(`  ↓ ${copy.moreRows(3)}`))).toBe(true)
    harness.panel.handleInput(KEY.down)
    expect(rendered(harness.panel).some(line => line.includes('Subject 6'))).toBe(true)
    harness.panel.handleInput(KEY.pageDown)
    expect(rendered(harness.panel).some(line => line.includes(`  ↑ ${copy.moreRows(3)}`))).toBe(true)
    harness.panel.handleInput(KEY.pageDown)
    harness.panel.handleInput(KEY.pageDown)
    expect(rendered(harness.panel).some(line => line.includes('Subject 8'))).toBe(true)
    harness.panel.handleInput(KEY.pageUp)
    expect(rendered(harness.panel).some(line => line.includes('Subject 0'))).toBe(true)
    harness.panel.handleInput(KEY.up)
    harness.panel.handleInput(KEY.up)
    expect(rendered(harness.panel).some(line => line.includes('Subject 0'))).toBe(true)
  })

  it('clamps the scroll offset when the projection shrinks', () => {
    const harness = panelHarness()
    harness.panel.setTeam(agentTeam({ tasks: Array.from({ length: 9 }, (_, index) => teamTask({ id: `task-${String(index)}` })) }))
    harness.panel.handleInput(KEY.tab)
    harness.panel.handleInput(KEY.pageDown)
    harness.panel.handleInput(KEY.pageDown)

    harness.panel.setTeam(agentTeam({ tasks: [teamTask({ id: 'only', subject: 'Only task' })] }))

    const lines = rendered(harness.panel)
    expect(lines.some(line => line.includes('Only task'))).toBe(true)
    expect(lines.some(line => line.startsWith('  ↑'))).toBe(false)
  })

  it('renders empty tabs, the failure line, and closes on Escape', () => {
    const harness = panelHarness(agentTeam({ members: [], failure: 'rejected record' }))
    harness.panel.setTeam(agentTeam({ members: [], failure: 'rejected record' }))

    const members = rendered(harness.panel)
    expect(members[2]).toContain(copy.team.failure)
    expect(members[3]).toBe(`  ${copy.team.emptyMembers}`)

    harness.panel.handleInput(KEY.tab)
    expect(rendered(harness.panel).some(line => line.includes(copy.team.emptyTasks))).toBe(true)

    harness.panel.handleInput(KEY.escape)
    expect(harness.closes).toBe(1)
    expect(harness.panel.handleInput('z')).toBe(false)
  })

  it('clears its projection on setTeam(undefined)', () => {
    const harness = panelHarness()
    harness.panel.setTeam(agentTeam())
    expect(harness.panel.active).toBe(true)

    harness.panel.setTeam(undefined)

    expect(harness.panel.active).toBe(false)
    expect(rendered(harness.panel)).toHaveLength(2)
  })

  it('renders the Chinese labels', () => {
    setCopyLocale('zh')
    const harness = panelHarness()
    harness.panel.setTeam(agentTeam({
      members: [teamMember(), teamMember({ id: SessionId('t1'), name: 'Worker', role: 'teammate' })],
    }))

    const lines = rendered(harness.panel)
    expect(lines[0]).toBe(copy.team.title)
    expect(lines[1]).toBe(` ${copy.team.membersTab}  ${copy.team.tasksTab}`)
    expect(lines.some(line => line.includes(copy.team.phases.active))).toBe(true)
    expect(lines.at(-1)).toBe(` ${copy.team.hint}`)
  })

  it('truncates every line to the panel width', () => {
    const harness = panelHarness()
    harness.panel.setTeam(agentTeam({
      members: [teamMember(), teamMember({
        id: SessionId('t1'), name: 'A very long teammate name that will not fit', role: 'teammate', error: 'long failure text that will also not fit',
      })],
      tasks: [teamTask({ subject: 'A very long task subject that will not fit either' })],
    }))

    for (const line of rendered(harness.panel, 16)) expect(visibleWidth(line)).toBeLessThanOrEqual(16)
    harness.panel.handleInput(KEY.tab)
    for (const line of rendered(harness.panel, 16)) expect(visibleWidth(line)).toBeLessThanOrEqual(16)
  })

  it('reports a zero row count defensively without a projection', () => {
    const harness = panelHarness()
    harness.panel.setTeam(undefined)
    const rowCount = Reflect.get(harness.panel, 'rowCount') as () => number

    expect(rowCount.call(harness.panel)).toBe(0)
  })

  it('has no cached state to invalidate', () => {
    const harness = panelHarness()

    expect(() => { harness.panel.invalidate() }).not.toThrow()
  })
})

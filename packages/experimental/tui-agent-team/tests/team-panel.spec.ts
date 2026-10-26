import { afterEach, describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TeamPanel, type TeamPanelHandlers } from '../src/components/team-panel.ts'
import { copy, setCopyLocale } from '../src/copy.ts'
import { paletteDouble, teamMember, teamProjection, teamTask } from './harness.ts'

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
  enter: '\r',
  escape: '\u001b',
} as const

afterEach(() => {
  setCopyLocale('en')
})

/** One Team panel harness with its action recordings. */
interface PanelHarness {
  readonly panel: TeamPanel
  readonly palette: ReturnType<typeof paletteDouble>
  readonly opens: { name: string }[]
  readonly messages: { name: string }[]
  readonly claims: { id: string; revision: number }[]
  readonly completes: { id: string; revision: number }[]
  readonly creates: number
  readonly closes: number
}

/**
 * Build one Team panel over recording handlers.
 * @param team - initial projection.
 * @returns the panel and its recordings.
 */
function panelHarness(team: Parameters<TeamPanel['setTeam']>[0] = teamProjection()): PanelHarness {
  const state = {
    opens: [] as { name: string }[],
    messages: [] as { name: string }[],
    claims: [] as { id: string; revision: number }[],
    completes: [] as { id: string; revision: number }[],
    creates: 0,
    closes: 0,
  }
  const handlers: TeamPanelHandlers = {
    close: () => { state.closes += 1 },
    openMember: (member) => { state.opens.push({ name: member.name }) },
    messageMember: (member) => { state.messages.push({ name: member.name }) },
    claimTask: (task) => { state.claims.push({ id: task.id, revision: task.revision }) },
    completeTask: (task) => { state.completes.push({ id: task.id, revision: task.revision }) },
    createTask: () => { state.creates += 1 },
  }
  const palette = paletteDouble()
  const panel = new TeamPanel(palette.palette, handlers)
  Reflect.set(panel, 'team', team)
  return {
    panel,
    palette,
    get opens() { return state.opens },
    get messages() { return state.messages },
    get claims() { return state.claims },
    get completes() { return state.completes },
    get creates() { return state.creates },
    get closes() { return state.closes },
  }
}

/** @returns the panel's rendered lines. */
function rendered(panel: TeamPanel, width = 140): string[] {
  return panel.render(width)
}

/** @returns whether some line contains the needle. */
function hasLine(lines: readonly string[], needle: string): boolean {
  return lines.some(line => line.includes(needle))
}

/** @returns whether the selected marker sits on the line containing the needle. */
function selected(lines: readonly string[], needle: string): boolean {
  return lines.some(line => line.includes('❯') && line.includes(needle))
}

describe('TeamPanel', () => {
  it('renders only the title before any projection', () => {
    const harness = panelHarness()
    harness.panel.setTeam(undefined)

    expect(harness.panel.active).toBe(false)
    expect(rendered(harness.panel)).toEqual([copy.team.title])
    expect(harness.panel.handleInput(KEY.down)).toBe(false)
  })

  it('renders readiness, counts, the member table, and contextual member keys', () => {
    const harness = panelHarness(teamProjection({
      members: [
        teamMember(),
        teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate', phase: 'provisioning' }),
        teamMember({ id: SessionId('teammate-2'), name: 'Broken', role: 'teammate', phase: 'failed', error: 'spawn failed' }),
      ],
    }))
    const lines = rendered(harness.panel)

    expect(lines[0]).toBe(copy.team.title)
    expect(lines[1]).toContain(copy.team.degradedStatus)
    expect(lines[1]).toContain(copy.team.summary(3, 0, 0))
    expect(lines[1]).toContain(copy.team.failed(1))
    expect(lines[2]).toContain(` ${copy.team.membersTab} 3 `)
    expect(lines[2]).toContain(` ${copy.team.tasksTab} 0 `)
    expect(lines[3]).toBe(`  ${copy.team.membersHeader}`)
    expect(selected(lines, `★ Lead  ${copy.team.lead}`)).toBe(true)
    expect(hasLine(lines, `● Worker  ${copy.team.teammate}`)).toBe(true)
    expect(hasLine(lines, copy.team.phases.provisioning)).toBe(true)
    expect(hasLine(lines, '! Broken')).toBe(true)
    expect(hasLine(lines, 'spawn failed')).toBe(true)
    expect(lines.at(-1)).toBe(`  ${copy.team.footerMember} · ${copy.team.footerCommon}`)
    expect(harness.palette.calls).toContain('warning')
  })

  it('reports degraded readiness with a failure line', () => {
    const harness = panelHarness(teamProjection({
      members: [teamMember(), teamMember({ id: SessionId('t1'), name: 'Worker', role: 'teammate' })],
      failure: 'rejected record',
    }))
    const lines = rendered(harness.panel)

    expect(lines[1]).toContain(copy.team.degradedStatus)
    expect(lines[2]).toBe(`  ${copy.team.failure}: rejected record`)
    expect(lines[3]).toContain(` ${copy.team.membersTab} 2 `)
  })

  it('summarizes in-progress tasks and keeps tab counts current', () => {
    const harness = panelHarness(teamProjection({
      tasks: [
        teamTask({ id: 'a', status: 'in_progress', ownerName: 'Worker' }),
        teamTask({ id: 'b' }),
      ],
    }))
    harness.panel.handleInput(KEY.tab)

    const lines = rendered(harness.panel)
    expect(lines[1]).toContain(copy.team.summary(1, 2, 1))
    expect(lines[2]).toContain(` ${copy.team.tasksTab} 2 `)
  })

  it('moves the selection marker one row per arrow key and clamps at both ends', () => {
    const harness = panelHarness(teamProjection({
      members: [teamMember(), teamMember({ id: SessionId('t1'), name: 'One', role: 'teammate' })],
    }))

    expect(selected(rendered(harness.panel), '★ Lead')).toBe(true)
    harness.panel.handleInput(KEY.down)
    expect(selected(rendered(harness.panel), '● One')).toBe(true)
    harness.panel.handleInput(KEY.down)
    expect(selected(rendered(harness.panel), '● One')).toBe(true)
    harness.panel.handleInput(KEY.up)
    expect(selected(rendered(harness.panel), '★ Lead')).toBe(true)
    harness.panel.handleInput(KEY.up)
    expect(selected(rendered(harness.panel), '★ Lead')).toBe(true)
  })

  it('pages the cursor by eight rows and scrolls the window', () => {
    const tasks = Array.from({ length: 9 }, (_, index) => teamTask({
      id: `task-${String(index)}`,
      subject: `Subject ${String(index)}`,
    }))
    const harness = panelHarness(teamProjection({ tasks }))
    harness.panel.handleInput(KEY.tab)

    expect(hasLine(rendered(harness.panel), `↓ ${copy.moreRows(1)}`)).toBe(true)
    expect(selected(rendered(harness.panel), 'Subject 0')).toBe(true)
    harness.panel.handleInput(KEY.pageDown)
    expect(selected(rendered(harness.panel), 'Subject 8')).toBe(true)
    expect(hasLine(rendered(harness.panel), `↑ ${copy.moreRows(1)}`)).toBe(true)
    expect(hasLine(rendered(harness.panel), `↓ ${copy.moreRows(1)}`)).toBe(false)
    harness.panel.handleInput(KEY.pageUp)
    expect(selected(rendered(harness.panel), 'Subject 0')).toBe(true)
    expect(hasLine(rendered(harness.panel), `↓ ${copy.moreRows(1)}`)).toBe(true)
    harness.panel.handleInput(KEY.pageDown)
    harness.panel.handleInput(KEY.up)
    expect(selected(rendered(harness.panel), 'Subject 7')).toBe(true)
    expect(hasLine(rendered(harness.panel), `↑ ${copy.moreRows(1)}`)).toBe(true)
  })

  it('renders eight rows at most and marks the selected row across the width', () => {
    const members = Array.from({ length: 11 }, (_, index) => teamMember({
      id: SessionId(`member-${String(index)}`),
      name: `Member ${String(index)}`,
      role: 'teammate',
    }))
    const harness = panelHarness(teamProjection({ members }))
    const lines = rendered(harness.panel, 60)
    const rows = lines.filter(line => line.includes('● Member'))
    const selectedLine = lines.find(line => line.includes('❯')) ?? ''

    expect(rows).toHaveLength(8)
    expect(visibleWidth(selectedLine)).toBe(60)
    expect(selectedLine.startsWith(' ❯ ')).toBe(true)
    expect(rows.some(line => line.startsWith('   '))).toBe(true)
    expect(hasLine(lines, `↓ ${copy.moreRows(3)}`)).toBe(true)
  })

  it('renders every task status with aligned columns, owner, blockers, and warnings', () => {
    const harness = panelHarness(teamProjection({
      tasks: [
        teamTask({ id: 'ready', subject: 'Ready subject', revision: 4 }),
        teamTask({ id: 'blocked', subject: 'Blocked subject', ready: false, blockedBy: ['other'] }),
        teamTask({ id: 'running', subject: 'Running subject', status: 'in_progress', ownerName: 'Worker' }),
        teamTask({ id: 'done', subject: 'Done subject', status: 'completed', writeScopeWarnings: ['a.ts', 'b.ts'] }),
      ],
    }))
    harness.panel.handleInput(KEY.tab)
    const lines = rendered(harness.panel)

    expect(lines[3]).toBe(`  ${copy.team.tasksHeader}`)
    expect(hasLine(lines, copy.team.statuses.ready) && hasLine(lines, 'Ready subject')).toBe(true)
    expect(hasLine(lines, copy.team.statuses.blocked)
      && hasLine(lines, 'Blocked subject') && hasLine(lines, '← other')).toBe(true)
    expect(hasLine(lines, copy.team.statuses.inProgress)
      && hasLine(lines, 'Running subject') && hasLine(lines, '@Worker')).toBe(true)
    expect(hasLine(lines, copy.team.statuses.completed)
      && hasLine(lines, 'Done subject') && hasLine(lines, '!2')).toBe(true)
  })

  it('shows contextual task footers for claim, complete, and no-action rows', () => {
    const harness = panelHarness(teamProjection({
      tasks: [
        teamTask({ id: 'ready', subject: 'Ready subject' }),
        teamTask({ id: 'running', subject: 'Running subject', status: 'in_progress', ownerName: 'Worker' }),
        teamTask({ id: 'done', subject: 'Done subject', status: 'completed' }),
      ],
    }))
    harness.panel.handleInput(KEY.tab)
    expect(rendered(harness.panel).at(-1)).toBe(`  ${copy.team.footerClaim} · ${copy.team.footerCommon}`)

    harness.panel.handleInput(KEY.down)
    expect(rendered(harness.panel).at(-1)).toBe(`  ${copy.team.footerComplete} · ${copy.team.footerCommon}`)

    harness.panel.handleInput(KEY.down)
    expect(rendered(harness.panel).at(-1)).toBe(`  ${copy.team.footerNoAction} · ${copy.team.footerCommon}`)
  })

  it('switches tabs with Tab/Right and Shift+Tab/Left and resets the cursor', () => {
    const harness = panelHarness(teamProjection({
      members: [teamMember(), teamMember({ id: SessionId('t1'), name: 'One', role: 'teammate' })],
      tasks: [teamTask({ subject: 'Only task' })],
    }))
    harness.panel.handleInput(KEY.down)

    harness.panel.handleInput(KEY.tab)
    expect(Reflect.get(harness.panel, 'tab')).toBe('tasks')
    expect(Reflect.get(harness.panel, 'index')).toBe(0)
    expect(selected(rendered(harness.panel), 'Only task')).toBe(true)

    harness.panel.handleInput(KEY.left)
    expect(Reflect.get(harness.panel, 'tab')).toBe('members')
    harness.panel.handleInput(KEY.right)
    expect(Reflect.get(harness.panel, 'tab')).toBe('tasks')
    harness.panel.handleInput(KEY.shiftTab)
    expect(Reflect.get(harness.panel, 'tab')).toBe('members')
  })

  it('clamps the cursor when the projection shrinks and clears its message', () => {
    const harness = panelHarness(teamProjection({
      members: [teamMember(), teamMember({ id: SessionId('t1'), name: 'One', role: 'teammate' })],
    }))
    harness.panel.handleInput(KEY.down)
    harness.panel.handleInput(KEY.enter)
    expect(harness.opens).toHaveLength(1)
    harness.panel.handleInput(KEY.down)

    harness.panel.setTeam(teamProjection())

    expect(Reflect.get(harness.panel, 'index')).toBe(0)
    expect(selected(rendered(harness.panel), '★ Lead')).toBe(true)
  })

  it('dispatches member actions and creates tasks from either tab', () => {
    const harness = panelHarness(teamProjection({
      members: [teamMember(), teamMember({ id: SessionId('t1'), name: 'One', role: 'teammate' })],
    }))
    harness.panel.handleInput(KEY.down)

    expect(harness.panel.handleInput(KEY.enter)).toBe(true)
    expect(harness.panel.handleInput('m')).toBe(true)
    expect(harness.panel.handleInput('n')).toBe(true)
    expect(harness.opens).toEqual([{ name: 'One' }])
    expect(harness.messages).toEqual([{ name: 'One' }])
    expect(harness.creates).toBe(1)
    expect(harness.panel.handleInput('z')).toBe(false)
  })

  it('explains unavailable failed members instead of opening them', () => {
    const harness = panelHarness(teamProjection({
      members: [
        teamMember(),
        teamMember({ id: SessionId('t1'), name: 'Broken', role: 'teammate', phase: 'failed', error: 'spawn failed' }),
      ],
    }))
    harness.panel.handleInput(KEY.down)

    expect(harness.panel.handleInput(KEY.enter)).toBe(true)
    expect(harness.opens).toEqual([])
    expect(hasLine(rendered(harness.panel), copy.team.memberUnavailable('Broken'))).toBe(true)

    harness.panel.handleInput(KEY.down)
    expect(hasLine(rendered(harness.panel), copy.team.memberUnavailable('Broken'))).toBe(false)

    harness.panel.handleInput(KEY.down)
    expect(harness.panel.handleInput('m')).toBe(true)
    expect(harness.messages).toEqual([])
    expect(hasLine(rendered(harness.panel), copy.team.memberUnavailable('Broken'))).toBe(true)

    harness.panel.handleInput(KEY.tab)
    expect(hasLine(rendered(harness.panel), copy.team.memberUnavailable('Broken'))).toBe(false)
  })

  it('dispatches task transitions only from the matching status', () => {
    const harness = panelHarness(teamProjection({
      tasks: [
        teamTask({ id: 'first', revision: 7 }),
        teamTask({ id: 'second', revision: 9, status: 'in_progress', ownerName: 'Worker' }),
      ],
    }))
    harness.panel.handleInput(KEY.tab)

    expect(harness.panel.handleInput('a')).toBe(true)
    expect(harness.panel.handleInput('c')).toBe(true)
    expect(harness.claims).toEqual([{ id: 'first', revision: 7 }])
    expect(harness.completes).toEqual([])
    expect(hasLine(rendered(harness.panel), copy.team.taskNotCompletable(copy.team.statuses.ready))).toBe(true)

    harness.panel.handleInput(KEY.down)
    expect(hasLine(rendered(harness.panel), copy.team.taskNotCompletable(copy.team.statuses.ready))).toBe(false)
    expect(harness.panel.handleInput('a')).toBe(true)
    expect(harness.claims).toHaveLength(1)
    expect(hasLine(rendered(harness.panel), copy.team.taskNotClaimable(copy.team.statuses.inProgress))).toBe(true)
    expect(harness.panel.handleInput('c')).toBe(true)
    expect(harness.completes).toEqual([{ id: 'second', revision: 9 }])
    expect(harness.panel.handleInput('n')).toBe(true)
    expect(harness.creates).toBe(1)
    expect(harness.panel.handleInput(KEY.enter)).toBe(false)
  })

  it('rejects claims for blocked, owned, and completed tasks', () => {
    const owned = teamProjection({
      tasks: [
        teamTask({ id: 'blocked', ready: false, blockedBy: ['other'] }),
        teamTask({ id: 'owned', ownerName: 'Worker' }),
        teamTask({ id: 'done', status: 'completed' }),
      ],
    })
    const harness = panelHarness(owned)
    harness.panel.handleInput(KEY.tab)

    expect(harness.panel.handleInput('a')).toBe(true)
    expect(hasLine(rendered(harness.panel), copy.team.taskNotClaimable(copy.team.statuses.blocked))).toBe(true)
    harness.panel.handleInput(KEY.down)
    expect(harness.panel.handleInput('a')).toBe(true)
    expect(harness.claims).toEqual([])
    harness.panel.handleInput(KEY.down)
    expect(harness.panel.handleInput('a')).toBe(true)
    expect(harness.panel.handleInput('c')).toBe(true)
    expect(hasLine(rendered(harness.panel), copy.team.taskNotCompletable(copy.team.statuses.completed))).toBe(true)
    expect(harness.claims).toEqual([])
    expect(harness.completes).toEqual([])
  })

  it('creates a task from an empty tab and ignores row actions', () => {
    const harness = panelHarness(teamProjection({ members: [] }))

    expect(harness.panel.handleInput(KEY.enter)).toBe(false)
    expect(harness.panel.handleInput('m')).toBe(false)
    expect(harness.panel.handleInput('n')).toBe(true)
    harness.panel.handleInput(KEY.tab)
    expect(harness.panel.handleInput('a')).toBe(false)
    expect(harness.panel.handleInput('c')).toBe(false)
    expect(harness.panel.handleInput('n')).toBe(true)
    expect(harness.creates).toBe(2)
    expect(harness.opens).toEqual([])
    expect(harness.claims).toEqual([])
    expect(harness.completes).toEqual([])

    const emptyLines = rendered(harness.panel)
    expect(emptyLines.at(-1)).toBe(`  ${copy.team.footerCommon}`)
    expect(hasLine(emptyLines, copy.team.emptyTasks)).toBe(true)
  })

  it('renders empty tabs, the failure line, and closes on Escape', () => {
    const harness = panelHarness(teamProjection({ members: [], failure: 'rejected record' }))

    const members = rendered(harness.panel)
    expect(members[1]).toContain(copy.team.degradedStatus)
    expect(members[2]).toContain(copy.team.failure)
    expect(members[3]).toContain(` ${copy.team.membersTab} 0 `)
    expect(members[4]).toBe(`  ${copy.team.membersHeader}`)
    expect(members[5]).toBe(`  ${copy.team.emptyMembers}`)
    expect(members.at(-1)).toBe(`  ${copy.team.footerCommon}`)

    harness.panel.handleInput(KEY.tab)
    expect(hasLine(rendered(harness.panel), copy.team.emptyTasks)).toBe(true)

    harness.panel.handleInput(KEY.escape)
    expect(harness.closes).toBe(1)
  })

  it('clears its projection on setTeam(undefined)', () => {
    const harness = panelHarness()
    expect(harness.panel.active).toBe(true)

    harness.panel.setTeam(undefined)

    expect(harness.panel.active).toBe(false)
    expect(rendered(harness.panel)).toEqual([copy.team.title])
  })

  it('renders the Chinese labels', () => {
    setCopyLocale('zh')
    const harness = panelHarness(teamProjection({
      members: [teamMember(), teamMember({ id: SessionId('t1'), name: 'Worker', role: 'teammate' })],
    }))

    const lines = rendered(harness.panel)
    expect(lines[0]).toBe(copy.team.title)
    expect(lines[1]).toContain(copy.team.readyStatus)
    expect(lines[2]).toContain(` ${copy.team.membersTab} 2 `)
    expect(lines[3]).toBe(`  ${copy.team.membersHeader}`)
    expect(hasLine(lines, copy.team.phases.active)).toBe(true)
    expect(lines.at(-1)).toBe(`  ${copy.team.footerMember} · ${copy.team.footerCommon}`)
  })

  it('truncates every line to the panel width', () => {
    const harness = panelHarness(teamProjection({
      members: [teamMember(), teamMember({
        id: SessionId('t1'), name: 'A very long teammate name that will not fit', role: 'teammate', error: 'long failure text that will also not fit',
      })],
      tasks: [teamTask({ subject: 'A very long task subject that will not fit either' })],
    }))

    for (const line of rendered(harness.panel, 16)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(19)
    }
    harness.panel.handleInput(KEY.tab)
    for (const line of rendered(harness.panel, 16)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(35)
    }
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

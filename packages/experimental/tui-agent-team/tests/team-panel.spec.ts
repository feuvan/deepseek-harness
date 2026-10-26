import { afterEach, describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  TeamPanel,
  type TeamMemberRuntime,
  type TeamPanelHandlers,
} from '../src/components/team-panel.ts'
import { copy, setCopyLocale } from '../src/copy.ts'
import { paletteDouble, teamMember, teamProjection, teamTask } from './harness.ts'

/** Keys the Team panel accepts. */
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

/** One Team panel harness and its action recordings. */
interface PanelHarness {
  readonly panel: TeamPanel
  readonly opens: { name: string }[]
  readonly closes: number
  readonly runtimeCalls: string[]
}

/**
 * Build one read-only Team panel over recording handlers.
 * @param team - initial projection.
 * @param runtime - per-member runtime facts keyed by Session id.
 * @returns the panel and its recordings.
 */
function panelHarness(
  team: Parameters<TeamPanel['setTeam']>[0] = teamProjection(),
  runtime: Readonly<Record<string, TeamMemberRuntime>> = {},
): PanelHarness {
  const opens: { name: string }[] = []
  const runtimeCalls: string[] = []
  const state = { closes: 0 }
  const handlers: TeamPanelHandlers = {
    close: () => { state.closes += 1 },
    openMember: (member) => { opens.push({ name: member.name }) },
  }
  const panel = new TeamPanel(paletteDouble().palette, handlers, (id) => {
    runtimeCalls.push(id)
    return runtime[id] ?? { status: 'inactive' }
  })
  panel.setTeam(team)
  return {
    panel,
    opens,
    runtimeCalls,
    get closes() { return state.closes },
  }
}

/** @returns the panel's rendered lines. */
function rendered(panel: TeamPanel, width = 120): string[] {
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

describe('TeamPanel read-only list', () => {
  it('renders only the title before any projection', () => {
    const harness = panelHarness()
    harness.panel.setTeam(undefined)

    expect(harness.panel.active).toBe(false)
    expect(rendered(harness.panel)).toEqual([copy.team.title])
    expect(harness.panel.handleInput(KEY.down)).toBe(false)
  })

  it('renders native member statuses, the current tag, models, and errors', () => {
    const harness = panelHarness(
      teamProjection({
        members: [
          teamMember(),
          teamMember({ id: SessionId('t1'), name: 'Running', role: 'teammate', phase: 'active' }),
          teamMember({ id: SessionId('t2'), name: 'Idle', role: 'teammate', phase: 'active' }),
          teamMember({ id: SessionId('t3'), name: 'Waking', role: 'teammate', phase: 'provisioning' }),
          teamMember({ id: SessionId('t4'), name: 'Broken', role: 'teammate', phase: 'failed', error: 'spawn failed' }),
        ],
      }),
      {
        't1': { status: 'running', model: 'alpha/m-1' },
        't2': { status: 'inactive' },
      },
    )
    const lines = rendered(harness.panel)

    expect(lines[0]).toBe(copy.team.title)
    expect(lines[1]).toContain(` ${copy.team.membersTab} 5 `)
    expect(lines[1]).toContain(` ${copy.team.tasksTab} 0 `)
    expect(hasLine(lines, `○ Lead [${copy.team.current}]  ${copy.team.memberStatuses.inactive}`)).toBe(true)
    expect(hasLine(lines, `● Running  ${copy.team.memberStatuses.running}`)).toBe(true)
    expect(hasLine(lines, `${copy.team.model}: alpha/m-1`)).toBe(true)
    expect(hasLine(lines, `○ Idle  ${copy.team.memberStatuses.inactive}`)).toBe(true)
    expect(hasLine(lines, `● Waking  ${copy.team.memberStatuses.provisioning}`)).toBe(true)
    expect(hasLine(lines, `! Broken  ${copy.team.memberStatuses.failed}`)).toBe(true)
    expect(hasLine(lines, 'spawn failed')).toBe(true)
    expect(selected(lines, 'Lead')).toBe(true)
    expect(lines.at(-1)).toBe(`  ${copy.team.hint}`)

    harness.panel.handleInput(KEY.down)
    expect(hasLine(rendered(harness.panel), `Running  ${copy.team.memberStatuses.running}`)).toBe(true)
  })

  it('derives status from phase before live runtime and marks only the lead as current', () => {
    const harness = panelHarness(
      teamProjection({
        members: [
          teamMember({ id: SessionId('lead'), name: 'Lead', role: 'lead', phase: 'active' }),
          teamMember({ id: SessionId('p1'), name: 'Provisioning', role: 'teammate', phase: 'provisioning' }),
          teamMember({ id: SessionId('f1'), name: 'Failed', role: 'teammate', phase: 'failed' }),
          teamMember({ id: SessionId('a1'), name: 'Active', role: 'teammate', phase: 'active' }),
        ],
      }),
      {
        'lead': { status: 'running' },
        'p1': { status: 'running' },
        'f1': { status: 'running' },
        'a1': { status: 'running' },
      },
    )
    const lines = rendered(harness.panel)

    expect(hasLine(lines, `● Lead [${copy.team.current}]  ${copy.team.memberStatuses.running}`)).toBe(true)
    expect(hasLine(lines, `● Provisioning  ${copy.team.memberStatuses.provisioning}`)).toBe(true)
    expect(hasLine(lines, `! Failed  ${copy.team.memberStatuses.failed}`)).toBe(true)
    expect(hasLine(lines, `● Active  ${copy.team.memberStatuses.running}`)).toBe(true)
    expect(hasLine(lines, copy.team.memberStatuses.inactive)).toBe(false)
    expect(lines.some(line => line.includes(`Active${copy.team.current}`))).toBe(false)
  })

  it('renders native task statuses, readiness, owners, and subjects', () => {
    const harness = panelHarness(teamProjection({
      tasks: [
        teamTask({ id: 'ready', subject: 'Ready subject' }),
        teamTask({ id: 'blocked', subject: 'Blocked subject', ready: false, blockedBy: ['other'] }),
        teamTask({ id: 'running', subject: 'Running subject', status: 'in_progress', ownerName: 'Worker' }),
        teamTask({ id: 'done', subject: 'Done subject', status: 'completed' }),
      ],
    }))
    harness.panel.handleInput(KEY.tab)
    const lines = rendered(harness.panel)

    expect(lines[1]).toContain(` ${copy.team.tasksTab} 4 `)
    expect(hasLine(lines, `○ ${copy.team.statuses.pending} · ${copy.team.readyLabel} · ${copy.team.owner}: ${copy.team.unowned}  Ready subject`)).toBe(true)
    expect(hasLine(lines, `⊘ ${copy.team.statuses.pending} · ${copy.team.blockedLabel} · ${copy.team.owner}: ${copy.team.unowned}  Blocked subject`)).toBe(true)
    expect(hasLine(lines, `● ${copy.team.statuses.inProgress} · ${copy.team.owner}: @Worker  Running subject`)).toBe(true)
    expect(hasLine(lines, `✓ ${copy.team.statuses.completed} · ${copy.team.owner}: ${copy.team.unowned}  Done subject`)).toBe(true)
    expect(lines.at(-1)).toBe(`  ${copy.team.hint}`)
  })

  it('shows the native empty-task and failure copy', () => {
    const empty = panelHarness(teamProjection({ tasks: [] }))
    empty.panel.handleInput(KEY.tab)
    const emptyLines = rendered(empty.panel)
    expect(hasLine(emptyLines, copy.team.emptyTasks)).toBe(true)

    const failed = panelHarness(teamProjection({ failure: 'rejected record' }))
    const failedLines = rendered(failed.panel)
    expect(failedLines[1]).toBe(`  ${copy.team.failure('rejected record')}`)
    expect(failedLines[2]).toContain(` ${copy.team.membersTab}`)
  })

  it('moves the cursor, switches sections, and clamps at both ends', () => {
    const harness = panelHarness(teamProjection({
      members: [teamMember(), teamMember({ id: SessionId('t1'), name: 'One', role: 'teammate' })],
      tasks: [teamTask({ subject: 'Only task' })],
    }))

    expect(selected(rendered(harness.panel), 'Lead')).toBe(true)
    harness.panel.handleInput(KEY.down)
    expect(selected(rendered(harness.panel), 'One')).toBe(true)
    harness.panel.handleInput(KEY.down)
    expect(selected(rendered(harness.panel), 'One')).toBe(true)
    harness.panel.handleInput(KEY.up)
    expect(selected(rendered(harness.panel), 'Lead')).toBe(true)

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
    expect(harness.panel.handleInput('x')).toBe(false)
  })

  it('pages by eight rows and shows overflow indicators', () => {
    const tasks = Array.from({ length: 10 }, (_, index) => teamTask({
      id: `task-${String(index)}`,
      subject: `Subject ${String(index)}`,
    }))
    const harness = panelHarness(teamProjection({ tasks }))
    harness.panel.handleInput(KEY.tab)

    expect(hasLine(rendered(harness.panel), `↓ ${copy.moreRows(2)}`)).toBe(true)
    expect(selected(rendered(harness.panel), 'Subject 0')).toBe(true)
    harness.panel.handleInput(KEY.pageDown)
    expect(hasLine(rendered(harness.panel), `↑ ${copy.moreRows(2)}`)).toBe(true)
    expect(hasLine(rendered(harness.panel), `↓ ${copy.moreRows(0)}`)).toBe(false)
    expect(selected(rendered(harness.panel), 'Subject 8')).toBe(true)
    harness.panel.handleInput(KEY.down)
    expect(selected(rendered(harness.panel), 'Subject 9')).toBe(true)
    harness.panel.handleInput(KEY.pageUp)
    expect(selected(rendered(harness.panel), 'Subject 1')).toBe(true)
  })

  it('clamps the cursor when the projection shrinks and clears on setTeam(undefined)', () => {
    const harness = panelHarness(teamProjection({
      members: [
        teamMember(),
        teamMember({ id: SessionId('t1'), name: 'One', role: 'teammate', phase: 'active' }),
      ],
    }))
    harness.panel.handleInput(KEY.down)

    harness.panel.setTeam(teamProjection())
    expect(Reflect.get(harness.panel, 'index')).toBe(0)
    expect(selected(rendered(harness.panel), 'Lead')).toBe(true)

    harness.panel.handleInput(KEY.down)
    harness.panel.handleInput(KEY.enter)
    expect(harness.opens).toEqual([])
    harness.panel.setTeam(undefined)
    expect(rendered(harness.panel)).toEqual([copy.team.title])
  })

  it('truncates list rows and the full-width selected row', () => {
    const harness = panelHarness(teamProjection({
      members: [
        teamMember({ name: 'A very long lead name that will not fit at all' }),
        teamMember({
          id: SessionId('t1'),
          name: 'A very long teammate name that will not fit',
          role: 'teammate',
          phase: 'failed',
          error: 'A long failure message that will not fit either',
        }),
      ],
    }))

    for (const line of rendered(harness.panel, 24)) expect(visibleWidth(line)).toBeLessThanOrEqual(24)
    const selectedLine = rendered(harness.panel, 24).find(line => line.includes('❯')) ?? ''
    expect(visibleWidth(selectedLine)).toBe(24)
    harness.panel.handleInput(KEY.down)
    for (const line of rendered(harness.panel, 24)) expect(visibleWidth(line)).toBeLessThanOrEqual(24)
    expect(harness.panel.handleInput(KEY.escape)).toBe(true)
    expect(harness.closes).toBe(1)
  })
})

describe('TeamPanel read-only navigation', () => {
  it('opens a transcript only for an active teammate', () => {
    const harness = panelHarness(
      teamProjection({
        members: [
          teamMember(),
          teamMember({ id: SessionId('t1'), name: 'Active', role: 'teammate', phase: 'active' }),
          teamMember({ id: SessionId('t2'), name: 'Provisioning', role: 'teammate', phase: 'provisioning' }),
          teamMember({ id: SessionId('t3'), name: 'Failed', role: 'teammate', phase: 'failed' }),
        ],
      }),
      { 't1': { status: 'inactive' } },
    )

    expect(harness.panel.handleInput(KEY.enter)).toBe(true)
    expect(harness.opens).toEqual([])
    harness.panel.handleInput(KEY.down)
    expect(harness.panel.handleInput(KEY.enter)).toBe(true)
    expect(harness.opens).toEqual([{ name: 'Active' }])
    harness.panel.handleInput(KEY.down)
    harness.panel.handleInput(KEY.enter)
    harness.panel.handleInput(KEY.down)
    harness.panel.handleInput(KEY.enter)
    expect(harness.opens).toEqual([{ name: 'Active' }])
  })

  it('opens the task detail on Enter and renders native metadata', () => {
    const harness = panelHarness(teamProjection({
      tasks: [teamTask({
        id: 'task-42',
        subject: 'Inspect the workspace',
        description: 'Read every package and report the risky ones.',
        status: 'in_progress',
        ownerName: 'Worker',
        blockedBy: ['task-1'],
        writeScopes: ['src/a.ts', 'src/b.ts'],
        writeScopeWarnings: ['scope leaves the workspace'],
      })],
    }))
    harness.panel.handleInput(KEY.tab)
    expect(harness.panel.handleInput(KEY.enter)).toBe(true)
    const lines = rendered(harness.panel)

    expect(lines[0]).toBe(copy.team.title)
    expect(lines[1]).toBe('Inspect the workspace')
    expect(lines[2]).toContain(`${copy.team.taskDetailStatus}: ${copy.team.statuses.inProgress}`)
    expect(lines[3]).toContain(`${copy.team.taskDetailId}: task-42`)
    expect(lines[4]).toContain(`${copy.team.owner}: @Worker`)
    expect(hasLine(lines, 'Read every package and report the risky ones.')).toBe(true)
    expect(hasLine(lines, `${copy.team.blockedBy}: task-1`)).toBe(true)
    expect(hasLine(lines, `${copy.team.writeScopes}: src/a.ts, src/b.ts`)).toBe(true)
    expect(hasLine(lines, 'scope leaves the workspace')).toBe(true)
    expect(lines.at(-1)).toBe(`  ${copy.team.detailHint}`)
    expect(hasLine(lines, copy.team.hint)).toBe(false)
  })

  it('shows Unowned and a wrapped description in the task detail', () => {
    const harness = panelHarness(teamProjection({
      tasks: [teamTask({
        description: 'A long description that wraps across multiple rendered lines when the panel is narrow enough to force wrapping.',
      })],
    }))
    harness.panel.handleInput(KEY.tab)
    harness.panel.handleInput(KEY.enter)
    const lines = rendered(harness.panel, 40)

    expect(hasLine(lines, `${copy.team.owner}: ${copy.team.unowned}`)).toBe(true)
    expect(hasLine(lines, `${copy.team.statuses.pending} · ${copy.team.readyLabel}`)).toBe(true)
    expect(lines.filter(line => line.startsWith('  ') && line.includes('description'))).toHaveLength(1)
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40)
  })

  it('shows a blocked pending detail and the Completed status', () => {
    const blocked = panelHarness(teamProjection({
      tasks: [teamTask({ ready: false, description: 'Waiting.' })],
    }))
    blocked.panel.handleInput(KEY.tab)
    blocked.panel.handleInput(KEY.enter)
    expect(hasLine(rendered(blocked.panel), `${copy.team.statuses.pending} · ${copy.team.blockedLabel}`)).toBe(true)

    blocked.panel.setTeam(teamProjection({
      tasks: [teamTask({ status: 'completed', description: 'Done.' })],
    }))
    expect(hasLine(rendered(blocked.panel), `${copy.team.taskDetailStatus}: ${copy.team.statuses.completed}`)).toBe(true)
  })

  it('scrolls a long task detail and returns with Escape', () => {
    const warnings = Array.from({ length: 18 }, (_, index) => `warning ${String(index)}`)
    const harness = panelHarness(teamProjection({
      tasks: [teamTask({ description: 'Short.', writeScopeWarnings: warnings })],
    }))
    harness.panel.handleInput(KEY.tab)
    harness.panel.handleInput(KEY.enter)

    expect(hasLine(rendered(harness.panel), `↓ ${copy.moreRows(9)}`)).toBe(true)
    harness.panel.handleInput(KEY.up)
    expect(Reflect.get(harness.panel, 'detailOffset')).toBe(0)
    harness.panel.handleInput(KEY.down)
    expect(hasLine(rendered(harness.panel), `↑ ${copy.moreRows(1)}`)).toBe(true)
    harness.panel.handleInput(KEY.pageDown)
    expect(hasLine(rendered(harness.panel), 'warning 0')).toBe(false)
    expect(hasLine(rendered(harness.panel), 'warning 17')).toBe(true)
    expect(hasLine(rendered(harness.panel), `↑ ${copy.moreRows(9)}`)).toBe(true)
    harness.panel.handleInput(KEY.pageUp)
    expect(hasLine(rendered(harness.panel), `↑ ${copy.moreRows(1)}`)).toBe(true)

    expect(harness.panel.handleInput(KEY.escape)).toBe(true)
    expect(Reflect.get(harness.panel, 'detailOffset')).toBe(0)
    expect(hasLine(rendered(harness.panel), copy.team.hint)).toBe(true)
    expect(harness.panel.handleInput('x')).toBe(false)
  })

  it('refreshes an open detail by id and closes it when the task disappears', () => {
    const harness = panelHarness(teamProjection({
      tasks: [teamTask({ id: 'task-1', subject: 'Old subject', description: 'Old.' })],
    }))
    harness.panel.handleInput(KEY.tab)
    harness.panel.handleInput(KEY.enter)

    harness.panel.setTeam(teamProjection({
      tasks: [teamTask({ id: 'task-1', subject: 'New subject', status: 'completed', description: 'New.' })],
    }))
    const refreshed = rendered(harness.panel)
    expect(refreshed[1]).toBe('New subject')
    expect(hasLine(refreshed, copy.team.statuses.completed)).toBe(true)

    harness.panel.setTeam(teamProjection({ tasks: [] }))
    expect(hasLine(rendered(harness.panel), copy.team.emptyTasks)).toBe(true)
    expect(Reflect.get(harness.panel, 'detail')).toBeUndefined()
  })

  it('renders the Chinese native labels', () => {
    setCopyLocale('zh')
    const harness = panelHarness(
      teamProjection({
        members: [
          teamMember(),
          teamMember({ id: SessionId('t1'), name: 'Worker', role: 'teammate', phase: 'active' }),
        ],
        tasks: [teamTask({ status: 'in_progress', ownerName: 'Worker' })],
      }),
      { 't1': { status: 'running', model: 'alpha/m-1' } },
    )

    const lines = rendered(harness.panel)
    expect(lines[0]).toBe(copy.team.title)
    expect(lines[1]).toContain(` ${copy.team.membersTab} 2 `)
    expect(hasLine(lines, copy.team.memberStatuses.running)).toBe(true)
    expect(hasLine(lines, copy.team.current)).toBe(true)
    expect(lines.at(-1)).toBe(`  ${copy.team.hint}`)

    harness.panel.handleInput(KEY.tab)
    expect(hasLine(rendered(harness.panel), copy.team.statuses.inProgress)).toBe(true)
    harness.panel.handleInput(KEY.enter)
    expect(hasLine(rendered(harness.panel), copy.team.taskDetailStatus)).toBe(true)
    expect(hasLine(rendered(harness.panel), copy.team.detailHint)).toBe(true)
  })

  it('reports a zero row count and invalidates without cached state', () => {
    const harness = panelHarness()
    harness.panel.setTeam(undefined)
    const rowCount = Reflect.get(harness.panel, 'rowCount') as () => number

    expect(rowCount.call(harness.panel)).toBe(0)
    expect(() => { harness.panel.invalidate() }).not.toThrow()

    const empty = panelHarness(teamProjection({ members: [] }))
    expect(empty.panel.handleInput(KEY.enter)).toBe(true)
    empty.panel.handleInput(KEY.tab)
    expect(empty.panel.handleInput(KEY.enter)).toBe(true)
  })
})

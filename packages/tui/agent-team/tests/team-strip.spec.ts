import { afterEach, describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { TeamMemberRow, TeamProjection } from '../src/team.ts'
import { TeamStrip } from '../src/components/team-strip.ts'
import { copy, setCopyLocale } from '../src/copy.ts'
import { controllerHarness, paletteDouble, teamProjection, teamTask } from './harness.ts'

afterEach(() => {
  setCopyLocale('en')
})

/** One teammate row fixture. */
function member(id: string, name: string): TeamMemberRow {
  return { id, name }
}

/**
 * Build one Team strip over mutable projection and member values.
 * @param projection - initial Team value.
 * @param members - initial teammate rows.
 * @returns the strip and its setters.
 */
function stripHarness(
  projection: TeamProjection | undefined,
  members: readonly TeamMemberRow[] = [],
): {
  strip: TeamStrip
  set: (next: TeamProjection | undefined) => void
  setMembers: (next: readonly TeamMemberRow[]) => void
} {
  let current = projection
  let currentMembers = members
  const harness = controllerHarness()
  const palette = paletteDouble()
  return {
    strip: new TeamStrip(palette.palette, harness.ctx, () => current, () => currentMembers),
    set: (next) => { current = next },
    setMembers: (next) => { currentMembers = next },
  }
}

describe('TeamStrip', () => {
  it('renders nothing without a projection', () => {
    expect(stripHarness(undefined, [member('t1', 'reviewer')]).strip.render(120)).toEqual([])
  })

  it('renders nothing for an enabled Team with no teammates and no tasks', () => {
    expect(stripHarness(teamProjection()).strip.render(120)).toEqual([])
  })

  it('renders nothing while Team mode is off', () => {
    expect(stripHarness(teamProjection({ enabled: false }), [member('t1', 'reviewer')]).strip.render(120)).toEqual([])
  })

  it('renders teammate, running, task, and bucket counts', () => {
    const harness = controllerHarness()
    harness.services.agentStatuses.set('t1', 'running')
    const palette = paletteDouble()
    let team: TeamProjection | undefined = teamProjection({
      tasks: [
        teamTask({ id: 'ready' }),
        teamTask({ id: 'blocked', ready: false }),
        teamTask({ id: 'running', status: 'in_progress' }),
        teamTask({ id: 'done', status: 'completed' }),
      ],
    })
    const members = [member('t1', 'reviewer'), member('t2', 'checker')]
    const strip = new TeamStrip(palette.palette, harness.ctx, () => team, () => members)

    expect(strip.render(200)[0]).toBe(
      ` ${copy.team.teammates(2)} · ${copy.team.running(1)} · ${copy.team.tasks(4)} · `
      + `(${copy.team.ready(1)} · ${copy.team.inProgress(1)} · ${copy.team.blocked(1)} · ${copy.team.completed(1)})`,
    )

    team = undefined
    expect(strip.render(200)).toEqual([])
  })

  it('omits zero-count segments', () => {
    const { strip } = stripHarness(teamProjection(), [member('t1', 'reviewer')])

    expect(strip.render(120)[0]).toBe(` ${copy.team.teammates(1)}`)
  })

  it('omits zero buckets inside a non-empty task list', () => {
    const { strip } = stripHarness(
      teamProjection({ tasks: [teamTask({ id: 'blocked', ready: false })] }),
      [member('t1', 'reviewer')],
    )

    expect(strip.render(200)[0]).toBe(` ${copy.team.teammates(1)} · ${copy.team.tasks(1)} · (${copy.team.blocked(1)})`)
  })

  it('appends the failure with warning tone', () => {
    const palette = paletteDouble()
    const harness = controllerHarness()
    const strip = new TeamStrip(palette.palette, harness.ctx, () => teamProjection({ failure: 'bad record' }), () => [])

    const [line] = strip.render(200)
    expect(line).toContain(copy.team.failure('bad record'))
    expect(palette.calls).toContain('warning')
  })

  it('updates with the projection and members and hides again', () => {
    const { strip, set, setMembers } = stripHarness(undefined)

    setMembers([member('t1', 'reviewer')])
    set(teamProjection())
    expect(strip.render(120)[0]).toContain(copy.team.teammates(1))

    set(teamProjection({ enabled: false }))
    expect(strip.render(120)).toEqual([])
  })

  it('truncates to the available width', () => {
    const team = teamProjection({
      tasks: [teamTask(), teamTask({ id: 'done', status: 'completed' })],
    })
    const { strip } = stripHarness(team, [member('t1', 'reviewer')])

    for (const line of strip.render(20)) expect(visibleWidth(line)).toBeLessThanOrEqual(20)
  })

  it('renders the Chinese labels', () => {
    setCopyLocale('zh')
    const { strip } = stripHarness(teamProjection(), [member('t1', 'reviewer')])

    expect(strip.render(120)[0]).toBe(` ${copy.team.teammates(1)}`)
  })

  it('has no cached state to invalidate', () => {
    const { strip } = stripHarness(teamProjection())

    expect(() => { strip.invalidate() }).not.toThrow()
  })
})

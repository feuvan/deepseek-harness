import { afterEach, describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { TeamProjection } from '../src/team.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TeamStrip } from '../src/components/team-strip.ts'
import { copy, setCopyLocale } from '../src/copy.ts'
import { controllerHarness, paletteDouble, teamMember, teamProjection, teamTask } from './harness.ts'

afterEach(() => {
  setCopyLocale('en')
})

/**
 * Build one Team strip over a mutable projection.
 * @param projection - initial Team value.
 * @param color - whether to render ANSI colors.
 * @returns the strip and its projection setter.
 */
function stripHarness(
  projection: TeamProjection | undefined,
  color = false,
  running = false,
): { strip: TeamStrip; set: (next: TeamProjection | undefined) => void } {
  let current = projection
  const harness = controllerHarness()
  if (running) harness.services.agentStatuses.set('teammate-1', 'running')
  const { palette } = paletteDouble()
  void color
  return {
    strip: new TeamStrip(palette, harness.ctx, () => current),
    set: (next) => { current = next },
  }
}

describe('TeamStrip', () => {
  it('renders nothing without a projection', () => {
    expect(stripHarness(undefined).strip.render(120)).toEqual([])
  })

  it('renders nothing for a lead-only team', () => {
    expect(stripHarness(teamProjection()).strip.render(120)).toEqual([])
  })

  it('renders teammate, running, task, and bucket counts', () => {
    const team = teamProjection({
      members: [
        teamMember(),
        teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate' }),
        teamMember({ id: SessionId('teammate-2'), name: 'Other', role: 'teammate' }),
      ],
      tasks: [
        teamTask({ id: 'ready' }),
        teamTask({ id: 'blocked', ready: false }),
        teamTask({ id: 'running', status: 'in_progress' }),
        teamTask({ id: 'done', status: 'completed' }),
      ],
    })
    const { strip } = stripHarness(team, false, true)

    const [line] = (strip.render(200))
    expect(line).toBe(
      ` ${copy.team.teammates(2)} · ${copy.team.running(1)} · ${copy.team.tasks(4)} · `
      + `(${copy.team.ready(1)} · ${copy.team.inProgress(1)} · ${copy.team.blocked(1)} · ${copy.team.completed(1)})`,
    )
  })

  it('omits zero-count segments', () => {
    const team = teamProjection({
      members: [teamMember(), teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate' })],
    })
    const { strip } = stripHarness(team)

    expect((strip.render(120))[0]).toBe(` ${copy.team.teammates(1)}`)
  })

  it('omits zero buckets inside a non-empty task list', () => {
    const team = teamProjection({
      members: [teamMember(), teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate' })],
      tasks: [teamTask({ id: 'blocked', ready: false })],
    })
    const { strip } = stripHarness(team)

    const [line] = (strip.render(200))
    expect(line).toBe(` ${copy.team.teammates(1)} · ${copy.team.tasks(1)} · (${copy.team.blocked(1)})`)
  })

  it('appends the failure with warning tone', () => {
    const team = teamProjection({ failure: 'bad record' })
    const palette = paletteDouble()
    const harness = controllerHarness()
    const strip = new TeamStrip(palette.palette, harness.ctx, () => team)

    const [line] = strip.render(200)
    expect(line).toContain(copy.team.failure('bad record'))
    expect(palette.calls).toContain('warning')
  })

  it('updates with the projection and hides again', () => {
    const { strip, set } = stripHarness(undefined)
    set(teamProjection({
      members: [teamMember(), teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate' })],
    }))

    expect((strip.render(120))[0]).toContain(copy.team.teammates(1))

    set(teamProjection())
    expect(strip.render(120)).toEqual([])
  })

  it('truncates to the available width', () => {
    const team = teamProjection({
      members: [teamMember(), teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate' })],
      tasks: [teamTask(), teamTask({ id: 'done', status: 'completed' })],
    })
    const { strip } = stripHarness(team)

    for (const line of strip.render(20)) expect(visibleWidth(line)).toBeLessThanOrEqual(20)
  })

  it('renders the Chinese labels', () => {
    setCopyLocale('zh')
    const { strip } = stripHarness(teamProjection({
      members: [teamMember(), teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate' })],
    }))

    expect((strip.render(120))[0]).toBe(` ${copy.team.teammates(1)}`)
  })

  it('has no cached state to invalidate', () => {
    const { strip } = stripHarness(teamProjection())

    expect(() => { strip.invalidate() }).not.toThrow()
  })
})

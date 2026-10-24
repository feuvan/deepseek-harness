import { afterEach, describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { TeamProjection } from '../../src/team.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TeamStrip } from '../../src/components/team-strip.ts'
import { copy, setCopyLocale } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'
import { agentTeam, agentsDouble, freshContext, teamMember, teamTask } from '../core/harness.ts'
import { visibleLines } from '../support/terminal.ts'

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
  const registry = agentsDouble()
  const ctx = freshContext({ agents: registry.service })
  if (running) registry.bindTeammateStatus('teammate-1', 'running')
  return {
    strip: new TeamStrip(createPalette(color), ctx, () => current),
    set: (next) => { current = next },
  }
}

describe('TeamStrip', () => {
  it('renders nothing without a projection', () => {
    expect(stripHarness(undefined).strip.render(120)).toEqual([])
  })

  it('renders nothing for a lead-only team', () => {
    expect(stripHarness(agentTeam()).strip.render(120)).toEqual([])
  })

  it('renders teammate, running, task, and bucket counts', () => {
    const team = agentTeam({
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

    const [line] = visibleLines(strip.render(200))
    expect(line).toBe(
      ` ${copy.team.teammates(2)} · ${copy.team.running(1)} · ${copy.team.tasks(4)} · `
      + `(${copy.team.ready(1)} · ${copy.team.inProgress(1)} · ${copy.team.blocked(1)} · ${copy.team.completed(1)})`,
    )
  })

  it('omits zero-count segments', () => {
    const team = agentTeam({
      members: [teamMember(), teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate' })],
    })
    const { strip } = stripHarness(team)

    expect(visibleLines(strip.render(120))[0]).toBe(` ${copy.team.teammates(1)}`)
  })

  it('omits zero buckets inside a non-empty task list', () => {
    const team = agentTeam({
      members: [teamMember(), teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate' })],
      tasks: [teamTask({ id: 'blocked', ready: false })],
    })
    const { strip } = stripHarness(team)

    const [line] = visibleLines(strip.render(200))
    expect(line).toBe(` ${copy.team.teammates(1)} · ${copy.team.tasks(1)} · (${copy.team.blocked(1)})`)
  })

  it('appends the failure with warning tone', () => {
    const team = agentTeam({ failure: 'bad record' })
    const { strip } = stripHarness(team, true)

    const [line] = strip.render(200)
    expect(line).toContain(copy.team.failure)
    expect(line).toContain('bad record')
    expect(line).toContain('\u001b[33m')
  })

  it('updates with the projection and hides again', () => {
    const { strip, set } = stripHarness(undefined)
    set(agentTeam({
      members: [teamMember(), teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate' })],
    }))

    expect(visibleLines(strip.render(120))[0]).toContain(copy.team.teammates(1))

    set(agentTeam())
    expect(strip.render(120)).toEqual([])
  })

  it('truncates to the available width', () => {
    const team = agentTeam({
      members: [teamMember(), teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate' })],
      tasks: [teamTask(), teamTask({ id: 'done', status: 'completed' })],
    })
    const { strip } = stripHarness(team)

    for (const line of strip.render(20)) expect(visibleWidth(line)).toBeLessThanOrEqual(20)
  })

  it('renders the Chinese labels', () => {
    setCopyLocale('zh')
    const { strip } = stripHarness(agentTeam({
      members: [teamMember(), teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate' })],
    }))

    expect(visibleLines(strip.render(120))[0]).toBe(` ${copy.team.teammates(1)}`)
  })

  it('has no cached state to invalidate', () => {
    const { strip } = stripHarness(agentTeam())

    expect(() => { strip.invalidate() }).not.toThrow()
  })
})

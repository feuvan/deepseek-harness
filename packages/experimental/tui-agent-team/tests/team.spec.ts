import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  readTeamProjection, summarizeTeam, teamService, teamVisible,
} from '../src/team.ts'
import {
  controllerHarness, sessionToken, teamMember, teamProjection, teamTask,
} from './harness.ts'

describe('readTeamProjection', () => {
  it('returns undefined without an Agent', () => {
    const harness = controllerHarness()

    expect(readTeamProjection(harness.ctx, undefined)).toBeUndefined()
  })

  it('returns undefined when the projection registry has no agentTeam value', () => {
    const harness = controllerHarness()

    expect(readTeamProjection(harness.ctx, harness.agent)).toBeUndefined()
  })

  it('returns the current agentTeam projection', () => {
    const team = teamProjection({ tasks: [teamTask()] })
    const harness = controllerHarness({ projection: team })

    expect(readTeamProjection(harness.ctx, harness.agent)).toBe(team)
  })
})

describe('teamVisible', () => {
  it('hides a lead-only team without tasks or failure', () => {
    expect(teamVisible(teamProjection())).toBe(false)
  })

  it('shows a teammate, a task, or a failure record', () => {
    expect(teamVisible(teamProjection({
      members: [teamMember(), teamMember({ id: SessionId('t1'), name: 'Worker', role: 'teammate' })],
    }))).toBe(true)
    expect(teamVisible(teamProjection({ tasks: [teamTask()] }))).toBe(true)
    expect(teamVisible(teamProjection({ failure: 'rejected' }))).toBe(true)
  })
})

describe('summarizeTeam', () => {
  it('excludes the lead, counts running teammates through the Agent registry', () => {
    const harness = controllerHarness()
    harness.services.agentStatuses.set('t1', 'running')
    harness.services.agentStatuses.set('t2', 'idle')

    const summary = summarizeTeam(harness.ctx, teamProjection({
      members: [
        teamMember(),
        teamMember({ id: SessionId('t1'), name: 'Running', role: 'teammate' }),
        teamMember({ id: SessionId('t2'), name: 'Idle', role: 'teammate' }),
        teamMember({ id: SessionId('t3'), name: 'Absent', role: 'teammate' }),
      ],
    }))

    expect(summary).toEqual({
      teammates: 3,
      running: 1,
      tasks: 0,
      ready: 0,
      blocked: 0,
      inProgress: 0,
      completed: 0,
    })
  })

  it('counts every task bucket', () => {
    const harness = controllerHarness()

    const summary = summarizeTeam(harness.ctx, teamProjection({
      tasks: [
        teamTask({ id: 'ready', ready: true }),
        teamTask({ id: 'blocked', ready: false }),
        teamTask({ id: 'running', status: 'in_progress' }),
        teamTask({ id: 'done', status: 'completed' }),
      ],
    }))

    expect(summary).toEqual({
      teammates: 0,
      running: 0,
      tasks: 4,
      ready: 1,
      blocked: 1,
      inProgress: 1,
      completed: 1,
    })
  })
})

describe('teamService', () => {
  it('returns the composed Agent Teams service', () => {
    const harness = controllerHarness()

    expect(teamService(harness.ctx)).toBeDefined()
  })

  it('returns undefined without the service', () => {
    const harness = controllerHarness({ withoutTeamService: true })

    expect(teamService(harness.ctx)).toBeUndefined()
  })
})

describe('sessionToken', () => {
  it('brands the Session identity', () => {
    expect(String(sessionToken('t1').id)).toBe('t1')
  })
})

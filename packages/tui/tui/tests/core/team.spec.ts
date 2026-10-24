import { afterEach, describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  readTeamProjection, summarizeTeam, teamVisible,
} from '../../src/team.ts'
import { agentTeam, agentDouble, agentsDouble, freshContext, teamMember, teamTask } from './harness.ts'

afterEach(() => {
  // Team helpers read the live locale only through copy-dependent components.
})

/**
 * Build one Agent double over a named Session.
 * @param id - Session identity.
 * @param status - initial Agent status.
 * @returns the Agent double.
 */
function teamAgent(id: string, status: 'idle' | 'running' = 'idle'): ReturnType<typeof agentDouble> {
  return agentDouble({ session: Session.create(SessionId(id)), status })
}

describe('readTeamProjection', () => {
  it('returns undefined without a presented Agent', () => {
    const ctx = freshContext()

    expect(readTeamProjection(ctx, undefined)).toBeUndefined()
  })

  it('returns undefined without a projection registry', () => {
    const ctx = freshContext()
    const agent = teamAgent('team-lead').agent

    expect(readTeamProjection(ctx, agent)).toBeUndefined()
  })

  it('returns the agentTeam projection values', () => {
    const team = agentTeam()
    const agent = teamAgent('team-lead').agent
    const ctx = freshContext({
      sessionProjections: {
        snapshot: () => ({ asOfSeq: 0, values: { agentTeam: team } }),
      },
    })

    expect(readTeamProjection(ctx, agent)).toBe(team)
  })

  it('returns undefined when the projection registry has no agentTeam value', () => {
    const agent = teamAgent('team-lead').agent
    const ctx = freshContext({ sessionProjections: { snapshot: () => ({ asOfSeq: 0, values: {} }) } })

    expect(readTeamProjection(ctx, agent)).toBeUndefined()
  })
})

describe('teamVisible', () => {
  it('hides a lead-only team without tasks or failure', () => {
    expect(teamVisible(agentTeam())).toBe(false)
  })

  it('shows any teammate', () => {
    expect(teamVisible(agentTeam({
      members: [teamMember(), teamMember({ id: SessionId('teammate-1'), name: 'Worker', role: 'teammate' })],
    }))).toBe(true)
  })

  it('shows any task even without teammates', () => {
    expect(teamVisible(agentTeam({ tasks: [teamTask()] }))).toBe(true)
  })

  it('shows a team failure record', () => {
    expect(teamVisible(agentTeam({ failure: 'rejected row' }))).toBe(true)
  })
})

describe('summarizeTeam', () => {
  it('excludes the lead from the teammate count and adds running members', () => {
    const lead = teamAgent('team-lead')
    const running = teamAgent('teammate-running', 'running')
    const idle = teamAgent('teammate-idle')
    const registry = agentsDouble()
    registry.bind(lead.agent)
    registry.bindTeammate(running.agent)
    registry.bindTeammate(idle.agent)
    const ctx = freshContext({ agents: registry.service })
    const team = agentTeam({
      members: [
        teamMember(),
        teamMember({ id: SessionId('teammate-running'), name: 'Running', role: 'teammate' }),
        teamMember({ id: SessionId('teammate-idle'), name: 'Idle', role: 'teammate' }),
      ],
    })

    expect(summarizeTeam(ctx, team)).toEqual({
      teammates: 2,
      running: 1,
      tasks: 0,
      ready: 0,
      blocked: 0,
      inProgress: 0,
      completed: 0,
    })
  })

  it('counts every task bucket', () => {
    const ctx = freshContext()
    const team = agentTeam({
      tasks: [
        teamTask({ id: 'ready', ready: true, status: 'pending' }),
        teamTask({ id: 'blocked', ready: false, status: 'pending' }),
        teamTask({ id: 'running', status: 'in_progress' }),
        teamTask({ id: 'done', status: 'completed' }),
      ],
    })

    expect(summarizeTeam(ctx, team)).toEqual({
      teammates: 0,
      running: 0,
      tasks: 4,
      ready: 1,
      blocked: 1,
      inProgress: 1,
      completed: 1,
    })
  })

  it('counts teammates without a live Agent as not running', () => {
    const ctx = freshContext()

    expect(summarizeTeam(ctx, agentTeam({
      members: [teamMember(), teamMember({ id: SessionId('absent'), name: 'Absent', role: 'teammate' })],
    })).running).toBe(0)
  })
})

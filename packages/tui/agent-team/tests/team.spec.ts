import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TeamTaskId, type TeamProjection as AgentTeamProjection, type TeamTaskView } from '@deepseek-ai/dsh-agent-team'
import type { SubagentCatalogEntry } from '@deepseek-ai/dsh-subagent'
import {
  deriveMemberRows, memberRunning, readMemberCatalog, readTeamProjection, summarizeTeam, teamVisible,
} from '../src/team.ts'
import {
  controllerHarness, diagnosticEntry, memberEntry, teamProjection, teamTask,
} from './harness.ts'

/** Build one Agent Teams task view for raw upstream fixtures. */
function rawTask(overrides: Omit<Partial<TeamTaskView>, 'id'> & { id: string }): TeamTaskView {
  const { id, ...rest } = overrides
  return {
    id: TeamTaskId(id),
    revision: 1,
    subject: 'Task',
    description: 'Description',
    status: 'pending',
    blockedBy: [],
    writeScopes: [],
    ready: true,
    writeScopeWarnings: [],
    ...rest,
  }
}

describe('readTeamProjection', () => {
  it('returns undefined without an Agent', () => {
    const harness = controllerHarness()

    expect(readTeamProjection(harness.ctx, undefined)).toBeUndefined()
  })

  it('returns undefined without the projection registry', () => {
    const harness = controllerHarness({ withoutProjections: true })

    expect(readTeamProjection(harness.ctx, harness.agent)).toBeUndefined()
  })

  it('returns undefined when the projection registry has no agentTeam value', () => {
    const harness = controllerHarness()

    expect(readTeamProjection(harness.ctx, harness.agent)).toBeUndefined()
  })

  it('copies the saved mode, non-deleted tasks, and a failure', () => {
    const harness = controllerHarness({ projection: teamProjection({ failure: 'rejected' }) })
    harness.services.projections.values.agentTeam = {
      enabled: false,
      tasks: [rawTask({ id: 'task-1' }), rawTask({ id: 'task-2', status: 'deleted' })],
      failure: 'rejected',
    } satisfies AgentTeamProjection

    expect(readTeamProjection(harness.ctx, harness.agent)).toEqual({
      enabled: false,
      tasks: [{
        id: 'task-1',
        revision: 1,
        subject: 'Task',
        description: 'Description',
        status: 'pending',
        blockedBy: [],
        writeScopes: [],
        ready: true,
        writeScopeWarnings: [],
      }],
      failure: 'rejected',
    })
  })

  it('copies the task owner and leaves the failure out when absent', () => {
    const harness = controllerHarness()
    harness.services.projections.values.agentTeam = {
      enabled: true,
      tasks: [rawTask({ id: 'task-1', status: 'completed', ownerName: 'Worker' })],
    } satisfies AgentTeamProjection

    expect(readTeamProjection(harness.ctx, harness.agent)).toEqual(teamProjection({
      tasks: [teamTask({
        id: 'task-1',
        subject: 'Task',
        description: 'Description',
        status: 'completed',
        ownerName: 'Worker',
      })],
    }))
  })
})

describe('readMemberCatalog', () => {
  it('returns no rows without an Agent', () => {
    expect(readMemberCatalog(controllerHarness().ctx, undefined)).toEqual([])
  })

  it('returns no rows without the projection registry or catalog value', () => {
    const withoutProjections = controllerHarness({ withoutProjections: true })
    expect(readMemberCatalog(withoutProjections.ctx, withoutProjections.agent)).toEqual([])

    const withoutCatalog = controllerHarness()
    expect(readMemberCatalog(withoutCatalog.ctx, withoutCatalog.agent)).toEqual([])
  })

  it('paints the direct-child catalog with names and creation descriptions', () => {
    const catalog: SubagentCatalogEntry[] = [
      { id: SessionId('t1'), createdAt: 1, mode: 'continuable', label: 'Reviews diffs', name: 'reviewer' },
      { id: SessionId('t2'), createdAt: 2, mode: 'one-shot', label: 'Runs checks' },
      { id: SessionId('t3'), createdAt: 3, mode: 'unknown' },
    ]
    const harness = controllerHarness({ subagentCatalog: catalog })

    expect(readMemberCatalog(harness.ctx, harness.agent)).toEqual([
      { id: 't1', name: 'reviewer', description: 'Reviews diffs' },
      { id: 't2', name: 't2', description: 'Runs checks' },
      { id: 't3', name: 't3' },
    ])
  })
})

describe('deriveMemberRows', () => {
  it('converts named children and unreadable branches in catalog order', () => {
    const rows = deriveMemberRows([
      memberEntry({ id: 't1', path: 'reviewer', label: 'Reviews diffs' }),
      {
        kind: 'child',
        id: SessionId('t2'),
        mode: 'one-shot',
        parentId: SessionId('lead-session'),
        depth: 1,
        activity: 'inactive',
        hasChildren: false,
      },
      diagnosticEntry({ id: 't3', path: 'reviewer/broken', reason: 'corrupt' }),
    ])

    expect(rows).toEqual([
      { id: 't1', name: 'reviewer', description: 'Reviews diffs' },
      { id: 't2', name: 't2' },
      { id: 't3', name: 'reviewer/broken', reason: 'corrupt' },
    ])
  })

  it('falls back to the Session id when a diagnostic has no path', () => {
    expect(deriveMemberRows([diagnosticEntry({ id: 'broken', reason: 'unavailable' })])).toEqual([
      { id: 'broken', name: 'broken', reason: 'unavailable' },
    ])
  })
})

describe('teamVisible', () => {
  it('hides everything without a projection', () => {
    expect(teamVisible(undefined, [{ id: 't1', name: 'reviewer' }])).toBe(false)
  })

  it('shows a rejected record even when Team mode is off', () => {
    expect(teamVisible(teamProjection({ enabled: false, failure: 'rejected' }), [])).toBe(true)
  })

  it('hides teammates and tasks while Team mode is off', () => {
    expect(teamVisible(teamProjection({ enabled: false }), [{ id: 't1', name: 'reviewer' }])).toBe(false)
    expect(teamVisible(teamProjection({ enabled: false, tasks: [teamTask()] }), [])).toBe(false)
  })

  it('shows teammates or shared tasks while Team mode is on', () => {
    expect(teamVisible(teamProjection(), [{ id: 't1', name: 'reviewer' }])).toBe(true)
    expect(teamVisible(teamProjection({ tasks: [teamTask()] }), [])).toBe(true)
  })

  it('hides an enabled Team with no teammates and no tasks', () => {
    expect(teamVisible(teamProjection(), [])).toBe(false)
  })
})

describe('memberRunning', () => {
  it('reads running state from the Agent registry and tolerates a missing registry', () => {
    const harness = controllerHarness()
    harness.services.agentStatuses.set('running', 'running')
    harness.services.agentStatuses.set('idle', 'idle')

    expect(memberRunning(harness.ctx, 'running')).toBe(true)
    expect(memberRunning(harness.ctx, 'idle')).toBe(false)
    expect(memberRunning(harness.ctx, 'absent')).toBe(false)

    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    expect(memberRunning(ctx, 'absent')).toBe(false)
  })
})

describe('summarizeTeam', () => {
  it('counts teammates and their running state', () => {
    const harness = controllerHarness()
    harness.services.agentStatuses.set('t1', 'running')

    const summary = summarizeTeam(harness.ctx, teamProjection(), [
      { id: 't1', name: 'running' },
      { id: 't2', name: 'idle' },
      { id: 't3', name: 'absent' },
    ])

    expect(summary).toEqual({
      teammates: 3,
      running: 1,
      totalTasks: 0,
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
    }), [])

    expect(summary).toEqual({
      teammates: 0,
      running: 0,
      totalTasks: 4,
      ready: 1,
      blocked: 1,
      inProgress: 1,
      completed: 1,
    })
  })
})

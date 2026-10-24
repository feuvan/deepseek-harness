/**
 * Agent Teams values for the terminal: the Lead Session's `agentTeam`
 * projection, plus the counts the compact strip and the read-only dock render.
 *
 * The projection vocabulary is imported type-only from the experimental
 * Agent Teams package; the terminal never imports its runtime, so a profile
 * without the bundle simply has no projection to show.
 *
 * @module @deepseek-ai/dsh-tui/team
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/**
 * Structural subset of the Agent Teams client projection vocabulary. The
 * terminal keeps its own read-only view so the stable TUI package never needs
 * the experimental package's type build; the Agent Teams client schema remains
 * the authority for these fields.
 */
export interface TeamProjection {
  readonly members: readonly TeamMemberProjectionRow[]
  readonly tasks: readonly TeamTaskRow[]
  readonly failure?: string
}

/** One roster row the terminal renders. */
export interface TeamMemberProjectionRow {
  readonly id: string
  readonly name: string
  readonly role: 'lead' | 'teammate'
  readonly phase: 'provisioning' | 'active' | 'failed'
  readonly error?: string
}

/** One task row the terminal renders. */
export interface TeamTaskRow {
  readonly id: string
  readonly revision: number
  readonly subject: string
  readonly status: 'pending' | 'in_progress' | 'completed'
  readonly blockedBy: readonly string[]
  readonly writeScopes: readonly string[]
  readonly ownerName?: string
  readonly ready: boolean
  readonly writeScopeWarnings: readonly string[]
}

/** Structural view of the Agent Teams service methods the terminal calls. */
export interface TeamServiceLike {
  createTask(caller: Agent, request: { subject: string; description: string }): Promise<{ id: string }>
  updateTask(caller: Agent, request: {
    taskId: string
    expectedRevision: number
    action: 'claim' | 'complete'
  }): Promise<{ id: string }>
  sendMessage(caller: Agent, request: {
    target: string
    content: readonly { type: 'text'; text: string }[]
    signal: AbortSignal
  }): Promise<unknown>
}

/**
 * Read the composed Agent Teams service through its structural view.
 * @param ctx - host context that may carry the service.
 * @returns the service, or undefined when the bundle is not composed.
 */
export function teamService(ctx: Context): TeamServiceLike | undefined {
  return ctx.get('agentTeams') as TeamServiceLike | undefined
}

/** Counts the terminal shows for one Team. */
export interface TeamSummary {
  /** Teammates excluding the Lead. */
  readonly teammates: number
  /** Teammates whose live Agent reports a running turn. */
  readonly running: number
  /** Pending tasks ready to start. */
  readonly ready: number
  /** Pending tasks waiting on blockers. */
  readonly blocked: number
  /** Tasks currently in progress. */
  readonly inProgress: number
  /** Completed tasks. */
  readonly completed: number
  /** All non-deleted tasks. */
  readonly tasks: number
}

/**
 * Read the presented Session's Team projection.
 * @param ctx - host context carrying the projection registry.
 * @param agent - the presented root Agent.
 * @returns the Team view, or undefined when the composition mounts no Team service.
 */
export function readTeamProjection(ctx: Context, agent: Agent | undefined): TeamProjection | undefined {
  if (agent === undefined) return undefined
  const values = ctx.get('sessionProjections')?.snapshot(agent.session).values
  return (values as { agentTeam?: TeamProjection } | undefined)?.agentTeam
}

/**
 * Whether the projection carries anything a terminal user should see.
 * @param team - the Team projection.
 * @returns whether a teammate, a task, or a rejected record is present.
 */
export function teamVisible(team: TeamProjection): boolean {
  return team.members.some(member => member.role === 'teammate')
    || team.tasks.length > 0
    || team.failure !== undefined
}

/**
 * Summarize one Team for the compact strip.
 * @param ctx - host context carrying the Agent registry.
 * @param team - the Team projection.
 * @returns teammate, running, and task counts.
 */
export function summarizeTeam(ctx: Context, team: TeamProjection): TeamSummary {
  let teammates = 0
  let running = 0
  let ready = 0
  let blocked = 0
  let inProgress = 0
  let completed = 0
  for (const member of team.members) {
    if (member.role !== 'teammate') continue
    teammates += 1
    if (ctx.get('agents')?.get(brandString<SessionId>(member.id))?.status === 'running') running += 1
  }
  for (const task of team.tasks) {
    if (task.status === 'completed') completed += 1
    else if (task.status === 'in_progress') inProgress += 1
    else if (task.ready) ready += 1
    else blocked += 1
  }
  return { teammates, running, tasks: ready + blocked + inProgress + completed, ready, blocked, inProgress, completed }
}

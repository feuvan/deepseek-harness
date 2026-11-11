/**
 * Agent Teams values for the terminal: the Lead Session's `agentTeam`
 * projection, the teammate rows derived from its subagent tree, and the counts
 * the compact strip and read-only dock render.
 *
 * The projection and subagent vocabularies are imported type-only; the terminal
 * keeps its own read-only row types and reads live running state through the
 * Agent registry, so a composition without the Team service simply has no
 * projection and no rows to show.
 *
 * @module @deepseek-ai/dsh-tui-agent-team/team
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TeamProjection as AgentTeamProjection, TeamTaskView } from '@deepseek-ai/dsh-agent-team'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SubagentCatalogEntry, SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'

/**
 * Read-only subset of the Agent Teams client projection. The Team package
 * remains the authority for these fields; the terminal mirrors only what it
 * renders.
 */
export interface TeamProjection {
  /** Whether the root Session's Team mode is on. */
  readonly enabled: boolean
  /** Non-deleted shared tasks in creation order. */
  readonly tasks: readonly TeamTaskRow[]
  /** First rejected persisted Team record, when the projection recorded one. */
  readonly failure?: string
}

/** Why one subagent-tree branch could not be read. */
export type TeamMemberDiagnostic = 'corrupt' | 'unsupported' | 'unavailable'

/** One teammate row derived from the root Session's subagent tree. */
export interface TeamMemberRow {
  /** Durable child Session identity; also the transcript handle. */
  readonly id: string
  /** Slash-separated name from the root, or the Session id when unnamed. */
  readonly name: string
  /** Creation description reported for the child, when any. */
  readonly description?: string
  /** Unreadable-branch reason; such a row is still a teammate. */
  readonly reason?: TeamMemberDiagnostic
}

/** One task row the terminal renders. */
export interface TeamTaskRow {
  readonly id: string
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: 'pending' | 'in_progress' | 'completed'
  readonly blockedBy: readonly string[]
  readonly writeScopes: readonly string[]
  readonly ownerName?: string
  readonly ready: boolean
  readonly writeScopeWarnings: readonly string[]
}

/** Counts the terminal shows for one Team. */
export interface TeamSummary {
  /** Teammates derived from the root's subagent tree. */
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
  readonly totalTasks: number
}

/**
 * Read the presented Session's Team projection.
 * @param ctx - host context carrying the projection registry.
 * @param agent - the presented root Agent.
 * @returns the Team view, or undefined when the composition mounts no Team service.
 */
export function readTeamProjection(ctx: Context, agent: Agent | undefined): TeamProjection | undefined {
  if (agent === undefined) return undefined
  const team = ctx.get('sessionProjections')?.snapshot(agent.session).values.agentTeam
  return team === undefined ? undefined : presentTeam(team)
}

/**
 * Copy the Agent Teams client view into the terminal's read-only rows.
 * @param team - Agent Teams client view.
 * @returns the saved mode, non-deleted task rows, and any projection failure.
 */
function presentTeam(team: AgentTeamProjection): TeamProjection {
  return {
    enabled: team.enabled,
    tasks: team.tasks.flatMap((task): TeamTaskRow[] => task.status === 'deleted' ? [] : [presentTask(task, task.status)]),
    ...team.failure === undefined ? {} : { failure: team.failure },
  }
}

/**
 * Copy one task view into a terminal row.
 * @param task - Agent Teams task view.
 * @param status - the task's non-tombstone status.
 * @returns the terminal row.
 */
function presentTask(task: TeamTaskView, status: Exclude<TeamTaskView['status'], 'deleted'>): TeamTaskRow {
  return {
    id: task.id,
    revision: task.revision,
    subject: task.subject,
    description: task.description,
    status,
    blockedBy: task.blockedBy,
    writeScopes: task.writeScopes,
    ...task.ownerName === undefined ? {} : { ownerName: task.ownerName },
    ready: task.ready,
    writeScopeWarnings: task.writeScopeWarnings,
  }
}

/**
 * Read the root's direct-child catalog, which paints before descendant discovery settles.
 * @param ctx - host context carrying the projection registry.
 * @param agent - the presented root Agent.
 * @returns one row per direct child, or an empty list when no catalog is available.
 */
export function readMemberCatalog(ctx: Context, agent: Agent | undefined): readonly TeamMemberRow[] {
  if (agent === undefined) return []
  const entries = ctx.get('sessionProjections')?.snapshot(agent.session).values.subagentCatalog
  return entries === undefined ? [] : entries.map(entry => catalogMember(entry))
}

/**
 * Convert one catalog entry into a direct-child row.
 * @param entry - parent-owned catalog entry.
 * @returns the teammate row.
 */
function catalogMember(entry: SubagentCatalogEntry): TeamMemberRow {
  const name = 'name' in entry ? entry.name : undefined
  return {
    id: String(entry.id),
    name: name ?? String(entry.id),
    ...entry.label === undefined ? {} : { description: entry.label },
  }
}

/**
 * Convert discovered descendants into teammate rows in catalog pre-order.
 * @param entries - descendants returned by the subagent runtime.
 * @returns the teammate rows, including unreadable-branch diagnostics.
 */
export function deriveMemberRows(entries: readonly SubagentDescendantListEntry[]): readonly TeamMemberRow[] {
  return entries.map((entry) => {
    const name = entry.path ?? String(entry.id)
    if (entry.kind === 'diagnostic') return { id: String(entry.id), name, reason: entry.reason }
    return { id: String(entry.id), name, ...entry.label === undefined ? {} : { description: entry.label } }
  })
}

/**
 * Whether the projection carries anything a terminal user should see.
 * @param team - the Team projection.
 * @param members - teammate rows derived from the root's subagent tree.
 * @returns whether a teammate, a shared task, or a rejected record is present.
 */
export function teamVisible(team: TeamProjection | undefined, members: readonly TeamMemberRow[]): boolean {
  if (team === undefined) return false
  if (team.failure !== undefined) return true
  return team.enabled && (members.length > 0 || team.tasks.length > 0)
}

/**
 * Whether one teammate's live Agent reports a running turn.
 * @param ctx - host context carrying the Agent registry.
 * @param id - teammate Session identity.
 * @returns whether the Agent is inside a turn right now.
 */
export function memberRunning(ctx: Context, id: string): boolean {
  return ctx.get('agents')?.get(SessionId(id))?.status === 'running'
}

/**
 * Summarize one Team for the compact strip.
 * @param ctx - host context carrying the Agent registry.
 * @param team - the Team projection.
 * @param members - teammate rows derived from the root's subagent tree.
 * @returns teammate, running, and task counts.
 */
export function summarizeTeam(ctx: Context, team: TeamProjection, members: readonly TeamMemberRow[]): TeamSummary {
  let running = 0
  for (const member of members) {
    if (memberRunning(ctx, member.id)) running += 1
  }
  let ready = 0
  let blocked = 0
  let inProgress = 0
  let completed = 0
  for (const task of team.tasks) {
    if (task.status === 'completed') completed += 1
    else if (task.status === 'in_progress') inProgress += 1
    else if (task.ready) ready += 1
    else blocked += 1
  }
  return {
    teammates: members.length,
    running,
    totalTasks: ready + blocked + inProgress + completed,
    ready,
    blocked,
    inProgress,
    completed,
  }
}

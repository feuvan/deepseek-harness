/**
 * Shared harness for the Terminal Agent Teams plugin tests: a fake
 * `ctx.terminalUi` seam, a real Cordis context with structural service
 * doubles, and Team projection, subagent-tree, and task fixtures.
 *
 * @module tests/harness
 */

import { onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, AgentStatus, Inbox } from '@deepseek-ai/dsh-agent'
import type { TeamProjection as AgentTeamProjection } from '@deepseek-ai/dsh-agent-team'
import type { SubagentCatalogEntry, SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'
import type { Component } from '@earendil-works/pi-tui'
import { setCopyLocale } from '../src/copy.ts'
import type { TeamProjection, TeamTaskRow } from '../src/team.ts'
import type { DockComponent, Palette, TeamCommand, TerminalUiLike } from '../src/types.ts'

/** One palette double that records which styling method was used. */
export interface PaletteDouble {
  readonly palette: Palette
  readonly calls: string[]
}

/**
 * Build the identity palette double.
 * @returns the palette and its style-call log.
 */
export function paletteDouble(): PaletteDouble {
  const calls: string[] = []
  const wrap = (name: string) => (text: string): string => { calls.push(name); return text }
  return {
    palette: {
      heading: wrap('heading'),
      accent: wrap('accent'),
      inverse: wrap('inverse'),
      dim: wrap('dim'),
      warning: wrap('warning'),
      success: wrap('success'),
    },
    calls,
  }
}

/** One recorded dock presentation. */
export interface DockPresentation {
  readonly component: DockComponent
  readonly close: () => void
}

/** A fake terminal contribution seam with recordings. */
export interface FakeUi extends TerminalUiLike {
  readonly strips: Component[]
  readonly commands: Map<string, TeamCommand>
  readonly editors: string[]
  readonly notices: string[]
  readonly docks: DockPresentation[]
  readonly closed: { count: number }
  renders: number
  agentValue: Agent | undefined
}

/**
 * Build one fake contribution seam.
 * @param options - palette, locale, and presented Agent overrides.
 * @returns the seam double.
 */
export function fakeUi(options: {
  palette?: Palette
  locale?: 'en' | 'zh'
  agent?: Agent
} = {}): FakeUi {
  const strips: Component[] = []
  const commands = new Map<string, TeamCommand>()
  const editors: string[] = []
  const notices: string[] = []
  const docks: DockPresentation[] = []
  const closed = { count: 0 }
  const ui: FakeUi = {
    palette: options.palette ?? paletteDouble().palette,
    locale: options.locale ?? 'en',
    agentValue: options.agent,
    agent() { return this.agentValue },
    requestRender() { this.renders += 1 },
    registerStrip(component) {
      strips.push(component)
      return () => {
        const index = strips.indexOf(component)
        if (index >= 0) strips.splice(index, 1)
      }
    },
    registerCommand(command) {
      commands.set(command.name, command)
      return () => { commands.delete(command.name) }
    },
    openDock(component, close) {
      docks.push({ component, close })
    },
    closeDock() {
      closed.count += 1
      docks.pop()
    },
    setEditorText(text) { editors.push(text) },
    notice(text) { notices.push(text) },
    strips,
    commands,
    editors,
    notices,
    docks,
    closed,
    renders: 0,
  }
  return ui
}

/** The projection registry double with a live change feed. */
export interface ProjectionsDouble {
  /** The projection values returned for the presented Lead Session. */
  values: {
    agentTeam?: TeamProjection | AgentTeamProjection
    subagentCatalog?: SubagentCatalogEntry[]
  }
  /** Dispatch one change notification. */
  emit(session: unknown, key: string): void
  /** @returns the number of active listeners. */
  listenerCount(): number
}

/** One recorded transcript observation request. */
export interface ObservedSession {
  readonly sessionId: string
  readonly options: unknown
}

/** The subagent runtime double and its recordings. */
export interface SubagentsDouble {
  /** Descendant rows the next call resolves. */
  entries: readonly SubagentDescendantListEntry[]
  /** Rejection the next call throws, when set. */
  error: Error | undefined
  /** When true, calls never settle, modelling discovery still in flight. */
  pending: boolean
  /** Recorded calls, in order. */
  readonly calls: { readonly rootId: string; readonly signal: AbortSignal | undefined }[]
  listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]>
}

/** The structural services the controller consumes. */
export interface TeamServices {
  /** The projection registry double for the Lead Session. */
  readonly projections: ProjectionsDouble
  /** The subagent runtime double. */
  readonly subagents: SubagentsDouble
  /** Recorded `observeSession` calls. */
  readonly observed: ObservedSession[]
  /** Live Agent statuses keyed by Session identity. */
  readonly agentStatuses: Map<string, string>
}

/** One controller harness. */
export interface ControllerHarness {
  readonly ctx: Context
  readonly ui: FakeUi
  readonly agent: Agent
  readonly services: TeamServices
}

/** Harness options for one controller test. */
export interface ControllerOptions {
  /** Projection value for the presented Session; omit to compose no Team projection. */
  projection?: TeamProjection | AgentTeamProjection
  /** Direct-child catalog for the presented Session; derived from `descendants` when omitted. */
  subagentCatalog?: readonly SubagentCatalogEntry[]
  /** Descendant rows returned by the subagent runtime double. */
  descendants?: readonly SubagentDescendantListEntry[]
  /** Rejection thrown by the subagent runtime double. */
  descendantsError?: Error
  /** Let descendant discovery stay in flight forever. */
  descendantsPending?: boolean
  /** Omit the subagent runtime service entirely. */
  withoutSubagents?: boolean
  /** Omit the projection registry service entirely. */
  withoutProjections?: boolean
  /** Durable events returned by the transcript observation. */
  events?: readonly unknown[]
  /** Rejection thrown by `observeSession`. */
  queryError?: unknown
  /** Omit the sessionQuery service entirely. */
  withoutQuery?: boolean
  /** Present no Agent. */
  withoutAgent?: boolean
  /** Locale for the seam. */
  locale?: 'en' | 'zh'
}

/**
 * Build one Agent double over the supplied Session identity.
 * @param session - the Agent's Session.
 * @param status - live Agent status.
 * @param model - Agent option model.
 * @returns the typed Agent double.
 */
function agentDouble(session: Session, status: AgentStatus, model: string): Agent {
  const inbox: Inbox = {
    nextTurn: [],
    nextStep: [],
    clear: () => {},
    append: () => {},
    prepend: () => {},
    replace: () => false,
    remove: () => false,
    splice: () => [],
  }
  return {
    id: session.id,
    session,
    inbox,
    get status() { return status },
    model: {
      current: () => ({ provider: 'test', model }),
      select: () => {},
    },
    ctx: new Context(),
    options: { provider: 'test', model },
    cancel: () => {},
    whenIdle: async () => {},
    runMaintenance: async task => task(new AbortController().signal),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
  }
}

/**
 * Build one controller harness over a real Cordis context and fake seam.
 * @param options - projection, subtree, observation, and Agent overrides.
 * @returns the context, seam, agent, and service recordings.
 */
export function controllerHarness(options: ControllerOptions = {}): ControllerHarness {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  setCopyLocale(options.locale ?? 'en')

  const session = Session.create(SessionId('lead-session'))
  const agent = agentDouble(session, 'idle', 'test')
  const ui = fakeUi({
    locale: options.locale ?? 'en',
    ...(options.withoutAgent === true ? {} : { agent }),
  })

  const values: ProjectionsDouble['values'] = {}
  if (options.projection !== undefined) values.agentTeam = options.projection
  const catalog = options.subagentCatalog
    ?? (options.descendants === undefined ? undefined : catalogFromDescendants(options.descendants))
  if (catalog !== undefined) values.subagentCatalog = [...catalog]
  const listeners = new Set<(session: unknown, key: string) => void>()
  const projections: ProjectionsDouble = {
    values,
    emit(sessionToken, key) { for (const listener of [...listeners]) listener(sessionToken, key) },
    listenerCount: () => listeners.size,
  }
  if (options.withoutProjections !== true) {
    ctx.provide('sessionProjections', {
      snapshot: (target: Session) => String(target.id) === String(session.id) ? { values } : { values: {} },
      onChanged: (listener: (session: unknown, key: string) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    } as never)
  }

  const observed: ObservedSession[] = []
  if (options.withoutQuery !== true) {
    ctx.provide('sessionQuery', {
      observeSession: async (sessionId: unknown, observationOptions: unknown) => {
        observed.push({ sessionId: String(sessionId), options: observationOptions })
        if (options.queryError !== undefined) throw options.queryError
        return { events: options.events ?? [], [Symbol.dispose]: () => {} }
      },
    } as never)
  }

  const agentStatuses = new Map<string, string>()
  ctx.provide('agents', {
    get: (id: unknown) => {
      const key = String(id)
      if (key === String(session.id)) return agent
      const status = agentStatuses.get(key)
      return status === undefined ? undefined : { status }
    },
  } as never)

  const subagents: SubagentsDouble = {
    entries: options.descendants ?? [],
    error: options.descendantsError,
    pending: options.descendantsPending === true,
    calls: [],
    listDescendants(rootSessionId, signal) {
      this.calls.push({ rootId: String(rootSessionId), signal })
      if (this.pending) return new Promise<SubagentDescendantListEntry[]>(() => {})
      return this.error === undefined
        ? Promise.resolve([...this.entries])
        : Promise.reject(this.error)
    },
  }
  if (options.withoutSubagents !== true) ctx.provide('subagents', subagents as never)

  return {
    ctx,
    ui,
    agent,
    services: { projections, subagents, observed, agentStatuses },
  }
}

/**
 * Derive the direct-child catalog the live root Session paints from.
 * @param entries - descendant rows for the whole tree.
 * @returns parent-catalog entries for the direct children.
 */
function catalogFromDescendants(entries: readonly SubagentDescendantListEntry[]): SubagentCatalogEntry[] {
  return entries.flatMap((entry, index) => {
    if (entry.kind !== 'child' || entry.depth !== 1) return []
    const name = entry.path?.split('/').at(-1)
    return [{
      id: entry.id,
      createdAt: index + 1,
      mode: entry.mode,
      ...entry.label === undefined ? {} : { label: entry.label },
      ...name === undefined ? {} : { name },
    } as SubagentCatalogEntry]
  })
}

/**
 * Emit one live Agent lifecycle event for the controller's subscriptions.
 * @param ctx - harness context.
 * @param event - the lifecycle event to emit.
 * @param id - the affected Session identity.
 * @param status - status carried by `agent/status`.
 */
export function emitAgentEvent(
  ctx: Context,
  event: 'agent/created' | 'agent/disposed' | 'agent/status',
  id: string,
  status: AgentStatus = 'running',
): void {
  const agent = { session: sessionToken(id) }
  if (event === 'agent/status') ctx.emit(event, { agent, status } as never)
  else ctx.emit(event, { agent } as never)
}

/**
 * Build one shared task row.
 * @param overrides - fields to replace.
 * @returns the task row.
 */
export function teamTask(overrides: Partial<TeamTaskRow> = {}): TeamTaskRow {
  return {
    id: 'task-1',
    revision: 1,
    subject: 'Inspect the workspace',
    description: 'Inspect the workspace and report findings.',
    status: 'pending',
    blockedBy: [],
    writeScopes: [],
    ready: true,
    writeScopeWarnings: [],
    ...overrides,
  }
}

/**
 * Build one Team projection with Team mode on.
 * @param overrides - fields to replace.
 * @returns the projection.
 */
export function teamProjection(overrides: Partial<TeamProjection> = {}): TeamProjection {
  return { enabled: true, tasks: [], ...overrides }
}

/**
 * Build one direct-child descendant row.
 * @param overrides - identity, name, and description to replace.
 * @returns the descendant row.
 */
export function memberEntry(overrides: {
  id?: string
  path?: string
  label?: string
  depth?: number
  parentId?: string
} = {}): SubagentDescendantListEntry {
  const id = SessionId(overrides.id ?? 'teammate-1')
  return {
    kind: 'child',
    id,
    mode: 'continuable',
    label: overrides.label ?? 'Reviews diffs',
    parentId: SessionId(overrides.parentId ?? 'lead-session'),
    depth: overrides.depth ?? 1,
    ...overrides.path === undefined ? {} : { path: overrides.path },
    activity: 'inactive',
    hasChildren: false,
  }
}

/**
 * Build one unreadable-branch diagnostic row.
 * @param overrides - identity, name, depth, and reason to replace.
 * @returns the diagnostic row.
 */
export function diagnosticEntry(overrides: {
  id?: string
  path?: string
  depth?: number
  reason?: 'corrupt' | 'unsupported' | 'unavailable'
} = {}): SubagentDescendantListEntry {
  return {
    kind: 'diagnostic',
    id: SessionId(overrides.id ?? 'broken-1'),
    parentId: SessionId('lead-session'),
    depth: overrides.depth ?? 1,
    ...overrides.path === undefined ? {} : { path: overrides.path },
    reason: overrides.reason ?? 'corrupt',
  }
}

/**
 * Build one durable user-message event.
 * @param text - message text.
 * @returns the structural event.
 */
export function userEvent(text: string): unknown {
  return { type: 'user/message', data: { content: [{ type: 'text', text }] } }
}

/**
 * Build one durable assistant-message event.
 * @param text - assistant text.
 * @returns the structural event.
 */
export function assistantEvent(text: string): unknown {
  return { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }
}

/**
 * Build one durable tool-call event.
 * @param name - tool name.
 * @returns the structural event.
 */
export function toolCallEvent(name: string): unknown {
  return { type: 'tool/call', data: { name } }
}

/**
 * Build one durable non-completed turn-end event.
 * @param kind - turn-end kind.
 * @returns the structural event.
 */
export function turnEndEvent(kind: string): unknown {
  return { type: 'turn/end', data: { reason: { kind } } }
}

/**
 * Build one Session token matching a teammate identity.
 * @param id - Session identity.
 * @returns the structural Session.
 */
export function sessionToken(id: string): { readonly id: ReturnType<typeof SessionId> } {
  return { id: SessionId(id) }
}

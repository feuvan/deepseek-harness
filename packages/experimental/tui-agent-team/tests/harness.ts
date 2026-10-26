/**
 * Shared harness for the Terminal Agent Teams plugin tests: a fake
 * `ctx.terminalUi` seam, a real Cordis context with structural service
 * doubles, and Team projection/task fixtures.
 *
 * @module tests/harness
 */

import { onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, AgentStatus, Inbox } from '@deepseek-ai/dsh-agent'
import type { Component } from '@earendil-works/pi-tui'
import { setCopyLocale } from '../src/copy.ts'
import type {
  TeamMemberProjectionRow, TeamProjection, TeamTaskRow,
} from '../src/team.ts'
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

/** The Team projection registry double with a live change feed. */
export interface ProjectionsDouble {
  /** The projection values returned for the presented Lead Session. */
  values: { agentTeam?: TeamProjection }
  /** Dispatch one change notification. */
  emit(session: unknown): void
  /** @returns the number of active listeners. */
  listenerCount(): number
}

/** One recorded transcript observation request. */
export interface ObservedSession {
  readonly sessionId: string
  readonly options: unknown
}

/** Live and persisted facts the panel overlays on one roster member. */
export interface MemberRuntimeConfig {
  /** Live Agent status; `inactive` models a live Agent outside a running turn. */
  readonly status?: AgentStatus | 'inactive'
  /** Model carried by the live Agent options. */
  readonly model?: string
  /** Persisted model reported by the member Session projection. */
  readonly sessionModel?: string
  /** Omit the member Session even though its Agent may exist. */
  readonly withoutSession?: boolean
  /** Omit the live member Agent. */
  readonly withoutAgent?: boolean
}

/** The structural services the controller consumes. */
export interface TeamServices {
  /** The projection registry double for the Lead Session. */
  readonly projections: ProjectionsDouble
  /** Recorded `observeSession` calls. */
  readonly observed: ObservedSession[]
  /** Live Agent statuses keyed by Session identity. */
  readonly agentStatuses: Map<string, string>
  /** Per-member runtime configuration the Agent/session doubles read. */
  readonly members: Map<string, MemberRuntimeConfig>
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
  /** Projection value for the presented Session; omit to compose no Team. */
  projection?: TeamProjection
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
  /** Runtime facts for roster members keyed by Session identity. */
  members?: Readonly<Record<string, MemberRuntimeConfig>>
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
 * @param options - projection, observation, runtime, and Agent overrides.
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

  const values: { agentTeam?: TeamProjection } = options.projection === undefined
    ? {}
    : { agentTeam: options.projection }
  const members = new Map<string, MemberRuntimeConfig>(Object.entries(options.members ?? {}))
  const sessionsById = new Map<string, Session>()
  const listeners = new Set<(session: unknown) => void>()
  const projections: ProjectionsDouble = {
    values,
    emit(session) { for (const listener of [...listeners]) listener(session) },
    listenerCount: () => listeners.size,
  }
  /** @returns the member Session, created on first use. */
  const memberSession = (id: string): Session => {
    const existing = sessionsById.get(id)
    if (existing !== undefined) return existing
    const created = Session.create(SessionId(id))
    sessionsById.set(id, created)
    return created
  }
  ctx.provide('sessionProjections', {
    snapshot: (target: Session) => {
      const id = String(target.id)
      if (id === String(session.id)) return { values }
      const model = members.get(id)?.sessionModel
      return { values: model === undefined ? {} : { modelSelection: { next: { model } } } }
    },
    onChanged: (listener: (session: unknown) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  } as never)

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

  ctx.provide('sessions', {
    get: (id: unknown) => {
      const key = String(id)
      const config = members.get(key)
      if (config === undefined || config.withoutSession === true) return undefined
      return memberSession(key)
    },
  } as never)

  const agentStatuses = new Map<string, string>()
  ctx.provide('agents', {
    get: (id: unknown) => {
      const key = String(id)
      if (key === String(session.id)) return agent
      const config = members.get(key)
      const status = agentStatuses.get(key) ?? config?.status
      if (config === undefined && status === undefined) return undefined
      if (config?.withoutAgent === true) return undefined
      return {
        status: status ?? 'idle',
        options: { provider: 'test', model: config?.model ?? 'test' },
      }
    },
  } as never)

  return {
    ctx,
    ui,
    agent,
    services: { projections, observed, agentStatuses, members },
  }
}

/**
 * Build one roster row.
 * @param overrides - fields to replace.
 * @returns the roster row.
 */
export function teamMember(overrides: Partial<TeamMemberProjectionRow> = {}): TeamMemberProjectionRow {
  return { id: 'team-lead', name: 'Lead', role: 'lead', phase: 'active', ...overrides }
}

/**
 * Build one task row.
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
 * Build one Team projection.
 * @param overrides - fields to replace.
 * @returns the projection.
 */
export function teamProjection(overrides: Partial<TeamProjection> = {}): TeamProjection {
  return { members: [teamMember()], tasks: [], ...overrides }
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

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
  /** The projection values returned by `snapshot`. */
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

/** The structural services the controller consumes. */
export interface TeamServices {
  /** The projection registry double. */
  readonly projections: ProjectionsDouble
  /** Recorded `observeSession` calls. */
  readonly observed: ObservedSession[]
  /** Teammate Agent statuses keyed by Session identity. */
  readonly agentStatuses: Map<string, string>
  /** Task/message service recordings. */
  readonly created: { readonly subject: string; readonly description: string }[]
  /** Task transition recordings. */
  readonly updates: { readonly taskId: string; readonly expectedRevision: number; readonly action: string }[]
  /** Peer-message recordings. */
  readonly messages: { readonly target: string; readonly text: string }[]
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
  /** Omit the Agent Teams task/message service. */
  withoutTeamService?: boolean
  /** Rejection thrown by every Team service action. */
  serviceError?: unknown
  /** Present no Agent. */
  withoutAgent?: boolean
  /** Locale for the seam. */
  locale?: 'en' | 'zh'
}

/**
 * Build one controller harness over a real Cordis context and fake seam.
 * @param options - projection, observation, service, and Agent overrides.
 * @returns the context, seam, agent, and service recordings.
 */
export function controllerHarness(options: ControllerOptions = {}): ControllerHarness {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  setCopyLocale(options.locale ?? 'en')

  const session = Session.create(SessionId('lead-session'))
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
  const status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    session,
    inbox,
    get status() { return status },
    ctx,
    options: { provider: 'test', model: 'test' },
    cancel: () => {},
    whenIdle: async () => {},
    runMaintenance: async task => task(new AbortController().signal),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
  }
  const ui = fakeUi({
    locale: options.locale ?? 'en',
    ...(options.withoutAgent === true ? {} : { agent }),
  })

  const values: { agentTeam?: TeamProjection } = options.projection === undefined
    ? {}
    : { agentTeam: options.projection }
  const listeners = new Set<(session: unknown) => void>()
  const projections: ProjectionsDouble = {
    values,
    emit(session) { for (const listener of [...listeners]) listener(session) },
    listenerCount: () => listeners.size,
  }
  ctx.provide('sessionProjections', {
    snapshot: () => ({ values }),
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

  const agentStatuses = new Map<string, string>()
  ctx.provide('agents', {
    get: (id: unknown) => {
      const status = agentStatuses.get(String(id))
      return status === undefined ? undefined : { status }
    },
  } as never)

  const created: TeamServices['created'] = []
  const updates: TeamServices['updates'] = []
  const messages: TeamServices['messages'] = []
  if (options.withoutTeamService !== true) {
    const reject = async (): Promise<never> => { throw options.serviceError }
    ctx.provide('agentTeams', {
      createTask: async (_agent: unknown, request: { subject: string; description: string }) => {
        if (options.serviceError !== undefined) return reject()
        created.push(request)
        return { id: 'task-new' }
      },
      updateTask: async (_agent: unknown, request: { taskId: string; expectedRevision: number; action: string }) => {
        if (options.serviceError !== undefined) return reject()
        updates.push(request)
        return { id: request.taskId }
      },
      sendMessage: async (_agent: unknown, request: { target: string; content: readonly { type: 'text'; text: string }[] }) => {
        if (options.serviceError !== undefined) return reject()
        messages.push({ target: request.target, text: request.content[0]?.text ?? '' })
        return {}
      },
    } as never)
  }

  return {
    ctx,
    ui,
    agent,
    services: { projections, observed, agentStatuses, created, updates, messages },
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

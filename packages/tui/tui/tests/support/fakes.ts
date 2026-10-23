/**
 * Test doubles and real minimal services for terminal tests.
 *
 * @module tests/support/fakes
 */

import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { Inbox } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Create a context with the supplied services provided directly.
 * @param services - service name to test double.
 * @returns the context.
 */
export function testContext(services: Record<string, unknown> = {}): Context {
  const ctx = new Context()
  for (const [name, value] of Object.entries(services)) ctx.provide(name, value)
  return ctx
}

/**
 * Mount the real Session store on one context.
 * @param ctx - the owning context.
 * @returns a promise settled after the store fiber activates.
 */
export async function mountSessions(ctx: Context): Promise<void> {
  await ctx.plugin(SessionStore)
}

/**
 * Create a real live Session in the provided store.
 * @param ctx - context carrying `ctx.sessions`.
 * @param id - exact Session identity.
 * @param events - seed events appended before returning.
 * @returns the live Session.
 */
export function createSession(ctx: Context, id = 'session-test', events: readonly SessionEvent[] = []): Session {
  return ctx.sessions.create(SessionId(id), { seed: events })
}

/** A no-op inbox sufficient for Agent shapes used by terminal tests. */
export function testInbox(): Inbox {
  return {
    nextTurn: [],
    nextStep: [],
    clear: () => {},
    append: () => {},
    prepend: () => {},
    replace: () => false,
    remove: () => false,
    splice: () => [],
  }
}

/** Options for {@link testAgent}. */
export interface TestAgentOptions {
  /** The real Session the Agent presents. */
  readonly session: Session
  /** Initial status; defaults to idle. */
  readonly status?: AgentStatus
  /** Agent creation options; defaults to a test provider/model. */
  readonly options?: Agent['options']
  /** Received prompts and steering input, in call order. */
  readonly received?: string[]
  /** Cancellation causes received, in call order. */
  readonly cancels?: string[]
}

/**
 * Build one Agent double around a real Session and a real scoped context.
 * @param options - session, status, and recording sinks.
 * @returns the Agent and its scoped context.
 */
export function testAgent(options: TestAgentOptions): { agent: Agent; ctx: Context } {
  const ctx = new Context()
  const received = options.received ?? []
  const cancels = options.cancels ?? []
  const inbox = testInbox()
  const agent: Agent = {
    id: options.session.id,
    session: options.session,
    inbox,
    status: options.status ?? 'idle',
    ctx,
    options: options.options ?? { provider: 'test', model: 'test' },
    cancel: (cause) => { cancels.push(cause.kind) },
    whenIdle: async () => {},
    runMaintenance: async task => task(new AbortController().signal),
    send: (message) => { received.push(message.content.map(block => block.type === 'text' ? block.text : '').join('')) },
    followup: (message) => { received.push(message.content.map(block => block.type === 'text' ? block.text : '').join('')) },
    steer: (message) => { received.push(message.content.map(block => block.type === 'text' ? block.text : '').join('')) },
    inject: () => {},
  }
  return { agent, ctx }
}

/** Presenter overrides for a test tool. */
export interface TestToolPresenters {
  /** Call-time presenter. */
  readonly presentCall?: ToolDefinition['presentCall']
  /** Result-time presenter. */
  readonly presentResult?: ToolDefinition['presentResult']
}

/**
 * Build one registered-tool double with optional presenters.
 * @param name - registered tool name.
 * @param presenters - presenter overrides.
 * @returns the tool definition.
 */
export function testTool(name: string, presenters: TestToolPresenters = {}): ToolDefinition {
  const tool = defineTool({
    name,
    description: 'test tool',
    parameters: { value: { type: 'string' } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return ''
    },
  })
  return {
    ...tool,
    ...(presenters.presentCall === undefined ? {} : { presentCall: presenters.presentCall }),
    ...(presenters.presentResult === undefined ? {} : { presentResult: presenters.presentResult }),
  }
}

/**
 * Shared harness for terminal core tests: fresh Cordis contexts, host-service
 * doubles, mutable Agent doubles, and headless terminal applications.
 *
 * @module tests/core/harness
 */

import { expect, onTestFinished, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { TuiMainScreen, type Component, type MarkdownTheme, type OverlayHandle, type TUI } from '@earendil-works/pi-tui'
import type { AppExit } from '@deepseek-ai/dsh-cmdline'
import type {
  Agent, AgentOptions, AgentStatus, AssistantStreamFrame, ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import type { CommandDescriptor, CommandExecution } from '@deepseek-ai/dsh-commands'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { HeadlessTerminal } from '@deepseek-ai/dsh-terminal-snapshot'
import type { TerminalSession } from '../../src/terminal.ts'
import { createTerminalSession } from '../../src/terminal.ts'
import { resolveConfig, type Config, type ResolvedConfig } from '../../src/config.ts'
import { createMarkdownTheme } from '../../src/markdown.ts'
import { createPalette } from '../../src/palette.ts'
import type { TerminalTranscriptDeps } from '../../src/transcript.ts'
import { TerminalApp } from '../../src/lifecycle.ts'
import { testInbox } from '../support/fakes.ts'

/**
 * Create one context with the supplied services provided directly.
 * The context fiber is disposed when the owning test finishes.
 * @param services - service name to test double.
 * @returns the context.
 */
export function freshContext(services: Record<string, unknown> = {}): Context {
  const ctx = new Context()
  for (const [name, value] of Object.entries(services)) ctx.provide(name, value)
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return ctx
}

/** Render one message's text blocks, for received-prompt assertions. */
export function messageText(message: { content: readonly { type: string; text?: string }[] }): string {
  return message.content.map(block => (block.type === 'text' ? block.text ?? '' : '')).join('')
}

/**
 * Build one queued user message for the inbox double.
 * @param text - message text.
 * @returns the message identity and content.
 */
export function queuedMessage(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** Mutable Agent double options. */
export interface AgentDoubleOptions {
  /** The real Session the Agent presents. */
  readonly session: Session
  /** Initial status; defaults to idle. */
  readonly status?: AgentStatus
  /** Agent creation options; defaults to a test provider/model. */
  readonly options?: AgentOptions
  /** Messages already waiting in `inbox.nextTurn`. */
  readonly queued?: readonly UserMessage[]
}

/** A mutable Agent double with recording sinks. */
export interface AgentDouble {
  /** The Agent the terminal presents. */
  readonly agent: Agent
  /** Received prompts and steering input, in call order. */
  readonly received: string[]
  /** Follow-up deliveries, separately from steering input. */
  readonly followups: string[]
  /** Steering deliveries, in call order. */
  readonly steered: string[]
  /** Identities removed from the next-turn queue. */
  readonly removed: string[]
  /** Cancellation causes received, in call order. */
  readonly cancels: string[]
  /** Replace the lifecycle status. */
  setStatus(status: AgentStatus): void
  /** Replace the quiescence behavior. */
  setWhenIdle(run: () => Promise<void>): void
}

/**
 * Build one Agent double around a real Session and a real context.
 * @param options - session, status, and creation route.
 * @returns the Agent, recording sinks, and state setters.
 */
export function agentDouble(options: AgentDoubleOptions): AgentDouble {
  const ctx = new Context()
  const received: string[] = []
  const followups: string[] = []
  const steered: string[] = []
  const removed: string[] = []
  const cancels: string[] = []
  let status: AgentStatus = options.status ?? 'idle'
  let whenIdle: () => Promise<void> = async () => {}
  const agent: Agent = {
    id: options.session.id,
    session: options.session,
    inbox: testInbox({
      nextTurn: options.queued ?? [],
      removed,
    }),
    get status() { return status },
    ctx,
    options: options.options ?? { provider: 'test', model: 'test' },
    cancel: (cause) => { cancels.push(cause.kind) },
    whenIdle: () => whenIdle(),
    runMaintenance: async task => task(new AbortController().signal),
    send: (message) => { received.push(messageText(message)) },
    followup: (message) => { received.push(messageText(message)); followups.push(messageText(message)) },
    steer: (message) => { received.push(messageText(message)); steered.push(messageText(message)) },
    inject: () => {},
  }
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return {
    agent,
    received,
    followups,
    steered,
    removed,
    cancels,
    setStatus(next) { status = next },
    setWhenIdle(run) { whenIdle = run },
  }
}

/** Registry double for the root-Agent lookup. */
export interface AgentsDouble {
  /** The `ctx.agents` service. */
  readonly service: { get(id: SessionId): Agent | undefined }
  /** Bind the Agent returned for its own session identity. */
  bind(agent: Agent): void
}

/**
 * Build the root-Agent registry double.
 * @returns the service and its binding control.
 */
export function agentsDouble(): AgentsDouble {
  let bound: Agent | undefined
  return {
    service: {
      get: (id: SessionId) => (bound !== undefined && bound.session.id === id ? bound : undefined),
    },
    bind(agent) { bound = agent },
  }
}

/**
 * Build the tool-registry double.
 * @param find - resolves a registered tool by name.
 * @returns the `ctx.tools` service.
 */
export function toolsDouble(find: (name: string) => ToolDefinition | undefined): { get(name: string): ToolDefinition | undefined } {
  return { get: (name: string) => find(name) }
}

/** Command-registry double with its execution override. */
export interface CommandsDouble {
  /** The `ctx.commands` service. */
  readonly service: {
    list(agent: Agent): readonly CommandDescriptor[]
    execute(agent: Agent, line: string): Promise<CommandExecution | undefined>
  }
  /** Every submitted line, in call order. */
  readonly executed: string[]
}

/** Options for {@link commandsDouble}. */
export interface CommandsDoubleOptions {
  /** Descriptors returned by `list`; defaults to none. */
  readonly descriptors?: readonly CommandDescriptor[]
  /** Execution outcome; defaults to undefined for every line. */
  readonly execute?: (line: string) => Promise<CommandExecution | undefined>
}

/**
 * Build the command-registry double.
 * @param options - descriptors and the execution override.
 * @returns the service and recorded lines.
 */
export function commandsDouble(options: CommandsDoubleOptions = {}): CommandsDouble {
  const executed: string[] = []
  const service = {
    list: (_agent: Agent): readonly CommandDescriptor[] => options.descriptors ?? [],
    async execute(_agent: Agent, line: string): Promise<CommandExecution | undefined> {
      executed.push(line)
      return options.execute === undefined ? undefined : options.execute(line)
    },
  }
  return { service, executed }
}

/** One observation lease returned by the session-query double. */
export interface ObservationDouble {
  /** The exact replayed events. */
  readonly events: readonly SessionEvent[]
  /** Release the lease. */
  [Symbol.dispose](): void
}

/**
 * Build one observation lease over the supplied events.
 * @param events - exact replayed events.
 * @returns the lease.
 */
export function observation(events: readonly SessionEvent[]): ObservationDouble {
  return { events, [Symbol.dispose]() {} }
}

/** Session-query double. */
export interface SessionQueryDouble {
  /** The `ctx.sessionQuery` service. */
  readonly service: { observeSession(sessionId: SessionId): Promise<ObservationDouble> }
  /** Every observed Session identity, in call order. */
  readonly observed: SessionId[]
}

/**
 * Build the session-query double.
 * @param read - resolves the observation for one Session.
 * @returns the service and observed identities.
 */
export function sessionQueryDouble(
  read: (sessionId: SessionId) => Promise<ObservationDouble>,
): SessionQueryDouble {
  const observed: SessionId[] = []
  return {
    service: {
      observeSession: (sessionId: SessionId) => {
        observed.push(sessionId)
        return read(sessionId)
      },
    },
    observed,
  }
}

/** Session-projection double with a live change feed. */
export interface ProjectionsDouble {
  /** The `ctx.sessionProjections` service. */
  readonly service: {
    onChanged(listener: (session: Session) => void): () => void
    snapshot(session: Session): { asOfSeq: number; values: Record<string, unknown> }
    stateOf(session: Session, key: string): unknown
  }
  /** Values returned by `snapshot`; mutated in place to simulate projection changes. */
  readonly values: Record<string, unknown>
  /** Dispatch one change notification to every subscriber. */
  emit(session: Session): void
  /** @returns the number of active subscribers. */
  listenerCount(): number
}

/**
 * Build the projection-registry double.
 * @param values - initial client-visible values.
 * @returns the service and its feed controls.
 */
export function projectionsDouble(values: Record<string, unknown> = {}): ProjectionsDouble {
  const listeners = new Set<(session: Session) => void>()
  return {
    service: {
      onChanged: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      snapshot: () => ({ asOfSeq: 0, values }),
      stateOf: (_session, key) => values[key],
    },
    values,
    emit: (session) => { for (const listener of [...listeners]) listener(session) },
    listenerCount: () => listeners.size,
  }
}

/** LLM-registry double options. */
export interface LlmDoubleOptions {
  /** Advertised provider routes. */
  readonly providers: readonly LlmProviderInfo[]
  /** Model enumeration for one provider; may reject. */
  readonly listModels: (provider: string) => Promise<readonly LlmModelInfo[]>
  /** Model metadata resolution for one route. */
  readonly resolveModelInfo: (provider: string, model: string) => Promise<LlmResolvedModelInfo>
}

/**
 * Build the LLM-registry double.
 * @param options - providers and enumeration/resolution answers.
 * @returns the `ctx.llm` service.
 */
export function llmDouble(options: LlmDoubleOptions): {
  listProviders(): readonly LlmProviderInfo[]
  listModels(provider: string): Promise<readonly LlmModelInfo[]>
  resolveModelInfo(provider: string, model: string): Promise<LlmResolvedModelInfo>
} {
  return {
    listProviders: () => options.providers,
    listModels: (provider: string) => options.listModels(provider),
    resolveModelInfo: (provider: string, model: string) => options.resolveModelInfo(provider, model),
  }
}

/**
 * Build the user-questions service double exposing the timed-wait stream.
 * @param attach - the `attachWait` implementation.
 * @returns the `ctx.userQuestions` service.
 */
export function userQuestionsDouble(
  attach: () => AsyncIterable<{ remainingMs: number }>,
): { attachWait(): AsyncIterable<{ remainingMs: number }> } {
  return { attachWait: () => attach() }
}

/** Application-exit double. */
export interface AppExitDouble {
  /** The exit callback supplied to the plugin. */
  readonly exit: AppExit
  /** Every requested exit code, in call order. */
  readonly codes: number[]
}

/**
 * Build the launcher exit double.
 * @returns the callback and recorded codes.
 */
export function appExitDouble(): AppExitDouble {
  const codes: number[] = []
  const exit: AppExit = (code) => { codes.push(code) }
  return { exit, codes }
}

/**
 * Resolve one terminal configuration for tests.
 * @param overrides - presentation values to replace.
 * @returns the immutable resolved configuration.
 */
export function terminalConfig(overrides: Partial<Config> = {}): ResolvedConfig {
  return resolveConfig({
    sessionId: 'session-test',
    color: false,
    animation: false,
    previewLines: 4,
    windowBlocks: 200,
    title: 'Test Terminal',
    locale: 'auto',
    busyEnter: 'queue',
    ...overrides,
  })
}

/**
 * Build the transcript dependencies for component-level tests.
 * @param overrides - dependency values to replace.
 * @returns the transcript dependencies.
 */
export function transcriptDeps(overrides: Partial<TerminalTranscriptDeps> = {}): TerminalTranscriptDeps {
  const palette = createPalette(false)
  return {
    palette,
    markdown: createMarkdownTheme(palette),
    previewLines: 4,
    windowBlocks: 200,
    requestRender: vi.fn(),
    findTool: () => undefined,
    ...overrides,
  }
}

/**
 * Build a ModelSelectionRef.
 * @param current - the selected route, when any.
 * @returns the mutable selection reference.
 */
export function selectionRef(current?: ModelSelectionRef['current']): ModelSelectionRef {
  return { current, assembled: undefined }
}

/** A headless terminal session used as the application surface. */
export interface HeadlessSession {
  /** The emulator-backed terminal. */
  readonly headless: HeadlessTerminal
  /** The renderer over that terminal. */
  readonly session: TerminalSession
}

/**
 * Build one headless terminal session; the emulator is disposed with the test.
 * @param options - geometry and whether to use the main-screen renderer.
 * @returns the terminal session and its emulator.
 */
export function headlessSession(options: { columns?: number; rows?: number; mainScreen?: boolean } = {}): HeadlessSession {
  const headless = new HeadlessTerminal({ columns: options.columns ?? 100, rows: options.rows ?? 30 })
  onTestFinished(() => { headless.dispose() })
  if (options.mainScreen === true) {
    const tui = new TuiMainScreen(headless)
    let stopped = false
    const session: TerminalSession = {
      tui,
      terminal: headless,
      stop: () => {
        if (stopped) return
        stopped = true
        tui.stop()
      },
    }
    return { headless, session }
  }
  return { headless, session: createTerminalSession(headless) }
}

/** One terminal the lifecycle created, with start/stop spies. */
export interface CreatedTerminal {
  /** The emulator-backed terminal. */
  readonly headless: HeadlessTerminal
  /** The terminal session handed to the application. */
  readonly session: TerminalSession
  /** The renderer start spy. */
  readonly start: MockInstance<() => void>
  /** The terminal-session stop spy. */
  readonly stop: MockInstance<() => void>
}

/** Recording terminal factory. */
export interface TerminalFactoryDouble {
  /** Passed to the TerminalApp constructor. */
  readonly factory: () => TerminalSession
  /** Every terminal the application created, in order. */
  readonly created: CreatedTerminal[]
}

/**
 * Build a terminal factory recording each created surface.
 * @param options - geometry and renderer kind.
 * @returns the factory and created terminals.
 */
export function terminalFactoryDouble(
  options: { columns?: number; rows?: number; mainScreen?: boolean } = {},
): TerminalFactoryDouble {
  const created: CreatedTerminal[] = []
  return {
    created,
    factory: () => {
      const owned = headlessSession(options)
      const start = vi.spyOn(owned.session.tui, 'start')
      const stop = vi.spyOn(owned.session, 'stop')
      created.push({ headless: owned.headless, session: owned.session, start, stop })
      return owned.session
    },
  }
}

/**
 * Build the terminal application over one fresh context.
 * @param ctx - host context carrying every consumed service.
 * @param options - configuration, exit callback, and terminal factory.
 * @returns the application and the factory's created terminals.
 */
export function terminalApp(
  ctx: Context,
  options: {
    readonly config?: ResolvedConfig
    readonly appExit?: AppExit
    readonly terminals?: TerminalFactoryDouble
  } = {},
): { app: TerminalApp; terminals: TerminalFactoryDouble } {
  const terminals = options.terminals ?? terminalFactoryDouble()
  const exit = options.appExit ?? appExitDouble().exit
  const app = new TerminalApp(ctx, options.config ?? terminalConfig(), exit, terminals.factory)
  onTestFinished(() => { app.dispose() })
  return { app, terminals }
}

/**
 * Wait until the application committed its first rendered frame.
 * @param terminals - the recording factory.
 * @returns the created terminal.
 */
export async function waitForStartedTerminal(terminals: TerminalFactoryDouble): Promise<CreatedTerminal> {
  const first = terminals.created[0]
  if (first === undefined) throw new Error('terminal app did not create a terminal')
  await vi.waitFor(() => { expect(first.start).toHaveBeenCalled() })
  return first
}

/**
 * Read the current rendered screen text.
 * @param headless - the terminal to settle and read.
 * @returns the visible lines.
 */
export async function screenLines(headless: HeadlessTerminal): Promise<readonly string[]> {
  await headless.settle()
  return headless.state().lines
}

/**
 * Wait until the rendered screen contains one substring.
 * @param headless - the terminal to settle and read.
 * @param needle - required visible text.
 * @returns the matching screen lines.
 */
export async function waitForScreen(headless: HeadlessTerminal, needle: string): Promise<readonly string[]> {
  let lines: readonly string[] = []
  await vi.waitFor(async () => {
    lines = await screenLines(headless)
    expect(lines.join('\n')).toContain(needle)
  })
  return lines
}

/** A fake overlay handle recording its own state. */
export interface FakeOverlayHandle extends OverlayHandle {
  /** Whether `hide` ran. */
  hidden(): boolean
}

/**
 * Build one fake overlay handle.
 * @returns the handle.
 */
export function fakeOverlayHandle(): FakeOverlayHandle {
  let hidden = false
  let temporarily = false
  let focused = false
  return {
    hide: () => { hidden = true },
    setHidden: (value: boolean) => { temporarily = value },
    isHidden: () => temporarily,
    focus: () => { focused = true },
    unfocus: () => { focused = false },
    isFocused: () => focused,
    getBounds: () => undefined,
    hidden: () => hidden,
  }
}

/** Captured overlays from a stubbed `showOverlay`. */
export interface OverlayCapture {
  /** Every presented component, in order. */
  readonly components: Component[]
  /** The handle returned for each presented component, in order. */
  readonly handles: FakeOverlayHandle[]
  /** Options passed with each presentation, in order. */
  readonly options: unknown[]
}

/**
 * Replace one renderer's overlay presentation with a recorder.
 * @param tui - the renderer to stub.
 * @param onOpen - optional immediate interaction driven before the handle returns.
 * @returns the recorded presentations.
 */
export function captureOverlays(tui: TUI, onOpen?: (component: Component) => void): OverlayCapture {
  const capture: OverlayCapture = { components: [], handles: [], options: [] }
  vi.spyOn(tui, 'showOverlay').mockImplementation((component: Component, options?: unknown) => {
    const handle = fakeOverlayHandle()
    capture.components.push(component)
    capture.handles.push(handle)
    capture.options.push(options)
    onOpen?.(component)
    return handle
  })
  return capture
}

/**
 * Build a markdown theme over the unstyled palette.
 * @returns the theme.
 */
export function plainMarkdownTheme(): MarkdownTheme {
  return createMarkdownTheme(createPalette(false))
}

/**
 * Build a fully settled assistant stream frame.
 * @param attemptId - branded attempt identity.
 * @param type - frame kind.
 * @returns the frame.
 */
export function startFrame(attemptId: AssistantStreamFrame['attemptId'], turn: number, step: number): AssistantStreamFrame {
  return { type: 'start', attemptId, revision: 1, turn, step }
}


/** One agent-preset registry entry the chooser lists. */
export interface AgentPresetRow {
  /** Stable preset identity. */
  readonly id: string
  /** Optional display name. */
  readonly name?: string
  /** Optional description. */
  readonly description?: string
}

/** Agent-preset registry double options. */
export interface AgentPresetsOptions {
  /** Rows returned by `list`; defaults to the four shipped presets. */
  readonly rows?: readonly AgentPresetRow[]
  /** Registry default; defaults to `standard`. */
  readonly defaultId?: string
  /** Error or non-Error value `select` rejects with. */
  readonly selectError?: Error | string
}

/** One agent-preset registry double and its recordings. */
export interface AgentPresetsDouble {
  /** The `ctx.agentPresets` service. */
  readonly service: {
    readonly defaultId: string
    list(): Promise<readonly AgentPresetRow[]>
    resolve(id?: string): Promise<AgentPresetRow>
    acquireScope(id?: string): Promise<{ readonly key: object; [Symbol.asyncDispose](): Promise<void> }>
    mount(ctx: unknown, id?: string): Promise<AgentPresetRow>
    select(agent: unknown, id: string): Promise<string>
  }
  /** Every agent/identity pair `select` received. */
  readonly selected: { readonly agent: unknown; readonly id: string }[]
  /** Every identity mounted through `mount`. */
  readonly mounted: string[]
  /** Every identity resolved. */
  readonly resolved: (string | undefined)[]
}

/**
 * Build the agent-preset registry double.
 * @param options - rows, default identity, and select failure override.
 * @returns the service and its recordings.
 */
export function agentPresetsDouble(options: AgentPresetsOptions = {}): AgentPresetsDouble {
  const rows = options.rows ?? [
    { id: 'standard', name: 'Standard', description: 'Full coding tools.' },
    { id: 'ptc', name: 'PTC', description: 'PTC runtime and workflows.' },
    { id: 'minimal', name: 'Minimal', description: 'A compact prompt.' },
    { id: 'cordis', name: 'Cordis', description: 'Cordis self-modification.' },
  ]
  const defaultId = options.defaultId ?? 'standard'
  const selected: { agent: unknown; id: string }[] = []
  const mounted: string[] = []
  const resolved: (string | undefined)[] = []
  const row = (id?: string): AgentPresetRow => {
    const wanted = id ?? defaultId
    const found = rows.find(candidate => candidate.id === wanted)
    if (found === undefined) throw new Error(`Unknown agent preset: ${wanted}`)
    return found
  }
  return {
    service: {
      defaultId,
      list: async () => rows,
      resolve: async (id) => {
        resolved.push(id)
        return row(id)
      },
      acquireScope: async id => ({
        key: { id: id ?? defaultId },
        [Symbol.asyncDispose]: async () => {},
      }),
      mount: async (_ctx, id) => {
        mounted.push(id ?? defaultId)
        return row(id)
      },
      select: async (agent, id) => {
        if (options.selectError !== undefined) throw options.selectError
        selected.push({ agent, id })
        return id
      },
    },
    selected,
    mounted,
    resolved,
  }
}

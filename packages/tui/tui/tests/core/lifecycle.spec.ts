import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import type { Component } from '@earendil-works/pi-tui'
import type { HeadlessTerminal } from '@deepseek-ai/dsh-terminal-snapshot'
import { CommandId } from '@deepseek-ai/dsh-commands'
import type { CommandDescriptor, CommandExecution } from '@deepseek-ai/dsh-commands'
import { LlmAttemptId, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { TerminalApp } from '../../src/lifecycle.ts'
import type { TerminalTranscript } from '../../src/transcript.ts'
import type { TerminalSession } from '../../src/terminal.ts'
import { TerminalAutocompleteProvider, type TerminalAutocompleteDeps } from '../../src/autocomplete.ts'
import type { Composer } from '../../src/commands.ts'
import type { Footer } from '../../src/components/footer.ts'
import { copy, setCopyLocale } from '../../src/copy.ts'
import type { ComposerDeps } from '../../src/commands.ts'
import type { PromptEditor } from '../../src/components/editor.ts'
import type { BottomPanel } from '../../src/components/bottom.ts'
import type { BottomList } from '../../src/bottom-list.ts'
import type { CompletionController } from '../../src/completion.ts'
import type { ConfigPanel } from '../../src/config-panel.ts'
import type { ConfigRow } from '../../src/config-panel.ts'
import type { AutocompleteItem } from '@earendil-works/pi-tui'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AdmittedPromptContentPart, ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import type { AttachmentAdmissionPart } from '@deepseek-ai/dsh-attachment/types'
import { readClipboardImage } from '../../src/clipboard.ts'
import { mountSessions } from '../support/fakes.ts'

vi.mock('../../src/clipboard.ts', () => ({ readClipboardImage: vi.fn() }))
import { sessionTitle, toolCall, userMessage } from '../support/events.ts'
import {
  agentDouble, agentsDouble, appExitDouble, captureOverlays, commandsDouble, freshContext,
  headlessSession, llmDouble, observation, projectionsDouble, sessionQueryDouble, terminalConfig,
  toolsDouble, userQuestionsDouble, waitForScreen,
  type AgentDouble, type AgentsDouble, type AppExitDouble, type CommandsDouble,
  type ObservationDouble, type OverlayCapture, type ProjectionsDouble, type SessionQueryDouble,
} from './harness.ts'

/** One terminal the application owns, with its render spies. */
interface FixedTerminal {
  readonly headless: HeadlessTerminal
  readonly session: TerminalSession
  readonly start: MockInstance<() => void>
  readonly stop: MockInstance<() => void>
  readonly requestRender: MockInstance<(force?: boolean) => void>
  readonly renderNow: MockInstance<(force?: boolean) => void>
}

/** One application under test with every injected service. */
interface LifecycleHarness {
  readonly ctx: ReturnType<typeof freshContext>
  readonly app: TerminalApp
  readonly terminal: FixedTerminal
  readonly exit: AppExitDouble
  readonly agents: AgentsDouble
  readonly agent: AgentDouble
  readonly session: Session
  readonly projections: ProjectionsDouble
  readonly query: SessionQueryDouble
  readonly commands: CommandsDouble
  readonly overlays: OverlayCapture
  readonly flush: MockInstance<(session: Session) => Promise<boolean>>
  readonly stderr: MockInstance<(chunk: string | Uint8Array) => boolean>
  readonly transcript: () => TerminalTranscript | undefined
  readonly transcriptText: () => string
  readonly start: () => void
  readonly awaitStarted: () => Promise<void>
  readonly awaitExit: () => Promise<readonly number[]>
}

/** Options for {@link lifecycleHarness}. */
interface LifecycleOptions {
  /** Seed events created with the Session log. */
  readonly seed?: readonly SessionEvent[]
  /** Agent creation route. */
  readonly agentOptions?: { provider?: string; model?: string; reasoningEffort?: ReasoningEffortId }
  /** Whether the Agent registry already resolves the Agent. */
  readonly existingAgent?: boolean
  /** Whether to expose a loader service. */
  readonly loader?: boolean
  /** Session-query observation reader. */
  readonly read?: (sessionId: SessionId) => Promise<ObservationDouble>
  /** Client-visible projection values. */
  readonly values?: Record<string, unknown>
  /** Whether the animation clock is enabled. */
  readonly animation?: boolean
  /** Registered command descriptors. */
  readonly descriptors?: readonly CommandDescriptor[]
  /** Whether to use the main-screen renderer. */
  readonly mainScreen?: boolean
  /** Timed-wait frames published to a question panel. */
  readonly attachWait?: () => AsyncIterable<{ remainingMs: number }>
  /** Extra host services provided before startup. */
  readonly services?: Record<string, unknown>
  /** LLM registry override; defaults to one provider exposing a single model. */
  readonly llm?: Record<string, unknown>
  /** Session working directory recorded in the header. */
  readonly sessionCwd?: string
  /** Registered-command execution override for dispatch tests. */
  readonly execute?: (line: string) => Promise<import('@deepseek-ai/dsh-commands').CommandExecution | undefined>
}

/**
 * Build one terminal application over real Sessions and a headless surface.
 * @param options - Session seed, Agent route, and service overrides.
 * @returns the harness.
 */
async function lifecycleHarness(options: LifecycleOptions = {}): Promise<LifecycleHarness> {
  const exit = appExitDouble()
  const agents = agentsDouble()
  const projections = projectionsDouble(options.values ?? {})
  const query = sessionQueryDouble(options.read ?? (async () => observation([])))
  const commands = commandsDouble({
    ...(options.descriptors === undefined ? {} : { descriptors: options.descriptors }),
    ...(options.execute === undefined ? {} : { execute: options.execute }),
  })
  const llm = options.llm ?? llmDouble({
    providers: [{ id: 'alpha', name: 'Alpha' }],
    listModels: async () => [{ provider: 'alpha', id: 'm-1', name: 'Model One' }],
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: 'Model One' }),
  })
  const services: Record<string, unknown> = {
    agents: agents.service,
    tools: toolsDouble(() => undefined),
    commands: commands.service,
    llm,
    sessionQuery: query.service,
    sessionProjections: projections.service,
    userQuestions: userQuestionsDouble(options.attachWait ?? (() => (async function* empty() {})())),
    appExit: exit.exit,
    ...options.services,
  }
  if (options.loader === true) services.loader = { await: async () => {} }
  const ctx = freshContext(services)
  await mountSessions(ctx)
  const session = ctx.sessions.create(SessionId('session-test'), {
    ...(options.sessionCwd === undefined ? {} : { meta: { cwd: options.sessionCwd } }),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  })
  const agent = agentDouble({
    session,
    ...(options.agentOptions === undefined ? {} : { options: options.agentOptions }),
  })
  if (options.existingAgent !== false) agents.bind(agent.agent)

  const owned = headlessSession(options.mainScreen === true ? { mainScreen: true } : {})
  const start = vi.spyOn(owned.session.tui, 'start')
  const requestRender = vi.spyOn(owned.session.tui, 'requestRender')
  const renderNow = vi.spyOn(owned.session.tui, 'renderNow')
  const stop = vi.spyOn(owned.session, 'stop')
  const overlays = captureOverlays(owned.session.tui)
  const flush = vi.spyOn(ctx.sessions, 'flush')
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const config = terminalConfig(options.animation === true ? { animation: true } : {})
  const app = new TerminalApp(ctx, config, exit.exit, () => owned.session)
  onTestFinished(() => { app.dispose() })
  const transcript = (): TerminalTranscript | undefined =>
    Reflect.get(app, 'transcript') as TerminalTranscript | undefined
  return {
    ctx,
    app,
    terminal: { headless: owned.headless, session: owned.session, start, stop, requestRender, renderNow },
    exit,
    agents,
    agent,
    session,
    projections,
    query,
    commands,
    overlays,
    flush,
    stderr,
    transcript,
    transcriptText: () => transcript()?.component.render(100).join('\n') ?? '',
    start: () => { app.start() },
    awaitStarted: async () => {
      await vi.waitFor(() => { expect(start).toHaveBeenCalled() })
    },
    awaitExit: async () => {
      await vi.waitFor(() => { expect(exit.codes.length).toBeGreaterThan(0) })
      return exit.codes
    },
  }
}

/**
 * Wait for an overlay count and return the latest presented one.
 * @param harness - the application harness.
 * @param count - exact expected overlay count.
 * @returns the presented component.
 */
async function overlayNumber(harness: LifecycleHarness, count: number): Promise<Component> {
  await vi.waitFor(() => { expect(harness.overlays.components).toHaveLength(count) })
  const component = harness.overlays.components[count - 1]
  if (component === undefined) throw new Error(`overlay ${String(count)} was not presented`)
  return component
}

/**
 * Type one editor line and submit it.
 * @param harness - the application harness.
 * @param line - exact text to type.
 */
async function submitLine(harness: LifecycleHarness, line: string): Promise<void> {
  for (const character of line) harness.terminal.headless.press(character)
  harness.terminal.headless.press('\r')
  await Promise.resolve()
}

/**
 * Drive one input sequence into a presented component.
 * @param component - the presented component.
 * @param data - raw input.
 */
function press(component: Component, data: string): void {
  if (component.handleInput === undefined) throw new Error('presented component has no input handler')
  component.handleInput(data)
}

beforeEach(() => {
  vi.mocked(readClipboardImage).mockResolvedValue({ kind: 'none' })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  setCopyLocale('en')
})

describe('TerminalApp startup', () => {
  it('starts over an already-live Agent and renders the editor', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    expect(harness.query.observed).toEqual([harness.session.id])
    expect(harness.terminal.headless.title).toBe('Test Terminal')
    const lines = await waitForScreen(harness.terminal.headless, 'DEEPSEEK HARNESS')
    expect(lines.join('\n')).toContain('dsh>')
    expect(harness.exit.codes).toEqual([])
  })

  it('waits for the configured Agent when none is live yet', async () => {
    const harness = await lifecycleHarness({ existingAgent: false })
    harness.start()
    await Promise.resolve()
    const foreign = agentDouble({ session: harness.ctx.sessions.create(SessionId('foreign')) }).agent
    harness.ctx.emit('agent/created', { agent: foreign, source: 'startup' })
    harness.ctx.emit('agent/created', { agent: harness.agent.agent, source: 'startup' })
    await harness.awaitStarted()

    expect(harness.query.observed).toEqual([harness.session.id])
  })

  it('awaits the loader before resolving the Agent', async () => {
    const harness = await lifecycleHarness({ loader: true })
    harness.start()
    await harness.awaitStarted()

    expect(harness.terminal.start).toHaveBeenCalled()
  })

  it('returns without a screen when disposed before the Agent resolves', async () => {
    const harness = await lifecycleHarness({ existingAgent: false })
    harness.start()
    await Promise.resolve()
    await Promise.resolve()
    harness.app.dispose()
    await Promise.resolve()
    await Promise.resolve()

    expect(harness.terminal.start).not.toHaveBeenCalled()
    expect(harness.query.observed).toEqual([])
  })

  it('returns without a screen when disposed during the loader wait', async () => {
    const harness = await lifecycleHarness({ loader: true })
    harness.start()
    harness.app.dispose()
    await Promise.resolve()
    await Promise.resolve()

    expect(harness.terminal.start).not.toHaveBeenCalled()
  })

  it('returns without a screen when disposed during history replay', async () => {
    let resolveObservation!: (value: ObservationDouble) => void
    const harness = await lifecycleHarness({
      read: () => new Promise<ObservationDouble>((resolve) => { resolveObservation = resolve }),
    })
    harness.start()
    await vi.waitFor(() => { expect(harness.query.observed).toHaveLength(1) })
    harness.app.dispose()
    resolveObservation(observation([]))
    await Promise.resolve()
    await Promise.resolve()

    expect(harness.terminal.start).not.toHaveBeenCalled()
  })
})

describe('TerminalApp initial model selection', () => {
  it('restores the logged request route and effort', async () => {
    const harness = await lifecycleHarness()
    harness.session.append('request/header', {
      header: {
        config: {
          provider: 'header-provider',
          model: 'header-model',
          reasoningEffort: ReasoningEffortId('high'),
        },
      },
      reason: 'initial',
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/status')
    const panel = await overlayNumber(harness, 1)
    const text = panel.render(100).join('\n')
    expect(text).toContain('Provider     header-provider')
    expect(text).toContain('Model        header-model')
    expect(text).toContain('Effort       high')
  })

  it('falls back to the Agent creation route and its effort', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'option-provider', model: 'option-model', reasoningEffort: ReasoningEffortId('medium') },
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/status')
    const panel = await overlayNumber(harness, 1)
    const text = panel.render(100).join('\n')
    expect(text).toContain('Provider     option-provider')
    expect(text).toContain('Model        option-model')
    expect(text).toContain('Effort       medium')
  })

  it('fails before the screen starts when the Agent carries no route', async () => {
    const harness = await lifecycleHarness({ agentOptions: {} })
    harness.start()
    await harness.awaitExit()

    expect(harness.exit.codes).toEqual([1])
    expect(harness.stderr).toHaveBeenCalledWith('dsh: terminal-ui: the presented Agent carries no provider/model route\n')
    expect(harness.terminal.start).not.toHaveBeenCalled()
    expect(harness.terminal.stop).not.toHaveBeenCalled()
  })

  it('fails after the screen starts on an Agent replacement error', async () => {
    let calls = 0
    const harness = await lifecycleHarness({
      read: async () => {
        calls += 1
        if (calls > 1) throw new Error('history unavailable')
        return observation([])
      },
    })
    harness.start()
    await harness.awaitStarted()

    harness.ctx.emit('agent/created', { agent: agentDouble({ session: harness.session }).agent, source: 'clear' })
    await harness.awaitExit()

    expect(harness.exit.codes).toEqual([1])
    expect(harness.stderr).toHaveBeenCalledWith('dsh: history unavailable\n')
    expect(harness.terminal.stop).toHaveBeenCalled()
  })

  it('reports a non-Error failure with its string form', async () => {
    const harness = await lifecycleHarness({
      read: async () => { throw 'plain failure' },
    })
    harness.start()
    await harness.awaitExit()

    expect(harness.exit.codes).toEqual([1])
    expect(harness.stderr).toHaveBeenCalledWith('dsh: plain failure\n')
  })

  it('does not request a second exit when a failure lands during shutdown', async () => {
    let calls = 0
    const harness = await lifecycleHarness({
      read: async () => {
        calls += 1
        if (calls > 1) throw new Error('late failure')
        return observation([])
      },
    })
    harness.start()
    await harness.awaitStarted()

    harness.terminal.headless.press('\x03')
    harness.ctx.emit('agent/created', { agent: agentDouble({ session: harness.session }).agent, source: 'clear' })
    await harness.awaitExit()

    expect(harness.stderr).toHaveBeenCalledWith('dsh: late failure\n')
    expect(harness.exit.codes).toEqual([0])
  })

  it('builds the process terminal when no factory is injected', async () => {
    const exit = appExitDouble()
    const agents = agentsDouble()
    const ctx = freshContext({
      agents: agents.service,
      tools: toolsDouble(() => undefined),
      commands: commandsDouble().service,
    })
    await mountSessions(ctx)
    const session = ctx.sessions.create(SessionId('session-test'))
    agents.bind(agentDouble({ session }).agent)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const app = new TerminalApp(ctx, terminalConfig(), exit.exit)
    onTestFinished(() => { app.dispose() })
    app.start()
    await vi.waitFor(() => { expect(exit.codes).toEqual([1]) })

    expect(stderr).toHaveBeenCalledWith('dsh: terminal-ui requires the sessionQuery service to read Session history\n')
  })

  it('fails before the screen starts without the session-query service', async () => {
    const exit = appExitDouble()
    const agents = agentsDouble()
    const ctx = freshContext({
      agents: agents.service,
      tools: toolsDouble(() => undefined),
      commands: commandsDouble().service,
    })
    await mountSessions(ctx)
    const session = ctx.sessions.create(SessionId('session-test'))
    agents.bind(agentDouble({ session }).agent)
    const owned = headlessSession()
    const start = vi.spyOn(owned.session.tui, 'start')
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const app = new TerminalApp(ctx, terminalConfig(), exit.exit, () => owned.session)
    onTestFinished(() => { app.dispose() })
    app.start()
    await vi.waitFor(() => { expect(exit.codes).toEqual([1]) })

    expect(stderr).toHaveBeenCalledWith('dsh: terminal-ui requires the sessionQuery service to read Session history\n')
    expect(start).not.toHaveBeenCalled()
  })

  it('fails before the screen starts when the history read rejects', async () => {
    const harness = await lifecycleHarness({
      read: async () => { throw new Error('storage offline') },
    })
    harness.start()
    await harness.awaitExit()

    expect(harness.exit.codes).toEqual([1])
    expect(harness.stderr).toHaveBeenCalledWith('dsh: storage offline\n')
    expect(harness.terminal.start).not.toHaveBeenCalled()
  })
})

describe('TerminalApp history replay and live continuity', () => {
  it('replays the committed log and continues from live appends', async () => {
    const seed = [userMessage(0, 'seeded prompt')]
    const harness = await lifecycleHarness({ seed, read: async () => observation(seed) })
    harness.start()
    await harness.awaitStarted()

    expect(harness.transcriptText()).toContain('seeded prompt')

    harness.session.append('user/message', userMessage(1, 'live prompt').data, { surfaceOp: 'append' })
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain('live prompt') })
  })

  it('reports a sequence gap once', async () => {
    const seed = [userMessage(0, 'seeded prompt')]
    const harness = await lifecycleHarness({ seed, read: async () => observation(seed) })
    harness.start()
    await harness.awaitStarted()

    harness.ctx.emit('session/event', harness.session, userMessage(5, 'gapped prompt'))
    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain('Transcript gap: events 1..4 are missing.')
    })
  })

  it('ignores duplicate and foreign sequence events', async () => {
    const seed = [userMessage(0, 'seeded prompt')]
    const harness = await lifecycleHarness({ seed, read: async () => observation(seed) })
    harness.start()
    await harness.awaitStarted()

    harness.ctx.emit('session/event', harness.session, userMessage(0, 'duplicate prompt'))
    harness.ctx.emit('session/event', harness.ctx.sessions.create(SessionId('other')), userMessage(9, 'foreign prompt'))

    expect(harness.transcriptText()).not.toContain('duplicate prompt')
    expect(harness.transcriptText()).not.toContain('foreign prompt')
  })

  it('buffers events that arrive while the history read is pending', async () => {
    let resolveObservation!: (value: ObservationDouble) => void
    const harness = await lifecycleHarness({
      read: () => new Promise<ObservationDouble>((resolve) => { resolveObservation = resolve }),
    })
    harness.start()
    await vi.waitFor(() => { expect(harness.query.observed).toHaveLength(1) })
    harness.ctx.emit('session/event', harness.session, userMessage(0, 'buffered prompt'))
    resolveObservation(observation([]))
    await harness.awaitStarted()

    expect(harness.transcriptText()).toContain('buffered prompt')
  })

  it('retitles the terminal from a logged Session title', async () => {
    const harness = await lifecycleHarness({ values: { title: 'Recorded Title' } })
    harness.start()
    await harness.awaitStarted()

    harness.session.append('session/title', sessionTitle(0, 'Recorded Title').data)
    await vi.waitFor(() => { expect(harness.terminal.headless.title).toBe('Recorded Title — Test Terminal') })
  })

  it('clears and replays history for a replacement Agent', async () => {
    const seed = [userMessage(0, 'seeded prompt')]
    let calls = 0
    const harness = await lifecycleHarness({
      seed,
      read: async () => {
        calls += 1
        return observation(calls === 1 ? seed : [userMessage(0, 'replacement history')])
      },
    })
    harness.start()
    await harness.awaitStarted()
    expect(harness.transcriptText()).toContain('seeded prompt')

    harness.ctx.emit('agent/created', { agent: agentDouble({ session: harness.session }).agent, source: 'compact' })
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain('replacement history') })
    expect(harness.transcriptText()).not.toContain('seeded prompt')
  })

  it('ignores status and stream events from another Agent', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const foreign = agentDouble({ session: harness.ctx.sessions.create(SessionId('foreign')) }).agent

    harness.ctx.emit('agent/status', { agent: foreign, status: 'running' })
    harness.ctx.emit('agent/assistant-stream', {
      agent: foreign,
      frame: { type: 'start', attemptId: LlmAttemptId('foreign'), revision: 1, turn: 1, step: 1 },
    })

    expect(harness.transcriptText()).toBe('')
  })
})

describe('TerminalApp live frames and agent lifecycle', () => {
  it('applies assistant stream frames from the presented Agent', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    harness.ctx.emit('agent/assistant-stream', {
      agent: harness.agent.agent,
      frame: { type: 'start', attemptId: LlmAttemptId('attempt-1'), revision: 1, turn: 1, step: 1 },
    })
    harness.ctx.emit('agent/assistant-stream', {
      agent: harness.agent.agent,
      frame: {
        type: 'chunk',
        attemptId: LlmAttemptId('attempt-1'),
        revision: 1,
        index: 0,
        time: 0,
        chunk: { type: 'text-delta', index: 0, text: 'streamed answer' } satisfies StreamChunk,
      },
    })

    expect(harness.transcriptText()).toContain('streamed answer')
  })

  it('updates the composer frame on status transitions', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const before = harness.terminal.requestRender.mock.calls.length

    harness.agent.setStatus('running')
    harness.ctx.emit('agent/status', { agent: harness.agent.agent, status: 'running' })
    harness.agent.setStatus('idle')
    harness.ctx.emit('agent/status', { agent: harness.agent.agent, status: 'idle' })

    expect(harness.terminal.requestRender.mock.calls.length).toBe(before + 2)

    const afterStatus = harness.terminal.requestRender.mock.calls.length
    harness.projections.emit(harness.session)
    expect(harness.terminal.requestRender.mock.calls.length).toBe(afterStatus + 1)
    harness.projections.emit(harness.ctx.sessions.create(SessionId('unrelated')))
    expect(harness.terminal.requestRender.mock.calls.length).toBe(afterStatus + 1)
  })

  it('exits when the presented Agent is disposed', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const foreign = agentDouble({ session: harness.ctx.sessions.create(SessionId('foreign')) }).agent
    harness.ctx.emit('agent/disposed', { agent: foreign })
    expect(harness.exit.codes).toEqual([])

    harness.ctx.emit('agent/disposed', { agent: harness.agent.agent })
    await harness.awaitExit()

    expect(harness.exit.codes).toEqual([0])
    expect(harness.transcriptText()).toContain('The agent was disposed; closing the terminal.')
    expect(harness.terminal.stop).toHaveBeenCalled()
  })
})

describe('TerminalApp input handling', () => {
  it('follows up with a prompt while idle and steers while running', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, 'hello there')
    harness.agent.setStatus('running')
    await submitLine(harness, 'steer this')

    expect(harness.agent.received).toEqual(['hello there', 'steer this'])
  })

  it('cycles cards, reasoning visibility, and repaints from control keys', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.ctx.emit('session/event', harness.session, userMessage(0, 'prompt'))
    harness.ctx.emit('agent/assistant-stream', {
      agent: harness.agent.agent,
      frame: { type: 'start', attemptId: LlmAttemptId('reasoning'), revision: 1, turn: 1, step: 1 },
    })
    harness.ctx.emit('agent/assistant-stream', {
      agent: harness.agent.agent,
      frame: {
        type: 'chunk',
        attemptId: LlmAttemptId('reasoning'),
        revision: 1,
        index: 0,
        time: 0,
        chunk: { type: 'reasoning-delta', index: 0, text: 'thought one\nthought two\nthought three\nthought four\nthought five\nthought six' },
      },
    })
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript

    expect(transcript.reasoningLevel()).toBe('standard')
    expect(harness.transcriptText()).toContain('thought four')
    expect(harness.transcriptText()).not.toContain('thought five')
    expect(harness.transcriptText()).toContain(copy.notice.hiddenLines(2))

    harness.terminal.headless.press('\x12')
    expect(transcript.reasoningLevel()).toBe('detailed')
    expect(harness.transcriptText()).toContain('thought six')
    expect(footerText(harness.app)).toContain(copy.reasoning.label(copy.reasoning.levels.detailed))
    expect(harness.transcriptText()).toContain(copy.reasoning.changed(copy.reasoning.levels.detailed))

    harness.terminal.headless.press('\x12')
    expect(transcript.reasoningLevel()).toBe('verbose')
    harness.terminal.headless.press('\x12')
    expect(transcript.reasoningLevel()).toBe('compact')
    expect(harness.transcriptText()).not.toContain('thought two')
    expect(harness.transcriptText()).toContain(copy.notice.hiddenLines(5))
    harness.terminal.headless.press('\x12')
    expect(transcript.reasoningLevel()).toBe('standard')

    harness.ctx.emit('session/event', harness.session, toolCall(1, 1, 1, 'call-1', 'echo', '{}'))
    harness.terminal.headless.press('\x0f')
    harness.terminal.headless.press('\x0f')
    expect(harness.transcriptText()).not.toContain('Tool / echo')

    harness.terminal.headless.press('\x0c')
    expect(harness.terminal.renderNow).toHaveBeenCalledWith(true)
  })

  it('cancels a running turn on the first interrupt and exits on the next', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')

    harness.terminal.headless.press('\x03')
    expect(harness.agent.cancels).toEqual(['user'])
    expect(harness.exit.codes).toEqual([])

    harness.agent.setStatus('idle')
    harness.terminal.headless.press('\x03')
    await harness.awaitExit()

    expect(harness.exit.codes).toEqual([0])
    expect(harness.terminal.stop).toHaveBeenCalled()
    expect(harness.flush).toHaveBeenCalled()
  })

  it('closes the active help panel on Ctrl+C without exiting', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/help')
    await overlayNumber(harness, 1)

    harness.terminal.headless.press('\x03')

    expect(harness.overlays.handles[0]?.hidden()).toBe(true)
    expect(harness.exit.codes).toEqual([])
  })

  it('closes a read-only panel from its own input', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/help')
    const panel = await overlayNumber(harness, 1)

    press(panel, 'q')

    expect(harness.overlays.handles[0]?.hidden()).toBe(true)
  })

  it('cancels an open panel from dispose and stops the terminal once', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/help')
    await overlayNumber(harness, 1)

    harness.app.dispose()
    harness.app.dispose()

    expect(harness.overlays.handles[0]?.hidden()).toBe(true)
    expect(harness.terminal.stop).toHaveBeenCalledOnce()
  })

  it('contains a throwing disposer during shutdown', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const disposers = Reflect.get(harness.app, 'disposers') as (() => void)[]
    disposers.push(() => { throw new Error('disposer failed') })

    expect(() => { harness.app.dispose() }).not.toThrow()
    expect(harness.terminal.stop).toHaveBeenCalled()
  })

  it('refreshes autocomplete when the command catalog changes', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    harness.ctx.emit('commands/change')

    expect(harness.exit.codes).toEqual([])
  })
})

describe('TerminalApp registered interactions', () => {
  it('answers a user question through the registered provider', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    const answer = harness.ctx.waterfall('user-questions/request', {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }] }],
    }, () => Promise.resolve({ answers: [] }))
    const panel = await overlayNumber(harness, 1)
    const rendersBefore = harness.terminal.requestRender.mock.calls.length
    press(panel, '\r')

    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['Yes'] }] })
    expect(harness.terminal.requestRender.mock.calls.length).toBe(rendersBefore)
  })

  it('publishes timed-wait countdown frames while a question is open', async () => {
    const harness = await lifecycleHarness({
      attachWait: () => (async function* frames() { yield { remainingMs: 2500 } })(),
    })
    harness.start()
    await harness.awaitStarted()
    const rendersBefore = harness.terminal.requestRender.mock.calls.length

    const answer = harness.ctx.waterfall('user-questions/request', {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }] }],
      wait: { callId: ToolCallId('call-timed'), timed: true },
    }, () => Promise.resolve({ answers: [] }))
    const panel = await overlayNumber(harness, 1)
    await vi.waitFor(() => {
      expect(harness.terminal.requestRender.mock.calls.length).toBeGreaterThan(rendersBefore)
    })
    expect(panel.render(80).join('\n')).toContain('3s left')
    press(panel, '\r')

    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['Yes'] }] })
  })

  it('answers an approval request through the registered provider', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    const outcome = harness.ctx.waterfall('approval/request', {
      agent: harness.agent.agent,
      toolName: 'bash',
      reason: 'needs network',
    }, () => Promise.resolve('unavailable'))
    const panel = await overlayNumber(harness, 1)
    press(panel, 'y')

    await expect(outcome).resolves.toBe('allowed-once')
  })
})

describe('TerminalApp status and model panels', () => {
  it('selects a model from the advisory catalog', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/model')
    const selector = await overlayNumber(harness, 1)
    press(selector, '\r')
    await vi.waitFor(() => { expect(harness.overlays.handles[0]?.hidden()).toBe(true) })

    await submitLine(harness, '/status')
    const status = await overlayNumber(harness, 2)
    const text = status.render(100).join('\n')
    expect(text).toContain('Provider     alpha')
    expect(text).toContain('Model        m-1')
  })

  it('cancels the model selector without changing the route', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/model')
    const selector = await overlayNumber(harness, 1)
    press(selector, '\x1b')

    expect(harness.overlays.handles[0]?.hidden()).toBe(true)
  })
})

describe('TerminalApp exit', () => {
  it('cancels, settles, flushes, restores, and exits from /exit', async () => {
    let waited = false
    const harness = await lifecycleHarness()
    harness.agent.setStatus('running')
    harness.agent.setWhenIdle(() => {
      waited = true
      return Promise.resolve()
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/exit')
    await harness.awaitExit()

    expect(harness.agent.cancels).toEqual(['user'])
    expect(waited).toBe(true)
    expect(harness.flush).toHaveBeenCalledWith(harness.session)
    expect(harness.terminal.stop).toHaveBeenCalled()
    expect(harness.exit.codes).toEqual([0])
  })

  it('exits despite a rejected settle and flush', async () => {
    const harness = await lifecycleHarness()
    harness.agent.setWhenIdle(() => Promise.reject(new Error('settle failed')))
    harness.flush.mockRejectedValue(new Error('flush failed'))
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/quit')
    await harness.awaitExit()

    expect(harness.exit.codes).toEqual([0])
    expect(harness.terminal.stop).toHaveBeenCalled()
  })
})

describe('TerminalApp panel projections and secondary paths', () => {
  it('renders usage, permissions, and context percentages in the status panel', async () => {
    const harness = await lifecycleHarness({
      values: {
        tokenUsage: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 0 },
        contextPressure: { projectedTokens: 500, pressureTokens: 400, contextWindow: 2000 },
        permissions: { currentValue: 'workspace-write' },
        workingDirectory: '/project',
      },
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/status')
    const panel = await overlayNumber(harness, 1)
    const text = panel.render(100).join('\n')
    expect(text).toContain('Cache        75%')
    expect(text).toContain('Context      25%')
    expect(text).toContain('Permissions  workspace-write')
    expect(text).toContain('Working dir  /project')
  })

  it('reads the running clock when the status panel opens', async () => {
    const harness = await lifecycleHarness()
    harness.agent.setStatus('running')
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/status')
    const panel = await overlayNumber(harness, 1)

    expect(panel.render(100).join('\n')).toContain('Status       running')
  })

  it('defaults a header route without a reasoning effort', async () => {
    const harness = await lifecycleHarness()
    harness.session.append('request/header', {
      header: { config: { provider: 'plain-provider', model: 'plain-model' } },
      reason: 'initial',
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/status')
    const panel = await overlayNumber(harness, 1)
    expect(panel.render(100).join('\n')).toContain('Provider     plain-provider')
    expect(panel.render(100).join('\n')).toContain('Effort       default')
  })

  it('keeps the configured title when no Session title is projected', async () => {
    const harness = await lifecycleHarness({ values: { title: null } })
    harness.start()
    await harness.awaitStarted()

    harness.session.append('session/title', sessionTitle(0, 'Untracked').data)

    expect(harness.terminal.headless.title).toBe('Test Terminal')
  })

  it('ignores Agent creation events for other Sessions or the current Agent', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const foreign = agentDouble({ session: harness.ctx.sessions.create(SessionId('foreign')) }).agent
    const observed = harness.query.observed.length

    harness.ctx.emit('agent/created', { agent: foreign, source: 'clear' })
    harness.ctx.emit('agent/created', { agent: harness.agent.agent, source: 'clear' })

    expect(harness.query.observed).toHaveLength(observed)
  })

  it('honours the local clear, reasoning, cards, and redraw controls', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/clear')
    await submitLine(harness, '/reasoning')
    await submitLine(harness, '/cards')
    await submitLine(harness, '/redraw')
    await submitLine(harness, '/missing-command')
    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain('Unknown command: /missing-command.')
    })

    expect(harness.terminal.renderNow).toHaveBeenCalledWith(true)
    expect(harness.exit.codes).toEqual([])
  })

  it('ignores a second exit request while the first is settling', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    harness.terminal.headless.press('\x03')
    harness.ctx.emit('agent/disposed', { agent: harness.agent.agent })
    await harness.awaitExit()

    expect(harness.exit.codes).toEqual([0])
  })

  it('cancels an open model selector through Ctrl+C', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/model')
    await overlayNumber(harness, 1)
    harness.terminal.headless.press('\x03')

    expect(harness.overlays.handles[0]?.hidden()).toBe(true)
    expect(harness.exit.codes).toEqual([])
  })
})

describe('TerminalApp rendering variants', () => {
  it('starts on the main-screen renderer', async () => {
    const harness = await lifecycleHarness({ mainScreen: true })
    harness.start()
    await harness.awaitStarted()

    expect(harness.terminal.start).toHaveBeenCalled()
  })

  it('advances the elapsed clock while a turn runs', async () => {
    vi.useFakeTimers()
    const harness = await lifecycleHarness({ animation: true })
    harness.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.terminal.start).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    harness.agent.setStatus('running')
    await vi.advanceTimersByTimeAsync(1000)

    expect(harness.terminal.requestRender).toHaveBeenCalled()
  })
})

/** The image-installation limits the mention tests expose. */
const MENTION_LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 1024,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 4096,
  maxImagePixels: 1_000_000,
  maxImageDimension: 4096,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

/** Filesystem, attachment, and LLM doubles the mention expansion reads. */
interface MentionServices {
  /** Every resolved path with the cwd the expansion passed. */
  readonly resolved: { path: string; cwd: string | undefined }[]
  /** Every resolved model route. */
  readonly resolvedModels: { provider: string; model: string }[]
  /** Host services provided to the application. */
  readonly services: Record<string, unknown>
  /** LLM registry double provided to the application. */
  readonly llm: Record<string, unknown>
}

/**
 * Build the mention-related host doubles.
 * @param options - declared model modalities.
 * @returns the doubles and their recordings.
 */
function mentionServices(options: { modalities?: readonly ('text' | 'image')[] } = {}): MentionServices {
  const resolved: { path: string; cwd: string | undefined }[] = []
  const resolvedModels: { provider: string; model: string }[] = []
  const fs = {
    resolve: async (path: string, opts?: { cwd?: string }) => {
      resolved.push({ path, cwd: opts?.cwd })
      return { targetKey: 'target', displayPath: path }
    },
    stat: async () => undefined,
    readBytes: async () => new Uint8Array(),
  }
  const attachments = {
    imageLimits: MENTION_LIMITS,
    admitPromptContent: async () => [],
  }
  const llm = {
    listProviders: () => [{ id: 'alpha', name: 'Alpha' }],
    listModels: async () => [],
    resolveModelInfo: async (provider: string, model: string) => {
      resolvedModels.push({ provider, model })
      return {
        provider,
        id: model,
        name: model,
        ...(options.modalities === undefined ? {} : { inputModalities: options.modalities }),
      }
    },
  }
  return { resolved, resolvedModels, services: { fs, attachments }, llm }
}

/**
 * Read one private application member.
 * @param app - the application.
 * @param name - member name.
 * @returns the member value.
 */
function privateMember(app: TerminalApp, name: string): unknown {
  return Reflect.get(app, name)
}

/**
 * Call the private prompt expander.
 * @param app - the application.
 * @param text - submitted prompt.
 * @returns the expansion result.
 */
async function expandPrompt(app: TerminalApp, text: string): Promise<{ content: readonly ContentBlock[]; notices: readonly string[] }> {
  const expand = privateMember(app, 'expandPrompt') as (input: string) => Promise<{ content: readonly ContentBlock[]; notices: readonly string[] }>
  return expand.call(app, text)
}

/** @returns an LLM double exposing one model with two efforts. */
function effortsLlm(options: {
  defaultEffort?: ReasoningEffortId
  efforts?: readonly { id: ReasoningEffortId; name: string }[]
} = {}): Record<string, unknown> {
  return llmDouble({
    providers: [{ id: 'alpha', name: 'Alpha' }],
    listModels: async () => [{ provider: 'alpha', id: 'm-1', name: 'Model One' }],
    resolveModelInfo: async (provider, model) => ({
      provider,
      id: model,
      name: 'Model One',
      reasoning: {
        efforts: options.efforts ?? [
          { id: ReasoningEffortId('low'), name: 'Low' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
        ...(options.defaultEffort === undefined ? {} : { defaultEffort: options.defaultEffort }),
      },
    }),
  })
}

/**
 * Drive Shift+Tab with the catalog unloaded, which is the state before the
 * startup prefetch settles; this exercises the on-demand catalog load.
 * @param harness - the application harness.
 */
function pressShiftTab(harness: LifecycleHarness): void {
  Reflect.set(harness.app, 'catalog', undefined)
  harness.terminal.headless.press('\x1b[Z')
}

describe('TerminalApp reasoning effort cycling', () => {
  it('cycles the advertised efforts from Shift+Tab and reports each level', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm(),
    })
    harness.start()
    await harness.awaitStarted()

    pressShiftTab(harness)
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('low')) })

    pressShiftTab(harness)
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('high')) })

    pressShiftTab(harness)
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('default')) })
  })

  it('cycles within the adapter default efforts', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm({ defaultEffort: ReasoningEffortId('low') }),
    })
    harness.start()
    await harness.awaitStarted()

    harness.terminal.headless.press('\x1b[Z')
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('high')) })
    harness.terminal.headless.press('\x1b[Z')
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('low')) })
  })

  it('reports a model that advertises no effort', async () => {
    const harness = await lifecycleHarness({ agentOptions: { provider: 'alpha', model: 'm-1' } })
    harness.start()
    await harness.awaitStarted()

    harness.terminal.headless.press('\x1b[Z')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.noEffort) })
  })

  it('reports a model missing from the catalog', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    harness.terminal.headless.press('\x1b[Z')
    harness.terminal.headless.press('\x1b[Z')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.noEffort) })
  })

  it.each([
    ['an Error', new Error('catalog offline'), 'catalog offline'],
    ['a non-Error', 'catalog offline', 'catalog offline'],
  ])('reports a catalog failure thrown as %s', async (_label, failure, message) => {
    const harness = await lifecycleHarness({
      llm: {
        listProviders: () => { throw failure },
        listModels: async () => [],
        resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model }),
      },
    })
    harness.start()
    await harness.awaitStarted()

    pressShiftTab(harness)

    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.model.effortFailed(message))
    })
  })

  it('loads the catalog on demand when the prefetch left it unset', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm(),
    })
    harness.start()
    await harness.awaitStarted()

    pressShiftTab(harness)

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('low')) })
  })

  it('ignores effort cycling without a selection or a current route', async () => {
    const harness = await lifecycleHarness()
    const cycle = privateMember(harness.app, 'cycleEffort') as () => Promise<void>

    await cycle.call(harness.app)
    Reflect.set(harness.app, 'selection', { current: undefined, assembled: undefined })
    await cycle.call(harness.app)

    expect(harness.transcriptText()).toBe('')
    expect(harness.exit.codes).toEqual([])
  })

  it('loads the catalog once across several cycles', async () => {
    let enumerations = 0
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: llmDouble({
        providers: [{ id: 'alpha', name: 'Alpha' }],
        listModels: async () => {
          enumerations += 1
          return [{ provider: 'alpha', id: 'm-1', name: 'Model One' }]
        },
        resolveModelInfo: async (provider, model) => ({
          provider,
          id: model,
          name: 'Model One',
          reasoning: { efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }] },
        }),
      }),
    })
    harness.start()
    await harness.awaitStarted()

    harness.terminal.headless.press('\x1b[Z')
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('low')) })
    harness.terminal.headless.press('\x1b[Z')
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('low')) })

    expect(enumerations).toBe(1)
  })
})

describe('TerminalApp autocomplete wiring', () => {
  it('builds the terminal provider over the live agent, cwd, and commands', async () => {
    const harness = await lifecycleHarness({ values: { workingDirectory: '/project' } })
    harness.start()
    await harness.awaitStarted()
    const provider = privateValue(harness.app, 'autocomplete') as TerminalAutocompleteProvider
    const deps = Reflect.get(provider, 'deps') as TerminalAutocompleteDeps

    expect(provider).toBeInstanceOf(TerminalAutocompleteProvider)
    expect(deps.agent()).toBe(harness.agent.agent)
    expect(deps.cwd()).toBe('/project')
    expect(deps.commands().map(command => command.name)).toContain('help')

    Reflect.set(harness.app, 'status', undefined)
    expect(deps.cwd()).toBe(process.cwd())
    Reflect.set(harness.app, 'composer', undefined)
    expect(deps.commands()).toEqual([])
  })

  it('completes a mention token without a file-reference service', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const provider = privateValue(harness.app, 'autocomplete') as TerminalAutocompleteProvider

    const suggestions = await provider.getSuggestions(['@src'], 0, 4, { signal: new AbortController().signal })

    expect(suggestions).toBeNull()
  })
})

describe('TerminalApp prompt mention expansion', () => {
  it('expands image mentions with the projected working directory', async () => {
    const mentions = mentionServices()
    const harness = await lifecycleHarness({
      values: { workingDirectory: '/project' },
      services: mentions.services,
      llm: mentions.llm,
    })
    harness.start()
    await harness.awaitStarted()

    const expanded = await expandPrompt(harness.app, '@a.png')

    expect(expanded.notices).toEqual([copy.mention.notFound('a.png')])
    expect(mentions.resolved).toEqual([{ path: 'a.png', cwd: '/project' }])
    expect(mentions.resolvedModels).toEqual([{ provider: 'test', model: 'test' }])
  })

  it('falls back to the Session cwd and then the process cwd for the expansion', async () => {
    const mentions = mentionServices()
    const harness = await lifecycleHarness({
      sessionCwd: '/workspace/session',
      values: { workingDirectory: '/project' },
      services: mentions.services,
      llm: mentions.llm,
    })

    await expandPrompt(harness.app, '@before.png')

    harness.start()
    await harness.awaitStarted()
    Reflect.set(harness.app, 'status', undefined)
    await expandPrompt(harness.app, '@session.png')
    Reflect.set(harness.app, 'agent', undefined)
    await expandPrompt(harness.app, '@process.png')

    expect(mentions.resolved.map(entry => entry.cwd)).toEqual([
      process.cwd(),
      '/workspace/session',
      process.cwd(),
    ])
  })

  it('reports an image mention the selected model cannot accept', async () => {
    const mentions = mentionServices({ modalities: ['text'] })
    const harness = await lifecycleHarness({ services: mentions.services, llm: mentions.llm })
    harness.start()
    await harness.awaitStarted()

    const expanded = await expandPrompt(harness.app, '@a.png')

    expect(expanded.notices).toEqual([copy.mention.unsupportedModel('test')])
    expect(mentions.resolved).toEqual([])
  })

  it('announces mention diagnostics when a prompt is submitted', async () => {
    const mentions = mentionServices()
    const harness = await lifecycleHarness({
      values: { workingDirectory: '/project' },
      services: mentions.services,
      llm: mentions.llm,
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '@missing.png')

    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.mention.notFound('missing.png'))
    })
    expect(mentions.resolved).toEqual([{ path: 'missing.png', cwd: '/project' }])
  })
})

describe('TerminalApp catalog failures', () => {
  it('keeps a failed provider visible in the model selector', async () => {
    const harness = await lifecycleHarness({
      llm: llmDouble({
        providers: [{ id: 'alpha', name: 'Alpha' }],
        listModels: async () => { throw new Error('provider offline') },
        resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      }),
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/model')
    const selector = await overlayNumber(harness, 1)

    expect(selector.render(100).join('\n')).toContain('Alpha: provider offline')
  })
})

/**
 * Render the presented footer with the unstyled palette.
 * @param app - the running application.
 * @returns the footer text lines.
 */
function footerText(app: TerminalApp): string {
  const footer = privateMember(app, 'footer') as Footer | undefined
  return footer?.render(200).join('\n') ?? ''
}

/**
 * Read the composer the application built.
 * @param app - the running application.
 * @returns the composer.
 */
function composerOf(app: TerminalApp): Composer {
  return privateMember(app, 'composer') as Composer
}

/** @returns the application's bottom dock. */
function bottomOf(app: TerminalApp): BottomPanel {
  return privateMember(app, 'bottom') as BottomPanel
}

/** @returns the application's bottom-dock chooser. */
function bottomListOf(app: TerminalApp): BottomList {
  return privateMember(app, 'bottomList') as BottomList
}

/** @returns the application's completion controller. */
function completionOf(app: TerminalApp): CompletionController {
  return privateMember(app, 'completion') as CompletionController
}

/** @returns the application's dock configuration panel. */
function configPanelOf(app: TerminalApp): ConfigPanel | undefined {
  return privateMember(app, 'configPanel') as ConfigPanel | undefined
}

/** @returns the application's composer editor. */
function editorOf(app: TerminalApp): PromptEditor {
  return privateMember(app, 'editor') as PromptEditor
}

/** @returns the dock content rendered as plain text. */
function dockText(app: TerminalApp): string {
  return bottomOf(app).render(200).join('\n')
}

/**
 * Wait until the rendered screen shows one dock needle.
 * @param harness - the application harness.
 * @param needle - required visible text.
 * @returns the screen lines.
 */
async function waitForDock(harness: LifecycleHarness, needle: string): Promise<readonly string[]> {
  return waitForScreen(harness.terminal.headless, needle)
}

/**
 * Focus and activate one configuration row, waiting for the panel to settle.
 * @param harness - the application harness.
 * @param panel - the presented configuration panel.
 * @param section - tab section the row lives in.
 * @param id - row identity.
 */
async function pressConfigRow(
  harness: LifecycleHarness,
  panel: ConfigPanel,
  section: ConfigRow['section'],
  id: string,
): Promise<void> {
  focusConfigRow(panel, section, id)
  await vi.waitFor(() => { expect(Reflect.get(panel, 'busy')).toBe(false) })
  harness.terminal.headless.press('\r')
}

/**
 * Point the configuration panel at one row without walking the tab bar.
 * @param panel - the presented configuration panel.
 * @param section - tab section the row lives in.
 * @param id - row identity.
 */
function focusConfigRow(panel: ConfigPanel, section: ConfigRow['section'], id: string): void {
  const rows = Reflect.get(panel, 'rows') as readonly ConfigRow[]
  const index = rows.filter(row => row.section === section).findIndex(row => row.id === id)
  if (index < 0) throw new Error(`configuration row ${id} is missing`)
  Reflect.set(panel, 'section', section)
  Reflect.set(panel, 'cursor', index)
  Reflect.set(panel, 'scroll', 0)
}

describe('TerminalApp effort command', () => {
  it('prefetches the catalog and shows the advertised default effort in the footer', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm({ defaultEffort: ReasoningEffortId('low') }),
    })
    harness.start()
    await harness.awaitStarted()

    await vi.waitFor(() => { expect(footerText(harness.app)).toContain('m-1 · low') })
    expect(harness.transcriptText()).toBe('')
  })

  it('applies an explicit effort from the command argument', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm({ defaultEffort: ReasoningEffortId('low') }),
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/effort high')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('high')) })
    expect(footerText(harness.app)).toContain('m-1 · high')

    await submitLine(harness, '/status')
    const panel = await overlayNumber(harness, 1)
    expect(panel.render(100).join('\n')).toContain('Effort       high')
  })

  it('matches an effort label case-insensitively', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm(),
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/effort HIGH')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('high')) })
  })

  it('clears the explicit effort with the default sentinel', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm(),
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/effort high')
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('high')) })
    await submitLine(harness, '/effort default')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('default')) })
    expect(footerText(harness.app)).not.toContain('m-1 · high')
  })

  it('opens the effort chooser in the bottom dock and applies the highlighted level', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm({ defaultEffort: ReasoningEffortId('low') }),
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/effort')
    await waitForDock(harness, copy.model.effortTitle)

    expect(harness.overlays.components).toEqual([])
    expect(bottomOf(harness.app).active).toBe(true)
    const dock = dockText(harness.app)
    expect(dock).toContain(copy.model.effortTitle)
    expect(dock).toContain('Low')
    expect(dock).toContain('High')
    expect(dock).toContain(copy.prompt.selectHint)

    harness.terminal.headless.press('\u001b[B')
    harness.terminal.headless.press('\r')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('high')) })
    await vi.waitFor(() => { expect(bottomOf(harness.app).active).toBe(false) })
    expect(footerText(harness.app)).toContain('m-1 · high')
  })

  it('cancels the effort chooser on Escape', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm({ defaultEffort: ReasoningEffortId('low') }),
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/effort')
    await waitForDock(harness, copy.model.effortTitle)

    harness.terminal.headless.press('\u001b')

    await vi.waitFor(() => { expect(bottomOf(harness.app).active).toBe(false) })
    expect(harness.transcriptText()).not.toContain('Reasoning effort:')
    expect(harness.overlays.components).toEqual([])
  })

  it('closes the effort chooser before cancelling a turn on Ctrl+C', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm({ defaultEffort: ReasoningEffortId('low') }),
    })
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')

    await submitLine(harness, '/effort')
    await waitForDock(harness, copy.model.effortTitle)

    harness.terminal.headless.press('\x03')

    expect(bottomOf(harness.app).active).toBe(false)
    expect(harness.agent.cancels).toEqual([])
    expect(harness.exit.codes).toEqual([])
  })

  it('lists the available levels for an unknown argument', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm(),
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/effort turbo')

    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.model.effortAvailable('default, low, high'))
    })
  })

  it.each(['/effort', '/effort high'])('reports a model without efforts for %s', async (line) => {
    const harness = await lifecycleHarness({ agentOptions: { provider: 'alpha', model: 'm-1' } })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, line)

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.noEffort) })
  })

  it('completes effort values through the command catalog', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm(),
    })
    harness.start()
    await harness.awaitStarted()
    const effort = composerOf(harness.app).slashCommands().find(command => command.name === 'effort')

    expect(await effort?.getArgumentCompletions?.('hi')).toEqual([{ value: 'high', label: 'High' }])
    expect(await effort?.getArgumentCompletions?.('')).toEqual([
      { value: 'default', label: 'default', description: copy.model.effortCurrent },
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
    ])
  })

  it('keeps a single local permission command in the catalog', async () => {
    const harness = await lifecycleHarness({
      descriptors: [{ name: 'permission', description: 'Set the permission preset', input: { hint: '<preset>' } }],
      services: {
        permissionPresets: {
          catalog: () => ({
            options: [
              { value: 'read-only', name: 'Read only', description: 'no writes' },
              { value: 'workspace-write', name: 'Workspace write' },
            ],
            defaultOptions: [],
            defaultPreset: 'workspace-write',
          }),
        },
      },
    })
    harness.start()
    await harness.awaitStarted()

    const listed = composerOf(harness.app).slashCommands().filter(command => command.name === 'permission')

    expect(listed).toHaveLength(1)
    const permission = listed[0]
    expect(permission).toMatchObject({
      name: 'permission',
      description: 'Show or switch the permission preset',
      argumentHint: '<preset>',
    })
    expect(permission !== undefined && 'getArgumentCompletions' in permission).toBe(true)
    expect(composerOf(harness.app).helpLines().filter(line => line.includes('/permission'))).toEqual([
      '  /permission         Show or switch the permission preset',
    ])

    harness.ctx.emit('permission-presets/catalog-changed')
    expect(harness.exit.codes).toEqual([])
  })

  it('ignores an effort application without a selection', async () => {
    const harness = await lifecycleHarness()
    const apply = privateMember(harness.app, 'applyEffort') as (value: string) => void

    apply.call(harness.app, 'high')
    Reflect.set(harness.app, 'selection', { current: undefined, assembled: undefined })
    apply.call(harness.app, 'high')

    expect(harness.transcriptText()).toBe('')
  })

  it('loads the catalog once and survives enumeration failure', async () => {
    let enumerations = 0
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: llmDouble({
        providers: [{ id: 'alpha', name: 'Alpha' }],
        listModels: async () => {
          enumerations += 1
          return [{ provider: 'alpha', id: 'm-1', name: 'Model One' }]
        },
        resolveModelInfo: async (provider, model) => ({ provider, id: model, name: 'Model One' }),
      }),
    })
    harness.start()
    await harness.awaitStarted()
    await vi.waitFor(() => { expect(enumerations).toBe(1) })
    const ensure = privateMember(harness.app, 'ensureCatalog') as () => Promise<unknown>
    await ensure.call(harness.app)
    expect(enumerations).toBe(1)

    const failing = await lifecycleHarness({
      llm: {
        listProviders: () => { throw new Error('providers offline') },
        listModels: async () => [],
        resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model }),
      },
    })
    failing.start()
    await failing.awaitStarted()
    await submitLine(failing, '/effort')
    await vi.waitFor(() => { expect(failing.transcriptText()).toContain(copy.model.noEffort) })
  })
})

describe('TerminalApp effort seeding and status', () => {
  it('seeds the Shift+Tab cycle at the advertised default effort', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm({
        defaultEffort: ReasoningEffortId('medium'),
        efforts: [
          { id: ReasoningEffortId('low'), name: 'Low' },
          { id: ReasoningEffortId('medium'), name: 'Medium' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
      }),
    })
    harness.start()
    await harness.awaitStarted()
    await vi.waitFor(() => { expect(footerText(harness.app)).toContain('m-1 · medium') })

    pressShiftTab(harness)

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('high')) })
    expect(harness.transcriptText()).not.toContain(copy.model.effort('low'))
  })

  it('marks the advertised default effort in the status panel', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm({ defaultEffort: ReasoningEffortId('low') }),
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/status')
    const panel = await overlayNumber(harness, 1)

    expect(panel.render(100).join('\n')).toContain('Effort       low (default)')
  })

  it('reports the bare default effort for a model without efforts', async () => {
    const harness = await lifecycleHarness({ agentOptions: { provider: 'alpha', model: 'm-1' } })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/status')
    const panel = await overlayNumber(harness, 1)

    expect(panel.render(100).join('\n')).toContain('Effort       default')
  })

  it('adopts the freshly loaded catalog when the selector opens', async () => {
    let loads = 0
    let defaultEffort = 'low'
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: llmDouble({
        providers: [{ id: 'alpha', name: 'Alpha' }],
        listModels: async () => {
          loads += 1
          if (loads > 1) defaultEffort = 'high'
          return [{ provider: 'alpha', id: 'm-1', name: 'Model One' }]
        },
        resolveModelInfo: async (provider, model) => ({
          provider,
          id: model,
          name: 'Model One',
          reasoning: {
            efforts: [
              { id: ReasoningEffortId('low'), name: 'Low' },
              { id: ReasoningEffortId('high'), name: 'High' },
            ],
            defaultEffort: ReasoningEffortId(defaultEffort),
          },
        }),
      }),
    })
    harness.start()
    await harness.awaitStarted()
    await vi.waitFor(() => { expect(footerText(harness.app)).toContain('m-1 · low') })

    await submitLine(harness, '/model')
    const selector = await overlayNumber(harness, 1)
    press(selector, '\r')

    await vi.waitFor(() => { expect(footerText(harness.app)).toContain('m-1 · high') })
  })
})

describe('TerminalApp permission command', () => {
  /** The permission catalog the chooser and completion read. */
  const PRESETS = {
    catalog: () => ({
      options: [
        { value: 'read-only', name: 'Read Only' },
        { value: 'workspace-write', name: 'Workspace Write', description: 'writes inside the workspace' },
        { value: 'full', name: 'Full Access', description: 'writes anywhere' },
      ],
      defaultOptions: [],
      defaultPreset: 'workspace-write',
    }),
  }

  /** @returns options that mount the permission catalog and command. */
  function permissionOptions(execute?: (line: string) => Promise<CommandExecution | undefined>) {
    return {
      descriptors: [{ name: 'permission', description: 'Set the permission preset', input: { hint: '<preset>' } }],
      services: { permissionPresets: PRESETS },
      ...(execute === undefined ? {} : { execute }),
    }
  }

  it('dispatches an explicit permission argument', async () => {
    const harness = await lifecycleHarness(permissionOptions())
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/permission read-only')

    await vi.waitFor(() => { expect(harness.commands.executed).toEqual(['/permission read-only']) })
    expect(harness.overlays.components).toEqual([])
  })

  it('dispatches the bare command without a permission catalog', async () => {
    const harness = await lifecycleHarness({
      descriptors: [{ name: 'permission', description: 'Set the permission preset', input: { hint: '<preset>' } }],
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/permission')

    await vi.waitFor(() => { expect(harness.commands.executed).toEqual(['/permission']) })
    expect(harness.overlays.components).toEqual([])
  })

  it('presents the permission chooser in the bottom dock and dispatches the selected preset once', async () => {
    const harness = await lifecycleHarness({
      ...permissionOptions(),
      values: { permissions: { currentValue: 'workspace-write' } },
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/permission')
    await waitForDock(harness, copy.prompt.permissionTitle)

    expect(harness.overlays.components).toEqual([])
    expect(bottomOf(harness.app).active).toBe(true)
    const dock = dockText(harness.app)
    expect(dock).toContain(copy.prompt.permissionTitle)
    expect(dock).toContain(copy.prompt.permissionCurrent)
    expect(dock).toContain('Read Only')
    expect(dock).toContain('Full Access')

    harness.terminal.headless.press('\r')

    await vi.waitFor(() => { expect(harness.commands.executed).toEqual(['/permission read-only']) })
    await vi.waitFor(() => { expect(bottomOf(harness.app).active).toBe(false) })
  })

  it('cancels the permission chooser without dispatching', async () => {
    const harness = await lifecycleHarness(permissionOptions())
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/permission')
    await waitForDock(harness, copy.prompt.permissionTitle)

    harness.terminal.headless.press('\u001b')

    await vi.waitFor(() => { expect(bottomOf(harness.app).active).toBe(false) })
    expect(harness.commands.executed).toEqual([])
  })

  it('closes the permission chooser before cancelling a turn on Ctrl+C', async () => {
    const harness = await lifecycleHarness(permissionOptions())
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')

    await submitLine(harness, '/permission')
    await waitForDock(harness, copy.prompt.permissionTitle)

    harness.terminal.headless.press('\x03')

    expect(bottomOf(harness.app).active).toBe(false)
    expect(harness.agent.cancels).toEqual([])
    expect(harness.exit.codes).toEqual([])
  })

  it('stays silent when the dispatched permission command succeeds', async () => {
    const harness = await lifecycleHarness(permissionOptions(async () => ({
      commandId: CommandId('command-1'),
      result: { kind: 'success' },
    })))
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/permission read-only')
    await vi.waitFor(() => { expect(harness.commands.executed).toEqual(['/permission read-only']) })

    expect(harness.transcriptText()).not.toContain('Command failed')
    expect(harness.transcriptText()).not.toContain('Unknown command')
  })

  it('reports an unknown dispatched permission command', async () => {
    const harness = await lifecycleHarness(permissionOptions(async () => undefined))
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/permission read-only')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain('Unknown command: /permission') })
  })

  it.each([
    ['an Error', new Error('registry offline'), 'registry offline'],
    ['a non-Error', 'registry offline', 'registry offline'],
  ])('reports a permission dispatch rejection from %s', async (_label, failure, message) => {
    const harness = await lifecycleHarness(permissionOptions(async () => { throw failure }))
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/permission read-only')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(`Command failed: ${message}`) })
  })

  it('ignores a dispatch before the agent is bound', async () => {
    const harness = await lifecycleHarness(permissionOptions())

    const dispatch = privateMember(harness.app, 'dispatchCommand') as (text: string) => void
    dispatch.call(harness.app, '/permission')

    expect(harness.commands.executed).toEqual([])
  })

  it('maps the catalog presets for the composer completion choices', async () => {
    const harness = await lifecycleHarness(permissionOptions())
    harness.start()
    await harness.awaitStarted()
    const deps = Reflect.get(composerOf(harness.app), 'deps') as ComposerDeps

    expect(deps.choices?.permissions?.()).toEqual([
      {
        value: 'read-only',
        label: 'Read Only',
        description: copy.prompt.permissionDescriptions['read-only'],
      },
      { value: 'workspace-write', label: 'Workspace Write', description: 'writes inside the workspace' },
      { value: 'full', label: 'Full Access', description: 'writes anywhere' },
    ])
  })

  it('lists a catalog preset without a description', async () => {
    const harness = await lifecycleHarness({
      services: {
        permissionPresets: {
          catalog: () => ({
            options: [{ value: 'weird', name: 'Weird' }],
            defaultOptions: [],
            defaultPreset: 'weird',
          }),
        },
      },
    })
    harness.start()
    await harness.awaitStarted()
    const deps = Reflect.get(composerOf(harness.app), 'deps') as ComposerDeps

    expect(deps.choices?.permissions?.()).toEqual([{ value: 'weird', label: 'Weird' }])

    await submitLine(harness, '/permission')
    await waitForDock(harness, 'Weird')
  })

  it('offers no permission choices without the service', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const deps = Reflect.get(composerOf(harness.app), 'deps') as ComposerDeps

    expect(deps.choices?.permissions?.()).toEqual([])
  })
})

/** Attachment doubles and recordings for the clipboard attach path. */
interface ClipboardServices {
  /** Host services provided to the application. */
  readonly services: Record<string, unknown>
  /** LLM registry double provided to the application. */
  readonly llm: Record<string, unknown>
  /** Admitted prompt parts, in call order. */
  readonly admitted: AttachmentAdmissionPart[][]
}

/**
 * Build the attachment and LLM doubles the clipboard path reads.
 * @param options - admission failure and declared model modalities.
 * @returns the doubles and their recordings.
 */
function clipboardServices(options: {
  readonly admitError?: unknown
  readonly modalities?: readonly ('text' | 'image')[]
} = {}): ClipboardServices {
  const admitted: AttachmentAdmissionPart[][] = []
  const attachments = {
    imageLimits: MENTION_LIMITS,
    admitPromptContent: async (content: readonly AttachmentAdmissionPart[]): Promise<readonly AdmittedPromptContentPart[]> => {
      admitted.push([...content])
      if (options.admitError !== undefined) throw options.admitError
      return content.flatMap((part, index): AdmittedPromptContentPart[] => part.type === 'image'
        ? [{
          type: 'image',
          attachment: {
            attachmentId: AttachmentId(`clipboard-${String(index)}`),
            mediaType: part.mediaType,
            bytes: part.data.length,
            width: 1,
            height: 1,
            ...(part.name === undefined ? {} : { name: part.name }),
          },
        }]
        : [])
    },
  }
  const llm = llmDouble({
    providers: [{ id: 'alpha', name: 'Alpha' }],
    listModels: async () => [],
    resolveModelInfo: async (provider, model) => ({
      provider,
      id: model,
      name: model,
      ...(options.modalities === undefined ? {} : { inputModalities: options.modalities }),
    }),
  })
  return { services: { attachments }, llm, admitted }
}

/** One clipboard image read the tests hand to the mocked reader. */
function clipboardImage(): { kind: 'image'; bytes: Uint8Array; mediaType: 'image/png'; name: string } {
  return {
    kind: 'image',
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mediaType: 'image/png',
    name: 'clipboard.png',
  }
}

/**
 * Read one private application member typed for the caller.
 * @param app - the application.
 * @param name - member name.
 * @returns the member value.
 */
function privateValue(app: TerminalApp, name: string): unknown {
  return Reflect.get(app, name)
}

describe('TerminalApp clipboard attach', () => {
  it('attaches a clipboard image to the next prompt and clears it', async () => {
    const clipboard = clipboardServices()
    const harness = await lifecycleHarness({ services: clipboard.services, llm: clipboard.llm })
    harness.start()
    await harness.awaitStarted()
    vi.mocked(readClipboardImage).mockResolvedValue(clipboardImage())
    const sent: ContentBlock[][] = []
    vi.spyOn(harness.agent.agent, 'followup').mockImplementation((message) => { sent.push([...message.content]) })

    harness.terminal.headless.press('\x16')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.clipboard.attached('clipboard.png')) })
    expect(clipboard.admitted).toHaveLength(1)
    expect(privateValue(harness.app, 'pendingImages') as ContentBlock[]).toHaveLength(1)

    await submitLine(harness, 'first prompt')
    await vi.waitFor(() => { expect(sent).toHaveLength(1) })
    expect(sent[0]?.map(block => block.type)).toEqual(['text', 'image'])
    expect(privateValue(harness.app, 'pendingImages') as ContentBlock[]).toEqual([])

    await submitLine(harness, 'second prompt')
    await vi.waitFor(() => { expect(sent).toHaveLength(2) })
    expect(sent[1]?.map(block => block.type)).toEqual(['text'])
  })

  it.each([
    ['none', { kind: 'none' as const }],
    ['unavailable', { kind: 'unavailable' as const }],
  ])('reports a clipboard read of %s as unsupported', async (_label, read) => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    vi.mocked(readClipboardImage).mockResolvedValue(read)

    harness.terminal.headless.press('\x16')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.clipboard.unsupported) })
  })

  it('reports a clipboard read failure', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    vi.mocked(readClipboardImage).mockResolvedValue({ kind: 'failed', message: 'clipboard helper crashed' })

    harness.terminal.headless.press('\x16')

    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.clipboard.failed('clipboard helper crashed'))
    })
  })

  it('reports a model without image input support', async () => {
    const clipboard = clipboardServices({ modalities: ['text'] })
    const harness = await lifecycleHarness({ services: clipboard.services, llm: clipboard.llm })
    harness.start()
    await harness.awaitStarted()
    vi.mocked(readClipboardImage).mockResolvedValue(clipboardImage())

    harness.terminal.headless.press('\x16')

    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.mention.unsupportedModel('test'))
    })
    expect(clipboard.admitted).toEqual([])
  })

  it('reports a composition without an attachment store', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    vi.mocked(readClipboardImage).mockResolvedValue(clipboardImage())

    harness.terminal.headless.press('\x16')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.mention.noAttachments) })
  })

  it.each([
    ['an Error', new Error('admission failed'), 'admission failed'],
    ['a non-Error', 'admission failed', 'admission failed'],
  ])('reports an admission rejection thrown as %s', async (_label, admitError, message) => {
    const clipboard = clipboardServices({ admitError })
    const harness = await lifecycleHarness({ services: clipboard.services, llm: clipboard.llm })
    harness.start()
    await harness.awaitStarted()
    vi.mocked(readClipboardImage).mockResolvedValue(clipboardImage())

    harness.terminal.headless.press('\x16')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.clipboard.failed(message)) })
    expect(privateValue(harness.app, 'pendingImages') as ContentBlock[]).toEqual([])
  })

  it('attaches before a selection exists', async () => {
    const clipboard = clipboardServices()
    const harness = await lifecycleHarness({ services: clipboard.services, llm: clipboard.llm })
    vi.mocked(readClipboardImage).mockResolvedValue(clipboardImage())
    const attach = privateValue(harness.app, 'attachClipboardImage') as () => Promise<void>

    await attach.call(harness.app)

    expect(clipboard.admitted).toHaveLength(1)
    expect(privateValue(harness.app, 'pendingImages') as ContentBlock[]).toHaveLength(1)
  })
})

describe('TerminalApp Esc interrupt', () => {
  it('cancels the running turn when the composer is empty', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')

    harness.terminal.headless.press('\u001b')

    expect(harness.agent.cancels).toEqual(['user'])
    expect(harness.transcriptText()).toContain(copy.notice.interrupting)
    expect(harness.exit.codes).toEqual([])
  })

  it('leaves a composer with text and an idle agent alone', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const editor = privateValue(harness.app, 'editor') as PromptEditor

    editor.setText('a draft')
    harness.agent.setStatus('running')
    harness.terminal.headless.press('\u001b')
    expect(harness.agent.cancels).toEqual([])

    editor.setText('')
    harness.agent.setStatus('idle')
    harness.terminal.headless.press('\u001b')
    expect(harness.agent.cancels).toEqual([])
    expect(harness.exit.codes).toEqual([])
  })

  it('leaves the running turn alone while a modal owns input', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/help')
    await overlayNumber(harness, 1)
    harness.agent.setStatus('running')

    harness.terminal.headless.press('\u001b')

    expect(harness.agent.cancels).toEqual([])
    expect(harness.exit.codes).toEqual([])
  })

  it('ignores the interrupt path without a running agent', async () => {
    const harness = await lifecycleHarness()
    const interrupt = privateValue(harness.app, 'interruptTurn') as () => void

    interrupt.call(harness.app)

    harness.start()
    await harness.awaitStarted()
    interrupt.call(harness.app)

    expect(harness.agent.cancels).toEqual([])
  })

  it('ignores Esc after the agent was unbound', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    Reflect.set(harness.app, 'agent', undefined)

    harness.terminal.headless.press('\u001b')

    expect(harness.agent.cancels).toEqual([])
  })
})

describe('TerminalApp /queue', () => {
  it('queues the expanded prompt for the next turn', async () => {
    const mentions = mentionServices()
    const harness = await lifecycleHarness({ services: mentions.services, llm: mentions.llm })
    harness.start()
    await harness.awaitStarted()
    const followups: ContentBlock[][] = []
    vi.spyOn(harness.agent.agent, 'followup').mockImplementation((message) => { followups.push([...message.content]) })

    await submitLine(harness, '/queue keep this @missing.png')

    await vi.waitFor(() => { expect(followups).toHaveLength(1) })
    expect(followups[0]?.[0]).toEqual({ type: 'text', text: 'keep this @missing.png' })
    expect(harness.transcriptText()).toContain(copy.mention.notFound('missing.png'))
  })

  it('queues even while the agent is running', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')
    const followups: ContentBlock[][] = []
    const steers: ContentBlock[][] = []
    vi.spyOn(harness.agent.agent, 'followup').mockImplementation((message) => { followups.push([...message.content]) })
    vi.spyOn(harness.agent.agent, 'steer').mockImplementation((message) => { steers.push([...message.content]) })

    await submitLine(harness, '/queue later')

    await vi.waitFor(() => { expect(followups).toHaveLength(1) })
    expect(steers).toEqual([])
  })

  it('reports the usage for an empty queue argument', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/queue')

    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.commands.usage('queue', '<message>'))
    })
  })

  it('reports a queue without a live agent', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const queue = privateValue(harness.app, 'queuePrompt') as (argument: string | undefined) => Promise<void>
    Reflect.set(harness.app, 'agent', undefined)

    await queue.call(harness.app, 'hello')

    expect(harness.transcriptText()).toContain(copy.commands.agentNotReady)
  })

  it.each([
    ['an Error', new Error('expand failed'), 'expand failed'],
    ['a non-Error', 'expand failed', 'expand failed'],
  ])('reports an expansion failure thrown as %s', async (_label, error, message) => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const expand = vi.fn(async () => { throw error })
    Reflect.set(harness.app, 'expandPrompt', expand)

    await submitLine(harness, '/queue remember')

    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.commands.promptFailed(message))
    })
  })

  it('reports the agent disappearing while the prompt expands', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    let resolveExpansion!: (value: { content: ContentBlock[]; notices: string[] }) => void
    Reflect.set(harness.app, 'expandPrompt', () => new Promise((resolve) => { resolveExpansion = resolve }))

    await submitLine(harness, '/queue remember')
    Reflect.set(harness.app, 'agent', undefined)
    resolveExpansion({ content: [{ type: 'text', text: 'remember' }], notices: [] })

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.commands.agentNotReady) })
  })
})

describe('TerminalApp activity reporting', () => {
  it('reports idle after start and working while a turn runs', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    expect(harness.terminal.headless.programStatus?.state).toBe('idle')
    expect(harness.terminal.headless.progress).toBe(false)

    harness.agent.setStatus('running')
    harness.ctx.emit('agent/status', { agent: harness.agent.agent, status: 'running' })

    expect(harness.terminal.headless.programStatus?.state).toBe('working')
    expect(harness.terminal.headless.programStatus?.message).toBe(copy.activity.working)
    expect(harness.terminal.headless.progress).toBe(true)
  })

  it('reports blocked while a modal waits and returns to idle after it closes', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/help')
    const panel = await overlayNumber(harness, 1)
    expect(harness.terminal.headless.programStatus?.state).toBe('blocked')
    expect(harness.terminal.headless.programStatus?.kind).toBe('question')

    press(panel, 'q')

    await vi.waitFor(() => { expect(harness.terminal.headless.programStatus?.state).toBe('idle') })
  })

  it('clears the program status on dispose and tolerates a refusing terminal', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const setProgramStatus = vi.spyOn(harness.terminal.headless, 'setProgramStatus').mockImplementation((status) => {
      if (status.state === 'clear') throw new Error('terminal gone')
    })

    expect(() => { harness.app.dispose() }).not.toThrow()

    expect(setProgramStatus).toHaveBeenCalledWith(expect.objectContaining({ state: 'clear' }))
  })

  it('ignores activity updates before the terminal exists', async () => {
    const harness = await lifecycleHarness()
    const update = privateValue(harness.app, 'updateActivity') as () => void

    expect(() => { update.call(harness.app) }).not.toThrow()
  })
})

describe('TerminalApp shutdown ordering', () => {
  it('restores the terminal before writing the failure to stderr', async () => {
    let reads = 0
    const harness = await lifecycleHarness({
      read: async () => {
        reads += 1
        if (reads > 1) throw new Error('history unavailable')
        return observation([])
      },
    })
    const order: string[] = []
    harness.terminal.stop.mockImplementation(() => { order.push('stop') })
    harness.stderr.mockImplementation(() => { order.push('stderr'); return true })
    harness.start()
    await harness.awaitStarted()

    harness.ctx.emit('agent/created', { agent: agentDouble({ session: harness.session }).agent, source: 'clear' })
    await harness.awaitExit()

    expect(order).toEqual(['stop', 'stderr'])
  })

  it('notices the exit and renders before waiting for the turn to settle', async () => {
    const harness = await lifecycleHarness()
    let noticedDuringIdle = false
    let renderedDuringIdle = false
    harness.agent.setWhenIdle(() => {
      noticedDuringIdle = harness.transcriptText().includes(copy.exit.requested)
      renderedDuringIdle = harness.terminal.renderNow.mock.calls.length > 0
      return Promise.resolve()
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/exit')
    await harness.awaitExit()

    expect(noticedDuringIdle).toBe(true)
    expect(renderedDuringIdle).toBe(true)
  })
})

/** One plugin-manager double used by the configuration panel tests. */
interface PluginManagerDouble {
  listBundles(): Promise<readonly { name: string; optional: boolean; enabled: boolean; readOnlyReason?: string }[]>
  setBundleEnabled(name: string, enabled: boolean): Promise<{ application: string }>
}

/**
 * Build a plugin-manager double recording every bundle switch.
 * @param bundles - bundles reported to the panel.
 * @param outcomes - result per bundle name, or a thrown value.
 * @returns the service and its recordings.
 */
function pluginManagerDouble(
  bundles: readonly { name: string; optional: boolean; enabled: boolean; readOnlyReason?: string }[],
  outcomes: Record<string, { application: string } | (() => never)> = {},
): { service: PluginManagerDouble; switched: { name: string; enabled: boolean }[] } {
  const switched: { name: string; enabled: boolean }[] = []
  const service: PluginManagerDouble = {
    listBundles: async () => bundles,
    setBundleEnabled: async (name, enabled) => {
      switched.push({ name, enabled })
      const outcome = outcomes[name]
      if (outcome === undefined) return { application: 'applied' }
      if (typeof outcome === 'function') return outcome()
      return outcome
    },
  }
  return { service, switched }
}

/** The permission catalog the configuration panel lists. */
const CONFIG_PRESETS = {
  catalog: () => ({
    options: [
      { value: 'read-only', name: 'Read Only' },
      { value: 'workspace-write', name: 'Workspace Write', description: 'writes inside the workspace' },
    ],
  }),
}

describe('TerminalApp /config dock', () => {
  it('presents the tabbed configuration panel in the dock and closes on Escape', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)

    expect(harness.overlays.components).toEqual([])
    expect(bottomOf(harness.app).active).toBe(true)
    const panel = configPanelOf(harness.app)
    expect(panel).toBeDefined()
    const dock = dockText(harness.app)
    expect(dock).toContain(copy.config.modelSection)
    expect(dock).toContain(copy.config.permissionSection)
    expect(dock).toContain(copy.config.tabHint)
    expect(panel?.render(100)).toHaveLength(10)

    harness.terminal.headless.press('\u001b')

    await vi.waitFor(() => { expect(bottomOf(harness.app).active).toBe(false) })
    expect(configPanelOf(harness.app)).toBeUndefined()
  })

  it('switches tabs and scrolls rows from the dock keys', async () => {
    const options = Array.from({ length: 12 }, (_, index) => ({ value: `preset-${String(index)}`, name: `Preset ${String(index)}` }))
    const harness = await lifecycleHarness({
      services: { permissionPresets: { catalog: () => ({ options }) } },
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)

    harness.terminal.headless.press('\t')
    expect(dockText(harness.app)).toContain(copy.config.permissionSection)
    expect(dockText(harness.app)).toContain('Preset 0')

    const panel = configPanelOf(harness.app)
    if (panel === undefined) throw new Error('configuration panel was not presented')
    panel.handleInput('\u001b[6~')
    expect(dockText(harness.app)).toContain(copy.moreRows(3))
    expect(dockText(harness.app)).not.toContain('Preset 0')

    panel.handleInput('\u001b[5~')
    expect(dockText(harness.app)).toContain('Preset 0')

    harness.terminal.headless.press('\u001b[Z')
    expect(dockText(harness.app)).toContain(copy.config.modelSection)
  })

  it('activates rows and closes the dock before nested selectors', async () => {
    const manager = pluginManagerDouble(
      [
        { name: 'bundle-a', optional: true, enabled: false },
        { name: 'bundle-b', optional: true, enabled: true },
        { name: 'bundle-c', optional: true, enabled: false },
        { name: 'bundle-err', optional: true, enabled: false },
        { name: 'bundle-string', optional: true, enabled: false },
        { name: 'bundle-ro', optional: true, enabled: false, readOnlyReason: 'owned by policy' },
        { name: 'bundle-core', optional: false, enabled: true },
      ],
      {
        'bundle-a': { application: 'applied' },
        'bundle-b': { application: 'restart-required' },
        'bundle-c': { application: 'refused' },
        'bundle-err': () => { throw new Error('write failed') },
        'bundle-string': () => { throw 'write failed' },
      },
    )
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm({ defaultEffort: ReasoningEffortId('low') }),
      services: { permissionPresets: CONFIG_PRESETS, pluginManager: manager.service },
      execute: async () => ({ commandId: CommandId('command-1'), result: { kind: 'success' } }),
      values: { permissions: { currentValue: 'workspace-write' } },
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    const panel = configPanelOf(harness.app)
    if (panel === undefined) throw new Error('configuration panel was not presented')

    await pressConfigRow(harness, panel, 'permissions', 'permission.workspace-write')
    await vi.waitFor(() => { expect(harness.commands.executed).toEqual(['/permission workspace-write']) })

    await pressConfigRow(harness, panel, 'experimental', 'bundle.bundle-a')
    await vi.waitFor(() => { expect(manager.switched).toEqual([{ name: 'bundle-a', enabled: true }]) })

    await pressConfigRow(harness, panel, 'experimental', 'bundle.bundle-b')
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.config.restartRequired) })
    await vi.waitFor(() => { expect(dockText(harness.app)).toContain(copy.config.restartMarker) })

    await pressConfigRow(harness, panel, 'experimental', 'bundle.bundle-c')
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.config.writeFailed('refused')) })

    await pressConfigRow(harness, panel, 'experimental', 'bundle.bundle-err')
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.config.writeFailed('write failed')) })

    await pressConfigRow(harness, panel, 'experimental', 'bundle.bundle-string')
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.config.writeFailed('write failed')) })

    focusConfigRow(panel, 'experimental', 'bundle.bundle-ro')
    expect(dockText(harness.app)).toContain('owned by policy')
    await vi.waitFor(() => { expect(Reflect.get(panel, 'busy')).toBe(false) })
    harness.terminal.headless.press('\r')
    expect(manager.switched.map(entry => entry.name)).not.toContain('bundle-ro')

    await pressConfigRow(harness, panel, 'display', 'display.cards')
    await pressConfigRow(harness, panel, 'display', 'display.reasoning')
    expect(privateValue(harness.app, 'transcript')).toBeDefined()

    await pressConfigRow(harness, panel, 'model', 'model.change')
    const selector = await overlayNumber(harness, 1)
    await vi.waitFor(() => { expect(bottomOf(harness.app).active).toBe(false) })
    press(selector, '\u001b')

    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    const reopened = configPanelOf(harness.app)
    if (reopened === undefined) throw new Error('configuration panel was not presented again')
    await pressConfigRow(harness, reopened, 'model', 'effort.change')

    await waitForDock(harness, copy.model.effortTitle)
    expect(bottomOf(harness.app).active).toBe(true)
    harness.terminal.headless.press('\u001b')
    await vi.waitFor(() => { expect(bottomOf(harness.app).active).toBe(false) })
  })

  it('closes the configuration panel through Ctrl+C', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)

    harness.terminal.headless.press('\x03')

    expect(bottomOf(harness.app).active).toBe(false)
    expect(configPanelOf(harness.app)).toBeUndefined()
    expect(harness.exit.codes).toEqual([])
  })

  it('reports the configuration panel without a live selection', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    Reflect.set(harness.app, 'selection', undefined)
    const open = privateValue(harness.app, 'openConfigPanel') as () => Promise<void>

    await open.call(harness.app)

    expect(harness.transcriptText()).toContain(copy.commands.agentNotReady)
  })

  it('propagates a bundle enumeration failure', async () => {
    const harness = await lifecycleHarness({
      services: {
        pluginManager: {
          listBundles: async () => { throw new Error('bundle load failed') },
          setBundleEnabled: async () => ({ application: 'applied' }),
        },
      },
    })
    harness.start()
    await harness.awaitStarted()
    const open = privateValue(harness.app, 'openConfigPanel') as () => Promise<void>

    await expect(open.call(harness.app)).rejects.toThrow('bundle load failed')
  })
})

describe('TerminalApp bottom-dock completion', () => {
  it('shows slash-command completions under the composer', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    harness.terminal.headless.press('/')
    const lines = await waitForDock(harness, copy.completion.title)

    expect(harness.overlays.components).toEqual([])
    expect(bottomOf(harness.app).active).toBe(true)
    expect(dockText(harness.app)).toContain('help')
    const promptLine = lines.findIndex(line => line.includes('dsh>'))
    const dockLine = lines.findIndex(line => line.includes(copy.completion.title))
    const footerLine = lines.findIndex(line => line.startsWith('session '))
    expect(promptLine).toBeLessThan(dockLine)
    expect(dockLine).toBeLessThan(footerLine)
  })

  it('filters the suggestions as the composer text grows', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    harness.terminal.headless.press('/')
    await waitForDock(harness, copy.completion.title)
    harness.terminal.headless.press('h')
    harness.terminal.headless.press('e')

    await vi.waitFor(() => {
      expect(dockText(harness.app)).toContain('help')
      expect(dockText(harness.app)).not.toContain('status')
    })
  })

  it('inserts the highlighted command on Tab and closes', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.terminal.headless.press('/')
    harness.terminal.headless.press('s')
    harness.terminal.headless.press('t')
    await waitForDock(harness, copy.completion.title)

    harness.terminal.headless.press('\t')

    await vi.waitFor(() => { expect(editorOf(harness.app).getText()).toBe('/status ') })
    expect(bottomOf(harness.app).active).toBe(false)
  })

  it('runs the highlighted command immediately on Enter', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.terminal.headless.press('/')
    harness.terminal.headless.press('s')
    harness.terminal.headless.press('t')
    await waitForDock(harness, copy.completion.title)

    harness.terminal.headless.press('\r')

    await vi.waitFor(() => { expect(editorOf(harness.app).getText()).toBe('') })
    expect(bottomOf(harness.app).active).toBe(false)
    await vi.waitFor(() => { expect(harness.overlays.components.length).toBeGreaterThan(0) })
  })

  it('closes on Escape and on Ctrl+C without interrupting the turn', async () => {
    const escapeHarness = await lifecycleHarness()
    escapeHarness.start()
    await escapeHarness.awaitStarted()
    escapeHarness.agent.setStatus('running')
    escapeHarness.terminal.headless.press('/')
    await waitForDock(escapeHarness, copy.completion.title)

    escapeHarness.terminal.headless.press('\u001b')

    expect(bottomOf(escapeHarness.app).active).toBe(false)
    expect(escapeHarness.agent.cancels).toEqual([])

    const interruptHarness = await lifecycleHarness()
    interruptHarness.start()
    await interruptHarness.awaitStarted()
    interruptHarness.terminal.headless.press('/')
    await waitForDock(interruptHarness, copy.completion.title)

    interruptHarness.terminal.headless.press('\x03')

    expect(bottomOf(interruptHarness.app).active).toBe(false)
    expect(interruptHarness.exit.codes).toEqual([])
  })

  it('moves the highlight with arrows and pages', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.terminal.headless.press('/')
    await waitForDock(harness, copy.completion.title)
    const completion = completionOf(harness.app)

    harness.terminal.headless.press('\u001b[A')
    expect(Reflect.get(completion, 'index')).toBeGreaterThan(0)
    const afterUp = Reflect.get(completion, 'index') as number
    harness.terminal.headless.press('\u001b[B')
    expect(Reflect.get(completion, 'index')).toBe((afterUp + 1) % (Reflect.get(completion, 'items') as AutocompleteItem[]).length)
  })

  it('completes a workspace mention once the file index answers', async () => {
    const harness = await lifecycleHarness({
      services: {
        fileReferences: {
          list: async () => [
            { path: 'src/a.ts', kind: 'file' },
            { path: 'src/b.ts', kind: 'file' },
          ],
        },
      },
    })
    harness.start()
    await harness.awaitStarted()

    for (const key of '@sr') harness.terminal.headless.press(key)
    await waitForDock(harness, 'src/a.ts')

    harness.terminal.headless.press('\r')

    await vi.waitFor(() => { expect(editorOf(harness.app).getText()).toBe('@src/a.ts') })
    expect(bottomOf(harness.app).active).toBe(false)
  })

  it('closes the suggestions when the provider has none', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.terminal.headless.press('/')
    await waitForDock(harness, copy.completion.title)

    for (const key of 'zzz') harness.terminal.headless.press(key)

    await vi.waitFor(() => { expect(bottomOf(harness.app).active).toBe(false) })
  })
})

describe('TerminalApp dock synchronization', () => {
  it('prefers the configuration panel, then the list, then completion, then clears', async () => {
    const harness = await lifecycleHarness({
      services: {
        fileReferences: { list: async () => [{ path: 'src/a.ts', kind: 'file' }] },
      },
    })
    harness.start()
    await harness.awaitStarted()
    const sync = privateValue(harness.app, 'syncDock') as () => void
    const syncDock = (): void => { sync.call(harness.app) }
    const completion = completionOf(harness.app)
    const list = bottomListOf(harness.app)

    editorOf(harness.app).setText('@sr')
    await completion.refresh(true)
    syncDock()
    expect(dockText(harness.app)).toContain(copy.completion.title)

    list.open('List title', [{ value: 'one', label: 'One' }], () => {}, () => {})
    syncDock()
    expect(dockText(harness.app)).toContain('List title')
    expect(dockText(harness.app)).not.toContain(copy.completion.title)

    const openConfig = privateValue(harness.app, 'openConfigPanel') as () => Promise<void>
    await openConfig.call(harness.app)
    expect(dockText(harness.app)).toContain(copy.config.modelSection)
    expect(completion.active).toBe(false)
    expect(list.active).toBe(false)

    const closeConfig = privateValue(harness.app, 'closeConfigPanel') as () => void
    closeConfig.call(harness.app)
    syncDock()
    expect(bottomOf(harness.app).active).toBe(false)
  })
})

describe('TerminalApp reasoning visibility', () => {
  it('sets and cycles the reasoning level through the command', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript

    await submitLine(harness, '/reasoning detailed')
    await vi.waitFor(() => { expect(transcript.reasoningLevel()).toBe('detailed') })
    expect(harness.transcriptText()).toContain(copy.reasoning.changed(copy.reasoning.levels.detailed))
    expect(footerText(harness.app)).toContain(copy.reasoning.label(copy.reasoning.levels.detailed))

    await submitLine(harness, '/reasoning')
    await vi.waitFor(() => { expect(transcript.reasoningLevel()).toBe('verbose') })
  })

  it('parses the localized level names', async () => {
    setCopyLocale('zh')
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript

    await submitLine(harness, '/reasoning 详细')

    await vi.waitFor(() => { expect(transcript.reasoningLevel()).toBe('detailed') })
    expect(harness.transcriptText()).toContain(copy.reasoning.changed(copy.reasoning.levels.detailed))
    expect(footerText(harness.app)).toContain(copy.reasoning.label(copy.reasoning.levels.detailed))
  })

  it('reports the available levels for an unknown argument', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/reasoning turbo')

    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.reasoning.available('compact, standard, detailed, verbose'))
    })
  })

  it('ignores a level change before the transcript exists', async () => {
    const harness = await lifecycleHarness()
    const setLevel = privateValue(harness.app, 'setReasoningVisibility') as (argument: string | undefined) => void

    expect(() => { setLevel.call(harness.app, 'detailed') }).not.toThrow()
  })

  it('falls back to the standard level when the transcript is gone', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    Reflect.set(harness.app, 'transcript', undefined)

    await submitLine(harness, '/status')
    const panel = await overlayNumber(harness, 1)

    expect(panel.render(100).join('\n')).toContain(copy.reasoning.levels.standard)
  })

  it('shows the reasoning level in the status panel', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/reasoning compact')

    await submitLine(harness, '/status')
    const panel = await overlayNumber(harness, 1)

    expect(panel.render(100).join('\n')).toContain(copy.statusPanel.reasoning)
    expect(panel.render(100).join('\n')).toContain(copy.reasoning.levels.compact)
    expect(panel.render(100).join('\n')).toContain(copy.statusPanel.effort)
  })
})

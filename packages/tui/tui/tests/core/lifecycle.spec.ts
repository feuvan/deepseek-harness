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
import type { BusyEnter } from '../../src/config.ts'
import { TerminalTranscript } from '../../src/transcript.ts'
import type { ScreenMode, TerminalSession } from '../../src/terminal.ts'
import { TerminalAutocompleteProvider, type TerminalAutocompleteDeps } from '../../src/autocomplete.ts'
import type { Composer } from '../../src/commands.ts'
import type { Footer } from '../../src/components/footer.ts'
import { chinese, copy, setCopyLocale } from '../../src/copy.ts'
import type { ComposerDeps } from '../../src/commands.ts'
import type { PromptEditor } from '../../src/components/editor.ts'
import type { BottomPanel, DockSurface } from '../../src/components/bottom.ts'
import type { BottomList } from '../../src/bottom-list.ts'
import type { CompletionController } from '../../src/completion.ts'
import type { ConfigPanel } from '../../src/config-panel.ts'
import type { InteractionDock } from '../../src/interactions.ts'
import type { ConfigRow } from '../../src/config-panel.ts'
import { ScrollView } from '@earendil-works/pi-tui'
import type { AutocompleteItem } from '@earendil-works/pi-tui'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AdmittedPromptContentPart, ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import type { AttachmentAdmissionPart } from '@deepseek-ai/dsh-attachment/types'
import { readClipboardImage } from '../../src/clipboard.ts'
import { mountSessions } from '../support/fakes.ts'

vi.mock('../../src/clipboard.ts', () => ({ readClipboardImage: vi.fn() }))
import { sessionTitle, toolCall, toolResult, userMessage } from '../support/events.ts'
import {
  agentDouble, agentsDouble, appExitDouble, commandsDouble, freshContext,
  agentPresetsDouble, headlessSession, llmDouble, observation, projectionsDouble, queuedMessage,
  screenLines, sessionQueryDouble, terminalConfig,
  toolsDouble, userQuestionsDouble, waitForScreen,
  type AgentDouble, type AgentsDouble, type AppExitDouble, type CommandsDouble,
  type ObservationDouble, type ProjectionsDouble, type SessionQueryDouble,
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
  /** Plain-Enter delivery mode while the Agent runs. */
  readonly busyEnter?: BusyEnter
  /** Attached transcript block window. */
  readonly windowBlocks?: number
  /** Renderer mode this launch owns. */
  readonly screen?: ScreenMode
  /** Messages already queued in the Agent inbox. */
  readonly queued?: readonly UserMessage[]
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
    ...(options.queued === undefined ? {} : { queued: options.queued }),
  })
  if (options.existingAgent !== false) agents.bind(agent.agent)

  const owned = headlessSession(options.mainScreen === true
    ? { mainScreen: true }
    : (options.screen === undefined ? {} : { screen: options.screen }))
  const start = vi.spyOn(owned.session.tui, 'start')
  const requestRender = vi.spyOn(owned.session.tui, 'requestRender')
  const renderNow = vi.spyOn(owned.session.tui, 'renderNow')
  const stop = vi.spyOn(owned.session, 'stop')
  const flush = vi.spyOn(ctx.sessions, 'flush')
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const config = terminalConfig({
    ...(options.animation === true ? { animation: true } : {}),
    ...(options.busyEnter === undefined ? {} : { busyEnter: options.busyEnter }),
    ...(options.windowBlocks === undefined ? {} : { windowBlocks: options.windowBlocks }),
    ...(options.screen === undefined ? {} : { screen: options.screen }),
  })
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
 * Submit one line through the composer without the editor completion window.
 * @param harness - the application harness.
 * @param line - exact command line.
 */
function submitCommand(harness: LifecycleHarness, line: string): void {
  const composer = privateValue(harness.app, 'composer') as { submit(text: string): void }
  composer.submit(line)
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

describe('TerminalApp live configuration', () => {
  it('updates display fields in place without recreating the terminal', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const terminal = harness.terminal.session
    const title = vi.spyOn(terminal.tui.terminal, 'setTitle')
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript
    const stopAnimation = Reflect.get(harness.app, 'stopAnimation') as () => void
    stopAnimation.call(harness.app)

    harness.app.applyConfig(terminalConfig({
      color: true,
      animation: true,
      previewLines: 8,
      windowBlocks: 120,
      title: 'Live terminal',
      busyEnter: 'steer',
    }))

    expect(privateValue(harness.app, 'config')).toMatchObject({
      color: true,
      animation: true,
      previewLines: 8,
      windowBlocks: 120,
      title: 'Live terminal',
      busyEnter: 'steer',
    })
    expect(privateValue(harness.app, 'palette')).toMatchObject({ color: true })
    expect(title).toHaveBeenLastCalledWith('Live terminal')
    expect(Reflect.get(transcript, 'deps')).toMatchObject({ previewLines: 8, windowBlocks: 120 })
    expect(Reflect.get(harness.app, 'animation')).toBeDefined()

    harness.app.applyConfig(terminalConfig({ title: 'Live terminal', locale: 'zh', screen: 'inline' }))

    expect(privateValue(harness.app, 'config')).toMatchObject({ color: false, animation: false, locale: 'zh' })
    expect(copy.config.title).toBe('配置')
    setCopyLocale('en')
    expect(Reflect.get(harness.app, 'animation')).toBeUndefined()
    expect(privateValue(harness.app, 'palette')).toMatchObject({ color: false })
  })

  it('ignores an update for another Session identity', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const before = privateValue(harness.app, 'config')

    harness.app.applyConfig(terminalConfig({ sessionId: 'other-session', title: 'Ignored' }))

    expect(privateValue(harness.app, 'config')).toBe(before)
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
    const panel = await dockPanel(harness)
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
    const panel = await dockPanel(harness)
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
    // Kitty's release report for the same physical key must not toggle again.
    harness.terminal.headless.press('\u001b[114;5:3u')
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
    expect(transcript.cardsMode()).toBe('collapsed')
    harness.terminal.headless.press('\x0f')
    expect(transcript.cardsMode()).toBe('expanded')
    harness.terminal.headless.press('\u001b[111;5:3u')
    expect(transcript.cardsMode()).toBe('expanded')
    expect(harness.transcriptText()).toContain(copy.cards.changed(copy.cards.levels.expanded))
    harness.terminal.headless.press('\x0f')
    expect(transcript.cardsMode()).toBe('hidden')
    expect(harness.transcriptText()).toContain(copy.cards.changed(copy.cards.levels.hidden))
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
    await dockPanel(harness)

    harness.terminal.headless.press('\x03')

    expect(bottomOf(harness.app).active).toBe(false)
    expect(harness.exit.codes).toEqual([])
  })

  it('closes a read-only panel from its own input', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/help')
    const panel = await dockPanel(harness)

    press(panel, 'q')

    expect(bottomOf(harness.app).active).toBe(false)
  })

  it('cancels an open panel from dispose and stops the terminal once', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/help')
    await dockPanel(harness)

    harness.app.dispose()
    harness.app.dispose()

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
    const panel = await dockPanel(harness)
    press(panel, '\r')

    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['Yes'] }] })
    await awaitDockClosed(harness)
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
    const panel = await dockPanel(harness)
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
    const panel = await dockPanel(harness)
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
    const selector = await dockPanel(harness)
    press(selector, '\r')
    await awaitDockClosed(harness)

    await submitLine(harness, '/status')
    const status = await dockPanel(harness)
    const text = status.render(100).join('\n')
    expect(text).toContain('Provider     alpha')
    expect(text).toContain('Model        m-1')
  })

  it('cancels the model selector without changing the route', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/model')
    const selector = await dockPanel(harness)
    press(selector, '\x1b')

    expect(bottomOf(harness.app).active).toBe(false)
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
    await dockPanel(harness)
    harness.terminal.headless.press('\u001b[6~')
    harness.terminal.headless.press('\u001b[6~')
    const text = dockText(harness.app)
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
    const panel = await dockPanel(harness)

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
    const panel = await dockPanel(harness)
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
    await dockPanel(harness)
    harness.terminal.headless.press('\x03')

    expect(bottomOf(harness.app).active).toBe(false)
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
    const selector = await dockPanel(harness)

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

/** @returns the component currently owning the dock. */
function dockContentOf(app: TerminalApp): Component & { handleInput(data: string): void } {
  const content = Reflect.get(bottomOf(app), 'content') as (Component & { handleInput(data: string): void }) | undefined
  if (content === undefined) throw new Error('the dock has no active component')
  return content
}

/**
 * Wait for a dock surface and return its component.
 * @param harness - the application harness.
 * @returns the presented dock component.
 */
async function dockPanel(harness: LifecycleHarness): Promise<Component & { handleInput(data: string): void }> {
  await vi.waitFor(() => { expect(bottomOf(harness.app).active).toBe(true) })
  return dockContentOf(harness.app)
}

/**
 * Wait for the dock to become empty.
 * @param harness - the application harness.
 */
async function awaitDockClosed(harness: LifecycleHarness): Promise<void> {
  await vi.waitFor(() => { expect(bottomOf(harness.app).active).toBe(false) })
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
    const panel = await dockPanel(harness)
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
    const panel = await dockPanel(harness)

    expect(panel.render(100).join('\n')).toContain('Effort       low (default)')
  })

  it('reports the bare default effort for a model without efforts', async () => {
    const harness = await lifecycleHarness({ agentOptions: { provider: 'alpha', model: 'm-1' } })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/status')
    const panel = await dockPanel(harness)

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
    const selector = await dockPanel(harness)
    press(selector, '\r')

    await vi.waitFor(() => { expect(footerText(harness.app)).toContain('m-1 · high') })
  })
})

describe('TerminalApp live display settings', () => {
  it('persists display toggles and prompted values through settings', async () => {
    const updates: Array<{ namespace: string; patch: Record<string, unknown> }> = []
    const harness = await lifecycleHarness({
      services: {
        settings: {
          update: async (namespace: string, patch: Record<string, unknown>) => {
            updates.push({ namespace, patch })
          },
        },
      },
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    const panel = configPanelOf(harness.app)
    if (panel === undefined) throw new Error('configuration panel was not presented')

    focusConfigRow(panel, 'display', 'display.color')
    harness.terminal.headless.press('\r')
    await vi.waitFor(() => { expect(updates).toEqual([{ namespace: 'terminal-ui', patch: { color: true } }]) })
    await vi.waitFor(() => { expect(Reflect.get(panel, 'busy')).toBe(false) })

    focusConfigRow(panel, 'display', 'display.previewLines')
    harness.terminal.headless.press('\r')
    for (const key of ['\x7f', '\x7f', '5', '\r']) harness.terminal.headless.press(key)
    await vi.waitFor(() => { expect(updates.at(-1)).toEqual({ namespace: 'terminal-ui', patch: { previewLines: 5 } }) })
  })

  it('validates every display field and reports write failures', async () => {
    let writes = 0
    const harness = await lifecycleHarness({
      services: {
        settings: {
          update: async () => {
            writes += 1
            throw writes === 1 ? new Error('write failed') : 'string write failed'
          },
        },
      },
    })
    harness.start()
    await harness.awaitStarted()
    const displayValue = Reflect.get(harness.app, 'displayValue') as (field: string, value: string) => unknown

    expect(displayValue.call(harness.app, 'color', copy.config.on)).toBe(true)
    expect(displayValue.call(harness.app, 'animation', copy.config.off)).toBe(false)
    expect(displayValue.call(harness.app, 'previewLines', '12')).toBe(12)
    expect(displayValue.call(harness.app, 'previewLines', '0')).toBeUndefined()
    expect(displayValue.call(harness.app, 'windowBlocks', '300')).toBe(300)
    expect(displayValue.call(harness.app, 'title', 'Live title')).toBe('Live title')
    expect(displayValue.call(harness.app, 'title', '  ')).toBeUndefined()
    expect(displayValue.call(harness.app, 'locale', 'zh')).toBe('zh')
    expect(displayValue.call(harness.app, 'busyEnter', 'steer')).toBe('steer')
    expect(displayValue.call(harness.app, 'screen', 'fullscreen')).toBeUndefined()

    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    const panel = configPanelOf(harness.app)
    if (panel === undefined) throw new Error('configuration panel was not presented')
    await pressConfigRow(harness, panel, 'display', 'display.color')
    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.config.writeFailed('write failed'))
    })
    await vi.waitFor(() => { expect(Reflect.get(panel, 'busy')).toBe(false) })
    await pressConfigRow(harness, panel, 'display', 'display.animation')
    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.config.writeFailed('string write failed'))
    })
  })

  it('reports unavailable settings and invalid display values', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    const panel = configPanelOf(harness.app)
    if (panel === undefined) throw new Error('configuration panel was not presented')

    await pressConfigRow(harness, panel, 'display', 'display.color')
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.config.failed(copy.config.unavailable('settings'))) })

    const configured = await lifecycleHarness({
      services: {
        settings: { update: async () => {} },
      },
    })
    configured.start()
    await configured.awaitStarted()
    await submitLine(configured, '/config')
    await waitForDock(configured, copy.config.modelSection)
    const configuredPanel = configPanelOf(configured.app)
    if (configuredPanel === undefined) throw new Error('configuration panel was not presented')
    focusConfigRow(configuredPanel, 'display', 'display.previewLines')
    configured.terminal.headless.press('\r')
    for (const key of ['\x7f', '\x7f', 'a', 'b', 'c', '\r']) configured.terminal.headless.press(key)
    await vi.waitFor(() => {
      expect(configured.transcriptText()).toContain(copy.config.writeFailed(copy.config.invalidValue('previewLines')))
    })
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
    expect(bottomOf(harness.app).active).toBe(false)
  })

  it('dispatches the bare command without a permission catalog', async () => {
    const harness = await lifecycleHarness({
      descriptors: [{ name: 'permission', description: 'Set the permission preset', input: { hint: '<preset>' } }],
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/permission')

    await vi.waitFor(() => { expect(harness.commands.executed).toEqual(['/permission']) })
    expect(bottomOf(harness.app).active).toBe(false)
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
    await dockPanel(harness)
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

  it('reports an empty queue when the inline queue editor has nothing to show', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/queue')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.queue.empty) })
    expect(bottomOf(harness.app).active).toBe(false)
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
    const answer = harness.ctx.waterfall('user-questions/request', {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }] }],
    }, () => Promise.resolve({ answers: [] }))
    const panel = await dockPanel(harness)

    await vi.waitFor(() => { expect(harness.terminal.headless.programStatus?.state).toBe('blocked') })
    expect(harness.terminal.headless.programStatus?.kind).toBe('question')

    press(panel, '\r')
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['Yes'] }] })

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

    expect(bottomOf(harness.app).active).toBe(true)
    const panel = configPanelOf(harness.app)
    expect(panel).toBeDefined()
    const dock = dockText(harness.app)
    expect(dock).toContain(copy.config.title)
    expect(dock).toContain(copy.config.subtitle)
    expect(dock).toContain(copy.config.modelSection)
    expect(dock).toContain(copy.config.permissionSection)
    expect(dock).toContain(copy.config.tabHint)
    expect(panel?.render(100)).toHaveLength(15)

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
    expect(harness.transcriptText().split(copy.config.restartRequired)).toHaveLength(2)
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
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript
    expect(transcript.cardsMode()).toBe('expanded')
    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.cards.changed(copy.cards.levels.expanded))
    })
    await pressConfigRow(harness, panel, 'display', 'display.reasoning')
    expect(privateValue(harness.app, 'transcript')).toBeDefined()

    await pressConfigRow(harness, panel, 'model', 'model.change')
    await waitForDock(harness, copy.model.title)
    const selector = dockContentOf(harness.app)
    press(selector, '\u001b')
    await awaitDockClosed(harness)

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
    await waitForDock(harness, copy.panel.status)
    expect(bottomOf(harness.app).active).toBe(true)
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

    editorOf(harness.app).setText('@sr')
    await completion.refresh(true)
    syncDock()
    expect(dockText(harness.app)).toContain(copy.completion.title)

    const showText = privateValue(harness.app, 'showText') as (title: string, lines: readonly string[]) => void
    showText.call(harness.app, copy.panel.help, ['help body'])
    expect(dockText(harness.app)).toContain(copy.panel.help)
    expect(dockText(harness.app)).not.toContain(copy.completion.title)

    const closeOverlay = privateValue(harness.app, 'dockOverlay') as { close(): void }
    closeOverlay.close()
    syncDock()
    expect(dockText(harness.app)).toContain(copy.completion.title)
    completion.close()
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
    const panel = await dockPanel(harness)

    expect(panel.render(100).join('\n')).toContain(copy.reasoning.levels.standard)
  })

  it('shows the reasoning level in the status panel', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/reasoning compact')

    await submitLine(harness, '/status')
    const panel = await dockPanel(harness)

    expect(panel.render(100).join('\n')).toContain(copy.statusPanel.reasoning)
    expect(panel.render(100).join('\n')).toContain(copy.reasoning.levels.compact)
    expect(panel.render(100).join('\n')).toContain(copy.statusPanel.effort)
  })
})

describe('TerminalApp dock surfaces', () => {
  it('renders the help and status panels in the dock', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/help')
    await waitForDock(harness, copy.panel.help)
    expect(dockText(harness.app)).toContain(copy.commands.helpTitle)
    expect(bottomOf(harness.app).active).toBe(true)

    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)
    expect(harness.exit.codes).toEqual([])

    await submitLine(harness, '/status')
    await waitForDock(harness, copy.panel.status)
    const dock = dockText(harness.app)
    expect(dock).toContain(copy.statusPanel.session)
    expect(dock).toContain(copy.statusPanel.model)
    expect(dock).toContain(copy.statusPanel.reasoning)
  })

  it('selects a model in the dock and updates the footer once', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/model')
    await waitForDock(harness, copy.model.title)
    const selector = dockContentOf(harness.app)

    press(selector, '\r')

    await awaitDockClosed(harness)
    await vi.waitFor(() => { expect(footerText(harness.app)).toContain('m-1') })
    expect(harness.exit.codes).toEqual([])
  })

  it('cancels the model selector without changing the route', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const before = footerText(harness.app)

    await submitLine(harness, '/model')
    await waitForDock(harness, copy.model.title)
    press(dockContentOf(harness.app), '\u001b')

    await awaitDockClosed(harness)
    expect(footerText(harness.app)).toBe(before)
  })

  it('presents a question and an approval in the dock and blocks activity while waiting', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    const answer = harness.ctx.waterfall('user-questions/request', {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    }, () => Promise.resolve({ answers: [] }))
    const question = await dockPanel(harness)
    await vi.waitFor(() => { expect(harness.terminal.headless.programStatus?.state).toBe('blocked') })
    press(question, '\r')
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['Yes'] }] })
    await awaitDockClosed(harness)
    await vi.waitFor(() => { expect(harness.terminal.headless.programStatus?.state).toBe('idle') })

    const outcome = harness.ctx.waterfall('approval/request', {
      agent: harness.agent.agent,
      toolName: 'bash',
      reason: 'needs network',
    }, () => Promise.resolve('unavailable'))
    const approval = await dockPanel(harness)
    await vi.waitFor(() => { expect(harness.terminal.headless.programStatus?.state).toBe('blocked') })
    press(approval, 'y')
    await expect(outcome).resolves.toBe('allowed-once')
    await awaitDockClosed(harness)
  })

  it('does not type into the editor while a dock surface owns input', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/help')
    await waitForDock(harness, copy.panel.help)
    for (const key of 'abc') harness.terminal.headless.press(key)
    expect(editorOf(harness.app).getText()).toBe('')
    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    await submitLine(harness, '/model')
    await waitForDock(harness, copy.model.title)
    for (const key of 'xyz') harness.terminal.headless.press(key)
    expect(editorOf(harness.app).getText()).toBe('')
    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    for (const key of 'abc') harness.terminal.headless.press(key)
    expect(editorOf(harness.app).getText()).toBe('')
    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    const answer = harness.ctx.waterfall('user-questions/request', {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }] }],
    }, () => Promise.resolve({ answers: [] }))
    await dockPanel(harness)
    for (const key of 'typed') harness.terminal.headless.press(key)
    expect(editorOf(harness.app).getText()).toBe('')
    harness.terminal.headless.press('\u001b')
    await expect(answer).rejects.toThrow('The user cancelled the question.')
    await awaitDockClosed(harness)
  })
})

describe('TerminalApp dock single-step regressions', () => {
  it('moves the configuration cursor one row per Down and switches one tab per Tab', async () => {
    const options = Array.from({ length: 12 }, (_, index) => ({ value: `preset-${String(index)}`, name: `Preset ${String(index)}` }))
    const harness = await lifecycleHarness({
      services: { permissionPresets: { catalog: () => ({ options }) } },
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    const panel = configPanelOf(harness.app)
    if (panel === undefined) throw new Error('configuration panel was not presented')
    const sectionBefore = Reflect.get(panel, 'section') as string
    const cursorBefore = Reflect.get(panel, 'cursor') as number

    harness.terminal.headless.press('\u001b[B')
    expect(Reflect.get(panel, 'cursor')).toBe(cursorBefore + 1)
    expect(Reflect.get(panel, 'section')).toBe(sectionBefore)

    harness.terminal.headless.press('\t')
    expect(Reflect.get(panel, 'section')).not.toBe(sectionBefore)
    expect(Reflect.get(panel, 'cursor')).toBe(0)

    harness.terminal.headless.press('\u001b[6~')
    const paged = Reflect.get(panel, 'cursor') as number
    expect(paged).toBeGreaterThan(0)
    harness.terminal.headless.press('\u001b[5~')
    expect(Reflect.get(panel, 'cursor')).toBe(0)
  })

  it('ignores Kitty key-release reports so one physical key moves one step', async () => {
    const options = Array.from({ length: 12 }, (_, index) => ({ value: `preset-${String(index)}`, name: `Preset ${String(index)}` }))
    const harness = await lifecycleHarness({
      services: { permissionPresets: { catalog: () => ({ options }) } },
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    const panel = configPanelOf(harness.app)
    if (panel === undefined) throw new Error('configuration panel was not presented')
    const before = Reflect.get(panel, 'cursor') as number

    harness.terminal.headless.press('\u001b[1;1:3B')
    expect(Reflect.get(panel, 'cursor')).toBe(before)

    harness.terminal.headless.press('\u001b[B')
    expect(Reflect.get(panel, 'cursor')).toBe(before + 1)

    harness.terminal.headless.press('\u001b[1;1:3C')
    expect(Reflect.get(panel, 'section')).toBe('model')
    harness.terminal.headless.press('\u001b[C')
    expect(Reflect.get(panel, 'section')).toBe('permissions')

    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)
    await submitLine(harness, '/permission')
    await waitForDock(harness, copy.prompt.permissionTitle)
    const list = bottomListOf(harness.app)
    const listIndex = Reflect.get(list, 'index') as number
    harness.terminal.headless.press('\u001b[1;1:3B')
    expect(Reflect.get(list, 'index')).toBe(listIndex)
    harness.terminal.headless.press('\u001b[B')
    expect(Reflect.get(list, 'index')).toBe(listIndex + 1)
  })

  it('filters release reports on the listener path without an interceptor', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.terminal.session.setInputInterceptor?.(undefined)
    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    const panel = configPanelOf(harness.app)
    if (panel === undefined) throw new Error('configuration panel was not presented')
    const before = Reflect.get(panel, 'cursor') as number

    harness.terminal.headless.press('\u001b[1;1:3B')
    expect(Reflect.get(panel, 'cursor')).toBe(before)
    harness.terminal.headless.press('\u001b[B')
    expect(Reflect.get(panel, 'cursor')).toBe(before + 1)
  })

  it('moves a permission chooser one row per Down and dispatches once per Enter', async () => {
    const harness = await lifecycleHarness({
      descriptors: [{ name: 'permission', description: 'Set the permission preset', input: { hint: '<preset>' } }],
      services: {
        permissionPresets: {
          catalog: () => ({
            options: [
              { value: 'read-only', name: 'Read Only' },
              { value: 'workspace-write', name: 'Workspace Write' },
            ],
          }),
        },
      },
      execute: async () => ({ commandId: CommandId('command-1'), result: { kind: 'success' } }),
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/permission')
    await waitForDock(harness, copy.prompt.permissionTitle)
    const before = dockText(harness.app)
    expect(before).toContain('❯ Read Only')

    harness.terminal.headless.press('\u001b[B')
    expect(dockText(harness.app)).toContain('❯ Workspace Write')

    harness.terminal.headless.press('\r')

    await vi.waitFor(() => { expect(harness.commands.executed).toEqual(['/permission workspace-write']) })
    await awaitDockClosed(harness)
    expect(harness.commands.executed).toHaveLength(1)
  })

  it('moves an effort chooser one row per Down and applies once per Enter', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm({ defaultEffort: ReasoningEffortId('low') }),
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/effort')
    await waitForDock(harness, copy.model.effortTitle)
    expect(dockText(harness.app)).toContain('❯ Low')

    harness.terminal.headless.press('\u001b[B')
    expect(dockText(harness.app)).toContain('❯ High')

    harness.terminal.headless.press('\r')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.model.effort('high')) })
    await awaitDockClosed(harness)
    expect(harness.transcriptText().match(/Reasoning effort:/gu)).toHaveLength(1)
  })

  it('moves the model selector one row per Down and selects once per Enter', async () => {
    const harness = await lifecycleHarness({
      llm: llmDouble({
        providers: [{ id: 'alpha', name: 'Alpha' }],
        listModels: async () => [
          { provider: 'alpha', id: 'm-1', name: 'Model One' },
          { provider: 'alpha', id: 'm-2', name: 'Model Two' },
        ],
        resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      }),
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/model')
    await waitForDock(harness, copy.model.title)
    const panel = dockContentOf(harness.app)
    const cursor = Reflect.get(panel, 'index') as number

    harness.terminal.headless.press('\u001b[B')
    expect(Reflect.get(panel, 'index')).toBe(cursor + 1)

    harness.terminal.headless.press('\r')

    await awaitDockClosed(harness)
    await vi.waitFor(() => { expect(footerText(harness.app)).toContain('m-2') })
  })

  it('moves the question cursor one option per Down and answers once', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const answer = harness.ctx.waterfall('user-questions/request', {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    }, () => Promise.resolve({ answers: [] }))
    const panel = await dockPanel(harness)
    const cursor = Reflect.get(panel, 'cursor') as number

    harness.terminal.headless.press('\u001b[B')
    expect(Reflect.get(panel, 'cursor')).toBe(cursor + 1)
    expect(panel.render(80).join('\n')).toContain('❯ No')

    harness.terminal.headless.press('\r')

    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['No'] }] })
    await awaitDockClosed(harness)
  })

  it('moves the completion highlight one row per arrow key and applies once', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.terminal.headless.press('/')
    await waitForDock(harness, copy.completion.title)
    const completion = completionOf(harness.app)
    const start = Reflect.get(completion, 'index') as number

    harness.terminal.headless.press('\u001b[B')
    expect(Reflect.get(completion, 'index')).toBe(start + 1)
    harness.terminal.headless.press('\u001b[A')
    expect(Reflect.get(completion, 'index')).toBe(start)

    harness.terminal.headless.press('\r')

    await waitForDock(harness, copy.panel.help)
    expect(editorOf(harness.app).getText()).toBe('')
    expect(completion.active).toBe(false)
  })
})

describe('TerminalApp dock interaction routing', () => {
  it('answers a question through dock input routing and cancels it on Ctrl+C', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    const answer = harness.ctx.waterfall('user-questions/request', {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    }, () => Promise.resolve({ answers: [] }))
    await dockPanel(harness)
    harness.terminal.headless.press('\u001b[B')
    harness.terminal.headless.press('\r')

    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['No'] }] })
    await awaitDockClosed(harness)
    expect(harness.exit.codes).toEqual([])

    const cancelled = harness.ctx.waterfall('user-questions/request', {
      agent: harness.agent.agent,
      questions: [{ id: 'q2', question: 'Again?', options: [{ label: 'Yes' }] }],
    }, () => Promise.resolve({ answers: [] }))
    await dockPanel(harness)

    harness.terminal.headless.press('\x03')

    await expect(cancelled).rejects.toThrow('The user cancelled the question.')
    await awaitDockClosed(harness)
    expect(harness.exit.codes).toEqual([])
  })

  it('presents and closes a raw interaction surface', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const makeDock = privateValue(harness.app, 'interactionDock') as () => InteractionDock
    const dock = makeDock.call(harness.app)
    const panel = {
      render: () => ['interaction surface'],
      invalidate: () => {},
      handleInput: () => {},
    }

    dock.present(panel)
    expect(dockText(harness.app)).toContain('interaction surface')
    const surface = privateValue(harness.app, 'dockOverlay') as { close(): void }
    surface.close()
    await awaitDockClosed(harness)

    dock.present(panel)
    dock.dismiss()
    await awaitDockClosed(harness)
  })

  it('answers an approval through dock input routing', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const outcome = harness.ctx.waterfall('approval/request', {
      agent: harness.agent.agent,
      toolName: 'bash',
      reason: 'needs network',
    }, () => Promise.resolve('unavailable'))
    await dockPanel(harness)

    harness.terminal.headless.press('y')

    await expect(outcome).resolves.toBe('allowed-once')
    await awaitDockClosed(harness)
  })
})

describe('TerminalApp dock input interception', () => {
  it('keeps the transcript still on page keys while a dock surface owns input', async () => {
    const scrollBy = vi.spyOn(ScrollView.prototype, 'scrollBy')
    const scrollTo = vi.spyOn(ScrollView.prototype, 'scrollTo')
    onTestFinished(() => { scrollBy.mockRestore(); scrollTo.mockRestore() })
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    const panel = configPanelOf(harness.app)
    if (panel === undefined) throw new Error('configuration panel was not presented')
    scrollBy.mockClear()
    scrollTo.mockClear()

    harness.terminal.headless.press('\u001b[6~')
    expect(Reflect.get(panel, 'cursor')).toBeGreaterThan(0)
    harness.terminal.headless.press('\u001b[5~')
    expect(Reflect.get(panel, 'cursor')).toBe(0)
    expect(scrollBy).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalled()

    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)
    await submitLine(harness, '/help')
    await waitForDock(harness, copy.panel.help)
    scrollBy.mockClear()
    scrollTo.mockClear()

    harness.terminal.headless.press('\u001b[6~')
    expect(dockText(harness.app)).toContain('↑ ')
    expect(scrollBy).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('exposes and closes each active dock surface adapter', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm({ defaultEffort: ReasoningEffortId('low') }),
    })
    harness.start()
    await harness.awaitStarted()
    const activeSurface = (): DockSurface | undefined =>
      (privateValue(harness.app, 'activeDockSurface') as () => DockSurface | undefined).call(harness.app)

    expect(activeSurface()).toBeUndefined()

    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    const configSurface = activeSurface()
    expect(configSurface?.component).toBe(configPanelOf(harness.app))
    expect(configSurface?.consumeAll).toBe(true)
    configSurface?.close()
    await awaitDockClosed(harness)
    expect(configPanelOf(harness.app)).toBeUndefined()

    await submitLine(harness, '/effort')
    await waitForDock(harness, copy.model.effortTitle)
    const listSurface = activeSurface()
    expect(listSurface?.component).toBe(bottomListOf(harness.app))
    expect(listSurface?.consumeAll).toBe(true)
    listSurface?.close()
    await awaitDockClosed(harness)
    expect(bottomListOf(harness.app).active).toBe(false)

    harness.terminal.headless.press('/')
    await waitForDock(harness, copy.completion.title)
    const completionSurface = activeSurface()
    expect(completionSurface?.component).toBe(completionOf(harness.app))
    expect(completionSurface?.consumeAll).toBe(false)
    completionSurface?.close()
    await awaitDockClosed(harness)
    expect(completionOf(harness.app).active).toBe(false)
  })

  it('leaves printable keys to the editor while completion filters', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.terminal.headless.press('/')
    await waitForDock(harness, copy.completion.title)

    harness.terminal.headless.press('h')
    harness.terminal.headless.press('e')

    await vi.waitFor(() => {
      expect(editorOf(harness.app).getText()).toBe('/he')
      expect(dockText(harness.app)).toContain('help')
      expect(dockText(harness.app)).not.toContain('status')
    })
  })

  it('routes dock keys through the input listener on the main-screen renderer', async () => {
    const harness = await lifecycleHarness({
      mainScreen: true,
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm({ defaultEffort: ReasoningEffortId('low') }),
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/help')
    await waitForDock(harness, copy.panel.help)
    harness.terminal.headless.press('\u001b[B')
    expect(bottomOf(harness.app).active).toBe(true)
    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    const panel = configPanelOf(harness.app)
    if (panel === undefined) throw new Error('configuration panel was not presented')
    harness.terminal.headless.press('\u001b[B')
    expect(Reflect.get(panel, 'cursor')).toBe(1)
    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    await submitLine(harness, '/effort')
    await waitForDock(harness, copy.model.effortTitle)
    harness.terminal.headless.press('\u001b[B')
    expect(dockText(harness.app)).toContain('\u276f High')
    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    harness.terminal.headless.press('/')
    await waitForDock(harness, copy.completion.title)
    const completion = completionOf(harness.app)
    harness.terminal.headless.press('\u001b[B')
    expect(Reflect.get(completion, 'index')).toBe(1)
    harness.terminal.headless.press('h')
    harness.terminal.headless.press('e')
    await vi.waitFor(() => { expect(dockText(harness.app)).toContain('help') })
    expect(editorOf(harness.app).getText()).toBe('/he')
    harness.terminal.headless.press('\u001b')
    await awaitDockClosed(harness)
  })
})

describe('TerminalApp /preset', () => {
  it('opens the dock chooser with localized rows, descriptions, and the current marker', async () => {
    const presets = agentPresetsDouble()
    const harness = await lifecycleHarness({
      services: { agentPresets: presets.service },
      values: { agentPreset: 'standard' },
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/preset')
    await waitForDock(harness, copy.prompt.presetTitle)

    const dock = dockText(harness.app)
    expect(dock).toContain(copy.prompt.presetTitle)
    expect(dock).toContain('Standard')
    expect(dock).toContain('PTC')
    expect(dock).toContain('Minimal')
    expect(dock).toContain('Cordis')
    expect(dock).toContain(copy.prompt.presetCurrent)
    expect(dock).toContain(copy.preset.descriptions.ptc)
    expect(dock).toContain(copy.prompt.selectHint)
    expect(presets.selected).toEqual([])
  })

  it('selects the highlighted preset once and reports the localized notice', async () => {
    const presets = agentPresetsDouble()
    const harness = await lifecycleHarness({
      services: { agentPresets: presets.service },
      values: { agentPreset: 'standard' },
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/preset')
    await waitForDock(harness, copy.prompt.presetTitle)
    const list = bottomListOf(harness.app)
    expect(Reflect.get(list, 'index')).toBe(0)

    harness.terminal.headless.press('\u001b[B')
    expect(Reflect.get(list, 'index')).toBe(1)
    expect(dockText(harness.app)).toContain('❯ PTC')

    harness.terminal.headless.press('\r')

    await vi.waitFor(() => { expect(presets.selected).toHaveLength(1) })
    expect(presets.selected[0]?.id).toBe('ptc')
    expect(presets.selected[0]?.agent).toBe(harness.agent.agent)
    await awaitDockClosed(harness)
    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.preset.selected(copy.preset.names['ptc'] ?? 'ptc'))
    })
  })

  it('applies an explicit preset identity', async () => {
    const presets = agentPresetsDouble()
    const harness = await lifecycleHarness({
      services: { agentPresets: presets.service },
      values: { agentPreset: 'standard' },
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/preset minimal')

    await vi.waitFor(() => { expect(presets.selected).toEqual([{ agent: harness.agent.agent, id: 'minimal' }]) })
    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.preset.selected(copy.preset.names['minimal'] ?? 'minimal'))
    })
    expect(bottomOf(harness.app).active).toBe(false)
  })

  it('reports an already-current preset without calling the registry', async () => {
    const presets = agentPresetsDouble()
    const harness = await lifecycleHarness({
      services: { agentPresets: presets.service },
      values: { agentPreset: 'standard' },
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/preset standard')

    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.preset.selected(copy.preset.names['standard'] ?? 'standard'))
    })
    expect(presets.selected).toEqual([])
  })

  it('locks switching after the Session started', async () => {
    const presets = agentPresetsDouble()
    const harness = await lifecycleHarness({
      services: { agentPresets: presets.service },
      values: { agentPreset: 'standard', turnBoundary: { openTurnStartSeq: 2, lastTurn: 1 } },
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/preset ptc')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.preset.locked) })
    expect(presets.selected).toEqual([])
  })

  it('locks switching when an earlier turn ended without an open one', async () => {
    const presets = agentPresetsDouble()
    const harness = await lifecycleHarness({
      services: { agentPresets: presets.service },
      values: { agentPreset: 'standard', turnBoundary: { openTurnStartSeq: null, lastTurn: 1 } },
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/preset ptc')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.preset.locked) })
    expect(presets.selected).toEqual([])
  })

  it('reports the unavailable notice without the preset service', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/preset')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.preset.unavailable) })
    expect(bottomOf(harness.app).active).toBe(false)
  })

  it('reports the unavailable notice without a live Agent', async () => {
    const presets = agentPresetsDouble()
    const harness = await lifecycleHarness({ services: { agentPresets: presets.service } })
    harness.start()
    await harness.awaitStarted()
    Reflect.set(harness.app, 'agent', undefined)

    await submitLine(harness, '/preset')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.preset.unavailable) })
    expect(presets.selected).toEqual([])
  })

  it('reports a failed selection with the error message', async () => {
    const presets = agentPresetsDouble({ selectError: new Error('locked elsewhere') })
    const harness = await lifecycleHarness({
      services: { agentPresets: presets.service },
      values: { agentPreset: 'standard' },
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/preset ptc')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.preset.failed('locked elsewhere')) })
  })

  it('reports a failed selection thrown as a non-Error', async () => {
    const presets = agentPresetsDouble({ selectError: 'not an error' })
    const harness = await lifecycleHarness({
      services: { agentPresets: presets.service },
      values: { agentPreset: 'standard' },
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/preset ptc')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.preset.failed('not an error')) })
  })

  it('cancels the chooser without selecting', async () => {
    const presets = agentPresetsDouble()
    const harness = await lifecycleHarness({
      services: { agentPresets: presets.service },
      values: { agentPreset: 'standard' },
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/preset')
    await waitForDock(harness, copy.prompt.presetTitle)

    harness.terminal.headless.press('\u001b')

    await awaitDockClosed(harness)
    expect(presets.selected).toEqual([])
  })

  it('honors registry names and descriptions, falling back to the row id', async () => {
    const presets = agentPresetsDouble({
      rows: [
        { id: 'standard', name: 'Standard' },
        { id: 'mystery', name: 'Mystery', description: 'Registry description.' },
        { id: 'plain' },
      ],
    })
    const harness = await lifecycleHarness({
      services: { agentPresets: presets.service },
      values: { agentPreset: 'standard' },
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/preset')
    await waitForDock(harness, copy.prompt.presetTitle)
    const dock = dockText(harness.app)
    expect(dock).toContain(copy.prompt.presetCurrent)
    expect(dock).toContain('Mystery')
    expect(dock).toContain('Registry description.')
    expect(dock).toContain('plain')
    expect(dock).toContain('plain')
    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    await submitLine(harness, '/preset mystery')
    await vi.waitFor(() => { expect(presets.selected).toEqual([{ agent: harness.agent.agent, id: 'mystery' }]) })
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.preset.selected('mystery')) })
  })

  it('treats presets as unavailable while the agent or projection service is gone', async () => {
    const presets = agentPresetsDouble()
    const harness = await lifecycleHarness({
      services: { agentPresets: presets.service, sessionProjections: undefined },
    })
    harness.start()
    await harness.awaitStarted()
    const presetId = privateValue(harness.app, 'presetId') as () => string | undefined
    const selectPreset = privateValue(harness.app, 'selectPreset') as (id: string) => Promise<void>

    expect(presetId.call(harness.app)).toBeUndefined()

    Reflect.set(harness.app, 'agent', undefined)
    expect(presetId.call(harness.app)).toBeUndefined()
    await selectPreset.call(harness.app, 'ptc')
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.preset.unavailable) })
    expect(presets.selected).toEqual([])
  })

  it('renders the status row defensively when the projection clears between reads', async () => {
    const base = projectionsDouble({ agentPreset: 'ptc' })
    let reads = 0
    const projections = {
      ...base.service,
      stateOf: (session: Parameters<typeof base.service.stateOf>[0], key: string): unknown => {
        if (key !== 'agentPreset') return base.service.stateOf(session, key)
        reads += 1
        return reads === 1 ? 'ptc' : undefined
      },
    }
    const harness = await lifecycleHarness({ services: { sessionProjections: projections } })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/status')
    await waitForDock(harness, copy.panel.status)

    expect(dockText(harness.app)).toContain(`${copy.statusPanel.preset.padEnd(12, ' ')} `)
  })

  it('shows the localized preset in the status panel and falls back to not available', async () => {
    const harness = await lifecycleHarness({
      services: { agentPresets: agentPresetsDouble().service },
      values: { agentPreset: 'ptc' },
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/status')
    await waitForDock(harness, copy.panel.status)
    const row = `${copy.statusPanel.preset.padEnd(12, ' ')} ${copy.preset.names['ptc'] ?? 'ptc'}`
    expect(dockText(harness.app)).toContain(row)
    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    const bare = await lifecycleHarness()
    bare.start()
    await bare.awaitStarted()
    await submitLine(bare, '/status')
    await waitForDock(bare, copy.panel.status)
    const missing = `${copy.statusPanel.preset.padEnd(12, ' ')} ${copy.statusPanel.notAvailable}`
    expect(dockText(bare.app)).toContain(missing)
  })

  it('lists the preset command in help and slash completion', async () => {
    const harness = await lifecycleHarness({ services: { agentPresets: agentPresetsDouble().service } })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/help')
    await waitForDock(harness, copy.panel.help)
    for (let page = 0; page < 3; page += 1) harness.terminal.headless.press('\u001b[6~')
    expect(dockText(harness.app)).toContain(`/${'preset'.padEnd(18, ' ')} ${copy.commands.preset}`)
    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    for (const key of '/pres') harness.terminal.headless.press(key)
    await waitForDock(harness, copy.completion.title)
    expect(dockText(harness.app)).toContain(copy.commands.preset)
  })
})

describe('TerminalApp card modes', () => {
  it('cycles the tool-card mode through the command with a notice each time', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript

    expect(transcript.cardsMode()).toBe('collapsed')
    await submitLine(harness, '/cards')
    await vi.waitFor(() => { expect(transcript.cardsMode()).toBe('expanded') })
    expect(harness.transcriptText()).toContain(copy.cards.changed(copy.cards.levels.expanded))

    await submitLine(harness, '/cards')
    await vi.waitFor(() => { expect(transcript.cardsMode()).toBe('hidden') })
    expect(harness.transcriptText()).toContain(copy.cards.changed(copy.cards.levels.hidden))

    await submitLine(harness, '/cards')
    await vi.waitFor(() => { expect(transcript.cardsMode()).toBe('collapsed') })
    expect(harness.transcriptText()).toContain(copy.cards.changed(copy.cards.levels.collapsed))
  })

  it('sets explicit mode ids and localized mode names', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript

    submitCommand(harness, '/cards hidden')
    await vi.waitFor(() => { expect(transcript.cardsMode()).toBe('hidden') })
    expect(harness.transcriptText()).toContain(copy.cards.changed(copy.cards.levels.hidden))

    submitCommand(harness, '/cards  EXPANDED ')
    await vi.waitFor(() => { expect(transcript.cardsMode()).toBe('expanded') })

    submitCommand(harness, '/cards collapsed')
    await vi.waitFor(() => { expect(transcript.cardsMode()).toBe('collapsed') })
  })

  it('parses the localized mode names under the Chinese locale', async () => {
    setCopyLocale('zh')
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript

    submitCommand(harness, '/cards 隐藏')

    await vi.waitFor(() => { expect(transcript.cardsMode()).toBe('hidden') })
    expect(harness.transcriptText()).toContain(chinese.cards.changed(chinese.cards.levels.hidden))
  })

  it('reports the available modes for an unknown argument without changing the mode', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript

    submitCommand(harness, '/cards turbo')

    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.cards.available('collapsed, expanded, hidden'))
    })
    expect(transcript.cardsMode()).toBe('collapsed')
  })

  it('treats a blank argument as a cycle request', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript

    submitCommand(harness, '/cards    ')

    await vi.waitFor(() => { expect(transcript.cardsMode()).toBe('expanded') })
  })

  it('ignores a card-mode change before the transcript exists', async () => {
    const harness = await lifecycleHarness()
    const setCardsMode = privateValue(harness.app, 'setCardsMode') as (argument: string | undefined) => void

    expect(() => { setCardsMode.call(harness.app, 'hidden') }).not.toThrow()
    expect(() => { setCardsMode.call(harness.app, undefined) }).not.toThrow()
  })

  it('shows the tool-card row in the status panel', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/cards expanded')

    await submitLine(harness, '/status')
    await waitForDock(harness, copy.panel.status)

    const row = `${copy.statusPanel.cards.padEnd(12, ' ')} ${copy.cards.levels.expanded}`
    expect(dockText(harness.app)).toContain(row)
  })

  it('completes and runs a card-mode argument through real input', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript

    for (const key of '/cards ex') harness.terminal.headless.press(key)
    await waitForDock(harness, copy.completion.title)
    expect(dockText(harness.app)).toContain(copy.cards.levels.expanded)

    harness.terminal.headless.press('\t')

    await vi.waitFor(() => { expect(editorOf(harness.app).getText()).toContain('expanded') })
    harness.terminal.headless.press('\r')

    await vi.waitFor(() => { expect(transcript.cardsMode()).toBe('expanded') })
    await vi.waitFor(() => {
      expect(harness.transcriptText()).toContain(copy.cards.changed(copy.cards.levels.expanded))
    })
    expect(editorOf(harness.app).getText()).toBe('')
  })
})

describe('TerminalApp queue dock', () => {
  it('opens the dock with the queued messages and cancels on Escape', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [queuedMessage('first message'), queuedMessage('second message')],
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/queue')
    await waitForDock(harness, copy.queue.title)

    const dock = dockText(harness.app)
    expect(dock).toContain(copy.queue.title)
    expect(dock).toContain('1. first message')
    expect(dock).toContain('2. second message')
    expect(dock).toContain(copy.queue.hint)
    expect(harness.agent.agent.inbox.nextTurn).toHaveLength(2)

    harness.terminal.headless.press('\u001b')

    await awaitDockClosed(harness)
    expect(harness.agent.removed).toEqual([])
    expect(harness.agent.steered).toEqual([])
  })

  it('steers the selected row and keeps the remaining queue visible', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [queuedMessage('first message'), queuedMessage('second message')],
    })
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')
    await submitLine(harness, '/queue')
    await waitForDock(harness, copy.queue.title)
    const secondId = String(harness.agent.agent.inbox.nextTurn[1]?.id)

    harness.terminal.headless.press('\u001b[B')
    expect(dockText(harness.app)).toContain('❯ 2. second message')
    harness.terminal.headless.press('\r')

    await vi.waitFor(() => { expect(harness.agent.steered).toEqual(['second message']) })
    expect(harness.agent.removed).toEqual([secondId])
    expect(harness.agent.agent.inbox.nextTurn).toHaveLength(1)
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.queue.steered) })
    expect(dockText(harness.app)).toContain('1. first message')
    expect(bottomOf(harness.app).active).toBe(true)
  })

  it('moves the selected row back into the composer and closes the dock', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [queuedMessage('edit me')],
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/queue')
    await waitForDock(harness, copy.queue.title)

    harness.terminal.headless.press('e')

    await awaitDockClosed(harness)
    expect(editorOf(harness.app).getText()).toBe('edit me')
    expect(harness.agent.removed).toHaveLength(1)
    expect(harness.agent.agent.inbox.nextTurn).toEqual([])
    expect(harness.transcriptText()).toContain(copy.queue.editMoved)
  })

  it('removes rows with x and Delete and closes after the queue drains', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [queuedMessage('one'), queuedMessage('two')],
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/queue')
    await waitForDock(harness, copy.queue.title)

    harness.terminal.headless.press('x')
    await vi.waitFor(() => { expect(harness.agent.removed).toHaveLength(1) })
    expect(harness.transcriptText()).toContain(copy.queue.removed)
    expect(bottomOf(harness.app).active).toBe(true)

    harness.terminal.headless.press('\u001b[3~')

    await awaitDockClosed(harness)
    expect(harness.agent.removed).toHaveLength(2)
    expect(harness.agent.agent.inbox.nextTurn).toEqual([])
  })

  it('refuses to steer while the agent is idle', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [queuedMessage('waiting')],
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/queue')
    await waitForDock(harness, copy.queue.title)

    harness.terminal.headless.press('\r')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.queue.steerUnavailable) })
    expect(harness.agent.removed).toEqual([])
    expect(harness.agent.steered).toEqual([])
    expect(bottomOf(harness.app).active).toBe(true)
  })

  it('refreshes the rows when a queued identity is missing', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [queuedMessage('still here')],
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/queue')
    await waitForDock(harness, copy.queue.title)
    const steerQueued = privateValue(harness.app, 'steerQueued') as (id: string) => void
    const editQueued = privateValue(harness.app, 'editQueued') as (id: string) => void
    const removeQueued = privateValue(harness.app, 'removeQueued') as (id: string) => void

    steerQueued.call(harness.app, 'missing')
    editQueued.call(harness.app, 'missing')
    removeQueued.call(harness.app, 'missing')

    expect(harness.agent.removed).toEqual([])
    expect(harness.agent.steered).toEqual([])
    expect(bottomOf(harness.app).active).toBe(true)
    expect(dockText(harness.app)).toContain('1. still here')
  })

  it('extracts only text when content changes between the guard and the edit', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [queuedMessage('placeholder')],
    })
    harness.start()
    await harness.awaitStarted()
    const message = queuedMessage('placeholder')
    let reads = 0
    const drifting = {
      ...message,
      get content() {
        reads += 1
        return reads === 1
          ? [{ type: 'text', text: 'recovered text' }]
          : [{ type: 'text', text: 'recovered text' }, { type: 'image', attachment: { attachmentId: AttachmentId('drift') } }]
      },
    }
    const removed: string[] = []
    const original = harness.agent.agent
    Reflect.set(harness.app, 'agent', {
      ...original,
      inbox: {
        ...original.inbox,
        nextTurn: [drifting],
        remove: (id: string) => { removed.push(id); return true },
      },
    })
    const editQueued = privateValue(harness.app, 'editQueued') as (id: string) => void

    editQueued.call(harness.app, String(drifting.id))

    expect(editorOf(harness.app).getText()).toBe('recovered text')
    expect(harness.transcriptText()).toContain(copy.queue.editMoved)
    expect(removed).toEqual([String(drifting.id)])
  })

  it('reports non-text rows in the dock and refuses to edit them', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [
        queuedMessage('text row'),
        createUserMessage({
          content: [{
            type: 'image',
            attachment: {
              attachmentId: AttachmentId('queued-image'),
              mediaType: 'image/png',
              bytes: 3,
              width: 1,
              height: 1,
            },
          }],
          source: { kind: 'user' },
        }),
      ],
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/queue')
    await waitForDock(harness, copy.queue.title)

    const dock = dockText(harness.app)
    expect(dock).toContain(copy.queue.nonText)
    expect(dock).toContain('2.')

    harness.terminal.headless.press('\u001b[B')
    harness.terminal.headless.press('e')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.queue.editUnsupported) })
    expect(harness.agent.removed).toEqual([])
    expect(editorOf(harness.app).getText()).toBe('')
    expect(bottomOf(harness.app).active).toBe(true)
  })

  it('steers every queued message from an empty composer with Ctrl+Enter', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [queuedMessage('one'), queuedMessage('two')],
    })
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')

    harness.terminal.headless.press('\u001b[13;5u')

    await vi.waitFor(() => { expect(harness.agent.steered).toEqual(['one', 'two']) })
    expect(harness.transcriptText()).toContain(copy.queue.steeredAll(2))
    expect(harness.agent.agent.inbox.nextTurn).toEqual([])
  })

  it('reports Ctrl+Enter on an empty composer without a queue', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')

    harness.terminal.headless.press('\u001b[13;5u')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.queue.empty) })
    expect(harness.agent.steered).toEqual([])
  })

  it('leaves Ctrl+Enter inert while idle and without a queue', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [queuedMessage('idle queued')],
    })
    harness.start()
    await harness.awaitStarted()

    harness.terminal.headless.press('\u001b[13;5u')

    await Promise.resolve()
    expect(harness.agent.steered).toEqual([])
    expect(harness.agent.followups).toEqual([])
    expect(harness.agent.removed).toEqual([])
    expect(editorOf(harness.app).getText()).toBe('')
    expect(harness.exit.codes).toEqual([])
  })

  it.each([
    { busyEnter: 'queue' as const, expected: 'steer' as const },
    { busyEnter: 'steer' as const, expected: 'queue' as const },
  ])('submits with the opposite delivery ($busyEnter) from Ctrl+Enter', async ({ busyEnter, expected }) => {
    const harness = await lifecycleHarness({ busyEnter })
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')
    for (const key of 'composed') harness.terminal.headless.press(key)

    harness.terminal.headless.press('\u001b[13;5u')

    await vi.waitFor(() => { expect(editorOf(harness.app).getText()).toBe('') })
    if (expected === 'steer') {
      await vi.waitFor(() => { expect(harness.agent.steered).toEqual(['composed']) })
      expect(harness.agent.followups).toEqual([])
      expect(harness.transcriptText()).toContain(copy.queue.steered)
    } else {
      await vi.waitFor(() => { expect(harness.agent.followups).toEqual(['composed']) })
      expect(harness.agent.steered).toEqual([])
      expect(harness.transcriptText()).toContain(copy.queue.queued)
    }
  })

  it('plain Enter queues under the default busy-Enter configuration', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')

    await submitLine(harness, 'queued while busy')

    await vi.waitFor(() => { expect(harness.agent.followups).toEqual(['queued while busy']) })
    expect(harness.agent.steered).toEqual([])
    expect(harness.transcriptText()).toContain(copy.queue.queued)
  })

  it('plain Enter steers when busy-Enter is steer', async () => {
    const harness = await lifecycleHarness({ busyEnter: 'steer' })
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')

    await submitLine(harness, 'steer while busy')

    await vi.waitFor(() => { expect(harness.agent.steered).toEqual(['steer while busy']) })
    expect(harness.agent.followups).toEqual([])
    expect(harness.transcriptText()).toContain(copy.queue.steered)
  })

  it('surfaces the busy-Enter configuration in the display tab', async () => {
    const harness = await lifecycleHarness({ busyEnter: 'steer' })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    const panel = configPanelOf(harness.app)
    if (panel === undefined) throw new Error('configuration panel was not presented')

    focusConfigRow(panel, 'display', 'display.busyEnter')

    expect(dockText(harness.app)).toContain('busyEnter')
    expect(dockText(harness.app)).toContain('steer')
  })

  it('keeps the pending strip visible with the queue-edit hint', async () => {
    const harness = await lifecycleHarness({
      values: { inbox: { 'next-step': [], 'next-turn': [queuedMessage('pending row')] } },
    })
    harness.start()
    await harness.awaitStarted()

    await waitForScreen(harness.terminal.headless, copy.pending.queued(1))
    expect((await screenLines(harness.terminal.headless)).some(line => line.includes(copy.pending.queueHint))).toBe(true)
  })
})

describe('TerminalApp /steer command', () => {
  it('steers an explicit prompt and reports its expansion notices', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')
    Reflect.set(harness.app, 'expandPrompt', async () => ({
      content: [{ type: 'text', text: 'focus on tests' }],
      notices: ['steer notice'],
    }))

    await submitLine(harness, '/steer focus on tests')

    await vi.waitFor(() => { expect(harness.agent.steered).toEqual(['focus on tests']) })
    expect(harness.transcriptText()).toContain('steer notice')
    expect(harness.transcriptText()).toContain(copy.queue.steered)
  })

  it('applies the queue policy to an explicit /steer prompt while idle', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/steer wait for me')

    await vi.waitFor(() => { expect(harness.agent.followups).toEqual(['wait for me']) })
    expect(harness.transcriptText()).toContain(copy.queue.queued)
    expect(harness.agent.steered).toEqual([])
  })

  it('steers every queued message from a bare /steer while running', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [queuedMessage('one'), queuedMessage('two')],
    })
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')

    await submitLine(harness, '/steer')

    await vi.waitFor(() => { expect(harness.agent.steered).toEqual(['one', 'two']) })
    expect(harness.transcriptText()).toContain(copy.queue.steeredAll(2))
    expect(harness.agent.agent.inbox.nextTurn).toEqual([])
  })

  it('reports an empty queue from a bare /steer', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')

    await submitLine(harness, '/steer')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.queue.empty) })
  })

  it('reports steering unavailable from a bare /steer while idle', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [queuedMessage('idle row')],
    })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/steer')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.queue.steerUnavailable) })
    expect(harness.agent.steered).toEqual([])
  })

  it('reports an explicit steer without a live agent', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const steerPrompt = privateValue(harness.app, 'steerPrompt') as (argument: string | undefined) => Promise<void>
    Reflect.set(harness.app, 'agent', undefined)

    await steerPrompt.call(harness.app, 'hello')

    expect(harness.transcriptText()).toContain(copy.commands.agentNotReady)
  })

  it.each([
    ['an Error', new Error('steer expand failed'), 'steer expand failed'],
    ['a non-Error', 'steer expand failed', 'steer expand failed'],
  ])('reports an expansion failure thrown as %s', async (_label, error, message) => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const expand = vi.fn(async () => { throw error })
    Reflect.set(harness.app, 'expandPrompt', expand)

    await submitLine(harness, '/steer remember')

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.commands.promptFailed(message)) })
  })

  it('closes the queue dock through Ctrl+C', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [queuedMessage('one')],
    })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/queue')
    await waitForDock(harness, copy.queue.title)

    harness.terminal.headless.press('\x03')

    await awaitDockClosed(harness)
    expect(harness.exit.codes).toEqual([])
  })

  it('ignores queue helpers before the terminal starts', async () => {
    const harness = await lifecycleHarness()
    const member = (name: string): unknown => privateValue(harness.app, name)
    const refresh = member('refreshQueuePanel') as () => void
    const open = member('openQueuePanel') as () => void
    const close = member('closeQueuePanel') as () => void
    const steer = member('steerQueued') as (id: string) => void
    const edit = member('editQueued') as (id: string) => void
    const remove = member('removeQueued') as (id: string) => void
    const steerAll = member('steerAllQueued') as () => void
    const queued = member('queuedMessages') as () => readonly UserMessage[]

    expect(() => {
      refresh.call(harness.app)
      open.call(harness.app)
      close.call(harness.app)
      steer.call(harness.app, 'missing')
      edit.call(harness.app, 'missing')
      remove.call(harness.app, 'missing')
      steerAll.call(harness.app)
    }).not.toThrow()
    expect(queued.call(harness.app)).toEqual([])
  })

  it('handles Ctrl+Enter before the editor exists', async () => {
    const harness = await lifecycleHarness({
      agentOptions: { provider: 'alpha', model: 'm-1' },
      queued: [queuedMessage('queued row')],
    })
    harness.start()
    await harness.awaitStarted()
    harness.agent.setStatus('running')
    Reflect.set(harness.app, 'editor', undefined)

    harness.terminal.headless.press('\u001b[13;5u')

    await vi.waitFor(() => { expect(harness.agent.steered).toEqual(['queued row']) })
    expect(harness.transcriptText()).toContain(copy.queue.steeredAll(1))
  })

  it('reports the agent disappearing while the steer prompt expands', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    let resolveExpansion!: (value: { content: ContentBlock[]; notices: string[] }) => void
    Reflect.set(harness.app, 'expandPrompt', () => new Promise((resolve) => { resolveExpansion = resolve }))

    await submitLine(harness, '/steer remember')
    Reflect.set(harness.app, 'agent', undefined)
    resolveExpansion({ content: [{ type: 'text', text: 'remember' }], notices: [] })

    await vi.waitFor(() => { expect(harness.transcriptText()).toContain(copy.commands.agentNotReady) })
  })
})

describe('TerminalApp contribution seam', () => {
  it('rejects duplicate contributed command names before startup', async () => {
    const harness = await lifecycleHarness()

    harness.app.registerCommand({ name: 'plug', description: 'first', run: () => {} })
    expect(() => harness.app.registerCommand({ name: 'plug', description: 'second', run: () => {} }))
      .toThrow('terminal-ui: command "/plug" is already registered')
  })

  /** One contributed strip component and its render recorder. */
  function contributedStrip(text: string): { component: Component; renders: number[] } {
    const renders: number[] = []
    return {
      component: {
        render: (width) => { renders.push(width); return [` ${text}`] },
        invalidate: () => {},
      },
      renders,
    }
  }

  it('provides the seam through the plugin and disposes it with the context', async () => {
    const harness = await lifecycleHarness()
    const provided = harness.ctx.get('terminalUi')

    expect(provided).toBeUndefined()

    harness.start()
    await harness.awaitStarted()

    // The lifecycle harness constructs TerminalApp directly, so the seam is
    // exercised through its public methods; index.spec covers ctx.terminalUi.
    expect(typeof harness.app.registerStrip).toBe('function')
    expect(typeof harness.app.registerCommand).toBe('function')
    expect(typeof harness.app.openDock).toBe('function')
    expect(typeof harness.app.closeDock).toBe('function')
    expect(typeof harness.app.setEditorText).toBe('function')
    expect(typeof harness.app.notice).toBe('function')
    expect(typeof harness.app.paletteTable).toBe('object')
    expect(harness.app.currentAgent()).toBeDefined()
    expect(() => { harness.app.requestRender() }).not.toThrow()
  })

  it('renders contributed strips above the pending strip and composer in registration order', async () => {
    const harness = await lifecycleHarness({
      values: { inbox: { 'next-step': [], 'next-turn': [queuedMessage('pending row')] } },
    })
    harness.start()
    await harness.awaitStarted()
    const first = contributedStrip('first strip')
    const second = contributedStrip('second strip')
    const disposeFirst = harness.app.registerStrip(first.component)
    const disposeSecond = harness.app.registerStrip(second.component)
    await waitForScreen(harness.terminal.headless, 'second strip')

    const lines = await screenLines(harness.terminal.headless)
    const firstLine = lines.findIndex(line => line.includes('first strip'))
    const secondLine = lines.findIndex(line => line.includes('second strip'))
    const pending = lines.findIndex(line => line.includes(copy.pending.queued(1)))
    const composer = lines.findIndex(line => line.includes('dsh>'))
    expect(firstLine).toBeGreaterThanOrEqual(0)
    expect(firstLine).toBeLessThan(secondLine)
    expect(secondLine).toBeLessThan(pending)
    expect(pending).toBeLessThan(composer)

    disposeFirst()
    disposeSecond()
    await vi.waitFor(async () => {
      expect((await screenLines(harness.terminal.headless)).some(line => line.includes('first strip'))).toBe(false)
    })
    disposeFirst()
    disposeSecond()
  })

  it('queues a strip registered before startup and flushes it when the app starts', async () => {
    const harness = await lifecycleHarness()
    const plugin = contributedStrip('early strip')
    harness.app.registerStrip(plugin.component)
    harness.app.start()
    await harness.awaitStarted()

    await waitForScreen(harness.terminal.headless, 'early strip')
  })

  it('registers contributed commands before startup and flushes them at startup', async () => {
    const harness = await lifecycleHarness()
    const runs: (string | undefined)[] = []
    const dispose = harness.app.registerCommand({
      name: 'plug',
      description: 'Plugin command',
      argumentHint: '<value>',
      getArgumentCompletions: prefix => prefix === 'x' ? [{ value: 'x1', label: 'X1' }] : [],
      run: (argument) => { runs.push(argument) },
    })
    harness.start()
    await harness.awaitStarted()
    const composer = privateValue(harness.app, 'composer') as Composer

    const listed = composer.slashCommands().find(command => command.name === 'plug')
    expect(listed).toMatchObject({ name: 'plug', description: 'Plugin command', argumentHint: '<value>' })
    expect(listed?.getArgumentCompletions?.('x')).toEqual([{ value: 'x1', label: 'X1' }])
    expect(composer.helpLines()).toContain('  /plug               Plugin command')

    submitCommand(harness, '/plug   trimmed value ')

    expect(runs).toEqual(['trimmed value'])
    // The pre-start disposer keeps working after the startup flush.
    dispose()
    expect(composer.slashCommands().some(command => command.name === 'plug')).toBe(false)
  })

  it('drops a pre-startup command through its disposer before the flush', async () => {
    const harness = await lifecycleHarness()
    const dispose = harness.app.registerCommand({ name: 'gone', description: 'Gone', run: () => {} })
    dispose()
    dispose()
    harness.start()
    await harness.awaitStarted()
    const composer = privateValue(harness.app, 'composer') as Composer

    expect(composer.slashCommands().some(command => command.name === 'gone')).toBe(false)
  })

  it('rejects duplicate contributed command names after startup', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    harness.app.registerCommand({ name: 'plug', description: 'First', run: () => {} })

    expect(() => harness.app.registerCommand({ name: 'plug', description: 'Second', run: () => {} }))
      .toThrow('terminal-ui: command "/plug" is already registered')
    expect(() => harness.app.registerCommand({ name: 'help', description: 'Local', run: () => {} }))
      .toThrow('terminal-ui: command "/help" is already registered')
  })

  it('routes contribution dock input and leaves the composer untouched', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const keys: string[] = []
    let closes = 0
    const dock = {
      render: () => ['contributed dock'],
      invalidate: () => {},
      handleInput: (data: string) => { keys.push(data) },
    }

    harness.app.openDock(dock, () => { closes += 1 })
    await waitForDock(harness, 'contributed dock')
    for (const key of 'abc') harness.terminal.headless.press(key)

    expect(keys).toEqual(['a', 'b', 'c'])
    expect(editorOf(harness.app).getText()).toBe('')

    harness.app.closeDock()
    await awaitDockClosed(harness)
    expect(closes).toBe(0)

    harness.app.openDock(dock, () => { closes += 1; harness.app.closeDock() })
    await waitForDock(harness, 'contributed dock')
    harness.terminal.headless.press('\x03')

    await awaitDockClosed(harness)
    expect(closes).toBe(1)
    expect(harness.exit.codes).toEqual([])
  })

  it('forwards editor text and transcript notices through the seam', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const renders = harness.terminal.requestRender.mock.calls.length

    harness.app.setEditorText('seam text')
    harness.app.notice('seam notice')

    expect(editorOf(harness.app).getText()).toBe('seam text')
    expect(harness.terminal.requestRender.mock.calls.length).toBeGreaterThan(renders)
    await vi.waitFor(() => { expect(harness.transcriptText()).toContain('seam notice') })
  })

  it('tolerates seam calls before startup', async () => {
    const harness = await lifecycleHarness()
    const plugin = contributedStrip('pre-start')
    const dock = { render: () => ['pre-start dock'], invalidate: () => {}, handleInput: () => {} }

    expect(() => {
      harness.app.registerStrip(plugin.component)()
      harness.app.openDock(dock, () => {})
      harness.app.closeDock()
      harness.app.setEditorText('early')
      harness.app.notice('early notice')
    }).not.toThrow()

    harness.start()
    await harness.awaitStarted()
    await waitForScreen(harness.terminal.headless, 'dsh>')
  })
})

describe('TerminalApp transcript scrollback', () => {
  /** One fake terminal session recording viewport operations. */
  interface ScrollState {
    top: number
    following: boolean
    readonly by: number[]
    bottoms: number
  }

  /** One scrollback scenario. */
  interface ScrollHarness {
    readonly harness: LifecycleHarness
    readonly state: ScrollState
    readonly transcript: TerminalTranscript
    readonly restore: () => void
  }

  /**
   * Install one fake scroll session over a started application.
   * @param options - harness options.
   * @param state - initial viewport state.
   * @returns the scenario.
   */
  async function scrollHarness(
    options: Parameters<typeof lifecycleHarness>[0],
    state: Partial<ScrollState> = {},
  ): Promise<ScrollHarness> {
    const harness = await lifecycleHarness(options)
    harness.start()
    await harness.awaitStarted()
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript
    const viewport: ScrollState = {
      top: state.top ?? 0,
      following: state.following ?? true,
      by: [],
      bottoms: 0,
    }
    const real = harness.terminal.session
    const fake: TerminalSession = {
      ...real,
      scrollTop: () => viewport.top,
      scrollBy: (lines) => {
        viewport.by.push(lines)
        viewport.top = Math.max(0, viewport.top + lines)
      },
      scrollToBottom: () => {
        viewport.bottoms += 1
        viewport.top = 0
      },
      isFollowingEnd: () => viewport.following,
    }
    Reflect.set(harness.app, 'terminal', fake)
    return {
      harness,
      state: viewport,
      transcript,
      restore: () => { Reflect.set(harness.app, 'terminal', real) },
    }
  }

  /**
   * Queue enough notices to archive older blocks.
   * @param scenario - the scrollback scenario.
   * @param count - total notices.
   */
  function archive(scenario: ScrollHarness, count = 3): void {
    for (let index = 0; index < count; index += 1) scenario.transcript.notice(`notice ${String(index)}`)
  }

  it('pages one archived window in on PageUp at the top and anchors the viewport', async () => {
    const scenario = await scrollHarness({ windowBlocks: 1 })
    archive(scenario, 3)
    expect(scenario.transcript.hasOlder()).toBe(true)

    scenario.harness.terminal.headless.press('\u001b[5~')

    expect(scenario.transcript.hasOlder()).toBe(true)
    expect(scenario.state.by).toHaveLength(1)
    expect(scenario.state.by[0]).toBeGreaterThan(0)
  })

  it('pages the whole archive in on Ctrl+Home', async () => {
    const scenario = await scrollHarness({ windowBlocks: 1 })
    archive(scenario, 4)
    expect(scenario.transcript.hasOlder()).toBe(true)

    scenario.harness.terminal.headless.press('\u001b[1;5H')

    expect(scenario.transcript.hasOlder()).toBe(false)
    expect(scenario.state.by).toHaveLength(1)
    const added = scenario.state.by[0] ?? 0
    expect(added).toBeGreaterThan(0)
    expect(scenario.harness.transcriptText()).toContain('notice 0')
  })

  it('pages older history on wheel-up at the top', async () => {
    const scenario = await scrollHarness({ windowBlocks: 1 })
    archive(scenario, 3)

    scenario.harness.terminal.headless.press('\u001b[<64;10;10M')

    expect(scenario.state.by).toHaveLength(1)
    expect(scenario.transcript.hasOlder()).toBe(true)
  })

  it('does not load history while the viewport is not at the top', async () => {
    const scenario = await scrollHarness({ windowBlocks: 1 }, { top: 5 })
    archive(scenario, 3)
    expect(scenario.transcript.hasOlder()).toBe(true)

    scenario.harness.terminal.headless.press('\u001b[5~')

    expect(scenario.state.by).toEqual([])
    expect(scenario.transcript.hasOlder()).toBe(true)
  })

  it('does not load history without archived blocks', async () => {
    const scenario = await scrollHarness({})
    scenario.transcript.notice('only notice')
    expect(scenario.transcript.hasOlder()).toBe(false)

    scenario.harness.terminal.headless.press('\u001b[5~')

    expect(scenario.state.by).toEqual([])
  })

  it('does not load history while a dock surface owns input', async () => {
    const help = await scrollHarness({ windowBlocks: 1 })
    archive(help, 3)
    await submitLine(help.harness, '/help')
    await waitForDock(help.harness, copy.panel.help)
    help.harness.terminal.headless.press('\u001b[5~')
    expect(help.state.by).toEqual([])
    expect(help.transcript.hasOlder()).toBe(true)

    const config = await scrollHarness({ windowBlocks: 1 })
    archive(config, 3)
    await submitLine(config.harness, '/config')
    await waitForDock(config.harness, copy.config.modelSection)
    config.harness.terminal.headless.press('\u001b[5~')
    expect(config.state.by).toEqual([])

    const completion = await scrollHarness({ windowBlocks: 1 })
    archive(completion, 3)
    completion.harness.terminal.headless.press('/')
    await waitForDock(completion.harness, copy.completion.title)
    completion.harness.terminal.headless.press('\u001b[5~')
    expect(completion.state.by).toEqual([])

    const list = await scrollHarness({
      windowBlocks: 1,
      agentOptions: { provider: 'alpha', model: 'm-1' },
      llm: effortsLlm({ defaultEffort: ReasoningEffortId('low') }),
    })
    archive(list, 3)
    await submitLine(list.harness, '/effort')
    await waitForDock(list.harness, copy.model.effortTitle)
    list.harness.terminal.headless.press('\u001b[5~')
    expect(list.state.by).toEqual([])

    const modal = await scrollHarness({ windowBlocks: 1 })
    archive(modal, 3)
    const answer = modal.harness.ctx.waterfall('user-questions/request', {
      agent: modal.harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }] }],
    }, () => Promise.resolve({ answers: [] }))
    await dockPanel(modal.harness)
    modal.harness.terminal.headless.press('\u001b[5~')
    expect(modal.state.by).toEqual([])
    modal.harness.terminal.headless.press('\x03')
    await expect(answer).rejects.toThrow('The user cancelled the question.')
  })

  it('returns to the transcript bottom on the first Escape and interrupts on the next', async () => {
    const scenario = await scrollHarness({ windowBlocks: 1 }, { following: false, top: 6 })
    archive(scenario, 3)
    scenario.harness.agent.setStatus('running')

    scenario.harness.terminal.headless.press('\u001b')

    expect(scenario.state.bottoms).toBe(1)
    expect(scenario.state.top).toBe(0)
    expect(scenario.harness.agent.cancels).toEqual([])
    expect(scenario.harness.exit.codes).toEqual([])

    scenario.state.following = true
    scenario.harness.terminal.headless.press('\u001b')

    expect(scenario.harness.agent.cancels).toEqual(['user'])
  })

  it('ignores page-up key releases and records the render width through the host', async () => {
    const spy = vi.spyOn(TerminalTranscript.prototype, 'setRenderWidth')
    onTestFinished(() => { spy.mockRestore() })
    const scenario = await scrollHarness({ windowBlocks: 1 })
    archive(scenario, 3)
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls.at(-1)?.[0]).toBeGreaterThan(0)

    scenario.harness.terminal.headless.press('\u001b[1;5:3H')

    expect(scenario.state.by).toEqual([])
    expect(scenario.transcript.hasOlder()).toBe(true)
  })

  it('documents the scrollback keys in the help panel', async () => {
    const harness = await lifecycleHarness()
    harness.start()
    await harness.awaitStarted()
    const composer = privateValue(harness.app, 'composer') as Composer
    const lines = composer.helpLines()

    expect(lines).toContain(
      '  PgUp/PgDn          scroll the transcript (fullscreen mode pages older history in)',
    )
    expect(lines).toContain('  Esc                interrupt; in fullscreen mode it first returns to the transcript bottom')
  })

  it('does not anchor the viewport when archived blocks render no lines', async () => {
    const scenario = await scrollHarness({ windowBlocks: 1 })
    scenario.transcript.setCardsMode('hidden')
    for (let index = 0; index < 4; index += 1) {
      scenario.transcript.append(toolCall(index * 2, 1, 1, `call-${String(index)}`, 'echo', '{}'))
      scenario.transcript.append(toolResult(index * 2 + 1, 1, 1, `call-${String(index)}`, []))
    }
    expect(scenario.transcript.hasOlder()).toBe(true)

    scenario.harness.terminal.headless.press('\u001b[5~')

    expect(scenario.state.by).toEqual([])
  })

  it('refuses direct history loading while another surface owns the app', async () => {
    const load = async (
      open: (scenario: ScrollHarness) => Promise<void>,
      close: (scenario: ScrollHarness) => Promise<void>,
      options: Parameters<typeof lifecycleHarness>[0] = {},
    ): Promise<ScrollHarness> => {
      const scenario = await scrollHarness({ windowBlocks: 1, ...options })
      archive(scenario, 3)
      await open(scenario)
      const loader = privateValue(scenario.harness.app, 'loadOlderTranscript') as (data: string) => void
      loader.call(scenario.harness.app, '\u001b[5~')
      await close(scenario)
      expect(scenario.transcript.hasOlder()).toBe(true)
      expect(scenario.state.by).toEqual([])
      return scenario
    }

    await load(
      async (scenario) => {
        await submitLine(scenario.harness, '/help')
        await waitForDock(scenario.harness, copy.panel.help)
      },
      async (scenario) => {
        scenario.harness.terminal.headless.press('\x03')
        await awaitDockClosed(scenario.harness)
      },
    )
    await load(
      async (scenario) => {
        await submitLine(scenario.harness, '/config')
        await waitForDock(scenario.harness, copy.config.modelSection)
      },
      async (scenario) => {
        scenario.harness.terminal.headless.press('\x03')
        await awaitDockClosed(scenario.harness)
      },
    )
    await load(
      async (scenario) => {
        scenario.harness.terminal.headless.press('/')
        await waitForDock(scenario.harness, copy.completion.title)
      },
      async (scenario) => {
        scenario.harness.terminal.headless.press('\u001b')
        await awaitDockClosed(scenario.harness)
      },
    )
    await load(
      async (scenario) => {
        await submitLine(scenario.harness, '/effort')
        await waitForDock(scenario.harness, copy.model.effortTitle)
      },
      async (scenario) => {
        scenario.harness.terminal.headless.press('\u001b')
        await awaitDockClosed(scenario.harness)
      },
      {
        agentOptions: { provider: 'alpha', model: 'm-1' },
        llm: effortsLlm({ defaultEffort: ReasoningEffortId('low') }),
      },
    )
    const modal = await scrollHarness({ windowBlocks: 1 })
    archive(modal, 3)
    const answer = modal.harness.ctx.waterfall('user-questions/request', {
      agent: modal.harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }] }],
    }, () => Promise.resolve({ answers: [] }))
    await dockPanel(modal.harness)
    const loader = privateValue(modal.harness.app, 'loadOlderTranscript') as (data: string) => void
    loader.call(modal.harness.app, '\u001b[5~')
    modal.harness.terminal.headless.press('\x03')
    await expect(answer).rejects.toThrow('The user cancelled the question.')
    expect(modal.state.by).toEqual([])
  })

  it('invalidates the transcript through the width-tracking host', async () => {
    const scenario = await scrollHarness({})
    const spy = vi.spyOn(scenario.transcript.component, 'invalidate')
    scenario.harness.terminal.session.tui.invalidate()
    await vi.waitFor(() => { expect(spy).toHaveBeenCalled() })
    spy.mockRestore()
  })

  it('ignores history loading when no terminal session is installed', async () => {
    const harness = await lifecycleHarness({ windowBlocks: 1 })
    harness.start()
    await harness.awaitStarted()
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript
    transcript.notice('one')
    transcript.notice('two')
    const load = privateValue(harness.app, 'loadOlderTranscript') as (data: string) => void
    Reflect.set(harness.app, 'terminal', undefined)

    expect(() => { load.call(harness.app, '\u001b[5~') }).not.toThrow()
    expect(transcript.hasOlder()).toBe(true)
  })
})

describe('TerminalApp inline renderer', () => {
  it('uses the inline renderer with a bottom-anchored stack and no scroll window', async () => {
    const harness = await lifecycleHarness({ screen: 'inline', windowBlocks: 2 })
    harness.start()
    await harness.awaitStarted()
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript

    expect(harness.terminal.session.tui.mode).toBe('regular')
    const children: Component[] = Reflect.get(harness.terminal.session.tui, 'children')
    expect(children).toHaveLength(1)
    expect(children[0]?.constructor.name).toBe('BottomAnchor')
    expect(children.some(child => child.constructor.name === 'ScrollView')).toBe(false)

    for (let index = 0; index < 10; index += 1) transcript.notice(`notice ${String(index)}`)
    expect(transcript.hasOlder()).toBe(false)
    expect(transcript.stats()).toEqual({ blocks: 10, archived: 0 })
  })

  it('reports the inline renderer in /terminal without viewport or wheel data', async () => {
    const harness = await lifecycleHarness({ screen: 'inline' })
    harness.start()
    await harness.awaitStarted()
    const transcript = privateValue(harness.app, 'transcript') as TerminalTranscript
    transcript.notice('one')
    transcript.notice('two')

    await submitLine(harness, '/terminal')
    await waitForDock(harness, copy.terminal.title)
    const dock = dockText(harness.app)

    expect(dock).toContain(copy.terminal.environment)
    expect(dock).toContain(copy.terminal.screenInline)
    expect(dock).toContain(copy.terminal.wheelNone)
    expect(dock).toContain('100x30')
    expect(dock).toContain(copy.terminal.transcriptValue(2, 0))
    expect(dock).toContain(copy.terminal.focusUnknown)
    expect(dock).toContain(copy.terminal.keyboardLegacy)
    expect(dock).not.toContain(copy.terminal.viewport)
    expect(dock).toContain('Inline mode keeps history in the terminal scrollback')
  })

  it('passes the inline transcript window into the configuration display state', async () => {
    const harness = await lifecycleHarness({ screen: 'inline' })
    harness.start()
    await harness.awaitStarted()

    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    const panel = configPanelOf(harness.app)
    if (panel === undefined) throw new Error('configuration panel was not presented')
    focusConfigRow(panel, 'display', 'display.windowBlocks')

    expect(dockText(harness.app)).toContain(String(Number.MAX_SAFE_INTEGER))
  })
})

describe('TerminalApp /terminal diagnostics', () => {
  /** Environment variables this test suite mutates. */
  const ENV_KEYS = [
    'TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TMUX', 'ZELLIJ', 'STY',
    'SSH_CONNECTION', 'SSH_TTY',
  ] as const

  /**
   * Install one environment scenario and restore it after the test.
   * @param env - variables to set; every other tracked variable is unset.
   */
  function applyEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
    const saved = new Map<(typeof ENV_KEYS)[number], string | undefined>(
      ENV_KEYS.map(key => [key, process.env[key]]),
    )
    for (const key of ENV_KEYS) Reflect.deleteProperty(process.env, key)
    for (const [key, value] of Object.entries(env)) process.env[key] = value
    onTestFinished(() => {
      for (const [key, value] of saved) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
    })
  }

  /**
   * Open the diagnostics panel and return its rendered text.
   * @param harness - the application harness.
   * @returns the dock text.
   */
  async function diagnostics(harness: LifecycleHarness): Promise<string> {
    await submitLine(harness, '/terminal')
    await waitForDock(harness, copy.terminal.title)
    return dockText(harness.app)
  }

  it.each([
    {
      label: 'tmux over ssh in iTerm',
      env: {
        TERM: 'xterm-256color',
        TERM_PROGRAM: 'iTerm.app',
        TERM_PROGRAM_VERSION: '3.5.0',
        TMUX: '/tmp/tmux',
        SSH_CONNECTION: '1 2 3 4',
      },
      multiplexer: 'tmux',
      ssh: 'yes',
      emulator: 'iTerm.app 3.5.0',
    },
    { label: 'zellij', env: { ZELLIJ: '0' }, multiplexer: 'zellij', ssh: 'no', emulator: 'unknown' },
    { label: 'screen', env: { STY: '1.pts' }, multiplexer: 'screen', ssh: 'no', emulator: 'unknown' },
    { label: 'no multiplexer', env: {}, multiplexer: 'none', ssh: 'no', emulator: 'unknown' },
  ] as const)('reports the environment for $label', async ({ env, multiplexer, ssh, emulator }) => {
    applyEnv(env)
    const harness = await lifecycleHarness({ screen: 'fullscreen' })
    harness.start()
    await harness.awaitStarted()

    const dock = await diagnostics(harness)

    expect(dock).toContain(`${copy.terminal.emulator}: ${emulator}`)
    expect(dock).toContain(`${copy.terminal.term}: ${process.env.TERM ?? 'unknown'}`)
    expect(dock).toContain(`${copy.terminal.multiplexer}: ${multiplexer} · ${copy.terminal.ssh}: ${ssh}`)
    expect(dock).toContain(`${copy.terminal.size}: 100x30`)
  })

  it('reports the fullscreen renderer, keyboard protocol, viewport, and wheel events', async () => {
    const kitty = vi.spyOn({ value: false }, 'value', 'get')
    const harness = await lifecycleHarness({ screen: 'fullscreen' })
    harness.start()
    await harness.awaitStarted()
    const kittySpy = vi.spyOn(harness.terminal.headless, 'kittyProtocolActive', 'get').mockReturnValue(true)
    harness.terminal.headless.press('\x1b[I')
    harness.terminal.headless.press('\x1b[<64;10;10M')

    const dock = await diagnostics(harness)

    expect(dock).toContain(copy.terminal.screenFullscreen)
    expect(dock).toContain(copy.terminal.keyboardKitty)
    expect(dock).toContain(copy.terminal.focused)
    expect(dock).toContain(`${copy.terminal.viewport}: 0 · following end`)
    expect(dock).toMatch(new RegExp(`${copy.terminal.wheel}: 1 \\(last .*s\\)`, 'u'))
    kittySpy.mockRestore()
    void kitty
    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)
  })

  it('reports scrolled viewports, unfocused input, and later wheel events', async () => {
    const harness = await lifecycleHarness({ screen: 'fullscreen' })
    harness.start()
    await harness.awaitStarted()
    harness.terminal.headless.press('\x1b[I')
    harness.terminal.headless.press('\x1b[<64;10;10M')
    const first = await diagnostics(harness)
    expect(first).toContain(copy.terminal.focused)
    expect(first).toMatch(new RegExp(`${copy.terminal.wheel}: 1 \\(last .*s\\)`, 'u'))
    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    harness.terminal.headless.press('\x1b[O')
    harness.terminal.headless.press('\x1b[<65;10;10M')
    harness.terminal.headless.press('\x1b[<0;10;10M')
    const real = harness.terminal.session
    Reflect.set(harness.app, 'terminal', {
      ...real,
      scrollTop: () => 7,
      isFollowingEnd: () => false,
    })
    const dock = await diagnostics(harness)

    expect(dock).toContain(copy.terminal.unfocused)
    expect(dock).toContain(`${copy.terminal.viewport}: 7 · scrolled`)
    expect(dock).toMatch(new RegExp(`${copy.terminal.wheel}: 2 \\(last .*s\\)`, 'u'))
    Reflect.set(harness.app, 'terminal', real)
  })

  it('counts wheel events while a dock surface owns input', async () => {
    const harness = await lifecycleHarness({ screen: 'fullscreen' })
    harness.start()
    await harness.awaitStarted()
    await submitLine(harness, '/help')
    await waitForDock(harness, copy.panel.help)
    harness.terminal.headless.press('\x1b[<64;10;10M')
    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    const dock = await diagnostics(harness)

    expect(dock).toMatch(new RegExp(`${copy.terminal.wheel}: 1 \\(last .*s\\)`, 'u'))
  })

  it('reports an unknown viewport when the terminal session is gone', async () => {
    const harness = await lifecycleHarness({ screen: 'fullscreen' })
    harness.start()
    await harness.awaitStarted()
    Reflect.set(harness.app, 'terminal', undefined)

    const dock = await diagnostics(harness)

    expect(dock).toContain(copy.terminal.screenFullscreen)
    expect(dock).toContain(`${copy.terminal.viewport}: ${copy.terminal.focusUnknown}`)
    expect(dock).toContain(copy.terminal.keyboardLegacy)
  })

  it('builds diagnostics before the renderer starts', async () => {
    const harness = await lifecycleHarness({ screen: 'inline' })
    const show = privateValue(harness.app, 'showTerminalDiagnostics') as () => void

    expect(() => { show.call(harness.app) }).not.toThrow()
  })
})


describe('TerminalApp inline dock reanchor', () => {
  it('reanchors and forces a clear redraw when a dock closes in inline mode', async () => {
    const harness = await lifecycleHarness({ screen: 'inline' })
    harness.start()
    await harness.awaitStarted()
    const anchor = privateValue(harness.app, 'inlineAnchor') as { reanchor(): void }
    const reanchor = vi.spyOn(anchor, 'reanchor')
    const clear = vi.spyOn(harness.terminal.session.tui, 'setClearOnShrink')
    const render = vi.spyOn(harness.terminal.session.tui, 'renderNow')
    await submitLine(harness, '/help')
    await waitForDock(harness, copy.panel.help)
    reanchor.mockClear()
    clear.mockClear()
    render.mockClear()

    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    expect(reanchor).toHaveBeenCalledOnce()
    expect(clear.mock.calls.map(call => call[0])).toEqual([true, false])
    expect(render).toHaveBeenCalled()
    const lines = await screenLines(harness.terminal.headless)
    expect(lines.some(line => line.includes('dsh>'))).toBe(true)
    expect(lines.some(line => line.includes(copy.commands.helpTitle))).toBe(false)
    vi.restoreAllMocks()
  })

  it('reanchors when a permission chooser closes', async () => {
    const harness = await lifecycleHarness({
      screen: 'inline',
      services: {
        permissionPresets: {
          catalog: () => ({
            options: [
              { value: 'read-only', name: 'Read Only' },
              { value: 'workspace-write', name: 'Workspace Write' },
            ],
          }),
        },
      },
    })
    harness.start()
    await harness.awaitStarted()
    const anchor = privateValue(harness.app, 'inlineAnchor') as { reanchor(): void }
    const reanchor = vi.spyOn(anchor, 'reanchor')
    const clear = vi.spyOn(harness.terminal.session.tui, 'setClearOnShrink')
    const render = vi.spyOn(harness.terminal.session.tui, 'renderNow')
    await submitLine(harness, '/permission')
    await waitForDock(harness, copy.prompt.permissionTitle)
    reanchor.mockClear()
    clear.mockClear()
    render.mockClear()

    harness.terminal.headless.press('\r')
    await awaitDockClosed(harness)

    expect(reanchor).toHaveBeenCalledOnce()
    expect(clear.mock.calls.map(call => call[0])).toEqual([true, false])
    expect(render).toHaveBeenCalled()
    const lines = await screenLines(harness.terminal.headless)
    expect(lines.some(line => line.includes('dsh>'))).toBe(true)
    expect(lines.some(line => line.includes(copy.prompt.permissionTitle))).toBe(false)
    vi.restoreAllMocks()
  })

  it('reanchors when the configuration dock closes', async () => {
    const harness = await lifecycleHarness({ screen: 'inline' })
    harness.start()
    await harness.awaitStarted()
    const anchor = privateValue(harness.app, 'inlineAnchor') as { reanchor(): void }
    const reanchor = vi.spyOn(anchor, 'reanchor')
    const clear = vi.spyOn(harness.terminal.session.tui, 'setClearOnShrink')
    const render = vi.spyOn(harness.terminal.session.tui, 'renderNow')
    await submitLine(harness, '/config')
    await waitForDock(harness, copy.config.modelSection)
    reanchor.mockClear()
    clear.mockClear()
    render.mockClear()

    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    expect(reanchor).toHaveBeenCalledOnce()
    expect(clear.mock.calls.map(call => call[0])).toEqual([true, false])
    expect(render).toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('leaves the fullscreen renderer untouched when a dock closes', async () => {
    const harness = await lifecycleHarness({ screen: 'fullscreen' })
    harness.start()
    await harness.awaitStarted()
    expect(privateValue(harness.app, 'inlineAnchor')).toBeUndefined()
    const clear = vi.spyOn(harness.terminal.session.tui, 'setClearOnShrink')
    const render = vi.spyOn(harness.terminal.session.tui, 'renderNow')
    await submitLine(harness, '/help')
    await waitForDock(harness, copy.panel.help)
    clear.mockClear()
    render.mockClear()

    harness.terminal.headless.press('\x03')
    await awaitDockClosed(harness)

    expect(clear).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('ignores reanchoring before startup', async () => {
    const harness = await lifecycleHarness({ screen: 'inline' })
    const reanchor = privateValue(harness.app, 'reanchorInline') as () => void

    expect(() => { reanchor.call(harness.app) }).not.toThrow()
  })
})

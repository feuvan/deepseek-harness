import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { TuiAltScreen, type TUI } from '@earendil-works/pi-tui'
import { HeadlessTerminal } from '@deepseek-ai/dsh-terminal-snapshot'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, inject, name, TERMINAL_UI_SERVICE } from '../../src/index.ts'
import type { Config } from '../../src/config.ts'
import type { TerminalSession } from '../../src/terminal.ts'
import { mountSessions } from '../support/fakes.ts'
import {
  agentDouble, agentsDouble, appExitDouble, commandsDouble, freshContext, llmDouble,
  observation, projectionsDouble, sessionQueryDouble, toolsDouble, userQuestionsDouble,
} from './harness.ts'

/**
 * Terminal-session factory captured by the module mock. The plugin builds its
 * own ProcessTerminal otherwise, so tests supply a headless one instead.
 */
const terminalFactory = vi.hoisted(() => ({
  current: undefined as (() => TerminalSession) | undefined,
}))

vi.mock('../../src/terminal.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/terminal.ts')>()
  return {
    ...actual,
    createTerminalSession: (): TerminalSession => {
      if (terminalFactory.current === undefined) throw new Error('the test did not install a terminal factory')
      return terminalFactory.current()
    },
  }
})

/** One headless terminal session with a counted stop. */
interface CapturedTerminal {
  readonly session: TerminalSession
  readonly tui: TUI
  readonly headless: HeadlessTerminal
  readonly start: ReturnType<typeof vi.spyOn>
  readonly stops: () => number
}

/**
 * Build the headless terminal the plugin acquires.
 * @returns the captured terminal.
 */
function capturedTerminal(): CapturedTerminal {
  const headless = new HeadlessTerminal({ columns: 100, rows: 30 })
  onTestFinished(() => { headless.dispose() })
  const tui = new TuiAltScreen(headless, false, undefined, { mouse: false })
  const start = vi.spyOn(tui, 'start')
  let stops = 0
  const session: TerminalSession = {
    tui,
    terminal: headless,
    stop: () => {
      stops += 1
      tui.stop()
    },
  }
  return { session, tui, headless, start, stops: () => stops }
}

/**
 * Override one process stream's TTY flag for the test.
 * @param stream - the process stream.
 * @param value - reported TTY state.
 * @returns the restore function.
 */
function stubTty(stream: NodeJS.ReadStream | NodeJS.WriteStream, value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(stream, 'isTTY')
  Object.defineProperty(stream, 'isTTY', { value, configurable: true, writable: true })
  return () => {
    if (descriptor === undefined) {
      Reflect.deleteProperty(stream, 'isTTY')
      return
    }
    Object.defineProperty(stream, 'isTTY', descriptor)
  }
}

/** One plugin context carrying every consumed service. */
interface PluginContext {
  readonly ctx: ReturnType<typeof freshContext>
  readonly exit: ReturnType<typeof appExitDouble>
  readonly start: () => void
}

/**
 * Build a plugin context over a real Session store and a live Agent.
 * @param options - whether to provide `ctx.appExit`.
 * @returns the context and its starting point.
 */
async function pluginContext(options: { appExit?: boolean } = {}): Promise<PluginContext> {
  const exit = appExitDouble()
  const agents = agentsDouble()
  const ctx = freshContext({
    agents: agents.service,
    tools: toolsDouble(() => undefined),
    commands: commandsDouble().service,
    llm: llmDouble({
      providers: [],
      listModels: async () => [],
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
    }),
    sessionQuery: sessionQueryDouble(async () => observation([])).service,
    sessionProjections: projectionsDouble().service,
    userQuestions: userQuestionsDouble(() => (async function* empty() {})()),
    ...(options.appExit === false ? {} : { appExit: exit.exit }),
  })
  await mountSessions(ctx)
  const session = ctx.sessions.create(SessionId('session-test'))
  agents.bind(agentDouble({ session }).agent)
  return { ctx, exit, start: () => { apply(ctx, terminalConfig()) } }
}

/** The configuration the launcher supplies to the plugin. */
function terminalConfig(): Config {
  return {
    sessionId: 'session-test',
    color: false,
    animation: false,
    previewLines: 4,
    windowBlocks: 200,
    title: 'Test Terminal',
    locale: 'auto',
    busyEnter: 'queue',
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  terminalFactory.current = undefined
})

describe('terminal plugin exports', () => {
  it('declares its stable name and consumed services', () => {
    expect(name).toBe('terminal-ui')
    expect(inject).toContain('sessionQuery')
  })
})

describe('apply', () => {
  it('rejects a non-interactive stdin before taking the screen', () => {
    const restoreStdin = stubTty(process.stdin, false)
    const restoreStdout = stubTty(process.stdout, true)
    onTestFinished(() => { restoreStdin(); restoreStdout() })
    const ctx = freshContext()
    onTestFinished(async () => { await ctx.fiber.dispose() })

    expect(() => { apply(ctx, terminalConfig()) })
      .toThrow(/requires an interactive terminal.*dsh --profile headless/u)
  })

  it('rejects a non-interactive stdout before taking the screen', () => {
    const restoreStdin = stubTty(process.stdin, true)
    const restoreStdout = stubTty(process.stdout, false)
    onTestFinished(() => { restoreStdin(); restoreStdout() })
    const ctx = freshContext()
    onTestFinished(async () => { await ctx.fiber.dispose() })

    expect(() => { apply(ctx, terminalConfig()) })
      .toThrow(/stdout must both be TTYs/u)
  })

  it('rejects a config without a session identity', () => {
    const restoreStdin = stubTty(process.stdin, true)
    const restoreStdout = stubTty(process.stdout, true)
    onTestFinished(() => { restoreStdin(); restoreStdout() })
    const ctx = freshContext()
    onTestFinished(async () => { await ctx.fiber.dispose() })

    expect(() => {
      apply(ctx, {
        sessionId: '  ',
        color: false,
        animation: false,
        previewLines: 4,
        windowBlocks: 200,
        title: 'Test Terminal',
        locale: 'auto',
        busyEnter: 'queue',
      })
    }).toThrow('sessionId must not be blank')
  })

  it('rejects a launcher that did not provide appExit', async () => {
    const restoreStdin = stubTty(process.stdin, true)
    const restoreStdout = stubTty(process.stdout, true)
    onTestFinished(() => { restoreStdin(); restoreStdout() })
    const plugin = await pluginContext({ appExit: false })

    expect(() => { plugin.start() })
      .toThrow('terminal-ui: the launcher must provide ctx.appExit before the tree mounts')
  })

  it('starts the application and disposes it with the plugin context', async () => {
    const restoreStdin = stubTty(process.stdin, true)
    const restoreStdout = stubTty(process.stdout, true)
    onTestFinished(() => { restoreStdin(); restoreStdout() })
    const plugin = await pluginContext()
    const terminal = capturedTerminal()
    terminalFactory.current = () => terminal.session

    plugin.start()
    await vi.waitFor(() => { expect(terminal.start).toHaveBeenCalled() })

    expect(plugin.exit.codes).toEqual([])
    expect(terminal.stops()).toBe(0)

    await plugin.ctx.fiber.dispose()

    expect(terminal.stops()).toBe(1)
    expect(plugin.exit.codes).toEqual([])
  })

  it('provides the terminalUi seam bound to the application and removes it with the plugin', async () => {
    const restoreStdin = stubTty(process.stdin, true)
    const restoreStdout = stubTty(process.stdout, true)
    onTestFinished(() => { restoreStdin(); restoreStdout() })
    const plugin = await pluginContext()
    const terminal = capturedTerminal()
    terminalFactory.current = () => terminal.session

    plugin.start()
    await vi.waitFor(() => { expect(terminal.start).toHaveBeenCalled() })

    const seam = plugin.ctx.get(TERMINAL_UI_SERVICE)
    expect(seam).toBeDefined()
    expect(plugin.ctx.get('terminalUi')).toBe(seam)
    expect(Object.keys(seam ?? {}).sort()).toEqual([
      'closeDock', 'notice', 'openDock', 'registerCommand', 'registerStrip', 'setEditorText',
    ])
    const component = { render: () => ['seam strip'], invalidate: () => {} }
    const disposeStrip = seam?.registerStrip(component)
    const disposeCommand = seam?.registerCommand({ name: 'seam', description: 'Seam command', run: () => {} })
    expect(typeof disposeStrip).toBe('function')
    expect(typeof disposeCommand).toBe('function')
    seam?.openDock({ ...component, handleInput: () => {} }, () => {})
    seam?.closeDock()
    seam?.setEditorText('seam text')
    seam?.notice('seam notice')
    disposeStrip?.()
    disposeCommand?.()

    await plugin.ctx.fiber.dispose()

    expect(terminal.stops()).toBe(1)
    expect(plugin.ctx.get(TERMINAL_UI_SERVICE)).toBeUndefined()
  })

  it('disposes a waiting application without acquiring a terminal', async () => {
    const restoreStdin = stubTty(process.stdin, true)
    const restoreStdout = stubTty(process.stdout, true)
    onTestFinished(() => { restoreStdin(); restoreStdout() })
    const exit = appExitDouble()
    const agents = agentsDouble()
    const ctx = freshContext({
      agents: agents.service,
      tools: toolsDouble(() => undefined),
      commands: commandsDouble().service,
      sessionQuery: sessionQueryDouble(async () => observation([])).service,
      appExit: exit.exit,
    })
    await mountSessions(ctx)
    const terminal = capturedTerminal()
    terminalFactory.current = () => terminal.session

    apply(ctx, terminalConfig())
    await Promise.resolve()
    await Promise.resolve()
    await ctx.fiber.dispose()

    expect(terminal.start).not.toHaveBeenCalled()
    expect(terminal.stops()).toBe(0)
    expect(exit.codes).toEqual([])
  })
})

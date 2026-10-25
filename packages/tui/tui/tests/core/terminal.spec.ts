import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ProgramStatus, Terminal, TuiAltScreen } from '@earendil-works/pi-tui'
import { HeadlessTerminal } from '@deepseek-ai/dsh-terminal-snapshot'
import { assertInteractiveTerminal, createTerminalSession } from '../../src/terminal.ts'
import { chinese, copy, setCopyLocale } from '../../src/copy.ts'
import { headlessSession } from './harness.ts'

afterEach(() => {
  setCopyLocale('en')
})

describe('assertInteractiveTerminal', () => {
  it('accepts two interactive streams', () => {
    expect(() => { assertInteractiveTerminal(true, true) }).not.toThrow()
  })

  it.each([
    ['stdin', false, true],
    ['stdout', true, false],
    ['both streams', false, false],
  ] as const)('rejects a non-interactive %s and names the headless alternative', (_label, stdinIsTty, stdoutIsTty) => {
    expect(() => { assertInteractiveTerminal(stdinIsTty, stdoutIsTty) })
      .toThrow(/requires an interactive terminal.*dsh --profile headless/u)
  })
})

describe('createTerminalSession', () => {
  it('wraps the supplied terminal in an alternate-screen renderer', async () => {
    const { headless, session } = headlessSession()

    expect(session.terminal).not.toBe(headless)
    expect(session.tui.terminal).toBe(session.terminal)
    expect(session.terminal.columns).toBe(headless.columns)
    expect(session.terminal.rows).toBe(headless.rows)
    expect(session.tui.mode).toBe('fullscreen')
    session.stop()
    await headless.settle()
  })

  it('delegates transcript viewport scrolling to the renderer', async () => {
    const { headless, session } = headlessSession()
    const tui = session.tui as TuiAltScreen
    const scrollBy = vi.spyOn(tui, 'scrollBy')
    const scrollToBottom = vi.spyOn(tui, 'scrollToBottom')

    expect(session.scrollTop()).toBe(tui.viewportTop)
    expect(session.isFollowingEnd()).toBe(tui.isFollowingOutput)

    session.scrollBy(3)
    session.scrollToBottom()

    expect(scrollBy).toHaveBeenCalledWith(3)
    expect(scrollToBottom).toHaveBeenCalled()
    session.stop()
    await headless.settle()
  })

  it('stops the renderer only once', async () => {
    const { headless, session } = headlessSession()
    const stop = vi.spyOn(session.tui, 'stop')

    session.stop()
    session.stop()

    expect(stop).toHaveBeenCalledOnce()
    await headless.settle()
  })

  it('enables mouse selection, copy-on-select, and the localized jump indicator', () => {
    const { session } = headlessSession()
    const tui = session.tui as TuiAltScreen
    const indicator = Reflect.get(tui, 'scrollToEndIndicator') as () => string

    expect(tui.getCopyOnSelect()).toBe(true)
    expect(Reflect.get(tui, 'mouseEnabled')).toBe(true)
    expect(indicator()).toBe(copy.composer.scrollToEnd)

    setCopyLocale('zh')
    expect(indicator()).toBe(chinese.composer.scrollToEnd)

    session.stop()
  })

  it('defaults to the process terminal without starting it', () => {
    const session = createTerminalSession()

    expect(session.tui.terminal).toBe(session.terminal)
    expect(session.terminal.columns).toBeGreaterThan(0)
    expect(session.terminal.rows).toBeGreaterThan(0)
  })

  it('intercepts dock input before the renderer receives it', () => {
    const headless = new HeadlessTerminal({ columns: 80, rows: 20 })
    onTestFinished(() => { headless.dispose() })
    const session = createTerminalSession(headless)
    const seen: string[] = []
    session.setInputInterceptor?.((data) => {
      seen.push(data)
      return data === 'x'
    })
    const onInput = vi.fn()
    session.terminal.start(onInput, () => {})

    headless.press('x')
    headless.press('y')

    expect(seen).toEqual(['x', 'y'])
    expect(onInput).toHaveBeenCalledTimes(1)
    expect(onInput).toHaveBeenCalledWith('y')
  })
})


/** One recording terminal double and the calls it received. */
interface RecordingTerminal {
  readonly terminal: Terminal
  readonly calls: string[]
}

/**
 * Build a terminal double that records every forwarded call.
 * @param options - whether the optional exit restore hook is implemented.
 * @returns the terminal and its call log.
 */
function recordingTerminal(options: { restoreOnExit?: boolean } = {}): RecordingTerminal {
  const calls: string[] = []
  const terminal: Terminal = {
    start: (onInput, onResize) => {
      calls.push(`start:${onInput.name}:${onResize.name}`)
    },
    stop: () => { calls.push('stop') },
    drainInput: async (maxMs, idleMs) => { calls.push(`drain:${String(maxMs)}:${String(idleMs)}`) },
    write: (data) => { calls.push(`write:${data}`) },
    get columns(): number { return 120 },
    get rows(): number { return 40 },
    get kittyProtocolActive(): boolean { return true },
    moveBy: (lines) => { calls.push(`moveBy:${String(lines)}`) },
    hideCursor: () => { calls.push('hideCursor') },
    showCursor: () => { calls.push('showCursor') },
    clearLine: () => { calls.push('clearLine') },
    clearFromCursor: () => { calls.push('clearFromCursor') },
    clearScreen: () => { calls.push('clearScreen') },
    setTitle: (title) => { calls.push(`setTitle:${title}`) },
    setProgress: (active) => { calls.push(`setProgress:${String(active)}`) },
    setProgramStatus: (status: ProgramStatus) => { calls.push(`setProgramStatus:${status.state}`) },
    ...(options.restoreOnExit === false
      ? {}
      : { restoreOnExit: (before: string, after: string) => { calls.push(`restoreOnExit:${before}:${after}`) } }),
  }
  return { terminal, calls }
}

describe('InterceptingTerminal forwarding', () => {
  it('delegates the renderer-facing terminal surface', async () => {
    const { terminal, calls } = recordingTerminal()
    const session = createTerminalSession(terminal)
    const wrapped = session.terminal

    wrapped.write('hello')
    wrapped.moveBy(2)
    wrapped.hideCursor()
    wrapped.showCursor()
    wrapped.clearLine()
    wrapped.clearFromCursor()
    wrapped.clearScreen()
    wrapped.setTitle('title')
    wrapped.setProgress(true)
    wrapped.setProgramStatus({ state: 'working', app: 'dsh', message: 'busy' })
    wrapped.restoreOnExit?.('before', 'after')
    await wrapped.drainInput(10, 5)

    expect(wrapped.columns).toBe(120)
    expect(wrapped.rows).toBe(40)
    expect(wrapped.kittyProtocolActive).toBe(true)
    expect(calls).toEqual([
      'write:hello',
      'moveBy:2',
      'hideCursor',
      'showCursor',
      'clearLine',
      'clearFromCursor',
      'clearScreen',
      'setTitle:title',
      'setProgress:true',
      'setProgramStatus:working',
      'restoreOnExit:before:after',
      'drain:10:5',
    ])
  })

  it('disables alternate-scroll mode right after the alternate screen and mouse capture', () => {
    const { terminal, calls } = recordingTerminal()
    const session = createTerminalSession(terminal)

    session.terminal.write('\u001b[?1049h\u001b[?1000h\u001b[?1006h')
    session.terminal.write('frame')

    expect(calls).toEqual([
      'write:\u001b[?1049h\u001b[?1000h\u001b[?1006h',
      'write:\u001b[?1007l',
      'write:frame',
    ])
  })

  it('starts the renderer with alternate-scroll mode disabled', () => {
    const { terminal, calls } = recordingTerminal()
    const session = createTerminalSession(terminal)

    session.tui.start()
    session.stop()

    expect(calls.some(call => call.includes('\u001b[?1049h'))).toBe(true)
    expect(calls).toContain('write:\u001b[?1007l')
  })

  it('tolerates a terminal without the optional exit restore hook', () => {
    const { terminal } = recordingTerminal({ restoreOnExit: false })
    const session = createTerminalSession(terminal)

    expect(() => { session.terminal.restoreOnExit?.('before', 'after') }).not.toThrow()
  })

  it('forwards stop and start to the inner terminal', () => {
    const { terminal, calls } = recordingTerminal()
    const session = createTerminalSession(terminal)
    const onInput = vi.fn()
    const onResize = vi.fn()

    session.terminal.start(onInput, onResize)
    session.stop()

    expect(calls).toContain('stop')
    expect(calls.some(call => call.startsWith('start:'))).toBe(true)
  })

  it('lets input through without an interceptor and after clearing one', () => {
    const headless = new HeadlessTerminal({ columns: 80, rows: 20 })
    onTestFinished(() => { headless.dispose() })
    const session = createTerminalSession(headless)
    const received: string[] = []
    session.terminal.start((data) => { received.push(data) }, () => {})

    headless.press('a')
    session.setInputInterceptor?.(() => false)
    headless.press('b')
    session.setInputInterceptor?.(undefined)
    headless.press('c')

    expect(received).toEqual(['a', 'b', 'c'])
  })
})

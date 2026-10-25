/**
 * Terminal acquisition and ownership for the terminal front door: the process
 * terminal is claimed only after an interactive TTY is proven, and every exit
 * path restores it through one idempotent stop.
 *
 * @module @deepseek-ai/dsh-tui/terminal
 */

import {
  ProcessTerminal, TuiAltScreen, isKeyRelease, type ProgramStatus, type Terminal, type TUI,
} from '@earendil-works/pi-tui'
import { copy } from './copy.ts'

/**
 * DECSET 1007 turns wheel input into arrow keys in the alternate screen.
 * iTerm2 applies that conversion even while mouse reporting is active, so the
 * wheel reaches the composer as Up/Down instead of the transcript as mouse
 * events. Keep it off whenever the alternate screen and mouse capture are
 * enabled; mouse reporting is the authoritative wheel channel there.
 */
const DISABLE_ALT_SCROLL = '\x1b[?1007l'

/** The terminal surface this plugin owns for one application lifetime. */
export interface TerminalSession {
  /** The renderer the application composes components into. */
  readonly tui: TUI
  /** The underlying terminal the renderer writes to. */
  readonly terminal: Terminal
  /**
   * Install a pre-dispatch input hook for dock surfaces. The hook runs before
   * the renderer's viewport handling, so page keys reach the active dock panel
   * instead of scrolling the transcript behind it.
   * @param interceptor - returns true when the sequence was consumed.
   */
  setInputInterceptor?(interceptor: ((data: string) => boolean) | undefined): void
  /** @returns the primary transcript scroll offset in lines. */
  scrollTop(): number
  /** Scroll the primary transcript viewport by lines. */
  scrollBy(lines: number): void
  /** Scroll the primary transcript viewport to the end. */
  scrollToBottom(): void
  /** @returns whether the transcript follows new output at its end. */
  isFollowingEnd(): boolean
  /** Restore the terminal and retain the final document; safe to call more than once. */
  stop(): void
}

/** Delegating terminal that lets the application intercept input before the renderer sees it. */
class InterceptingTerminal implements Terminal {
  private readonly inner: Terminal
  private readonly interceptor: () => ((data: string) => boolean) | undefined

  /**
   * @param inner - the terminal the renderer writes to.
   * @param interceptor - reads the current pre-dispatch hook.
   */
  constructor(inner: Terminal, interceptor: () => ((data: string) => boolean) | undefined) {
    this.inner = inner
    this.interceptor = interceptor
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inner.start((data) => {
      // Kitty reports a release after every press. Releases carry the same key
      // identity as the press, so drop them at the input boundary: no dock,
      // shortcut, or editor receives one physical key twice.
      if (isKeyRelease(data)) return
      const intercept = this.interceptor()
      if (intercept?.(data) === true) return
      onInput(data)
    }, onResize)
  }

  stop(): void { this.inner.stop() }
  restoreOnExit(before: string, after: string): void { this.inner.restoreOnExit?.(before, after) }
  drainInput(maxMs?: number, idleMs?: number): Promise<void> { return this.inner.drainInput(maxMs, idleMs) }
  write(data: string): void {
    this.inner.write(data)
    // TuiAltScreen enables the alternate screen and mouse reporting in one
    // write. Follow it immediately so iTerm2 cannot keep converting the wheel
    // into arrow keys while mouse capture is active.
    if (data.includes('\x1b[?1049h') || data.includes('\x1b[?1000h')) this.inner.write(DISABLE_ALT_SCROLL)
  }
  get columns(): number { return this.inner.columns }
  get rows(): number { return this.inner.rows }
  get kittyProtocolActive(): boolean { return this.inner.kittyProtocolActive }
  moveBy(lines: number): void { this.inner.moveBy(lines) }
  hideCursor(): void { this.inner.hideCursor() }
  showCursor(): void { this.inner.showCursor() }
  clearLine(): void { this.inner.clearLine() }
  clearFromCursor(): void { this.inner.clearFromCursor() }
  clearScreen(): void { this.inner.clearScreen() }
  setTitle(title: string): void { this.inner.setTitle(title) }
  setProgress(active: boolean): void { this.inner.setProgress(active) }
  setProgramStatus(status: ProgramStatus): void { this.inner.setProgramStatus(status) }
}

/**
 * Prove the process owns an interactive terminal before any screen takeover.
 * @param stdinIsTty - whether stdin is a TTY.
 * @param stdoutIsTty - whether stdout is a TTY.
 * @throws when either stream is not a TTY; the message names the non-interactive alternative.
 */
export function assertInteractiveTerminal(stdinIsTty: boolean | undefined, stdoutIsTty: boolean | undefined): void {
  if (stdinIsTty && stdoutIsTty) return
  throw new Error(
    'terminal-ui requires an interactive terminal: stdin and stdout must both be TTYs. '
    + 'For non-interactive runs use `dsh --profile headless "<task>"`.',
  )
}

/**
 * Create the alternate-screen renderer over one terminal.
 * @param terminal - the terminal to own; defaults to the process terminal.
 * @returns the renderer/terminal pair with an idempotent stop.
 */
export function createTerminalSession(terminal: Terminal = new ProcessTerminal()): TerminalSession {
  let interceptor: ((data: string) => boolean) | undefined
  const wrapped = new InterceptingTerminal(terminal, () => interceptor)
  const tui = new TuiAltScreen(wrapped, false, undefined, {
    mouse: true,
    copyOnSelect: true,
    scrollToEndIndicator: () => copy.composer.scrollToEnd,
  })
  let stopped = false
  return {
    tui,
    terminal: wrapped,
    scrollTop: () => tui.viewportTop,
    scrollBy: (lines) => { tui.scrollBy(lines) },
    scrollToBottom: () => { tui.scrollToBottom() },
    isFollowingEnd: () => tui.isFollowingOutput,
    stop: () => {
      if (stopped) return
      stopped = true
      tui.stop()
    },
    setInputInterceptor: (next) => { interceptor = next },
  }
}

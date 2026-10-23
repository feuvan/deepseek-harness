/**
 * Terminal acquisition and ownership for the terminal front door: the process
 * terminal is claimed only after an interactive TTY is proven, and every exit
 * path restores it through one idempotent stop.
 *
 * @module @deepseek-ai/dsh-tui/terminal
 */

import { ProcessTerminal, TuiAltScreen, type Terminal, type TUI } from '@earendil-works/pi-tui'

/** The terminal surface this plugin owns for one application lifetime. */
export interface TerminalSession {
  /** The renderer the application composes components into. */
  readonly tui: TUI
  /** The underlying terminal the renderer writes to. */
  readonly terminal: Terminal
  /** Restore the terminal and retain the final document; safe to call more than once. */
  stop(): void
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
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false })
  let stopped = false
  return {
    tui,
    terminal,
    stop: () => {
      if (stopped) return
      stopped = true
      tui.stop()
    },
  }
}

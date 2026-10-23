/**
 * Spawn a real process under a PTY and read its parsed screen, so an assembled
 * terminal application can be accepted at the process boundary.
 *
 * @module @deepseek-ai/dsh-terminal-snapshot/pty-driver
 */

import type * as NodePty from 'node-pty'
import type { IPty } from 'node-pty'
import type { Terminal as Emulator } from '@xterm/headless'
import { createLazyRequire } from '@deepseek-ai/dsh-lazy-require'
import { projectTerminalState, type TerminalState } from './project.ts'

const requirePty = createLazyRequire<typeof NodePty>('node-pty', import.meta.url)
const requireHeadless = createLazyRequire<typeof import('@xterm/headless')>('@xterm/headless', import.meta.url)

/** How to start one PTY process. */
export interface PtyProcessOptions {
  /** Executable to run. */
  readonly file: string
  /** Arguments passed verbatim. */
  readonly args?: readonly string[]
  /** Working directory. */
  readonly cwd: string
  /** Initial columns; default 100. */
  readonly columns?: number
  /** Initial rows; default 30. */
  readonly rows?: number
  /** Environment overrides merged over the current environment. */
  readonly env?: NodeJS.ProcessEnv
  /** Retained scrollback lines; default 0. */
  readonly scrollback?: number
}

/** One child process observed through a PTY and a headless emulator. */
export class PtyProcess {
  private readonly pty: IPty
  private readonly emulator: Emulator
  private readonly done: Promise<{ code: number | null; signal: number | undefined }>
  private disposed = false
  private exitedFlag = false

  private constructor(pty: IPty, emulator: Emulator, done: Promise<{ code: number | null; signal: number | undefined }>) {
    this.pty = pty
    this.emulator = emulator
    this.done = done
    const markExited = (): void => { this.exitedFlag = true }
    /* v8 ignore next -- the exit promise resolves from onExit and never rejects; the rejection handler only keeps the flag conservative. */
    void done.then(markExited, markExited)
  }

  /**
   * Start a process and begin parsing its output.
   * @param options - executable, arguments, cwd, and geometry.
   * @returns the running process handle.
   */
  static start(options: PtyProcessOptions): PtyProcess {
    const { spawn } = requirePty()
    const { Terminal: EmulatorTerminal } = requireHeadless()
    const columns = options.columns ?? 100
    const rows = options.rows ?? 30
    const pty = spawn(options.file, [...(options.args ?? [])], {
      name: 'xterm-256color',
      cols: columns,
      rows,
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    })
    const emulator = new EmulatorTerminal({ cols: columns, rows, scrollback: options.scrollback ?? 0, allowProposedApi: true })
    pty.onData((data: string) => { emulator.write(data) })
    const done = new Promise<{ code: number | null; signal: number | undefined }>((resolve) => {
      pty.onExit(({ exitCode, signal }) => { resolve({ code: exitCode, signal }) })
    })
    return new PtyProcess(pty, emulator, done)
  }

  /** The process exit promise. */
  get exited(): Promise<{ code: number | null; signal: number | undefined }> {
    return this.done
  }

  /**
   * Write raw input into the PTY.
   * @param data - keystrokes or control sequences.
   */
  write(data: string): void {
    this.pty.write(data)
  }

  /**
   * Resize the PTY and its emulator.
   * @param columns - new columns.
   * @param rows - new rows.
   */
  resize(columns: number, rows: number): void {
    this.pty.resize(columns, rows)
    this.emulator.resize(columns, rows)
  }

  /**
   * Read the currently parsed screen.
   * @param options - `full` includes retained scrollback.
   * @returns the projected terminal state.
   */
  screen(options: { full?: boolean } = {}): TerminalState {
    return projectTerminalState(this.emulator, options)
  }

  /**
   * Wait until a predicate accepts the parsed screen.
   * @param predicate - receives the current screen text.
   * @param timeoutMs - maximum wait before rejecting.
   * @returns the matching state.
   */
  async waitFor(predicate: (screen: string) => boolean, timeoutMs = 10_000): Promise<TerminalState> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const state = this.screen()
      if (predicate(state.lines.join('\n'))) return state
      if (this.exitedFlag) {
        await this.settle()
        const settled = this.screen()
        if (predicate(settled.lines.join('\n'))) return settled
        break
      }
      await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
    }
    const state = this.screen()
    throw new Error(`pty: timed out waiting for screen condition; last screen:\n${state.lines.join('\n')}`)
  }

  /**
   * Wait until the parsed screen contains one text fragment.
   * @param text - fragment to find.
   * @param timeoutMs - maximum wait before rejecting.
   * @returns the matching state.
   */
  waitForText(text: string, timeoutMs = 10_000): Promise<TerminalState> {
    return this.waitFor(screen => screen.includes(text), timeoutMs)
  }

  /**
   * Wait until every retained emulator write parses.
   * @returns a promise resolved at parser quiescence.
   */
  async settle(): Promise<void> {
    await new Promise<void>((resolve) => { this.emulator.write('', () => { resolve() }) })
  }

  /** Terminate the child process and release the emulator. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    try {
      this.pty.kill()
    } catch {
      // The child may already have exited; disposal then only releases the emulator.
    }
    this.emulator.dispose()
  }

}

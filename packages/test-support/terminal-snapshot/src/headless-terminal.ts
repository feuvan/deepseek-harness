/**
 * A pi-tui-compatible terminal backed by a headless terminal emulator, so a
 * full-screen application can render without a TTY and its final state can be
 * projected for review.
 *
 * @module @deepseek-ai/dsh-terminal-snapshot/headless-terminal
 */

import type { ProgramStatus, Terminal } from '@earendil-works/pi-tui'
import type { Terminal as Emulator } from '@xterm/headless'
import { createLazyRequire } from '@deepseek-ai/dsh-lazy-require'
import { projectTerminalState, type TerminalState } from './project.ts'

const requireHeadless = createLazyRequire<typeof import('@xterm/headless')>('@xterm/headless', import.meta.url)

/** Options for one headless terminal. */
export interface HeadlessTerminalOptions {
  /** Initial columns; default 80. */
  readonly columns?: number
  /** Initial rows; default 24. */
  readonly rows?: number
  /** Retained scrollback lines; default 0 keeps the alternate screen contract. */
  readonly scrollback?: number
}

/** A terminal that accepts every pi-tui write and parses it into a buffer. */
export class HeadlessTerminal implements Terminal {
  private readonly emulator: Emulator
  private readonly inputListeners = new Set<(data: string) => void>()
  private resizeListener: (() => void) | undefined
  private pending: Promise<void> = Promise.resolve()
  private writeCount = 0
  private titleValue = ''
  private progressValue = false
  private programStatusValue: ProgramStatus | undefined

  /**
   * @param options - initial geometry and scrollback.
   */
  constructor(options: HeadlessTerminalOptions = {}) {
    const { Terminal: EmulatorTerminal } = requireHeadless()
    this.emulator = new EmulatorTerminal({
      cols: options.columns ?? 80,
      rows: options.rows ?? 24,
      scrollback: options.scrollback ?? 0,
      allowProposedApi: true,
    })
  }

  /** The number of writes received, for render-loop assertions. */
  get writes(): number {
    return this.writeCount
  }

  /** The title last requested by the application. */
  get title(): string {
    return this.titleValue
  }

  /** The progress indicator last requested by the application. */
  get progress(): boolean {
    return this.progressValue
  }

  /** The program status last reported by the application. */
  get programStatus(): ProgramStatus | undefined {
    return this.programStatusValue
  }

  /**
   * Attach the input and resize handlers.
   * @param onInput - receives raw input bytes.
   * @param onResize - receives geometry changes.
   */
  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputListeners.add(onInput)
    this.resizeListener = onResize
  }

  /** Detach the input and resize handlers; the emulator stays usable until {@link dispose}. */
  stop(): void {
    this.inputListeners.clear()
    this.resizeListener = undefined
  }

  /**
   * Restore sequences written by the renderer's process-exit handler.
   * @param before - sequences written before the terminal's own resets.
   * @param after - sequences written after them.
   */
  restoreOnExit(before: string, after: string): void {
    this.write(before)
    this.write(after)
  }

  /**
   * Drain pending input; a headless terminal has none.
   * @returns a resolved promise.
   */
  async drainInput(): Promise<void> {
    await this.settle()
  }

  /**
   * Parse one render frame.
   * @param data - ANSI output from the application.
   */
  write(data: string): void {
    this.writeCount += 1
    this.pending = this.pending.then(() => new Promise<void>((resolve) => {
      this.emulator.write(data, () => { resolve() })
    }))
  }

  /** @returns the current columns. */
  get columns(): number {
    return this.emulator.cols
  }

  /** @returns the current rows. */
  get rows(): number {
    return this.emulator.rows
  }

  /** @returns whether the Kitty keyboard protocol is active; always false headlessly. */
  get kittyProtocolActive(): boolean {
    return false
  }

  /**
   * Emit cursor movement for renderers that use the terminal cursor API.
   * @param lines - positive moves down, negative moves up.
   */
  moveBy(lines: number): void {
    if (lines > 0) this.write(`\u001b[${String(lines)}B`)
    else if (lines < 0) this.write(`\u001b[${String(-lines)}A`)
  }

  /** Hide the cursor. */
  hideCursor(): void {
    this.write('\u001b[?25l')
  }

  /** Show the cursor. */
  showCursor(): void {
    this.write('\u001b[?25h')
  }

  /** Clear the current line. */
  clearLine(): void {
    this.write('\u001b[2K')
  }

  /** Clear from the cursor to the end of the screen. */
  clearFromCursor(): void {
    this.write('\u001b[J')
  }

  /** Clear the screen and home the cursor. */
  clearScreen(): void {
    this.write('\u001b[2J\u001b[H')
  }

  /**
   * Record the title the application requested.
   * @param title - terminal title.
   */
  setTitle(title: string): void {
    this.titleValue = title
  }

  /**
   * Record the progress indicator state.
   * @param active - whether progress is active.
   */
  setProgress(active: boolean): void {
    this.progressValue = active
  }

  /**
   * Record the program status.
   * @param status - reported status.
   */
  setProgramStatus(status: ProgramStatus): void {
    this.programStatusValue = status
  }

  /**
   * Feed one input sequence to the attached handlers.
   * @param data - raw terminal input.
   */
  press(data: string): void {
    for (const listener of [...this.inputListeners]) listener(data)
  }

  /**
   * Resize the headless terminal and notify the renderer.
   * @param columns - new columns.
   * @param rows - new rows.
   */
  resize(columns: number, rows: number): void {
    this.emulator.resize(columns, rows)
    this.resizeListener?.()
  }

  /**
   * Read the parsed terminal state, including application metadata.
   * @param options - `full` includes retained scrollback instead of the viewport.
   * @returns the projected terminal state.
   */
  state(options?: { full?: boolean }): TerminalState {
    return {
      ...projectTerminalState(this.emulator, options),
      title: this.titleValue,
      progress: this.progressValue,
      ...(this.programStatusValue === undefined ? {} : { programStatus: this.programStatusValue.state }),
    }
  }

  /**
   * Wait until every accepted write has been parsed.
   * @returns a promise resolved at parser quiescence.
   */
  async settle(): Promise<void> {
    await this.pending
    await new Promise<void>((resolve) => { this.emulator.write('', () => { resolve() }) })
  }

  /** Release the emulator. */
  dispose(): void {
    this.stop()
    this.emulator.dispose()
  }
}

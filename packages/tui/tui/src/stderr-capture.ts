/**
 * Capture direct standard-error writes while the terminal owns the screen.
 *
 * Plugins and host diagnostics sometimes write through `console.error` or
 * `process.stderr.write` instead of the logger service. A raw write lands in
 * the terminal's current row and corrupts the inline composer; this capture
 * turns complete lines into transcript notices until the terminal restores
 * the process streams.
 *
 * @module @deepseek-ai/dsh-tui/stderr-capture
 */

/** Maximum buffered bytes before an unfinished line is emitted or truncated. */
const MAX_BUFFER = 16 * 1024

/** One installed standard-error redirect. */
export class StderrCapture {
  private original: typeof process.stderr.write | undefined
  private buffer = ''

  /**
   * @param onLine - receives each complete, non-empty line without its line feed.
   */
  constructor(private readonly onLine: (line: string) => void) {}

  /** Install the redirect; repeated calls are no-ops. */
  install(): void {
    if (this.original !== undefined) return
    // oxlint-disable-next-line typescript/unbound-method -- restoring the exact stream method preserves its identity
    this.original = process.stderr.write
    const capture = (
      chunk: string | Uint8Array,
      encoding?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ): boolean => {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(
        typeof encoding === 'string' ? encoding : 'utf8',
      )
      this.push(text)
      const done = typeof encoding === 'function' ? encoding : callback
      done?.()
      return true
    }
    process.stderr.write = capture
  }

  /** Restore the process stream and emit any unterminated final line. */
  uninstall(): void {
    if (this.original === undefined) return
    this.flush()
    process.stderr.write = this.original
    this.original = undefined
  }

  /**
   * Buffer one chunk and emit complete lines.
   * @param text - written text.
   */
  private push(text: string): void {
    this.buffer += text
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/u, '')
      this.buffer = this.buffer.slice(newline + 1)
      this.emit(line)
      newline = this.buffer.indexOf('\n')
    }
    if (this.buffer.length > MAX_BUFFER) {
      this.emit(this.buffer.slice(0, MAX_BUFFER))
      this.buffer = this.buffer.slice(MAX_BUFFER)
    }
  }

  /** Emit the unterminated tail, if any. */
  private flush(): void {
    const line = this.buffer.replace(/\r$/u, '')
    this.buffer = ''
    this.emit(line)
  }

  /**
   * Report one line when it carries text.
   * @param line - complete line.
   */
  private emit(line: string): void {
    if (line.trim() !== '') this.onLine(line)
  }
}

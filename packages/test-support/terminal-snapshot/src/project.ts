/**
 * Semantic projection of a headless terminal's final screen: geometry, buffer,
 * cursor, row text, and non-default style ranges, with text and style kept
 * separate so a reviewer can tell content changes from presentation changes.
 *
 * @module @deepseek-ai/dsh-terminal-snapshot/project
 */

import type { Terminal as Emulator } from '@xterm/headless'

/** One contiguous styled cell range on one row. */
export interface TerminalStyleRun {
  /** Zero-based row index within the projected window. */
  readonly row: number
  /** First column covered. */
  readonly start: number
  /** Last column covered, inclusive. */
  readonly end: number
  /** Comma-separated presentation tokens such as `bold` or `fg:palette:2`. */
  readonly style: string
}

/** One projected terminal screen. */
export interface TerminalState {
  /** Current columns. */
  readonly columns: number
  /** Current rows. */
  readonly rows: number
  /** Active buffer kind. */
  readonly buffer: 'normal' | 'alternate'
  /** Cursor position within the viewport. */
  readonly cursor: { readonly x: number; readonly y: number }
  /** Row text, right-trimmed. */
  readonly lines: readonly string[]
  /** Non-default style ranges. */
  readonly styles: readonly TerminalStyleRun[]
  /** Application-requested title, when the terminal recorded one. */
  readonly title?: string
  /** Application-requested progress state, when the terminal recorded one. */
  readonly progress?: boolean
  /** Application-reported program status, when any. */
  readonly programStatus?: string
}

/**
 * Read the active buffer window.
 * @param emulator - the terminal emulator.
 * @param options - `full` includes every retained buffer row instead of the viewport.
 * @returns the projected state.
 */
export function projectTerminalState(emulator: Emulator, options: { full?: boolean } = {}): TerminalState {
  const buffer = emulator.buffer.active
  const top = options.full === true ? 0 : buffer.viewportY
  const bottom = options.full === true
    ? Math.min(buffer.length, buffer.baseY + emulator.rows)
    : Math.min(buffer.length, buffer.viewportY + emulator.rows)
  const lines: string[] = []
  const styles: TerminalStyleRun[] = []
  for (let row = top; row < bottom; row += 1) {
    const line = buffer.getLine(row)
    /* v8 ignore next 4 -- the loop is clamped to buffer.length, so every retained row exists. */
    if (line === undefined) {
      lines.push('')
      continue
    }
    lines.push(line.translateToString(true))
    let runStart = -1
    let runStyle = ''
    for (let column = 0; column < emulator.cols; column += 1) {
      const cell = line.getCell(column)
      /* v8 ignore next -- an allocated row reports every column; the guard keeps a malformed emulator from crashing. */
      const style = cell === undefined ? '' : describeCell(cell)
      if (style === runStyle) continue
      if (runStart !== -1 && runStyle !== '') {
        styles.push({ row: row - top, start: runStart, end: column - 1, style: runStyle })
      }
      runStart = style === '' ? -1 : column
      runStyle = style
    }
    if (runStart !== -1 && runStyle !== '') {
      styles.push({ row: row - top, start: runStart, end: emulator.cols - 1, style: runStyle })
    }
  }
  return {
    columns: emulator.cols,
    rows: emulator.rows,
    buffer: buffer.type,
    cursor: { x: buffer.cursorX, y: buffer.cursorY },
    lines,
    styles,
  }
}

/**
 * Describe one cell's non-default presentation.
 * @param cell - the buffer cell.
 * @returns comma-separated style tokens, or an empty string for the default style.
 */
function describeCell(cell: {
  isBold(): number
  isDim(): number
  isItalic(): number
  isUnderline(): number
  isInverse(): number
  isStrikethrough(): number
  isBlink(): number
  isInvisible(): number
  isFgDefault(): boolean
  isFgPalette(): boolean
  isFgRGB(): boolean
  getFgColor(): number
  isBgDefault(): boolean
  isBgPalette(): boolean
  isBgRGB(): boolean
  getBgColor(): number
}): string {
  const parts: string[] = []
  if (cell.isBold() !== 0) parts.push('bold')
  if (cell.isDim() !== 0) parts.push('dim')
  if (cell.isItalic() !== 0) parts.push('italic')
  if (cell.isUnderline() !== 0) parts.push('underline')
  if (cell.isInverse() !== 0) parts.push('inverse')
  if (cell.isStrikethrough() !== 0) parts.push('strike')
  if (cell.isBlink() !== 0) parts.push('blink')
  if (cell.isInvisible() !== 0) parts.push('invisible')
  if (!cell.isFgDefault()) {
    parts.push(cell.isFgRGB() ? `fg:rgb:${String(cell.getFgColor())}` : `fg:palette:${String(cell.getFgColor())}`)
  }
  if (!cell.isBgDefault()) {
    parts.push(cell.isBgRGB() ? `bg:rgb:${String(cell.getBgColor())}` : `bg:palette:${String(cell.getBgColor())}`)
  }
  return parts.join(',')
}

/**
 * Report style ranges that break the terminal palette policy: no RGB colors, no
 * palette entry beyond the standard 16, and no explicit backgrounds.
 * @param state - a projected terminal state.
 * @returns one diagnostic per violating style run.
 */
export function terminalStyleViolations(state: TerminalState): string[] {
  const violations: string[] = []
  for (const run of state.styles) {
    for (const token of run.style.split(',')) {
      if (token.startsWith('bg:')) violations.push(`row ${String(run.row)}: explicit background ${token}`)
      if (token.startsWith('fg:rgb:') || token.startsWith('bg:rgb:')) {
        violations.push(`row ${String(run.row)}: truecolor ${token}`)
      }
      const palette = /^fg:palette:(\d+)$/u.exec(token)
      if (palette !== null && Number(palette[1]) > 15) {
        violations.push(`row ${String(run.row)}: palette entry ${token}`)
      }
    }
  }
  return violations
}

/**
 * Render one projected state as reviewable text.
 * @param state - the projected terminal state.
 * @returns the textual projection, newline terminated.
 */
export function formatTerminalState(state: TerminalState): string {
  const rows = [`size ${String(state.columns)}x${String(state.rows)}`, `buffer ${state.buffer}`]
  rows.push(`cursor ${String(state.cursor.x)},${String(state.cursor.y)}`)
  if (state.title !== undefined) rows.push(`title ${JSON.stringify(state.title)}`)
  if (state.progress !== undefined) rows.push(`progress ${state.progress ? 'on' : 'off'}`)
  if (state.programStatus !== undefined) rows.push(`programStatus ${state.programStatus}`)
  rows.push('lines:')
  for (const [index, line] of state.lines.entries()) {
    rows.push(`${String(index).padStart(3, ' ')}|${line}`)
  }
  if (state.styles.length > 0) {
    rows.push('styles:')
    for (const run of state.styles) {
      rows.push(`  ${String(run.row).padStart(3, ' ')} [${String(run.start)}-${String(run.end)}] ${run.style}`)
    }
  }
  return `${rows.join('\n')}\n`
}

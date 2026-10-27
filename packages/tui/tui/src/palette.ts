/**
 * The single style table of the terminal front door. Every component draws its
 * ANSI through one {@link Palette}; only the TUI and its rendering library emit
 * control sequences.
 *
 * @module @deepseek-ai/dsh-tui/palette
 */

/**
 * Named text styles the terminal interface uses. Each method returns text
 * wrapped in the matching pair of SGR sequences, or the unchanged text when
 * color is disabled.
 */
export interface Palette {
  /** Whether styling is currently enabled; a disabled palette returns every input unchanged. */
  readonly color: boolean
  /** Enable or disable styling for subsequent renders. */
  setColor(color: boolean): void
  /** Terminal default foreground; the identity style. */
  text(text: string): string
  /** Recessed secondary text. */
  dim(text: string): string
  /** Emphasized text. */
  bold(text: string): string
  /** Italic text. */
  italic(text: string): string
  /** Underlined text. */
  underline(text: string): string
  /** Reverse video, used for selections. */
  inverse(text: string): string
  /** Struck-through text. */
  strike(text: string): string
  /** Primary accent. */
  accent(text: string): string
  /** Positive outcome. */
  success(text: string): string
  /** Pending or attention state. */
  warning(text: string): string
  /** Failure state. */
  error(text: string): string
  /** Informational accent. */
  info(text: string): string
  /** Secondary accent. */
  secondary(text: string): string
  /** Hyperlink text. */
  link(text: string): string
  /** The input prompt marker. */
  prompt(text: string): string
  /** A Markdown heading. */
  heading(text: string): string
  /** Inline code or a code fence body. */
  code(text: string): string
  /** A structural rule or card frame. */
  border(text: string): string
  /** An added diff line. */
  diffAdd(text: string): string
  /** A removed diff line. */
  diffRemove(text: string): string
}

/** One open/close SGR pair in the standard 16-color namespace. */
interface Sgr {
  readonly open: string
  readonly close: string
}

const SGR = {
  bold: { open: '1', close: '22' },
  dim: { open: '2', close: '22' },
  italic: { open: '3', close: '23' },
  underline: { open: '4', close: '24' },
  inverse: { open: '7', close: '27' },
  strike: { open: '9', close: '29' },
  red: { open: '31', close: '39' },
  green: { open: '32', close: '39' },
  yellow: { open: '33', close: '39' },
  blue: { open: '34', close: '39' },
  magenta: { open: '35', close: '39' },
  cyan: { open: '36', close: '39' },
  link: { open: '4;34', close: '24;39' },
} as const satisfies Record<string, Sgr>

/**
 * Create the palette for one terminal session.
 * @param color - whether styling is enabled (`color: false` removes all styling).
 * @returns the style table every terminal component uses.
 */
export function createPalette(color: boolean): Palette {
  let enabled = color
  const wrap = (sgr: Sgr) => (text: string): string =>
    enabled ? `\u001b[${sgr.open}m${text}\u001b[${sgr.close}m` : text
  const identity = (text: string): string => text
  return {
    get color(): boolean { return enabled },
    setColor(next: boolean): void { enabled = next },
    text: identity,
    dim: wrap(SGR.dim),
    bold: wrap(SGR.bold),
    italic: wrap(SGR.italic),
    underline: wrap(SGR.underline),
    inverse: wrap(SGR.inverse),
    strike: wrap(SGR.strike),
    accent: wrap(SGR.cyan),
    success: wrap(SGR.green),
    warning: wrap(SGR.yellow),
    error: wrap(SGR.red),
    info: wrap(SGR.blue),
    secondary: wrap(SGR.magenta),
    link: wrap(SGR.link),
    prompt: text => wrap(SGR.bold)(wrap(SGR.cyan)(text)),
    heading: text => wrap(SGR.bold)(wrap(SGR.cyan)(text)),
    code: wrap(SGR.cyan),
    border: wrap(SGR.dim),
    diffAdd: wrap(SGR.green),
    diffRemove: wrap(SGR.red),
  }
}

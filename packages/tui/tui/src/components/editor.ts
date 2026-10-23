/**
 * The composer: the shared pi-tui editor with the terminal prompt merged into
 * its first content line.
 *
 * @module @deepseek-ai/dsh-tui/components/editor
 */

import { Editor, truncateToWidth, visibleWidth, type EditorTheme, type TUI } from '@earendil-works/pi-tui'

/** Options for the terminal composer. */
export interface PromptEditorOptions {
  /** Styled prompt marker placed before the first input line. */
  prompt: string
  /** Dim hint shown while the editor is empty and unfocused. */
  hint: string
}

/** The terminal composer over the shared editor component. */
export class PromptEditor extends Editor {
  private promptText: string
  private hintText: string

  /**
   * @param tui - the renderer that owns focus, autocomplete, and cursor placement.
   * @param theme - editor theme derived from the terminal palette.
   * @param options - prompt and hint copy.
   */
  constructor(tui: TUI, theme: EditorTheme, options: PromptEditorOptions) {
    super(tui, theme)
    this.promptText = options.prompt
    this.hintText = options.hint
  }

  /**
   * Replace the prompt marker.
   * @param prompt - styled prompt text.
   */
  setPrompt(prompt: string): void {
    this.promptText = prompt
  }

  /**
   * Replace the empty-editor hint.
   * @param hint - dim hint text.
   */
  setHint(hint: string): void {
    this.hintText = hint
  }

  /**
   * Render the editor with the prompt on its first content line.
   * @param width - available terminal columns.
   * @returns the editor frame without its top border.
   */
  override render(width: number): string[] {
    const lines = super.render(width)
    // The shared editor always renders a top border first; the terminal prompt
    // replaces that row and merges with the first content line.
    const withoutTop = lines.slice(1)
    const promptWidth = visibleWidth(this.promptText)
    const bodyWidth = Math.max(1, width - promptWidth)
    /* v8 ignore next 2 -- pi-tui's editor always renders a content line after its top border */
    if (withoutTop.length === 0) return [this.promptText]
    /* v8 ignore next -- slice after the always-present top border always has its content line */
    const first = withoutTop[0] ?? ''
    if (this.getText() === '' && !this.focused) {
      withoutTop[0] = this.promptText + truncateToWidth(this.hintText, bodyWidth, '')
    } else {
      withoutTop[0] = this.promptText + truncateToWidth(first, bodyWidth, '')
    }
    return withoutTop
  }
}

/**
 * Bottom-dock completion: the editor's command and `@` mention suggestions
 * render below the composer, with descriptions and a scrolling window, instead
 * of the editor's built-in dropdown.
 *
 * @module @deepseek-ai/dsh-tui/completion
 */

import { matchesKey, truncateToWidth, type AutocompleteItem, type AutocompleteProvider } from '@earendil-works/pi-tui'
import { copy } from './copy.ts'
import { displayText } from './display-text.ts'
import type { PromptEditor } from './components/editor.ts'
import type { Palette } from './palette.ts'

/** Maximum suggestion rows the dock shows before scrolling. */
const MAX_VISIBLE = 8

/** Delay before recomputing suggestions after a keystroke. */
const DEBOUNCE_MS = 40

/** Values the completion controller reads from the application. */
export interface CompletionDeps {
  /** @returns the current completion provider. */
  readonly provider: () => AutocompleteProvider | undefined
  /** @returns the composer editor. */
  readonly editor: () => PromptEditor | undefined
  /** Terminal style table. */
  readonly palette: Palette
  /** Ask for a frame after a state change. */
  readonly requestRender: () => void
  /** Submit one completed command line immediately (command menu). */
  readonly submit?: (line: string) => void
}

/** Suggestion state rendered into the bottom dock. */
export class CompletionController {
  private readonly deps: CompletionDeps
  private items: readonly AutocompleteItem[] = []
  private prefix = ''
  private index = 0
  private open = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private request: AbortController | undefined
  private generation = 0

  /** @param deps - provider, editor, style, and frame readers. */
  constructor(deps: CompletionDeps) {
    this.deps = deps
  }

  /** Whether the dock currently shows suggestions. */
  get active(): boolean {
    return this.open
  }

  /** Schedule a suggestion refresh after the current keystroke. */
  schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.refresh(false) }, DEBOUNCE_MS)
  }

  /** Hide the dock and cancel pending work. */
  close(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.request?.abort()
    this.request = undefined
    if (!this.open) return
    this.open = false
    this.items = []
    this.prefix = ''
    this.deps.requestRender()
  }

  /**
   * Recompute the suggestions for the current cursor position.
   * @param force - open the dock even when the editor did not request it.
   */
  async refresh(force: boolean): Promise<void> {
    const editor = this.deps.editor()
    const provider = this.deps.provider()
    if (editor === undefined || provider === undefined) return
    this.request?.abort()
    const controller = new AbortController()
    this.request = controller
    const generation = ++this.generation
    const cursor = editor.getCursor()
    const suggestions = await provider.getSuggestions(editor.getLines(), cursor.line, cursor.col, {
      signal: controller.signal,
      force,
    }).catch(() => null)
    if (generation !== this.generation || controller.signal.aborted) return
    if (suggestions === null || suggestions.items.length === 0) {
      this.close()
      return
    }
    this.items = suggestions.items
    this.prefix = suggestions.prefix
    this.index = Math.min(this.index, this.items.length - 1)
    this.open = true
    this.deps.requestRender()
  }

  /**
   * Handle one input sequence while suggestions are open.
   * @param data - raw terminal input.
   * @returns whether the key was consumed by the dock.
   */
  handleInput(data: string): boolean {
    if (!this.open) return false
    if (matchesKey(data, 'up')) {
      this.index = (this.index + this.items.length - 1) % this.items.length
      this.deps.requestRender()
      return true
    }
    if (matchesKey(data, 'down')) {
      this.index = (this.index + 1) % this.items.length
      this.deps.requestRender()
      return true
    }
    if (matchesKey(data, 'pageUp')) {
      this.index = Math.max(0, this.index - MAX_VISIBLE)
      this.deps.requestRender()
      return true
    }
    if (matchesKey(data, 'pageDown')) {
      this.index = Math.min(this.items.length - 1, this.index + MAX_VISIBLE)
      this.deps.requestRender()
      return true
    }
    if (matchesKey(data, 'escape')) {
      this.close()
      return true
    }
    if (matchesKey(data, 'tab')) {
      this.applyCurrent(false)
      return true
    }
    if (matchesKey(data, 'enter')) {
      this.applyCurrent(true)
      return true
    }
    return false
  }

  /**
   * Insert the highlighted suggestion and close the dock.
   * @param submit - whether an accepted command completion should run immediately.
   */
  private applyCurrent(submit: boolean): void {
    const editor = this.deps.editor()
    const provider = this.deps.provider()
    const item = this.items[this.index]
    if (editor === undefined || provider === undefined || item === undefined) {
      this.close()
      return
    }
    const cursor = editor.getCursor()
    const result = provider.applyCompletion(editor.getLines(), cursor.line, cursor.col, item, this.prefix)
    editor.setText(result.lines.join('\n'))
    this.index = 0
    this.close()
    // A command completion accepted at the command position runs immediately,
    // matching the command menu; argument and mention completions only insert.
    const commandLine = `/${item.value.trim()}`
    /* v8 ignore next -- applyCompletion always returns at least the completed line */
    const resultingLine = result.lines[0]?.trimEnd() ?? ''
    const isCommand = !item.value.includes('/') && /^\/[a-z0-9:_-]+$/u.test(resultingLine)
    if (submit && isCommand && result.lines.length === 1 && resultingLine === commandLine) {
      this.deps.submit?.(commandLine)
    }
  }

  /**
   * Render the suggestion window within the dock's height.
   * @param width - available terminal columns.
   * @returns the suggestion lines.
   */
  render(width: number): string[] {
    if (!this.open || this.items.length === 0) return []
    const palette = this.deps.palette
    const lines = [truncateToWidth(palette.heading(copy.completion.title), width)]
    const visible = Math.min(MAX_VISIBLE, this.items.length)
    const start = Math.max(0, Math.min(this.index - Math.floor(visible / 2), this.items.length - visible))
    if (start > 0) lines.push(palette.dim(`  ↑ ${copy.moreRows(start)}`))
    for (let offset = 0; offset < visible; offset += 1) {
      const position = start + offset
      const item = this.items[position]
      /* v8 ignore next -- the window is clamped to the suggestion count */
      if (item === undefined) continue
      const selected = position === this.index
      const marker = selected ? palette.accent('❯') : ' '
      const label = selected ? palette.inverse(displayText(item.label)) : displayText(item.label)
      const description = item.description === undefined ? '' : `  ${palette.dim(displayText(item.description))}`
      lines.push(truncateToWidth(` ${marker} ${label}${description}`, width))
    }
    const remaining = this.items.length - (start + visible)
    if (remaining > 0) lines.push(palette.dim(`  ↓ ${copy.moreRows(remaining)}`))
    lines.push(palette.dim(truncateToWidth(` ${copy.completion.hint}`, width)))
    return lines
  }

  /** No cached renderer state beyond the suggestion list. */
  invalidate(): void {}
}

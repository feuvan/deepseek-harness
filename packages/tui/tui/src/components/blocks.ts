/**
 * Transcript block components: user and assistant messages, notices, command
 * results, and tool cards. Every block renders plain terminal lines; the
 * transcript container owns ordering and windowing.
 *
 * @module @deepseek-ai/dsh-tui/components/blocks
 */

import { Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type MarkdownTheme } from '@earendil-works/pi-tui'
import { diffLines } from 'diff'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { FileDiff, ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import { copy } from '../copy.ts'
import { displayText } from '../display-text.ts'
import type { Palette } from '../palette.ts'

/** How tool-card bodies are shown for the whole transcript. */
export type CardMode = 'collapsed' | 'expanded' | 'hidden'

/** Values every transcript block needs at render time. */
export interface BlockContext {
  /** Terminal style table. */
  readonly palette: Palette
  /** Markdown theme derived from {@link palette}. */
  readonly markdown: MarkdownTheme
  /** Collapsed body line budget for tool cards. */
  readonly previewLines: number
  /** Current global card mode, read on every render. */
  readonly cardMode: () => CardMode
}

/** A hard body bound that keeps one pathological result from exhausting the renderer. */
const MAX_BODY_LINES = 4000

/**
 * Wrap escaped text to the available width.
 * @param text - untrusted text.
 * @param width - available terminal columns.
 * @returns wrapped lines without trailing padding.
 */
function wrapPlain(text: string, width: number): string[] {
  return wrapTextWithAnsi(displayText(text), Math.max(1, width))
}

/**
 * Render harness content blocks as plain terminal lines.
 * @param content - model or tool content blocks.
 * @param width - available terminal columns.
 * @returns one entry per rendered line; unsupported block kinds are skipped.
 */
function contentLines(content: readonly ContentBlock[], width: number): string[] {
  const lines: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        lines.push(...wrapPlain(block.text, width))
        break
      case 'image':
        lines.push(`[image ${block.attachment.mediaType}]`)
        break
      case 'file':
        lines.push(`[file ${block.attachment.name}]`)
        break
      default:
        // Merge-extensible content kinds unknown to this terminal are omitted
        // rather than printed as opaque data.
        break
    }
  }
  return lines
}

/** One user-authored prompt line block. */
export class UserMessageBlock implements Component {
  private readonly text: string
  private readonly context: BlockContext

  /**
   * @param text - the user message text.
   * @param context - render values.
   */
  constructor(text: string, context: BlockContext) {
    this.text = text
    this.context = context
  }

  /**
   * Render the message with a prompt marker.
   * @param width - available terminal columns.
   * @returns the styled lines.
   */
  render(width: number): string[] {
    const marker = `${this.context.palette.prompt(copy.notice.user)} `
    const indent = ' '.repeat(visibleWidth(marker))
    const body = wrapPlain(this.text, Math.max(1, width - visibleWidth(marker)))
    /* v8 ignore next -- wrapTextWithAnsi always returns at least one line for a string body */
    if (body.length === 0) return [marker]
    return body.map((line, index) => (index === 0 ? marker : indent) + line)
  }

  /** No cached state exists, so nothing must be invalidated. */
  invalidate(): void {}
}

/** One streamed or settled assistant response block. */
export class AssistantBlock implements Component {
  private text = ''
  private reasoning = ''
  private reasoningPreview = 4
  private readonly context: BlockContext
  private readonly markdown: Markdown

  /**
   * @param context - render values.
   */
  constructor(context: BlockContext) {
    this.context = context
    this.markdown = new Markdown('', 1, 0, context.markdown)
  }

  /**
   * Replace the visible text.
   * @param text - complete current text.
   */
  setText(text: string): void {
    this.text = text
    this.markdown.setText(displayText(text))
  }

  /**
   * Replace the reasoning text.
   * @param text - complete current reasoning.
   */
  setReasoning(text: string): void {
    this.reasoning = text
  }

  /**
   * Set how many reasoning lines this block previews.
   * @param lines - line budget; `Infinity` shows the complete block.
   */
  setReasoningPreview(lines: number): void {
    this.reasoningPreview = lines
  }

  /**
   * Whether this block currently holds any visible or hidden content.
   * @returns whether any content exists.
   */
  isEmpty(): boolean {
    return this.text === '' && this.reasoning === ''
  }

  /**
   * Render reasoning and response content.
   * @param width - available terminal columns.
   * @returns the styled lines.
   */
  render(width: number): string[] {
    const lines: string[] = []
    if (this.reasoningPreview > 0 && this.reasoning !== '') {
      const palette = this.context.palette
      const wrapped = wrapTextWithAnsi(
        palette.dim(palette.italic(displayText(this.reasoning))),
        Math.max(1, width - 2),
      )
      const shown = Number.isFinite(this.reasoningPreview) ? wrapped.slice(0, this.reasoningPreview) : wrapped
      lines.push(...shown.map(line => `  ${line}`))
      if (shown.length < wrapped.length) {
        lines.push(palette.dim(`  ${copy.notice.hiddenLines(wrapped.length - shown.length)}`))
      }
      lines.push('')
    }
    lines.push(...this.markdown.render(width))
    return lines
  }

  /** Drop cached renderer state after a theme change. */
  invalidate(): void {
    this.markdown.invalidate()
  }
}

/** One dim or colored notice line. */
export class NoticeBlock implements Component {
  private readonly text: string
  private readonly context: BlockContext
  private readonly tone: 'dim' | 'warning' | 'error' | 'success'

  /**
   * @param text - the notice text, already plain.
   * @param context - render values.
   * @param tone - semantic style of the notice.
   */
  constructor(text: string, context: BlockContext, tone: 'dim' | 'warning' | 'error' | 'success' = 'dim') {
    this.text = text
    this.context = context
    this.tone = tone
  }

  /**
   * Render the notice.
   * @param width - available terminal columns.
   * @returns the styled lines.
   */
  render(width: number): string[] {
    return wrapPlain(this.text, width).map(line => this.context.palette[this.tone](line))
  }

  /** No cached state exists, so nothing must be invalidated. */
  invalidate(): void {}
}

/** One command invocation and its recorded outcome. */
export class CommandBlock implements Component {
  private readonly header: readonly string[]
  private result: { kind: 'success' | 'error'; text: string | undefined } | undefined
  private readonly context: BlockContext

  /**
   * @param name - the command name without its slash.
   * @param args - the command's raw input, when recorded.
   * @param context - render values.
   */
  constructor(name: string, args: string | undefined, context: BlockContext) {
    this.context = context
    const line = `${copy.notice.command} /${name}${args === undefined || args === '' ? '' : ` ${args}`}`
    this.header = [context.palette.accent(displayText(line))]
  }

  /**
   * Record the paired outcome.
   * @param kind - success or error.
   * @param text - optional rendered outcome text.
   */
  setResult(kind: 'success' | 'error', text: string | undefined): void {
    this.result = { kind, text }
  }

  /**
   * Render the invocation and any outcome text.
   * @param width - available terminal columns.
   * @returns the styled lines.
   */
  render(width: number): string[] {
    const lines = this.header.map(line => truncateToWidth(line, width))
    if (this.result?.text !== undefined && this.result.text.trim() !== '') {
      const tone = this.result.kind === 'error' ? 'error' : 'dim'
      for (const line of wrapPlain(this.result.text, Math.max(1, width - 2))) {
        lines.push(`  ${this.context.palette[tone](line)}`)
      }
    }
    return lines
  }

  /** No cached state exists, so nothing must be invalidated. */
  invalidate(): void {}
}

/** One tool card with a status header and a recessed body. */
export class ToolCardBlock implements Component {
  private readonly name: string
  private readonly context: BlockContext
  private call: ToolCallView | undefined
  private result: ToolResultView | undefined
  private rawResult: readonly ContentBlock[] = []
  private failed = false
  private settled = false
  private errorText: string | undefined
  private linesCache: { width: number; mode: CardMode; lines: string[] } | undefined

  /**
   * @param name - the registered tool name.
   * @param call - the call-time presentation, when the tool declares one.
   * @param context - render values.
   */
  constructor(name: string, call: ToolCallView | undefined, context: BlockContext) {
    this.name = name
    this.call = call
    this.context = context
  }

  /**
   * Record the settled result and its raw fallback content.
   * @param result - the result-time presentation, when the tool declares one.
   * @param raw - the model-facing result content.
   * @param failed - whether the result is an error.
   * @param error - optional failure identity text.
   */
  setResult(result: ToolResultView | undefined, raw: readonly ContentBlock[], failed: boolean, error: string | undefined): void {
    this.result = result
    this.rawResult = raw
    this.failed = failed
    this.errorText = error
    this.settled = true
    this.linesCache = undefined
  }

  /** Drop the cached render after a global mode change. */
  invalidate(): void {
    this.linesCache = undefined
  }

  /**
   * Render the card.
   * @param width - available terminal columns.
   * @returns the styled lines; empty when cards are hidden.
   */
  render(width: number): string[] {
    const mode = this.context.cardMode()
    const cached = this.linesCache
    if (cached !== undefined && cached.width === width && cached.mode === mode) return cached.lines
    const lines = this.buildLines(width, mode)
    this.linesCache = { width, mode, lines }
    return lines
  }

  private buildLines(width: number, mode: CardMode): string[] {
    if (mode === 'hidden') return []
    const palette = this.context.palette
    const glyph = this.settled ? '●' : '○'
    const tone = this.failed ? 'error' : this.settled ? 'success' : 'warning'
    const title = this.title()
    const header = `${glyph} ${copy.card.tool} / ${displayText(this.name)}${title === undefined ? '' : ` · ${displayText(title)}`}`
    const lines = [palette[tone](truncateToWidth(header, width))]
    const body = this.body(width)
    if (body.length === 0) return lines
    const visible = mode === 'expanded' ? body : body.slice(0, this.context.previewLines)
    for (const line of visible) lines.push(`  ${palette.dim(line)}`)
    if (visible.length < body.length) {
      lines.push(`  ${palette.dim(copy.notice.hiddenLines(body.length - visible.length))}`)
    }
    return lines
  }

  private title(): string | undefined {
    if (this.result !== undefined && this.result.title !== undefined) return this.result.title
    return this.call?.title
  }

  private body(width: number): string[] {
    const palette = this.context.palette
    const inner = Math.max(1, width - 2)
    const lines: string[] = []
    const push = (text: string): void => {
      if (lines.length >= MAX_BODY_LINES) return
      lines.push(...wrapPlain(text, inner))
    }

    if (this.call?.card === 'terminal') {
      push(`${copy.card.command} ${displayText(this.call.title)}`)
      if (this.call.description !== undefined) push(displayText(this.call.description))
      if (this.call.cwd !== undefined) push(displayText(this.call.cwd))
    } else if (this.call?.card === 'diff') {
      lines.push(...this.diffLines(this.call.diffs, inner))
    } else if (this.call?.card === 'generic') {
      if (this.call.rawInput !== undefined) push(formatValue(this.call.rawInput))
      if (this.call.content !== undefined) {
        for (const line of contentLines(this.call.content, inner)) {
          if (lines.length >= MAX_BODY_LINES) break
          lines.push(line)
        }
      }
    }

    if (this.result === undefined) {
      if (this.errorText !== undefined) push(displayText(this.errorText))
      return lines
    }

    switch (this.result.card) {
      case 'terminal':
        if (this.result.output !== undefined && this.result.output !== '') {
          for (const line of displayText(this.result.output).split('\n')) {
            if (lines.length >= MAX_BODY_LINES) break
            lines.push(truncateToWidth(line, inner))
          }
        }
        if (this.result.exitCode !== undefined && this.result.exitCode !== 0) {
          lines.push(palette.warning(`[exit ${this.result.exitCode}]`))
        } else if (this.result.signal !== undefined) {
          lines.push(palette.warning(`[${this.result.signal}]`))
        }
        break
      case 'diff':
        lines.push(...this.diffLines(this.result.diffs, inner))
        break
      case 'generic':
        if (this.result.content !== undefined) {
          for (const line of contentLines(this.result.content, inner)) {
            if (lines.length >= MAX_BODY_LINES) break
            lines.push(line)
          }
        } else {
          for (const line of contentLines(this.rawResult, inner)) {
            if (lines.length >= MAX_BODY_LINES) break
            lines.push(line)
          }
        }
        break
      case 'search':
      case 'read':
      case 'web':
      default:
        // This terminal renders no specialized card for these views and falls
        // back to the model-facing result content.
        for (const line of contentLines(this.rawResult, inner)) {
          if (lines.length >= MAX_BODY_LINES) break
          lines.push(line)
        }
        break
    }
    if (this.errorText !== undefined) push(displayText(this.errorText))
    return lines
  }

  private diffLines(diffs: readonly FileDiff[], width: number): string[] {
    const palette = this.context.palette
    const lines: string[] = []
    for (const diff of diffs) {
      lines.push(palette.bold(truncateToWidth(displayText(diff.path), width)))
      const changes = diff.oldText === null
        ? [{ added: true, removed: false, value: diff.newText }]
        : diffLines(diff.oldText, diff.newText)
      for (const change of changes) {
        if (lines.length >= MAX_BODY_LINES) break
        const prefix = change.added ? '+' : change.removed ? '-' : ' '
        const tone = change.added
          ? (text: string) => palette.diffAdd(text)
          : change.removed ? (text: string) => palette.diffRemove(text) : (text: string) => palette.dim(text)
        const body = change.value.endsWith('\n') ? change.value.slice(0, -1) : change.value
        for (const line of body.split('\n')) {
          if (lines.length >= MAX_BODY_LINES) break
          const rendered = `${prefix}${displayText(line)}`
          lines.push(tone(truncateToWidth(rendered, width)))
        }
      }
    }
    return lines
  }
}

/**
 * Serialize one value as pretty JSON.
 * @param value - the value to serialize.
 * @returns the JSON text, or undefined when JSON cannot encode the value.
 */
function jsonText(value: unknown): string | undefined {
  return JSON.stringify(value, undefined, 2)
}

/**
 * Render one structured raw-input value for a card body.
 * @param value - the value a presenter nominated for display.
 * @returns pretty JSON for objects, or the plain string.
 */
function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const serialized = jsonText(value)
    return serialized ?? String(value)
  } catch {
    // Presenters may nominate a value with a throwing `toJSON`; the card keeps
    // rendering with a printable fallback instead of failing the transcript.
    return '[unprintable value]'
  }
}

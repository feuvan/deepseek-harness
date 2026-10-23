/**
 * Modal panels for human interaction: the question flow, the one-shot approval
 * decision, and read-only text panels used by help and status.
 *
 * @module @deepseek-ai/dsh-tui/components/dialogs
 */

import {
  Input, Markdown, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi,
  type Component, type MarkdownTheme,
} from '@earendil-works/pi-tui'
import type {
  AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { copy } from '../copy.ts'
import { displayText } from '../display-text.ts'
import type { Palette } from '../palette.ts'

/**
 * Wrap plain text for one panel width.
 * @param text - untrusted text.
 * @param width - available columns.
 * @returns wrapped lines.
 */
function wrap(text: string, width: number): string[] {
  return wrapTextWithAnsi(displayText(text), Math.max(1, width))
}

/** Longest plan document the review panel shows before truncating. */
const PLAN_REVIEW_MAX_DETAIL_LINES = 24

/** One entry of the question panel's answer accumulator. */
interface AnswerState {
  selected: string[]
  custom?: string | undefined
}

/** Serialized question flow shown while the agent waits for an answer. */
export class QuestionPanel implements Component {
  private readonly request: AskUserQuestionRequest
  private readonly palette: Palette
  private readonly markdown: MarkdownTheme
  private readonly onAnswer: (answer: AskUserQuestionAnswer) => void
  private readonly onCancel: () => void
  private readonly answers = new Map<string, AnswerState>()
  private readonly customInput: Input
  private index = 0
  private cursor = 0
  private customMode = false
  private error: string | undefined
  private remainingMs: number | undefined
  private detail: Markdown | undefined
  private detailIndex = -1

  /**
   * @param request - the pending question request.
   * @param palette - terminal style table.
   * @param markdown - markdown theme for question detail.
   * @param onAnswer - receives the complete answer batch.
   * @param onCancel - receives a user cancellation.
   */
  constructor(
    request: AskUserQuestionRequest,
    palette: Palette,
    markdown: MarkdownTheme,
    onAnswer: (answer: AskUserQuestionAnswer) => void,
    onCancel: () => void,
  ) {
    this.request = request
    this.palette = palette
    this.markdown = markdown
    this.onAnswer = onAnswer
    this.onCancel = onCancel
    this.customInput = new Input()
    this.customInput.focused = true
    this.customInput.onSubmit = (value) => { this.commitCustom(value) }
    this.customInput.onEscape = () => { this.customMode = false; this.error = undefined; this.customInput.setValue('') }
  }

  /**
   * Update the visible countdown of a timed wait.
   * @param remainingMs - host-computed remaining milliseconds.
   */
  setRemaining(remainingMs: number): void {
    this.remainingMs = remainingMs
  }

  /** @returns the current question. */
  private current(): AskUserQuestionItem {
    const question = this.request.questions[this.index]
    if (question === undefined) throw new Error('question panel: index out of bounds')
    return question
  }

  /** @returns how many selectable rows the current question has. */
  private rowCount(): number {
    return (this.current().options?.length ?? 0) + (this.customEnabled() ? 1 : 0)
  }

  /** @returns the plan-review intent of the current question, when it declares one. */
  private planReview(): { approve: string } | undefined {
    const intent = this.current().intent
    return intent?.kind === 'plan-review' ? intent : undefined
  }

  /** @returns whether the free-text answer row is offered for the current question. */
  private customEnabled(): boolean {
    return this.planReview() === undefined
  }

  /** @returns the row index of the free-text answer. */
  private customRow(): number {
    return this.current().options?.length ?? 0
  }

  /** @returns whether the current question accepts multiple selections. */
  private isMulti(): boolean {
    return this.current().multiSelect === true
  }

  /**
   * Handle one input sequence while the panel has focus.
   * @param data - raw terminal input.
   */
  handleInput(data: string): void {
    if (this.customMode) {
      this.customInput.handleInput(data)
      return
    }
    if (matchesKey(data, 'up') || data === 'k') {
      this.cursor = (this.cursor + this.rowCount() - 1) % this.rowCount()
      this.error = undefined
      return
    }
    if (matchesKey(data, 'down') || data === 'j') {
      this.cursor = (this.cursor + 1) % this.rowCount()
      this.error = undefined
      return
    }
    if (matchesKey(data, 'escape')) {
      this.onCancel()
      return
    }
    if (this.isMulti() && matchesKey(data, 'space')) {
      this.toggleSelection()
      return
    }
    if (/^[1-9]$/u.test(data)) {
      const target = Number(data) - 1
      if (target < this.customRow()) {
        this.cursor = target
        if (this.isMulti()) this.toggleSelection()
        else this.selectCurrent()
      }
      return
    }
    if (this.cursor === this.customRow()) {
      if (matchesKey(data, 'enter') || data === 'c') {
        this.customMode = true
        this.error = undefined
      }
      return
    }
    if (matchesKey(data, 'enter')) this.selectCurrent()
  }

  /** Toggle one row for a multi-select question. */
  private toggleSelection(): void {
    const option = this.current().options?.[this.cursor]
    if (option === undefined) return
    const state = this.answers.get(this.current().id) ?? { selected: [] }
    state.selected = state.selected.includes(option.label)
      ? state.selected.filter(label => label !== option.label)
      : [...state.selected, option.label]
    this.answers.set(this.current().id, state)
  }

  /** Select the highlighted row and advance or submit. */
  private selectCurrent(): void {
    const question = this.current()
    /* v8 ignore start -- selectCurrent is entered only for an option row; the custom row is resolved before it */
    if (this.cursor === this.customRow()) {
      this.customMode = true
      this.error = undefined
      return
    }
    const option = question.options?.[this.cursor]
    if (option === undefined) return
    /* v8 ignore stop */
    if (this.isMulti()) {
      // Enter on a multi-select question confirms the current selection set.
      this.advance()
      return
    }
    const state = this.answers.get(question.id) ?? { selected: [] }
    state.selected = [option.label]
    state.custom = undefined
    this.answers.set(question.id, state)
    this.advance()
  }

  /**
   * Commit the free-text answer and advance or submit.
   * @param value - the typed answer.
   */
  private commitCustom(value: string): void {
    const custom = value.trim()
    this.customMode = false
    this.customInput.setValue('')
    if (custom === '') {
      this.error = 'An answer is required.'
      return
    }
    const question = this.current()
    const state = this.answers.get(question.id) ?? { selected: [] }
    state.custom = custom
    if (!this.isMulti()) state.selected = []
    this.answers.set(question.id, state)
    this.advance()
  }

  /** Move to the next question or submit the batch after validation. */
  private advance(): void {
    const question = this.current()
    const state = this.answers.get(question.id)
    if (question.options !== undefined && question.options.length > 0) {
      if (state === undefined || (state.selected.length === 0 && state.custom === undefined)) {
        this.error = 'Select at least one option.'
        return
      }
    /* v8 ignore start -- a no-option question advances only from commitCustom, which always sets a custom answer */
    } else if (state?.custom === undefined) {
      this.error = 'An answer is required.'
      return
    }
    /* v8 ignore stop */
    if (this.index + 1 < this.request.questions.length) {
      this.index += 1
      this.cursor = 0
      this.error = undefined
      return
    }
    this.onAnswer({
      answers: this.request.questions.map((item) => {
        const answer = this.answers.get(item.id)
        return {
          id: item.id,
          /* v8 ignore next -- every question in the batch holds an answer before it is emitted */
          selected: answer?.selected ?? [],
          ...(answer?.custom === undefined ? {} : { custom: answer.custom }),
        }
      }),
    })
  }

  /**
   * Render the current question.
   * @param width - available terminal columns.
   * @returns the panel lines.
   */
  render(width: number): string[] {
    const palette = this.palette
    const question = this.current()
    const lines: string[] = []
    const progress = this.request.questions.length > 1
      ? ` ${palette.dim(copy.prompt.progress(this.index + 1, this.request.questions.length))}`
      : ''
    const planReview = this.planReview()
    const title = planReview === undefined ? copy.prompt.question : copy.prompt.planReview
    const heading = question.header === undefined
      ? palette.heading(title)
      : `${palette.heading(title)} · ${displayText(question.header)}`
    lines.push(truncateToWidth(`${heading}${progress}`, width))
    for (const line of wrap(question.question, width)) lines.push(palette.bold(line))
    if (question.detail !== undefined) {
      const detail = this.detailLines(question, width, planReview === undefined ? 0 : PLAN_REVIEW_MAX_DETAIL_LINES)
      if (planReview === undefined) {
        for (const line of detail) lines.push(line)
      } else {
        lines.push(palette.border('─'.repeat(Math.max(1, width))))
        for (const line of detail) lines.push(line)
        lines.push(palette.border('─'.repeat(Math.max(1, width))))
      }
    }
    lines.push('')
    const options = question.options ?? []
    for (const [index, option] of options.entries()) {
      const cursor = index === this.cursor && !this.customMode
      const state = this.answers.get(question.id)
      const checked = state?.selected.includes(option.label) === true
      const marker = this.isMulti() ? (checked ? '[x]' : '[ ]') : (cursor ? '❯' : ' ')
      const verdict = planReview === undefined
        ? ''
        : `${option.label === planReview.approve ? palette.success(copy.prompt.approveMark) : palette.error(copy.prompt.declineMark)} `
      const label = `${cursor && !this.isMulti() ? palette.accent('❯') : marker} ${verdict}${displayText(option.label)}`
      lines.push(truncateToWidth(` ${label}`, width))
      if (option.description !== undefined) {
        for (const line of wrap(option.description, Math.max(1, width - 6))) {
          lines.push(`   ${palette.dim(line)}`)
        }
      }
    }
    if (this.customMode) {
      const prompt = this.palette.accent('› ')
      const rendered = this.customInput.render(Math.max(1, width - visibleWidth(prompt) - 1))
      /* v8 ignore next -- pi-tui's Input always renders a row */
      lines.push(`  ${prompt}${truncateToWidth(rendered[0] ?? '', Math.max(1, width - 3))}`)
    } else if (this.customEnabled()) {
      const cursor = this.cursor === this.customRow()
      const marker = cursor ? palette.accent('❯') : ' '
      lines.push(truncateToWidth(` ${marker} ${displayText(copy.prompt.custom)}`, width))
    }
    if (this.error !== undefined) lines.push(palette.error(truncateToWidth(` ${this.error}`, width)))
    lines.push('')
    const hint = this.customMode
      ? copy.prompt.customHint
      : planReview !== undefined
        ? copy.prompt.planReviewHint
        : this.isMulti() ? copy.prompt.multiHint : copy.prompt.selectHint
    lines.push(palette.dim(truncateToWidth(` ${hint}`, width)))
    if (this.remainingMs !== undefined) {
      lines.push(palette.warning(truncateToWidth(` ${Math.max(0, Math.ceil(this.remainingMs / 1000))}s left`, width)))
    }
    return lines
  }

  /**
   * Render the question detail lazily for the current index.
   * @param question - the current question.
   * @param width - available columns.
   * @returns detail lines.
   */
  private detailLines(question: AskUserQuestionItem, width: number, maxLines: number): string[] {
    if (this.detail === undefined || this.detailIndex !== this.index) {
      /* v8 ignore next -- detailLines is called only when the question carries a detail */
      this.detail = new Markdown(displayText(question.detail ?? ''), 0, 0, this.markdown)
      this.detailIndex = this.index
    }
    const rendered = this.detail.render(Math.max(1, width - 2)).map(line => `  ${line}`)
    if (maxLines === 0 || rendered.length <= maxLines) return rendered
    const visible = rendered.slice(0, maxLines)
    visible.push(this.palette.dim(truncateToWidth(`  ${copy.prompt.planTruncated}`, width)))
    return visible
  }

  /** No cached state exists beyond the detail renderer, so nothing must be invalidated. */
  invalidate(): void {}
}

/** One allow-once/reject decision panel for a pending approval request. */
export class ApprovalPanel implements Component {
  private readonly palette: Palette
  private readonly toolName: string
  private readonly reason: string | undefined
  private readonly onDecision: (outcome: ApprovalOutcome) => void

  /**
   * @param toolName - the tool whose action requires a decision.
   * @param reason - the asker's reason, already localized when available.
   * @param palette - terminal style table.
   * @param onDecision - receives the decision; Esc settles as cancelled.
   */
  constructor(toolName: string, reason: string | undefined, palette: Palette, onDecision: (outcome: ApprovalOutcome) => void) {
    this.toolName = toolName
    this.reason = reason
    this.palette = palette
    this.onDecision = onDecision
  }

  /**
   * Handle one input sequence while the panel has focus.
   * @param data - raw terminal input.
   */
  handleInput(data: string): void {
    if (matchesKey(data, 'escape')) {
      this.onDecision('cancelled')
      return
    }
    if (matchesKey(data, 'enter') || data === 'y' || data === 'a') {
      this.onDecision('allowed-once')
      return
    }
    if (data === 'n' || data === 'r') this.onDecision('rejected')
  }

  /**
   * Render the decision.
   * @param width - available terminal columns.
   * @returns the panel lines.
   */
  render(width: number): string[] {
    const palette = this.palette
    const lines = [
      palette.warning(truncateToWidth(copy.prompt.approval, width)),
      truncateToWidth(` ${copy.card.tool} / ${displayText(this.toolName)}`, width),
    ]
    if (this.reason !== undefined && this.reason !== '') {
      for (const line of wrap(this.reason, Math.max(1, width - 2))) lines.push(` ${palette.dim(line)}`)
    }
    lines.push('')
    lines.push(truncateToWidth(` ${palette.success('[a]')} ${displayText(copy.prompt.allow)}   ${palette.error('[r]')} ${displayText(copy.prompt.reject)}`, width))
    return lines
  }

  /** No cached state exists, so nothing must be invalidated. */
  invalidate(): void {}
}

/** A read-only dock panel that closes on Esc or Enter and scrolls long bodies. */
export class TextPanel implements Component {
  private readonly title: string
  private readonly body: readonly string[]
  private readonly palette: Palette
  private readonly onClose: () => void
  private readonly maxVisible: number
  private offset = 0

  /**
   * @param title - panel heading.
   * @param lines - already-styled body lines; newlines split into rows.
   * @param palette - terminal style table.
   * @param onClose - closes the panel.
   * @param maxVisible - body rows shown at once before scrolling.
   */
  constructor(title: string, lines: readonly string[], palette: Palette, onClose: () => void, maxVisible = 12) {
    this.title = title
    this.palette = palette
    this.onClose = onClose
    this.maxVisible = Math.max(1, maxVisible)
    this.body = lines.flatMap(line => line.split('\n'))
  }

  /**
   * Handle one input sequence while the panel has focus.
   * @param data - raw terminal input.
   */
  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'enter') || data === 'q') {
      this.onClose()
      return
    }
    if (matchesKey(data, 'up')) {
      this.offset = Math.max(0, this.offset - 1)
      return
    }
    if (matchesKey(data, 'down')) {
      this.offset = Math.min(Math.max(0, this.body.length - this.maxVisible), this.offset + 1)
      return
    }
    if (matchesKey(data, 'pageUp')) {
      this.offset = Math.max(0, this.offset - this.maxVisible)
      return
    }
    if (matchesKey(data, 'pageDown')) {
      this.offset = Math.min(Math.max(0, this.body.length - this.maxVisible), this.offset + this.maxVisible)
    }
  }

  /**
   * Render the titled, scrollable panel.
   * @param width - available terminal columns.
   * @returns the panel lines, truncated to the panel width.
   */
  render(width: number): string[] {
    const palette = this.palette
    const lines = [palette.heading(truncateToWidth(this.title, width))]
    const visible = Math.min(this.maxVisible, this.body.length)
    if (this.offset > 0) lines.push(palette.dim(`  ↑ ${copy.moreRows(this.offset)}`))
    for (let index = 0; index < visible; index += 1) {
      const line = this.body[this.offset + index]
      /* v8 ignore next -- the window is clamped to the body length */
      if (line === undefined) continue
      lines.push(truncateToWidth(line, width))
    }
    const remaining = this.body.length - (this.offset + visible)
    if (remaining > 0) lines.push(palette.dim(`  ↓ ${copy.moreRows(remaining)}`))
    lines.push('', palette.dim(truncateToWidth(copy.panel.scrollHint, width)))
    return lines
  }

  /** No cached renderer state exists beyond the scroll offset. */
  invalidate(): void {}
}

/**
 * Durable and live transcript assembly: append-origin Session events fold into
 * ordered blocks, and transient assistant frames update the block a later
 * settlement replaces.
 *
 * @module @deepseek-ai/dsh-tui/transcript
 */

import { Container, type MarkdownTheme } from '@earendil-works/pi-tui'
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { joinAssistantStreamText } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { copy } from './copy.ts'
import { AssistantBlock, CommandBlock, NoticeBlock, ToolCardBlock, UserMessageBlock, type BlockContext, type CardMode } from './components/blocks.ts'
import type { Palette } from './palette.ts'

/** Values the transcript needs from the terminal application. */
export interface TerminalTranscriptDeps {
  /** Terminal style table. */
  readonly palette: Palette
  /** Markdown theme. */
  readonly markdown: MarkdownTheme
  /** Collapsed tool-card body budget. */
  readonly previewLines: number
  /** Maximum blocks kept rendered. */
  readonly windowBlocks: number
  /** Ask the renderer for a frame. */
  readonly requestRender: () => void
  /**
   * Resolve the tool definition that executed, scoped to the presented Agent.
   * @param name - registered tool name.
   * @returns the definition, or undefined when the tool is gone.
   */
  readonly findTool: (name: string) => ToolDefinition | undefined
}

/**
 * Parse one `tool/call` argument string the way the executor does.
 * @param raw - the raw JSON string recorded in the log.
 * @returns the parsed value, `{}` for an empty string, or the raw string when it
 * is not valid JSON.
 */
export function parseToolArguments(raw: string): unknown {
  if (raw.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed
  } catch {
    return raw
  }
}

/** One pending assistant block keyed by its attempt. */
interface PendingAssistant {
  readonly block: AssistantBlock
  readonly turn: number
  readonly step: number
  text: string
  reasoning: string
}

/** A tool card awaiting its result, keyed by call id. */
interface PendingTool {
  readonly block: ToolCardBlock
  readonly args: unknown
  readonly name: string
}

/** Ordered transcript blocks with durable-event folding and windowing. */
export class TerminalTranscript {
  /** The component the scroll view hosts. */
  readonly component = new Container()
  private readonly deps: TerminalTranscriptDeps
  private readonly context: BlockContext
  private readonly blocks: (UserMessageBlock | AssistantBlock | NoticeBlock | CommandBlock | ToolCardBlock)[] = []
  private readonly pendingAssistants = new Map<string, PendingAssistant>()
  private readonly attemptByStep = new Map<string, string>()
  private readonly pendingTools = new Map<string, PendingTool>()
  private agent: Agent | undefined
  private mode: CardMode = 'collapsed'
  private reasoningVisible = true
  private turnStart: number | undefined

  /**
   * @param deps - terminal values and tool lookup.
   */
  constructor(deps: TerminalTranscriptDeps) {
    this.deps = deps
    this.context = {
      palette: deps.palette,
      markdown: deps.markdown,
      previewLines: deps.previewLines,
      cardMode: () => this.mode,
    }
  }

  /**
   * Bind the Agent whose tools present calls and results.
   * @param agent - the presented live root Agent.
   */
  setAgent(agent: Agent): void {
    this.agent = agent
  }

  /**
   * The wall-clock time the current turn started.
   * @returns epoch milliseconds while a turn runs, otherwise undefined.
   */
  turnStartedAt(): number | undefined {
    return this.turnStart
  }

  /** Remove every rendered block and pending pairing. */
  clear(): void {
    this.blocks.length = 0
    this.pendingAssistants.clear()
    this.attemptByStep.clear()
    this.pendingTools.clear()
    this.turnStart = undefined
    this.component.clear()
    this.deps.requestRender()
  }

  /** Cycle the global card mode: collapsed → expanded → hidden. */
  toggleCards(): void {
    this.mode = this.mode === 'collapsed' ? 'expanded' : this.mode === 'expanded' ? 'hidden' : 'collapsed'
    for (const block of this.blocks) block.invalidate()
    this.deps.requestRender()
  }

  /**
   * Append a terminal-only notice that is never written to the Session log.
   * @param text - the notice text.
   * @param tone - semantic style of the notice.
   */
  notice(text: string, tone: 'dim' | 'warning' | 'error' | 'success' = 'dim'): void {
    this.appendBlock(new NoticeBlock(text, this.context, tone))
  }

  /** Toggle reasoning visibility for every assistant block. */
  toggleReasoning(): void {
    this.reasoningVisible = !this.reasoningVisible
    for (const block of this.blocks) {
      if (block instanceof AssistantBlock) block.setReasoningVisible(this.reasoningVisible)
    }
    this.deps.requestRender()
  }

  /**
   * Append one committed Session event.
   * @param event - the durable event in log order.
   */
  append(event: SessionEvent): void {
    switch (event.type) {
      case 'user/message':
        this.appendUserMessage(event.data)
        break
      case 'assistant/message':
        this.appendAssistantMessage(event.data)
        break
      case 'assistant/attempt':
        this.appendAttempt(event.data)
        break
      case 'tool/call':
        this.appendToolCall(event.data)
        break
      case 'tool/result':
        this.appendToolResult(event.data)
        break
      case 'command/run':
        this.appendBlock(new CommandBlock(event.data.name, event.data.args, this.context))
        break
      case 'command/done': {
        const block = this.blocks.findLast(item => item instanceof CommandBlock)
        block?.setResult(event.data.kind, event.data.text)
        this.deps.requestRender()
        break
      }
      case 'turn/start':
        this.turnStart = Date.now()
        this.deps.requestRender()
        break
      case 'turn/end':
        this.turnStart = undefined
        this.appendTurnEnd(event.data.reason)
        break
      case 'compaction/summary': {
        const tokens = event.data.shadowedTokenCount
        this.appendBlock(new NoticeBlock(`${copy.notice.compacted} (${String(tokens)} tokens)`, this.context))
        break
      }
      case 'compaction/end':
        if (event.data.error !== undefined) {
          this.appendBlock(new NoticeBlock(`${copy.notice.compactionFailed}: ${event.data.error}`, this.context, 'warning'))
        }
        break
      default:
        break
    }
  }

  /**
   * Apply one transient assistant frame.
   * @param frame - the process-local start, chunk, or end frame.
   */
  live(frame: AssistantStreamFrame): void {
    if (this.agent === undefined) return
    if (frame.type === 'start') {
      const stepKey = `${String(frame.turn)}:${String(frame.step)}`
      this.dropPendingStep(stepKey)
      const block = new AssistantBlock(this.context)
      block.setReasoningVisible(this.reasoningVisible)
      const pending: PendingAssistant = { block, turn: frame.turn, step: frame.step, text: '', reasoning: '' }
      const attemptId = String(frame.attemptId)
      this.pendingAssistants.set(attemptId, pending)
      this.attemptByStep.set(stepKey, attemptId)
      this.appendBlock(block)
      return
    }
    const attemptId = String(frame.attemptId)
    const pending = this.pendingAssistants.get(attemptId)
    if (pending === undefined) return
    if (frame.type === 'chunk') {
      if (frame.chunk.type === 'text-delta') {
        pending.text += frame.chunk.text
        pending.block.setText(pending.text)
      } else if (frame.chunk.type === 'reasoning-delta') {
        pending.reasoning += frame.chunk.text
        pending.block.setReasoning(pending.reasoning)
      }
      this.deps.requestRender()
      return
    }
    if (frame.outcome.kind === 'abandoned') this.dropPendingAttempt(attemptId)
  }

  /**
   * The ordered block components, for tests and diagnostics.
   * @returns one constructor name per rendered block.
   */
  renderedBlocks(): readonly string[] {
    return this.blocks.map(block => block.constructor.name)
  }

  /**
   * Append one user-role message when it belongs to the human transcript.
   * @param message - the durable user message.
   */
  private appendUserMessage(message: UserMessage): void {
    const source = message.source
    if (source.kind === 'model-selection') {
      const text = textOf(message.content)
      if (text !== '') this.appendBlock(new NoticeBlock(text, this.context))
      return
    }
    if (source.kind !== 'user' && source.kind !== 'user-question-reply') return
    const text = textOf(message.content)
    if (text === '') return
    this.appendBlock(new UserMessageBlock(text, this.context))
  }

  /**
   * Append a settled assistant message, replacing the live block of its step.
   * @param data - the durable message payload.
   */
  private appendAssistantMessage(data: {
    turn: number
    step: number
    message: { content: readonly ContentBlock[] }
    interrupted?: true
  }): void {
    this.dropPendingStep(`${String(data.turn)}:${String(data.step)}`)
    const text = textOf(data.message.content, 'text')
    const reasoning = textOf(data.message.content, 'reasoning')
    if (text === '' && reasoning === '') return
    const block = new AssistantBlock(this.context)
    block.setReasoningVisible(this.reasoningVisible)
    if (reasoning !== '') block.setReasoning(reasoning)
    block.setText(text)
    this.appendBlock(block)
    if (data.interrupted === true) {
      this.appendBlock(new NoticeBlock(copy.notice.interrupted, this.context, 'warning'))
    }
  }

  /**
   * Append a failed attempt's content as a dim notice.
   * @param data - the durable attempt payload.
   */
  private appendAttempt(data: { stream: readonly import('@deepseek-ai/dsh-llm').AssistantStreamRecord[] }): void {
    const text = joinAssistantStreamText(data.stream)
    if (text !== '') this.appendBlock(new NoticeBlock(text, this.context))
  }

  /**
   * Append a pending tool card and pair it with its call id.
   * @param data - the durable call payload.
   */
  private appendToolCall(data: { callId: string; name: string; arguments: string }): void {
    const args = parseToolArguments(data.arguments)
    const definition = this.deps.findTool(data.name)
    const view = presenterCall(definition, args)
    const block = new ToolCardBlock(data.name, view, this.context)
    this.pendingTools.set(data.callId, { block, args, name: data.name })
    this.appendBlock(block)
  }

  /**
   * Settle the card paired with a tool result.
   * @param data - the durable result payload.
   */
  private appendToolResult(data: {
    message: { content: readonly ContentBlock[]; toolCallId: string; isError?: boolean }
    error?: { name: string; code: string; reason?: string }
    meta?: JsonValue
  }): void {
    const callId = data.message.toolCallId
    const pending = this.pendingTools.get(callId)
    if (pending !== undefined) this.pendingTools.delete(callId)
    const name = pending?.name ?? 'tool'
    const args = pending?.args
    const definition = this.deps.findTool(name)
    const result = presenterResult(definition, args, [...data.message.content], data.message.isError === true, data.meta)
    const errorText = data.error === undefined
      ? undefined
      : `${data.error.code}: ${data.error.reason ?? data.error.name}`
    if (pending === undefined) {
      const block = new ToolCardBlock(name, undefined, this.context)
      block.setResult(result, data.message.content, data.message.isError === true, errorText)
      this.appendBlock(block)
      return
    }
    pending.block.setResult(result, data.message.content, data.message.isError === true, errorText)
    this.deps.requestRender()
  }

  /**
   * Append a notice for a turn that did not complete normally.
   * @param reason - the recorded turn end reason.
   */
  private appendTurnEnd(reason: TurnEndReason): void {
    switch (reason.kind) {
      case 'completed':
        this.deps.requestRender()
        return
      case 'aborted':
        this.appendBlock(new NoticeBlock(`Turn ended: aborted (${reason.reason.kind}).`, this.context, 'warning'))
        return
      case 'blocked':
        this.appendBlock(new NoticeBlock('Turn ended: blocked.', this.context, 'warning'))
        return
      case 'error':
        this.appendBlock(new NoticeBlock(`Turn failed: ${reason.error.code}: ${reason.error.message}`, this.context, 'error'))
        return
      case 'max-tokens':
        this.appendBlock(new NoticeBlock('Turn ended: output token ceiling reached.', this.context, 'warning'))
        return
      case 'interrupted':
        this.appendBlock(new NoticeBlock('Turn ended: interrupted.', this.context, 'warning'))
        return
      case 'forked':
        this.appendBlock(new NoticeBlock('Turn ended: fork seed boundary.', this.context))
        return
      default:
        this.appendBlock(new NoticeBlock(`Turn ended: ${(reason as { kind: string }).kind}.`, this.context, 'warning'))
    }
  }

  /**
   * Remove the pending live block recorded for one step.
   * @param stepKey - `turn:step` pairing key.
   */
  private dropPendingStep(stepKey: string): void {
    const attemptId = this.attemptByStep.get(stepKey)
    if (attemptId === undefined) return
    this.dropPendingAttempt(attemptId)
  }

  /**
   * Remove one pending live block by attempt.
   * @param attemptId - the attempt identity.
   */
  private dropPendingAttempt(attemptId: string): void {
    const pending = this.pendingAssistants.get(attemptId)
    /* v8 ignore next -- every attempt id reaching here came from the same pending map */
    if (pending === undefined) return
    this.pendingAssistants.delete(attemptId)
    this.attemptByStep.delete(`${String(pending.turn)}:${String(pending.step)}`)
    this.removeBlock(pending.block)
  }

  /**
   * Append one block and trim the rendered window.
   * @param block - the block component.
   */
  private appendBlock(block: UserMessageBlock | AssistantBlock | NoticeBlock | CommandBlock | ToolCardBlock): void {
    this.blocks.push(block)
    this.component.addChild(block)
    while (this.blocks.length > this.deps.windowBlocks) {
      const removed = this.blocks.shift()
      /* v8 ignore next -- the loop condition proves the shifted list is non-empty */
      if (removed !== undefined) this.component.removeChild(removed)
    }
    this.deps.requestRender()
  }

  /**
   * Remove one block from the render tree and the ordered list.
   * @param block - the block to remove.
   */
  private removeBlock(block: UserMessageBlock | AssistantBlock | NoticeBlock | CommandBlock | ToolCardBlock): void {
    this.component.removeChild(block)
    const index = this.blocks.indexOf(block)
    if (index !== -1) this.blocks.splice(index, 1)
    this.deps.requestRender()
  }
}

/**
 * Concatenate the text blocks of one content list.
 * @param content - message content blocks.
 * @param kind - block kind to read; defaults to text.
 * @returns the joined plain text.
 */
function textOf(content: readonly ContentBlock[], kind: 'text' | 'reasoning' = 'text'): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === kind) parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * Run one call presenter without letting a malformed presenter break the transcript.
 * @param definition - the executed tool definition, when known.
 * @param args - parsed call arguments.
 * @returns the call presentation, when the tool declares one.
 */
function presenterCall(definition: ToolDefinition | undefined, args: unknown) {
  if (definition?.presentCall === undefined) return undefined
  try {
    return definition.presentCall(args)
  } catch {
    return undefined
  }
}

/**
 * Run one result presenter without letting a malformed presenter break the transcript.
 * @param definition - the executed tool definition, when known.
 * @param args - parsed call arguments.
 * @param content - model-facing result content.
 * @param isError - whether the result is an error.
 * @param meta - persisted presentation metadata.
 * @returns the result presentation, when the tool declares one.
 */
function presenterResult(
  definition: ToolDefinition | undefined,
  args: unknown,
  content: ContentBlock[],
  isError: boolean,
  meta: JsonValue | undefined,
) {
  if (definition?.presentResult === undefined) return undefined
  try {
    return definition.presentResult(args, {
      content,
      isError,
      ...(meta === undefined ? {} : { meta }),
    })
  } catch {
    return undefined
  }
}

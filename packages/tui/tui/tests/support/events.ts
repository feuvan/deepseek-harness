/**
 * Session-event builders for terminal tests: each builder returns one durable
 * event with the envelope fields the transcript reads.
 *
 * @module tests/support/events
 */

import { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-user-questions'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { CompactionId } from '@deepseek-ai/dsh-compaction'

/**
 * Build one user message event.
 * @param seq - event sequence.
 * @param text - message text.
 * @param source - message source; defaults to a human prompt.
 * @returns the durable event.
 */
export function userMessage(seq: number, text: string, source: UserMessage['source'] = { kind: 'user' }): SessionEvent<'user/message'> {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: seq,
    surfaceOp: 'append',
    data: createUserMessage({ content: [{ type: 'text', text }], source }),
  }
}

/**
 * Build one settled assistant message event.
 * @param seq - event sequence.
 * @param turn - owning turn.
 * @param step - owning step.
 * @param content - assistant content blocks.
 * @param extra - optional interruption marker.
 * @returns the durable event.
 */
export function assistantMessage(
  seq: number,
  turn: number,
  step: number,
  content: readonly ContentBlock[],
  extra: { interrupted?: true } = {},
): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq: SessionSeq(seq),
    time: seq,
    surfaceOp: 'append',
    data: {
      turn,
      step,
      message: createAssistantMessage({ content, source: { provider: 'test', model: 'test' } }),
      stream: [],
      ...extra,
    },
  }
}

/**
 * Build one failed-attempt event whose stream holds the settled text.
 * @param seq - event sequence.
 * @param turn - owning turn.
 * @param step - owning step.
 * @param text - the attempt text.
 * @returns the durable event.
 */
export function assistantAttempt(seq: number, turn: number, step: number, text: string): SessionEvent<'assistant/attempt'> {
  return {
    type: 'assistant/attempt',
    seq: SessionSeq(seq),
    time: seq,
    data: {
      turn,
      step,
      stream: [{ type: 'text-chunks', time0: seq, index: 0, dt: [], texts: [text] }],
    },
  }
}

/**
 * Build one tool call event.
 * @param seq - event sequence.
 * @param turn - owning turn.
 * @param step - owning step.
 * @param callId - tool call identity.
 * @param name - registered tool name.
 * @param args - raw argument JSON string.
 * @returns the durable event.
 */
export function toolCall(seq: number, turn: number, step: number, callId: string, name: string, args: string): SessionEvent<'tool/call'> {
  return {
    type: 'tool/call',
    seq: SessionSeq(seq),
    time: seq,
    data: { turn, step, callId: ToolCallId(callId), name, arguments: args },
  }
}

/**
 * Build one tool result event.
 * @param seq - event sequence.
 * @param turn - owning turn.
 * @param step - owning step.
 * @param callId - answered call identity.
 * @param content - result content.
 * @param options - failure switch and presentation metadata.
 * @returns the durable event.
 */
export function toolResult(
  seq: number,
  turn: number,
  step: number,
  callId: string,
  content: readonly ContentBlock[],
  options: { isError?: boolean; meta?: import('@deepseek-ai/dsh-util-values').JsonValue } = {},
): SessionEvent<'tool/result'> {
  return {
    type: 'tool/result',
    seq: SessionSeq(seq),
    time: seq,
    surfaceOp: 'append',
    data: {
      turn,
      step,
      message: createToolResultMessage({ callId: ToolCallId(callId), content, isError: options.isError === true }),
      ...(options.meta === undefined ? {} : { meta: options.meta }),
    },
  }
}

/**
 * Build one turn start event.
 * @param seq - event sequence.
 * @param turn - turn number.
 * @returns the durable event.
 */
export function turnStart(seq: number, turn: number): SessionEvent<'turn/start'> {
  return { type: 'turn/start', seq: SessionSeq(seq), time: seq, data: { turn } }
}

/**
 * Build one turn end event.
 * @param seq - event sequence.
 * @param turn - turn number.
 * @param reason - why the turn ended.
 * @returns the durable event.
 */
export function turnEnd(seq: number, turn: number, reason: TurnEndReason = { kind: 'completed' }): SessionEvent<'turn/end'> {
  return { type: 'turn/end', seq: SessionSeq(seq), time: seq, data: { turn, reason } }
}

/**
 * Build one command invocation event.
 * @param seq - event sequence.
 * @param name - command name without its slash.
 * @param args - verbatim command input.
 * @returns the durable event.
 */
export function commandRun(seq: number, name: string, args?: string): SessionEvent<'command/run'> {
  return {
    type: 'command/run',
    seq: SessionSeq(seq),
    time: seq,
    data: { commandId: CommandId(`command-${String(seq)}`), name, ...(args === undefined ? {} : { args }), source: { kind: 'user' } },
  }
}

/**
 * Build one command outcome event.
 * @param seq - event sequence.
 * @param kind - success or error.
 * @param text - rendered outcome.
 * @returns the durable event.
 */
export function commandDone(seq: number, kind: 'success' | 'error', text?: string): SessionEvent<'command/done'> {
  return {
    type: 'command/done',
    seq: SessionSeq(seq),
    time: seq,
    data: { commandId: CommandId(`command-${String(seq - 1)}`), kind, ...(text === undefined ? {} : { text }) },
  }
}

/**
 * Build one compaction summary event.
 * @param seq - event sequence.
 * @param tokens - shadowed token count.
 * @returns the durable event.
 */
export function compactionSummary(seq: number, tokens: number): SessionEvent<'compaction/summary'> {
  return {
    type: 'compaction/summary',
    seq: SessionSeq(seq),
    time: seq,
    data: {
      compactionId: CompactionId(`compaction-${String(seq)}`),
      summary: [],
      shadowedRange: { start: SessionSeq(0), end: SessionSeq(0) },
      shadowedSeqs: [],
      shadowedTokenCount: tokens,
      provider: 'test',
      model: 'test',
    },
  }
}

/**
 * Build one compaction failure event.
 * @param seq - event sequence.
 * @param error - the failure text.
 * @returns the durable event.
 */
export function compactionEnd(seq: number, error?: string): SessionEvent<'compaction/end'> {
  return {
    type: 'compaction/end',
    seq: SessionSeq(seq),
    time: seq,
    data: { compactionId: CompactionId(`compaction-${String(seq)}`), turn: null, ...(error === undefined ? {} : { error }) },
  }
}

/**
 * Build one title event.
 * @param seq - event sequence.
 * @param title - the recorded title.
 * @returns the durable event.
 */
export function sessionTitle(seq: number, title: string): SessionEvent<'session/title'> {
  return { type: 'session/title', seq: SessionSeq(seq), time: seq, data: { title, messageSeqs: [], source: { kind: 'user' } } }
}

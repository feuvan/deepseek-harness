import { describe, expect, it, vi } from 'vitest'
import { LlmAttemptId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { TerminalTranscript, parseToolArguments } from '../../src/transcript.ts'
import type { TerminalTranscriptDeps } from '../../src/transcript.ts'
import { copy } from '../../src/copy.ts'
import { testTool } from '../support/fakes.ts'
import {
  assistantAttempt, assistantMessage, commandDone, commandRun, compactionEnd,
  compactionSummary, sessionTitle, toolCall, toolResult, turnEnd, turnStart, userMessage,
} from '../support/events.ts'
import { agentDouble, transcriptDeps } from './harness.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'terminal-test': { kind: 'terminal-test' }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface TurnEndReasonMap {
    synthetic: { kind: 'synthetic' }
  }
}

/** One transcript under test with its render spy. */
interface TranscriptHarness {
  readonly transcript: TerminalTranscript
  readonly requestRender: ReturnType<typeof vi.fn>
}

/**
 * Build one transcript over plain dependencies.
 * @param overrides - dependency values to replace.
 * @returns the transcript and its render spy.
 */
function transcriptHarness(overrides: Partial<TerminalTranscriptDeps> = {}): TranscriptHarness {
  const requestRender = vi.fn()
  const transcript = new TerminalTranscript(transcriptDeps({ requestRender, ...overrides }))
  return { transcript, requestRender }
}

/**
 * Bind a live Agent to the transcript so transient frames apply.
 * @param transcript - the transcript.
 */
function bindAgent(transcript: TerminalTranscript): void {
  transcript.setAgent(agentDouble({ session: Session.create(SessionId('transcript-agent')) }).agent)
}

/** @returns the rendered text of a transcript's block container. */
function renderedText(transcript: TerminalTranscript): string {
  return transcript.component.render(80).join('\n')
}

/**
 * Build one assistant stream start frame.
 * @param attemptId - raw attempt identity.
 * @param turn - owning turn.
 * @param step - owning step.
 * @returns the frame.
 */
function startFrame(attemptId: string, turn = 1, step = 1): AssistantStreamFrame {
  return { type: 'start', attemptId: LlmAttemptId(attemptId), revision: 1, turn, step }
}

/**
 * Build one assistant stream chunk frame.
 * @param attemptId - raw attempt identity.
 * @param chunk - the published chunk.
 * @returns the frame.
 */
function chunkFrame(attemptId: string, chunk: StreamChunk): AssistantStreamFrame {
  return { type: 'chunk', attemptId: LlmAttemptId(attemptId), revision: 1, index: 0, time: 0, chunk }
}

/**
 * Build one assistant stream end frame.
 * @param attemptId - raw attempt identity.
 * @param abandoned - whether the attempt ended without a settlement.
 * @returns the frame.
 */
function endFrame(attemptId: string, abandoned: boolean): AssistantStreamFrame {
  return {
    type: 'end',
    attemptId: LlmAttemptId(attemptId),
    revision: 1,
    index: 0,
    outcome: abandoned ? { kind: 'abandoned' } : { kind: 'committed', eventType: 'assistant/message', seq: SessionSeq(1) },
  }
}

/**
 * Build one tool result carrying durable failure identity.
 * @param seq - event sequence.
 * @param turn - owning turn.
 * @param step - owning step.
 * @param callId - answered call identity.
 * @param content - result content.
 * @param error - failure identity.
 * @returns the durable event.
 */
function failedToolResult(
  seq: number,
  turn: number,
  step: number,
  callId: string,
  content: readonly import('@deepseek-ai/dsh-llm').ContentBlock[],
  error: { name: string; code: string; reason?: string },
): import('@deepseek-ai/dsh-session').SessionEvent<'tool/result'> {
  const event = toolResult(seq, turn, step, callId, content, { isError: true })
  return { ...event, data: { ...event.data, error } }
}

describe('parseToolArguments', () => {
  it('parses JSON arguments', () => {
    expect(parseToolArguments('{"value":"x"}')).toEqual({ value: 'x' })
  })

  it('returns an empty object for a blank argument string', () => {
    expect(parseToolArguments('')).toEqual({})
    expect(parseToolArguments('   ')).toEqual({})
  })

  it('keeps an unparsable argument string verbatim', () => {
    expect(parseToolArguments('not json')).toBe('not json')
  })
})

describe('TerminalTranscript.append user messages', () => {
  it('appends human and question-reply prompts', () => {
    const { transcript } = transcriptHarness()

    transcript.append(userMessage(0, 'hello'))
    transcript.append(userMessage(1, 'answer', {
      kind: 'user-question-reply',
      callId: ToolCallId('call-1'),
      outcome: 'answered',
    }))

    expect(transcript.renderedBlocks()).toEqual(['UserMessageBlock', 'UserMessageBlock'])
    expect(renderedText(transcript)).toContain('hello')
    expect(renderedText(transcript)).toContain('answer')
  })

  it('appends a model-selection notice instead of a prompt', () => {
    const { transcript } = transcriptHarness()

    transcript.append(userMessage(0, 'model changed', { kind: 'model-selection', form: 'notice', summary: 'a → b' }))

    expect(transcript.renderedBlocks()).toEqual(['NoticeBlock'])
    expect(renderedText(transcript)).toContain('model changed')
  })

  it('skips empty model-selection notices, empty prompts, and foreign source kinds', () => {
    const { transcript } = transcriptHarness()

    transcript.append(userMessage(0, '', { kind: 'model-selection', form: 'notice', summary: 'a → b' }))
    transcript.append(userMessage(1, ''))
    transcript.append(userMessage(2, 'hidden', { kind: 'terminal-test' }))

    expect(transcript.renderedBlocks()).toEqual([])
    expect(transcript.component.children).toEqual([])
  })
})

describe('TerminalTranscript.append assistant messages', () => {
  it('appends text and reasoning content', () => {
    const { transcript } = transcriptHarness()

    transcript.append(assistantMessage(0, 1, 1, [{ type: 'text', text: 'Answer' }]))
    transcript.append(assistantMessage(1, 1, 2, [{ type: 'reasoning', text: 'Thinking' }]))
    transcript.append(assistantMessage(2, 1, 3, [
      { type: 'text', text: 'Both' },
      { type: 'reasoning', text: 'More' },
    ]))

    expect(transcript.renderedBlocks()).toEqual(['AssistantBlock', 'AssistantBlock', 'AssistantBlock'])
    expect(renderedText(transcript)).toContain('Answer')
    expect(renderedText(transcript)).toContain('Thinking')
    expect(renderedText(transcript)).toContain('Both')
  })

  it('skips a settled message without text or reasoning', () => {
    const { transcript } = transcriptHarness()

    transcript.append(assistantMessage(0, 1, 1, []))

    expect(transcript.renderedBlocks()).toEqual([])
  })

  it('marks an interrupted settlement', () => {
    const { transcript } = transcriptHarness()

    transcript.append(assistantMessage(0, 1, 1, [{ type: 'text', text: 'partial' }], { interrupted: true }))

    expect(transcript.renderedBlocks()).toEqual(['AssistantBlock', 'NoticeBlock'])
    expect(renderedText(transcript)).toContain(copy.notice.interrupted)
  })

  it('replaces the live block of the settled step', () => {
    const { transcript } = transcriptHarness()
    bindAgent(transcript)

    transcript.live(startFrame('attempt-1'))
    transcript.live(chunkFrame('attempt-1', { type: 'text-delta', index: 0, text: 'streamed' }))
    transcript.append(assistantMessage(0, 1, 1, [{ type: 'text', text: 'settled' }]))

    expect(transcript.renderedBlocks()).toEqual(['AssistantBlock'])
    expect(transcript.component.children).toHaveLength(1)
    const text = renderedText(transcript)
    expect(text).toContain('settled')
    expect(text).not.toContain('streamed')
  })

  it('appends a failed attempt as a notice', () => {
    const { transcript } = transcriptHarness()

    transcript.append(assistantAttempt(0, 1, 1, 'attempt text'))
    transcript.append(assistantAttempt(1, 1, 2, ''))

    expect(transcript.renderedBlocks()).toEqual(['NoticeBlock'])
    expect(renderedText(transcript)).toContain('attempt text')
  })
})

describe('Transcript tool cards', () => {
  it('runs the call and result presenters with the paired arguments', () => {
    const calls: unknown[] = []
    const results: unknown[] = []
    const tool: ToolDefinition = testTool('echo', {
      presentCall: (args) => {
        calls.push(args)
        return { card: 'generic', title: 'Echo call' }
      },
      presentResult: (args, options) => {
        results.push({ args, options })
        return { card: 'generic', title: 'Echo result', content: [{ type: 'text', text: 'presented result' }] }
      },
    })
    const { transcript } = transcriptHarness({ findTool: name => (name === 'echo' ? tool : undefined) })

    transcript.append(toolCall(0, 1, 1, 'call-1', 'echo', '{"value":"x"}'))
    transcript.append(toolResult(1, 1, 1, 'call-1', [{ type: 'text', text: 'raw result' }], { meta: { kind: 'ok' } }))

    expect(calls).toEqual([{ value: 'x' }])
    expect(results).toEqual([{ args: { value: 'x' }, options: { content: [{ type: 'text', text: 'raw result' }], isError: false, meta: { kind: 'ok' } } }])
    expect(transcript.renderedBlocks()).toEqual(['ToolCardBlock'])
    expect(renderedText(transcript)).toContain('presented result')
  })

  it('keeps raw arguments and falls back without a tool definition', () => {
    const { transcript } = transcriptHarness()

    transcript.append(toolCall(0, 1, 1, 'call-1', 'echo', 'not json'))
    transcript.append(toolResult(1, 1, 1, 'call-1', [{ type: 'text', text: 'raw result' }]))

    expect(transcript.renderedBlocks()).toEqual(['ToolCardBlock'])
    expect(renderedText(transcript)).toContain('Tool / echo')
  })

  it('contains a throwing call presenter', () => {
    const tool = testTool('echo', {
      presentCall: () => { throw new Error('bad presenter') },
    })
    const { transcript } = transcriptHarness({ findTool: () => tool })

    transcript.append(toolCall(0, 1, 1, 'call-1', 'echo', '{}'))

    expect(transcript.renderedBlocks()).toEqual(['ToolCardBlock'])
  })

  it('contains a throwing result presenter', () => {
    const tool = testTool('echo', {
      presentResult: () => { throw new Error('bad presenter') },
    })
    const { transcript } = transcriptHarness({ findTool: () => tool })

    transcript.append(toolCall(0, 1, 1, 'call-1', 'echo', '{}'))
    transcript.append(toolResult(1, 1, 1, 'call-1', [{ type: 'text', text: 'raw result' }], { isError: true }))

    expect(transcript.renderedBlocks()).toEqual(['ToolCardBlock'])
    expect(renderedText(transcript)).toContain('Tool / echo')
  })

  it('appends an unpaired result as its own card', () => {
    const { transcript } = transcriptHarness()

    transcript.append(toolResult(0, 1, 1, 'missing-call', [{ type: 'text', text: 'orphan output' }]))

    expect(transcript.renderedBlocks()).toEqual(['ToolCardBlock'])
    expect(renderedText(transcript)).toContain('Tool / tool')
  })

  it('renders failure identity for paired and unpaired results', () => {
    const { transcript } = transcriptHarness()

    transcript.append(toolCall(0, 1, 1, 'call-1', 'echo', '{}'))
    transcript.append(failedToolResult(1, 1, 1, 'call-1', [{ type: 'text', text: 'failed' }], {
      code: 'E_ONE',
      name: 'ErrorOne',
      reason: 'first failure',
    }))
    transcript.append(failedToolResult(2, 1, 2, 'call-2', [{ type: 'text', text: 'failed again' }], {
      code: 'E_TWO',
      name: 'ErrorTwo',
    }))

    const text = renderedText(transcript)
    expect(text).toContain('E_ONE: first failure')
    expect(text).toContain('E_TWO: ErrorTwo')
  })

  it('shows the settled terminal output with card mode changes', () => {
    const tool = testTool('run', {
      presentCall: () => ({ card: 'terminal', title: 'run the thing' }),
      presentResult: () => ({ card: 'terminal', output: 'a\nb\nc\nd\ne' }),
    })
    const { transcript } = transcriptHarness({ findTool: () => tool, previewLines: 2 })

    transcript.append(toolCall(0, 1, 1, 'call-1', 'run', '{}'))
    transcript.append(toolResult(1, 1, 1, 'call-1', [{ type: 'text', text: 'raw' }]))

    expect(renderedText(transcript)).toContain(copy.notice.hiddenLines(4))
    transcript.toggleCards()
    expect(renderedText(transcript)).toContain('e')
    expect(renderedText(transcript)).not.toContain(copy.notice.hiddenLines(4))
    transcript.toggleCards()
    expect(transcript.component.render(80)).toEqual([])
    transcript.toggleCards()
    expect(transcript.renderedBlocks()).toEqual(['ToolCardBlock'])
  })
})

describe('Transcript append command and compaction records', () => {
  it('pairs command invocations with their outcomes', () => {
    const { transcript } = transcriptHarness()

    transcript.append(commandRun(0, 'inspect', '<target>'))
    transcript.append(commandDone(1, 'success', 'inspected'))
    transcript.append(commandRun(2, 'ping'))
    transcript.append(commandDone(3, 'error', 'failed'))

    const text = renderedText(transcript)
    expect(text).toContain('/inspect <target>')
    expect(text).toContain('inspected')
    expect(text).toContain('failed')
    expect(transcript.renderedBlocks()).toEqual(['CommandBlock', 'CommandBlock'])
  })

  it('ignores an outcome without a command block', () => {
    const { transcript, requestRender } = transcriptHarness()

    transcript.append(commandDone(0, 'success', 'orphan'))

    expect(transcript.renderedBlocks()).toEqual([])
    expect(requestRender).toHaveBeenCalled()
  })

  it('records compaction summaries and failures', () => {
    const { transcript } = transcriptHarness()

    transcript.append(compactionSummary(0, 1234))
    transcript.append(compactionEnd(1, 'model unavailable'))
    transcript.append(compactionEnd(2))

    expect(transcript.renderedBlocks()).toEqual(['NoticeBlock', 'NoticeBlock'])
    const text = renderedText(transcript)
    expect(text).toContain(`${copy.notice.compacted} (1234 tokens)`)
    expect(text).toContain(`${copy.notice.compactionFailed}: model unavailable`)
  })
})

/** Every recorded turn-end reason with the notice it renders. */
const TURN_END_CASES: readonly (readonly [TurnEndReason, string])[] = [
  [{ kind: 'completed' }, ''],
  [{ kind: 'aborted', reason: { kind: 'user' } }, 'Turn ended: aborted (user).'],
  [{ kind: 'aborted', reason: { kind: 'parent' } }, 'Turn ended: aborted (parent).'],
  [{ kind: 'aborted', reason: { kind: 'disposed' } }, 'Turn ended: aborted (disposed).'],
  [{ kind: 'aborted', reason: { kind: 'hook', reason: 'hook veto' } }, 'Turn ended: aborted (hook).'],
  [{ kind: 'aborted', reason: { kind: 'legacy' } }, 'Turn ended: aborted (legacy).'],
  [{ kind: 'blocked' }, 'Turn ended: blocked.'],
  [{ kind: 'error', error: { code: 'E_FAIL', message: 'the model failed' } }, 'Turn failed: E_FAIL: the model failed'],
  [{ kind: 'max-tokens' }, 'Turn ended: output token ceiling reached.'],
  [{ kind: 'interrupted' }, 'Turn ended: interrupted.'],
  [{ kind: 'forked' }, 'Turn ended: fork seed boundary.'],
  [{ kind: 'synthetic' }, 'Turn ended: synthetic.'],
]

describe('TerminalTranscript.append turn boundaries', () => {
  it('tracks the running turn clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(5000)
    const { transcript, requestRender } = transcriptHarness()

    expect(transcript.turnStartedAt()).toBeUndefined()
    transcript.append(turnStart(0, 1))
    expect(transcript.turnStartedAt()).toBe(5000)

    vi.setSystemTime(9000)
    transcript.append(turnEnd(1, 1, { kind: 'completed' }))
    expect(transcript.turnStartedAt()).toBeUndefined()
    expect(requestRender).toHaveBeenCalled()
    expect(transcript.renderedBlocks()).toEqual([])
  })

  it.each(TURN_END_CASES.filter(([reason]) => reason.kind !== 'completed'))('renders the %j turn end notice', (reason, expected) => {
    const { transcript } = transcriptHarness()

    transcript.append(turnEnd(0, 1, reason))

    expect(renderedText(transcript)).toContain(expected)
    expect(transcript.renderedBlocks()).toEqual(['NoticeBlock'])
  })
})

describe('TerminalTranscript.append unknown events', () => {
  it('ignores event kinds it does not render', () => {
    const { transcript } = transcriptHarness()

    transcript.append(sessionTitle(0, 'A title'))

    expect(transcript.renderedBlocks()).toEqual([])
  })
})

describe('TerminalTranscript.live', () => {
  it('ignores frames before an Agent is bound', () => {
    const { transcript } = transcriptHarness()

    transcript.live(startFrame('attempt-1'))

    expect(transcript.renderedBlocks()).toEqual([])
  })

  it('streams text and reasoning into one block', () => {
    const { transcript } = transcriptHarness()
    bindAgent(transcript)

    transcript.live(startFrame('attempt-1'))
    transcript.live(chunkFrame('attempt-1', { type: 'text-delta', index: 0, text: 'Hello' }))
    transcript.live(chunkFrame('attempt-1', { type: 'text-delta', index: 1, text: ' world' }))
    transcript.live(chunkFrame('attempt-1', { type: 'reasoning-delta', index: 2, text: 'pondering' }))
    transcript.live(chunkFrame('attempt-1', { type: 'block-start', index: 3, blockType: 'text' }))

    expect(transcript.renderedBlocks()).toEqual(['AssistantBlock'])
    const text = renderedText(transcript)
    expect(text).toContain('Hello world')
    expect(text).toContain('pondering')
  })

  it('ignores frames for an unknown attempt', () => {
    const { transcript } = transcriptHarness()
    bindAgent(transcript)

    transcript.live(chunkFrame('unknown', { type: 'text-delta', index: 0, text: 'lost' }))
    transcript.live(endFrame('unknown', true))

    expect(transcript.renderedBlocks()).toEqual([])
  })

  it('keeps a committed block and drops an abandoned one', () => {
    const { transcript } = transcriptHarness()
    bindAgent(transcript)

    transcript.live(startFrame('committed'))
    transcript.live(endFrame('committed', false))
    expect(transcript.renderedBlocks()).toEqual(['AssistantBlock'])

    transcript.live(startFrame('abandoned', 1, 2))
    transcript.live(endFrame('abandoned', true))
    expect(transcript.renderedBlocks()).toEqual(['AssistantBlock'])
  })

  it('replaces a superseded attempt for the same step', () => {
    const { transcript } = transcriptHarness()
    bindAgent(transcript)

    transcript.live(startFrame('first'))
    transcript.live(startFrame('second'))
    transcript.live(chunkFrame('second', { type: 'text-delta', index: 0, text: 'second attempt' }))

    expect(transcript.renderedBlocks()).toEqual(['AssistantBlock'])
    expect(renderedText(transcript)).toContain('second attempt')
  })

  it('keeps a settled message when its live block was already windowed out', () => {
    const { transcript } = transcriptHarness({ windowBlocks: 1 })
    bindAgent(transcript)

    transcript.live(startFrame('attempt-1'))
    transcript.append(userMessage(0, 'another block'))
    transcript.append(assistantMessage(1, 1, 1, [{ type: 'text', text: 'settled' }]))

    expect(transcript.renderedBlocks()).toEqual(['AssistantBlock'])
    expect(transcript.component.children).toHaveLength(1)
    expect(renderedText(transcript)).toContain('settled')
  })

  it('drops a settlement for a step without a live block', () => {
    const { transcript } = transcriptHarness()

    transcript.append(assistantMessage(0, 1, 1, [{ type: 'text', text: 'settled' }]))

    expect(transcript.renderedBlocks()).toEqual(['AssistantBlock'])
  })
})

describe('Transcript clear, cards, reasoning, and notices', () => {
  it('trims the rendered window', () => {
    const { transcript } = transcriptHarness({ windowBlocks: 2 })

    transcript.notice('one')
    transcript.notice('two')
    transcript.notice('three')

    expect(transcript.renderedBlocks()).toEqual(['NoticeBlock', 'NoticeBlock'])
    expect(transcript.component.children).toHaveLength(2)
    expect(renderedText(transcript)).toContain('two')
    expect(renderedText(transcript)).toContain('three')
  })

  it('clears every block and pending pairing', () => {
    const { transcript } = transcriptHarness()
    bindAgent(transcript)
    transcript.append(userMessage(0, 'hello'))
    transcript.live(startFrame('attempt-1'))
    transcript.append(turnStart(1, 1))

    transcript.clear()

    expect(transcript.renderedBlocks()).toEqual([])
    expect(transcript.component.children).toEqual([])
    expect(transcript.turnStartedAt()).toBeUndefined()

    transcript.append(assistantMessage(2, 1, 1, [{ type: 'text', text: 'fresh' }]))
    expect(transcript.renderedBlocks()).toEqual(['AssistantBlock'])
  })

  it('cycles the card mode back to collapsed', () => {
    const { transcript, requestRender } = transcriptHarness()

    transcript.toggleCards()
    transcript.toggleCards()
    transcript.toggleCards()

    expect(requestRender).toHaveBeenCalledTimes(3)
    expect(transcript.renderedBlocks()).toEqual([])
  })

  it('toggles reasoning visibility for assistant blocks only', () => {
    const { transcript } = transcriptHarness()
    transcript.append(assistantMessage(0, 1, 1, [
      { type: 'text', text: 'visible answer' },
      { type: 'reasoning', text: 'hidden reasoning' },
    ]))
    transcript.notice('plain notice')

    expect(renderedText(transcript)).toContain('hidden reasoning')
    transcript.toggleReasoning()
    expect(renderedText(transcript)).not.toContain('hidden reasoning')
    expect(renderedText(transcript)).toContain('plain notice')
    transcript.toggleReasoning()
    expect(renderedText(transcript)).toContain('hidden reasoning')
  })

  it('appends terminal-only notices with an explicit tone', () => {
    const { transcript } = transcriptHarness()

    transcript.notice('dim notice')
    transcript.notice('bright notice', 'success')

    const text = renderedText(transcript)
    expect(text).toContain('dim notice')
    expect(text).toContain('bright notice')
    expect(transcript.renderedBlocks()).toEqual(['NoticeBlock', 'NoticeBlock'])
  })
})

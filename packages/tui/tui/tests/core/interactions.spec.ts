import { describe, expect, it, vi } from 'vitest'
import type { Component } from '@earendil-works/pi-tui'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'
import {
  ModalHost, registerApprovalAnswerer, registerQuestionAnswerer, type InteractionDeps,
} from '../../src/interactions.ts'
import { createPalette } from '../../src/palette.ts'
import {
  agentDouble, captureOverlays, freshContext, headlessSession, plainMarkdownTheme,
  userQuestionsDouble, type AgentDouble, type OverlayCapture,
} from './harness.ts'

/** The fallback answer a delegated waterfall returns. */
const FALLBACK_ANSWER: AskUserQuestionAnswer = { answers: [{ id: 'delegated', selected: [] }] }

/** A test agent whose session identity is not the terminal's. */
function foreignAgent(): Agent {
  const session = Session.create(SessionId('foreign-session'))
  return agentDouble({ session }).agent
}

/** One registered question answerer under test. */
interface QuestionHarness {
  readonly deps: InteractionDeps
  readonly capture: OverlayCapture
  readonly modal: ModalHost
  readonly agent: AgentDouble
  readonly dispose: () => void
}

/**
 * Register the question answerer over a headless renderer with a captured overlay.
 * @param options - timed-wait stream and immediate open interaction.
 * @returns the harness.
 */
function questionHarness(options: {
  attachWait?: () => AsyncIterable<{ remainingMs: number }>
  onOpen?: (component: Component) => void
} = {}): QuestionHarness {
  const owned = headlessSession()
  const capture = captureOverlays(owned.session.tui, options.onOpen)
  const session = Session.create(SessionId('session-test'))
  const agent = agentDouble({ session })
  const ctx = freshContext({
    userQuestions: userQuestionsDouble(options.attachWait ?? emptyWait),
  })
  const deps: InteractionDeps = {
    ctx,
    tui: owned.session.tui,
    palette: createPalette(false),
    markdown: plainMarkdownTheme(),
    agent: () => agent.agent,
    requestRender: vi.fn(),
  }
  const modal = new ModalHost()
  const dispose = registerQuestionAnswerer(deps, session.id, modal)
  return { deps, capture, modal, agent, dispose }
}

/** An async iterable that yields no frames. */
async function* emptyWait(): AsyncIterable<{ remainingMs: number }> {
  // No frames: the timed wait ended before the countdown was published.
}

/** An async iterable that yields one countdown frame. */
async function* oneFrameWait(): AsyncIterable<{ remainingMs: number }> {
  yield { remainingMs: 2500 }
}

/**
 * Dispatch one user-question request through the real Context waterfall.
 * @param deps - interaction dependencies carrying the context.
 * @param request - pending request.
 * @returns the waterfall answer.
 */
function ask(deps: InteractionDeps, request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
  return deps.ctx.waterfall('user-questions/request', request, () => Promise.resolve(FALLBACK_ANSWER))
}

/**
 * Wait for the next presented overlay.
 * @param capture - the overlay recorder.
 * @returns the presented component.
 */
async function openedPanel(capture: OverlayCapture): Promise<Component> {
  await vi.waitFor(() => { expect(capture.components.length).toBeGreaterThan(0) })
  const panel = capture.components[0]
  if (panel === undefined) throw new Error('no overlay was presented')
  return panel
}

/**
 * Drive one input sequence into a presented component.
 * @param component - the presented component.
 * @param data - raw input.
 */
function press(component: Component, data: string): void {
  if (component.handleInput === undefined) throw new Error('presented component has no input handler')
  component.handleInput(data)
}

/** One registered approval answerer under test. */
interface ApprovalHarness {
  readonly deps: InteractionDeps
  readonly capture: OverlayCapture
  readonly modal: ModalHost
  readonly agent: AgentDouble
  readonly dispose: () => void
}

/**
 * Register the approval answerer over a headless renderer with a captured overlay.
 * @param options - immediate open interaction.
 * @returns the harness.
 */
function approvalHarness(options: { onOpen?: (component: Component) => void } = {}): ApprovalHarness {
  const owned = headlessSession()
  const capture = captureOverlays(owned.session.tui, options.onOpen)
  const session = Session.create(SessionId('session-test'))
  const agent = agentDouble({ session })
  const ctx = freshContext()
  const deps: InteractionDeps = {
    ctx,
    tui: owned.session.tui,
    palette: createPalette(false),
    markdown: plainMarkdownTheme(),
    agent: () => agent.agent,
    requestRender: vi.fn(),
  }
  const modal = new ModalHost()
  const dispose = registerApprovalAnswerer(deps, session.id, modal)
  return { deps, capture, modal, agent, dispose }
}

/**
 * Dispatch one approval request through the real Context waterfall.
 * @param deps - interaction dependencies carrying the context.
 * @param request - pending request.
 * @param fallback - outcome the delegated chain returns.
 * @returns the waterfall outcome.
 */
function decide(
  deps: InteractionDeps,
  request: ApprovalRequestEvent,
  fallback: ApprovalOutcome = 'unavailable',
): Promise<ApprovalOutcome> {
  return deps.ctx.waterfall('approval/request', request, () => Promise.resolve(fallback))
}

describe('registerQuestionAnswerer', () => {
  it('hides an overlay the host settles inside showOverlay', async () => {
    const harness = questionHarness({ onOpen: (component) => { component.handleInput?.('1') } })

    await expect(ask(harness.deps, {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    })).resolves.toEqual({ answers: [{ id: 'q', selected: ['Yes'] }] })
    expect(harness.capture.handles[0]?.hidden()).toBe(true)
    expect(harness.modal.hasActive()).toBe(false)
  })

  it('delegates requests without an agent', async () => {
    const harness = questionHarness()

    await expect(ask(harness.deps, { questions: [{ id: 'q', question: 'Proceed?' }] }))
      .resolves.toEqual(FALLBACK_ANSWER)
    expect(harness.capture.components).toEqual([])
  })

  it('delegates requests for another Session', async () => {
    const harness = questionHarness()

    await expect(ask(harness.deps, {
      agent: foreignAgent(),
      questions: [{ id: 'q', question: 'Proceed?' }],
    })).resolves.toEqual(FALLBACK_ANSWER)
    expect(harness.capture.components).toEqual([])
  })

  it('resolves a single-select answer from the panel and hides it', async () => {
    const harness = questionHarness()
    const answer = ask(harness.deps, {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }],
      wait: { callId: ToolCallId('call-untimed') },
    })
    const panel = await openedPanel(harness.capture)

    press(panel, '2')

    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['No'] }] })
    expect(harness.capture.handles[0]?.hidden()).toBe(true)
    expect(harness.modal.hasActive()).toBe(false)
    // A second answer after settlement is ignored.
    press(panel, '\r')
    expect(harness.modal.hasActive()).toBe(false)
  })

  it('resolves a multi-select answer and reports an empty confirmation', async () => {
    const harness = questionHarness()
    const answer = ask(harness.deps, {
      agent: harness.agent.agent,
      questions: [{
        id: 'q',
        question: 'Pick some',
        multiSelect: true,
        options: [{ label: 'Alpha' }, { label: 'Beta' }],
      }],
    })
    const panel = await openedPanel(harness.capture)

    press(panel, '\r')
    expect(panel.render(80).join('\n')).toContain('Select at least one option.')

    press(panel, ' ')
    press(panel, '\x1b[B')
    press(panel, ' ')
    press(panel, '\r')

    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['Alpha', 'Beta'] }] })
  })

  it('resolves a custom answer and rejects an empty one', async () => {
    const harness = questionHarness()
    const answer = ask(harness.deps, {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Name?', options: [] }],
    })
    const panel = await openedPanel(harness.capture)

    press(panel, '\r')
    press(panel, '\r')
    expect(panel.render(80).join('\n')).toContain('An answer is required.')

    press(panel, '\r')
    for (const character of 'Ada') press(panel, character)
    press(panel, '\r')

    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: [], custom: 'Ada' }] })
  })

  it('rejects with a cancellation when the user presses escape', async () => {
    const harness = questionHarness()
    const answer = ask(harness.deps, {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }] }],
    })
    const panel = await openedPanel(harness.capture)

    press(panel, '\x1b')

    await expect(answer).rejects.toThrow('The user cancelled the question.')
    expect(harness.capture.handles[0]?.hidden()).toBe(true)
  })

  it('rejects with a cancellation when the request signal aborts', async () => {
    const harness = questionHarness()
    const controller = new AbortController()
    const answer = ask(harness.deps, {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }] }],
      signal: controller.signal,
    })
    await openedPanel(harness.capture)

    controller.abort()

    await expect(answer).rejects.toThrow('The question was cancelled before the user answered.')
    expect(harness.capture.handles[0]?.hidden()).toBe(true)
  })

  it('cancels the active question through the shared modal host', async () => {
    const harness = questionHarness()
    const answer = ask(harness.deps, {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }] }],
    })
    await openedPanel(harness.capture)
    expect(harness.modal.hasActive()).toBe(true)

    expect(harness.modal.cancelCurrent()).toBe(true)

    await expect(answer).rejects.toThrow('The user cancelled the question.')
    expect(harness.modal.hasActive()).toBe(false)
  })

  it('keeps the modal active when the host cancels while the overlay opens', async () => {
    const harness = questionHarness({ onOpen: () => { harness.modal.cancelCurrent() } })
    const answer = ask(harness.deps, {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }] }],
    })
    const panel = await openedPanel(harness.capture)

    press(panel, '\x1b')

    await expect(answer).rejects.toThrow('The user cancelled the question.')
  })

  it('publishes timed-wait countdown frames to the panel', async () => {
    const harness = questionHarness({ attachWait: oneFrameWait })
    const answer = ask(harness.deps, {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }] }],
      wait: { callId: ToolCallId('call-timed'), timed: true },
    })
    const panel = await openedPanel(harness.capture)

    await vi.waitFor(() => { expect(panel.render(80).join('\n')).toContain('3s left') })
    expect(harness.deps.requestRender).toHaveBeenCalled()
    press(panel, '\r')

    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['Yes'] }] })
  })

  it('keeps the panel answerable when the timed-wait stream fails', async () => {
    let failed = false
    const harness = questionHarness({
      attachWait: () => ({
        [Symbol.asyncIterator]() {
          return {
            next: () => {
              failed = true
              return Promise.reject(new Error('wait closed'))
            },
          }
        },
      }),
    })
    const answer = ask(harness.deps, {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?', options: [{ label: 'Yes' }] }],
      wait: { callId: ToolCallId('call-failed'), timed: true },
    })
    const panel = await openedPanel(harness.capture)

    await vi.waitFor(() => { expect(failed).toBe(true) })
    press(panel, '\r')

    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['Yes'] }] })
  })

  it('removes its listener when disposed', async () => {
    const harness = questionHarness()
    harness.dispose()

    await expect(ask(harness.deps, {
      agent: harness.agent.agent,
      questions: [{ id: 'q', question: 'Proceed?' }],
    })).resolves.toEqual(FALLBACK_ANSWER)
  })
})

describe('registerApprovalAnswerer', () => {
  it('hides an overlay the host settles inside showOverlay', async () => {
    const harness = approvalHarness({ onOpen: (component) => { component.handleInput?.('a') } })

    await expect(decide(harness.deps, approvalRequest(harness.agent.agent)))
      .resolves.toBe('allowed-once')
    expect(harness.capture.handles[0]?.hidden()).toBe(true)
    expect(harness.modal.hasActive()).toBe(false)
  })

  /**
   * Build one pending approval request for the harness agent.
   * @param agent - requesting Agent.
   * @param extra - request fields to include.
   * @returns the request.
   */
  function approvalRequest(agent: Agent, extra: Partial<ApprovalRequestEvent> = {}): ApprovalRequestEvent {
    return { agent, toolName: 'bash', ...extra }
  }

  it('delegates requests for another Session', async () => {
    const harness = approvalHarness()

    await expect(decide(harness.deps, approvalRequest(foreignAgent()))).resolves.toBe('unavailable')
    expect(harness.capture.components).toEqual([])
  })

  it.each(['a', 'y', '\r'] as const)('resolves the allow-once decision from %j', async (key) => {
    const harness = approvalHarness()
    const outcome = decide(harness.deps, approvalRequest(harness.agent.agent, { reason: 'needs network' }))
    const panel = await openedPanel(harness.capture)

    press(panel, key)
    press(panel, 'r')

    await expect(outcome).resolves.toBe('allowed-once')
    expect(harness.capture.handles[0]?.hidden()).toBe(true)
  })

  it.each(['n', 'r'] as const)('resolves the rejection from %j', async (key) => {
    const harness = approvalHarness()
    const outcome = decide(harness.deps, approvalRequest(harness.agent.agent))
    const panel = await openedPanel(harness.capture)

    press(panel, key)

    await expect(outcome).resolves.toBe('rejected')
  })

  it('resolves a cancellation from escape', async () => {
    const harness = approvalHarness()
    const outcome = decide(harness.deps, approvalRequest(harness.agent.agent))
    const panel = await openedPanel(harness.capture)

    press(panel, '\x1b')

    await expect(outcome).resolves.toBe('cancelled')
  })

  it('prefers the localized reason and falls back to the raw reason', async () => {
    const harness = approvalHarness()
    const localized = decide(harness.deps, approvalRequest(harness.agent.agent, {
      reason: 'raw reason',
      displayReason: { en: 'Localized reason' },
    }))
    const first = await openedPanel(harness.capture)
    expect(first.render(80).join('\n')).toContain('Localized reason')
    press(first, 'y')
    await expect(localized).resolves.toBe('allowed-once')

    const raw = decide(harness.deps, approvalRequest(harness.agent.agent, { reason: 'raw reason' }))
    await vi.waitFor(() => { expect(harness.capture.components).toHaveLength(2) })
    const second = harness.capture.components[1]
    if (second === undefined) throw new Error('second overlay was not presented')
    expect(second.render(80).join('\n')).toContain('raw reason')
    press(second, 'y')
    await expect(raw).resolves.toBe('allowed-once')
  })

  it('resolves a cancellation from the request signal', async () => {
    const harness = approvalHarness()
    const controller = new AbortController()
    const outcome = decide(harness.deps, approvalRequest(harness.agent.agent, { signal: controller.signal }))
    await openedPanel(harness.capture)

    controller.abort()

    await expect(outcome).resolves.toBe('cancelled')
  })

  it('resolves a cancellation from the shared modal host', async () => {
    const harness = approvalHarness()
    const outcome = decide(harness.deps, approvalRequest(harness.agent.agent))
    await openedPanel(harness.capture)

    expect(harness.modal.cancelCurrent()).toBe(true)

    await expect(outcome).resolves.toBe('cancelled')
    expect(harness.modal.hasActive()).toBe(false)
  })

  it('keeps the modal active when the host cancels while the overlay opens', async () => {
    const harness = approvalHarness({ onOpen: () => { harness.modal.cancelCurrent() } })
    const outcome = decide(harness.deps, approvalRequest(harness.agent.agent))
    const panel = await openedPanel(harness.capture)

    press(panel, '\x1b')

    await expect(outcome).resolves.toBe('cancelled')
  })

  it('removes its listener when disposed', async () => {
    const harness = approvalHarness()
    harness.dispose()

    await expect(decide(harness.deps, approvalRequest(harness.agent.agent))).resolves.toBe('unavailable')
  })
})

describe('ModalHost', () => {
  it('reports no active modal before one opens', () => {
    const modal = new ModalHost()

    expect(modal.hasActive()).toBe(false)
    expect(modal.cancelCurrent()).toBe(false)
  })

  it('serializes modals in FIFO order', async () => {
    const modal = new ModalHost()
    const order: string[] = []
    let openFirst!: (value: string) => void
    let openSecond!: (value: string) => void
    const first = modal.run(() => {}, () => {
      order.push('first')
      return new Promise<string>((resolve) => { openFirst = resolve })
    })
    const second = modal.run(() => {}, () => {
      order.push('second')
      return new Promise<string>((resolve) => { openSecond = resolve })
    })

    await vi.waitFor(() => { expect(order).toEqual(['first']) })
    openFirst('one')
    await expect(first).resolves.toBe('one')
    await vi.waitFor(() => { expect(order).toEqual(['first', 'second']) })
    openSecond('two')
    await expect(second).resolves.toBe('two')
    expect(modal.hasActive()).toBe(false)
  })

  it('keeps the queue moving after a rejected modal', async () => {
    const modal = new ModalHost()
    const order: string[] = []
    const failing = modal.run(() => {}, () => {
      order.push('failing')
      return Promise.reject(new Error('panel failed'))
    })
    const following = modal.run(() => {}, () => {
      order.push('following')
      return Promise.resolve('ok')
    })

    await expect(failing).rejects.toThrow('panel failed')
    await expect(following).resolves.toBe('ok')
    expect(order).toEqual(['failing', 'following'])
  })

  it('cancels the active modal and reports the transition', async () => {
    const modal = new ModalHost()
    let settle!: (value: string) => void
    const operation = modal.run(
      () => { settle('cancelled') },
      () => new Promise<string>((resolve) => { settle = resolve }),
    )

    await vi.waitFor(() => { expect(modal.hasActive()).toBe(true) })
    expect(modal.cancelCurrent()).toBe(true)

    await expect(operation).resolves.toBe('cancelled')
    expect(modal.hasActive()).toBe(false)
    expect(modal.cancelCurrent()).toBe(false)
  })
})

describe('ModalHost change notifications', () => {
  it('reports the open and close transitions', async () => {
    const modal = new ModalHost()
    const states: boolean[] = []
    modal.onChange = (active) => { states.push(active) }

    const result = modal.run(() => {}, () => Promise.resolve('done'))
    await Promise.resolve()

    expect(modal.hasActive()).toBe(true)
    expect(states).toEqual([true])

    await expect(result).resolves.toBe('done')
    await Promise.resolve()

    expect(states).toEqual([true, false])
    expect(modal.hasActive()).toBe(false)
  })

  it('reports the close transition when the open promise rejects', async () => {
    const modal = new ModalHost()
    const states: boolean[] = []
    modal.onChange = (active) => { states.push(active) }

    const result = modal.run(() => {}, () => Promise.reject(new Error('open failed')))
    await Promise.resolve()
    await expect(result).rejects.toThrow('open failed')

    expect(states).toEqual([true, false])
    expect(modal.hasActive()).toBe(false)
  })

  it('works without a change callback', async () => {
    const modal = new ModalHost()

    await expect(modal.run(() => {}, () => Promise.resolve('value'))).resolves.toBe('value')

    expect(modal.hasActive()).toBe(false)
  })

  it('reports each queued operation separately', async () => {
    const modal = new ModalHost()
    const states: boolean[] = []
    modal.onChange = (active) => { states.push(active) }

    const first = modal.run(() => {}, () => Promise.resolve())
    const second = modal.run(() => {}, () => Promise.resolve())
    await Promise.all([first, second])

    expect(states).toEqual([true, false, true, false])
  })
})

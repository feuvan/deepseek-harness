/**
 * Human-interaction providers for the terminal: the question answerer, the
 * one-shot approval answerer, and the single modal queue they share.
 *
 * @module @deepseek-ai/dsh-tui/interactions
 */

import type { Context } from '@deepseek-ai/cordis'
import type { TUI, MarkdownTheme } from '@earendil-works/pi-tui'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-questions'
import { ApprovalPanel, QuestionPanel } from './components/dialogs.ts'
import type { Palette } from './palette.ts'

/** Values the interaction providers need from the terminal application. */
export interface InteractionDeps {
  /** Host context carrying the two interaction seams. */
  readonly ctx: Context
  /** The renderer that owns focus and overlays. */
  readonly tui: TUI
  /** Terminal style table. */
  readonly palette: Palette
  /** Markdown theme for question detail. */
  readonly markdown: MarkdownTheme
  /** @returns the presented Agent. */
  readonly agent: () => Agent | undefined
  /** Ask for a frame after a panel mutation. */
  readonly requestRender: () => void
}

/**
 * Serialize modal presentation: one panel owns focus at a time, later requests
 * wait, and cancellation closes the active panel before the next one opens.
 */
export class ModalHost {
  private tail: Promise<void> = Promise.resolve()
  private cancelActive: (() => void) | undefined

  /**
   * Queue one modal operation.
   * @param cancel - closes the panel and settles the operation.
   * @param open - presents the panel and settles when it closes.
   * @returns the operation's settled value.
   */
  run<T>(cancel: () => void, open: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => new Promise<T>((resolve, reject) => {
      this.cancelActive = cancel
      open().then(resolve, reject).finally(() => { this.cancelActive = undefined })
    }))
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  /**
   * Whether a modal is currently open.
   * @returns whether a modal owns focus.
   */
  hasActive(): boolean {
    return this.cancelActive !== undefined
  }

  /**
   * Cancel the active modal, if any.
   * @returns whether a modal was cancelled.
   */
  cancelCurrent(): boolean {
    const cancel = this.cancelActive
    if (cancel === undefined) return false
    cancel()
    return true
  }
}

/**
 * Register the terminal answerer for agent-initiated questions.
 * @param deps - interaction values.
 * @param sessionId - the Session this terminal presents.
 * @param modal - the shared modal queue.
 * @returns the listener disposer.
 */
export function registerQuestionAnswerer(deps: InteractionDeps, sessionId: string, modal: ModalHost): () => void {
  return deps.ctx.on('user-questions/request', (request: AskUserQuestionRequest, next: () => Promise<AskUserQuestionAnswer>) => {
    const agent = request.agent
    if (agent === undefined || agent.session.id !== sessionId) return next()
    let cancel = (): void => {}
    return modal.run(() => { cancel() }, () => new Promise<AskUserQuestionAnswer>((resolve, reject) => {
      const state = { settled: false }
      const signal = request.signal
      const claim = new AbortController()
      const overlay: { handle?: ReturnType<TUI['showOverlay']> } = {}
      const finish = (settle: () => void): void => {
        if (state.settled) return
        state.settled = true
        claim.abort()
        signal?.removeEventListener('abort', onAbort)
        overlay.handle?.hide()
        settle()
      }
      const onAbort = (): void => {
        finish(() => { reject(new Error('The question was cancelled before the user answered.')) })
      }
      const panel = new QuestionPanel(
        request,
        deps.palette,
        deps.markdown,
        (answer) => { finish(() => { resolve(answer) }) },
        () => { finish(() => { reject(new Error('The user cancelled the question.')) }) },
      )
      const handle = deps.tui.showOverlay(panel, {
        width: '90%',
        maxHeight: '80%',
        anchor: 'center',
        margin: 1,
      })
      overlay.handle = handle
      // A host may settle the panel from inside showOverlay; hide the overlay
      // once its handle exists so it cannot linger over the restored screen.
      if (state.settled) handle.hide()
      cancel = () => {
        finish(() => { reject(new Error('The user cancelled the question.')) })
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const wait = request.wait
      if (wait?.timed === true) {
        void (async () => {
          try {
            for await (const frame of deps.ctx.userQuestions.attachWait(agent, wait.callId, claim.signal)) {
              panel.setRemaining(frame.remainingMs)
              deps.requestRender()
            }
          } catch (error: unknown) {
            // A cancelled or settled timed wait ends the countdown; the panel
            // stays answerable until the user or the signal settles it.
            void error
          }
        })()
      }
    }))
  })
}

/**
 * Register the terminal answerer for one-shot approvals.
 * @param deps - interaction values.
 * @param sessionId - the Session this terminal presents.
 * @param modal - the shared modal queue.
 * @returns the listener disposer.
 */
export function registerApprovalAnswerer(deps: InteractionDeps, sessionId: string, modal: ModalHost): () => void {
  return deps.ctx.on('approval/request', (request, next) => {
    if (request.agent.session.id !== sessionId) return next()
    let cancel = (): void => {}
    return modal.run(() => { cancel() }, () => new Promise<ApprovalOutcome>((resolve) => {
      const state = { settled: false }
      const reason = request.displayReason?.en ?? request.reason
      const overlay: { handle?: ReturnType<TUI['showOverlay']> } = {}
      const finish = (outcome: ApprovalOutcome): void => {
        if (state.settled) return
        state.settled = true
        request.signal?.removeEventListener('abort', onAbort)
        overlay.handle?.hide()
        resolve(outcome)
      }
      const onAbort = (): void => { finish('cancelled') }
      const panel = new ApprovalPanel(request.toolName, reason, deps.palette, finish)
      const handle = deps.tui.showOverlay(panel, {
        width: '80%',
        maxHeight: '60%',
        anchor: 'center',
        margin: 1,
      })
      overlay.handle = handle
      if (state.settled) handle.hide()
      cancel = () => { finish('cancelled') }
      request.signal?.addEventListener('abort', onAbort, { once: true })
    }))
  })
}

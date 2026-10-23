/**
 * Footer state: model, tokens, context pressure, permission preset, working
 * directory, title, and running status read from Session projections.
 *
 * @module @deepseek-ai/dsh-tui/status
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-working-directory'
import { copy } from './copy.ts'
import type { ResolvedConfig } from './config.ts'
import type { FooterSnapshot } from './components/footer.ts'

/** Values the status model needs from the terminal application. */
export interface StatusDeps {
  /** Host context carrying the Session projection registry. */
  readonly ctx: Context
  /** @returns the presented Agent. */
  readonly agent: () => Agent | undefined
  /** The mutable per-step model selection installed on the Agent scope. */
  readonly selection: ModelSelectionRef
  /** Resolved terminal configuration. */
  readonly config: ResolvedConfig
  /** @returns the effort the next request uses, including an advertised default. */
  readonly effort: () => { readonly level: string | undefined; readonly implicit: boolean }
  /** @returns when the running turn started, or undefined while idle. */
  readonly turnStartedAt: () => number | undefined
  /** Ask for a frame after a projection change. */
  readonly requestRender: () => void
}

/** Computes the footer snapshot and keeps it current through projection changes. */
export class StatusModel {
  private readonly deps: StatusDeps
  private stopChanges: (() => void) | undefined

  /**
   * @param deps - application values.
   */
  constructor(deps: StatusDeps) {
    this.deps = deps
    const projections = deps.ctx.get('sessionProjections')
    if (projections !== undefined) {
      this.stopChanges = projections.onChanged((session) => {
        if (session === deps.agent()?.session) deps.requestRender()
      })
    }
  }

  /** Stop listening to projection changes. */
  dispose(): void {
    this.stopChanges?.()
    this.stopChanges = undefined
  }

  /**
   * Read the current footer values.
   * @returns one immutable snapshot, complete even before the Agent exists.
   */
  snapshot(): FooterSnapshot {
    const agent = this.deps.agent()
    const selection = this.deps.selection.current
    if (agent === undefined || selection === undefined) {
      return {
        cwd: this.deps.config.sessionId,
        title: undefined,
        model: 'starting',
        effort: undefined,
        effortImplicit: false,
        inputTokens: 0,
        outputTokens: 0,
        cacheRate: undefined,
        contextPercent: undefined,
        permission: undefined,
        status: copy.status.idle,
        elapsedSeconds: undefined,
        pendingSteering: 0,
        pendingQueued: 0,
      }
    }
    const projections = this.deps.ctx.get('sessionProjections')
    const session = agent.session
    // The footer shows the client-visible views, not the host fold states.
    const values = projections?.snapshot(session).values
    const usage = values?.tokenUsage
    const pressure = values?.contextPressure
    const permissions = values?.permissions
    const title = values?.title
    const directory = values?.workingDirectory
    const inputTokens = usage === undefined
      ? 0
      : usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
    const cacheRate = inputTokens > 0 && usage !== undefined ? usage.cacheReadTokens / inputTokens : undefined
    const occupied = pressure?.projectedTokens ?? pressure?.pressureTokens
    const contextPercent = occupied !== undefined && pressure?.contextWindow !== undefined
      ? occupied / pressure.contextWindow
      : undefined
    const inbox = values?.inbox
    const startedAt = this.deps.turnStartedAt()
    const elapsedSeconds = agent.status === 'running' && startedAt !== undefined
      ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
      : undefined
    const effort = this.deps.effort()
    return {
      cwd: directory ?? session.header.cwd ?? process.cwd(),
      title: title ?? undefined,
      model: selection.model,
      effort: effort.level,
      effortImplicit: effort.implicit,
      inputTokens,
      outputTokens: usage?.outputTokens ?? 0,
      cacheRate,
      contextPercent,
      permission: permissions?.currentValue,
      status: agent.status === 'running' ? copy.status.running : copy.status.idle,
      elapsedSeconds,
      pendingSteering: inbox?.['next-step'].length ?? 0,
      pendingQueued: inbox?.['next-turn'].length ?? 0,
    }
  }
}

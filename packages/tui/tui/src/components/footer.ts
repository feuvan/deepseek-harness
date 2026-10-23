/**
 * The two-line status footer under the composer.
 *
 * @module @deepseek-ai/dsh-tui/components/footer
 */

import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import { copy } from '../copy.ts'
import { displayText } from '../display-text.ts'
import type { Palette } from '../palette.ts'

/** One immutable snapshot of the values the footer shows. */
export interface FooterSnapshot {
  /** Effective working directory. */
  readonly cwd: string
  /** Current Session title, when the log recorded one. */
  readonly title: string | undefined
  /** Selected provider route and model. */
  readonly model: string
  /** Effective reasoning effort, when the model advertises one. */
  readonly effort: string | undefined
  /** Whether {@link effort} is the adapter default rather than an explicit choice. */
  readonly effortImplicit: boolean
  /** Uncached plus cached input tokens billed so far. */
  readonly inputTokens: number
  /** Output tokens produced so far. */
  readonly outputTokens: number
  /** Cache-read share of all billed input traffic, when any input was billed. */
  readonly cacheRate: number | undefined
  /** Current context occupancy out of the advertised window, when both are known. */
  readonly contextPercent: number | undefined
  /** Current permission preset. */
  readonly permission: string | undefined
  /** Agent status label. */
  readonly status: string
  /** Elapsed seconds of the running turn, when the agent runs. */
  readonly elapsedSeconds: number | undefined
  /** Steering messages waiting for the next step boundary. */
  readonly pendingSteering: number
  /** Follow-up messages queued for the next turn. */
  readonly pendingQueued: number
}

/** The status footer below the composer. */
export class Footer implements Component {
  private readonly palette: Palette
  private readonly snapshot: () => FooterSnapshot

  /**
   * @param palette - terminal style table.
   * @param snapshot - reads the current values.
   */
  constructor(palette: Palette, snapshot: () => FooterSnapshot) {
    this.palette = palette
    this.snapshot = snapshot
  }

  /**
   * Render the footer.
   * @param width - available terminal columns.
   * @returns the two styled footer lines.
   */
  render(width: number): string[] {
    const state = this.snapshot()
    const palette = this.palette
    const location = state.title === undefined
      ? displayText(state.cwd)
      : `${displayText(state.title)} · ${displayText(state.cwd)}`
    const first = `${palette.dim('session')} ${truncateToWidth(location, Math.max(1, width - 9))}`

    /** One footer segment with its ambient-drop key. */
    const segment = (key: string, text: string): { key: string; text: string } => ({ key, text })
    const segments = [segment('model', palette.accent(displayText(state.model)))]
    if (state.effort !== undefined) segments.push(segment('effort', palette.dim(displayText(state.effort))))
    segments.push(segment('tokens', palette.dim(`↑${String(state.inputTokens)} ↓${String(state.outputTokens)}`)))
    if (state.cacheRate !== undefined) segments.push(segment('cache', palette.dim(`cache ${String(Math.round(state.cacheRate * 100))}%`)))
    if (state.contextPercent !== undefined) segments.push(segment('ctx', palette.dim(`ctx ${String(Math.round(state.contextPercent * 100))}%`)))
    if (state.permission !== undefined) segments.push(segment('permission', palette.dim(displayText(state.permission))))
    segments.push(segment('status', state.status === copy.status.running ? palette.warning(state.status) : palette.dim(state.status)))
    if (state.elapsedSeconds !== undefined) segments.push(segment('elapsed', palette.dim(`${String(state.elapsedSeconds)}s`)))
    const separator = palette.dim(' · ')
    const join = (active: readonly { text: string }[]): string => ` ${active.map(item => item.text).join(separator)}`
    // Ambient segments leave in this order; the model, effort, permission, and
    // status segments survive every width short of the final truncation.
    let active = segments
    for (const key of ['elapsed', 'cache', 'tokens', 'ctx']) {
      if (visibleWidth(join(active)) <= width) break
      active = active.filter(item => item.key !== key)
    }
    const second = join(active)
    return [truncateToWidth(first, width), truncateToWidth(second, width)]
  }

  /** No cached state exists, so nothing must be invalidated. */
  invalidate(): void {}
}

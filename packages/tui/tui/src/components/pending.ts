/**
 * Pending-input strip: shows the steering and queued messages the Agent has
 * accepted but not yet consumed, so a submitted prompt is never invisible.
 *
 * @module @deepseek-ai/dsh-tui/components/pending
 */

import { truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { copy } from '../copy.ts'
import type { Palette } from '../palette.ts'
import type { FooterSnapshot } from './footer.ts'

/** One dim line above the composer while input is pending. */
export class PendingStrip implements Component {
  private readonly palette: Palette
  private readonly snapshot: () => FooterSnapshot

  /**
   * @param palette - terminal style table.
   * @param snapshot - reads the current pending counts.
   */
  constructor(palette: Palette, snapshot: () => FooterSnapshot) {
    this.palette = palette
    this.snapshot = snapshot
  }

  /**
   * Render the strip, or nothing when no input is pending.
   * @param width - available terminal columns.
   * @returns zero lines or one styled line.
   */
  render(width: number): string[] {
    const state = this.snapshot()
    const parts: string[] = []
    if (state.pendingSteering > 0) parts.push(copy.pending.steering(state.pendingSteering))
    if (state.pendingQueued > 0) parts.push(copy.pending.queued(state.pendingQueued))
    if (parts.length === 0) return []
    const hint = state.status === copy.status.running ? copy.pending.hint : undefined
    const body = hint === undefined ? parts.join(' · ') : `${parts.join(' · ')} · ${hint}`
    return [truncateToWidth(` ${this.palette.warning(body)}`, width)]
  }

  /** No cached state exists, so nothing must be invalidated. */
  invalidate(): void {}
}

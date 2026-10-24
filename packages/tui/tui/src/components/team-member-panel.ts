/**
 * Read-only teammate transcript inside the bottom dock: the recorded events of
 * one Team child Session, scrolled with the same keys as the other panels.
 * It is a viewer, not a driver: prompts to a teammate are sent from the
 * composer, never from this panel.
 *
 * @module @deepseek-ai/dsh-tui/components/team-member-panel
 */

import { matchesKey, truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { copy } from '../copy.ts'
import { displayText } from '../display-text.ts'
import type { Palette } from '../palette.ts'

/** Maximum transcript rows shown at once. */
const MAX_VISIBLE = 10

/** A read-only scrolled transcript for one teammate Session. */
export class TeamMemberPanel implements Component {
  private readonly palette: Palette
  private readonly onClose: () => void
  private title = ''
  private lines: string[] = []
  private offset = 0

  /**
   * @param palette - terminal style table.
   * @param onClose - returns to the Team panel.
   */
  constructor(palette: Palette, onClose: () => void) {
    this.palette = palette
    this.onClose = onClose
  }

  /** Whether a teammate is presented. */
  get active(): boolean {
    return this.title !== ''
  }

  /**
   * Replace the presented transcript.
   * @param name - teammate name.
   * @param lines - already formatted event lines.
   */
  setTranscript(name: string, lines: readonly string[]): void {
    this.title = name === '' ? '' : copy.team.memberTitle(name)
    this.lines = [...lines]
    this.offset = Math.max(0, this.lines.length - MAX_VISIBLE)
  }

  /**
   * Append one live event line and follow the end.
   * @param line - formatted event line.
   */
  append(line: string): void {
    this.lines.push(line)
    this.offset = Math.max(0, this.lines.length - MAX_VISIBLE)
  }

  /**
   * Handle one input sequence while the transcript owns the dock.
   * @param data - raw terminal input.
   * @returns whether the sequence was consumed.
   */
  handleInput(data: string): boolean {
    if (!this.active) return false
    if (matchesKey(data, 'up')) {
      this.offset = Math.max(0, this.offset - 1)
      return true
    }
    if (matchesKey(data, 'down')) {
      this.offset = Math.min(Math.max(0, this.lines.length - MAX_VISIBLE), this.offset + 1)
      return true
    }
    if (matchesKey(data, 'pageUp')) {
      this.offset = Math.max(0, this.offset - MAX_VISIBLE)
      return true
    }
    if (matchesKey(data, 'pageDown')) {
      this.offset = Math.min(Math.max(0, this.lines.length - MAX_VISIBLE), this.offset + MAX_VISIBLE)
      return true
    }
    if (matchesKey(data, 'escape')) {
      this.onClose()
      return true
    }
    return false
  }

  /**
   * Render the title, visible transcript window, and hint.
   * @param width - available terminal columns.
   * @returns the panel lines.
   */
  render(width: number): string[] {
    const palette = this.palette
    const lines = [truncateToWidth(palette.heading(displayText(this.title)), width)]
    if (this.lines.length === 0) {
      lines.push(palette.dim(truncateToWidth(`  ${copy.team.memberEmpty}`, width)))
    } else {
      const visible = Math.min(MAX_VISIBLE, this.lines.length)
      const start = Math.max(0, Math.min(this.offset, this.lines.length - visible))
      if (start > 0) lines.push(palette.dim(`  ↑ ${copy.moreRows(start)}`))
      for (const line of this.lines.slice(start, start + visible)) lines.push(truncateToWidth(line, width))
      const remaining = this.lines.length - (start + visible)
      if (remaining > 0) lines.push(palette.dim(`  ↓ ${copy.moreRows(remaining)}`))
    }
    lines.push(palette.dim(truncateToWidth(` ${copy.team.memberHint}`, width)))
    return lines
  }

  /** No cached renderer state exists beyond the transcript lines. */
  invalidate(): void {}
}

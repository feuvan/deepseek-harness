/**
 * Bottom-anchored stack for the inline renderer: pads once above its child so
 * the first frame fills the terminal and the composer starts at the bottom.
 * The padding is fixed after the first render; later output grows below it and
 * scrolls into the terminal's native scrollback.
 *
 * @module @deepseek-ai/dsh-tui/components/bottom-anchor
 */

import type { Component } from '@earendil-works/pi-tui'

/** Fixed bottom padding for a main-screen component stack. */
export class BottomAnchor implements Component {
  private readonly child: Component
  private readonly rows: () => number
  private padding: number | undefined

  /**
   * @param child - the stacked interface content.
   * @param rows - current terminal rows.
   */
  constructor(child: Component, rows: () => number) {
    this.child = child
    this.rows = rows
  }

  /**
   * Render fixed top padding followed by the child.
   * @param width - terminal columns available to the child.
   * @returns the padded lines.
   */
  render(width: number): string[] {
    const lines = this.child.render(width)
    this.padding ??= Math.max(0, this.rows() - lines.length)
    if (this.padding === 0) return lines
    return [...Array.from({ length: this.padding }, () => ''), ...lines]
  }

  /**
   * Recompute the top padding on the next render, e.g. after a dock closes.
   * The caller must force a full render so the new first line reaches the
   * terminal instead of being diffed against the previous viewport.
   */
  reanchor(): void {
    this.padding = undefined
  }

  /** Invalidate the child. */
  invalidate(): void {
    this.child.invalidate()
  }
}

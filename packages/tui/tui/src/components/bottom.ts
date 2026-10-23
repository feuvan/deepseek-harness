/**
 * The dock slot between the composer and the footer. One active surface at a
 * time (command completion, a chooser list, or the configuration panel) claims
 * it; the slot renders the active surface and otherwise occupies no lines.
 *
 * @module @deepseek-ai/dsh-tui/components/bottom
 */

import type { Component } from '@earendil-works/pi-tui'

/** The line budget the dock keeps for the transcript above it. */
const DEFAULT_MAX_LINES = 16

/**
 * A bottom dock whose content is supplied by the active surface.
 */
export class BottomPanel implements Component {
  private content: Component | undefined
  private readonly maxLines: number

  /**
   * @param maxLines - maximum dock lines kept for one surface.
   */
  constructor(maxLines: number = DEFAULT_MAX_LINES) {
    this.maxLines = maxLines
  }

  /**
   * Install the surface that owns the dock.
   * @param content - the surface component, or undefined to close the dock.
   */
  setContent(content: Component | undefined): void {
    this.content = content
  }

  /** Whether a surface currently owns the dock. */
  get active(): boolean {
    return this.content !== undefined
  }

  /**
   * Render the active surface within the dock's line budget.
   * @param width - available terminal columns.
   * @returns the surface lines, or an empty list when closed.
   */
  render(width: number): string[] {
    return this.content?.render(width).slice(0, this.maxLines) ?? []
  }

  /** Drop cached renderer state on the active surface. */
  invalidate(): void {
    this.content?.invalidate()
  }
}

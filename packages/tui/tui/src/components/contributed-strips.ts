/**
 * Renders every plugin-contributed strip above the composer. An empty list
 * renders zero lines, so the row costs nothing when no plugin contributes.
 *
 * @module @deepseek-ai/dsh-tui/components/contributed-strips
 */

import type { Component } from '@earendil-works/pi-tui'

/** A dynamic vertical stack of contributed one-line surfaces. */
export class ContributedStrips implements Component {
  private readonly strips: readonly Component[]

  /** @param strips - the live contribution list. */
  constructor(strips: readonly Component[]) {
    this.strips = strips
  }

  /**
   * Render every contributed strip in registration order.
   * @param width - available terminal columns.
   * @returns the concatenated strip lines.
   */
  render(width: number): string[] {
    return this.strips.flatMap(strip => strip.render(width))
  }

  /** Invalidate every contributed strip. */
  invalidate(): void {
    for (const strip of this.strips) strip.invalidate()
  }
}

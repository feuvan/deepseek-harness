/**
 * Static startup banner: the product mark, the active model, and the Session
 * identity the terminal is presenting.
 *
 * @module @deepseek-ai/dsh-tui/components/banner
 */

import { truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { copy } from '../copy.ts'
import { displayText } from '../display-text.ts'
import type { Palette } from '../palette.ts'

/** Values the banner reads on every render. */
export interface BannerValues {
  /** Registered provider route and model of the presented Agent. */
  readonly model: () => string
  /** Exact presented Session identity. */
  readonly sessionId: string
  /** Effective working directory. */
  readonly cwd: () => string
}

/** The startup banner above the transcript viewport. */
export class Banner implements Component {
  private readonly palette: Palette
  private readonly values: BannerValues

  /**
   * @param palette - terminal style table.
   * @param values - dynamic values read on each render.
   */
  constructor(palette: Palette, values: BannerValues) {
    this.palette = palette
    this.values = values
  }

  /**
   * Render the banner.
   * @param width - available terminal columns.
   * @returns the styled banner lines.
   */
  render(width: number): string[] {
    const title = ` ${this.palette.heading(copy.banner.title)}`
    const detail = ` ${this.palette.dim(`${displayText(this.values.model())} • ${displayText(this.values.sessionId)}`)}`
    const location = ` ${this.palette.dim(displayText(this.values.cwd()))}`
    return [truncateToWidth(title, width), truncateToWidth(detail, width), truncateToWidth(location, width), '']
  }

  /** No cached state exists, so nothing must be invalidated. */
  invalidate(): void {}
}

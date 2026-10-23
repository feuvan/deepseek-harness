/**
 * A bottom-dock chooser: a titled list with descriptions, selection, and
 * scrolling. Used by `/permission` and bare `/effort` so choices expand below
 * the composer instead of covering the transcript.
 *
 * @module @deepseek-ai/dsh-tui/bottom-list
 */

import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import { copy } from './copy.ts'
import { displayText } from './display-text.ts'
import type { Palette } from './palette.ts'

/** One selectable row of a bottom list. */
export interface BottomListItem {
  /** Value handed to the selection callback. */
  readonly value: string
  /** Primary label. */
  readonly label: string
  /** Supporting sentence shown after the label. */
  readonly description?: string
}

/** Maximum rows one list renders before scrolling. */
const MAX_VISIBLE = 6

/** A bottom-dock chooser over one item list. */
export class BottomList {
  private readonly palette: Palette
  private readonly requestRender: () => void
  private title = ''
  private items: readonly BottomListItem[] = []
  private index = 0
  private onSelect: ((item: BottomListItem) => void) | undefined
  private onCancel: (() => void) | undefined

  /**
   * @param palette - terminal style table.
   * @param requestRender - asks for a frame after a state change.
   */
  constructor(palette: Palette, requestRender: () => void) {
    this.palette = palette
    this.requestRender = requestRender
  }

  /** Whether the list currently owns the dock. */
  get active(): boolean {
    return this.items.length > 0
  }

  /**
   * Present one item list.
   * @param title - heading line.
   * @param items - selectable rows.
   * @param onSelect - receives the chosen row.
   * @param onCancel - closes the list without a choice.
   */
  open(title: string, items: readonly BottomListItem[], onSelect: (item: BottomListItem) => void, onCancel: () => void): void {
    this.title = title
    this.items = items
    this.index = 0
    this.onSelect = onSelect
    this.onCancel = onCancel
    this.requestRender()
  }

  /** Close the list without a choice. */
  close(): void {
    this.items = []
    this.onSelect = undefined
    this.onCancel = undefined
    this.requestRender()
  }

  /**
   * Handle one input sequence while the list owns the dock.
   * @param data - raw terminal input.
   * @returns whether the key was consumed.
   */
  handleInput(data: string): boolean {
    if (!this.active) return false
    if (matchesKey(data, 'up')) {
      this.index = (this.index + this.items.length - 1) % this.items.length
      this.requestRender()
      return true
    }
    if (matchesKey(data, 'down')) {
      this.index = (this.index + 1) % this.items.length
      this.requestRender()
      return true
    }
    if (matchesKey(data, 'pageUp')) {
      this.index = Math.max(0, this.index - MAX_VISIBLE)
      this.requestRender()
      return true
    }
    if (matchesKey(data, 'pageDown')) {
      this.index = Math.min(this.items.length - 1, this.index + MAX_VISIBLE)
      this.requestRender()
      return true
    }
    if (matchesKey(data, 'enter')) {
      const item = this.items[this.index]
      const select = this.onSelect
      this.close()
      if (item !== undefined) select?.(item)
      return true
    }
    if (matchesKey(data, 'escape')) {
      const cancel = this.onCancel
      this.close()
      cancel?.()
      return true
    }
    return false
  }

  /**
   * Render the titled list within the dock's height.
   * @param width - available terminal columns.
   * @returns the list lines.
   */
  render(width: number): string[] {
    const palette = this.palette
    const lines = [truncateToWidth(palette.heading(displayText(this.title)), width)]
    const visible = Math.min(MAX_VISIBLE, this.items.length)
    const start = Math.max(0, Math.min(this.index - Math.floor(visible / 2), this.items.length - visible))
    if (start > 0) lines.push(palette.dim(`  ↑ ${copy.moreRows(start)}`))
    for (let offset = 0; offset < visible; offset += 1) {
      const position = start + offset
      const item = this.items[position]
      /* v8 ignore next -- the window is clamped to the item count */
      if (item === undefined) continue
      const selected = position === this.index
      const marker = selected ? palette.accent('❯') : ' '
      const description = item.description === undefined ? '' : `  ${palette.dim(displayText(item.description))}`
      const label = selected ? palette.inverse(displayText(item.label)) : displayText(item.label)
      lines.push(truncateToWidth(` ${marker} ${label}${description}`, width))
    }
    const remaining = this.items.length - (start + visible)
    if (remaining > 0) lines.push(palette.dim(`  ↓ ${copy.moreRows(remaining)}`))
    lines.push(palette.dim(truncateToWidth(` ${copy.prompt.selectHint}`, width)))
    return lines
  }

  /** No cached state exists beyond the item list. */
  invalidate(): void {}
}

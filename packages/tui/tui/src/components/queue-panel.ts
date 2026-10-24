/**
 * Queue dock: lists the Messages waiting for the next turn so they can be
 * steered into the running turn, edited in the composer, or removed, matching
 * the Desktop queue dock's queued-message editing.
 *
 * @module @deepseek-ai/dsh-tui/components/queue-panel
 */

import { matchesKey, truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { copy } from '../copy.ts'
import { displayText } from '../display-text.ts'
import type { Palette } from '../palette.ts'

/** One queued message row. */
export interface QueuePanelItem {
  /** Inbox identity the actions address. */
  readonly id: string
  /** Preview label. */
  readonly label: string
  /** Optional supporting hint, such as the attachment count. */
  readonly description?: string
}

/** Callbacks a queue panel dispatches. */
export interface QueuePanelHandlers {
  /** Move the selected row into the running turn. */
  steer(item: QueuePanelItem): void
  /** Move the selected row's text back into the composer. */
  edit(item: QueuePanelItem): void
  /** Drop the selected row from the queue. */
  remove(item: QueuePanelItem): void
  /** Close the panel without an action. */
  close(): void
}

/** Maximum rows one queue panel renders before scrolling. */
const MAX_VISIBLE = 6

/** A bottom-dock list over the pending next-turn queue. */
export class QueuePanel implements Component {
  private readonly palette: Palette
  private readonly handlers: QueuePanelHandlers
  private items: readonly QueuePanelItem[] = []
  private index = 0

  /**
   * @param palette - terminal style table.
   * @param handlers - queue actions.
   */
  constructor(palette: Palette, handlers: QueuePanelHandlers) {
    this.palette = palette
    this.handlers = handlers
  }

  /** Whether the panel currently owns the dock. */
  get active(): boolean {
    return this.items.length > 0
  }

  /**
   * Replace the visible rows and keep the selection in range.
   * @param items - pending queued messages in delivery order.
   */
  setItems(items: readonly QueuePanelItem[]): void {
    this.items = items
    this.index = Math.min(this.index, Math.max(0, items.length - 1))
  }

  /**
   * Handle one input sequence while the queue owns the dock.
   * @param data - raw terminal input.
   * @returns whether the sequence was consumed.
   */
  handleInput(data: string): boolean {
    if (!this.active) return false
    if (matchesKey(data, 'up')) {
      this.index = (this.index + this.items.length - 1) % this.items.length
      return true
    }
    if (matchesKey(data, 'down')) {
      this.index = (this.index + 1) % this.items.length
      return true
    }
    if (matchesKey(data, 'pageUp')) {
      this.index = Math.max(0, this.index - MAX_VISIBLE)
      return true
    }
    if (matchesKey(data, 'pageDown')) {
      this.index = Math.min(this.items.length - 1, this.index + MAX_VISIBLE)
      return true
    }
    const item = this.items[this.index]
    if (item === undefined) return false
    if (matchesKey(data, 'enter')) {
      this.handlers.steer(item)
      return true
    }
    if (data === 'e') {
      this.handlers.edit(item)
      return true
    }
    if (data === 'x' || matchesKey(data, 'delete')) {
      this.handlers.remove(item)
      return true
    }
    if (matchesKey(data, 'escape')) {
      this.handlers.close()
      return true
    }
    return false
  }

  /**
   * Render the queue list within the dock's height.
   * @param width - available terminal columns.
   * @returns the panel lines.
   */
  render(width: number): string[] {
    const palette = this.palette
    const lines = [truncateToWidth(palette.heading(displayText(copy.queue.title)), width)]
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
    lines.push(palette.dim(truncateToWidth(` ${copy.queue.hint}`, width)))
    return lines
  }

  /** No cached renderer state exists beyond the row list. */
  invalidate(): void {}
}

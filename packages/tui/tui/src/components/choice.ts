/**
 * A titled single-choice overlay over a filtered selection list. Used where the
 * composer must offer a small named set such as reasoning efforts.
 *
 * @module @deepseek-ai/dsh-tui/components/choice
 */

import { SelectList, truncateToWidth, type Component, type SelectItem, type SelectListTheme } from '@earendil-works/pi-tui'

/** One titled selection list the modal host presents. */
export class ChoicePanel implements Component {
  private readonly title: string
  private readonly styleTitle: (text: string) => string
  private readonly list: SelectList

  /**
   * @param title - panel heading.
   * @param styleTitle - styling for the heading.
   * @param items - selectable entries.
   * @param theme - selection-list styling.
   * @param onSelect - receives the chosen value.
   * @param onCancel - closes without a choice.
   */
  constructor(
    title: string,
    styleTitle: (text: string) => string,
    items: readonly SelectItem[],
    theme: SelectListTheme,
    onSelect: (item: SelectItem) => void,
    onCancel: () => void,
  ) {
    this.title = title
    this.styleTitle = styleTitle
    this.list = new SelectList([...items], 10, theme)
    this.list.onSelect = onSelect
    this.list.onCancel = onCancel
  }

  /**
   * Forward one input sequence to the selection list.
   * @param data - raw terminal input.
   */
  handleInput(data: string): void {
    this.list.handleInput(data)
  }

  /**
   * Render the heading and the list.
   * @param width - available terminal columns.
   * @returns the panel lines.
   */
  render(width: number): string[] {
    return [truncateToWidth(this.styleTitle(this.title), width), ...this.list.render(width)]
  }

  /** List filtering and selection state live in the list; nothing to invalidate here. */
  invalidate(): void {}
}

/**
 * `/plugin` bottom dock: plugins mounted in the current Session and the
 * profile/global plugin bundles they come from. The terminal application owns
 * the plugin-manager reads and writes; this component owns tabs, selection,
 * and rendering.
 *
 * @module @deepseek-ai/dsh-tui/components/plugins
 */

import { matchesKey, truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { copy } from '../copy.ts'
import { displayText } from '../display-text.ts'
import type { Palette } from '../palette.ts'

/** Tabs of the plugin manager dock. */
export type PluginTab = 'session' | 'global'

/** One selectable plugin or bundle row. */
export interface PluginPanelRow {
  /** Stable row identity. */
  readonly id: string
  /** Manager entity kind the row selects. */
  readonly kind: 'plugin' | 'bundle'
  /** Entry id or bundle package name. */
  readonly target: string
  /** Localized display label. */
  readonly label: string
  /** Whether the entity currently contributes. */
  readonly enabled: boolean
  /** Whether activation is unavailable. */
  readonly readOnly: boolean
  /** Localized status such as `on`, `off`, or `read only`. */
  readonly value: string
  /** Optional explanation shown after the label. */
  readonly description?: string
  /** Optional short marker such as `optional`. */
  readonly marker?: string
}

/** Rendered plugin dock state. */
export interface PluginPanelView {
  /** Active tab. */
  readonly tab: PluginTab
  /** Rows for the active tab. */
  readonly rows: readonly PluginPanelRow[]
  /** Loading or cleanup status. */
  readonly status?: string
  /** Operation failure. */
  readonly error?: string
}

/** Parent operations invoked by the plugin dock. */
export interface PluginPanelActions {
  /** Switch to one tab and reload it. */
  switchTab(tab: PluginTab): void
  /** Toggle one plugin or bundle row. */
  toggle(row: PluginPanelRow): void
  /** Reload the active tab. */
  refresh(): void
  /** Close the dock. */
  close(): void
  /** Request a repaint after state changes. */
  requestRender(): void
}

/** Constructor values for the plugin dock. */
export interface PluginPanelOptions {
  /** Terminal style table. */
  readonly palette: Palette
  /** Parent operations. */
  readonly actions: PluginPanelActions
}

/** The `/plugin` bottom-dock component. */
export class PluginPanel implements Component {
  private readonly palette: Palette
  private readonly actions: PluginPanelActions
  private view: PluginPanelView = { tab: 'session', rows: [], status: copy.plugin.loading }
  private index = 0
  private readonly visibleRows = 10

  /**
   * @param options - palette and parent operations.
   */
  constructor(options: PluginPanelOptions) {
    this.palette = options.palette
    this.actions = options.actions
  }

  /**
   * Replace the rendered state.
   * @param view - latest plugin data.
   */
  setView(view: PluginPanelView): void {
    this.view = view
    this.index = Math.min(this.index, Math.max(0, view.rows.length - 1))
    this.actions.requestRender()
  }

  /**
   * Handle one input sequence while the dock owns focus.
   * @param data - raw terminal input.
   * @returns whether the sequence was consumed.
   */
  handleInput(data: string): boolean {
    if (matchesKey(data, 'escape')) {
      this.actions.close()
      return true
    }
    if (matchesKey(data, 'tab') || matchesKey(data, 'right')) {
      this.actions.switchTab(this.view.tab === 'session' ? 'global' : 'session')
      return true
    }
    if (matchesKey(data, 'left')) {
      this.actions.switchTab(this.view.tab === 'session' ? 'global' : 'session')
      return true
    }
    if (matchesKey(data, 'up') || data === 'k') {
      a: {
        if (this.view.rows.length === 0) break a
        this.index = (this.index + this.view.rows.length - 1) % this.view.rows.length
      }
      this.actions.requestRender()
      return true
    }
    if (matchesKey(data, 'down') || data === 'j') {
      a: {
        if (this.view.rows.length === 0) break a
        this.index = (this.index + 1) % this.view.rows.length
      }
      this.actions.requestRender()
      return true
    }
    if (matchesKey(data, 'enter')) {
      const row = this.view.rows[this.index]
      if (row !== undefined && !row.readOnly) this.actions.toggle(row)
      return true
    }
    if (data === 'r' || data === 'R') {
      this.actions.refresh()
      return true
    }
    return true
  }

  /** @returns the current row index. */
  private window(): readonly PluginPanelRow[] {
    const half = Math.floor(this.visibleRows / 2)
    const start = Math.max(0, Math.min(this.index - half, this.view.rows.length - this.visibleRows))
    return this.view.rows.slice(start, start + this.visibleRows)
  }

  /** @returns one tab label with its active state. */
  private tabLabel(tab: PluginTab, label: string): string {
    const text = tab === this.view.tab ? `[${label}]` : ` ${label} `
    return tab === this.view.tab ? this.palette.accent(text) : this.palette.dim(text)
  }

  /**
   * Render the plugin dock.
   * @param width - available columns.
   * @returns styled panel lines.
   */
  render(width: number): string[] {
    const lines = [
      this.palette.heading(copy.plugin.title),
      `${this.tabLabel('session', copy.plugin.sessionTab)}  ${this.tabLabel('global', copy.plugin.globalTab)}`,
    ]
    if (this.view.error !== undefined) lines.push(this.palette.error(displayText(this.view.error)))
    else if (this.view.status !== undefined) lines.push(this.palette.dim(this.view.status))
    const rows = this.window()
    if (rows.length === 0 && this.view.status === undefined && this.view.error === undefined) {
      lines.push(this.palette.dim(this.view.tab === 'session' ? copy.plugin.emptySession : copy.plugin.emptyGlobal))
    }
    for (const row of rows) {
      const selected = this.view.rows[this.index]?.id === row.id
      const marker = selected ? this.palette.accent('❯') : ' '
      const state = row.readOnly ? copy.plugin.readOnly : row.value
      const suffix = row.marker === undefined ? '' : ` · ${row.marker}`
      const description = row.description === undefined ? '' : ` — ${displayText(row.description)}`
      lines.push(truncateToWidth(
        `${marker} ${displayText(row.label)}  ${state}${suffix}${description}`,
        width,
      ))
    }
    lines.push('', this.palette.dim(copy.plugin.hint))
    return lines.map(line => truncateToWidth(line, width))
  }

  /** No cached child renderer state exists. */
  invalidate(): void {}
}

/**
 * The `/config` bottom dock: one tab per configuration category, each listing
 * its rows in a scrolling window. Actionable rows mutate the live application
 * through injected actions; rows owned by the profile configuration show
 * read-only values. {@link loadConfigRows} reads the rows from the composed
 * services and {@link ConfigPanel} renders and navigates them.
 *
 * @module @deepseek-ai/dsh-tui/config-panel
 */

import { matchesKey, truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { copy } from './copy.ts'
import { displayText } from './display-text.ts'
import type { BusyEnter } from './config.ts'
import type { LocaleConfig } from './locale.ts'
import type { Palette } from './palette.ts'

/** The configuration categories the panel renders, in display order. */
export type ConfigSection = 'model' | 'permissions' | 'experimental' | 'display'

/** The layer that owns one configuration value. */
export type ConfigScope = 'session' | 'profile' | 'repository'

/** What one row activation reports back to the panel. */
export interface ConfigActionResult {
  /** Localized notice to show after the change settles; absent for silent changes. */
  readonly notice?: string
  /** Whether the change takes effect only after a restart. */
  readonly restartRequired?: boolean
}

/** A row activation's result, either settled synchronously or as a promise. */
export type ConfigActionOutcome = ConfigActionResult | void | Promise<ConfigActionResult | void>

/** One rendered line of the configuration panel. */
export interface ConfigRow {
  /** Stable row identity, used for restart markers. */
  readonly id: string
  /** Category the row renders under. */
  readonly section: ConfigSection
  /** Localized row label. */
  readonly label: string
  /** Value text; empty for an action row that carries no value. */
  readonly value: string
  /** Layer that owns the value when the row is a setting rather than a live fact. */
  readonly scope: ConfigScope | undefined
  /** Whether the row only displays a value and ignores Enter. */
  readonly readOnly: boolean
  /** Additional localized status marker rendered after the value. */
  readonly marker?: string
  /** Action invoked by Enter; absent for read-only rows. */
  readonly activate?: () => ConfigActionOutcome
}

/** The model route and reasoning-effort facts the model section shows. */
export interface ConfigModelState {
  /** Registered provider route of the current selection. */
  readonly provider: string
  /** Provider-owned model id of the current selection. */
  readonly model: string
  /** Explicitly selected reasoning effort, when the current selection sets one. */
  readonly effort: string | undefined
  /** Whether `effort` comes from the adapter default rather than the selection. */
  readonly effortImplicit: boolean
}

/** The terminal display values the profile configuration owns. */
export interface ConfigDisplayState {
  /** Whether rendered text carries ANSI styling. */
  readonly color: boolean
  /** Whether the running footer advances its elapsed clock. */
  readonly animation: boolean
  /** Maximum body lines shown for a collapsed tool card. */
  readonly previewLines: number
  /** Maximum transcript blocks kept rendered at once. */
  readonly windowBlocks: number
  /** Prefix for the terminal title. */
  readonly title: string
  /** Configured interface language, with `auto` still unresolved. */
  readonly locale: LocaleConfig
  /** Delivery mode plain Enter uses while the Agent runs. */
  readonly busyEnter: BusyEnter
}

/** One permission preset the panel can switch to. */
export interface ConfigPermissionOption {
  /** Stable preset value written by the switch. */
  readonly value: string
  /** Localized display label. */
  readonly name: string
  /** Localized one-sentence meaning; absent when the preset declares none. */
  readonly description?: string
}

/** The permission-preset catalog face the row loader reads. */
export interface ConfigPermissionService {
  /**
   * Read the currently selectable presets.
   * @returns the presets in contribution order.
   */
  catalog(): { readonly options: readonly ConfigPermissionOption[] }
}

/** One bundle the plugin manager reports. */
export interface ConfigBundleInfo {
  /** Package name of the bundle. */
  readonly name: string
  /** Whether the installation ships this bundle as an optional capability. */
  readonly optional: boolean
  /** Whether the profile manifest currently selects the bundle. */
  readonly enabled: boolean
  /** Why the profile patch cannot change the bundle; absent when it can. */
  readonly readOnlyReason?: string
}

/** The plugin-manager face the row loader reads. */
export interface ConfigBundleService {
  /**
   * Read every installed, shipped, and on-demand bundle.
   * @returns the bundles the manager can see.
   */
  listBundles(): Promise<readonly ConfigBundleInfo[]>
}

/** The write actions the panel's actionable rows invoke. */
export interface ConfigPanelActions {
  /**
   * Open the model selector.
   * @returns an optional result the panel reports.
   */
  pickModel(): ConfigActionOutcome
  /**
   * Open the reasoning-effort chooser.
   * @returns an optional result the panel reports.
   */
  pickEffort(): ConfigActionOutcome
  /**
   * Switch the current session's permission preset.
   * @param value - the preset value to select.
   * @returns an optional result the panel reports.
   */
  setPermission(value: string): ConfigActionOutcome
  /**
   * Enable or disable one optional bundle.
   * @param name - the bundle package name.
   * @param enabled - the requested activation state.
   * @returns an optional result the panel reports, including a restart notice.
   */
  setBundle(name: string, enabled: boolean): ConfigActionOutcome
  /**
   * Cycle the tool-card density.
   * @returns an optional result the panel reports.
   */
  toggleCards(): ConfigActionOutcome
  /**
   * Toggle reasoning visibility.
   * @returns an optional result the panel reports.
   */
  toggleReasoning(): ConfigActionOutcome
}

/** The values {@link loadConfigRows} reads. */
export interface ConfigPanelDeps {
  /** Current model route and effort. */
  readonly model: ConfigModelState
  /** Current permission preset value, when the Session projection knows it. */
  readonly permission: string | undefined
  /** Terminal display values from the resolved profile configuration. */
  readonly display: ConfigDisplayState
  /** Permission catalog; absent when the composition mounts no permission service. */
  readonly permissionPresets?: ConfigPermissionService | undefined
  /** Plugin manager; absent when the composition mounts no plugin manager. */
  readonly pluginManager?: ConfigBundleService | undefined
  /** Write actions for the actionable rows. */
  readonly actions: ConfigPanelActions
}

/** The callbacks the panel reports through. */
export interface ConfigPanelHandlers {
  /** Called with an activated row before its action runs. */
  readonly onActivate?: (row: ConfigRow) => void
  /** Called when the user closes the panel without activating a row. */
  readonly onCancel: () => void
  /** Called with the localized notice an action result carries. */
  readonly onNotice?: (message: string) => void
  /** Called when an action's change takes effect only after a restart. */
  readonly onRestartNotice: (message: string) => void
}

/** Constructor values for {@link ConfigPanel}. */
export interface ConfigPanelOptions {
  /** Rows to present, in the order the loader returned them. */
  readonly rows: readonly ConfigRow[]
  /** Terminal style table. */
  readonly palette: Palette
  /** Callbacks the panel reports through. */
  readonly handlers: ConfigPanelHandlers
  /**
   * Body rows rendered below the tab bar; defaults to 8 and is clamped to
   * 3–10 so the tab bar, body, and hint stay within the dock's line budget.
   */
  readonly visibleRows?: number
}

/** Section order shared by the loader and the panel. */
const SECTION_ORDER: readonly ConfigSection[] = ['model', 'permissions', 'experimental', 'display']

/** Default number of body rows rendered below the tab bar. */
const DEFAULT_VISIBLE_ROWS = 8

/** Smallest body height that still fits both scroll indicators and one row. */
const MIN_VISIBLE_ROWS = 3

/** Largest body height, keeping the whole dock at twelve lines. */
const MAX_VISIBLE_ROWS = 10

/** The kind of fallback row a section without data shows. */
type ConfigFallback = 'unavailable' | 'empty'

/** One scroll window over the active tab's rows. */
interface ScrollWindow {
  /** Index of the first visible row. */
  readonly start: number
  /** Number of rows rendered inside the window. */
  readonly capacity: number
  /** Rows hidden below the window. */
  readonly below: number
}

/**
 * The localized heading of one configuration section.
 * @param section - the section.
 * @returns the heading shown above its rows.
 */
function sectionTitle(section: ConfigSection): string {
  const titles: Record<ConfigSection, string> = {
    model: copy.config.modelSection,
    permissions: copy.config.permissionSection,
    experimental: copy.config.experimentalSection,
    display: copy.config.displaySection,
  }
  return titles[section]
}

/**
 * The localized marker naming the layer that owns a value.
 * @param scope - the owning layer.
 * @returns the marker text.
 */
function scopeLabel(scope: ConfigScope): string {
  switch (scope) {
    case 'session': return copy.config.scopeSession
    case 'profile': return copy.config.scopeProfile
    case 'repository': return copy.config.scopeRepository
  }
}

/**
 * The tab adjacent to one section, cycling through the fixed order.
 * @param section - the current section.
 * @param delta - `1` for the next tab, `-1` for the previous one.
 * @returns the adjacent section.
 */
function adjacentSection(section: ConfigSection, delta: 1 | -1): ConfigSection {
  switch (section) {
    case 'model': return delta === 1 ? 'permissions' : 'display'
    case 'permissions': return delta === 1 ? 'experimental' : 'model'
    case 'experimental': return delta === 1 ? 'display' : 'permissions'
    case 'display': return delta === 1 ? 'model' : 'experimental'
  }
}

/**
 * Extract a printable message from an unknown action failure.
 * @param error - the rejection or throw reason.
 * @returns the error message, or the value coerced to text.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Rows for the model and reasoning-effort section.
 * @param deps - the values the loader reads.
 * @returns the current route and effort with their change actions.
 */
function modelRows(deps: ConfigPanelDeps): ConfigRow[] {
  return [
    {
      id: 'model.current',
      section: 'model',
      label: copy.statusPanel.model,
      value: `${deps.model.provider}/${deps.model.model}`,
      scope: undefined,
      readOnly: true,
    },
    {
      id: 'model.change',
      section: 'model',
      label: copy.config.changeModel,
      value: '',
      scope: 'session',
      readOnly: false,
      activate: () => deps.actions.pickModel(),
    },
    {
      id: 'effort.current',
      section: 'model',
      label: copy.statusPanel.effort,
      value: effortValue(deps.model),
      scope: undefined,
      readOnly: true,
    },
    {
      id: 'effort.change',
      section: 'model',
      label: copy.config.changeEffort,
      value: '',
      scope: 'session',
      readOnly: false,
      activate: () => deps.actions.pickEffort(),
    },
  ]
}

/**
 * Format the effective reasoning effort of one model selection.
 * @param model - the current route and effort facts.
 * @returns the selected level, the adapter default, or the provider default.
 */
function effortValue(model: ConfigModelState): string {
  if (model.effort === undefined) return copy.statusPanel.effortDefault
  return model.effortImplicit ? copy.statusPanel.effortImplicit(model.effort) : model.effort
}

/**
 * One fallback row for a section whose service or data is absent.
 * @param section - the section that needs the fallback.
 * @param kind - whether the service is missing or the catalog is empty.
 * @param label - the localized fallback label.
 * @returns the read-only fallback row.
 */
function fallbackRow(section: ConfigSection, kind: ConfigFallback, label: string): ConfigRow {
  return { id: `${section}.${kind}`, section, label, value: '', scope: undefined, readOnly: true }
}

/**
 * Rows for the permission section.
 * @param deps - the values the loader reads.
 * @returns one row per selectable preset, or a fallback row.
 */
function permissionRows(deps: ConfigPanelDeps): ConfigRow[] {
  const presets = deps.permissionPresets
  if (presets === undefined) {
    return [fallbackRow('permissions', 'unavailable', copy.config.unavailable('permissionPresets'))]
  }
  const options = presets.catalog().options
  if (options.length === 0) return [fallbackRow('permissions', 'empty', copy.config.none)]
  return options.map(option => ({
    id: `permission.${option.value}`,
    section: 'permissions',
    label: option.name,
    value: option.description ?? '',
    scope: 'session',
    readOnly: false,
    ...(option.value === deps.permission ? { marker: copy.prompt.permissionCurrent } : {}),
    activate: () => deps.actions.setPermission(option.value),
  }))
}

/**
 * Rows for the experimental-capability section.
 * @param deps - the values the loader reads.
 * @returns one row per optional bundle, or a fallback row.
 */
async function experimentalRows(deps: ConfigPanelDeps): Promise<ConfigRow[]> {
  const manager = deps.pluginManager
  if (manager === undefined) {
    return [fallbackRow('experimental', 'unavailable', copy.config.unavailable('pluginManager'))]
  }
  const bundles = (await manager.listBundles()).filter(bundle => bundle.optional)
  if (bundles.length === 0) return [fallbackRow('experimental', 'empty', copy.config.none)]
  return bundles.map(bundle => ({
    id: `bundle.${bundle.name}`,
    section: 'experimental',
    label: bundle.name,
    value: bundle.enabled ? copy.config.on : copy.config.off,
    scope: 'session',
    readOnly: bundle.readOnlyReason !== undefined,
    ...(bundle.readOnlyReason === undefined
      ? { activate: () => deps.actions.setBundle(bundle.name, !bundle.enabled) }
      : { marker: bundle.readOnlyReason }),
  }))
}

/**
 * One read-only row for a display value the profile configuration owns.
 * @param field - the configuration key serving as the row label.
 * @param value - the current value rendered as text.
 * @returns the row.
 */
function displayRow(field: string, value: string): ConfigRow {
  return { id: `display.${field}`, section: 'display', label: field, value, scope: 'profile', readOnly: true }
}

/**
 * Rows for the terminal-display section.
 * @param deps - the values the loader reads.
 * @returns the read-only profile values followed by the in-session toggles.
 */
function displayRows(deps: ConfigPanelDeps): ConfigRow[] {
  const display = deps.display
  return [
    displayRow('color', display.color ? copy.config.on : copy.config.off),
    displayRow('animation', display.animation ? copy.config.on : copy.config.off),
    displayRow('previewLines', String(display.previewLines)),
    displayRow('windowBlocks', String(display.windowBlocks)),
    displayRow('title', display.title),
    displayRow('locale', display.locale),
    displayRow('busyEnter', display.busyEnter),
    {
      id: 'display.cards',
      section: 'display',
      label: copy.config.toolCards,
      value: '',
      scope: 'session',
      readOnly: false,
      activate: () => deps.actions.toggleCards(),
    },
    {
      id: 'display.reasoning',
      section: 'display',
      label: copy.config.reasoning,
      value: '',
      scope: 'session',
      readOnly: false,
      activate: () => deps.actions.toggleReasoning(),
    },
  ]
}

/**
 * Read every configuration row from the composed services.
 * @param deps - the model, permission, display, service, and action values.
 * @returns the rows in section order.
 */
export async function loadConfigRows(deps: ConfigPanelDeps): Promise<ConfigRow[]> {
  return [
    ...modelRows(deps),
    ...permissionRows(deps),
    ...(await experimentalRows(deps)),
    ...displayRows(deps),
  ]
}

/** The `/config` bottom dock: one tab per section over a scrolling row list. */
export class ConfigPanel implements Component {
  private readonly rows: readonly ConfigRow[]
  private readonly palette: Palette
  private readonly handlers: ConfigPanelHandlers
  private readonly bodyHeight: number
  private readonly restartMarkers = new Map<string, string>()
  private section: ConfigSection = 'model'
  private cursor = 0
  private scroll = 0
  private busy = false

  /**
   * @param options - rows, the terminal style table, callbacks, and the body height.
   */
  constructor(options: ConfigPanelOptions) {
    this.rows = options.rows
    this.palette = options.palette
    this.handlers = options.handlers
    const requested = options.visibleRows ?? DEFAULT_VISIBLE_ROWS
    this.bodyHeight = Math.min(MAX_VISIBLE_ROWS, Math.max(MIN_VISIBLE_ROWS, Math.floor(requested)))
  }

  /**
   * Handle one input sequence while the dock has focus.
   * @param data - raw terminal input.
   */
  handleInput(data: string): void {
    if (this.busy) return
    if (matchesKey(data, 'tab') || matchesKey(data, 'right')) {
      this.switchSection(1)
      return
    }
    if (matchesKey(data, 'shift+tab') || matchesKey(data, 'left')) {
      this.switchSection(-1)
      return
    }
    if (matchesKey(data, 'up')) {
      this.moveCursor(-1)
      return
    }
    if (matchesKey(data, 'down')) {
      this.moveCursor(1)
      return
    }
    if (matchesKey(data, 'pageUp')) {
      this.pageCursor(-1)
      return
    }
    if (matchesKey(data, 'pageDown')) {
      this.pageCursor(1)
      return
    }
    if (matchesKey(data, 'enter')) {
      this.activateCurrent()
      return
    }
    if (matchesKey(data, 'escape')) this.handlers.onCancel()
  }

  /**
   * Render the dock.
   * @param width - available terminal columns.
   * @returns the tab bar, exactly the body height of body lines, and the hint line.
   */
  render(width: number): string[] {
    return [
      this.tabBar(width),
      ...this.bodyLines(this.activeRows(), width),
      this.palette.dim(truncateToWidth(`  ${copy.config.tabHint}`, width)),
    ]
  }

  /** No cached state exists: the tab, cursor, and scroll window are read on each render. */
  invalidate(): void {}

  /** @returns the rows of the active tab, in loader order. */
  private activeRows(): readonly ConfigRow[] {
    return this.rows.filter(row => row.section === this.section)
  }

  /**
   * Move to the adjacent tab and reset the row cursor.
   * @param delta - `1` for the next tab, `-1` for the previous one.
   */
  private switchSection(delta: 1 | -1): void {
    this.section = adjacentSection(this.section, delta)
    this.cursor = 0
    this.scroll = 0
  }

  /**
   * Move the row cursor with wrap-around inside the active tab.
   * @param delta - `-1` up or `1` down.
   */
  private moveCursor(delta: number): void {
    const count = this.activeRows().length
    if (count === 0) return
    this.cursor = (this.cursor + delta + count) % count
  }

  /**
   * Jump the row cursor by one body height, clamped to the active tab.
   * @param direction - `-1` toward the first row, `1` toward the last.
   */
  private pageCursor(direction: 1 | -1): void {
    const count = this.activeRows().length
    if (count === 0) return
    this.cursor = Math.min(count - 1, Math.max(0, this.cursor + direction * this.bodyHeight))
  }

  /**
   * Render the scrolling body of one tab.
   * @param rows - the active tab's rows.
   * @param width - available terminal columns.
   * @returns exactly the configured body height lines.
   */
  private bodyLines(rows: readonly ConfigRow[], width: number): string[] {
    const lines: string[] = []
    if (rows.length === 0) {
      lines.push(this.palette.dim(truncateToWidth(`  ${copy.config.none}`, width)))
    } else {
      const window = this.windowFor(rows.length)
      if (window.start > 0) lines.push(this.indicator('↑', window.start, width))
      const visible = rows.slice(window.start, window.start + window.capacity)
      for (const [offset, row] of visible.entries()) {
        lines.push(this.rowLine(row, window.start + offset === this.cursor, width))
      }
      if (window.below > 0) lines.push(this.indicator('↓', window.below, width))
    }
    while (lines.length < this.bodyHeight) lines.push('')
    return lines
  }

  /**
   * Derive the scroll window that keeps the cursor visible.
   * @param count - number of rows in the active tab.
   * @returns the window and the number of rows hidden above and below it.
   */
  private windowFor(count: number): ScrollWindow {
    if (count <= this.bodyHeight) return { start: 0, capacity: count, below: 0 }
    let start = Math.min(this.scroll, count - 1)
    for (;;) {
      const capacity = this.capacityFor(start, count)
      if (this.cursor < start) {
        start = this.cursor
        continue
      }
      if (this.cursor >= start + capacity) {
        start = this.cursor - capacity + 1
        continue
      }
      this.scroll = start
      return { start, capacity, below: count - start - capacity }
    }
  }

  /**
   * Rows that fit in the body budget at one scroll position.
   * @param start - index of the first visible row.
   * @param count - number of rows in the active tab.
   * @returns the number of rows the window may render.
   */
  private capacityFor(start: number, count: number): number {
    let capacity = this.bodyHeight - (start > 0 ? 1 : 0)
    capacity = Math.min(capacity, count - start)
    if (start + capacity < count) capacity -= 1
    return capacity
  }

  /**
   * Render one scroll indicator line.
   * @param direction - `↑` for rows hidden above, `↓` for rows hidden below.
   * @param count - number of hidden rows.
   * @param width - available terminal columns.
   * @returns the dim indicator line.
   */
  private indicator(direction: '↑' | '↓', count: number, width: number): string {
    return this.palette.dim(truncateToWidth(`  ${direction} ${copy.moreRows(count)}`, width))
  }

  /**
   * Render the tab bar.
   * @param width - available terminal columns.
   * @returns the styled tab labels on one line.
   */
  private tabBar(width: number): string {
    const bar = SECTION_ORDER.map((section) => {
      const label = ` ${sectionTitle(section)} `
      return section === this.section ? this.palette.inverse(label) : this.palette.dim(label)
    }).join('')
    return truncateToWidth(bar, width)
  }

  /**
   * Render one body row.
   * @param row - the row.
   * @param selected - whether the cursor is on the row.
   * @param width - available terminal columns.
   * @returns the row line.
   */
  private rowLine(row: ConfigRow, selected: boolean, width: number): string {
    const marker = selected ? this.palette.accent('❯') : ' '
    return truncateToWidth(
      `  ${marker} ${displayText(row.label)}${this.valueOf(row)}${this.markersOf(row)}`,
      width,
    )
  }

  /** Invoke the highlighted row's action and report its result. */
  private activateCurrent(): void {
    const row = this.activeRows()[this.cursor]
    if (row?.activate === undefined) return
    this.busy = true
    this.handlers.onActivate?.(row)
    let outcome: ConfigActionOutcome
    try {
      outcome = row.activate()
    } catch (error: unknown) {
      this.busy = false
      this.handlers.onNotice?.(copy.config.writeFailed(errorMessage(error)))
      return
    }
    void Promise.resolve(outcome).then(
      (result) => { this.report(result, row.id) },
      (error: unknown) => { this.handlers.onNotice?.(copy.config.writeFailed(errorMessage(error))) },
    ).finally(() => { this.busy = false })
  }

  /**
   * Surface one settled action result.
   * @param result - the result, or void for a silent action.
   * @param rowId - identity of the activated row.
   */
  private report(result: ConfigActionResult | void, rowId: string): void {
    if (result === undefined) return
    if (result.notice !== undefined) this.handlers.onNotice?.(result.notice)
    if (result.restartRequired === true) {
      this.restartMarkers.set(rowId, copy.config.restartMarker)
      this.handlers.onRestartNotice(copy.config.restartRequired)
    }
  }

  /**
   * Render one row's value column.
   * @param row - the row.
   * @returns the styled value suffix, empty for a row without a value.
   */
  private valueOf(row: ConfigRow): string {
    if (row.value === '') return ''
    return `  ${this.palette.dim(displayText(row.value))}`
  }

  /**
   * Render one row's status markers.
   * @param row - the row.
   * @returns the styled marker suffix, empty when the row carries none.
   */
  private markersOf(row: ConfigRow): string {
    const markers: string[] = []
    if (row.scope !== undefined) markers.push(scopeLabel(row.scope))
    if (row.readOnly) markers.push(copy.config.readOnly)
    const restart = this.restartMarkers.get(row.id)
    if (restart !== undefined) markers.push(restart)
    if (row.marker !== undefined) markers.push(row.marker)
    if (markers.length === 0) return ''
    return `  ${this.palette.dim(`(${markers.join(' · ')})`)}`
  }
}

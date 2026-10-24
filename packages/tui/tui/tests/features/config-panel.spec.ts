/**
 * Row loading and bottom-dock tests for the `/config` panel: the loader over a
 * real Cordis context with provided service doubles, and the rendered dock's
 * tabs, scrolling, activation, and failure reporting.
 *
 * @module tests/features/config-panel
 */

import { describe, expect, it, vi } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import {
  ConfigPanel,
  loadConfigRows,
  type ConfigActionOutcome,
  type ConfigBundleInfo,
  type ConfigDisplayState,
  type ConfigModelState,
  type ConfigPanelActions,
  type ConfigPermissionOption,
  type ConfigRow,
  type ConfigSection,
} from '../../src/config-panel.ts'
import { copy } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'
import { freshContext } from '../core/harness.ts'
import { visibleLines } from '../support/terminal.ts'

/** Up-arrow escape sequence. */
const UP = '\u001b[A'

/** Down-arrow escape sequence. */
const DOWN = '\u001b[B'

/** Right-arrow escape sequence. */
const RIGHT = '\u001b[C'

/** Left-arrow escape sequence. */
const LEFT = '\u001b[D'

/** Tab key. */
const TAB = '\t'

/** Shift+Tab escape sequence. */
const SHIFT_TAB = '\u001b[Z'

/** Page-up escape sequence. */
const PAGE_UP = '\u001b[5~'

/** Page-down escape sequence. */
const PAGE_DOWN = '\u001b[6~'

/** Enter key. */
const ENTER = '\r'

/** Escape key. */
const ESCAPE = '\u001b'

/** The styled palette used to assert the active tab's styling. */
const COLORED = createPalette(true)

/** The model route the loader tests start from. */
const MODEL: ConfigModelState = { provider: 'alpha', model: 'alpha-1', effort: 'high', effortImplicit: false }

/** The display values the loader tests start from. */
const DISPLAY: ConfigDisplayState = {
  color: true,
  animation: false,
  previewLines: 10,
  windowBlocks: 200,
  title: 'Test Terminal',
  locale: 'auto',
  busyEnter: 'queue',
}

/** Two selectable permission presets. */
const PRESETS: readonly ConfigPermissionOption[] = [
  { value: 'read-only', name: 'Read only', description: 'No writes' },
  { value: 'workspace-write', name: 'Workspace write' },
]

/** One enabled, one disabled, one read-only optional bundle, and a non-optional one. */
const BUNDLES: readonly ConfigBundleInfo[] = [
  { name: 'optional-bundle', optional: true, enabled: true },
  { name: 'disabled-bundle', optional: true, enabled: false },
  { name: 'locked-bundle', optional: true, enabled: true, readOnlyReason: 'management-required' },
  { name: 'core-bundle', optional: false, enabled: true },
]

/** Recorded action calls and the actions service that produces them. */
interface ActionRecorder {
  /** The injectable actions service. */
  readonly actions: ConfigPanelActions
  /** Every action call, in order, as `name` or `name:argument`. */
  readonly calls: string[]
}

/**
 * Build the recording actions service.
 * @param overrides - implementations to replace.
 * @returns the service and its recorded calls.
 */
function recordingActions(overrides: Partial<ConfigPanelActions> = {}): ActionRecorder {
  const calls: string[] = []
  const actions: ConfigPanelActions = Object.assign({
    pickModel: () => { calls.push('pickModel') },
    pickEffort: () => { calls.push('pickEffort') },
    setPermission: (value: string) => { calls.push(`setPermission:${value}`) },
    setBundle: (name: string, enabled: boolean) => { calls.push(`setBundle:${name}:${String(enabled)}`) },
    toggleCards: () => { calls.push('toggleCards') },
    toggleReasoning: () => { calls.push('toggleReasoning') },
  }, overrides)
  return { actions, calls }
}

/** Values one {@link loadRows} run starts from. */
interface LoaderOptions {
  /** Model route to report; defaults to {@link MODEL}. */
  readonly model?: ConfigModelState
  /** Current permission preset; absent when the projection reports none. */
  readonly permission?: string | undefined
  /** Display values; defaults to {@link DISPLAY}. */
  readonly display?: ConfigDisplayState
  /** Permission catalog to provide; absent leaves the service unprovided. */
  readonly presets?: readonly ConfigPermissionOption[]
  /** Bundles to provide; absent leaves the plugin manager unprovided. */
  readonly bundles?: readonly ConfigBundleInfo[]
  /** Action implementations to replace. */
  readonly actions?: Partial<ConfigPanelActions>
}

/** One loaded row set with its recorded actions. */
interface LoadedRows {
  /** The rows the loader returned. */
  readonly rows: ConfigRow[]
  /** Every action call, in order. */
  readonly calls: string[]
}

/**
 * Load rows over a real Cordis context that provides the optional services.
 * @param options - model, permission, display, service, and action values.
 * @returns the loaded rows and the recorded action calls.
 */
async function loadRows(options: LoaderOptions = {}): Promise<LoadedRows> {
  const recorder = recordingActions(options.actions)
  const services: Record<string, unknown> = {}
  if (options.presets !== undefined) {
    const presets = [...options.presets]
    services['permissionPresets'] = { catalog: () => ({ options: presets }) }
  }
  if (options.bundles !== undefined) {
    const bundles = [...options.bundles]
    services['pluginManager'] = { listBundles: async () => bundles }
  }
  const ctx = freshContext(services)
  const rows = await loadConfigRows({
    model: options.model ?? MODEL,
    permission: options.permission,
    display: options.display ?? DISPLAY,
    permissionPresets: ctx.get('permissionPresets'),
    pluginManager: ctx.get('pluginManager'),
    actions: recorder.actions,
  })
  return { rows, calls: recorder.calls }
}

/**
 * Find one loaded row by identity.
 * @param rows - loaded rows.
 * @param id - row identity.
 * @returns the row.
 * @throws when no row carries the identity.
 */
function findRow(rows: readonly ConfigRow[], id: string): ConfigRow {
  const found = rows.find(row => row.id === id)
  if (found === undefined) throw new Error(`missing row ${id}`)
  return found
}

/**
 * Read one row's activation, proving the row is actionable.
 * @param rows - loaded rows.
 * @param id - row identity.
 * @returns the row's action.
 * @throws when the row is read-only.
 */
function activator(rows: readonly ConfigRow[], id: string): () => ConfigActionOutcome {
  const activate = findRow(rows, id).activate
  if (activate === undefined) throw new Error(`row ${id} is not actionable`)
  return activate
}

/** Recorded panel outcomes and the panel that produced them. */
interface PanelHarness {
  /** The panel under test. */
  readonly panel: ConfigPanel
  /** Every activated row, in order. */
  readonly activations: ConfigRow[]
  /** Every notice the panel reported, in order. */
  readonly notices: string[]
  /** Every restart notice the panel reported, in order. */
  readonly restarts: string[]
  /** The number of cancellation reports. */
  readonly cancels: number[]
}

/** Values one {@link panelFor} run starts from. */
interface PanelOptions {
  /** Rows to present. */
  readonly rows: readonly ConfigRow[]
  /** Handler implementations to replace. */
  readonly handlers?: Partial<PanelHarnessHandlers>
  /** Whether the palette styles text. */
  readonly color?: boolean
  /** Body height; the panel defaults to 8 and clamps to 3–10. */
  readonly visibleRows?: number
}

/** Panel handlers with every callback required, for replacement by tests. */
interface PanelHarnessHandlers {
  /** Activation observer. */
  readonly onActivate: (row: ConfigRow) => void
  /** Cancellation observer. */
  readonly onCancel: () => void
  /** Notice observer. */
  readonly onNotice: (message: string) => void
  /** Restart-notice observer. */
  readonly onRestartNotice: (message: string) => void
}

/**
 * Build one panel with recording callbacks.
 * @param options - rows, handler replacements, palette color, and body height.
 * @returns the panel and its recorded outcomes.
 */
function panelFor(options: PanelOptions): PanelHarness {
  const activations: ConfigRow[] = []
  const notices: string[] = []
  const restarts: string[] = []
  const cancels: number[] = []
  const handlers: PanelHarnessHandlers = Object.assign({
    onActivate: (row: ConfigRow) => { activations.push(row) },
    onCancel: () => { cancels.push(1) },
    onNotice: (message: string) => { notices.push(message) },
    onRestartNotice: (message: string) => { restarts.push(message) },
  }, options.handlers)
  const panel = new ConfigPanel({
    rows: options.rows,
    palette: createPalette(options.color ?? false),
    handlers,
    ...(options.visibleRows === undefined ? {} : { visibleRows: options.visibleRows }),
  })
  return { panel, activations, notices, restarts, cancels }
}

/**
 * Build one actionable row.
 * @param id - row identity and label.
 * @param activate - the row's action.
 * @param section - owning section; defaults to the initially active model tab.
 * @returns the row.
 */
function actionRow(id: string, activate: () => ConfigActionOutcome, section: ConfigSection = 'model'): ConfigRow {
  return { id, section, label: id, value: '', scope: undefined, readOnly: false, activate }
}

/**
 * Build one read-only row without markers.
 * @param section - owning section.
 * @param id - row identity and label.
 * @returns the row.
 */
function plainRow(section: ConfigSection, id: string): ConfigRow {
  return { id, section, label: id, value: '', scope: undefined, readOnly: true }
}

/**
 * Build a numbered run of read-only rows in one section.
 * @param section - owning section.
 * @param count - number of rows.
 * @returns the rows, labelled `row-00`, `row-01`, and so on.
 */
function manyRows(section: ConfigSection, count: number): ConfigRow[] {
  return Array.from({ length: count }, (_, index) => plainRow(section, `row-${String(index).padStart(2, '0')}`))
}

/**
 * Render one panel as visible text.
 * @param panel - the panel.
 * @param width - terminal columns.
 * @returns the rendered text joined with line feeds.
 */
function rendered(panel: ConfigPanel, width = 120): string {
  return visibleLines(panel.render(width)).join('\n')
}

/**
 * Render only the body lines, excluding the tab bar and the hint.
 * @param panel - the panel.
 * @param visibleRows - body height the panel was constructed with.
 * @returns the body text joined with line feeds.
 */
function body(panel: ConfigPanel, visibleRows = 8): string {
  return visibleLines(panel.render(120)).slice(1, 1 + visibleRows).join('\n')
}

/**
 * Wait for one settled activation to release the panel's input gate.
 * @returns a promise settled after the activation's microtasks run.
 */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
}

/**
 * The localized heading of one section, as the tab bar renders it.
 * @param section - the section.
 * @returns the heading text.
 */
function heading(section: ConfigSection): string {
  switch (section) {
    case 'model': return copy.config.modelSection
    case 'permissions': return copy.config.permissionSection
    case 'experimental': return copy.config.experimentalSection
    case 'display': return copy.config.displaySection
  }
}

/**
 * Switch from the initial model tab to the display tab.
 * @param panel - the panel.
 */
function goToDisplay(panel: ConfigPanel): void {
  panel.handleInput(TAB)
  panel.handleInput(TAB)
  panel.handleInput(TAB)
}

describe('loadConfigRows', () => {
  it('orders the four sections and reports the current model route', async () => {
    const { rows, calls } = await loadRows({ presets: PRESETS, bundles: BUNDLES })

    expect([...new Set(rows.map(row => row.section))]).toEqual(['model', 'permissions', 'experimental', 'display'])
    expect(findRow(rows, 'model.current')).toMatchObject({
      label: copy.statusPanel.model,
      value: 'alpha/alpha-1',
      scope: undefined,
      readOnly: true,
    })
    expect(findRow(rows, 'effort.current')).toMatchObject({
      label: copy.statusPanel.effort,
      value: 'high',
      readOnly: true,
    })

    await activator(rows, 'model.change')()
    await activator(rows, 'effort.change')()

    expect(calls).toEqual(['pickModel', 'pickEffort'])
  })

  it('formats the provider default and the implicit adapter effort', async () => {
    const fallback = await loadRows({ model: { ...MODEL, effort: undefined } })
    expect(findRow(fallback.rows, 'effort.current').value).toBe(copy.statusPanel.effortDefault)

    const implicit = await loadRows({ model: { ...MODEL, effort: 'low', effortImplicit: true } })
    expect(findRow(implicit.rows, 'effort.current').value).toBe(copy.statusPanel.effortImplicit('low'))
  })

  it('reports the profile-owned display values and the in-session toggles', async () => {
    const first = await loadRows({ display: { ...DISPLAY, color: true, animation: false } })
    expect(findRow(first.rows, 'display.color')).toMatchObject({
      label: 'color',
      value: copy.config.on,
      scope: 'profile',
      readOnly: true,
    })
    expect(findRow(first.rows, 'display.animation').value).toBe(copy.config.off)
    expect(findRow(first.rows, 'display.previewLines').value).toBe('10')
    expect(findRow(first.rows, 'display.windowBlocks').value).toBe('200')
    expect(findRow(first.rows, 'display.title').value).toBe('Test Terminal')
    expect(findRow(first.rows, 'display.locale').value).toBe('auto')
    expect(findRow(first.rows, 'display.busyEnter')).toMatchObject({
      label: 'busyEnter',
      value: 'queue',
      scope: 'profile',
      readOnly: true,
    })

    const second = await loadRows({ display: { ...DISPLAY, color: false, animation: true } })
    expect(findRow(second.rows, 'display.color').value).toBe(copy.config.off)
    expect(findRow(second.rows, 'display.animation').value).toBe(copy.config.on)

    await activator(first.rows, 'display.cards')()
    await activator(first.rows, 'display.reasoning')()
    expect(first.calls).toEqual(['toggleCards', 'toggleReasoning'])
  })

  it('lists the permission catalog with the current preset marked', async () => {
    const { rows, calls } = await loadRows({ presets: PRESETS, permission: 'workspace-write' })

    const current = findRow(rows, 'permission.workspace-write')
    expect(current).toMatchObject({
      label: 'Workspace write',
      value: '',
      scope: 'session',
      readOnly: false,
      marker: copy.prompt.permissionCurrent,
    })
    expect(findRow(rows, 'permission.read-only')).toMatchObject({ label: 'Read only', value: 'No writes' })
    expect(findRow(rows, 'permission.read-only').marker).toBeUndefined()

    await activator(rows, 'permission.read-only')()
    expect(calls).toEqual(['setPermission:read-only'])
  })

  it('lists optional bundles with the next activation state and the read-only reason', async () => {
    const { rows, calls } = await loadRows({ bundles: BUNDLES })

    expect(findRow(rows, 'bundle.optional-bundle')).toMatchObject({
      label: 'optional-bundle',
      value: copy.config.on,
      scope: 'session',
      readOnly: false,
    })
    expect(findRow(rows, 'bundle.disabled-bundle').value).toBe(copy.config.off)
    expect(findRow(rows, 'bundle.locked-bundle')).toMatchObject({
      readOnly: true,
      marker: 'management-required',
    })
    expect(findRow(rows, 'bundle.locked-bundle').activate).toBeUndefined()
    expect(rows.some(row => row.id === 'bundle.core-bundle')).toBe(false)

    await activator(rows, 'bundle.optional-bundle')()
    await activator(rows, 'bundle.disabled-bundle')()
    expect(calls).toEqual(['setBundle:optional-bundle:false', 'setBundle:disabled-bundle:true'])
  })

  it('shows unavailable rows when the optional services are absent', async () => {
    const { rows } = await loadRows()

    expect(findRow(rows, 'permissions.unavailable')).toMatchObject({
      label: copy.config.unavailable('permissionPresets'),
      value: '',
      scope: undefined,
      readOnly: true,
    })
    expect(findRow(rows, 'experimental.unavailable')).toMatchObject({
      label: copy.config.unavailable('pluginManager'),
      readOnly: true,
    })
    expect(findRow(rows, 'permissions.unavailable').activate).toBeUndefined()
  })

  it('shows a placeholder row for an empty catalog', async () => {
    const { rows } = await loadRows({ presets: [], bundles: [] })

    expect(findRow(rows, 'permissions.empty')).toMatchObject({ label: copy.config.none, readOnly: true })
    expect(findRow(rows, 'experimental.empty')).toMatchObject({ label: copy.config.none, readOnly: true })
  })
})

describe('ConfigPanel tab bar', () => {
  it('renders one tab per section in fixed order with the active tab highlighted', async () => {
    const { rows } = await loadRows({ presets: PRESETS, bundles: BUNDLES })
    const harness = panelFor({ rows, color: true })

    const line = harness.panel.render(200)[0] ?? ''

    const positions = [heading('model'), heading('permissions'), heading('experimental'), heading('display')]
      .map(title => line.indexOf(title))
    expect(positions[0]).toBeGreaterThanOrEqual(0)
    expect([...positions].sort((left, right) => left - right)).toEqual(positions)
    expect(line).toContain(COLORED.inverse(` ${heading('model')} `))
    expect(line).toContain(COLORED.dim(` ${heading('permissions')} `))

    harness.panel.handleInput(TAB)

    const next = harness.panel.render(200)[0] ?? ''
    expect(next).toContain(COLORED.inverse(` ${heading('permissions')} `))
    expect(next).toContain(COLORED.dim(` ${heading('model')} `))
  })

  it('cycles tabs with Tab/Shift+Tab and the left/right arrows', async () => {
    const { rows } = await loadRows({ presets: PRESETS, bundles: BUNDLES })
    const harness = panelFor({ rows })

    expect(rendered(harness.panel)).toContain('alpha/alpha-1')
    harness.panel.handleInput(TAB)
    expect(rendered(harness.panel)).toContain('Read only')
    expect(rendered(harness.panel)).not.toContain('alpha/alpha-1')
    harness.panel.handleInput(RIGHT)
    expect(rendered(harness.panel)).toContain('optional-bundle')
    harness.panel.handleInput(LEFT)
    expect(rendered(harness.panel)).toContain('Read only')
    harness.panel.handleInput(SHIFT_TAB)
    expect(rendered(harness.panel)).toContain('alpha/alpha-1')

    harness.panel.handleInput(SHIFT_TAB)
    expect(rendered(harness.panel)).toContain('previewLines')
    harness.panel.handleInput(SHIFT_TAB)
    expect(rendered(harness.panel)).toContain('optional-bundle')
    harness.panel.handleInput(SHIFT_TAB)
    expect(rendered(harness.panel)).toContain('Read only')
    harness.panel.handleInput(SHIFT_TAB)
    expect(rendered(harness.panel)).toContain('alpha/alpha-1')

    harness.panel.handleInput(TAB)
    harness.panel.handleInput(TAB)
    harness.panel.handleInput(TAB)
    expect(rendered(harness.panel)).toContain('previewLines')
    harness.panel.handleInput(TAB)
    expect(rendered(harness.panel)).toContain('alpha/alpha-1')
  })

  it('resets the row cursor when switching tabs', async () => {
    const { rows } = await loadRows({ presets: PRESETS })
    const harness = panelFor({ rows })

    harness.panel.handleInput(DOWN)
    harness.panel.handleInput(DOWN)
    expect(rendered(harness.panel)).toContain(`❯ ${copy.statusPanel.effort}`)

    harness.panel.handleInput(TAB)
    harness.panel.handleInput(SHIFT_TAB)

    expect(rendered(harness.panel)).toContain(`❯ ${copy.statusPanel.model}`)
  })
})

describe('ConfigPanel row navigation', () => {
  it('moves the cursor with wrap-around inside the active tab', async () => {
    const { rows } = await loadRows({ presets: PRESETS })
    const harness = panelFor({ rows })

    expect(rendered(harness.panel)).toContain(`❯ ${copy.statusPanel.model}`)
    harness.panel.handleInput(UP)
    expect(rendered(harness.panel)).toContain(`❯ ${copy.config.changeEffort}`)
    harness.panel.handleInput(DOWN)
    expect(rendered(harness.panel)).toContain(`❯ ${copy.statusPanel.model}`)
    harness.panel.handleInput(DOWN)
    expect(rendered(harness.panel)).toContain(`❯ ${copy.config.changeModel}`)
  })

  it('jumps by the body height with PageDown and PageUp', () => {
    const harness = panelFor({ rows: manyRows('display', 20), visibleRows: 5 })
    goToDisplay(harness.panel)

    expect(rendered(harness.panel)).toContain('❯ row-00')
    for (const expected of ['row-05', 'row-10', 'row-15', 'row-19']) {
      harness.panel.handleInput(PAGE_DOWN)
      expect(rendered(harness.panel)).toContain(`❯ ${expected}`)
    }
    for (const expected of ['row-14', 'row-09', 'row-04', 'row-00']) {
      harness.panel.handleInput(PAGE_UP)
      expect(rendered(harness.panel)).toContain(`❯ ${expected}`)
    }
  })
})

describe('ConfigPanel scrolling', () => {
  it('shows a bottom indicator at the start of the list', () => {
    const harness = panelFor({ rows: manyRows('display', 20), visibleRows: 5 })
    goToDisplay(harness.panel)

    expect(body(harness.panel, 5)).toContain(`↓ ${copy.moreRows(16)}`)
    expect(body(harness.panel, 5)).not.toContain('↑ ')
  })

  it('shows both indicators in the middle of the list', () => {
    const harness = panelFor({ rows: manyRows('display', 20), visibleRows: 5 })
    goToDisplay(harness.panel)
    harness.panel.handleInput(PAGE_DOWN)
    harness.panel.handleInput(PAGE_DOWN)

    expect(body(harness.panel, 5)).toContain(`↑ ${copy.moreRows(8)}`)
    expect(body(harness.panel, 5)).toContain(`↓ ${copy.moreRows(9)}`)
  })

  it('shows only a top indicator at the end of the list', () => {
    const harness = panelFor({ rows: manyRows('display', 20), visibleRows: 5 })
    goToDisplay(harness.panel)
    for (let page = 0; page < 4; page += 1) harness.panel.handleInput(PAGE_DOWN)

    expect(body(harness.panel, 5)).toContain(`↑ ${copy.moreRows(16)}`)
    expect(body(harness.panel, 5)).not.toContain('↓ ')
  })

  it('caps the rendered lines at the configured body height', () => {
    const rows = manyRows('display', 20)

    expect(panelFor({ rows }).panel.render(100)).toHaveLength(10)
    expect(panelFor({ rows, visibleRows: 5 }).panel.render(100)).toHaveLength(7)
    expect(panelFor({ rows, visibleRows: 99 }).panel.render(100)).toHaveLength(12)
    expect(panelFor({ rows, visibleRows: 1 }).panel.render(100)).toHaveLength(5)
  })

  it('pads a short tab body to the configured height', async () => {
    const { rows } = await loadRows({ presets: PRESETS, bundles: BUNDLES })
    const harness = panelFor({ rows })

    const lines = harness.panel.render(100)

    expect(lines).toHaveLength(10)
    expect(lines.slice(5, 9)).toEqual(['', '', '', ''])
  })
})

describe('ConfigPanel rendering', () => {
  it('renders row values and scope, read-only, and custom markers', async () => {
    const { rows } = await loadRows({ presets: PRESETS, permission: 'read-only', bundles: BUNDLES })
    const harness = panelFor({ rows })

    expect(rendered(harness.panel)).toContain('alpha/alpha-1')
    expect(rendered(harness.panel)).toContain(`(${copy.config.readOnly})`)
    expect(rendered(harness.panel)).toContain(`(${copy.config.scopeSession})`)

    harness.panel.handleInput(TAB)
    expect(rendered(harness.panel)).toContain(copy.prompt.permissionCurrent)

    harness.panel.handleInput(RIGHT)
    expect(rendered(harness.panel)).toContain('locked-bundle')
    expect(rendered(harness.panel)).toContain('management-required')

    harness.panel.handleInput(RIGHT)
    expect(rendered(harness.panel)).toContain(`(${copy.config.scopeProfile} · ${copy.config.readOnly})`)
    expect(rendered(harness.panel)).toContain(copy.config.on)
  })

  it('renders a bare row without markers', () => {
    const harness = panelFor({
      rows: [
        { id: 'scoped', section: 'model', label: 'Scoped', value: '', scope: 'repository', readOnly: false },
        { id: 'marked', section: 'model', label: 'Marked', value: 'value', scope: undefined, readOnly: false, marker: 'beta' },
        { id: 'bare', section: 'model', label: 'Bare', value: '', scope: undefined, readOnly: false },
      ],
    })

    const text = rendered(harness.panel)

    expect(text).toContain(`(${copy.config.scopeRepository})`)
    expect(text).toContain('(beta)')
    const bare = visibleLines(harness.panel.render(120)).find(line => line.includes('Bare'))
    expect(bare).toBeDefined()
    expect(bare).not.toContain('(')
  })

  it('renders none for a tab without rows and keeps it inert', () => {
    const harness = panelFor({ rows: [plainRow('display', 'only')] })

    expect(rendered(harness.panel)).toContain(copy.config.none)

    for (const key of [UP, DOWN, PAGE_UP, PAGE_DOWN, ENTER]) harness.panel.handleInput(key)

    expect(harness.activations).toEqual([])
    expect(rendered(harness.panel)).toContain(copy.config.none)

    goToDisplay(harness.panel)
    expect(rendered(harness.panel)).toContain('only')
  })

  it('truncates every line to the available width', async () => {
    const { rows } = await loadRows({
      presets: [{ value: 'a-very-long-preset-value', name: 'A permission preset with a very long display name' }],
      bundles: [{ name: 'an-optional-bundle-with-a-very-long-package-name', optional: true, enabled: true }],
      display: { ...DISPLAY, title: 'A terminal title that is far wider than the panel' },
    })
    const harness = panelFor({ rows })

    const lines = harness.panel.render(20)

    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(20)
    expect(lines).toHaveLength(10)
  })

  it('invalidates without cached state', () => {
    const harness = panelFor({ rows: [actionRow('alpha', () => {})] })

    expect(() => { harness.panel.invalidate() }).not.toThrow()
    expect(rendered(harness.panel)).toContain('alpha')
  })
})

describe('ConfigPanel activation results', () => {
  it('activates the cursor row on the active tab and ignores read-only rows', async () => {
    const { rows, calls } = await loadRows({ presets: PRESETS })
    const harness = panelFor({ rows })

    harness.panel.handleInput(ENTER)
    expect(harness.activations).toEqual([])

    harness.panel.handleInput(DOWN)
    harness.panel.handleInput(ENTER)
    expect(harness.activations.map(row => row.id)).toEqual(['model.change'])
    expect(calls).toEqual(['pickModel'])
    await settle()

    harness.panel.handleInput(TAB)
    harness.panel.handleInput(ENTER)
    expect(harness.activations.map(row => row.id)).toEqual(['model.change', 'permission.read-only'])
    expect(calls).toEqual(['pickModel', 'setPermission:read-only'])
  })

  it('surfaces an action notice and a restart requirement', async () => {
    const harness = panelFor({
      rows: [
        actionRow('notify', () => ({ notice: 'changed' })),
        actionRow('restart', () => ({ restartRequired: true })),
        actionRow('quiet', () => ({})),
        actionRow('silent', () => {}),
      ],
    })

    harness.panel.handleInput(ENTER)
    await vi.waitFor(() => { expect(harness.notices).toEqual(['changed']) })
    await settle()
    expect(harness.restarts).toEqual([])

    harness.panel.handleInput(DOWN)
    harness.panel.handleInput(ENTER)
    await vi.waitFor(() => { expect(harness.restarts).toEqual([copy.config.restartRequired]) })
    expect(rendered(harness.panel)).toContain(copy.config.restartMarker)
    expect(rendered(harness.panel)).not.toContain(copy.config.restartRequired)
    expect(rendered(harness.panel)).toContain(`(${copy.config.restartMarker})`)
    expect(harness.notices).toEqual(['changed'])
    await settle()

    harness.panel.handleInput(DOWN)
    harness.panel.handleInput(ENTER)
    await settle()
    harness.panel.handleInput(DOWN)
    harness.panel.handleInput(ENTER)
    await vi.waitFor(() => {
      expect(harness.activations.map(row => row.id)).toEqual(['notify', 'restart', 'quiet', 'silent'])
    })
    expect(harness.notices).toEqual(['changed'])
    expect(harness.restarts).toEqual([copy.config.restartRequired])
  })

  it('reports a failed synchronous action', async () => {
    const harness = panelFor({
      rows: [
        actionRow('explode', () => { throw new Error('disk full') }),
        actionRow('offline', () => { throw 'offline' }),
      ],
    })

    harness.panel.handleInput(ENTER)
    await vi.waitFor(() => { expect(harness.notices).toEqual([copy.config.writeFailed('disk full')]) })

    harness.panel.handleInput(DOWN)
    harness.panel.handleInput(ENTER)
    await vi.waitFor(() => { expect(harness.notices).toEqual([
      copy.config.writeFailed('disk full'),
      copy.config.writeFailed('offline'),
    ]) })
  })

  it('reports a failed asynchronous action', async () => {
    const harness = panelFor({ rows: [actionRow('reject', () => Promise.reject(new Error('nope')))] })

    harness.panel.handleInput(ENTER)

    await vi.waitFor(() => { expect(harness.notices).toEqual([copy.config.writeFailed('nope')]) })
  })

  it('ignores input while an action is pending', async () => {
    let release: (() => void) | undefined
    const calls: string[] = []
    const harness = panelFor({
      rows: [actionRow('slow', () => {
        calls.push('slow')
        return new Promise<void>((resolve) => { release = resolve })
      })],
    })

    harness.panel.handleInput(ENTER)
    harness.panel.handleInput(ENTER)
    harness.panel.handleInput(DOWN)
    expect(calls).toEqual(['slow'])

    release?.()
    await vi.waitFor(() => {
      harness.panel.handleInput(ENTER)
      expect(calls).toEqual(['slow', 'slow'])
    })
  })

  it('reports through only the required callbacks', async () => {
    const activations: ConfigRow[] = []
    const restarts: string[] = []
    const panel = new ConfigPanel({
      rows: [
        actionRow('notify', () => ({ notice: 'ignored' })),
        actionRow('explode', () => { throw new Error('boom') }),
        actionRow('reject', async () => { throw 'down' }),
        actionRow('restart', () => ({ restartRequired: true })),
      ],
      palette: createPalette(false),
      handlers: {
        onActivate: (row: ConfigRow) => { activations.push(row) },
        onCancel: () => {},
        onRestartNotice: (message: string) => { restarts.push(message) },
      },
    })

    panel.handleInput(ENTER)
    await settle()
    panel.handleInput(DOWN)
    panel.handleInput(ENTER)
    await vi.waitFor(() => { expect(activations.map(row => row.id)).toEqual(['notify', 'explode']) })

    panel.handleInput(DOWN)
    panel.handleInput(ENTER)
    await vi.waitFor(() => { expect(activations).toHaveLength(3) })
    await settle()

    panel.handleInput(DOWN)
    panel.handleInput(ENTER)
    await vi.waitFor(() => { expect(restarts).toEqual([copy.config.restartRequired]) })
  })

  it('activates without an activation observer', async () => {
    const panel = new ConfigPanel({
      rows: [actionRow('notify', () => ({ notice: 'ignored' }))],
      palette: createPalette(false),
      handlers: { onCancel: () => {}, onRestartNotice: () => {} },
    })

    panel.handleInput(ENTER)
    await settle()

    expect(rendered(panel)).toContain('notify')
  })

  it('closes on Escape through the cancel handler and ignores unrelated keys', () => {
    const harness = panelFor({ rows: [actionRow('alpha', () => {})] })

    harness.panel.handleInput('x')
    expect(harness.cancels).toEqual([])

    harness.panel.handleInput(ESCAPE)

    expect(harness.cancels).toEqual([1])
  })
})

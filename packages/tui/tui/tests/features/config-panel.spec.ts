/**
 * Row loading and interaction tests for the `/config` panel: the loader over a
 * real Cordis context with provided service doubles, and the rendered panel's
 * navigation, filtering, activation, and failure reporting.
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
} from '../../src/config-panel.ts'
import { copy } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'
import { freshContext } from '../core/harness.ts'
import { visibleLines } from '../support/terminal.ts'

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
 * @param options - rows, handler replacements, and palette color.
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
  const panel = new ConfigPanel({ rows: options.rows, palette: createPalette(options.color ?? false), handlers })
  return { panel, activations, notices, restarts, cancels }
}

/**
 * Build one actionable row in the display section.
 * @param id - row identity and label.
 * @param activate - the row's action.
 * @returns the row.
 */
function actionRow(id: string, activate: () => ConfigActionOutcome): ConfigRow {
  return { id, section: 'display', label: id, value: '', scope: 'session', readOnly: false, activate }
}

/**
 * Render one panel as visible text.
 * @param panel - the panel.
 * @param width - terminal columns.
 * @returns the rendered text joined with line feeds.
 */
function rendered(panel: ConfigPanel, width = 100): string {
  return visibleLines(panel.render(width)).join('\n')
}

/**
 * Type one printable string into the panel's filter.
 * @param panel - the panel.
 * @param text - characters to type.
 */
function typeText(panel: ConfigPanel, text: string): void {
  for (const character of text) panel.handleInput(character)
}

/**
 * Wait for one settled activation to release the panel's input gate.
 * @returns a promise settled after the activation's microtasks run.
 */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
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

describe('ConfigPanel rendering', () => {
  it('renders the section headings, row markers, and the filter hint', async () => {
    const { rows } = await loadRows({ presets: PRESETS, permission: 'read-only', bundles: BUNDLES })
    const harness = panelFor({ rows })

    const text = rendered(harness.panel)

    expect(text.split('\n')[0]).toBe(copy.config.title)
    expect(text.indexOf(copy.config.modelSection)).toBeLessThan(text.indexOf(copy.config.permissionSection))
    expect(text.indexOf(copy.config.permissionSection)).toBeLessThan(text.indexOf(copy.config.experimentalSection))
    expect(text.indexOf(copy.config.experimentalSection)).toBeLessThan(text.indexOf(copy.config.displaySection))
    expect(text).toContain(copy.statusPanel.model)
    expect(text).toContain('alpha/alpha-1')
    expect(text).toContain(copy.prompt.permissionCurrent)
    expect(text).toContain(`(${copy.config.scopeSession})`)
    expect(text).toContain(`(${copy.config.scopeProfile} · ${copy.config.readOnly})`)
    expect(text).toContain(copy.config.readOnly)
    expect(text).toContain(copy.config.on)
    expect(text).toContain(copy.config.hint)
  })

  it('renders loader and custom markers', () => {
    const rows: ConfigRow[] = [
      { id: 'scoped', section: 'display', label: 'Scoped', value: '', scope: 'repository', readOnly: false },
      { id: 'marked', section: 'display', label: 'Marked', value: 'value', scope: undefined, readOnly: false, marker: 'beta' },
      { id: 'bare', section: 'display', label: 'Bare', value: '', scope: undefined, readOnly: false },
    ]
    const harness = panelFor({ rows })

    const text = rendered(harness.panel)

    expect(text).toContain(`(${copy.config.scopeRepository})`)
    expect(text).toContain('(beta)')
    const bare = visibleLines(harness.panel.render(100)).find(line => line.includes('Bare'))
    expect(bare).toBeDefined()
    expect(bare).not.toContain('(')
  })

  it('truncates every line to the available width', async () => {
    const { rows } = await loadRows({
      presets: [{ value: 'a-very-long-preset-value', name: 'A permission preset with a very long display name' }],
      bundles: [{ name: 'an-optional-bundle-with-a-very-long-package-name', optional: true, enabled: true }],
      display: { ...DISPLAY, title: 'A terminal title that is far wider than the panel' },
    })
    const harness = panelFor({ rows })

    typeText(harness.panel, 'a-very-long-filter-query-that-does-not-fit')

    for (const line of harness.panel.render(20)) expect(visibleWidth(line)).toBeLessThanOrEqual(20)
  })

  it('invalidates without cached state', () => {
    const harness = panelFor({ rows: [actionRow('a', () => {})] })

    expect(() => { harness.panel.invalidate() }).not.toThrow()
    expect(rendered(harness.panel)).toContain('a')
  })
})

describe('ConfigPanel navigation', () => {
  it('moves the highlight with the arrow keys and wraps at both ends', () => {
    const rows = [actionRow('a', () => {}), actionRow('b', () => {}), actionRow('c', () => {})]
    const harness = panelFor({ rows })

    expect(rendered(harness.panel)).toContain('❯ a')
    harness.panel.handleInput('\u001b[B')
    expect(rendered(harness.panel)).toContain('❯ b')
    harness.panel.handleInput('\u001b[B')
    expect(rendered(harness.panel)).toContain('❯ c')
    harness.panel.handleInput('\u001b[B')
    expect(rendered(harness.panel)).toContain('❯ a')
    harness.panel.handleInput('\u001b[A')
    expect(rendered(harness.panel)).toContain('❯ c')
  })

  it('activates the highlighted row on Enter and ignores read-only rows', async () => {
    const { rows } = await loadRows({ presets: PRESETS })
    const harness = panelFor({ rows })

    harness.panel.handleInput('\r')
    expect(harness.activations).toEqual([])

    harness.panel.handleInput('\u001b[B')
    harness.panel.handleInput('\r')
    expect(harness.activations.map(row => row.id)).toEqual(['model.change'])
  })

  it('clears the filter before cancelling', () => {
    const harness = panelFor({ rows: [actionRow('alpha', () => {}), actionRow('beta', () => {})] })

    typeText(harness.panel, 'beta')
    expect(rendered(harness.panel)).not.toContain('alpha')

    harness.panel.handleInput('\u001b')
    expect(harness.cancels).toEqual([])
    expect(rendered(harness.panel)).toContain('alpha')

    harness.panel.handleInput('\u001b')
    expect(harness.cancels).toEqual([1])
  })
})

describe('ConfigPanel filtering', () => {
  it('filters by section heading, row label, and row value', async () => {
    const { rows } = await loadRows({ presets: PRESETS, bundles: BUNDLES })
    const harness = panelFor({ rows })

    typeText(harness.panel, 'perm')
    expect(rendered(harness.panel)).toContain(copy.config.permissionSection)
    expect(rendered(harness.panel)).not.toContain(copy.config.modelSection)

    harness.panel.handleInput('\u001b')
    typeText(harness.panel, 'preview')
    expect(rendered(harness.panel)).toContain('previewLines')
    expect(rendered(harness.panel)).not.toContain(copy.config.permissionSection)

    harness.panel.handleInput('\u001b')
    typeText(harness.panel, '200')
    expect(rendered(harness.panel)).toContain('windowBlocks')
    expect(rendered(harness.panel)).not.toContain('previewLines')
  })

  it('reports no matching rows and ignores navigation and activation', () => {
    const harness = panelFor({ rows: [actionRow('alpha', () => {})] })

    typeText(harness.panel, 'zzz')
    const text = rendered(harness.panel)
    expect(text).toContain(copy.config.noMatches)
    expect(text).not.toContain('❯')

    harness.panel.handleInput('\u001b[A')
    harness.panel.handleInput('\u001b[B')
    harness.panel.handleInput('\r')

    expect(harness.activations).toEqual([])
  })
})

describe('ConfigPanel activation results', () => {
  it('surfaces an action notice and a restart requirement', async () => {
    const harness = panelFor({
      rows: [
        actionRow('notify', () => ({ notice: 'changed' })),
        actionRow('restart', () => ({ restartRequired: true })),
        actionRow('quiet', () => ({})),
        actionRow('silent', () => {}),
      ],
    })

    harness.panel.handleInput('\r')
    await vi.waitFor(() => { expect(harness.notices).toEqual(['changed']) })
    await settle()
    expect(harness.restarts).toEqual([])

    harness.panel.handleInput('\u001b[B')
    harness.panel.handleInput('\r')
    await vi.waitFor(() => { expect(harness.restarts).toEqual([copy.config.restartRequired]) })
    expect(rendered(harness.panel)).toContain(copy.config.restartMarker)
    expect(harness.notices).toEqual(['changed'])
    await settle()

    harness.panel.handleInput('\u001b[B')
    harness.panel.handleInput('\r')
    await settle()
    harness.panel.handleInput('\u001b[B')
    harness.panel.handleInput('\r')
    await vi.waitFor(() => { expect(harness.activations.map(row => row.id)).toEqual(['notify', 'restart', 'quiet', 'silent']) })
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

    harness.panel.handleInput('\r')
    await vi.waitFor(() => { expect(harness.notices).toEqual([copy.config.writeFailed('disk full')]) })

    harness.panel.handleInput('\u001b[B')
    harness.panel.handleInput('\r')
    await vi.waitFor(() => { expect(harness.notices).toEqual([
      copy.config.writeFailed('disk full'),
      copy.config.writeFailed('offline'),
    ]) })
  })

  it('reports a failed asynchronous action', async () => {
    const harness = panelFor({ rows: [actionRow('reject', () => Promise.reject(new Error('nope')))] })

    harness.panel.handleInput('\r')

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

    harness.panel.handleInput('\r')
    harness.panel.handleInput('\r')
    harness.panel.handleInput('\u001b[B')
    expect(calls).toEqual(['slow'])

    release?.()
    await vi.waitFor(() => {
      harness.panel.handleInput('\r')
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

    panel.handleInput('\r')
    await settle()
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    await vi.waitFor(() => { expect(activations.map(row => row.id)).toEqual(['notify', 'explode']) })

    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    await vi.waitFor(() => { expect(activations).toHaveLength(3) })
    await settle()

    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    await vi.waitFor(() => { expect(restarts).toEqual([copy.config.restartRequired]) })
  })

  it('activates without an activation observer', async () => {
    const panel = new ConfigPanel({
      rows: [actionRow('notify', () => ({ notice: 'ignored' }))],
      palette: createPalette(false),
      handlers: { onCancel: () => {}, onRestartNotice: () => {} },
    })

    panel.handleInput('\r')
    await settle()

    expect(rendered(panel)).toContain('notify')
  })
})

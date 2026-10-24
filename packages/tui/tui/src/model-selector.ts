/**
 * The advisory model catalog and its keyboard selector.
 *
 * @module @deepseek-ai/dsh-tui/model-selector
 */

import { Input, matchesKey, truncateToWidth, type Component } from '@earendil-works/pi-tui'
import type { Context } from '@deepseek-ai/cordis'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { copy } from './copy.ts'
import { displayText } from './display-text.ts'
import type { Palette } from './palette.ts'

/** One selectable model row with its adapter-advertised reasoning efforts. */
export interface TuiModelRow {
  /** Registered provider route. */
  readonly provider: string
  /** Provider display name. */
  readonly providerName: string
  /** Provider-owned model id. */
  readonly model: string
  /** Model display name. */
  readonly name: string
  /** Optional model description. */
  readonly description?: string
  /** Selectable reasoning efforts in the adapter's order. */
  readonly efforts: readonly { readonly id: string; readonly name: string }[]
  /** The adapter's default effort, when it advertises one. */
  readonly defaultEffort?: string
}

/** Providers whose catalog could not be read, kept visible instead of silently omitted. */
export interface TuiModelCatalogFailure {
  /** Provider route id. */
  readonly provider: string
  /** Provider display name. */
  readonly providerName: string
  /** The diagnostic message. */
  readonly message: string
}

/** One loaded model catalog. */
export interface TuiModelCatalog {
  /** Selectable models. */
  readonly rows: readonly TuiModelRow[]
  /** Providers that failed to enumerate. */
  readonly failures: readonly TuiModelCatalogFailure[]
}

/**
 * Read the live provider and model catalog without failing the selector on one
 * unavailable provider.
 * @param ctx - host context carrying the LLM registry.
 * @returns successful rows and isolated provider failures.
 */
export async function loadTuiModelCatalog(ctx: Context): Promise<TuiModelCatalog> {
  const rows: TuiModelRow[] = []
  const failures: TuiModelCatalogFailure[] = []
  for (const provider of ctx.llm.listProviders()) {
    try {
      const models = await ctx.llm.listModels(provider.id)
      for (const model of models) {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        rows.push({
          provider: provider.id,
          providerName: provider.name,
          model: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          efforts: resolved.reasoning?.efforts.map(effort => ({ id: effort.id, name: effort.name })) ?? [],
          ...(resolved.reasoning?.defaultEffort === undefined ? {} : { defaultEffort: resolved.reasoning.defaultEffort }),
        })
      }
    } catch (error: unknown) {
      failures.push({
        provider: provider.id,
        providerName: provider.name,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { rows, failures }
}

/** The effort choice of one row: an adapter effort id, or the provider/default behavior. */
type EffortChoice = string | undefined

/**
 * List the reasoning-effort choices of one model in adapter order.
 * @param row - model row.
 * @returns the cycle, including the provider/default choice when the adapter advertises no default.
 */
export function effortChoices(row: TuiModelRow): readonly EffortChoice[] {
  const ids = row.efforts.map(effort => effort.id)
  return row.defaultEffort === undefined ? [undefined, ...ids] : ids
}

/**
 * Advance one model's effort choice.
 * @param row - model row.
 * @param current - the currently selected effort.
 * @returns the next choice in the cycle.
 */
export function nextEffort(row: TuiModelRow, current: EffortChoice): EffortChoice {
  const choices = effortChoices(row)
  /* v8 ignore next -- callers only cycle rows that advertise at least one effort */
  if (choices.length === 0) return current
  return choices[(choices.indexOf(current) + 1) % choices.length]
}

/** @param row - model row. @returns the initial effort choice. */
function initialEffort(row: TuiModelRow): EffortChoice {
  return row.defaultEffort
}

/**
 * The model selector overlay: filter text, model rows, and a per-row reasoning
 * effort cycle.
 */
export class ModelSelectorPanel implements Component {
  private readonly rows: readonly TuiModelRow[]
  private readonly failures: readonly TuiModelCatalogFailure[]
  private readonly palette: Palette
  private readonly onSelect: (selection: ModelSelection) => void
  private readonly onCancel: () => void
  private readonly filter: Input
  private readonly efforts = new Map<string, EffortChoice>()
  private index = 0

  /**
   * @param catalog - loaded model catalog.
   * @param palette - terminal style table.
   * @param onSelect - receives the selected route and effort.
   * @param onCancel - closes the selector without changes.
   */
  constructor(
    catalog: TuiModelCatalog,
    palette: Palette,
    onSelect: (selection: ModelSelection) => void,
    onCancel: () => void,
  ) {
    this.rows = catalog.rows
    this.failures = catalog.failures
    this.palette = palette
    this.filter = new Input({ placeholder: copy.model.filter, placeholderStyle: text => palette.dim(text) })
    this.onSelect = onSelect
    this.onCancel = onCancel
    this.filter.focused = true
    this.filter.onSubmit = () => { this.selectCurrent() }
    this.filter.onEscape = () => {
      if (this.filter.getValue() !== '') this.filter.setValue('')
      else this.onCancel()
    }
    for (const row of this.rows) this.efforts.set(this.key(row), initialEffort(row))
  }

  /** @param row - model row. @returns the stable effort-map key. */
  private key(row: TuiModelRow): string {
    return `${row.provider}\u0000${row.model}`
  }

  /** @returns the rows matching the current filter. */
  private visibleRows(): readonly TuiModelRow[] {
    const query = this.filter.getValue().trim().toLowerCase()
    if (query === '') return this.rows
    return this.rows.filter(row =>
      `${row.provider}/${row.model}`.toLowerCase().includes(query)
      || row.name.toLowerCase().includes(query)
      || (row.description?.toLowerCase().includes(query) ?? false))
  }

  /** Select the highlighted row. */
  private selectCurrent(): void {
    const row = this.visibleRows()[this.index]
    if (row === undefined) return
    const effort = this.efforts.get(this.key(row))
    this.onSelect({
      provider: row.provider,
      model: row.model,
      ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }),
    })
  }

  /**
   * Handle one input sequence while the selector has focus.
   * @param data - raw terminal input.
   */
  handleInput(data: string): void {
    const rows = this.visibleRows()
    if (matchesKey(data, 'up')) {
      if (rows.length > 0) this.index = (this.index + rows.length - 1) % rows.length
      return
    }
    if (matchesKey(data, 'down')) {
      if (rows.length > 0) this.index = (this.index + 1) % rows.length
      return
    }
    if (matchesKey(data, 'shift+tab')) {
      const row = rows[this.index]
      if (row !== undefined && row.efforts.length > 0) {
        this.efforts.set(this.key(row), nextEffort(row, this.efforts.get(this.key(row))))
      }
      return
    }
    if (matchesKey(data, 'enter')) {
      this.selectCurrent()
      return
    }
    if (matchesKey(data, 'escape')) {
      if (this.filter.getValue() !== '') this.filter.setValue('')
      else this.onCancel()
      return
    }
    this.filter.handleInput(data)
    const visible = this.visibleRows()
    if (this.index >= visible.length) this.index = Math.max(0, visible.length - 1)
  }

  /**
   * Render the selector.
   * @param width - available terminal columns.
   * @returns the selector lines.
   */
  render(width: number): string[] {
    const palette = this.palette
    const lines = [palette.heading(truncateToWidth(copy.model.title, width)), '']
    const filterLine = this.filter.render(Math.max(1, width - 2))
    /* v8 ignore next -- Input.render always returns its first line, so the fallback is unreachable */
    lines.push(`  ${truncateToWidth(filterLine[0] ?? '', Math.max(1, width - 2))}`, '')
    const rows = this.visibleRows()
    if (rows.length === 0) lines.push(palette.dim(truncateToWidth('  no matching models', width)))
    for (const [index, row] of rows.entries()) {
      const cursor = index === this.index
      const effort = this.efforts.get(this.key(row))
      const effortLabel = row.efforts.length === 0 ? '' : ` · ${effort === undefined ? 'default' : effort}`
      const label = `${cursor ? palette.accent('❯') : ' '} ${displayText(`${row.provider}/${row.model}`)} ${palette.dim(displayText(row.name))}${palette.dim(displayText(effortLabel))}`
      lines.push(truncateToWidth(`  ${label}`, width))
      if (row.description !== undefined && cursor) {
        lines.push(palette.dim(truncateToWidth(`      ${displayText(row.description)}`, width)))
      }
    }
    for (const failure of this.failures) {
      lines.push(palette.warning(truncateToWidth(`  ${displayText(failure.providerName)}: ${displayText(failure.message)}`, width)))
    }
    lines.push('', palette.dim(truncateToWidth(`  ${copy.model.hint}`, width)))
    return lines
  }

  /** No cached state exists, so nothing must be invalidated. */
  invalidate(): void {}
}

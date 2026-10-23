import { describe, expect, it } from 'vitest'
import { Input } from '@earendil-works/pi-tui'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import {
  ModelSelectorPanel, effortChoices, loadTuiModelCatalog, nextEffort,
  type TuiModelCatalog, type TuiModelRow,
} from '../../src/model-selector.ts'
import { createPalette } from '../../src/palette.ts'
import { copy } from '../../src/copy.ts'
import { freshContext, llmDouble } from './harness.ts'

const PALETTE = createPalette(false)

const ALPHA: TuiModelRow = {
  provider: 'alpha',
  providerName: 'Alpha',
  model: 'a-1',
  name: 'Alpha One',
  description: 'fast model',
  efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
  defaultEffort: 'low',
}

const BETA: TuiModelRow = {
  provider: 'beta',
  providerName: 'Beta',
  model: 'b-2',
  name: 'Beta Two',
  efforts: [],
}

/**
 * Build one selector panel.
 * @param catalog - rows and failures to present.
 * @returns the panel and its recorded outcomes.
 */
function selector(catalog: Partial<TuiModelCatalog> = {}): {
  panel: ModelSelectorPanel
  selected: { provider: string; model: string; reasoningEffort?: string }[]
  cancels: number[]
} {
  const selected: { provider: string; model: string; reasoningEffort?: string }[] = []
  const cancels: number[] = []
  const panel = new ModelSelectorPanel(
    { rows: catalog.rows ?? [ALPHA, BETA], failures: catalog.failures ?? [] },
    PALETTE,
    (selection) => { selected.push(selection) },
    () => { cancels.push(1) },
  )
  return { panel, selected, cancels }
}

/**
 * Type one printable string through the selector's filter.
 * @param panel - the selector.
 * @param text - characters to type.
 */
function typeText(panel: ModelSelectorPanel, text: string): void {
  for (const character of text) panel.handleInput(character)
}

/**
 * Render the selector as one plain text block.
 * @param panel - the selector.
 * @returns rendered text.
 */
function rendered(panel: ModelSelectorPanel): string {
  return panel.render(80).join('\n')
}

describe('loadTuiModelCatalog', () => {
  it('groups provider models with their advertised efforts', async () => {
    const resolved = new Map<string, LlmResolvedModelInfo>([
      ['a-1', {
        provider: 'alpha',
        id: 'a-1',
        name: 'Alpha One',
        reasoning: { efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }], defaultEffort: ReasoningEffortId('low') },
      }],
      ['a-2', { provider: 'alpha', id: 'a-2', name: 'Alpha Two', description: 'long context' }],
    ])
    const ctx = freshContext({
      llm: llmDouble({
        providers: [{ id: 'alpha', name: 'Alpha' }],
        listModels: async () => [
          { provider: 'alpha', id: 'a-1', name: 'Alpha One' },
          { provider: 'alpha', id: 'a-2', name: 'Alpha Two', description: 'long context' },
        ],
        resolveModelInfo: async (_provider, model) => {
          const info = resolved.get(model)
          if (info === undefined) throw new Error(`unexpected model ${model}`)
          return info
        },
      }),
    })

    await expect(loadTuiModelCatalog(ctx)).resolves.toEqual({
      rows: [
        {
          provider: 'alpha',
          providerName: 'Alpha',
          model: 'a-1',
          name: 'Alpha One',
          efforts: [{ id: 'low', name: 'Low' }],
          defaultEffort: 'low',
        },
        {
          provider: 'alpha',
          providerName: 'Alpha',
          model: 'a-2',
          name: 'Alpha Two',
          description: 'long context',
          efforts: [],
        },
      ],
      failures: [],
    })
  })

  it('keeps one failed provider visible without losing the others', async () => {
    const model = (provider: string, id: string): LlmModelInfo => ({ provider, id, name: id })
    const ctx = freshContext({
      llm: llmDouble({
        providers: [{ id: 'alpha', name: 'Alpha' }, { id: 'broken', name: 'Broken' }, { id: 'throwing', name: 'Throwing' }],
        listModels: async (provider) => {
          if (provider === 'broken') throw new Error('provider offline')
          if (provider === 'throwing') throw 'no adapter'
          return [model(provider, 'm-1')]
        },
        resolveModelInfo: async (provider, id) => ({ provider, id, name: id }),
      }),
    })

    const catalog = await loadTuiModelCatalog(ctx)

    expect(catalog.rows.map(row => row.model)).toEqual(['m-1'])
    expect(catalog.failures).toEqual([
      { provider: 'broken', providerName: 'Broken', message: 'provider offline' },
      { provider: 'throwing', providerName: 'Throwing', message: 'no adapter' },
    ])
  })
})

describe('ModelSelectorPanel rendering', () => {
  it('renders the filter, selectable rows, and the effort label', () => {
    const { panel } = selector()

    const text = rendered(panel)

    expect(text).toContain(copy.model.title)
    expect(text).toContain('❯ alpha/a-1 Alpha One · low')
    expect(text).toContain('  beta/b-2 Beta Two')
    expect(text).toContain(copy.model.hint)
    expect(text).toContain('fast model')
  })

  it('renders the effort after it is cycled', () => {
    const { panel } = selector()

    panel.handleInput('\x1b[Z')

    expect(rendered(panel)).toContain('❯ alpha/a-1 Alpha One · high')
    expect(rendered(panel)).not.toContain('Alpha One · low')
  })

  it('renders provider failures below the rows', () => {
    const { panel } = selector({ failures: [{ provider: 'gamma', providerName: 'Gamma', message: 'unreachable' }] })

    expect(rendered(panel)).toContain('Gamma: unreachable')
  })

  it('reports no matching models for a filter with no hits', () => {
    const { panel } = selector()

    typeText(panel, 'zzz')

    expect(rendered(panel)).toContain('no matching models')
  })

  it('invalidates without cached state', () => {
    const { panel } = selector()
    expect(() => { panel.invalidate() }).not.toThrow()
  })
})

describe('ModelSelectorPanel navigation', () => {
  it('moves and wraps through arrow keys and vim keys', () => {
    const { panel, selected } = selector()

    panel.handleInput('\x1b[B')
    panel.handleInput('\r')
    expect(selected).toEqual([{ provider: 'beta', model: 'b-2' }])

    panel.handleInput('\x1b[A')
    panel.handleInput('\r')
    expect(selected.at(-1)).toEqual({ provider: 'alpha', model: 'a-1', reasoningEffort: 'low' })
  })

  it('keeps the highlight when the filtered list is empty', () => {
    const { panel, selected } = selector()

    typeText(panel, 'zzz')
    panel.handleInput('\x1b[A')
    panel.handleInput('\x1b[B')
    expect(selected).toEqual([])
    expect(rendered(panel)).toContain('no matching models')
  })
})

describe('ModelSelectorPanel effort cycling', () => {
  it('cycles through the adapter efforts without a default', () => {
    const row: TuiModelRow = {
      provider: 'gamma',
      providerName: 'Gamma',
      model: 'g-1',
      name: 'Gamma One',
      efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }],
    }
    const { panel, selected } = selector({ rows: [row] })

    expect(rendered(panel)).toContain('Gamma One · default')
    panel.handleInput('\x1b[Z')
    expect(rendered(panel)).toContain('Gamma One · low')
    panel.handleInput('\x1b[Z')
    panel.handleInput('\r')
    expect(selected).toEqual([{ provider: 'gamma', model: 'g-1', reasoningEffort: 'medium' }])
  })

  it('ignores effort cycling without selectable efforts', () => {
    const { panel, selected } = selector({ rows: [BETA] })

    panel.handleInput('\x1b[Z')
    panel.handleInput('\r')

    expect(selected).toEqual([{ provider: 'beta', model: 'b-2' }])
  })

  it('ignores effort cycling when no row is visible', () => {
    const { panel, selected } = selector({ rows: [] })

    panel.handleInput('\x1b[Z')
    panel.handleInput('\r')

    expect(selected).toEqual([])
  })
})

describe('ModelSelectorPanel filtering', () => {
  it('matches provider, name, and description text', () => {
    const { panel } = selector()

    typeText(panel, 'beta')
    expect(rendered(panel)).not.toContain('alpha/a-1')
    expect(rendered(panel)).toContain('beta/b-2')

    panel.handleInput('\x1b')
    typeText(panel, 'two')
    expect(rendered(panel)).not.toContain('alpha/a-1')
    expect(rendered(panel)).toContain('beta/b-2')

    panel.handleInput('\x1b')
    typeText(panel, 'fast')
    expect(rendered(panel)).toContain('alpha/a-1')
    expect(rendered(panel)).not.toContain('beta/b-2')
  })

  it('clamps the highlight into the filtered rows', () => {
    const { panel, selected } = selector()

    panel.handleInput('\x1b[B')
    typeText(panel, 'alpha')
    panel.handleInput('\r')

    expect(selected).toEqual([{ provider: 'alpha', model: 'a-1', reasoningEffort: 'low' }])
  })

  it('clears the filter on the first escape and cancels on the second', () => {
    const { panel, cancels } = selector()

    typeText(panel, 'beta')
    panel.handleInput('\x1b')
    expect(cancels).toEqual([])
    expect(rendered(panel)).toContain('alpha/a-1')

    panel.handleInput('\x1b')
    expect(cancels).toEqual([1])
  })

  it('drives the same selection and cancellation from the filter callbacks', () => {
    const { panel, selected, cancels } = selector()
    const filter = Reflect.get(panel, 'filter') as Input

    filter.onSubmit?.('')
    expect(selected).toEqual([{ provider: 'alpha', model: 'a-1', reasoningEffort: 'low' }])

    filter.setValue('beta')
    filter.onEscape?.()
    expect(filter.getValue()).toBe('')
    expect(cancels).toEqual([])

    filter.onEscape?.()
    expect(cancels).toEqual([1])
  })

  it('selects nothing from an empty catalog', () => {
    const { panel, selected, cancels } = selector({ rows: [] })

    panel.handleInput('\r')

    expect(selected).toEqual([])
    expect(cancels).toEqual([])
  })

  it('brands the selected effort', () => {
    const { panel, selected } = selector()
    const branded = ReasoningEffortId('high')

    panel.handleInput('\x1b[Z')
    panel.handleInput('\r')

    expect(selected[0]?.reasoningEffort).toBe(branded)
  })
})


describe('effortChoices', () => {
  it('lists only the adapter efforts when a default exists', () => {
    expect(effortChoices(ALPHA)).toEqual(['low', 'high'])
  })

  it('offers the provider default first when no adapter default exists', () => {
    const row: TuiModelRow = {
      provider: 'gamma',
      providerName: 'Gamma',
      model: 'g-1',
      name: 'Gamma One',
      efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }],
    }

    expect(effortChoices(row)).toEqual([undefined, 'low', 'medium'])
  })

  it('lists the provider default alone for a model without efforts', () => {
    expect(effortChoices(BETA)).toEqual([undefined])
  })
})

describe('nextEffort', () => {
  it('advances through the adapter efforts and wraps around', () => {
    expect(nextEffort(ALPHA, 'low')).toBe('high')
    expect(nextEffort(ALPHA, 'high')).toBe('low')
  })

  it('starts at the first effort when no effort is selected', () => {
    const row: TuiModelRow = {
      provider: 'gamma',
      providerName: 'Gamma',
      model: 'g-1',
      name: 'Gamma One',
      efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }],
    }

    expect(nextEffort(row, undefined)).toBe('low')
    expect(nextEffort(row, 'medium')).toBe(undefined)
  })

  it('returns the provider default after the last adapter effort', () => {
    expect(nextEffort(ALPHA, 'high')).toBe('low')
  })

  it('restarts from the first choice for an unknown current effort', () => {
    expect(nextEffort(ALPHA, 'extreme')).toBe('low')
  })

  it('keeps the current choice when the model exposes no effort', () => {
    expect(nextEffort(BETA, undefined)).toBe(undefined)
  })
})

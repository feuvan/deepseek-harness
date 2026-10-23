import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from '@earendil-works/pi-tui'
import { CompletionController, type CompletionDeps } from '../../src/completion.ts'
import { PromptEditor } from '../../src/components/editor.ts'
import { copy } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'
import { createSelectListTheme } from '../../src/markdown.ts'
import { testTerminal } from '../support/terminal.ts'
import type { TerminalSession } from '../../src/terminal.ts'

/** Terminals opened by the suite, stopped after each test. */
const sessions: TerminalSession[] = []

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const session of sessions.splice(0)) session.stop()
})

/** @returns a composer over a fresh headless terminal. */
function editorHarness(): PromptEditor {
  const { session } = testTerminal({ columns: 100, rows: 20 })
  sessions.push(session)
  const palette = createPalette(false)
  return new PromptEditor(
    session.tui,
    { borderColor: text => palette.border(text), selectList: createSelectListTheme(palette) },
    { prompt: 'dsh> ', hint: 'Type a message.' },
  )
}

/** The suggestion list one provider double answers with. */
interface ProviderState {
  suggestions: AutocompleteSuggestions | null
  error?: unknown
  readonly calls: { lines: string[]; line: number; col: number; force: boolean | undefined }[]
}

/**
 * Build one provider double.
 * @param state - the mutable answer state.
 * @returns the provider.
 */
function providerDouble(state: ProviderState): AutocompleteProvider {
  return {
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      state.calls.push({ lines: [...lines], line: cursorLine, col: cursorCol, force: options.force })
      if (state.error !== undefined) throw state.error
      return state.suggestions
    },
    applyCompletion(_lines, _cursorLine, _cursorCol, item) {
      return { lines: [`dsh> ${item.value}`], cursorLine: 0, cursorCol: 5 + item.value.length }
    },
  }
}

/** The items a suggestion answer carries. */
function items(count: number): AutocompleteItem[] {
  return Array.from({ length: count }, (_, index) => ({
    value: `value${String(index)}`,
    label: `Label ${String(index)}`,
    ...(index % 2 === 0 ? { description: `description ${String(index)}` } : {}),
  }))
}

/** One controller harness with mutable editor and provider readers. */
interface ControllerHarness {
  readonly controller: CompletionController
  readonly editor: PromptEditor
  readonly requestRender: ReturnType<typeof vi.fn>
  readonly state: ProviderState
  readonly provider: AutocompleteProvider
  readonly setProvider: (next: AutocompleteProvider | undefined) => void
  readonly setEditor: (next: PromptEditor | undefined) => void
  readonly submit: ReturnType<typeof vi.fn>
}

/**
 * Build one completion controller over a real editor.
 * @param state - provider answer state.
 * @returns the harness.
 */
function completionHarness(state: ProviderState = { suggestions: { items: items(2), prefix: '@' }, calls: [] }): ControllerHarness {
  const editor = editorHarness()
  editor.setText('@sr')
  const provider = providerDouble(state)
  const requestRender = vi.fn()
  const submit = vi.fn()
  let currentProvider: AutocompleteProvider | undefined = provider
  let currentEditor: PromptEditor | undefined = editor
  const deps: CompletionDeps = {
    provider: () => currentProvider,
    editor: () => currentEditor,
    palette: createPalette(false),
    requestRender,
    submit,
  }
  return {
    controller: new CompletionController(deps),
    editor,
    requestRender,
    state,
    provider,
    setProvider: (next) => { currentProvider = next },
    setEditor: (next) => { currentEditor = next },
    submit,
  }
}

/**
 * Render one controller to visible text lines.
 * @param controller - the controller under test.
 * @param width - available columns.
 * @returns plain rendered lines.
 */
function rendered(controller: CompletionController, width = 100): string[] {
  return controller.render(width).map(line => line.replace(/\u001b\[[0-9;]*m/gu, ''))
}

describe('CompletionController scheduling', () => {
  it('debounces a scheduled refresh by 40ms', async () => {
    vi.useFakeTimers()
    const harness = completionHarness()

    harness.controller.schedule()
    await vi.advanceTimersByTimeAsync(39)
    expect(harness.state.calls).toEqual([])
    expect(harness.controller.active).toBe(false)

    await vi.advanceTimersByTimeAsync(2)
    expect(harness.state.calls).toHaveLength(1)
    expect(harness.state.calls[0]).toMatchObject({ line: 0, col: 3, force: false })
    expect(harness.controller.active).toBe(true)
  })

  it('restarts the debounce when keys arrive quickly', async () => {
    vi.useFakeTimers()
    const harness = completionHarness()

    harness.controller.schedule()
    await vi.advanceTimersByTimeAsync(20)
    harness.controller.schedule()
    await vi.advanceTimersByTimeAsync(20)
    expect(harness.state.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(21)
    expect(harness.state.calls).toHaveLength(1)
  })

  it('passes the force flag through a refresh', async () => {
    const harness = completionHarness()

    await harness.controller.refresh(true)

    expect(harness.state.calls[0]?.force).toBe(true)
  })

  it('ignores a refresh without an editor or provider', async () => {
    const harness = completionHarness()
    harness.setEditor(undefined)
    await harness.controller.refresh(false)
    expect(harness.state.calls).toEqual([])

    harness.setEditor(harness.editor)
    harness.setProvider(undefined)
    await harness.controller.refresh(false)
    expect(harness.state.calls).toEqual([])
    expect(harness.controller.active).toBe(false)
  })

  it('closes when the provider answers with no suggestion', async () => {
    const harness = completionHarness({ suggestions: { items: items(2), prefix: '@' }, calls: [] })
    await harness.controller.refresh(false)
    expect(harness.controller.active).toBe(true)

    harness.state.suggestions = null
    await harness.controller.refresh(false)
    expect(harness.controller.active).toBe(false)
    expect(harness.controller.render(80)).toEqual([])

    harness.state.suggestions = { items: [], prefix: '@' }
    await harness.controller.refresh(false)
    expect(harness.controller.active).toBe(false)
  })

  it('closes when the provider fails', async () => {
    const harness = completionHarness({ suggestions: null, error: new Error('provider offline'), calls: [] })

    await harness.controller.refresh(false)

    expect(harness.controller.active).toBe(false)
    expect(harness.controller.render(80)).toEqual([])
  })

  it('ignores a stale answer that resolves after a newer request', async () => {
    const harness = completionHarness()
    const first: ((value: AutocompleteSuggestions) => void)[] = []
    let call = 0
    const provider: AutocompleteProvider = {
      getSuggestions: () => new Promise<AutocompleteSuggestions>((resolve) => {
        call += 1
        const index = call
        first.push((value) => { resolve(index === 1 ? { items: items(1), prefix: '@stale' } : value) })
      }),
      applyCompletion: () => ({ lines: ['x'], cursorLine: 0, cursorCol: 0 }),
    }
    harness.setProvider(provider)

    const stale = harness.controller.refresh(false)
    const fresh = harness.controller.refresh(false)
    first[1]?.({ items: [{ value: '@fresh', label: 'Fresh' }], prefix: '@' })
    await fresh
    first[0]?.({ items: [{ value: '@stale', label: 'Stale' }], prefix: '@' })
    await stale

    expect(rendered(harness.controller).join('\n')).toContain('Fresh')
    expect(rendered(harness.controller).join('\n')).not.toContain('Label 0')
  })

  it('drops a pending answer when the dock closes', async () => {
    const harness = completionHarness()
    let resolve!: (value: AutocompleteSuggestions) => void
    harness.setProvider({
      getSuggestions: () => new Promise<AutocompleteSuggestions>((answer) => { resolve = answer }),
      applyCompletion: () => ({ lines: ['x'], cursorLine: 0, cursorCol: 0 }),
    })
    const pending = harness.controller.refresh(false)

    harness.controller.close()
    resolve({ items: items(2), prefix: '@' })
    await pending

    expect(harness.controller.active).toBe(false)
    expect(harness.controller.render(80)).toEqual([])
  })

  it('cancels a pending debounce when closed', async () => {
    vi.useFakeTimers()
    const harness = completionHarness()

    harness.controller.schedule()
    harness.controller.close()
    await vi.advanceTimersByTimeAsync(60)

    expect(harness.state.calls).toEqual([])
  })
})

describe('CompletionController rendering', () => {
  it('renders the title, selected row, descriptions, and hint', async () => {
    const harness = completionHarness()
    await harness.controller.refresh(false)

    const lines = rendered(harness.controller)

    expect(lines[0]).toBe(copy.completion.title)
    expect(lines[1]).toBe(' ❯ Label 0  description 0')
    expect(lines[2]).toBe('   Label 1')
    expect(lines.at(-1)).toBe(` ${copy.completion.hint}`)
  })

  it('renders at most eight rows with scroll indicators', async () => {
    const harness = completionHarness({ suggestions: { items: items(12), prefix: '@' }, calls: [] })
    await harness.controller.refresh(false)

    const lines = rendered(harness.controller)

    expect(lines.filter(line => line.includes('Label '))).toHaveLength(8)
    expect(lines).toContain(`  ↓ ${copy.moreRows(4)}`)

    for (let step = 0; step < 6; step += 1) harness.controller.handleInput('\u001b[B')

    const scrolled = rendered(harness.controller)
    expect(scrolled).toContain(`  ↑ ${copy.moreRows(2)}`)
    expect(scrolled.join('\n')).toContain('❯ Label 6')
  })

  it('styles the selected row through the palette', async () => {
    const harness = completionHarness({ suggestions: { items: items(2), prefix: '@' }, calls: [] })
    const colored = new CompletionController({
      provider: () => harness.provider,
      editor: () => harness.editor,
      palette: createPalette(true),
      requestRender: vi.fn(),
    })
    await colored.refresh(false)

    const lines = colored.render(100)
    expect(lines[1]).toContain('\u001b[36m❯\u001b[39m')
    expect(lines[1]).toContain('\u001b[7mLabel 0\u001b[27m')
  })

  it('has no cached renderer state to invalidate', async () => {
    const harness = completionHarness()
    await harness.controller.refresh(false)

    expect(() => { harness.controller.invalidate() }).not.toThrow()
    expect(harness.controller.render(100).length).toBeGreaterThan(0)
  })
})

describe('CompletionController input', () => {
  it('ignores input while the dock is closed', () => {
    const harness = completionHarness()

    expect(harness.controller.handleInput('\r')).toBe(false)
    expect(harness.controller.handleInput('\u001b[B')).toBe(false)
  })

  it('wraps the highlight with the arrow keys and pages by eight', async () => {
    const harness = completionHarness({ suggestions: { items: items(12), prefix: '@' }, calls: [] })
    await harness.controller.refresh(false)

    harness.controller.handleInput('\u001b[A')
    expect(rendered(harness.controller).join('\n')).toContain('❯ Label 11')
    harness.controller.handleInput('\u001b[B')
    expect(rendered(harness.controller).join('\n')).toContain('❯ Label 0')
    harness.controller.handleInput('\u001b[6~')
    expect(rendered(harness.controller).join('\n')).toContain('❯ Label 8')
    harness.controller.handleInput('\u001b[5~')
    expect(rendered(harness.controller).join('\n')).toContain('❯ Label 0')
    harness.controller.handleInput('\u001b[5~')
    expect(rendered(harness.controller).join('\n')).toContain('❯ Label 0')
  })

  it('closes on Escape', async () => {
    const harness = completionHarness()
    await harness.controller.refresh(false)

    expect(harness.controller.handleInput('\u001b')).toBe(true)

    expect(harness.controller.active).toBe(false)
    expect(harness.requestRender).toHaveBeenCalled()
  })

  it.each(['\t', '\r'])('applies the highlighted item on %j and closes', async (key) => {
    const harness = completionHarness()
    await harness.controller.refresh(false)
    harness.editor.setText('@sr')

    expect(harness.controller.handleInput(key)).toBe(true)

    expect(harness.editor.getText()).toBe('dsh> value0')
    expect(harness.controller.active).toBe(false)
  })

  it('submits an accepted command completion at the command position', async () => {
    const harness = completionHarness()
    harness.editor.setText('/rea')
    harness.setProvider({
      async getSuggestions() { return { items: [{ value: 'reasoning', label: 'reasoning' }], prefix: '' } },
      applyCompletion() { return { lines: ['/reasoning '], cursorLine: 0, cursorCol: '/reasoning '.length } },
    })
    await harness.controller.refresh(false)
    expect(harness.controller.active).toBe(true)

    expect(harness.controller.handleInput('\r')).toBe(true)

    expect(harness.submit).toHaveBeenCalledWith('/reasoning')
    expect(harness.controller.active).toBe(false)
  })

  it('closes without applying when the highlighted item is missing', async () => {
    const harness = completionHarness()
    await harness.controller.refresh(false)
    Reflect.set(harness.controller, 'items', [])

    expect(harness.controller.handleInput('\r')).toBe(true)
    expect(harness.controller.active).toBe(false)
    expect(harness.editor.getText()).toBe('@sr')
  })

  it('closes without applying when the editor disappears', async () => {
    const harness = completionHarness()
    await harness.controller.refresh(false)
    harness.setEditor(undefined)

    expect(harness.controller.handleInput('\r')).toBe(true)
    expect(harness.controller.active).toBe(false)
  })

  it('closes without applying when the provider disappears', async () => {
    const harness = completionHarness()
    await harness.controller.refresh(false)
    harness.setProvider(undefined)

    expect(harness.controller.handleInput('\r')).toBe(true)
    expect(harness.controller.active).toBe(false)
  })

  it('ignores keys that do not belong to the dock', async () => {
    const harness = completionHarness()
    await harness.controller.refresh(false)

    expect(harness.controller.handleInput('a')).toBe(false)
    expect(harness.controller.active).toBe(true)
  })
})

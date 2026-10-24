import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutocompleteItem } from '@earendil-works/pi-tui'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference'
import { TerminalAutocompleteProvider, type TerminalAutocompleteDeps } from '../../src/autocomplete.ts'
import { copy } from '../../src/copy.ts'
import { mountSessions, testAgent, testContext } from '../support/fakes.ts'

const CWD = '/nonexistent-terminal-base'

/** One file-reference listing implementation. */
type ReferenceList = (agent: Agent, query: string, signal: AbortSignal) => Promise<FileReferenceCandidate[]>

/** One file-reference service call. */
interface ListCall {
  readonly agent: Agent
  readonly query: string
  readonly signal: AbortSignal
}

/** The provider under test with its recorded inputs. */
interface AutocompleteHarness {
  readonly provider: TerminalAutocompleteProvider
  readonly calls: ListCall[]
  readonly commands: () => readonly { name: string; description?: string }[]
  readonly agent: () => Agent | undefined
  readonly setAgent: (agent: Agent | undefined) => void
  readonly setReferences: (references: { list: ReferenceList } | undefined) => void
}

/**
 * Build one provider over a real Session and a fake file-reference service.
 * @param options - candidates, whether the service is mounted, and Agent presence.
 * @returns the provider and its mutable doubles.
 */
async function autocompleteHarness(options: {
  readonly candidates?: readonly FileReferenceCandidate[]
  readonly list?: ReferenceList | undefined
  readonly withoutReferences?: boolean
  readonly withoutAgent?: boolean
} = {}): Promise<AutocompleteHarness> {
  const ctx = testContext()
  ctx.provide('commands', { list: () => [], execute: async () => undefined })
  await mountSessions(ctx)
  const session = ctx.sessions.create(SessionId('autocomplete-session'))
  const presented = testAgent({ session })
  const calls: ListCall[] = []
  const commands: { name: string; description?: string }[] = [
    { name: 'help', description: 'Show help' },
    { name: 'model', description: 'Select the model' },
  ]
  let references = options.withoutReferences === true
    ? undefined
    : {
      list: async (agent: Agent, query: string, signal: AbortSignal): Promise<FileReferenceCandidate[]> => {
        calls.push({ agent, query, signal })
        if (options.list !== undefined) return options.list(agent, query, signal)
        return [...(options.candidates ?? [])]
      },
    }
  let agent: Agent | undefined = options.withoutAgent === true ? undefined : presented.agent
  if (references !== undefined) ctx.provide('fileReferences', references)
  const deps: TerminalAutocompleteDeps = {
    ctx,
    agent: () => agent,
    cwd: () => CWD,
    commands: () => commands,
  }
  return {
    provider: new TerminalAutocompleteProvider(deps),
    calls,
    commands: () => commands,
    agent: () => agent,
    setAgent: (next) => { agent = next },
    setReferences: (next) => {
      references = next
      if (next !== undefined) ctx.provide('fileReferences', next)
    },
  }
}

/**
 * Run one suggestion request with a fresh signal.
 * @param provider - the provider.
 * @param lines - editor lines.
 * @param cursorCol - cursor column.
 * @param options - forced-open state.
 * @returns the suggestions and the signal used.
 */
async function suggest(
  provider: TerminalAutocompleteProvider,
  lines: string[],
  cursorLine: number,
  cursorCol: number,
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<{ suggestions: Awaited<ReturnType<TerminalAutocompleteProvider['getSuggestions']>>; signal: AbortSignal }> {
  const signal = options.signal ?? new AbortController().signal
  const suggestions = await provider.getSuggestions(lines, cursorLine, cursorCol, {
    signal,
    ...(options.force === undefined ? {} : { force: options.force }),
  })
  return { suggestions, signal }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TerminalAutocompleteProvider.getSuggestions delegation', () => {
  it('does not open path completion after a space in prose', async () => {
    const harness = await autocompleteHarness()

    expect((await suggest(harness.provider, ['有什么好的 doc lint 或者 '], 0, 13)).suggestions).toBeNull()
    expect((await suggest(harness.provider, ['look at src/fi'], 0, 14)).suggestions).toBeNull()
    expect(harness.calls).toEqual([])
  })

  it('completes slash commands through the shared editor provider', async () => {
    const harness = await autocompleteHarness()

    const { suggestions } = await suggest(harness.provider, ['/he'], 0, 3)

    expect(suggestions).toEqual({
      items: [{ value: 'help', label: 'help', description: 'Show help' }],
      prefix: '/he',
    })
  })

  it('delegates a slash command with leading spaces and arguments', async () => {
    const harness = await autocompleteHarness()

    expect((await suggest(harness.provider, ['  /he'], 0, 5)).suggestions?.prefix).toBe('/he')
    expect((await suggest(harness.provider, ['/help detail'], 0, 12)).suggestions).toBeNull()
  })

  it('delegates a line without an @ token', async () => {
    const harness = await autocompleteHarness()

    expect((await suggest(harness.provider, ['plain text'], 0, 10)).suggestions).toBeNull()
  })

  it('delegates an out-of-range cursor line', async () => {
    const harness = await autocompleteHarness()

    expect((await suggest(harness.provider, [], 4, 0)).suggestions).toBeNull()
  })

  it('delegates when the file-reference service is absent', async () => {
    const harness = await autocompleteHarness({ withoutReferences: true })

    expect((await suggest(harness.provider, ['@photo'], 0, 6)).suggestions).toBeNull()
    expect(harness.calls).toEqual([])
  })

  it('delegates when the Agent is absent', async () => {
    const harness = await autocompleteHarness({ withoutAgent: true })

    expect((await suggest(harness.provider, ['@photo'], 0, 6)).suggestions).toBeNull()
    expect(harness.calls).toEqual([])
  })
})

describe('TerminalAutocompleteProvider.getSuggestions mentions', () => {
  it('lists workspace candidates as mentions', async () => {
    const harness = await autocompleteHarness({
      candidates: [
        { path: 'src/index.ts', kind: 'file' },
        { path: 'src/components', kind: 'directory' },
      ],
    })

    const { suggestions } = await suggest(harness.provider, ['@src'], 0, 4)

    expect(suggestions).toEqual({
      items: [
        { value: '@src/index.ts', label: 'src/index.ts', description: copy.autocomplete.file },
        { value: '@src/components/', label: 'src/components', description: copy.autocomplete.directory },
      ],
      prefix: '@src',
    })
    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.query).toBe('src')
  })

  it('passes the Agent and the cancellation signal to the service', async () => {
    const harness = await autocompleteHarness({ candidates: [] })
    const controller = new AbortController()

    await suggest(harness.provider, ['say @file'], 0, 9, { signal: controller.signal })

    expect(harness.calls[0]?.agent).toBe(harness.agent())
    expect(harness.calls[0]?.signal).toBe(controller.signal)
    expect(harness.calls[0]?.query).toBe('file')
  })

  it('keeps a quoted prefix open while completing a directory', async () => {
    const harness = await autocompleteHarness({
      candidates: [{ path: 'my docs', kind: 'directory' }],
    })

    const { suggestions } = await suggest(harness.provider, ['open @"my d'], 0, 11)

    expect(suggestions).toEqual({
      items: [{ value: '@"my docs/', label: 'my docs', description: copy.autocomplete.directory }],
      prefix: '@"my d',
    })
    expect(harness.calls[0]?.query).toBe('my d')
  })

  it('closes the quote of a quoted file mention', async () => {
    const harness = await autocompleteHarness({
      candidates: [{ path: 'my photo.png', kind: 'file' }],
    })

    const { suggestions } = await suggest(harness.provider, ['open @"my p'], 0, 11)

    expect(suggestions?.items[0]?.value).toBe('@"my photo.png"')
  })

  it('returns an empty item list when the workspace has no candidate', async () => {
    const harness = await autocompleteHarness({ candidates: [] })

    const { suggestions } = await suggest(harness.provider, ['@zzz'], 0, 4)

    expect(suggestions).toEqual({ items: [], prefix: '@zzz' })
  })

  it('does not consult the workspace inside a slash command line', async () => {
    const harness = await autocompleteHarness({
      candidates: [{ path: 'src', kind: 'directory' }],
    })

    await suggest(harness.provider, ['/model @src'], 0, 11)

    expect(harness.calls).toEqual([])
  })

  it('closes the list when the service throws', async () => {
    const harness = await autocompleteHarness({
      list: async () => { throw new Error('index offline') },
    })

    const { suggestions } = await suggest(harness.provider, ['@src'], 0, 4)

    expect(suggestions).toBeNull()
  })

  it('propagates a service failure when the request was aborted', async () => {
    const harness = await autocompleteHarness({
      list: async () => { throw new Error('index offline') },
    })
    const controller = new AbortController()
    controller.abort()

    await expect(suggest(harness.provider, ['@src'], 0, 4, { signal: controller.signal }).then(result => result.suggestions))
      .rejects.toThrow('index offline')
  })
})

describe('TerminalAutocompleteProvider.applyCompletion', () => {
  const mentionItem: AutocompleteItem = { value: '@photo.png', label: 'photo.png' }

  it('replaces an @ token with the accepted mention', async () => {
    const harness = await autocompleteHarness()

    const result = harness.provider.applyCompletion(['see @ph now'], 0, 7, mentionItem, '@ph')

    expect(result).toEqual({ lines: ['see @photo.png now'], cursorLine: 0, cursorCol: 14 })
  })

  it('replaces a quoted @ token with the accepted mention', async () => {
    const harness = await autocompleteHarness()

    const result = harness.provider.applyCompletion(['open @"my p'], 0, 11, { value: '@"my photo.png"', label: 'my photo.png' }, '@"my p')

    expect(result).toEqual({ lines: ['open @"my photo.png"'], cursorLine: 0, cursorCol: 20 })
  })

  it('keeps the untouched editor lines', async () => {
    const harness = await autocompleteHarness()

    const result = harness.provider.applyCompletion(['first line', '@ph'], 1, 3, mentionItem, '@ph')

    expect(result).toEqual({ lines: ['first line', '@photo.png'], cursorLine: 1, cursorCol: 10 })
  })

  it('tolerates a cursor line outside the editor content', async () => {
    const harness = await autocompleteHarness()

    const result = harness.provider.applyCompletion([], 0, 1, mentionItem, '@')

    expect(result).toEqual({ lines: [], cursorLine: 0, cursorCol: 10 })
  })

  it('delegates a slash-command completion', async () => {
    const harness = await autocompleteHarness()

    const result = harness.provider.applyCompletion(['/he'], 0, 3, { value: 'help', label: 'help' }, '/he')

    expect(result).toEqual({ lines: ['/help '], cursorLine: 0, cursorCol: 6 })
  })

  it('delegates a path completion', async () => {
    const harness = await autocompleteHarness()

    const result = harness.provider.applyCompletion(['src/fi'], 0, 6, { value: 'src/file.ts', label: 'file.ts' }, 'src/fi')

    expect(result).toEqual({ lines: ['src/file.ts'], cursorLine: 0, cursorCol: 11 })
  })
})

describe('TerminalAutocompleteProvider.shouldTriggerFileCompletion', () => {
  it('never requests bare file completion', async () => {
    const harness = await autocompleteHarness()

    expect(harness.provider.shouldTriggerFileCompletion(['hello'], 0, 5)).toBe(false)
    expect(harness.provider.shouldTriggerFileCompletion(['src/fi'], 0, 6)).toBe(false)
    expect(harness.provider.shouldTriggerFileCompletion(['/he'], 0, 3)).toBe(false)
  })
})

describe('TerminalAutocompleteProvider construction', () => {
  it('exposes @ as its natural trigger character', async () => {
    const harness = await autocompleteHarness()

    expect(harness.provider.triggerCharacters).toEqual(['@'])
  })

  it('reads the command catalog and workspace when constructed', async () => {
    const harness = await autocompleteHarness()

    expect(harness.commands()).toHaveLength(2)
  })
})

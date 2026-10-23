/**
 * Composer completion: `/` command and argument suggestions from the shared
 * editor library, and `@` workspace mentions from the composed file-reference
 * provider.
 *
 * @module @deepseek-ai/dsh-tui/autocomplete
 */

import {
  CombinedAutocompleteProvider,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  type SlashCommand,
} from '@earendil-works/pi-tui'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { activeAtToken, formatFileMention } from '@deepseek-ai/dsh-file-reference'
import { copy } from './copy.ts'

/** Values the provider reads from the application while the user types. */
export interface TerminalAutocompleteDeps {
  /** Host context carrying the optional file-reference provider. */
  readonly ctx: Context
  /** @returns the presented Agent, or undefined before it exists. */
  readonly agent: () => Agent | undefined
  /** @returns the workspace root relative mentions resolve from. */
  readonly cwd: () => string
  /** @returns the current slash-command catalog. */
  readonly commands: () => readonly SlashCommand[]
}

/**
 * The editor's completion provider: command and path completion delegate to the
 * shared editor provider, and an active `@` token is completed from the
 * host-owned workspace file index so the terminal offers the same candidates as
 * the Web composer.
 */
export class TerminalAutocompleteProvider implements AutocompleteProvider {
  readonly triggerCharacters = ['@']
  private readonly deps: TerminalAutocompleteDeps
  private readonly delegate: CombinedAutocompleteProvider

  /** @param deps - application readers for the Agent, workspace, and commands. */
  constructor(deps: TerminalAutocompleteDeps) {
    this.deps = deps
    this.delegate = new CombinedAutocompleteProvider([...deps.commands()], deps.cwd(), null)
  }

  /**
   * Suggest completions for the cursor position.
   * @param lines - editor content lines.
   * @param cursorLine - cursor line index.
   * @param cursorCol - cursor column within that line.
   * @param options - cancellation and forced-open state.
   * @returns the suggestions, or null when nothing applies.
   */
  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const line = lines[cursorLine] ?? ''
    // Slash commands own their arguments; an `@` inside a command line is not a
    // workspace mention.
    if (line.trimStart().startsWith('/')) return this.delegate.getSuggestions(lines, cursorLine, cursorCol, options)
    const token = activeAtToken(line, cursorCol)
    if (token === undefined) return this.delegate.getSuggestions(lines, cursorLine, cursorCol, options)
    const agent = this.deps.agent()
    const references = this.deps.ctx.get('fileReferences')
    if (agent === undefined || references === undefined) {
      return this.delegate.getSuggestions(lines, cursorLine, cursorCol, options)
    }
    try {
      const candidates = await references.list(agent, token.query, options.signal)
      const items: AutocompleteItem[] = []
      for (const candidate of candidates) {
        const value = formatFileMention(candidate, token.quoted)
        /* v8 ignore next -- candidate paths come from the workspace index and carry no control characters */
        if (value === undefined) continue
        items.push({
          value,
          label: candidate.path,
          description: candidate.kind === 'directory' ? copy.autocomplete.directory : copy.autocomplete.file,
        })
      }
      return { items, prefix: token.prefix }
    } catch (error: unknown) {
      if (options.signal.aborted) throw error
      // A provider failure must not break typing; the editor closes the list.
      return null
    }
  }

  /**
   * Replace the active token with one accepted suggestion.
   * @param lines - editor content lines.
   * @param cursorLine - cursor line index.
   * @param cursorCol - cursor column within that line.
   * @param item - the accepted suggestion.
   * @param prefix - the token text the completion replaces.
   * @returns updated editor content and cursor.
   */
  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    if (!prefix.startsWith('@')) return this.delegate.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
    const line = lines[cursorLine] ?? ''
    const start = Math.max(0, cursorCol - prefix.length)
    const next = `${line.slice(0, start)}${item.value}${line.slice(cursorCol)}`
    return {
      lines: lines.map((current, index) => index === cursorLine ? next : current),
      cursorLine,
      cursorCol: start + item.value.length,
    }
  }

  /**
   * Whether an exact file completion was explicitly requested.
   * @param lines - editor content lines.
   * @param cursorLine - cursor line index.
   * @param cursorCol - cursor column within that line.
   * @returns whether the delegate should offer file completion.
   */
  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
    return this.delegate.shouldTriggerFileCompletion(lines, cursorLine, cursorCol)
  }
}

/**
 * Composer submission: terminal-local controls, registered slash commands, and
 * ordinary prompts or steering input.
 *
 * @module @deepseek-ai/dsh-tui/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SlashCommand } from '@earendil-works/pi-tui'
import { copy } from './copy.ts'

/** Terminal-local controls the composer owns instead of dispatching to the agent. */
export interface LocalCommands {
  /** Show the help panel. */
  help(): void
  /** Show the status panel. */
  status(): void
  /** Open the model selector. */
  model(): void
  /** Clear the rendered transcript without touching the Session log. */
  clear(): void
  /** Toggle reasoning visibility. */
  reasoning(): void
  /** Cycle tool-card density. */
  cards(): void
  /** Repaint the screen. */
  redraw(): void
  /** Choose or set the reasoning effort; an absent argument opens the chooser. */
  effort(argument: string | undefined): void | Promise<void>
  /** Choose or switch the permission preset; an absent argument opens the chooser. */
  permission(argument: string | undefined): void | Promise<void>
  /** Close the terminal. */
  exit(): void
}

/** One value the composer offers for a command argument. */
export interface ChoiceItem {
  /** Argument value to dispatch or apply. */
  readonly value: string
  /** Display label. */
  readonly label: string
  /** Optional supporting description. */
  readonly description?: string
}

/** Values the composer needs from the terminal application. */
export interface ComposerDeps {
  /** Host context carrying the command registry. */
  readonly ctx: Context
  /** @returns the presented Agent. */
  readonly agent: () => Agent | undefined
  /** Terminal-local controls. */
  readonly local: LocalCommands
  /** Append a terminal-only notice. */
  readonly notice: (text: string) => void
  /**
   * Expand `@` mentions of one prompt into user-message content. Omitted when
   * the composition has no attachment or file-reference services.
   */
  readonly expandPrompt?: (text: string) => Promise<{ content: readonly ContentBlock[]; notices: readonly string[] }>
  /** Argument suggestions for terminal-local and registered commands. */
  readonly choices?: {
    /** @returns the current model's reasoning efforts, plus the provider default when offered. */
    readonly efforts?: () => Promise<readonly ChoiceItem[]>
    /** @returns the selectable permission presets. */
    readonly permissions?: () => readonly ChoiceItem[]
  }
}

/** One terminal-local command entry. */
interface LocalEntry {
  readonly description: string
  readonly run: (argument: string | undefined) => void
}

/** The composer behind the editor's submit handler. */
export class Composer {
  private readonly deps: ComposerDeps
  private readonly locals: Readonly<Record<string, LocalEntry>>

  /**
   * @param deps - application values and terminal-local controls.
   */
  constructor(deps: ComposerDeps) {
    this.deps = deps
    this.locals = {
      help: { description: 'Show keys and commands', run: () => { deps.local.help() } },
      status: { description: 'Show Session, model, and usage facts', run: () => { deps.local.status() } },
      model: { description: 'Select the model for this session', run: () => { deps.local.model() } },
      clear: { description: 'Clear the rendered transcript', run: () => { deps.local.clear() } },
      reasoning: { description: 'Toggle reasoning visibility', run: () => { deps.local.reasoning() } },
      cards: { description: 'Cycle collapsed, expanded, and hidden tool cards', run: () => { deps.local.cards() } },
      redraw: { description: 'Repaint the screen', run: () => { deps.local.redraw() } },
      effort: { description: 'Show or set the reasoning effort', run: (argument) => { void deps.local.effort(argument) } },
      permission: { description: 'Show or switch the permission preset', run: (argument) => { void deps.local.permission(argument) } },
      exit: { description: 'Close the terminal', run: () => { deps.local.exit() } },
      quit: { description: 'Close the terminal', run: () => { deps.local.exit() } },
    }
  }

  /**
   * Submit one editor line.
   * @param line - the exact submitted text.
   */
  submit(line: string): void {
    const text = line.trim()
    if (text === '') return
    const parsed = /^\/([a-z][a-z0-9_-]*)(?:[ \t]+([\s\S]*))?$/u.exec(text)
    if (parsed !== null) {
      /* v8 ignore next -- the regex captures group 1 exactly when it matches, so the fallback is unreachable */
      const name = parsed[1] ?? ''
      const argument = parsed[2]?.trim()
      const local = this.locals[name]
      if (local !== undefined) {
        local.run(argument)
        return
      }
      const agent = this.deps.agent()
      if (agent === undefined) {
        this.deps.notice('The agent is not ready yet.')
        return
      }
      const controller = new AbortController()
      void this.deps.ctx.commands.execute(agent, text, [], controller.signal).then(
        (result) => {
          if (result === undefined) this.deps.notice(`Unknown command: /${name}. Type /help for the available commands.`)
        },
        (error: unknown) => {
          this.deps.notice(`Command failed: ${error instanceof Error ? error.message : String(error)}`)
        },
      )
      return
    }
    const agent = this.deps.agent()
    if (agent === undefined) {
      this.deps.notice('The agent is not ready yet.')
      return
    }
    const expand = this.deps.expandPrompt
    if (expand === undefined) {
      this.send(agent, [{ type: 'text', text: line }])
      return
    }
    void expand(line).then(({ content, notices }) => {
      for (const notice of notices) this.deps.notice(notice)
      const current = this.deps.agent()
      if (current === undefined) {
        this.deps.notice('The agent is not ready yet.')
        return
      }
      this.send(current, [...content])
    }).catch((error: unknown) => {
      this.deps.notice(`Prompt preparation failed: ${error instanceof Error ? error.message : String(error)}`)
      const current = this.deps.agent()
      if (current !== undefined) this.send(current, [{ type: 'text', text: line }])
    })
  }

  /**
   * Send one prepared user message, steering a running turn.
   * @param agent - the live presented Agent.
   * @param content - the resolved message content blocks.
   */
  private send(agent: Agent, content: ContentBlock[]): void {
    const message = createUserMessage({ content, source: { kind: 'user' } })
    if (agent.status === 'running') agent.steer(message)
    else agent.followup(message)
  }

  /**
   * List terminal-local and registered commands for autocomplete.
   * @returns slash-command descriptors in display order.
   */
  slashCommands(): readonly SlashCommand[] {
    const efforts = this.deps.choices?.efforts
    const permissions = this.deps.choices?.permissions
    const local = Object.entries(this.locals).map(([name, entry]): SlashCommand => {
      const argument = name === 'effort'
        ? { argumentHint: '<level>', getArgumentCompletions: (prefix: string) => this.argumentChoices(efforts, prefix) }
        : name === 'permission' && permissions !== undefined
          ? { argumentHint: '<preset>', getArgumentCompletions: (prefix: string) => this.argumentChoices(() => Promise.resolve(permissions()), prefix) }
          : {}
      return { name, description: entry.description, ...argument }
    })
    const agent = this.deps.agent()
    if (agent === undefined) return local
    const registered = this.deps.ctx.commands.list(agent)
      .filter(command => this.locals[command.name] === undefined)
      .map((command): SlashCommand => ({
        name: command.name,
        description: command.description,
        ...(command.input === undefined ? {} : { argumentHint: command.input.hint }),
      }))
    return [...local, ...registered]
  }

  /**
   * Filter one argument-choice source by the typed prefix.
   * @param source - the choice provider, optional when the composition exposes none.
   * @param prefix - typed argument prefix.
   * @returns matching completion items, or null when the source is absent.
   */
  private async argumentChoices(
    source: (() => Promise<readonly ChoiceItem[]>) | undefined,
    prefix: string,
  ): Promise<{ value: string; label: string; description?: string }[] | null> {
    if (source === undefined) return null
    const query = prefix.trim().toLowerCase()
    return (await source())
      .filter(item => item.value.toLowerCase().includes(query) || item.label.toLowerCase().includes(query))
      .map(item => ({ value: item.value, label: item.label, ...(item.description === undefined ? {} : { description: item.description }) }))
  }

  /**
   * Render the help body.
   * @returns help lines.
   */
  helpLines(): string[] {
    const lines = [
      'Keys',
      '  Enter              send, steer, or run a command',
      '  Alt+Enter/Ctrl+J   insert a newline',
      '  Ctrl+C             cancel a running turn, then exit when idle',
      '  Ctrl+O             cycle collapsed, expanded, and hidden tool cards',
      '  Ctrl+R             toggle reasoning visibility',
      '  Ctrl+L             repaint',
      '  Shift+Tab          cycle reasoning effort',
      '  PgUp/PgDn          scroll the transcript',
      '',
      'Commands',
    ]
    for (const [name, entry] of Object.entries(this.locals)) {
      lines.push(`  /${name.padEnd(18, ' ')} ${entry.description}`)
    }
    const agent = this.deps.agent()
    if (agent !== undefined) {
      for (const command of this.deps.ctx.commands.list(agent).filter(item => this.locals[item.name] === undefined)) {
        const hint = command.input === undefined ? '' : ` ${command.input.hint}`
        lines.push(`  /${(command.name + hint).padEnd(18, ' ')} ${command.description}`)
      }
    }
    return lines
  }

  /**
   * Render the status body.
   * @returns status lines.
   */
  statusLines(): string[] {
    const agent = this.deps.agent()
    if (agent === undefined) return ['The agent is not ready yet.']
    const session = agent.session
    const header = session.header
    const lines = [
      `Session    ${session.id}`,
      `Started    ${new Date(header.createdAt).toISOString()}`,
      `Origin     ${header.origin ?? 'root'}`,
      `Provider   ${agent.options.provider}`,
      `Model      ${agent.options.model}`,
      `Status     ${agent.status}`,
      '',
      copy.panel.closeHint,
    ]
    return lines
  }
}

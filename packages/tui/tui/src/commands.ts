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
import { REASONING_LEVELS } from './reasoning.ts'
import type { BusyEnter } from './config.ts'
import type { TerminalCommand } from './contribution.ts'
import { CARD_MODES } from './cards.ts'

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
  /** Cycle or set the reasoning visibility; an absent argument advances the level. */
  reasoning(argument: string | undefined): void | Promise<void>
  /** Cycle or set the tool-card visibility; an absent argument advances the mode. */
  cards(argument: string | undefined): void | Promise<void>
  /** Repaint the screen. */
  redraw(): void
  /** Choose or set the reasoning effort; an absent argument opens the chooser. */
  effort(argument: string | undefined): void | Promise<void>
  /** Choose or switch the permission preset; an absent argument opens the chooser. */
  permission(argument: string | undefined): void | Promise<void>
  /** Queue one message for the next turn, or edit the queue when no text is given. */
  queue(argument: string | undefined): void | Promise<void>
  /** Steer one message into the running turn, or steer every queued message. */
  steer(argument: string | undefined): void | Promise<void>
  /** Show the configuration panel. */
  config(): void
  /** Choose or switch the agent preset; an absent argument opens the chooser. */
  preset(argument: string | undefined): void | Promise<void>
  /** Show terminal, input, and rendering diagnostics. */
  terminal(): void
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
  /** Delivery mode plain Enter uses while the Agent runs; a getter keeps live config changes. */
  readonly busyEnter: BusyEnter | (() => BusyEnter)
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
  private readonly contributed = new Map<string, TerminalCommand>()

  /**
   * @param deps - application values and terminal-local controls.
   */
  constructor(deps: ComposerDeps) {
    this.deps = deps
    this.locals = {
      help: { description: copy.commands.help, run: () => { deps.local.help() } },
      status: { description: copy.commands.status, run: () => { deps.local.status() } },
      model: { description: copy.commands.model, run: () => { deps.local.model() } },
      clear: { description: copy.commands.clear, run: () => { deps.local.clear() } },
      reasoning: { description: copy.commands.reasoning, run: (argument) => { void deps.local.reasoning(argument) } },
      cards: { description: copy.commands.cards, run: (argument) => { void deps.local.cards(argument) } },
      redraw: { description: copy.commands.redraw, run: () => { deps.local.redraw() } },
      effort: { description: copy.commands.effort, run: (argument) => { void deps.local.effort(argument) } },
      permission: { description: copy.commands.permission, run: (argument) => { void deps.local.permission(argument) } },
      queue: { description: copy.commands.queue, run: (argument) => { void deps.local.queue(argument) } },
      steer: { description: copy.commands.steer, run: (argument) => { void deps.local.steer(argument) } },
      config: { description: copy.commands.config, run: () => { deps.local.config() } },
      preset: { description: copy.commands.preset, run: (argument) => { void deps.local.preset(argument) } },
      terminal: { description: copy.commands.terminal, run: () => { deps.local.terminal() } },
      exit: { description: copy.commands.exit, run: () => { deps.local.exit() } },
      quit: { description: copy.commands.quit, run: () => { deps.local.exit() } },
    }
  }

  /**
   * Register one dynamic slash command.
   * @param command - command definition.
   * @returns disposer removing the command.
   * @throws when the name is already owned by a local or contributed command.
   */
  registerCommand(command: TerminalCommand): () => void {
    if (this.locals[command.name] !== undefined || this.contributed.has(command.name)) {
      throw new Error(`terminal-ui: command "/${command.name}" is already registered`)
    }
    this.contributed.set(command.name, command)
    return () => { this.contributed.delete(command.name) }
  }

  /**
   * Submit one editor line.
   * @param line - the exact submitted text.
   * @param mode - delivery override for a busy turn; `auto` reads the configured busy-Enter mode.
   */
  submit(line: string, mode: 'auto' | BusyEnter = 'auto'): void {
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
      const contributed = this.contributed.get(name)
      if (contributed !== undefined) {
        void contributed.run(argument)
        return
      }
      const agent = this.deps.agent()
      if (agent === undefined) {
        this.deps.notice(copy.commands.agentNotReady)
        return
      }
      const controller = new AbortController()
      void this.deps.ctx.commands.execute(agent, text, [], controller.signal).then(
        (result) => {
          if (result === undefined) this.deps.notice(copy.commands.unknown(name))
        },
        (error: unknown) => {
          this.deps.notice(copy.commands.failed(error instanceof Error ? error.message : String(error)))
        },
      )
      return
    }
    const agent = this.deps.agent()
    if (agent === undefined) {
      this.deps.notice(copy.commands.agentNotReady)
      return
    }
    const expand = this.deps.expandPrompt
    if (expand === undefined) {
      this.send(agent, [{ type: 'text', text: line }], mode)
      return
    }
    void expand(line).then(({ content, notices }) => {
      for (const notice of notices) this.deps.notice(notice)
      const current = this.deps.agent()
      if (current === undefined) {
        this.deps.notice(copy.commands.agentNotReady)
        return
      }
      this.send(current, [...content], mode)
    }).catch((error: unknown) => {
      this.deps.notice(copy.commands.promptFailed(error instanceof Error ? error.message : String(error)))
      const current = this.deps.agent()
      if (current !== undefined) this.send(current, [{ type: 'text', text: line }], mode)
    })
  }

  /**
   * Send one prepared user message with the configured busy-turn delivery.
   * @param agent - the live presented Agent.
   * @param content - the resolved message content blocks.
   * @param mode - explicit delivery override, or `auto` for the configured mode.
   */
  private send(agent: Agent, content: ContentBlock[], mode: 'auto' | BusyEnter): void {
    const message = createUserMessage({ content, source: { kind: 'user' } })
    if (agent.status !== 'running') {
      agent.followup(message)
      return
    }
    const configured = typeof this.deps.busyEnter === 'function' ? this.deps.busyEnter() : this.deps.busyEnter
    const steer = mode === 'auto' ? configured === 'steer' : mode === 'steer'
    if (steer) {
      agent.steer(message)
      this.deps.notice(copy.queue.steered)
    } else {
      agent.followup(message)
      this.deps.notice(copy.queue.queued)
    }
  }

  /**
   * List terminal-local and registered commands for autocomplete.
   * @returns slash-command descriptors in display order.
   */
  slashCommands(): readonly SlashCommand[] {
    const efforts = this.deps.choices?.efforts
    const permissions = this.deps.choices?.permissions
    const local = Object.entries(this.locals).map(([name, entry]): SlashCommand => {
      let argument: Pick<SlashCommand, 'argumentHint' | 'getArgumentCompletions'> = {}
      if (name === 'effort') {
        argument = { argumentHint: '<level>', getArgumentCompletions: (prefix: string) => this.argumentChoices(efforts, prefix) }
      } else if (name === 'reasoning') {
        argument = { argumentHint: '<level>', getArgumentCompletions: (prefix: string) => this.reasoningChoices(prefix) }
      } else if (name === 'cards') {
        argument = { argumentHint: '<mode>', getArgumentCompletions: (prefix: string) => this.cardChoices(prefix) }
      } else if (name === 'permission' && permissions !== undefined) {
        argument = { argumentHint: '<preset>', getArgumentCompletions: (prefix: string) => this.argumentChoices(() => Promise.resolve(permissions()), prefix) }
      }
      return { name, description: entry.description, ...argument }
    })
    const contributed = [...this.contributed.values()].map((command): SlashCommand => ({
      name: command.name,
      description: command.description,
      ...(command.argumentHint === undefined ? {} : { argumentHint: command.argumentHint }),
      ...(command.getArgumentCompletions === undefined
        ? {}
        : { getArgumentCompletions: (prefix: string) => [...(command.getArgumentCompletions?.(prefix) ?? [])] }),
    }))
    const agent = this.deps.agent()
    if (agent === undefined) return [...local, ...contributed]
    const registered = this.deps.ctx.commands.list(agent)
      .filter(command => this.locals[command.name] === undefined)
      .map((command): SlashCommand => ({
        name: command.name,
        description: command.description,
        ...(command.input === undefined ? {} : { argumentHint: command.input.hint }),
      }))
    return [...local, ...contributed, ...registered]
  }

  /**
   * List the static reasoning-visibility level choices.
   * @param prefix - typed argument prefix.
   * @returns matching completion items.
   */
  private reasoningChoices(prefix: string): { value: string; label: string }[] {
    const query = prefix.trim().toLowerCase()
    return REASONING_LEVELS
      .map(level => ({ value: level, label: copy.reasoning.levels[level] }))
      .filter(item => item.value.includes(query) || item.label.toLowerCase().includes(query))
  }

  /**
   * Filter the tool-card modes by the typed argument prefix.
   * @param prefix - typed argument prefix.
   * @returns matching completion items.
   */
  private cardChoices(prefix: string): { value: string; label: string }[] {
    const query = prefix.trim().toLowerCase()
    return CARD_MODES
      .map(mode => ({ value: mode, label: copy.cards.levels[mode] }))
      .filter(item => item.value.includes(query) || item.label.toLowerCase().includes(query))
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
      copy.commands.helpTitle,
      ...copy.commands.helpKeys,
      '',
      copy.commands.helpCommandsTitle,
    ]
    for (const [name, entry] of Object.entries(this.locals)) {
      lines.push(`  /${name.padEnd(18, ' ')} ${entry.description}`)
    }
    for (const command of this.contributed.values()) {
      lines.push(`  /${command.name.padEnd(18, ' ')} ${command.description}`)
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
    const labels = copy.statusPanel
    const lines = [
      `${labels.session.padEnd(10, ' ')} ${session.id}`,
      `${labels.created.padEnd(10, ' ')} ${new Date(header.createdAt).toISOString()}`,
      `${labels.provider.padEnd(10, ' ')} ${agent.options.provider ?? '-'}`,
      `${labels.model.padEnd(10, ' ')} ${agent.options.model}`,
      `${labels.state.padEnd(10, ' ')} ${agent.status}`,
      '',
      copy.panel.closeHint,
    ]
    return lines
  }
}

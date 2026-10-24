/**
 * Terminal UI contribution seam: plugins can add compact strips, slash
 * commands, and one bottom-dock surface without importing the terminal
 * application internals. The terminal remains the owner of layout, input
 * routing, and teardown; a contribution is an effect that unwinds with its
 * plugin.
 *
 * @module @deepseek-ai/dsh-tui/contribution
 */

import type { Component } from '@earendil-works/pi-tui'

/** Stable Cordis service name for the terminal contribution seam. */
export const TERMINAL_UI_SERVICE = 'terminalUi'

/** One slash command a plugin contributes to the composer. */
export interface TerminalCommand {
  /** Lower-case command name without the slash. */
  readonly name: string
  /** Description shown in completion and help. */
  readonly description: string
  /** Optional argument hint shown by completion. */
  readonly argumentHint?: string
  /** Optional argument completion source. */
  readonly getArgumentCompletions?: (prefix: string) => readonly { value: string; label: string }[]
  /** Run one submission; the argument is the trimmed text after the command. */
  run(argument: string | undefined): void | Promise<void>
}

/** A component that owns dock input. */
export interface TerminalDockComponent extends Component {
  /**
   * Handle one input sequence while the surface owns the dock.
   * @param data - raw terminal input.
   * @returns whether the sequence was consumed.
   */
  handleInput(data: string): boolean | void
}

/** The service plugins consume to extend the terminal interface. */
export interface TerminalUi {
  /**
   * Add one component line above the composer.
   * @param component - strip component; render zero lines to stay hidden.
   * @returns disposer removing the strip.
   */
  registerStrip(component: Component): () => void
  /**
   * Add one slash command to the composer.
   * @param command - command definition.
   * @returns disposer removing the command.
   */
  registerCommand(command: TerminalCommand): () => void
  /**
   * Present one component as the bottom dock.
   * @param component - component owning dock input.
   * @param close - releases the dock.
   */
  openDock(component: TerminalDockComponent, close: () => void): void
  /** Release the contribution-owned dock, if any. */
  closeDock(): void
  /**
   * Replace the composer text.
   * @param text - new editor content.
   */
  setEditorText(text: string): void
  /**
   * Append one terminal-only transcript notice.
   * @param text - notice text.
   */
  notice(text: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Terminal UI contribution seam, provided by the terminal plugin. */
    terminalUi?: TerminalUi
  }
}

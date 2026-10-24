/**
 * Local contracts for the terminal contribution seam and the palette subset the
 * Agent Teams surface renders with. The package defines them structurally so it
 * needs no dependency on the terminal package or its internals.
 *
 * @module @deepseek-ai/dsh-experimental-tui-agent-team/types
 */

import type { Component } from '@earendil-works/pi-tui'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** The terminal palette methods this surface uses. */
export interface Palette {
  heading(text: string): string
  accent(text: string): string
  inverse(text: string): string
  dim(text: string): string
  warning(text: string): string
  success(text: string): string
}

/** One slash command registered through the seam. */
export interface TeamCommand {
  readonly name: string
  readonly description: string
  run(argument: string | undefined): void | Promise<void>
}

/** A component that owns dock input. */
export interface DockComponent extends Component {
  handleInput(data: string): boolean | void
}

/** The `ctx.terminalUi` surface this package consumes. */
export interface TerminalUiLike {
  readonly palette: Palette
  readonly locale: 'en' | 'zh'
  agent(): Agent | undefined
  requestRender(): void
  registerStrip(component: Component): () => void
  registerCommand(command: TeamCommand): () => void
  openDock(component: DockComponent, close: () => void): void
  closeDock(): void
  setEditorText(text: string): void
  notice(text: string): void
}

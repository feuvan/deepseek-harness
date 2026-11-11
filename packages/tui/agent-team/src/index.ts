/**
 * Terminal Agent Teams plugin: installs the Team strip, `/team` command, member
 * and task dock, and teammate transcript through `ctx.terminalUi`. The terminal
 * app composes it; the plugin stays inert in compositions without the terminal
 * contribution seam (for example Web), which mount their own Team surfaces.
 *
 * @module @deepseek-ai/dsh-tui-agent-team
 */

import type { Context } from '@deepseek-ai/cordis'
import { TeamController } from './controller.ts'
import type { TerminalUiLike } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-agent-team'

/**
 * Install the terminal surface when the terminal contribution seam exists.
 * @param ctx - plugin context that may carry `terminalUi`.
 */
export function apply(ctx: Context): void {
  ctx.inject(['terminalUi'], (child) => {
    child.effect(() => {
      const ui = (child as Context & { terminalUi?: TerminalUiLike }).terminalUi
      /* v8 ignore next -- the injected service is present inside the inject callback */
      if (ui === undefined) return () => {}
      return new TeamController(child, ui).install()
    }, 'tui-agent-team: contribution')
  })
}

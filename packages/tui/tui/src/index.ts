/**
 * The terminal front door: a full-screen Cordis plugin over the shared Agent,
 * Session, tool, command, and human-interaction services.
 *
 * @module @deepseek-ai/dsh-tui
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { Config, resolveConfig } from './config.ts'
import { resolveLocale } from './locale.ts'
import { setCopyLocale } from './copy.ts'
import { TerminalApp } from './lifecycle.ts'
import { assertInteractiveTerminal } from './terminal.ts'

export { Config } from './config.ts'

/** Stable Cordis plugin name. */
export const name = 'terminal-ui'

/** Services the terminal consumes; activation waits for all of them. */
export const inject = [
  'agents',
  'approval',
  'commands',
  'llm',
  'sessionProjections',
  'sessionQuery',
  'sessions',
  'tools',
  'userQuestions',
]

/**
 * Mount the terminal front door. The launcher supplies `ctx.cmdlineArgs` and
 * `ctx.appExit`; the application composition creates the root Agent whose
 * Session identity this row names.
 * @param ctx - plugin context carrying the terminal's services.
 * @param config - validated row configuration.
 * @throws when the process is not attached to an interactive terminal, so the
 * failure is a startup diagnostic rather than a silent downgrade.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  setCopyLocale(resolveLocale(resolved.locale))
  assertInteractiveTerminal(process.stdin.isTTY, process.stdout.isTTY)
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('terminal-ui: the launcher must provide ctx.appExit before the tree mounts')
  }
  const app = new TerminalApp(ctx, resolved, exit)
  ctx.effect(() => () => { app.dispose() }, 'terminal-ui: terminal lifecycle')
  app.start()
}

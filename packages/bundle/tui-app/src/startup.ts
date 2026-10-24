/**
 * The TUI application's command-line provider: it parses `--resume <id>` and
 * `--help`, mints the Session identity a fresh launch uses, and publishes
 * {@link TUI_STARTUP_SERVICE} for the Agent-owning row and the terminal row.
 *
 * @module @deepseek-ai/dsh-tui-app/startup
 */

import { randomUUID } from 'node:crypto'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the app's arguments can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the Agent and terminal rows. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The parsed TUI application arguments, provided before the dependent rows mount. */
    tuiStartup?: TuiStartupValues
  }
}

/** What the application rows read from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Exact Session identity this launch presents, fresh or resumed. */
  readonly sessionId: SessionId
  /** Persisted identity to resume; absent for a fresh Session. */
  readonly resumeSessionId: SessionId | undefined
  /** Agent preset requested for a fresh Session; the registry default when omitted. */
  readonly preset: string | undefined
}

/**
 * This app's command: the terminal surface's own flags and help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Run the DeepSeek Harness agent in a full-screen terminal interface.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume <id>', 'resume the persisted Session with this id')
    .option('--preset <id>', 'agent preset for a fresh Session (standard, ptc, minimal, cordis)')
    .addHelpText('after', `
Examples:
  dsh tui                       start a fresh Session in the terminal
  dsh tui --resume <session>    continue a persisted Session
  dsh tui --preset ptc          start a fresh Session under the ptc preset
`)
}

/**
 * Parse the application arguments and provide the Session identity as an
 * ordinary Cordis service.
 * @param ctx - plugin context carrying the command line and exit request.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const options = program.opts<{ resume?: string; preset?: string }>()
    const resume = options.resume
    if (resume !== undefined && resume.trim() === '') {
      program.error('error: --resume requires a non-empty session id')
    }
    const preset = options.preset
    if (preset !== undefined && preset.trim() === '') {
      program.error('error: --preset requires a non-empty agent preset id')
    }
    const resumeSessionId = resume === undefined ? undefined : brandString<SessionId>(resume)
    const sessionId = resumeSessionId ?? brandString<SessionId>(`session-${randomUUID()}`)
    ctx.provide(TUI_STARTUP_SERVICE, { sessionId, resumeSessionId, preset } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}

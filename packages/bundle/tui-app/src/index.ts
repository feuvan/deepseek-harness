/**
 * The TUI application's Agent owner: it creates the fresh Session or resumes
 * the exact persisted one the terminal will present, then disposes that Agent
 * with the application. The terminal plugin itself stays presentation-only.
 *
 * @module @deepseek-ai/dsh-tui-app
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { AppExit } from '@deepseek-ai/dsh-cmdline'
import { brandString } from '@deepseek-ai/dsh-brand'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name. */
export const name = 'tui-session'

/** Services required before the presented Agent can be created or resumed. */
export const inject = ['agentDefaultModel', 'agents']

/** Row configuration supplied from the app's startup service. */
export interface Config {
  /** Exact Session identity this launch presents. */
  sessionId: string
  /** Persisted Session to resume instead of creating a fresh one. */
  resumeSessionId?: string
}

/** Validated schema for {@link Config}. */
export const Config: z<Config> = z.object({
  sessionId: z.string().min(1),
  resumeSessionId: z.string().min(1),
})

/** The Session facts that decide whether the TUI may drive a stored Session. */
interface AdoptableHeader {
  cwd?: string | undefined
  origin?: 'subagent' | undefined
  parentSession?: SessionId | undefined
  agentPreset?: string | undefined
}

/**
 * The preset a Session currently runs under: its creation header advanced by
 * the last recorded selection.
 * @param header - the Session header.
 * @param events - the Session's durable events in log order.
 * @param sessionId - the presented identity, used in diagnostics.
 * @returns the recorded preset, when one was selected.
 * @throws when a selection record is malformed, which must not read as "no preset".
 */
function currentPreset(header: AdoptableHeader, events: Iterable<SessionEvent>, sessionId: SessionId): string | undefined {
  let preset = header.agentPreset
  for (const event of events) {
    if (event.type !== 'agent-preset/selected') continue
    const selected: unknown = event.data.agentPreset
    if (typeof selected !== 'string' || selected === '') {
      throw new Error(`session "${sessionId}" records a malformed agent-preset/selected event and cannot be resumed`)
    }
    preset = selected
  }
  return preset
}

/**
 * Reject a Session the preset-less terminal composition must not adopt.
 * @param header - the Session header.
 * @param events - the Session's durable events.
 * @param sessionId - the presented identity.
 * @param cwd - the current process working directory.
 * @throws when the Session belongs to another composition or directory.
 */
function assertAdoptable(header: AdoptableHeader, events: Iterable<SessionEvent>, sessionId: SessionId, cwd: string): void {
  const preset = currentPreset(header, events, sessionId)
  if (preset !== undefined) {
    throw new Error(
      `session "${sessionId}" runs under agent preset "${preset}", which the TUI profile does not compose`,
    )
  }
  if (header.origin === 'subagent' || header.parentSession !== undefined) {
    throw new Error(`session "${sessionId}" is a subagent or forked session and cannot be driven directly`)
  }
  if (header.cwd === undefined) {
    throw new Error(`session "${sessionId}" recorded no working directory, so it cannot be resumed`)
  }
  if (header.cwd !== cwd) {
    throw new Error(`session "${sessionId}" was recorded in "${header.cwd}", not "${cwd}"; run dsh tui from that directory`)
  }
}

/** Report a contained startup failure and request a failing exit. */
function fail(exit: AppExit, error: unknown): void {
  process.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  exit(1)
}

/**
 * Create or resume the presented Agent after the complete application mounts.
 * @param ctx - plugin context carrying the core Agent services.
 * @param config - validated row configuration.
 */
async function start(ctx: Context, config: Config): Promise<void> {
  // Loader siblings mount concurrently; wait for the composed tools, adapters,
  // and policies before the first Agent is published.
  await ctx.get('loader')?.await()
  const selection = ctx.agentDefaultModel.currentSelection()
  const agentOptions: AgentOptions = {
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
  }
  const fs = ctx.get('fs')
  const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))
  const sessionId = brandString<SessionId>(config.sessionId)
  if (config.resumeSessionId === undefined) {
    const handle = await ctx.agents.create({ sessionId, meta: { cwd }, agentOptions })
    ctx.effect(() => () => handle.dispose(), 'tui-session: presented Agent')
    return
  }
  const resumeSessionId = brandString<SessionId>(config.resumeSessionId)
  if (ctx.get('sessionPersistence') === undefined) {
    throw new Error('tui --resume requires the sessionPersistence service; dsh-base provides it')
  }
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    throw new Error('tui --resume requires the sessionQuery service; dsh-base provides it')
  }
  using observation = await query.observeSession(resumeSessionId)
  assertAdoptable(observation.header, observation.events, resumeSessionId, cwd)
  const handle = await ctx.agents.resume({ resumeSessionId, agentOptions })
  // The observation was a snapshot: another writer may have appended a preset
  // selection or moved the Session before this process took the write lease.
  using resumed = await query.observeSession(resumeSessionId)
  assertAdoptable(resumed.header, resumed.events, resumeSessionId, cwd)
  ctx.effect(() => () => handle.dispose(), 'tui-session: resumed Agent')
}

/**
 * Mount the Agent owner for the terminal front door.
 * @param ctx - plugin context carrying the Agent registry and default model.
 * @param config - validated row configuration.
 * @throws when the launcher did not provide the exit request.
 */
export function apply(ctx: Context, config: Config): void {
  // appExit is a launcher-provided host value, not an injected service.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('tui-session: the launcher must provide ctx.appExit before the tree mounts')
  }
  void start(ctx, config).catch((error: unknown) => { fail(exit, error) })
}

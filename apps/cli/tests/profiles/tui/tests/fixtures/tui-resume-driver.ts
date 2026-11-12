/**
 * Test-only overlay for the `dsh tui` Session-switch acceptance: it seeds one
 * detached, persisted Session, then lets the PTY test drive `/sessions` and
 * `/resume`. A replacement process mounts the same overlay, recognizes the
 * resumed identity, and reports that the handoff reached it.
 *
 * The Loader mounts this module from the overlay patch, so it is plain erasable
 * TypeScript: no enums, namespaces, or parameter properties.
 *
 * @module tui-resume-driver
 */

import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'

/** Stable Cordis plugin name. */
export const name = 'tui-resume-driver'
/** Services that must exist before the driver seeds or inspects the root Agent. */
export const inject = ['loader', 'agents', 'sessionPersistence']

/** Exact stored Session identity the PTY test resumes. */
const TARGET_ID = SessionId('session-resume-target')
/** How long the driver waits for the live root Agent or a test handoff. */
const HANDOFF_TIMEOUT_MS = 60_000

/**
 * Read one required path from the test-provided environment.
 * @param variable - environment variable name.
 * @returns the absolute path the PTY test prepared.
 * @throws when the PTY test did not provide the variable.
 */
function requireEnv(variable: string): string {
  const value = process.env[variable]
  if (value === undefined || value === '') {
    throw new Error(`tui-resume-driver: ${variable} is not set; the PTY test must provide it`)
  }
  return value
}

/**
 * Resolve the live root Agent the terminal presents.
 * @param ctx - host context carrying the Agent registry.
 * @returns the live root Agent.
 * @throws when no live root Agent appears in time.
 */
async function waitForRootAgent(ctx: Context): Promise<Agent> {
  const deadline = Date.now() + HANDOFF_TIMEOUT_MS
  for (;;) {
    const agent = ctx.agents.list().find(candidate => candidate.session.header.origin !== 'subagent')
    if (agent !== undefined) return agent
    if (Date.now() >= deadline) throw new Error('tui-resume-driver: no live root Agent appeared')
    await delay(20)
  }
}

/**
 * Create the stored target Session through the persistence seam, append one
 * complete turn, and release write ownership so the listing sees one persisted,
 * non-live Session.
 * @param ctx - host context carrying the persistence backend.
 * @returns when the target Session is durable and no longer owned.
 */
async function seedTargetSession(ctx: Context): Promise<void> {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) throw new Error('tui-resume-driver: sessionPersistence is not composed')
  const time = Date.now()
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: TARGET_ID,
    createdAt: time,
    cwd: process.cwd(),
    isSeeded: false,
    agentPreset: 'standard',
  }
  const events: SessionEvent[] = [
    {
      type: 'session/title',
      seq: SessionSeq(0),
      time,
      data: { title: 'Resume target', messageSeqs: [], source: { kind: 'user' } },
    },
    { type: 'turn/start', seq: SessionSeq(1), time, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: SessionSeq(2),
      time,
      data: createUserMessage({
        content: [{ type: 'text', text: 'Resume target prompt' }],
        source: { kind: 'user' },
      }),
      surfaceOp: 'append',
    },
    { type: 'step/start', seq: SessionSeq(3), time, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message',
      seq: SessionSeq(4),
      time,
      data: {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'Resume target reply.' }],
          source: { provider: 'deepseek-official', model: 'acceptance-model' },
        }),
        stream: [],
      },
      surfaceOp: 'append',
    },
    { type: 'step/end', seq: SessionSeq(5), time, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: SessionSeq(6), time, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const handle = await persistence.create(header)
  try {
    await handle.append(events)
    await handle.flush()
  } finally {
    await handle.close()
  }
}

/**
 * Seed the target before the PTY test opens the chooser, or report that a
 * replacement process reached the resumed identity.
 * @param ctx - host context carrying the Loader, Agent, and Session services.
 */
async function run(ctx: Context): Promise<void> {
  const seededPath = requireEnv('DSH_TUI_RESUME_SEEDED')
  const resumedPath = requireEnv('DSH_TUI_RESUME_RESUMED')
  await ctx.get('loader')?.await()
  const agent = await waitForRootAgent(ctx)
  if (agent.session.id === TARGET_ID) {
    await writeFile(resumedPath, 'resumed\n')
    return
  }
  await seedTargetSession(ctx)
  await writeFile(seededPath, 'seeded\n')
}

/**
 * Mount the driver for the lifetime of the application.
 * @param ctx - host context carrying the services the driver waits for.
 */
export function apply(ctx: Context): void {
  void run(ctx).catch((error: unknown) => {
    process.stderr.write(`tui-resume-driver: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  })
}

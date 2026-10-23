/**
 * Test-only Cordis overlay for the shipped `dsh tui` profile: it waits for the
 * interactive terminal, appends one synthetic durable turn, asks the terminal a
 * question and an approval while that turn is open, closes the turn, and writes
 * the human decisions to the marker file the PTY test reads.
 *
 * The Loader mounts this module from the overlay patch, so it is plain erasable
 * TypeScript: no enums, namespaces, or parameter properties.
 *
 * @module tui-acceptance-driver
 */

import { access, rename, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'

/** Stable Cordis plugin name. */
export const name = 'tui-acceptance-driver'
/** Services that must exist before the driver appends its turn and asks. */
export const inject = ['loader', 'agents', 'approval', 'userQuestions']

/** Name of the tool card the synthetic turn reports. */
const TOOL_NAME = 'tui-acceptance'
/** Identity pairing the synthetic tool call with its result. */
const CALL_ID = ToolCallId('tui-acceptance-call')
/** Synthetic turn and step numbers; the presented Session is fresh. */
const TURN = 1
const STEP = 1
/** How long the driver waits for a test handoff or the live Agent. */
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
    throw new Error(`tui-acceptance-driver: ${variable} is not set; the PTY test must provide it`)
  }
  return value
}

/**
 * Wait until the PTY test signals that the terminal screen is interactive.
 * @param path - handoff file the test creates.
 * @param timeoutMs - maximum wait.
 * @throws when the handoff does not arrive in time.
 */
async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await access(path)
      return
    } catch {
      if (Date.now() >= deadline) throw new Error(`tui-acceptance-driver: timed out waiting for ${path}`)
      await delay(20)
    }
  }
}

/**
 * Resolve the live root Agent the terminal presents. The tui profile composes
 * exactly one root Agent, so a second root means the composition moved under
 * this driver and the synthetic turn would land on the wrong Session.
 * @param ctx - host context carrying the Agent registry.
 * @returns the live root Agent.
 * @throws when no live root Agent appears in time or more than one is live.
 */
async function waitForRootAgent(ctx: Context): Promise<Agent> {
  const deadline = Date.now() + HANDOFF_TIMEOUT_MS
  for (;;) {
    const roots = ctx.agents.roots()
    const agent = roots[0]
    if (agent !== undefined) {
      if (roots.length > 1) {
        throw new Error(`tui-acceptance-driver: expected one live root Agent, found ${String(roots.length)}`)
      }
      return agent
    }
    if (Date.now() >= deadline) throw new Error('tui-acceptance-driver: no live root Agent appeared')
    await delay(20)
  }
}

/**
 * Write one marker document atomically, so the PTY test never reads a partial file.
 * @param markerPath - destination path.
 * @param marker - serializable marker document.
 */
async function writeMarker(markerPath: string, marker: unknown): Promise<void> {
  const temporary = `${markerPath}.tmp`
  await writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`)
  await rename(temporary, markerPath)
}

/**
 * Report one failure through the marker file the PTY test asserts on.
 * @param markerPath - destination path.
 * @param error - the failure to report.
 */
async function reportFailure(markerPath: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`tui-acceptance-driver: ${message}\n`)
  if (markerPath === '') return
  try {
    await writeMarker(markerPath, { error: message })
  } catch (writeError: unknown) {
    process.stderr.write(`tui-acceptance-driver: could not write ${markerPath}: ${String(writeError)}\n`)
  }
}

/**
 * Append the synthetic turn, ask both interactions while it is open, close it,
 * and publish the decisions.
 * @param ctx - host context carrying the Agent, interaction, and Loader services.
 */
async function run(ctx: Context): Promise<void> {
  const readyPath = requireEnv('DSH_TUI_ACCEPTANCE_READY')
  const markerPath = requireEnv('DSH_TUI_ACCEPTANCE_MARKER')
  await ctx.get('loader')?.await()
  const agent = await waitForRootAgent(ctx)
  // The terminal registers its question and approval answerers while it builds
  // its interface; the test writes the handoff only once the banner is on
  // screen, which proves that registration happened.
  await waitForFile(readyPath, HANDOFF_TIMEOUT_MS)
  const session = agent.session
  const provider = agent.options.provider ?? 'deepseek-official'
  const model = agent.options.model ?? 'deepseek-v4-flash'
  session.append('turn/start', { turn: TURN })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Synthetic acceptance prompt' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: TURN, step: STEP })
  session.append('assistant/message', {
    turn: TURN,
    step: STEP,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'Synthetic assistant reply.' }],
      source: { provider, model },
    }),
    stream: [],
  }, { surfaceOp: 'append' })
  session.append('tool/call', {
    turn: TURN,
    step: STEP,
    callId: CALL_ID,
    name: TOOL_NAME,
    arguments: JSON.stringify({ command: 'tui-acceptance' }),
  })
  session.append('tool/result', {
    turn: TURN,
    step: STEP,
    message: createToolResultMessage({
      callId: CALL_ID,
      content: [{ type: 'text', text: 'tui-acceptance completed.' }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: TURN, step: STEP })
  // Both requests are pending while the turn is open; the question panel opens
  // first and the approval waits behind it in the terminal's single-modal host.
  const [question, approval] = await Promise.all([
    ctx.userQuestions.ask({
      agent,
      questions: [{
        id: 'q1',
        question: 'Proceed?',
        options: [{ label: 'Yes' }, { label: 'No' }],
      }],
    }),
    ctx.approval.request({
      agent,
      toolName: TOOL_NAME,
      reason: 'The synthetic acceptance turn asks for one approval.',
    }),
  ])
  session.append('assistant/message', {
    turn: TURN,
    step: STEP,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'Closing acceptance reply.' }],
      source: { provider, model },
    }),
    stream: [],
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: TURN, reason: { kind: 'completed' } })
  await writeMarker(markerPath, {
    question,
    approval,
    sessionId: agent.session.id,
    seq: session.seq,
    turn: TURN,
    step: STEP,
  })
}

/**
 * Mount the driver and contain every failure in the marker file.
 * @param ctx - host context provided by the profile composition.
 */
export function apply(ctx: Context): void {
  const markerPath = process.env.DSH_TUI_ACCEPTANCE_MARKER ?? ''
  void run(ctx).catch((error: unknown) => reportFailure(markerPath, error))
}

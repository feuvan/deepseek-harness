/**
 * Assembled PTY acceptance for the shipped `dsh tui` profile: one synthetic
 * durable turn, the question and approval panels answered from the terminal,
 * the closing transcript rows, and `/exit` restoring the terminal.
 *
 * The turn is appended by the test-only driver in `fixtures/`, mounted through
 * an overlay patch; the driver reports the decisions it received in a marker
 * file, so the assertions cross the process boundary in both directions.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { afterEach, describe, expect, it } from 'vitest'
import { PtyProcess, type PtyProcessOptions } from '../../../../../../packages/test-support/terminal-snapshot/src/index.ts'

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const sourceBin = join(repoRoot, 'apps/cli/src/bin.ts')
const tsconfigPath = join(repoRoot, 'tsconfig.json')
const overlayPath = fileURLToPath(new URL('./fixtures/tui-acceptance.patch.yml', import.meta.url))

/** How long one screen condition or the whole scenario may take. */
const PROCESS_TIMEOUT_MS = 120_000
const HANDSHAKE_TIMEOUT_MS = 60_000
/** Marker document the driver writes once the synthetic turn is closed. */
const MARKER_FILE = 'acceptance-marker.json'
const READY_FILE = 'terminal-ready'

const temporaryRoots: string[] = []
const children: PtyProcess[] = []

afterEach(async () => {
  for (const child of children.splice(0)) child.dispose()
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** The decisions the terminal sent back through the driver. */
interface AcceptanceMarker {
  readonly question?: { readonly answers: readonly { readonly id: string; readonly selected: readonly string[] }[] }
  readonly approval?: string
  readonly error?: string
}

/** One screen wait that gives up loudly instead of hanging the suite. */
async function waitForText(child: PtyProcess, text: string, timeoutMs = HANDSHAKE_TIMEOUT_MS): Promise<void> {
  try {
    await child.waitForText(text, timeoutMs)
  } catch (error) {
    throw new Error(
      `terminal never showed ${JSON.stringify(text)}; last screen:\n${child.screen().lines.join('\n')}`,
      { cause: error },
    )
  }
}

/**
 * Resolve the driver's marker document once both interactions and the closing
 * events committed.
 * @param path - marker file the driver writes.
 * @param timeoutMs - maximum wait.
 * @returns the parsed marker.
 * @throws when the driver reported a failure or the marker never appears.
 */
async function waitForMarker(path: string, timeoutMs: number): Promise<AcceptanceMarker> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let content: string | undefined
    try {
      content = await readFile(path, 'utf8')
    } catch {
      content = undefined
    }
    if (content !== undefined) {
      const marker = JSON.parse(content) as AcceptanceMarker
      if (marker.error !== undefined) throw new Error(`tui-acceptance-driver failed: ${marker.error}`)
      return marker
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for the acceptance marker at ${path}`)
    await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
  }
}

/**
 * Await one promise with an independent deadline.
 * @param promise - the operation to await.
 * @param timeoutMs - maximum wait.
 * @param subject - diagnostic name.
 * @returns the operation's value.
 */
async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, subject: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(`${subject} did not settle within ${String(timeoutMs)}ms`)) }, timeoutMs)
        timer.unref()
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Convert the launcher environment into the string map a PTY child accepts.
 * @param env - resolved launcher environment.
 * @returns the defined entries only.
 */
function childEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const defined: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) defined[name] = value
  }
  return defined
}

describe('dsh --profile tui under a PTY', () => {
  it('runs a turn, answers a question and an approval, and restores the terminal on /exit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-acceptance-'))
    temporaryRoots.push(root)
    const workdir = join(root, 'work')
    await mkdir(workdir)
    const markerPath = join(root, MARKER_FILE)
    const readyPath = join(root, READY_FILE)
    const launch = resolveExampleLaunch({
      srcBin: sourceBin,
      tsconfigPath,
      configArgs: ['--profile', 'tui', '--patch', overlayPath],
      env: {
        DSH_HOME: join(root, 'home'),
        DSH_AGENTS_HOME: join(root, 'agents'),
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
        DSH_TUI_ACCEPTANCE_MARKER: markerPath,
        DSH_TUI_ACCEPTANCE_READY: readyPath,
      },
    })
    const options: PtyProcessOptions = {
      file: launch.command,
      args: launch.args,
      cwd: workdir,
      columns: 120,
      rows: 40,
      scrollback: 0,
      env: childEnvironment(launch.env),
    }
    const child = PtyProcess.start(options)
    children.push(child)
    // The banner proves the renderer started, which is also when the terminal
    // registered the question and approval answerers the driver asks.
    await waitForText(child, 'DEEPSEEK HARNESS', PROCESS_TIMEOUT_MS)
    await writeFile(readyPath, 'interactive\n')
    await waitForText(child, 'Synthetic acceptance prompt')
    await waitForText(child, 'Synthetic assistant reply.')
    await waitForText(child, 'Tool / tui-acceptance')
    await waitForText(child, 'Proceed?')
    // Down moves from "Yes" to "No", Enter submits the single-select question.
    child.write('\u001b[B')
    child.write('\r')
    await waitForText(child, 'Approval required')
    child.write('a')
    const marker = await waitForMarker(markerPath, HANDSHAKE_TIMEOUT_MS)
    expect(marker.question).toEqual({ answers: [{ id: 'q1', selected: ['No'] }] })
    expect(marker.approval).toBe('allowed-once')
    await waitForText(child, 'Closing acceptance reply.')
    child.write('/exit')
    child.write('\r')
    const exit = await withDeadline(child.exited, HANDSHAKE_TIMEOUT_MS, 'dsh tui /exit')
    expect(exit.code).toBe(0)
    // The renderer leaves the alternate screen before the process exits.
    await child.settle()
    expect(child.screen().buffer).toBe('normal')
  }, PROCESS_TIMEOUT_MS + 30_000)
})

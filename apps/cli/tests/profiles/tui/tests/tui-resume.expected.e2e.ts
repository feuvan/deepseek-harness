/**
 * Assembled PTY acceptance for `/sessions` and `/resume`: a stored Session
 * created by the test-only driver appears in the chooser, and choosing it
 * replaces the process with the same profile presenting that Session.
 */

import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { afterEach, describe, expect, it } from 'vitest'
import { PtyProcess, type PtyProcessOptions } from '../../../../../../packages/test-support/terminal-snapshot/src/index.ts'

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const sourceBin = join(repoRoot, 'apps/cli/src/bin.ts')
const tsconfigPath = join(repoRoot, 'tsconfig.json')
const overlayPath = fileURLToPath(new URL('./fixtures/tui-resume.patch.yml', import.meta.url))

/** How long one screen condition or the whole scenario may take. */
const PROCESS_TIMEOUT_MS = 120_000
const HANDSHAKE_TIMEOUT_MS = 60_000

const temporaryRoots: string[] = []
const children: PtyProcess[] = []

afterEach(async () => {
  for (const child of children.splice(0)) child.dispose()
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/**
 * Await one screen condition and fail with the last screen instead of hanging.
 * @param child - the PTY process under test.
 * @param text - required visible substring.
 * @param timeoutMs - maximum wait.
 */
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
 * Wait until the driver's marker file exists.
 * @param child - the PTY process under test, used for failure diagnostics.
 * @param path - marker path.
 * @param timeoutMs - maximum wait.
 */
async function waitForMarker(child: PtyProcess, path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await access(path)
      return
    } catch (error: unknown) {
      // ENOENT is the expected wait; the deadline reports a driver that never wrote it.
      void error
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for ${path}; last screen:\n${child.screen().lines.join('\n')}`)
      }
      await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
    }
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

describe('dsh --profile tui /sessions', () => {
  it('lists a stored Session and resumes it by replacing the process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-resume-'))
    temporaryRoots.push(root)
    const workdir = join(root, 'work')
    await mkdir(workdir)
    const seededPath = join(root, 'seeded')
    const resumedPath = join(root, 'resumed')
    const launch = resolveExampleLaunch({
      srcBin: sourceBin,
      tsconfigPath,
      configArgs: ['--profile', 'tui', '--patch', overlayPath],
      env: {
        DSH_HOME: join(root, 'home'),
        DSH_AGENTS_HOME: join(root, 'agents'),
        DSH_TELEMETRY_DISABLED: '1',
        NO_COLOR: '1',
        DEEPSEEK_API_KEY: 'acceptance-key',
        DSH_TUI_RESUME_SEEDED: seededPath,
        DSH_TUI_RESUME_RESUMED: resumedPath,
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

    await waitForText(child, 'DEEPSEEK HARNESS', PROCESS_TIMEOUT_MS)
    await waitForMarker(child, seededPath, HANDSHAKE_TIMEOUT_MS)
    child.write('/sessions')
    child.write('\r')
    await waitForText(child, 'session-resume-target')
    child.write('\r')
    await waitForText(child, 'Resume target prompt', PROCESS_TIMEOUT_MS)
    await waitForMarker(child, resumedPath, HANDSHAKE_TIMEOUT_MS)

    child.write('/exit')
    child.write('\r')
    const exit = await child.exited
    expect(exit.code).toBe(0)
    await child.settle()
    expect(child.screen().buffer).toBe('normal')
  }, PROCESS_TIMEOUT_MS + 30_000)
})

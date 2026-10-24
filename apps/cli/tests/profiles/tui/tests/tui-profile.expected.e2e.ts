/**
 * Shipped `dsh tui` profile acceptance through the public CLI entry: the app's
 * own help, and the refusal of a non-interactive launch before any screen takeover.
 *
 * These assertions stay behavioral instead of pinning the help text to an
 * owner-local `expected/` file: `docs/cli-help.md` is the generated, gated copy
 * of the same help output (`verify-cli-help`), so a second verbatim copy here
 * would be a hand-maintained catalog of a generated artifact.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const sourceBin = join(repoRoot, 'apps/cli/src/bin.ts')
const tsconfigPath = join(repoRoot, 'tsconfig.json')
const processTimeoutMs = 90_000

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** One completed CLI process. */
interface TuiLaunch {
  /** Complete standard output. */
  readonly stdout: string
  /** Complete standard error. */
  readonly stderr: string
  /** Exit code, or `null` when a signal ended the process. */
  readonly exitCode: number | null
}

/**
 * Start the public CLI against an isolated Harness home with no controlling TTY.
 * @param args - complete argv after the launcher's bin path.
 * @returns the completed process's streams and exit code.
 * @throws when the process outlives its own deadline, with both streams attached.
 */
async function launchTuiProfile(args: readonly string[]): Promise<TuiLaunch> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tui-profile-'))
  temporaryRoots.push(root)
  const launch = resolveExampleLaunch({
    srcBin: sourceBin,
    tsconfigPath,
    configArgs: args,
    env: {
      DSH_HOME: join(root, 'home'),
      DSH_AGENTS_HOME: join(root, 'agents'),
      DSH_TELEMETRY_DISABLED: '1',
      NO_COLOR: '1',
    },
  })
  const result = await execa(launch.command, launch.args, {
    cwd: root,
    env: launch.env,
    // An empty write followed by close: stdin is a pipe, never a TTY.
    input: '',
    timeout: processTimeoutMs,
    killSignal: 'SIGKILL',
    reject: false,
    stripFinalNewline: false,
  })
  if (result.timedOut) {
    throw new Error(
      `dsh ${args.join(' ')} did not exit within ${String(processTimeoutMs / 1000)}s. `
      + `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? null }
}

describe('dsh --profile tui', () => {
  it('prints the terminal app help to stdout and exits cleanly', async () => {
    const { stdout, stderr, exitCode } = await launchTuiProfile(['--profile', 'tui', '--help'])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Usage: dsh --profile tui [options]')
    expect(stdout).toContain('Run the DeepSeek Harness agent in a full-screen terminal interface.')
    expect(stdout).toContain('--resume <id>')
    expect(stdout).toContain('--preset <id>')
    expect(stdout).toContain('dsh tui --resume <session>')
    expect(stdout).toContain('dsh tui --preset ptc')
  }, processTimeoutMs + 15_000)

  it('fails a non-interactive launch with the terminal diagnostic before taking the screen', async () => {
    const { stdout, stderr, exitCode } = await launchTuiProfile(['--profile', 'tui'])
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain(
      'terminal-ui requires an interactive terminal: stdin and stdout must both be TTYs.',
    )
    expect(stderr).toContain('For non-interactive runs use `dsh --profile headless "<task>"`.')
    expect(stdout).not.toContain('\u001b[?1049h')
  }, processTimeoutMs + 15_000)
})

/** `PtyProcess`: real child processes observed through a PTY and a headless emulator. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLazyRequire } from '@deepseek-ai/dsh-lazy-require'
import { afterEach, describe, expect, it } from 'vitest'
import { PtyProcess, type PtyProcessOptions } from '../src/pty-driver.ts'

const requirePty = createLazyRequire<typeof import('node-pty')>('node-pty', import.meta.url)

/** Why this host cannot run PTY acceptance, or `undefined` when node-pty loads. */
function ptyLoadError(): string | undefined {
  try {
    requirePty()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return undefined
}

const ptyUnavailable = ptyLoadError()
// A host without a loadable node-pty cannot observe any PTY process, so the
// suite skips instead of failing every PTY contract (the skip reason is the
// module load error, surfaced by the loader itself).
const describePty = ptyUnavailable === undefined ? describe : describe.skip

const children: PtyProcess[] = []
const roots: string[] = []

afterEach(async () => {
  for (const child of children.splice(0)) child.dispose()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/**
 * Start one PTY child owned by this spec's teardown.
 * @param args - child arguments; omitted to exercise the empty argument list.
 * @param overrides - geometry, scrollback, and environment overrides.
 * @returns the running PTY process.
 */
async function startChild(
  args: readonly string[] | undefined,
  overrides: Partial<Pick<PtyProcessOptions, 'columns' | 'rows' | 'scrollback' | 'env'>> = {},
): Promise<PtyProcess> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pty-driver-'))
  roots.push(root)
  const child = PtyProcess.start({
    file: process.execPath,
    cwd: root,
    ...args === undefined ? {} : { args: [...args] },
    ...overrides,
  })
  children.push(child)
  return child
}

describePty('PtyProcess', () => {
  it('parses child output, waits for text, and reports the configured geometry', async () => {
    const child = await startChild(['-e', "process.stdout.write('pty-ready')"], { columns: 60, rows: 10 })
    const state = await child.waitForText('pty-ready', 5_000)
    expect(state.lines.join('\n')).toContain('pty-ready')
    expect(state.columns).toBe(60)
    expect(state.rows).toBe(10)
    expect((await child.exited).code).toBe(0)
  })

  it('defaults the geometry and the argument list when the caller omits them', async () => {
    const child = await startChild(undefined, { scrollback: 0 })
    const state = child.screen()
    expect(state.columns).toBe(100)
    expect(state.rows).toBe(30)
  })

  it('passes environment overrides to the child', async () => {
    const child = await startChild(
      ['-e', "process.stdout.write(process.env.DSH_PTY_DRIVER_TEST ?? 'missing')"],
      { env: { DSH_PTY_DRIVER_TEST: 'pty-env-ok' } },
    )
    await child.waitForText('pty-env-ok', 5_000)
  })

  it('writes input, resizes the pty and its emulator, and reads the full screen', async () => {
    const child = await startChild([
      '-e',
      "process.stdin.setEncoding('utf8'); process.stdin.once('data', data => { process.stdout.write('got:' + data.trim()); process.exit(0) })",
    ], { columns: 40, rows: 8 })
    child.resize(50, 10)
    expect(child.screen().columns).toBe(50)
    expect(child.screen().rows).toBe(10)
    child.write('ping\r')
    await child.waitForText('got:ping', 5_000)
    expect(child.screen({ full: true }).lines.join('\n')).toContain('got:ping')
  })

  it('reports the child exit status and tolerates repeated disposal', async () => {
    const child = await startChild(['-e', 'process.exitCode = 3'])
    expect(await child.exited).toEqual({ code: 3, signal: 0 })
    child.dispose()
    expect(() => { child.dispose() }).not.toThrow()
  })

  it('rejects a screen wait whose deadline passes before the condition matches', async () => {
    const child = await startChild(['-e', 'setTimeout(() => {}, 5000)'])
    await expect(child.waitFor(() => false, 100)).rejects.toThrow(/timed out waiting for screen condition/u)
  })

  it('rejects with the last screen when the child exits without the expected text', async () => {
    const child = await startChild(['-e', "process.stdout.write('bye')"])
    await child.exited
    await expect(child.waitForText('never', 5_000)).rejects.toThrow(/timed out waiting for screen condition[\s\S]*bye/u)
  })

  it('re-checks the settled screen once the child has exited', async () => {
    const child = await startChild(['-e', "process.stdout.write('late')"])
    await child.exited
    let checks = 0
    const state = await child.waitFor(() => {
      checks += 1
      return checks === 2
    }, 5_000)
    expect(checks).toBe(2)
    expect(state.lines.join('\n')).toContain('late')
  })

  it('settles pending parses', async () => {
    const child = await startChild(['-e', "process.stdout.write('settled')"])
    await child.exited
    await expect(child.settle()).resolves.toBeUndefined()
    expect(child.screen().lines.join('\n')).toContain('settled')
  })
})

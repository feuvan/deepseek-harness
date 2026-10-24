/** The TUI app's command-line provider: fresh identity, exact resume, help, and the launcher contract. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import {
  apply,
  inject,
  name,
  TUI_STARTUP_SERVICE,
  type TuiStartupValues,
} from '../src/startup.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/** One provider invocation's captured process effects. */
interface StartupRun {
  /** @returns the published identity, or undefined when the action did not publish one. */
  readonly published: () => TuiStartupValues | undefined
  /** @returns everything commander wrote to stdout. */
  readonly out: () => string
  /** @returns everything commander wrote to stderr. */
  readonly err: () => string
  /** Exit codes the launcher requested. */
  readonly exits: readonly number[]
}

/**
 * Mount the provider on a fresh Context with captured commander output and exits.
 * @param args - the invocation's inner arguments.
 * @returns the published identity, captured output, and requested exits.
 */
function runStartup(args: readonly string[]): StartupRun {
  let out = ''
  let err = ''
  internals.stdout = { write: (chunk: string) => { out += chunk; return true } }
  internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
  const ctx = new Context()
  contexts.push(ctx)
  const exits: number[] = []
  provideCmdline(ctx, { args: [...args], exit: code => void exits.push(code) })
  apply(ctx)
  return {
    published: () => ctx.get(TUI_STARTUP_SERVICE),
    out: () => out,
    err: () => err,
    exits,
  }
}

describe('tui-startup', () => {
  it('keeps the plugin identity the profile patch wires', () => {
    expect(name).toBe('tui-startup')
    expect(inject).toEqual(['cmdlineArgs'])
    expect(TUI_STARTUP_SERVICE).toBe('tuiStartup')
  })

  it('fails loud without the launcher command line and exit request', () => {
    expect(() => { apply(new Context()) }).toThrow(
      'dsh --profile tui: the launcher must provide ctx.cmdlineArgs and ctx.appExit before the tree mounts',
    )
  })

  it('mints a fresh session-<uuid> identity when no argument names a persisted Session', () => {
    const run = runStartup([])
    const published = run.published()
    expect(Object.keys(published ?? {})).toEqual(['sessionId', 'resumeSessionId', 'preset'])
    expect(published?.resumeSessionId).toBeUndefined()
    expect(published?.preset).toBeUndefined()
    expect(published?.sessionId).toMatch(
      /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    )
    expect(run.exits).toEqual([])
    expect(run.out()).toBe('')
    expect(run.err()).toBe('')
  })

  it('publishes an explicit --preset for a fresh Session', () => {
    const run = runStartup(['--preset', 'ptc'])
    const published = run.published()
    expect(published?.preset).toBe('ptc')
    expect(published?.resumeSessionId).toBeUndefined()
    expect(run.exits).toEqual([])
    expect(run.err()).toBe('')
  })

  it('rejects a whitespace-only preset id through the launcher exit request', () => {
    const run = runStartup(['--preset', '   '])
    expect(run.published()).toBeUndefined()
    expect(run.err()).toContain('error: --preset requires a non-empty agent preset id')
    expect(run.exits).toEqual([1])
  })

  it('rejects a preset flag without a value', () => {
    const run = runStartup(['--preset'])
    expect(run.published()).toBeUndefined()
    expect(run.err()).toContain("option '--preset <id>' argument missing")
    expect(run.exits).toEqual([1])
  })

  it('mints a distinct identity for each fresh launch', () => {
    expect(runStartup([]).published()?.sessionId).not.toBe(runStartup([]).published()?.sessionId)
  })

  it('publishes the exact resumed identity in both fields', () => {
    const run = runStartup(['--resume', 'session-exact'])
    expect(run.published()).toEqual({ sessionId: 'session-exact', resumeSessionId: 'session-exact' })
    expect(run.exits).toEqual([])
    expect(run.err()).toBe('')
  })

  it('rejects a whitespace-only resume id through the launcher exit request', () => {
    const run = runStartup(['--resume', '   '])
    expect(run.published()).toBeUndefined()
    expect(run.err()).toContain('error: --resume requires a non-empty session id')
    expect(run.exits).toEqual([1])
  })

  it('rejects a resume flag without a value', () => {
    const run = runStartup(['--resume'])
    expect(run.published()).toBeUndefined()
    expect(run.err()).toContain("option '--resume <id>' argument missing")
    expect(run.exits).toEqual([1])
  })

  it('prints its own help and exits cleanly without publishing', () => {
    const run = runStartup(['--help'])
    expect(run.published()).toBeUndefined()
    expect(run.out()).toContain('Usage: dsh --profile tui [options]')
    expect(run.out()).toContain('Run the DeepSeek Harness agent in a full-screen terminal interface.')
    expect(run.out()).toContain('--resume <id>')
    expect(run.out()).toContain('--preset <id>')
    expect(run.out()).toContain('dsh tui --resume <session>')
    expect(run.out()).toContain('dsh tui --preset ptc')
    expect(run.err()).toBe('')
    expect(run.exits).toEqual([0])
  })
})

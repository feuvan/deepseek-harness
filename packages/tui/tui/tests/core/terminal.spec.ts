import { describe, expect, it, vi } from 'vitest'
import { ProcessTerminal } from '@earendil-works/pi-tui'
import { assertInteractiveTerminal, createTerminalSession } from '../../src/terminal.ts'
import { headlessSession } from './harness.ts'

describe('assertInteractiveTerminal', () => {
  it('accepts two interactive streams', () => {
    expect(() => { assertInteractiveTerminal(true, true) }).not.toThrow()
  })

  it.each([
    ['stdin', false, true],
    ['stdout', true, false],
    ['both streams', false, false],
  ] as const)('rejects a non-interactive %s and names the headless alternative', (_label, stdinIsTty, stdoutIsTty) => {
    expect(() => { assertInteractiveTerminal(stdinIsTty, stdoutIsTty) })
      .toThrow(/requires an interactive terminal.*dsh --profile headless/u)
  })
})

describe('createTerminalSession', () => {
  it('wraps the supplied terminal in an alternate-screen renderer', async () => {
    const { headless, session } = headlessSession()

    expect(session.terminal).toBe(headless)
    expect(session.tui.terminal).toBe(headless)
    expect(session.tui.mode).toBe('fullscreen')
    session.stop()
    await headless.settle()
  })

  it('stops the renderer only once', async () => {
    const { headless, session } = headlessSession()
    const stop = vi.spyOn(session.tui, 'stop')

    session.stop()
    session.stop()

    expect(stop).toHaveBeenCalledOnce()
    await headless.settle()
  })

  it('defaults to the process terminal without starting it', () => {
    const session = createTerminalSession()

    expect(session.terminal).toBeInstanceOf(ProcessTerminal)
    expect(session.tui.terminal).toBe(session.terminal)
  })
})

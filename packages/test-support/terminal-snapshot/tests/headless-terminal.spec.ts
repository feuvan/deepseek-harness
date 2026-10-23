/** `HeadlessTerminal`: the pi-tui rendering surface over a parsed headless emulator. */

import type { ProgramStatus } from '@earendil-works/pi-tui'
import { afterEach, describe, expect, it } from 'vitest'
import * as harness from '../src/index.ts'
import { HeadlessTerminal, type HeadlessTerminalOptions } from '../src/index.ts'

const terminals: HeadlessTerminal[] = []

/** Create one terminal owned by this spec's teardown. */
function createTerminal(options?: HeadlessTerminalOptions): HeadlessTerminal {
  const terminal = new HeadlessTerminal(options)
  terminals.push(terminal)
  return terminal
}

afterEach(() => {
  for (const terminal of terminals.splice(0)) terminal.dispose()
})

describe('HeadlessTerminal', () => {
  it('defaults to an 80x24 screen with no reported metadata', () => {
    const terminal = createTerminal()
    expect(terminal.columns).toBe(80)
    expect(terminal.rows).toBe(24)
    expect(terminal.kittyProtocolActive).toBe(false)
    expect(terminal.writes).toBe(0)
    expect(terminal.title).toBe('')
    expect(terminal.progress).toBe(false)
    expect(terminal.programStatus).toBeUndefined()
    const state = terminal.state()
    expect(state.lines).toHaveLength(24)
    expect(state.lines.every(line => line === '')).toBe(true)
    expect(state.cursor).toEqual({ x: 0, y: 0 })
    expect(state.styles).toEqual([])
  })

  it('reports configured geometry and resizes the emulator with one handler notification', () => {
    const terminal = createTerminal({ columns: 20, rows: 5, scrollback: 3 })
    expect([terminal.columns, terminal.rows]).toEqual([20, 5])
    const notifications: number[] = []
    terminal.start(() => {}, () => { notifications.push(terminal.columns) })
    terminal.resize(30, 6)
    expect([terminal.columns, terminal.rows]).toEqual([30, 6])
    expect(notifications).toEqual([30])
    terminal.stop()
    // A resize after stop has no handler to notify.
    terminal.resize(10, 2)
    expect([terminal.columns, terminal.rows]).toEqual([10, 2])
    expect(notifications).toEqual([30])
  })

  it('forwards pressed input to every attached listener until stop', () => {
    const terminal = createTerminal()
    const first: string[] = []
    const second: string[] = []
    terminal.start((data) => { first.push(data) }, () => {})
    terminal.start((data) => { second.push(data) }, () => {})
    terminal.press('\u001b[A')
    expect(first).toEqual(['\u001b[A'])
    expect(second).toEqual(['\u001b[A'])
    terminal.stop()
    terminal.press('x')
    expect(first).toEqual(['\u001b[A'])
    expect(second).toEqual(['\u001b[A'])
    // A terminal that never started has no listeners either.
    const detached = createTerminal()
    detached.press('y')
    expect(detached.writes).toBe(0)
  })

  it('parses every accepted write and counts the frames', async () => {
    const terminal = createTerminal({ columns: 20, rows: 2 })
    terminal.write('hello')
    terminal.write(' world')
    expect(terminal.writes).toBe(2)
    await terminal.settle()
    expect(terminal.state().lines).toEqual(['hello world', ''])
    expect(terminal.state().cursor).toEqual({ x: 11, y: 0 })
  })

  it('records the title, progress, and program status the application reports', () => {
    const terminal = createTerminal({ columns: 20, rows: 3 })
    terminal.setTitle('deepseek harness')
    terminal.setProgress(true)
    expect(terminal.title).toBe('deepseek harness')
    expect(terminal.progress).toBe(true)
    const beforeStatus = terminal.state()
    expect(beforeStatus.title).toBe('deepseek harness')
    expect(beforeStatus.progress).toBe(true)
    expect(beforeStatus.programStatus).toBeUndefined()
    expect('programStatus' in beforeStatus).toBe(false)

    const status: ProgramStatus = { state: 'working', app: 'dsh', message: 'thinking' }
    terminal.setProgramStatus(status)
    expect(terminal.programStatus).toBe(status)
    expect(terminal.state().programStatus).toBe('working')

    terminal.setProgress(false)
    expect(terminal.state().progress).toBe(false)
  })

  it('projects the full retained buffer on request', async () => {
    const terminal = createTerminal({ columns: 10, rows: 2, scrollback: 5 })
    for (let index = 0; index < 6; index += 1) terminal.write(`line${String(index)}\r\n`)
    await terminal.settle()
    const viewport = terminal.state()
    const full = terminal.state({ full: true })
    expect(viewport.lines).toHaveLength(2)
    expect(viewport.lines).toEqual(['line5', ''])
    expect(full.lines).toEqual(['line0', 'line1', 'line2', 'line3', 'line4', 'line5', ''])
    expect(full.lines.length).toBeGreaterThan(viewport.lines.length)
  })

  it('emits relative cursor movement and ignores a zero-line move', async () => {
    const terminal = createTerminal({ columns: 10, rows: 4 })
    terminal.write('top')
    await terminal.settle()
    terminal.moveBy(2)
    expect(terminal.writes).toBe(2)
    await terminal.settle()
    expect(terminal.state().cursor).toEqual({ x: 3, y: 2 })
    terminal.moveBy(-1)
    terminal.moveBy(0)
    expect(terminal.writes).toBe(3)
    await terminal.settle()
    expect(terminal.state().cursor).toEqual({ x: 3, y: 1 })
  })

  it('emits the hide, show, clear, and exit-restore sequences', async () => {
    const terminal = createTerminal({ columns: 10, rows: 3 })
    terminal.write('alpha')
    await terminal.settle()
    terminal.write('\u001b[2D')
    await terminal.settle()
    expect(terminal.state().cursor).toEqual({ x: 3, y: 0 })
    terminal.clearFromCursor()
    await terminal.settle()
    expect(terminal.state().lines).toEqual(['alp', '', ''])
    terminal.clearLine()
    await terminal.settle()
    expect(terminal.state().lines).toEqual(['', '', ''])
    terminal.write('x')
    await terminal.settle()
    terminal.hideCursor()
    terminal.showCursor()
    terminal.clearScreen()
    await terminal.settle()
    expect(terminal.state().lines).toEqual(['', '', ''])
    expect(terminal.state().cursor).toEqual({ x: 0, y: 0 })
    terminal.write('z')
    await terminal.settle()
    terminal.restoreOnExit('\u001b[?25h', '\u001b[2J\u001b[H')
    await terminal.settle()
    expect(terminal.state().lines).toEqual(['', '', ''])
  })

  it('drains pending input to parser quiescence', async () => {
    const terminal = createTerminal({ columns: 10, rows: 2 })
    terminal.write('done')
    await expect(terminal.drainInput()).resolves.toBeUndefined()
    expect(terminal.state().lines[0]).toBe('done')
  })

  it('is exported from the package entry beside the projection and PTY helpers', () => {
    expect(Object.keys(harness).sort()).toEqual([
      'HeadlessTerminal',
      'PtyProcess',
      'formatTerminalState',
      'projectTerminalState',
      'terminalStyleViolations',
    ])
  })
})

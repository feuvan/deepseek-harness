/** `projectTerminalState`: buffer window, cursor, row text, style runs, and reports. */

import { createLazyRequire } from '@deepseek-ai/dsh-lazy-require'
import type { Terminal as Emulator } from '@xterm/headless'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatTerminalState,
  projectTerminalState,
  terminalStyleViolations,
  type TerminalState,
} from '../src/project.ts'

const requireHeadless = createLazyRequire<typeof import('@xterm/headless')>('@xterm/headless', import.meta.url)
const emulators: Emulator[] = []

/** Create one emulator with explicit geometry, owned by this spec's teardown. */
function createEmulator(options: { columns?: number; rows?: number; scrollback?: number } = {}): Emulator {
  const { Terminal } = requireHeadless()
  const emulator = new Terminal({
    cols: options.columns ?? 20,
    rows: options.rows ?? 3,
    scrollback: options.scrollback ?? 0,
    allowProposedApi: true,
  })
  emulators.push(emulator)
  return emulator
}

/** Feed one frame and wait for the parser to apply it. */
function parse(emulator: Emulator, data: string): Promise<void> {
  return new Promise<void>((resolve) => { emulator.write(data, () => { resolve() }) })
}

afterEach(() => {
  for (const emulator of emulators.splice(0)) emulator.dispose()
})

describe('projectTerminalState', () => {
  it('projects the viewport with geometry, buffer kind, cursor, and right-trimmed rows', async () => {
    const emulator = createEmulator({ columns: 20, rows: 4 })
    await parse(emulator, 'hello\r\nworld')
    const state = projectTerminalState(emulator)
    expect(state).toEqual({
      columns: 20,
      rows: 4,
      buffer: 'normal',
      cursor: { x: 5, y: 1 },
      lines: ['hello', 'world', '', ''],
      styles: [],
    })
  })

  it('projects the alternate screen after the application takes it over', async () => {
    const emulator = createEmulator({ columns: 10, rows: 3 })
    await parse(emulator, '\u001b[?1049halt')
    const state = projectTerminalState(emulator)
    expect(state.buffer).toBe('alternate')
    expect(state.lines).toEqual(['alt', '', ''])
  })

  it('selects the viewport by default and every retained row with full', async () => {
    const emulator = createEmulator({ columns: 10, rows: 3, scrollback: 10 })
    const rows = Array.from({ length: 20 }, (_, index) => `L${String(index)}`)
    await parse(emulator, rows.join('\r\n'))
    const viewport = projectTerminalState(emulator)
    expect(viewport.lines).toEqual(['L17', 'L18', 'L19'])
    expect(projectTerminalState(emulator, { full: false }).lines).toEqual(viewport.lines)
    const full = projectTerminalState(emulator, { full: true })
    expect(full.lines).toEqual(rows.slice(7))
    expect(full.lines).toHaveLength(13)
  })

  it('keeps a wrapped logical line as the buffer rows it occupies', async () => {
    const emulator = createEmulator({ columns: 5, rows: 3 })
    await parse(emulator, 'abcdefghij')
    const state = projectTerminalState(emulator)
    expect(state.lines).toEqual(['abcde', 'fghij', ''])
  })

  it('describes one non-default style run per attribute and color kind', async () => {
    const emulator = createEmulator({ columns: 40, rows: 2 })
    await parse(emulator, [
      '\u001b[1;2;3;4;5;7;8;9mA\u001b[0m',
      '\u001b[31mB\u001b[0m',
      '\u001b[38;5;196mC\u001b[0m',
      '\u001b[38;2;1;2;3mD\u001b[0m',
      '\u001b[42mE\u001b[0m',
      '\u001b[48;2;9;8;7mF\u001b[0m',
    ].join(' '))
    const state = projectTerminalState(emulator)
    expect(state.lines[0]).toBe('A B C D E F')
    expect(state.styles).toEqual([
      { row: 0, start: 0, end: 0, style: 'bold,dim,italic,underline,inverse,strike,blink,invisible' },
      { row: 0, start: 2, end: 2, style: 'fg:palette:1' },
      { row: 0, start: 4, end: 4, style: 'fg:palette:196' },
      { row: 0, start: 6, end: 6, style: 'fg:rgb:66051' },
      { row: 0, start: 8, end: 8, style: 'bg:palette:2' },
      { row: 0, start: 10, end: 10, style: 'bg:rgb:591879' },
    ])
  })

  it('splits adjacent runs and closes a run that reaches the last column', async () => {
    const emulator = createEmulator({ columns: 4, rows: 2 })
    await parse(emulator, '\u001b[1mAB\u001b[4mCD')
    const state = projectTerminalState(emulator)
    expect(state.lines[0]).toBe('ABCD')
    expect(state.styles).toEqual([
      { row: 0, start: 0, end: 1, style: 'bold' },
      { row: 0, start: 2, end: 3, style: 'bold,underline' },
    ])
  })
})

describe('formatTerminalState', () => {
  const base: TerminalState = {
    columns: 12,
    rows: 2,
    buffer: 'normal',
    cursor: { x: 3, y: 1 },
    lines: ['abc', ''],
    styles: [],
  }

  it('prints geometry, cursor, and numbered rows without optional metadata', () => {
    expect(formatTerminalState(base)).toBe([
      'size 12x2',
      'buffer normal',
      'cursor 3,1',
      'lines:',
      '  0|abc',
      '  1|',
      '',
    ].join('\n'))
  })

  it('prints application metadata and style runs when the projection carries them', () => {
    expect(formatTerminalState({
      ...base,
      buffer: 'alternate',
      title: 'deepseek',
      progress: true,
      programStatus: 'working',
      styles: [{ row: 1, start: 0, end: 3, style: 'bold,fg:palette:2' }],
    })).toBe([
      'size 12x2',
      'buffer alternate',
      'cursor 3,1',
      'title "deepseek"',
      'progress on',
      'programStatus working',
      'lines:',
      '  0|abc',
      '  1|',
      'styles:',
      '    1 [0-3] bold,fg:palette:2',
      '',
    ].join('\n'))
  })

  it('prints an inactive progress indicator as off', () => {
    expect(formatTerminalState({ ...base, progress: false })).toContain('progress off\n')
  })
})

describe('terminalStyleViolations', () => {
  it('reports explicit backgrounds, truecolor, and palette entries beyond the standard 16', () => {
    const state: TerminalState = {
      columns: 10,
      rows: 3,
      buffer: 'normal',
      cursor: { x: 0, y: 0 },
      lines: [],
      styles: [
        { row: 0, start: 0, end: 0, style: 'bg:palette:2' },
        { row: 0, start: 1, end: 1, style: 'fg:rgb:66051' },
        { row: 0, start: 2, end: 2, style: 'bg:rgb:591879' },
        { row: 1, start: 0, end: 0, style: 'bold,fg:palette:16' },
        { row: 2, start: 0, end: 0, style: 'fg:palette:15' },
        { row: 2, start: 1, end: 1, style: 'underline' },
      ],
    }
    expect(terminalStyleViolations(state)).toEqual([
      'row 0: explicit background bg:palette:2',
      'row 0: truecolor fg:rgb:66051',
      'row 0: explicit background bg:rgb:591879',
      'row 0: truecolor bg:rgb:591879',
      'row 1: palette entry fg:palette:16',
    ])
  })

  it('flags emulator-applied RGB and high-palette styles through the projection', async () => {
    const emulator = createEmulator({ columns: 10, rows: 2 })
    await parse(emulator, '\u001b[38;5;200mX\u001b[0m\u001b[48;2;1;2;3mY')
    const state = projectTerminalState(emulator)
    expect(state.styles).toEqual([
      { row: 0, start: 0, end: 0, style: 'fg:palette:200' },
      { row: 0, start: 1, end: 1, style: 'bg:rgb:66051' },
    ])
    expect(terminalStyleViolations(state)).toEqual([
      'row 0: palette entry fg:palette:200',
      'row 0: explicit background bg:rgb:66051',
      'row 0: truecolor bg:rgb:66051',
    ])
  })

  it('accepts a projection that uses only the default style and standard palette entries', async () => {
    const emulator = createEmulator({ columns: 10, rows: 2 })
    await parse(emulator, '\u001b[1mbold\u001b[0m \u001b[31mred\u001b[0m')
    expect(terminalStyleViolations(projectTerminalState(emulator))).toEqual([])
  })
})

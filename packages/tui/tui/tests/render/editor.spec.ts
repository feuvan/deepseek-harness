import { afterEach, describe, expect, it } from 'vitest'
import { CURSOR_MARKER, visibleWidth } from '@earendil-works/pi-tui'
import { PromptEditor } from '../../src/components/editor.ts'
import { createPalette } from '../../src/palette.ts'
import { testTerminal } from '../support/terminal.ts'
import type { TerminalSession } from '../../src/terminal.ts'

/** Terminals opened by the suite, stopped after each test. */
const sessions: TerminalSession[] = []

afterEach(() => {
  for (const session of sessions.splice(0)) session.stop()
})

/** Options for a composer whose terminal and copy the test controls. */
interface EditorOptions {
  readonly prompt?: string
  readonly hint?: string
}

/** @returns a composer over a fresh headless terminal. */
function editor(options: EditorOptions = {}): PromptEditor {
  const { session } = testTerminal({ columns: 100, rows: 20 })
  sessions.push(session)
  const palette = createPalette(false)
  return new PromptEditor(
    session.tui,
    {
      borderColor: text => palette.border(text),
      selectList: {
        selectedPrefix: text => text,
        selectedText: text => text,
        description: text => text,
        scrollInfo: text => text,
        noMatch: text => text,
      },
    },
    { prompt: options.prompt ?? 'dsh> ', hint: options.hint ?? 'Type a message.' },
  )
}

describe('PromptEditor', () => {
  it('replaces the shared editor top border with the prompt merged into the first content line', () => {
    const component = editor()
    const lines = component.render(80)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('dsh> Type a message.')
    expect(lines[1]?.startsWith('─')).toBe(true)
  })

  it('shows the hint while the editor is empty and unfocused', () => {
    expect(editor({ hint: 'Say something.' }).render(80)[0]).toBe('dsh> Say something.')
  })

  it('shows the hint supplied by setHint', () => {
    const component = editor({ hint: 'first hint' })
    component.setHint('second hint')
    expect(component.render(80)[0]).toBe('dsh> second hint')
  })

  it('omits the cursor marker while unfocused and empty', () => {
    const first = editor({ hint: 'visible hint' }).render(80)[0] ?? ''
    expect(first).toBe('dsh> visible hint')
    expect(first).not.toContain(CURSOR_MARKER)
  })

  it('shows the hint while focused and empty', () => {
    const component = editor({ hint: 'visible hint' })
    component.focused = true
    const first = component.render(80)[0] ?? ''
    expect(first).toContain('visible hint')
    expect(first).toContain(CURSOR_MARKER)
  })

  it('shows the typed text through getText and setText', () => {
    const component = editor()
    component.setText('hello world')
    expect(component.getText()).toBe('hello world')
    const first = component.render(80)[0] ?? ''
    expect(first).toContain('hello world')
    expect(first).not.toContain('Type a message.')
  })

  it('keeps the typed text when focused', () => {
    const component = editor()
    component.focused = true
    component.setText('steer this')
    const first = component.render(80)[0] ?? ''
    expect(first).toContain('steer this')
    expect(first).toContain(CURSOR_MARKER)
  })

  it('replaces the prompt marker with setPrompt', () => {
    const component = editor({ prompt: 'old> ' })
    component.setPrompt('new> ')
    expect(component.render(80)[0]).toBe('new> Type a message.')
  })

  it('accounts for the prompt display width when sizing the hint', () => {
    const component = editor({ prompt: '中文> ', hint: 'abcdefghij' })
    const first = component.render(20)[0] ?? ''
    expect(visibleWidth(first)).toBeLessThanOrEqual(20)
    expect(first.startsWith('中文> ')).toBe(true)
    expect(first).toBe('中文> abcdefghij')
  })

  it('truncates the hint and text to the width left of the prompt', () => {
    const hintEditor = editor({ prompt: 'dsh> ', hint: 'Type a message.' })
    const hintLine = hintEditor.render(10)[0] ?? ''
    expect(visibleWidth(hintLine)).toBeLessThanOrEqual(10)
    expect(hintLine.startsWith('dsh> ')).toBe(true)
    expect(hintLine).not.toBe('dsh> Type a message.')

    const textEditor = editor()
    textEditor.setText('a very long message that cannot fit')
    const textLine = textEditor.render(12)[0] ?? ''
    expect(visibleWidth(textLine)).toBeLessThanOrEqual(12)
  })

  it('truncates every line when the width still fits the prompt', () => {
    const component = editor()
    for (const width of [6, 7, 8]) {
      const lines = component.render(width)
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width)
    }
  })

  it('keeps rendering when the width is narrower than the prompt itself', () => {
    const component = editor()
    for (const width of [1, 2, 5]) {
      const lines = component.render(width)
      expect(lines.length).toBeGreaterThan(0)
      expect(lines[0]?.startsWith('dsh> ')).toBe(true)
    }
  })

  it('keeps the wrapped content lines and the bottom border for multi-line text', () => {
    const component = editor()
    component.setText('first line\nsecond line')
    const lines = component.render(40)
    expect(lines.length).toBe(3)
    expect(lines[0]).toContain('first line')
    expect(lines[1]).toContain('second line')
    expect(lines[2]?.startsWith('─')).toBe(true)
  })
})

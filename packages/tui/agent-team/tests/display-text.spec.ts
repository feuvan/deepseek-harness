import { describe, expect, it } from 'vitest'
import { displayInline, displayText } from '../src/display-text.ts'

describe('displayText', () => {
  it('escapes C0 and C1 controls while keeping line feeds', () => {
    expect(displayText('a\u0000b\u0007c\u001b[31md\nnext\u009b')).toBe('a\\x00b\\x07c\\x1b[31md\nnext\\x9b')
  })

  it('leaves ordinary text untouched', () => {
    expect(displayText('plain text')).toBe('plain text')
    expect(displayText('中文 🚀')).toBe('中文 🚀')
  })

  it('renders line feeds inline', () => {
    expect(displayInline('a\nb')).toBe('a\\nb')
  })
})

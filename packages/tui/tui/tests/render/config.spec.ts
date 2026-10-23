import { describe, expect, it } from 'vitest'
import { Config, resolveConfig } from '../../src/config.ts'
import { displayInline, displayText } from '../../src/display-text.ts'

describe('resolveConfig', () => {
  it('brands the session identity and keeps presentation values', () => {
    const resolved = resolveConfig({
      sessionId: 'session-test',
      color: false,
      animation: false,
      previewLines: 4,
      windowBlocks: 20,
      title: 'Test',
    })
    expect(resolved).toEqual({
      sessionId: 'session-test',
      color: false,
      animation: false,
      previewLines: 4,
      windowBlocks: 20,
      title: 'Test',
    })
    expect(Object.isFrozen(resolved)).toBe(true)
  })

  it('rejects a blank session identity', () => {
    expect(() => resolveConfig({
      sessionId: '   ',
      color: true,
      animation: true,
      previewLines: 4,
      windowBlocks: 20,
      title: 'Test',
    })).toThrow('sessionId must not be blank')
  })

  it('exposes schema defaults for every presentation field', () => {
    const parsed = Config({ sessionId: 'session-test' })
    expect(parsed).toEqual({
      sessionId: 'session-test',
      color: true,
      animation: true,
      previewLines: 10,
      windowBlocks: 200,
      title: 'DeepSeek Harness',
    })
  })
})

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

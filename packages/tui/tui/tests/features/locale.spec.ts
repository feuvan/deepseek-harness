import { describe, expect, it } from 'vitest'
import { detectLocale, parseLocale, resolveLocale } from '../../src/locale.ts'

describe('parseLocale', () => {
  it.each([
    ['en', 'en'],
    [' EN ', 'en'],
    ['zh', 'zh'],
    ['ZH', 'zh'],
    ['zh-CN', 'zh'],
    [' zh-TW ', 'zh'],
    ['zh-Hans-CN', 'zh'],
    ['zhx', 'zh'],
    ['fr', 'en'],
    ['fr_FR.UTF-8', 'en'],
    ['', 'en'],
    ['   ', 'en'],
    [undefined, 'en'],
  ] as const)('parses %j as %s', (raw, expected) => {
    expect(parseLocale(raw)).toBe(expected)
  })
})

describe('detectLocale', () => {
  it('selects the first non-empty environment candidate', () => {
    expect(detectLocale({ DSH_LOCALE: 'zh', LC_ALL: 'en_US.UTF-8' })).toBe('zh')
    expect(detectLocale({ LC_ALL: 'zh_CN.UTF-8', LC_MESSAGES: 'en_US.UTF-8' })).toBe('zh')
    expect(detectLocale({ LC_MESSAGES: 'zh_TW.UTF-8', LANG: 'en_US.UTF-8' })).toBe('zh')
    expect(detectLocale({ LANG: 'zh_SG.UTF-8' })).toBe('zh')
  })

  it('falls through empty and undefined candidates in order', () => {
    expect(detectLocale({ DSH_LOCALE: '  ', LC_ALL: '', LC_MESSAGES: 'zh_CN.UTF-8' })).toBe('zh')
    expect(detectLocale({ DSH_LOCALE: '', LANG: 'en_US.UTF-8' })).toBe('en')
    expect(detectLocale({ DSH_LOCALE: undefined, LC_ALL: undefined, LC_MESSAGES: undefined, LANG: undefined })).toBe('en')
    expect(detectLocale({})).toBe('en')
  })

  it('reads the process environment by default', () => {
    expect(detectLocale()).toBe(parseLocale(process.env['DSH_LOCALE'] ?? process.env['LC_ALL'] ?? process.env['LC_MESSAGES'] ?? process.env['LANG']))
  })
})

describe('resolveLocale', () => {
  it('returns an explicit configured locale without consulting the environment', () => {
    expect(resolveLocale('en', { DSH_LOCALE: 'zh' })).toBe('en')
    expect(resolveLocale('zh', { LANG: 'en_US.UTF-8' })).toBe('zh')
  })

  it('follows the environment for auto', () => {
    expect(resolveLocale('auto', { DSH_LOCALE: 'zh' })).toBe('zh')
    expect(resolveLocale('auto', { LANG: 'fr_FR.UTF-8' })).toBe('en')
  })

  it('reads the process environment for auto by default', () => {
    expect(resolveLocale('auto')).toBe(detectLocale())
  })
})

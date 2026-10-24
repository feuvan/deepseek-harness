import { afterEach, describe, expect, it } from 'vitest'
import { CARD_MODES, nextCardMode, parseCardMode, type CardMode } from '../../src/cards.ts'
import { copy, setCopyLocale } from '../../src/copy.ts'

afterEach(() => {
  setCopyLocale('en')
})

describe('CARD_MODES', () => {
  it('orders the modes from least to most detail', () => {
    expect(CARD_MODES).toEqual(['collapsed', 'expanded', 'hidden'])
  })
})

describe('parseCardMode', () => {
  it.each(CARD_MODES)('accepts the %s id', (mode) => {
    expect(parseCardMode(mode)).toBe(mode)
  })

  it('accepts ids case-insensitively and with surrounding whitespace', () => {
    expect(parseCardMode('  EXPANDED ')).toBe('expanded')
    expect(parseCardMode('Hidden')).toBe('hidden')
  })

  it('accepts the English localized names', () => {
    expect(parseCardMode(copy.cards.levels.collapsed)).toBe('collapsed')
    expect(parseCardMode(copy.cards.levels.expanded)).toBe('expanded')
    expect(parseCardMode(copy.cards.levels.hidden)).toBe('hidden')
  })

  it('accepts the Chinese localized names', () => {
    setCopyLocale('zh')
    expect(parseCardMode('折叠')).toBe('collapsed')
    expect(parseCardMode('展开')).toBe('expanded')
    expect(parseCardMode('隐藏')).toBe('hidden')
  })

  it.each([
    ['an empty string', ''],
    ['whitespace', '   '],
    ['an unknown id', 'compact'],
    ['a partial id', 'coll'],
  ])('returns undefined for %s', (_label, raw) => {
    expect(parseCardMode(raw)).toBeUndefined()
  })

  it('returns undefined without a raw value', () => {
    expect(parseCardMode(undefined)).toBeUndefined()
  })
})

describe('nextCardMode', () => {
  it('cycles collapsed to expanded to hidden and back', () => {
    expect(nextCardMode('collapsed')).toBe('expanded')
    expect(nextCardMode('expanded')).toBe('hidden')
    expect(nextCardMode('hidden')).toBe('collapsed')
  })

  it('reaches every mode before repeating', () => {
    const seen = new Set<CardMode>()
    let mode: CardMode = 'collapsed'
    for (let step = 0; step < CARD_MODES.length; step += 1) {
      seen.add(mode)
      mode = nextCardMode(mode)
    }
    expect(mode).toBe('collapsed')
    expect([...seen].sort()).toEqual([...CARD_MODES].sort())
  })
})

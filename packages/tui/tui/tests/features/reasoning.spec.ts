import { afterEach, describe, expect, it } from 'vitest'
import { chinese, copy, setCopyLocale } from '../../src/copy.ts'
import {
  REASONING_LEVELS, nextReasoningLevel, parseReasoningLevel, reasoningPreviewLines,
} from '../../src/reasoning.ts'

afterEach(() => {
  setCopyLocale('en')
})

describe('REASONING_LEVELS', () => {
  it('lists the four levels from least to most detail', () => {
    expect(REASONING_LEVELS).toEqual(['compact', 'standard', 'detailed', 'verbose'])
  })
})

describe('parseReasoningLevel', () => {
  it.each([
    ['compact', 'compact'],
    ['standard', 'standard'],
    ['detailed', 'detailed'],
    ['verbose', 'verbose'],
    ['  DETAILED ', 'detailed'],
    ['unknown', undefined],
    ['', undefined],
    ['   ', undefined],
    [undefined, undefined],
  ] as const)('parses %j as %s', (raw, expected) => {
    expect(parseReasoningLevel(raw)).toBe(expected)
  })

  it('parses the localized level names', () => {
    setCopyLocale('zh')

    expect(parseReasoningLevel('简洁')).toBe('compact')
    expect(parseReasoningLevel('标准')).toBe('standard')
    expect(parseReasoningLevel('详细')).toBe('detailed')
    expect(parseReasoningLevel('完全展开')).toBe('verbose')
    expect(parseReasoningLevel('standard')).toBe('standard')
    expect(parseReasoningLevel('未知')).toBeUndefined()
  })

  it('reads the active copy for localized names', () => {
    expect(parseReasoningLevel(copy.reasoning.levels.compact)).toBe('compact')
    setCopyLocale('zh')
    expect(parseReasoningLevel(copy.reasoning.levels.verbose)).toBe('verbose')
    expect(copy.reasoning.levels.verbose).toBe(chinese.reasoning.levels.verbose)
  })
})

describe('nextReasoningLevel', () => {
  it('advances through every level and wraps after verbose', () => {
    expect(nextReasoningLevel('compact')).toBe('standard')
    expect(nextReasoningLevel('standard')).toBe('detailed')
    expect(nextReasoningLevel('detailed')).toBe('verbose')
    expect(nextReasoningLevel('verbose')).toBe('compact')
  })
})

describe('reasoningPreviewLines', () => {
  it.each([
    ['compact', 1],
    ['standard', 4],
    ['detailed', 12],
    ['verbose', Number.POSITIVE_INFINITY],
  ] as const)('previews %s as %s lines', (level, expected) => {
    expect(reasoningPreviewLines(level)).toBe(expected)
  })
})

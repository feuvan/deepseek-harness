/**
 * Reasoning-visibility levels for the terminal transcript. The four levels
 * mirror the Desktop/Web work-details modes (`compact`, `standard`,
 * `detailed`, `verbose`) and control how much of each reasoning block the
 * transcript shows.
 *
 * @module @deepseek-ai/dsh-tui/reasoning
 */

import { copy } from './copy.ts'

/** Ordered reasoning-visibility levels, from least to most detail. */
export const REASONING_LEVELS = ['compact', 'standard', 'detailed', 'verbose'] as const

/** One reasoning-visibility level. */
export type ReasoningVisibility = typeof REASONING_LEVELS[number]

/** The cycle successor of each level. */
const NEXT_LEVEL: Readonly<Record<ReasoningVisibility, ReasoningVisibility>> = {
  compact: 'standard',
  standard: 'detailed',
  detailed: 'verbose',
  verbose: 'compact',
}

/** Reasoning lines each level previews; `verbose` shows the complete block. */
const PREVIEW_LINES: Readonly<Record<ReasoningVisibility, number>> = {
  compact: 1,
  standard: 4,
  detailed: 12,
  verbose: Number.POSITIVE_INFINITY,
}

/**
 * Read the reasoning level one raw configuration-like value names.
 * @param raw - a level id, or a localized level name.
 * @returns the matching level, or undefined for an unknown value.
 */
export function parseReasoningLevel(raw: string | undefined): ReasoningVisibility | undefined {
  const value = raw?.trim().toLowerCase()
  if (value === undefined || value === '') return undefined
  for (const level of REASONING_LEVELS) {
    if (level === value) return level
    if (copy.reasoning.levels[level].toLowerCase() === value) return level
  }
  return undefined
}

/**
 * Advance one level through the cycle.
 * @param level - the current level.
 * @returns the next level, wrapping after `verbose`.
 */
export function nextReasoningLevel(level: ReasoningVisibility): ReasoningVisibility {
  return NEXT_LEVEL[level]
}

/**
 * The number of reasoning lines one level previews.
 * @param level - the reasoning level.
 * @returns the line budget, or `Infinity` for the complete block.
 */
export function reasoningPreviewLines(level: ReasoningVisibility): number {
  return PREVIEW_LINES[level]
}

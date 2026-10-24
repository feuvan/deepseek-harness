/**
 * Tool-card visibility modes for the terminal transcript. The three modes
 * mirror the card-density controls: collapsed previews, fully expanded bodies,
 * or no cards at all.
 *
 * @module @deepseek-ai/dsh-tui/cards
 */

import { copy } from './copy.ts'

/** Ordered tool-card modes, from least to most detail. */
export const CARD_MODES = ['collapsed', 'expanded', 'hidden'] as const

/** One tool-card visibility mode. */
export type CardMode = typeof CARD_MODES[number]

/** The cycle successor of each mode. */
const NEXT_MODE: Readonly<Record<CardMode, CardMode>> = {
  collapsed: 'expanded',
  expanded: 'hidden',
  hidden: 'collapsed',
}

/**
 * Read the card mode one raw configuration-like value names.
 * @param raw - a mode id, or a localized mode name.
 * @returns the matching mode, or undefined for an unknown value.
 */
export function parseCardMode(raw: string | undefined): CardMode | undefined {
  const value = raw?.trim().toLowerCase()
  if (value === undefined || value === '') return undefined
  for (const mode of CARD_MODES) {
    if (mode === value) return mode
    if (copy.cards.levels[mode].toLowerCase() === value) return mode
  }
  return undefined
}

/**
 * Advance one mode through the cycle.
 * @param mode - the current mode.
 * @returns the next mode, wrapping after `hidden`.
 */
export function nextCardMode(mode: CardMode): CardMode {
  return NEXT_MODE[mode]
}

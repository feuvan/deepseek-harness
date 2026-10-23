/**
 * Terminal presentation configuration for the TUI plugin and the resolved
 * values its runtime uses.
 *
 * @module @deepseek-ai/dsh-tui/config
 */

import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/**
 * Cordis row configuration for the terminal front door. Every deployment-varying
 * presentation choice is a field here; interaction keys and layout constants
 * are part of the terminal contract rather than configuration.
 */
export interface Config {
  /**
   * Exact Session identity of the live root Agent this terminal presents. The
   * application composition creates that Agent before the terminal takes the
   * screen over.
   */
  sessionId: string
  /** Whether rendered text carries ANSI styling. */
  color: boolean
  /** Whether the running footer advances its elapsed clock once per second. */
  animation: boolean
  /** Maximum body lines shown for a collapsed tool card. */
  previewLines: number
  /** Maximum transcript blocks kept rendered at once. */
  windowBlocks: number
  /** Prefix for the terminal title; the Session title is shown before it. */
  title: string
}

/** Validated schema for {@link Config}. */
export const Config: z<Partial<Config>, Config> = z.object({
  sessionId: z.string().min(1),
  color: z.boolean().default(true),
  animation: z.boolean().default(true),
  previewLines: z.number().step(1).min(1).max(200).default(10),
  windowBlocks: z.number().step(1).min(20).max(5000).default(200),
  title: z.string().default('DeepSeek Harness'),
})

/** Immutable runtime values resolved once when the plugin activates. */
export interface ResolvedConfig {
  /** Opaque Session identity the terminal follows. */
  readonly sessionId: SessionId
  /** Whether rendered text carries ANSI styling. */
  readonly color: boolean
  /** Whether the running footer advances its elapsed clock. */
  readonly animation: boolean
  /** Maximum body lines shown for a collapsed tool card. */
  readonly previewLines: number
  /** Maximum transcript blocks kept rendered at once. */
  readonly windowBlocks: number
  /** Prefix for the terminal title. */
  readonly title: string
}

/**
 * Validate and freeze the runtime view of one row configuration.
 * @param config - validated plugin configuration.
 * @returns the immutable runtime configuration.
 * @throws when `sessionId` is empty after trimming, which no composition can present.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const sessionId = config.sessionId.trim()
  if (sessionId === '') throw new Error('terminal-ui: sessionId must not be blank')
  return Object.freeze({
    sessionId: brandString<SessionId>(sessionId),
    color: config.color,
    animation: config.animation,
    previewLines: config.previewLines,
    windowBlocks: config.windowBlocks,
    title: config.title,
  })
}

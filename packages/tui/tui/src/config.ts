/**
 * Terminal presentation configuration for the TUI plugin and the resolved
 * values its runtime uses.
 *
 * @module @deepseek-ai/dsh-tui/config
 */

import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { LocaleConfig } from './locale.ts'
import type { ScreenMode } from './terminal.ts'

/** Delivery mode plain Enter uses while the presented Agent is running. */
export type BusyEnter = 'queue' | 'steer'

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
  /** Transcript blocks kept attached before older history pages back in at the top. */
  windowBlocks: number
  /** Prefix for the terminal title; the Session title is shown before it. */
  title: string
  /**
   * Interface language: an explicit `en` or `zh`, or `auto` to follow
   * `DSH_LOCALE`, `LC_ALL`, `LC_MESSAGES`, then `LANG`.
   */
  locale: LocaleConfig
  /** Delivery mode plain Enter uses while the presented Agent is running. */
  busyEnter: BusyEnter
  /** Renderer ownership: inline keeps history in the terminal scrollback. */
  screen: ScreenMode
}

/**
 * Runtime configuration received by the plugin: live display fields arrive as
 * volatile references, while tests and direct callers may pass plain values.
 */
export interface ConfigInput {
  /** Opaque Session identity the terminal follows. */
  readonly sessionId: string | Volatile<string>
  /** Whether rendered text carries ANSI styling. */
  readonly color: boolean | Volatile<boolean>
  /** Whether the running footer advances its elapsed clock. */
  readonly animation: boolean | Volatile<boolean>
  /** Maximum body lines shown for a collapsed tool card. */
  readonly previewLines: number | Volatile<number>
  /** Transcript blocks kept attached before older history pages back in at the top. */
  readonly windowBlocks: number | Volatile<number>
  /** Prefix for the terminal title. */
  readonly title: string | Volatile<string>
  /** Configured interface language, with `auto` still unresolved. */
  readonly locale: LocaleConfig | Volatile<LocaleConfig>
  /** Delivery mode plain Enter uses while the presented Agent is running. */
  readonly busyEnter: BusyEnter | Volatile<BusyEnter>
  /** Renderer ownership; a committed change remounts the terminal surface. */
  readonly screen: ScreenMode | Volatile<ScreenMode>
}

/** Validated schema for {@link Config}; every field except the fixed Session identity is live. */
export const Config = z.object({
  sessionId: z.string().min(1),
  color: z.boolean().default(true).volatile(),
  animation: z.boolean().default(true).volatile(),
  previewLines: z.number().step(1).min(1).max(200).default(10).volatile(),
  windowBlocks: z.number().step(1).min(20).max(5000).default(200).volatile(),
  title: z.string().default('DeepSeek Harness').volatile(),
  locale: z.union([z.const('en'), z.const('zh'), z.const('auto')]).default('auto').volatile(),
  busyEnter: z.union([z.const('queue'), z.const('steer')]).default('queue').volatile(),
  screen: z.union([z.const('inline'), z.const('fullscreen')]).default('inline'),
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
  /** Transcript blocks kept attached before older history pages back in at the top. */
  readonly windowBlocks: number
  /** Prefix for the terminal title. */
  readonly title: string
  /** Configured interface language, with `auto` still unresolved. */
  readonly locale: LocaleConfig
  /** Delivery mode plain Enter uses while the presented Agent is running. */
  readonly busyEnter: BusyEnter
  /** Renderer ownership: inline keeps history in the terminal scrollback. */
  readonly screen: ScreenMode
}

/**
 * Read one configuration value, whether plain or a volatile reference.
 * @param value - configured value.
 * @returns the current plain value.
 */
function readValue<T>(value: T | Volatile<T>): T {
  if (typeof value === 'object' && value !== null && 'get' in value) return value.get() as T
  return value
}

/**
 * Validate and freeze the runtime view of one row configuration.
 * @param config - validated plugin configuration, with live fields possibly volatile.
 * @returns the immutable runtime configuration.
 * @throws when `sessionId` is empty after trimming, which no composition can present.
 */
export function resolveConfig(config: ConfigInput): ResolvedConfig {
  const sessionId = readValue(config.sessionId).trim()
  if (sessionId === '') throw new Error('terminal-ui: sessionId must not be blank')
  return Object.freeze({
    sessionId: brandString<SessionId>(sessionId),
    color: readValue(config.color),
    animation: readValue(config.animation),
    previewLines: readValue(config.previewLines),
    windowBlocks: readValue(config.windowBlocks),
    title: readValue(config.title),
    locale: readValue(config.locale),
    busyEnter: readValue(config.busyEnter),
    screen: readValue(config.screen),
  })
}

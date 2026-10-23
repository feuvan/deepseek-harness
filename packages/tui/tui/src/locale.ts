/**
 * Locale resolution for the terminal front door. One process hosts one
 * terminal, so the interface locale is process-wide and resolved at startup
 * from the row configuration or the launch environment.
 *
 * @module @deepseek-ai/dsh-tui/locale
 */

/** Interface languages the terminal ships. */
export type Locale = 'en' | 'zh'

/** Configuration value an operator may set: an explicit locale or environment detection. */
export type LocaleConfig = Locale | 'auto'

/**
 * Read the locale named by a raw configuration or environment value.
 * @param raw - `en`, `zh`, a `zh-*` locale tag, or undefined.
 * @returns the supported locale; anything unrecognized selects English.
 */
export function parseLocale(raw: string | undefined): Locale {
  const value = raw?.trim().toLowerCase()
  if (value === undefined || value === '') return 'en'
  return value.startsWith('zh') ? 'zh' : 'en'
}

/**
 * Detect the launch locale from the environment.
 * @param env - process environment (injectable for tests).
 * @returns the locale selected by `DSH_LOCALE`, `LC_ALL`, `LC_MESSAGES`, or `LANG`.
 */
export function detectLocale(env: NodeJS.ProcessEnv = process.env): Locale {
  const candidates = [env['DSH_LOCALE'], env['LC_ALL'], env['LC_MESSAGES'], env['LANG']]
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate.trim() !== '') return parseLocale(candidate)
  }
  return 'en'
}

/**
 * Resolve the interface locale from configuration.
 * @param config - the configured value; `auto` follows the environment.
 * @param env - process environment used when the configuration value is `auto`.
 * @returns the resolved locale.
 */
export function resolveLocale(config: LocaleConfig, env: NodeJS.ProcessEnv = process.env): Locale {
  return config === 'auto' ? detectLocale(env) : config
}

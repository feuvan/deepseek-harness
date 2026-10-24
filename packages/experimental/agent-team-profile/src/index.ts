/**
 * @deepseek-ai/dsh-experimental-agent-team-profile — experimental Agent Teams profile bundle.
 * Its main content is the `dsh.bundle.patch` document; this module also removes
 * the preset-scoped subagent controls so Team tools replace them instead of
 * being shadowed by ancestor-scope registrations.
 * @module @deepseek-ai/dsh-experimental-agent-team-profile
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

/** Stable Cordis plugin name. */
export const name = 'agent-team-preset-overlay'

/** Preset child rows the Team tools replace in every preset composition. */
const REPLACED_ROWS = [
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-subagent',
  'tool-subagent-fork',
] as const

/**
 * Suppress the preset-scoped subagent rows when a preset registry is composed.
 * @param ctx - plugin context that may carry the preset registry.
 */
export function apply(ctx: Context): void {
  ctx.inject(['agentPresets'], (child) => {
    child.effect(
      () => child.agentPresets.suppressPresetRows(REPLACED_ROWS),
      'agent-team-preset-overlay: replace subagent controls',
    )
  })
}

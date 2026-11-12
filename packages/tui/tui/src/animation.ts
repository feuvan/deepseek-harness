/**
 * Timing for the terminal's running-status animation.
 *
 * @module @deepseek-ai/dsh-tui/animation
 */

/**
 * Wall-clock step of the running status sweep, in milliseconds.
 *
 * The footer redraws at this cadence while a turn runs, and the status model
 * divides the current time by it to produce the sweep phase.
 */
export const RUNNING_ANIMATION_INTERVAL_MS = 100

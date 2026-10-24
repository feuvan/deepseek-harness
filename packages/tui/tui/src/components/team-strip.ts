/**
 * Agent Teams strip: one compact line above the composer showing teammates,
 * running members, and shared-task counts, so delegated work is visible
 * without opening the detail dock.
 *
 * @module @deepseek-ai/dsh-tui/components/team-strip
 */

import { truncateToWidth, type Component } from '@earendil-works/pi-tui'
import { copy } from '../copy.ts'
import type { Palette } from '../palette.ts'
import { summarizeTeam, teamVisible, type TeamProjection, type TeamSummary } from '../team.ts'
import type { Context } from '@deepseek-ai/cordis'

/** One dim line above the composer while a Team has visible state. */
export class TeamStrip implements Component {
  private readonly palette: Palette
  private readonly ctx: Context
  private readonly projection: () => TeamProjection | undefined

  /**
   * @param palette - terminal style table.
   * @param ctx - host context carrying the Agent registry.
   * @param projection - reads the presented Session's Team projection.
   */
  constructor(palette: Palette, ctx: Context, projection: () => TeamProjection | undefined) {
    this.palette = palette
    this.ctx = ctx
    this.projection = projection
  }

  /**
   * Render the strip, or nothing when the Team has no visible state.
   * @param width - available terminal columns.
   * @returns zero lines or one styled line.
   */
  render(width: number): string[] {
    const team = this.projection()
    if (team === undefined || !teamVisible(team)) return []
    const summary = summarizeTeam(this.ctx, team)
    const parts = stripParts(summary)
    if (team.failure !== undefined) parts.push(`${copy.team.failure}: ${team.failure}`)
    const line = ` ${parts.join(' · ')}`
    return [truncateToWidth(team.failure === undefined ? this.palette.dim(line) : this.palette.warning(line), width)]
  }

  /** No cached state exists, so nothing must be invalidated. */
  invalidate(): void {}
}

/**
 * The non-empty count segments of the compact strip.
 * @param summary - Team counts.
 * @returns display segments in reading order.
 */
function stripParts(summary: TeamSummary): string[] {
  const parts = [copy.team.teammates(summary.teammates)]
  if (summary.running > 0) parts.push(copy.team.running(summary.running))
  if (summary.tasks > 0) {
    parts.push(copy.team.tasks(summary.tasks))
    const counts: string[] = []
    if (summary.ready > 0) counts.push(copy.team.ready(summary.ready))
    if (summary.inProgress > 0) counts.push(copy.team.inProgress(summary.inProgress))
    if (summary.blocked > 0) counts.push(copy.team.blocked(summary.blocked))
    if (summary.completed > 0) counts.push(copy.team.completed(summary.completed))
    parts.push(`(${counts.join(' · ')})`)
  }
  return parts
}

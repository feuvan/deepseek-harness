/**
 * Agent Teams dock: a read-only view of the Lead Session's roster and shared
 * task board, matching the native Agent Teams panel. Selecting a member opens
 * its transcript; selecting a task expands its full description and metadata.
 * Task and member mutations stay in the Team tools and conversation.
 *
 * @module @deepseek-ai/dsh-experimental-tui-agent-team/components/team-panel
 */

import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui'
import type { TeamMemberProjectionRow, TeamProjection, TeamTaskRow } from '../team.ts'
import { copy } from '../copy.ts'
import { displayText } from '../display-text.ts'
import type { Palette } from '../types.ts'

/** The two read-only sections. */
type TeamTab = 'members' | 'tasks'

/** Maximum rows one section shows before scrolling. */
const MAX_VISIBLE = 8
/** Maximum task-detail rows shown before scrolling. */
const MAX_DETAIL = 14

/** Runtime facts the roster overlays on the durable projection. */
export interface TeamMemberRuntime {
  /** Live turn state for an active member. */
  readonly status: 'running' | 'inactive'
  /** Model reported by the member Session, when available. */
  readonly model?: string
}

/** Callbacks the read-only Team panel dispatches. */
export interface TeamPanelHandlers {
  /** Close the panel and release the dock. */
  close(): void
  /** Open one teammate's read-only transcript. */
  openMember(member: TeamMemberProjectionRow): void
}

/** A read-only bottom-dock Agent Teams panel. */
export class TeamPanel implements Component {
  private readonly palette: Palette
  private readonly handlers: TeamPanelHandlers
  private readonly runtime: (id: string) => TeamMemberRuntime
  private team: TeamProjection | undefined
  private tab: TeamTab = 'members'
  private index = 0
  private detail: TeamTaskRow | undefined
  private detailOffset = 0

  /**
   * @param palette - terminal style table.
   * @param handlers - panel actions.
   * @param runtime - live member status/model lookup.
   */
  constructor(
    palette: Palette,
    handlers: TeamPanelHandlers,
    runtime: (id: string) => TeamMemberRuntime,
  ) {
    this.palette = palette
    this.handlers = handlers
    this.runtime = runtime
  }

  /** Whether a Team projection is presented. */
  get active(): boolean {
    return this.team !== undefined
  }

  /**
   * Replace the presented Team value, keeping the selected section and clamping the cursor.
   * @param team - current projection, or undefined when it disappeared.
   */
  setTeam(team: TeamProjection | undefined): void {
    this.team = team
    this.index = Math.min(this.index, Math.max(0, this.rowCount() - 1))
    if (this.detail !== undefined) {
      this.detail = team?.tasks.find(task => task.id === this.detail?.id)
      if (this.detail === undefined) this.detailOffset = 0
    }
  }

  /**
   * Handle one input sequence while the panel owns the dock.
   * @param data - raw terminal input.
   * @returns whether the sequence was consumed.
   */
  handleInput(data: string): boolean {
    if (this.team === undefined) return false
    if (this.detail !== undefined) {
      if (matchesKey(data, 'escape')) {
        this.detail = undefined
        this.detailOffset = 0
        return true
      }
      if (matchesKey(data, 'up')) {
        this.detailOffset = Math.max(0, this.detailOffset - 1)
        return true
      }
      if (matchesKey(data, 'down')) {
        this.detailOffset += 1
        return true
      }
      if (matchesKey(data, 'pageUp')) {
        this.detailOffset = Math.max(0, this.detailOffset - MAX_DETAIL)
        return true
      }
      if (matchesKey(data, 'pageDown')) {
        this.detailOffset += MAX_DETAIL
        return true
      }
      return true
    }
    if (matchesKey(data, 'tab') || matchesKey(data, 'right')) {
      this.switchTab('tasks')
      return true
    }
    if (matchesKey(data, 'shift+tab') || matchesKey(data, 'left')) {
      this.switchTab('members')
      return true
    }
    if (matchesKey(data, 'up')) {
      this.move(-1)
      return true
    }
    if (matchesKey(data, 'down')) {
      this.move(1)
      return true
    }
    if (matchesKey(data, 'pageUp')) {
      this.move(-MAX_VISIBLE)
      return true
    }
    if (matchesKey(data, 'pageDown')) {
      this.move(MAX_VISIBLE)
      return true
    }
    if (matchesKey(data, 'enter')) {
      if (this.tab === 'tasks') {
        const task = this.team.tasks[this.index]
        if (task !== undefined) {
          this.detail = task
          this.detailOffset = 0
        }
        return true
      }
      const member = this.team.members[this.index]
      if (member !== undefined && this.memberSelectable(member)) this.handlers.openMember(member)
      return true
    }
    if (matchesKey(data, 'escape')) {
      this.handlers.close()
      return true
    }
    return false
  }

  /**
   * Render the read-only roster/task board or the selected task detail.
   * @param width - available terminal columns.
   * @returns the panel lines.
   */
  render(width: number): string[] {
    const palette = this.palette
    const team = this.team
    const lines = [truncateToWidth(palette.heading(displayText(copy.team.title)), width)]
    if (team === undefined) return lines
    if (team.failure !== undefined) {
      lines.push(palette.warning(truncateToWidth(`  ${copy.team.failure(displayText(team.failure))}`, width)))
    }
    if (this.detail !== undefined) return [...lines, ...this.detailLines(this.detail, width)]
    lines.push(truncateToWidth(this.tabLine(team), width))
    if (this.tab === 'members') lines.push(...this.memberLines(team, width))
    else lines.push(...this.taskLines(team, width))
    lines.push(palette.dim(truncateToWidth(`  ${copy.team.hint}`, width)))
    return lines
  }

  /** No cached renderer state beyond the projection snapshot. */
  invalidate(): void {}

  /**
   * Whether a roster row opens a transcript.
   * @param member - roster row.
   * @returns whether the row is selectable.
   */
  private memberSelectable(member: TeamMemberProjectionRow): boolean {
    if (member.role === 'lead') return false
    if (member.phase !== 'active') return false
    return true
  }

  /**
   * Switch the active section and reset the cursor.
   * @param tab - target section.
   */
  private switchTab(tab: TeamTab): void {
    this.tab = tab
    this.index = 0
  }

  /**
   * Move the selection within the active section.
   * @param delta - row delta.
   */
  private move(delta: number): void {
    this.index = Math.min(Math.max(0, this.rowCount() - 1), Math.max(0, this.index + delta))
  }

  /** @returns rows the active section currently shows. */
  private rowCount(): number {
    const team = this.team
    if (team === undefined) return 0
    return this.tab === 'members' ? team.members.length : team.tasks.length
  }

  /**
   * Render the section tabs with native headings and counts.
   * @param team - projection.
   * @returns the styled tab line.
   */
  private tabLine(team: TeamProjection): string {
    const palette = this.palette
    const members = ` ${copy.team.membersTab} ${String(team.members.length)} `
    const tasks = ` ${copy.team.tasksTab} ${String(team.tasks.length)} `
    return `${this.tab === 'members' ? palette.inverse(members) : palette.dim(members)}   ${this.tab === 'tasks' ? palette.inverse(tasks) : palette.dim(tasks)}`
  }

  /**
   * Render the member rows.
   * @param team - projection.
   * @param width - terminal columns.
   * @returns member lines.
   */
  private memberLines(team: TeamProjection, width: number): string[] {
    const lines: string[] = []
    const visible = this.window(team.members.length)
    for (let position = visible.start; position < visible.start + visible.capacity; position += 1) {
      const member = team.members[position]
      /* v8 ignore next -- the window is clamped to the row count */
      if (member === undefined) continue
      this.pushSelectable(lines, position === this.index, this.memberLine(member, width), width)
    }
    this.pushIndicators(lines, team.members.length, visible, width)
    return lines
  }

  /**
   * Render the task rows.
   * @param team - projection.
   * @param width - terminal columns.
   * @returns task lines.
   */
  private taskLines(team: TeamProjection, width: number): string[] {
    const lines: string[] = []
    if (team.tasks.length === 0) {
      lines.push(this.palette.dim(truncateToWidth(`  ${copy.team.emptyTasks}`, width)))
      return lines
    }
    const visible = this.window(team.tasks.length)
    for (let position = visible.start; position < visible.start + visible.capacity; position += 1) {
      const task = team.tasks[position]
      /* v8 ignore next -- the window is clamped to the row count */
      if (task === undefined) continue
      this.pushSelectable(lines, position === this.index, this.taskLine(task, width), width)
    }
    this.pushIndicators(lines, team.tasks.length, visible, width)
    return lines
  }

  /**
   * Push one selectable line, padding and inverting the selected row.
   * @param lines - destination.
   * @param selected - whether this row is selected.
   * @param content - row content.
   * @param width - terminal columns.
   */
  private pushSelectable(lines: string[], selected: boolean, content: string, width: number): void {
    if (selected) lines.push(this.palette.inverse(truncateToWidth(padEnd(` ❯ ${content}`, width), width)))
    else lines.push(truncateToWidth(`   ${content}`, width))
  }

  /**
   * Render overflow indicators.
   * @param lines - destination.
   * @param count - total rows.
   * @param visible - visible window.
   * @param width - terminal columns.
   */
  private pushIndicators(lines: string[], count: number, visible: { start: number; capacity: number }, width: number): void {
    if (visible.start > 0) lines.push(this.palette.dim(truncateToWidth(`  ↑ ${copy.moreRows(visible.start)}`, width)))
    const below = count - visible.start - visible.capacity
    if (below > 0) lines.push(this.palette.dim(truncateToWidth(`  ↓ ${copy.moreRows(below)}`, width)))
  }

  /**
   * Compute the row window around the cursor.
   * @param count - total rows.
   * @returns start and capacity.
   */
  private window(count: number): { start: number; capacity: number } {
    if (count <= MAX_VISIBLE) return { start: 0, capacity: count }
    const start = Math.max(0, Math.min(this.index - Math.floor(MAX_VISIBLE / 2), count - MAX_VISIBLE))
    return { start, capacity: MAX_VISIBLE }
  }

  /**
   * Format one member row with status, current tag, and model.
   * @param member - roster row.
   * @param width - terminal columns.
   * @returns the row content.
   */
  private memberLine(member: TeamMemberProjectionRow, width: number): string {
    const palette = this.palette
    const status = this.memberStatus(member)
    const glyph = status === 'failed' ? palette.warning('!') : status === 'inactive' ? palette.dim('○') : palette.success('●')
    const name = member.role === 'lead' ? palette.heading(displayText(member.name)) : displayText(member.name)
    const current = member.role === 'lead' ? ` ${palette.dim(`[${copy.team.current}]`)}` : ''
    const model = this.runtime(member.id).model
    const modelText = model === undefined ? '' : ` · ${copy.team.model}: ${displayText(model)}`
    const error = member.error === undefined ? '' : `  ${palette.warning(displayText(member.error))}`
    return truncateToWidth(`${glyph} ${name}${current}  ${copy.team.memberStatuses[status]}${modelText}${error}`, width)
  }

  /**
   * Derive the native member status from durable phase and live activity.
   * @param member - roster row.
   * @returns native member status key.
   */
  private memberStatus(member: TeamMemberProjectionRow): keyof typeof copy.team.memberStatuses {
    if (member.phase === 'failed') return 'failed'
    if (member.phase === 'provisioning') return 'provisioning'
    return this.runtime(member.id).status
  }

  /**
   * Format one read-only task row.
   * @param task - task row.
   * @param width - terminal columns.
   * @returns the row content.
   */
  private taskLine(task: TeamTaskRow, width: number): string {
    const palette = this.palette
    const status = task.status === 'completed'
      ? { glyph: palette.success('✓'), label: copy.team.statuses.completed }
      : task.status === 'in_progress'
        ? { glyph: palette.accent('●'), label: copy.team.statuses.inProgress }
        : task.ready
          ? { glyph: palette.dim('○'), label: copy.team.statuses.pending }
          : { glyph: palette.warning('⊘'), label: copy.team.statuses.pending }
    const readiness = task.status !== 'pending'
      ? ''
      : task.ready ? ` · ${copy.team.readyLabel}` : ` · ${copy.team.blockedLabel}`
    const owner = ` · ${copy.team.owner}: ${task.ownerName === undefined ? copy.team.unowned : `@${displayText(task.ownerName)}`}`
    const fixed = visibleWidth(`${status.glyph} ${status.label}${readiness}${owner}`)
    const subject = truncateToWidth(displayText(task.subject), Math.max(8, width - fixed - 3))
    return `${status.glyph} ${status.label}${readiness}${owner}  ${subject}`
  }

  /**
   * Render one expanded task detail with native metadata.
   * @param task - task row.
   * @param width - terminal columns.
   * @returns detail lines.
   */
  private detailLines(task: TeamTaskRow, width: number): string[] {
    const palette = this.palette
    const status = task.status === 'completed'
      ? copy.team.statuses.completed
      : task.status === 'in_progress' ? copy.team.statuses.inProgress : copy.team.statuses.pending
    const readiness = task.status !== 'pending' ? '' : task.ready ? copy.team.readyLabel : copy.team.blockedLabel
    const lines = [
      palette.heading(truncateToWidth(displayText(task.subject), width)),
      truncateToWidth(`  ${copy.team.taskDetailStatus}: ${status}${readiness === '' ? '' : ` · ${readiness}`}`, width),
      truncateToWidth(`  ${copy.team.taskDetailId}: ${displayText(task.id)}`, width),
      truncateToWidth(`  ${copy.team.owner}: ${task.ownerName === undefined ? copy.team.unowned : `@${displayText(task.ownerName)}`}`, width),
      ...wrapTextWithAnsi(displayText(task.description), Math.max(1, width - 2)).map(line => `  ${line}`),
    ]
    if (task.blockedBy.length > 0) lines.push(truncateToWidth(`  ${copy.team.blockedBy}: ${task.blockedBy.join(', ')}`, width))
    if (task.writeScopes.length > 0) lines.push(truncateToWidth(`  ${copy.team.writeScopes}: ${task.writeScopes.join(', ')}`, width))
    for (const warning of task.writeScopeWarnings) lines.push(palette.warning(truncateToWidth(`  ${displayText(warning)}`, width)))
    const start = Math.min(this.detailOffset, Math.max(0, lines.length - MAX_DETAIL))
    const visible = lines.slice(start, start + MAX_DETAIL)
    const result = [...visible]
    if (start > 0) result.unshift(palette.dim(`  ↑ ${copy.moreRows(start)}`))
    const below = lines.length - (start + visible.length)
    if (below > 0) result.push(palette.dim(`  ↓ ${copy.moreRows(below)}`))
    result.push(palette.dim(truncateToWidth(`  ${copy.team.detailHint}`, width)))
    return result
  }
}

/**
 * Pad a string to a visible width.
 * @param text - source text.
 * @param width - target columns.
 * @returns padded text.
 */
function padEnd(text: string, width: number): string {
  return `${text}${' '.repeat(Math.max(0, width - visibleWidth(text)))}`
}

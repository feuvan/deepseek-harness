/**
 * Agent Teams dock: a read-only view of the Lead Session's teammate rows and
 * shared task board. Teammates come from the root's subagent tree, so selecting
 * one opens its transcript; selecting a task expands its full description and
 * metadata. Task and teammate mutations stay in the Team tools and conversation.
 *
 * @module @deepseek-ai/dsh-tui-agent-team/components/team-panel
 */

import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui'
import type { TeamMemberRow, TeamProjection, TeamTaskRow } from '../team.ts'
import { copy } from '../copy.ts'
import { displayText } from '../display-text.ts'
import type { Palette } from '../types.ts'

/** The two read-only sections. */
type TeamTab = 'members' | 'tasks'

/** Maximum rows one section shows before scrolling. */
const MAX_VISIBLE = 8
/** Maximum task-detail rows shown before scrolling. */
const MAX_DETAIL = 14

/** Callbacks the read-only Team panel dispatches. */
export interface TeamPanelHandlers {
  /** Close the panel and release the dock. */
  close(): void
  /** Open one teammate's read-only transcript. */
  openMember(member: TeamMemberRow): void
}

/** A read-only bottom-dock Agent Teams panel. */
export class TeamPanel implements Component {
  private readonly palette: Palette
  private readonly handlers: TeamPanelHandlers
  private readonly running: (id: string) => boolean
  private team: TeamProjection | undefined
  private members: readonly TeamMemberRow[] = []
  private tab: TeamTab = 'members'
  private index = 0
  private detail: TeamTaskRow | undefined
  private detailOffset = 0

  /**
   * @param palette - terminal style table.
   * @param handlers - panel actions.
   * @param running - live running-state lookup for one teammate Session.
   */
  constructor(
    palette: Palette,
    handlers: TeamPanelHandlers,
    running: (id: string) => boolean,
  ) {
    this.palette = palette
    this.handlers = handlers
    this.running = running
  }

  /** Whether a Team projection is presented. */
  get active(): boolean {
    return this.team !== undefined
  }

  /**
   * Replace the presented Team value, keeping the selected section and clamping the cursor.
   * @param team - current projection, or undefined when it disappeared.
   * @param members - teammate rows derived from the root's subagent tree.
   */
  setTeam(team: TeamProjection | undefined, members: readonly TeamMemberRow[]): void {
    this.team = team
    this.members = members
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
      const member = this.members[this.index]
      if (member !== undefined) this.handlers.openMember(member)
      return true
    }
    if (matchesKey(data, 'escape')) {
      this.handlers.close()
      return true
    }
    return false
  }

  /**
   * Render the read-only teammate/task board or the selected task detail.
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
    if (this.tab === 'members') lines.push(...this.memberLines(width))
    else lines.push(...this.taskLines(team, width))
    lines.push(palette.dim(truncateToWidth(`  ${copy.team.hint}`, width)))
    return lines
  }

  /** No cached renderer state beyond the projection snapshot. */
  invalidate(): void {}

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
    return this.tab === 'members' ? this.members.length : team.tasks.length
  }

  /**
   * Render the section tabs with counts.
   * @param team - projection.
   * @returns the styled tab line.
   */
  private tabLine(team: TeamProjection): string {
    const palette = this.palette
    const members = ` ${copy.team.membersTab} ${String(this.members.length)} `
    const tasks = ` ${copy.team.tasksTab} ${String(team.tasks.length)} `
    return `${this.tab === 'members' ? palette.inverse(members) : palette.dim(members)}   ${this.tab === 'tasks' ? palette.inverse(tasks) : palette.dim(tasks)}`
  }

  /**
   * Render the teammate rows.
   * @param width - terminal columns.
   * @returns member lines.
   */
  private memberLines(width: number): string[] {
    const lines: string[] = []
    if (this.members.length === 0) {
      lines.push(this.palette.dim(truncateToWidth(`  ${copy.team.emptyMembers}`, width)))
      return lines
    }
    const visible = this.window(this.members.length)
    for (let position = visible.start; position < visible.start + visible.capacity; position += 1) {
      const member = this.members[position]
      /* v8 ignore next -- the window is clamped to the row count */
      if (member === undefined) continue
      this.pushSelectable(lines, position === this.index, this.memberLine(member, width), width)
    }
    this.pushIndicators(lines, this.members.length, visible, width)
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
   * Format one teammate row with its live state, name, and description.
   * @param member - teammate row.
   * @param width - terminal columns.
   * @returns the row content.
   */
  private memberLine(member: TeamMemberRow, width: number): string {
    const palette = this.palette
    const running = this.running(member.id)
    const glyph = running ? palette.success('●') : palette.dim('○')
    const status = running ? copy.team.memberStatuses.running : copy.team.memberStatuses.inactive
    const description = member.reason === undefined
      ? member.description
      : copy.team.memberReasons[member.reason]
    const suffix = description === undefined ? '' : ` · ${displayText(description)}`
    return truncateToWidth(`${glyph} ${displayText(member.name)}  ${status}${suffix}`, width)
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

/**
 * Agent Teams dock: the roster and shared task board of the Lead Session's
 * `agentTeam` projection. It presents the roster and shared task board inside
 * the terminal's single bottom dock and adds small actions that do not require
 * leaving the terminal.
 *
 * @module @deepseek-ai/dsh-tui/components/team-panel
 */

import { matchesKey, truncateToWidth, type Component } from '@earendil-works/pi-tui'
import type {
  TeamMemberProjectionRow, TeamProjection, TeamTaskRow,
} from '../team.ts'
import { copy } from '../copy.ts'
import { displayText } from '../display-text.ts'
import type { Palette } from '../palette.ts'

/** The two Team tabs. */
type TeamTab = 'members' | 'tasks'

/** Maximum rows one tab renders before scrolling. */
const MAX_VISIBLE = 6

/** Callbacks the Team panel dispatches. */
export interface TeamPanelHandlers {
  /** Close the panel and release the dock. */
  close(): void
  /** Open one teammate's read-only transcript. */
  openMember(member: TeamMemberProjectionRow): void
  /** Pre-fill the composer with a message to one teammate. */
  messageMember(member: TeamMemberProjectionRow): void
  /** Claim one ready task for the Lead. */
  claimTask(task: TeamTaskRow): void
  /** Complete one in-progress task. */
  completeTask(task: TeamTaskRow): void
  /** Pre-fill the composer with a task-creation command. */
  createTask(): void
}

/** A bottom-dock Agent Teams panel. */
export class TeamPanel implements Component {
  private readonly palette: Palette
  private readonly handlers: TeamPanelHandlers
  private team: TeamProjection | undefined
  private tab: TeamTab = 'members'
  private index = 0

  /**
   * @param palette - terminal style table.
   * @param handlers - panel actions.
   */
  constructor(palette: Palette, handlers: TeamPanelHandlers) {
    this.palette = palette
    this.handlers = handlers
  }

  /** Whether a Team projection is presented. */
  get active(): boolean {
    return this.team !== undefined
  }

  /**
   * Replace the presented Team value, keeping the selected tab and clamping the cursor.
   * @param team - current projection, or undefined when it disappeared.
   */
  setTeam(team: TeamProjection | undefined): void {
    this.team = team
    this.index = Math.min(this.index, Math.max(0, this.rowCount() - 1))
  }

  /**
   * Handle one input sequence while the panel owns the dock.
   * @param data - raw terminal input.
   * @returns whether the sequence was consumed.
   */
  handleInput(data: string): boolean {
    if (this.team === undefined) return false
    if (matchesKey(data, 'tab') || matchesKey(data, 'right')) {
      this.switchTab('tasks')
      return true
    }
    if (matchesKey(data, 'shift+tab') || matchesKey(data, 'left')) {
      this.switchTab('members')
      return true
    }
    if (matchesKey(data, 'up')) {
      this.index = Math.max(0, this.index - 1)
      return true
    }
    if (matchesKey(data, 'down')) {
      this.index = Math.min(Math.max(0, this.rowCount() - 1), this.index + 1)
      return true
    }
    if (matchesKey(data, 'pageUp')) {
      this.index = Math.max(0, this.index - MAX_VISIBLE)
      return true
    }
    if (matchesKey(data, 'pageDown')) {
      this.index = Math.min(Math.max(0, this.rowCount() - 1), this.index + MAX_VISIBLE)
      return true
    }
    if (this.tab === 'members') {
      const member = this.team.members[this.index]
      if (member !== undefined && matchesKey(data, 'enter')) {
        this.handlers.openMember(member)
        return true
      }
      if (member !== undefined && data === 'm') {
        this.handlers.messageMember(member)
        return true
      }
      if (data === 'n') {
        this.handlers.createTask()
        return true
      }
    } else {
      const task = this.team.tasks[this.index]
      if (task !== undefined && data === 'a') {
        this.handlers.claimTask(task)
        return true
      }
      if (task !== undefined && data === 'c') {
        this.handlers.completeTask(task)
        return true
      }
      if (data === 'n') {
        this.handlers.createTask()
        return true
      }
    }
    if (matchesKey(data, 'escape')) {
      this.handlers.close()
      return true
    }
    return false
  }

  /**
   * Render the title, tab bar, active tab rows, and hint.
   * @param width - available terminal columns.
   * @returns the panel lines.
   */
  render(width: number): string[] {
    const palette = this.palette
    const lines = [truncateToWidth(palette.heading(displayText(copy.team.title)), width)]
    lines.push(truncateToWidth(` ${this.tabLine()}`, width))
    const team = this.team
    if (team === undefined) return lines
    if (team.failure !== undefined) lines.push(palette.warning(truncateToWidth(` ${copy.team.failure}: ${displayText(team.failure)}`, width)))
    const rows = this.tab === 'members'
      ? team.members.map(member => ({ text: this.memberLine(member), selected: false }))
      : team.tasks.map(task => ({ text: this.taskLine(task), selected: false }))
    if (rows.length === 0) {
      lines.push(palette.dim(truncateToWidth(`  ${this.tab === 'members' ? copy.team.emptyMembers : copy.team.emptyTasks}`, width)))
    } else {
      const visible = Math.min(MAX_VISIBLE, rows.length)
      const start = Math.max(0, Math.min(this.index - Math.floor(visible / 2), rows.length - visible))
      if (start > 0) lines.push(palette.dim(`  ↑ ${copy.moreRows(start)}`))
      for (let position = start; position < start + visible; position += 1) {
        const row = rows[position]
        /* v8 ignore next -- the window is clamped to the row count */
        if (row === undefined) continue
        const marker = position === this.index ? palette.accent('❯') : ' '
        const text = position === this.index ? palette.inverse(row.text) : row.text
        lines.push(truncateToWidth(` ${marker} ${text}`, width))
      }
      const remaining = rows.length - (start + visible)
      if (remaining > 0) lines.push(palette.dim(`  ↓ ${copy.moreRows(remaining)}`))
    }
    lines.push(palette.dim(truncateToWidth(` ${copy.team.hint}`, width)))
    return lines
  }

  /** No cached renderer state exists beyond the projection snapshot. */
  invalidate(): void {}

  /**
   * Switch the active tab and reset the cursor.
   * @param tab - target tab.
   */
  private switchTab(tab: TeamTab): void {
    this.tab = tab
    this.index = 0
  }

  /** @returns rows the active tab currently shows. */
  private rowCount(): number {
    const team = this.team
    if (team === undefined) return 0
    return this.tab === 'members' ? team.members.length : team.tasks.length
  }

  /** @returns the localized tab bar with the active tab inverse-video. */
  private tabLine(): string {
    const palette = this.palette
    const members = this.tab === 'members' ? palette.inverse(copy.team.membersTab) : palette.dim(copy.team.membersTab)
    const tasks = this.tab === 'tasks' ? palette.inverse(copy.team.tasksTab) : palette.dim(copy.team.tasksTab)
    return `${members}  ${tasks}`
  }

  /**
   * Format one member row.
   * @param member - roster row.
   * @returns the styled text.
   */
  private memberLine(member: TeamMemberProjectionRow): string {
    const palette = this.palette
    const glyph = member.role === 'lead' ? palette.accent('★') : palette.accent('●')
    const name = member.role === 'lead' ? palette.heading(displayText(member.name)) : displayText(member.name)
    const role = member.role === 'lead' ? copy.team.lead : copy.team.teammate
    const phase = copy.team.phases[member.phase]
    const error = member.error === undefined ? '' : `  ${palette.warning(displayText(member.error))}`
    return `${glyph} ${name}  ${palette.dim(`${role} · ${phase}`)}${error}`
  }

  /**
   * Format one task row.
   * @param task - task view.
   * @returns the styled text.
   */
  private taskLine(task: TeamTaskRow): string {
    const palette = this.palette
    const status = task.status === 'in_progress'
      ? { glyph: '●', label: palette.accent(copy.team.statuses.inProgress) }
      : task.status === 'completed'
        ? { glyph: '✓', label: palette.success(copy.team.statuses.completed) }
        : task.ready
          ? { glyph: '○', label: palette.dim(copy.team.statuses.ready) }
          : { glyph: '⊘', label: palette.warning(copy.team.statuses.blocked) }
    const owner = task.ownerName === undefined ? '' : `  @${displayText(task.ownerName)}`
    const blocked = task.blockedBy.length === 0 ? '' : `  ← ${task.blockedBy.join(', ')}`
    const warnings = task.writeScopeWarnings.length === 0 ? '' : `  !${String(task.writeScopeWarnings.length)}`
    return `${palette.accent(status.glyph)} ${status.label}  ${displayText(task.id)}  ${displayText(task.subject)}${owner}${blocked}${warnings}`
  }
}

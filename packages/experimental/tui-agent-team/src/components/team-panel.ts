/**
 * Agent Teams dock: readiness, roster, and shared task board for the Lead
 * Session's `agentTeam` projection. The panel exposes only actions that are
 * ready for the selected row and explains unavailable actions in place.
 *
 * @module @deepseek-ai/dsh-experimental-tui-agent-team/components/team-panel
 */

import { matchesKey, truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import type {
  TeamMemberProjectionRow, TeamProjection, TeamTaskRow,
} from '../team.ts'
import { copy } from '../copy.ts'
import { displayText } from '../display-text.ts'
import type { Palette } from '../types.ts'

/** The two Team tabs. */
type TeamTab = 'members' | 'tasks'

/** Maximum rows one tab renders before scrolling. */
const MAX_VISIBLE = 8

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
  private message: string | undefined
  private detail: TeamTaskRow | undefined
  private help = false

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
    this.message = undefined
    if (this.detail !== undefined) {
      const refreshed = team?.tasks.find(task => task.id === this.detail?.id)
      if (refreshed === undefined) this.detail = undefined
      else this.detail = refreshed
    }
  }

  /**
   * Handle one input sequence while the panel owns the dock.
   * @param data - raw terminal input.
   * @returns whether the sequence was consumed.
   */
  handleInput(data: string): boolean {
    if (this.team === undefined) return false
    if (this.help) {
      if (match(data, '?') || matchesKey(data, 'escape')) this.help = false
      return true
    }
    if (this.detail !== undefined) {
      if (matchesKey(data, 'escape')) {
        this.detail = undefined
        this.message = undefined
        return true
      }
      if (match(data, '?')) {
        this.help = true
        return true
      }
      if (match(data, 'a')) {
        if (this.canClaim(this.detail)) this.handlers.claimTask(this.detail)
        else this.message = copy.team.taskNotClaimable(copy.team.statuses[this.taskStatusKey(this.detail)])
        return true
      }
      if (match(data, 'c')) {
        if (this.detail.status === 'in_progress') this.handlers.completeTask(this.detail)
        else this.message = copy.team.taskNotCompletable(copy.team.statuses[this.taskStatusKey(this.detail)])
        return true
      }
      if (match(data, 'n')) {
        this.handlers.createTask()
        return true
      }
      return true
    }
    if (match(data, '?')) {
      this.help = true
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
    if (match(data, 'n')) {
      this.handlers.createTask()
      return true
    }
    if (this.tab === 'members') {
      const member = this.team.members[this.index]
      if (member !== undefined && matchesKey(data, 'enter')) {
        if (member.phase === 'failed') {
          this.message = copy.team.memberUnavailable(member.name)
          return true
        }
        this.handlers.openMember(member)
        return true
      }
      if (member !== undefined && match(data, 'm')) {
        if (member.phase === 'failed') {
          this.message = copy.team.memberUnavailable(member.name)
          return true
        }
        this.handlers.messageMember(member)
        return true
      }
    } else {
      const task = this.team.tasks[this.index]
      if (task !== undefined && matchesKey(data, 'enter')) {
        this.detail = task
        this.message = undefined
        return true
      }
      if (task !== undefined && match(data, 'a')) {
        if (!this.canClaim(task)) {
          this.message = copy.team.taskNotClaimable(copy.team.statuses[this.taskStatusKey(task)])
          return true
        }
        this.handlers.claimTask(task)
        return true
      }
      if (task !== undefined && match(data, 'c')) {
        if (task.status !== 'in_progress') {
          this.message = copy.team.taskNotCompletable(copy.team.statuses[this.taskStatusKey(task)])
          return true
        }
        this.handlers.completeTask(task)
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
   * Render readiness, tabs, the active table, and contextual keys.
   * @param width - available terminal columns.
   * @returns the panel lines.
   */
  render(width: number): string[] {
    const palette = this.palette
    const team = this.team
    const lines = [truncateToWidth(palette.heading(displayText(copy.team.title)), width)]
    if (team === undefined) return lines
    if (this.help) return this.helpLines(width)
    lines.push(this.statusLine(team, width))
    if (team.failure !== undefined) {
      lines.push(palette.warning(truncateToWidth(`  ${copy.team.failure}: ${displayText(team.failure)}`, width)))
    }
    if (this.detail !== undefined) return [...lines, ...this.detailLines(this.detail, width)]
    lines.push(truncateToWidth(this.tabLine(team), width))
    lines.push(palette.dim(truncateToWidth(`  ${this.tab === 'members' ? copy.team.membersHeader : copy.team.tasksHeader}`, width)))
    const contentWidth = Math.max(1, width - 3)
    const rows = this.tab === 'members'
      ? team.members.map(member => this.memberLine(member, contentWidth))
      : team.tasks.map(task => this.taskLine(task, contentWidth))
    if (rows.length === 0) {
      const empty = this.tab === 'members' ? copy.team.emptyMembers : copy.team.emptyTasks
      lines.push(palette.dim(truncateToWidth(`  ${empty}`, width)))
    } else {
      const visible = Math.min(MAX_VISIBLE, rows.length)
      const start = Math.max(0, Math.min(this.index - Math.floor(visible / 2), rows.length - visible))
      if (start > 0) lines.push(palette.dim(`  ↑ ${copy.moreRows(start)}`))
      for (let position = start; position < start + visible; position += 1) {
        const row = rows[position]
        /* v8 ignore next -- the window is clamped to the row count */
        if (row === undefined) continue
        const selected = position === this.index
        const content = truncateToWidth(padEnd(row, contentWidth), contentWidth)
        lines.push(selected
          ? palette.inverse(truncateToWidth(padEnd(` ❯ ${content}`, width), width))
          : truncateToWidth(`   ${content}`, width))
      }
      const remaining = rows.length - (start + visible)
      if (remaining > 0) lines.push(palette.dim(`  ↓ ${copy.moreRows(remaining)}`))
    }
    if (this.message !== undefined) lines.push(palette.warning(truncateToWidth(`  ${this.message}`, width)))
    lines.push(palette.dim(truncateToWidth(`  ${this.footer()}`, width)))
    return lines
  }

  /** No cached renderer state exists beyond the projection snapshot. */
  invalidate(): void {}

  /**
   * Switch the active tab, reset the cursor, and clear transient explanations.
   * @param tab - target tab.
   */
  private switchTab(tab: TeamTab): void {
    this.tab = tab
    this.index = 0
    this.message = undefined
  }

  /**
   * Move the selection within the active tab.
   * @param delta - row delta.
   */
  private move(delta: number): void {
    this.index = Math.min(Math.max(0, this.rowCount() - 1), Math.max(0, this.index + delta))
    this.message = undefined
  }

  /** @returns rows the active tab currently shows. */
  private rowCount(): number {
    const team = this.team
    if (team === undefined) return 0
    return this.tab === 'members' ? team.members.length : team.tasks.length
  }

  /**
   * Whether the selected task can be claimed from this panel.
   * @param task - task row.
   * @returns whether claim is available.
   */
  private canClaim(task: TeamTaskRow): boolean {
    return task.status === 'pending' && task.ready && task.ownerName === undefined && task.blockedBy.length === 0
  }

  /**
   * Map a task to its localized status label.
   * @param task - task row.
   * @returns status key.
   */
  private taskStatusKey(task: TeamTaskRow): 'ready' | 'blocked' | 'inProgress' | 'completed' {
    if (task.status === 'completed') return 'completed'
    if (task.status === 'in_progress') return 'inProgress'
    return task.ready ? 'ready' : 'blocked'
  }

  /**
   * Render the readiness and overview line.
   * @param team - projection.
   * @param width - terminal columns.
   * @returns the styled line.
   */
  private statusLine(team: TeamProjection, width: number): string {
    const palette = this.palette
    const inProgress = team.tasks.filter(task => task.status === 'in_progress').length
    const failed = team.members.filter(member => member.phase === 'failed').length
    const degraded = team.failure !== undefined || failed > 0
    const status = degraded ? palette.warning(copy.team.degradedStatus) : palette.success(copy.team.readyStatus)
    const summary = copy.team.summary(team.members.length, team.tasks.length, inProgress)
    const failures = failed === 0 ? '' : `  ${palette.warning(copy.team.failed(failed))}`
    return truncateToWidth(` ${status}  ${palette.dim(summary)}${failures}`, width)
  }

  /**
   * Render the tab bar with per-tab counts.
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
   * Format one member row.
   * @param member - roster row.
   * @param width - available columns.
   * @returns the styled text.
   */
  private memberLine(member: TeamMemberProjectionRow, width: number): string {
    const palette = this.palette
    const glyph = member.role === 'lead' ? palette.accent('★') : member.phase === 'failed' ? palette.warning('!') : palette.accent('●')
    const name = member.role === 'lead' ? palette.heading(displayText(member.name)) : displayText(member.name)
    const role = member.role === 'lead' ? copy.team.lead : copy.team.teammate
    const phase = member.phase === 'failed' ? palette.warning(copy.team.phases.failed) : palette.dim(copy.team.phases[member.phase])
    const error = member.error === undefined ? '' : `  ${palette.warning(displayText(member.error))}`
    return truncateToWidth(`${glyph} ${name}  ${palette.dim(role)}  ${phase}${error}`, width)
  }

  /**
   * Format one task row with aligned status, task, owner, and blockers.
   * @param task - task view.
   * @param width - available columns.
   * @returns the styled text.
   */
  private taskLine(task: TeamTaskRow, width: number): string {
    const palette = this.palette
    const status = task.status === 'completed'
      ? { glyph: '✓', label: palette.success(copy.team.statuses.completed) }
      : task.status === 'in_progress'
        ? { glyph: '●', label: palette.accent(copy.team.statuses.inProgress) }
        : task.ready
          ? { glyph: '○', label: palette.dim(copy.team.statuses.ready) }
          : { glyph: '⊘', label: palette.warning(copy.team.statuses.blocked) }
    const owner = task.ownerName === undefined ? '' : `  @${displayText(task.ownerName)}`
    const blocked = task.blockedBy.length === 0 ? '' : `  ← ${task.blockedBy.join(', ')}`
    const warnings = task.writeScopeWarnings.length === 0 ? '' : `  !${String(task.writeScopeWarnings.length)}`
    const id = padEnd(displayText(task.id), 10)
    const reserved = 14 + 10 + visibleWidth(owner) + visibleWidth(blocked) + visibleWidth(warnings) + 3
    const subject = truncateToWidth(displayText(task.subject), Math.max(8, width - reserved))
    return `${palette.accent(status.glyph)} ${status.label}${' '.repeat(Math.max(0, 14 - visibleWidth(`${status.glyph} ${status.label}`)))}${id}${subject}${owner}${blocked}${warnings}`
  }

  /**
   * Render the compact shortcut help view.
   * @param width - terminal columns.
   * @returns the help lines.
   */
  private helpLines(width: number): string[] {
    return [
      truncateToWidth(this.palette.heading(copy.team.shortcutsTitle), width),
      truncateToWidth(this.palette.dim(`  ${copy.team.shortcutsMove}`), width),
      truncateToWidth(`  ${copy.team.shortcutsTask}`, width),
      truncateToWidth(`  ${copy.team.shortcutsMember}`, width),
      truncateToWidth(`  ${copy.team.shortcutsNew}`, width),
      truncateToWidth(`  ${copy.team.shortcutsClose}`, width),
      truncateToWidth(this.palette.dim(`  ${copy.team.helpClose}`), width),
    ]
  }

  /**
   * Render the selected task's readiness and details.
   * @param task - task to show.
   * @param width - terminal columns.
   * @returns the detail lines.
   */
  private detailLines(task: TeamTaskRow, width: number): string[] {
    const palette = this.palette
    const key = this.taskStatusKey(task)
    const lines = [
      truncateToWidth(palette.heading(copy.team.taskDetailTitle(task.id)), width),
      truncateToWidth(`  ${palette.dim(copy.team.taskDetailStatus)}  ${copy.team.statuses[key]}`, width),
      truncateToWidth(`  ${copy.team.taskDetailSubject}  ${displayText(task.subject)}`, width),
      truncateToWidth(`  ${copy.team.taskDetailOwner}  ${task.ownerName === undefined ? copy.team.none : `@${displayText(task.ownerName)}`}`, width),
      truncateToWidth(`  ${copy.team.taskDetailBlocked}  ${task.blockedBy.length === 0 ? copy.team.none : task.blockedBy.join(', ')}`, width),
      truncateToWidth(`  ${copy.team.taskDetailScopes}  ${task.writeScopes.length === 0 ? copy.team.none : task.writeScopes.join(', ')}`, width),
      truncateToWidth(`  ${copy.team.taskDetailWarnings}  ${task.writeScopeWarnings.length === 0 ? copy.team.none : String(task.writeScopeWarnings.length)}`, width),
    ]
    if (this.message !== undefined) lines.push(palette.warning(truncateToWidth(`  ${this.message}`, width)))
    lines.push(palette.dim(truncateToWidth(`  ${this.footer()}`, width)))
    return lines
  }

  /**
   * Build the compact command-center footer.
   * @returns the footer text.
   */
  private footer(): string {
    if (this.detail !== undefined) {
      const action = this.canClaim(this.detail)
        ? copy.team.footerDetailClaim
        : this.detail.status === 'in_progress'
          ? copy.team.footerDetailComplete
          : copy.team.footerDetailNone
      return `${action} · ${copy.team.footerDetailBack} · ${copy.team.footerHelp}`
    }
    return `${copy.team.footerList} · ${copy.team.footerHelp}`
  }
}

/**
 * Match a single lowercase action key.
 * @param data - raw input sequence.
 * @param key - expected character.
 * @returns whether the input is that key.
 */
function match(data: string, key: string): boolean {
  return data === key
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

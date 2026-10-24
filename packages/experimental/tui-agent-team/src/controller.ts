/**
 * Agent Teams behind the terminal contribution seam: one compact strip, one
 * `/team` command, the roster/task dock, teammate transcripts, and task and
 * message actions. The controller owns no renderer state beyond its surfaces;
 * the terminal owns layout, focus, and dock input routing.
 *
 * @module @deepseek-ai/dsh-experimental-tui-agent-team/controller
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-query'
import type { TeamMemberProjectionRow, TeamTaskRow } from './team.ts'
import { readTeamProjection, teamService } from './team.ts'
import { copy, setCopyLocale } from './copy.ts'
import { TeamMemberPanel } from './components/team-member-panel.ts'
import { TeamPanel } from './components/team-panel.ts'
import { TeamStrip } from './components/team-strip.ts'
import type { TerminalUiLike } from './types.ts'

/** Agent Teams controller bound to one terminal launch. */
export class TeamController {
  private readonly ctx: Context
  private readonly ui: TerminalUiLike
  private readonly teamPanel: TeamPanel
  private readonly memberPanel: TeamMemberPanel
  private teamStop: (() => void) | undefined
  private memberStop: (() => void) | undefined

  /**
   * @param ctx - host context carrying the projection, query, Agent, and Team services.
   * @param ui - the terminal contribution seam.
   */
  constructor(ctx: Context, ui: TerminalUiLike) {
    this.ctx = ctx
    this.ui = ui
    this.teamPanel = new TeamPanel(ui.palette, {
      close: () => { this.closeTeamPanel() },
      openMember: (member) => { void this.openMember(member) },
      messageMember: (member) => { this.promptMessage(member) },
      claimTask: (task) => { void this.updateTask(task, 'claim') },
      completeTask: (task) => { void this.updateTask(task, 'complete') },
      createTask: () => { this.promptTask() },
    })
    this.memberPanel = new TeamMemberPanel(ui.palette, () => { this.backToTeamPanel() })
  }

  /**
   * Install every surface through the seam.
   * @returns disposer releasing the contributions and subscriptions.
   */
  install(): () => void {
    setCopyLocale(this.ui.locale)
    const unregisterStrip = this.ui.registerStrip(new TeamStrip(this.ui.palette, this.ctx, () => this.projection()))
    const unregisterCommand = this.ui.registerCommand({
      name: 'team',
      description: copy.team.title,
      run: (argument) => { void this.teamCommand(argument) },
    })
    return () => {
      this.closeTeamPanel()
      unregisterCommand()
      unregisterStrip()
    }
  }

  /** @returns the Lead Session's Team projection. */
  private projection() {
    return readTeamProjection(this.ctx, this.ui.agent())
  }

  /** @returns the presented root Agent. */
  private agent(): Agent | undefined {
    return this.ui.agent()
  }

  /**
   * Handle `/team` and its argument forms.
   * @param argument - panel (absent), `task <subject>`, or `message <member> <text>`.
   */
  private async teamCommand(argument: string | undefined): Promise<void> {
    const text = argument?.trim() ?? ''
    if (text === '') {
      this.openTeamPanel()
      return
    }
    const [verb, ...rest] = text.split(/\s+/u)
    if (verb === 'task') {
      const subject = rest.join(' ').trim()
      if (subject === '') {
        this.ui.notice(copy.team.usage)
        return
      }
      await this.createTask(subject)
      return
    }
    if (verb === 'message') {
      const target = rest.shift()
      const message = rest.join(' ').trim()
      if (target === undefined || message === '') {
        this.ui.notice(copy.team.usage)
        return
      }
      await this.sendMessage(target, message)
      return
    }
    this.ui.notice(copy.team.usage)
  }

  /**
   * Create one shared task.
   * @param subject - task subject and description.
   */
  private async createTask(subject: string): Promise<void> {
    const service = teamService(this.ctx)
    const agent = this.agent()
    if (service === undefined || agent === undefined) {
      this.ui.notice(copy.team.unavailable)
      return
    }
    try {
      const task = await service.createTask(agent, { subject, description: subject })
      this.ui.notice(copy.team.taskCreated(task.id))
      this.refreshTeamPanel()
    } catch (error: unknown) {
      this.ui.notice(copy.team.actionFailed(error instanceof Error ? error.message : String(error)))
    }
  }

  /**
   * Send one text message to a teammate.
   * @param target - teammate name.
   * @param text - message text.
   */
  private async sendMessage(target: string, text: string): Promise<void> {
    const service = teamService(this.ctx)
    const agent = this.agent()
    if (service === undefined || agent === undefined) {
      this.ui.notice(copy.team.unavailable)
      return
    }
    try {
      await service.sendMessage(agent, {
        target,
        content: [{ type: 'text', text }],
        signal: new AbortController().signal,
      })
      this.ui.notice(copy.team.messageSent(target))
    } catch (error: unknown) {
      this.ui.notice(copy.team.actionFailed(error instanceof Error ? error.message : String(error)))
    }
  }

  /**
   * Apply one task transition.
   * @param task - selected task with its projection revision.
   * @param action - claim or complete.
   */
  private async updateTask(task: TeamTaskRow, action: 'claim' | 'complete'): Promise<void> {
    const service = teamService(this.ctx)
    const agent = this.agent()
    if (service === undefined || agent === undefined) {
      this.ui.notice(copy.team.unavailable)
      return
    }
    try {
      await service.updateTask(agent, { taskId: task.id, expectedRevision: task.revision, action })
      this.ui.notice(action === 'claim' ? copy.team.taskClaimed(task.id) : copy.team.taskCompleted(task.id))
      this.refreshTeamPanel()
    } catch (error: unknown) {
      this.ui.notice(copy.team.actionFailed(error instanceof Error ? error.message : String(error)))
    }
  }

  /**
   * Load one teammate Session into the read-only transcript panel.
   * @param member - selected roster row.
   */
  private async openMember(member: TeamMemberProjectionRow): Promise<void> {
    const query = this.ctx.get('sessionQuery')
    if (query === undefined) {
      this.ui.notice(copy.team.historyUnavailable)
      return
    }
    const sessionId = SessionId(member.id)
    try {
      using observation = await query.observeSession(sessionId, { projectionMode: 'all' })
      const lines = [...observation.events].flatMap((event) => {
        const line = formatEvent(event)
        return line === undefined ? [] : [line]
      })
      this.memberPanel.setTranscript(member.name, lines)
      this.memberStop?.()
      this.memberStop = this.ctx.on('session/event', (session, event) => {
        if (session.id !== sessionId) return
        const line = formatEvent(event)
        if (line === undefined) return
        this.memberPanel.append(line)
        this.ui.requestRender()
      })
      this.ui.openDock(this.memberPanel, () => { this.backToTeamPanel() })
    } catch (error: unknown) {
      this.ui.notice(copy.team.actionFailed(error instanceof Error ? error.message : String(error)))
    }
  }

  /** Return from the teammate transcript to the roster panel. */
  private backToTeamPanel(): void {
    this.memberStop?.()
    this.memberStop = undefined
    this.memberPanel.setTranscript('', [])
    this.openTeamPanel()
  }

  /** Pre-fill the composer with the task-creation command. */
  private promptTask(): void {
    this.closeTeamPanel()
    this.ui.setEditorText('/team task ')
  }

  /**
   * Pre-fill the composer with a teammate-message command.
   * @param member - selected teammate.
   */
  private promptMessage(member: TeamMemberProjectionRow): void {
    this.closeTeamPanel()
    this.ui.setEditorText(`/team message ${member.name} `)
  }

  /** Present the roster and task board. */
  private openTeamPanel(): void {
    const team = this.projection()
    if (team === undefined) {
      this.closeTeamPanel()
      this.ui.notice(copy.team.unavailable)
      return
    }
    this.teamPanel.setTeam(team)
    this.teamStop?.()
    const projections = this.ctx.get('sessionProjections')
    this.teamStop = projections?.onChanged((session) => {
      if (session === this.agent()?.session) this.refreshTeamPanel()
    })
    this.ui.openDock(this.teamPanel, () => { this.closeTeamPanel() })
  }

  /** Refresh the open roster, closing it when the projection disappears. */
  private refreshTeamPanel(): void {
    const team = this.projection()
    if (team === undefined) {
      this.closeTeamPanel()
      return
    }
    this.teamPanel.setTeam(team)
    this.ui.requestRender()
  }

  /** Release the roster dock and its projection subscription. */
  private closeTeamPanel(): void {
    this.teamStop?.()
    this.teamStop = undefined
    this.memberStop?.()
    this.memberStop = undefined
    this.teamPanel.setTeam(undefined)
    this.memberPanel.setTranscript('', [])
    this.ui.closeDock()
  }
}

/**
 * Format one teammate Session event as one transcript line.
 * @param event - durable event from the teammate Session.
 * @returns the line, or undefined for events the viewer does not show.
 */
function formatEvent(event: SessionEvent): string | undefined {
  if (event.type === 'user/message') {
    const content = (event.data as { content?: readonly { type: string; text?: string }[] }).content ?? []
    const text = content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []).join(' ').trim()
    return text === '' ? undefined : copy.team.memberUser(text)
  }
  if (event.type === 'assistant/message') {
    const content = (event.data as { message?: { content?: readonly { type: string; text?: string }[] } }).message?.content ?? []
    const text = content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []).join(' ').trim()
    return text === '' ? undefined : copy.team.memberAssistant(text)
  }
  if (event.type === 'tool/call') {
    const name = (event.data as { name?: unknown }).name
    return typeof name === 'string' ? copy.team.memberTool(name) : undefined
  }
  if (event.type === 'turn/end') {
    const kind = (event.data as { reason?: { kind?: unknown } }).reason?.kind
    return typeof kind === 'string' && kind !== 'completed' ? copy.team.memberTurnEnd(kind) : undefined
  }
  return undefined
}

/**
 * Read-only Agent Teams surface behind the terminal contribution seam: one
 * compact strip, one `/team` command, a native-parity roster and shared task
 * board, and teammate transcripts. Team mutations stay in the Team tools and
 * the conversation; this controller never changes a task or roster entry.
 *
 * @module @deepseek-ai/dsh-experimental-tui-agent-team/controller
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-query'
import type { TeamMemberProjectionRow } from './team.ts'
import { readTeamProjection } from './team.ts'
import { copy, setCopyLocale } from './copy.ts'
import { TeamMemberPanel } from './components/team-member-panel.ts'
import { TeamPanel, type TeamMemberRuntime } from './components/team-panel.ts'
import { TeamStrip } from './components/team-strip.ts'
import type { TerminalUiLike } from './types.ts'

/** Read-only Agent Teams controller bound to one terminal launch. */
export class TeamController {
  private readonly ctx: Context
  private readonly ui: TerminalUiLike
  private readonly teamPanel: TeamPanel
  private readonly memberPanel: TeamMemberPanel
  private teamStop: (() => void) | undefined
  private memberStop: (() => void) | undefined

  /**
   * @param ctx - host context carrying the projection, query, and Agent services.
   * @param ui - the terminal contribution seam.
   */
  constructor(ctx: Context, ui: TerminalUiLike) {
    this.ctx = ctx
    this.ui = ui
    this.memberPanel = new TeamMemberPanel(ui.palette, () => { this.backToTeamPanel() })
    this.teamPanel = new TeamPanel(ui.palette, {
      close: () => { this.closeTeamPanel() },
      openMember: (member) => { void this.openMember(member) },
    }, id => this.memberRuntime(id))
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
      run: () => { this.openTeamPanel() },
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
   * Overlay live turn state and the persisted model selection on one member.
   * @param id - durable member Session id.
   * @returns runtime status and model, when known.
   */
  private memberRuntime(id: string): TeamMemberRuntime {
    const sessionId = SessionId(id)
    const live = this.ctx.agents.get(sessionId)
    const session = this.ctx.sessions.get(sessionId)
    const values = session === undefined ? undefined : this.ctx.get('sessionProjections')?.snapshot(session).values
    const model = (values as { modelSelection?: { next?: { model?: string } } } | undefined)?.modelSelection?.next?.model
      ?? live?.options.model
    return {
      status: live?.status === 'running' ? 'running' : 'inactive',
      ...model === undefined ? {} : { model },
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

  /** Present the read-only roster and shared task board. */
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

/**
 * Read-only Agent Teams surface behind the terminal contribution seam: one
 * compact strip, one `/team` command, a read-only member and shared task dock,
 * and teammate transcripts. Team mutations stay in the Team tools and the
 * conversation; this controller never changes a task or the subagent tree.
 *
 * @module @deepseek-ai/dsh-tui-agent-team/controller
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subagent'
import type { TeamMemberRow } from './team.ts'
import { deriveMemberRows, memberRunning, readMemberCatalog, readTeamProjection } from './team.ts'
import { copy, setCopyLocale } from './copy.ts'
import { TeamMemberPanel } from './components/team-member-panel.ts'
import { TeamPanel } from './components/team-panel.ts'
import { TeamStrip } from './components/team-strip.ts'
import type { TerminalUiLike } from './types.ts'

/** Read-only Agent Teams controller bound to one terminal launch. */
export class TeamController {
  private readonly ctx: Context
  private readonly ui: TerminalUiLike
  private readonly teamPanel: TeamPanel
  private readonly memberPanel: TeamMemberPanel
  private readonly subscriptions: (() => void)[] = []
  private members: readonly TeamMemberRow[] = []
  private discovery: AbortController | undefined
  private teamStop: (() => void) | undefined
  private memberStop: (() => void) | undefined

  /**
   * @param ctx - host context carrying the projection, subagent, query, and Agent services.
   * @param ui - the terminal contribution seam.
   */
  constructor(ctx: Context, ui: TerminalUiLike) {
    this.ctx = ctx
    this.ui = ui
    this.memberPanel = new TeamMemberPanel(ui.palette, () => { this.backToTeamPanel() })
    this.teamPanel = new TeamPanel(ui.palette, {
      close: () => { this.closeTeamPanel() },
      openMember: (member) => { void this.openMember(member) },
    }, id => memberRunning(this.ctx, id))
  }

  /**
   * Install every surface through the seam.
   * @returns disposer releasing the contributions and subscriptions.
   */
  install(): () => void {
    setCopyLocale(this.ui.locale)
    const unregisterStrip = this.ui.registerStrip(
      new TeamStrip(this.ui.palette, this.ctx, () => this.projection(), () => this.members),
    )
    const unregisterCommand = this.ui.registerCommand({
      name: 'team',
      description: copy.team.title,
      run: () => { this.openTeamPanel() },
    })
    this.subscriptions.push(
      this.ctx.on('agent/created', () => { this.refreshMembers() }),
      this.ctx.on('agent/disposed', () => { this.refreshMembers() }),
      this.ctx.on('agent/status', ({ agent }) => { this.memberStatusChanged(agent) }),
    )
    const projections = this.ctx.get('sessionProjections')
    if (projections !== undefined) {
      this.subscriptions.push(projections.onChanged((session, key) => {
        if (key === 'subagentCatalog') {
          this.refreshMembers()
          return
        }
        if (key === 'agentTeam' && session.id === this.agent()?.session.id) this.ui.requestRender()
      }))
    }
    this.refreshMembers()
    return () => {
      this.disposeSubscriptions()
      this.closeTeamPanel()
      unregisterCommand()
      unregisterStrip()
    }
  }

  /** Release every live subscription and cancel an in-flight discovery. */
  private disposeSubscriptions(): void {
    for (const dispose of this.subscriptions.splice(0)) dispose()
    this.discovery?.abort()
    this.discovery = undefined
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
   * Repaint after one teammate's turn state changes; unrelated Agents are ignored.
   * @param agent - the Agent whose status flipped.
   */
  private memberStatusChanged(agent: Agent): void {
    const id = String(agent.session.id)
    if (!this.members.some(member => member.id === id)) return
    this.refreshMembers()
  }

  /**
   * Repaint the dock and strip after the cached teammate rows changed.
   * The strip reads the projection live, so only the open dock needs the rows.
   */
  private applyMembers(): void {
    const team = this.projection()
    if (this.teamPanel.active && team !== undefined) this.teamPanel.setTeam(team, this.members)
    this.ui.requestRender()
  }

  /**
   * Refresh the teammate cache without blocking a render: the direct-child
   * catalog paints immediately, then a descendant walk replaces it when it
   * settles. A superseded walk is cancelled, and a failed walk keeps the
   * catalog seed so the visible tree stays usable.
   */
  private refreshMembers(): void {
    const agent = this.agent()
    this.members = readMemberCatalog(this.ctx, agent)
    this.applyMembers()
    if (agent === undefined) return
    const subagents = this.ctx.get('subagents')
    if (subagents === undefined) return
    this.discovery?.abort()
    const discovery = new AbortController()
    this.discovery = discovery
    void subagents.listDescendants(agent.session.id, discovery.signal).then((entries) => {
      if (discovery.signal.aborted) return
      this.discovery = undefined
      this.members = deriveMemberRows(entries)
      this.applyMembers()
    }, () => {
      if (discovery.signal.aborted) return
      this.discovery = undefined
    })
  }

  /**
   * Load one teammate Session into the read-only transcript panel.
   * @param member - selected teammate row.
   */
  private async openMember(member: TeamMemberRow): Promise<void> {
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

  /** Return from the teammate transcript to the member panel. */
  private backToTeamPanel(): void {
    this.memberStop?.()
    this.memberStop = undefined
    this.memberPanel.setTranscript('', [])
    this.openTeamPanel()
  }

  /** Present the read-only member and shared task dock. */
  private openTeamPanel(): void {
    const team = this.projection()
    if (team === undefined) {
      this.closeTeamPanel()
      this.ui.notice(copy.team.unavailable)
      return
    }
    if (!team.enabled) {
      this.closeTeamPanel()
      this.ui.notice(copy.team.disabled)
      return
    }
    this.refreshMembers()
    this.teamPanel.setTeam(team, this.members)
    this.teamStop?.()
    const projections = this.ctx.get('sessionProjections')
    this.teamStop = projections?.onChanged((session) => {
      if (session.id === this.agent()?.session.id) this.refreshTeamPanel()
    })
    this.ui.openDock(this.teamPanel, () => { this.closeTeamPanel() })
  }

  /** Refresh the open dock, closing it when Team mode is switched off. */
  private refreshTeamPanel(): void {
    const team = this.projection()
    if (team === undefined || !team.enabled) {
      this.closeTeamPanel()
      return
    }
    this.teamPanel.setTeam(team, this.members)
    this.ui.requestRender()
  }

  /** Release the Team dock and its projection subscription. */
  private closeTeamPanel(): void {
    this.teamStop?.()
    this.teamStop = undefined
    this.memberStop?.()
    this.memberStop = undefined
    this.teamPanel.setTeam(undefined, [])
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

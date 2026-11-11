import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { DockComponent } from '../src/types.ts'
import { TeamController } from '../src/controller.ts'
import { copy, setCopyLocale } from '../src/copy.ts'
import {
  assistantEvent, controllerHarness, diagnosticEntry, emitAgentEvent, memberEntry, sessionToken, teamProjection,
  teamTask, toolCallEvent, turnEndEvent, userEvent, type ControllerOptions,
} from './harness.ts'

afterEach(() => {
  setCopyLocale('en')
})

/** One installed controller with its harness and disposal. */
interface Installed {
  readonly controller: TeamController
  readonly harness: ReturnType<typeof controllerHarness>
  readonly dispose: () => void
}

/**
 * Install one controller over a fresh harness.
 * @param options - projection, subtree, observation, and service overrides.
 * @returns the controller, harness, and install disposer.
 */
function install(options: ControllerOptions = {}): Installed {
  const harness = controllerHarness(options)
  const controller = new TeamController(harness.ctx, harness.ui)
  const dispose = controller.install()
  return { controller, harness, dispose }
}

/** @returns the text of the latest presented dock. */
function dockText(installed: Installed): string {
  const dock = installed.harness.ui.docks.at(-1)
  return dock === undefined ? '' : dock.component.render(200).join('\n')
}

/** @returns the latest presented dock component. */
function dockComponent(installed: Installed): DockComponent {
  const dock = installed.harness.ui.docks.at(-1)
  if (dock === undefined) throw new Error('no dock was presented')
  return dock.component
}

/** @returns the strip text, or undefined when the strip renders nothing. */
function stripText(installed: Installed): string | undefined {
  const strip = installed.harness.ui.strips[0]
  if (strip === undefined) throw new Error('strip was not registered')
  return strip.render(200)[0]
}

describe('TeamController install', () => {
  it('registers the strip and command and removes them on dispose', () => {
    const installed = install()

    expect(installed.harness.ui.strips).toHaveLength(1)
    expect(installed.harness.ui.commands.get('team')?.description).toBe(copy.team.title)

    installed.dispose()

    expect(installed.harness.ui.strips).toEqual([])
    expect(installed.harness.ui.commands.has('team')).toBe(false)
  })

  it('selects the locale dictionary from the seam', () => {
    install({ locale: 'zh' })

    expect(copy.team.membersTab).toBe('成员')
  })

  it('resolves member runtime services without requiring child injection', async () => {
    const harness = controllerHarness({
      projection: teamProjection(),
      descendants: [memberEntry({ id: 'teammate-1', path: 'reviewer' })],
    })
    harness.ctx.provide('terminalUi', harness.ui as never)
    let child: Context | undefined
    const fiber = await harness.ctx.inject(['terminalUi'], (injected) => { child = injected })
    if (child === undefined) throw new Error('terminalUi injection did not run')
    const controller = new TeamController(child, harness.ui)
    const dispose = controller.install()

    void harness.ui.commands.get('team')?.run(undefined)
    const dock = harness.ui.docks.at(-1)
    if (dock === undefined) throw new Error('no dock was presented')
    expect(() => dock.component.render(200)).not.toThrow()

    dispose()
    await fiber.dispose()
  })

  it('releases every subscription and cancels discovery on dispose', () => {
    const installed = install({ projection: teamProjection(), descendantsPending: true })
    expect(installed.harness.services.projections.listenerCount()).toBe(1)

    void installed.harness.ui.commands.get('team')?.run(undefined)
    expect(installed.harness.services.projections.listenerCount()).toBe(2)

    const discovery = installed.harness.services.subagents.calls[0]
    installed.dispose()

    expect(installed.harness.services.projections.listenerCount()).toBe(0)
    expect(discovery?.signal?.aborted).toBe(true)
  })
})

describe('TeamController strip', () => {
  it('renders derived teammates and running counts, hiding when Team mode is off', () => {
    const installed = install({
      projection: teamProjection(),
      descendants: [memberEntry({ id: 'teammate-1', path: 'reviewer' })],
    })
    installed.harness.services.agentStatuses.set('teammate-1', 'running')

    expect(stripText(installed)).toContain(copy.team.teammates(1))
    expect(stripText(installed)).toContain(copy.team.running(1))

    installed.harness.services.projections.values.agentTeam = teamProjection({ enabled: false })
    expect(stripText(installed)).toBeUndefined()
  })

  it('renders a task-only Team and a projection failure', () => {
    const installed = install({ projection: teamProjection({ tasks: [teamTask()] }) })

    expect(stripText(installed)).toContain(copy.team.tasks(1))

    installed.harness.services.projections.values.agentTeam = teamProjection({ failure: 'bad record' })
    expect(stripText(installed)).toContain(copy.team.failure('bad record'))
  })

  it('renders nothing for an enabled Team with no teammates and no tasks', () => {
    const installed = install({ projection: teamProjection() })

    expect(stripText(installed)).toBeUndefined()
  })
})

describe('TeamController /team command', () => {
  it('closes the dock on Escape', () => {
    const installed = install({ projection: teamProjection() })
    void installed.harness.ui.commands.get('team')?.run(undefined)

    dockComponent(installed).handleInput('\u001b')

    expect(installed.harness.ui.closed.count).toBe(1)
  })

  it('falls back to the direct-child catalog without the subagent runtime', () => {
    const installed = install({
      projection: teamProjection(),
      descendants: [memberEntry({ id: 'teammate-1', path: 'reviewer' })],
      withoutSubagents: true,
    })

    expect(stripText(installed)).toContain(copy.team.teammates(1))
    void installed.harness.ui.commands.get('team')?.run(undefined)
    expect(dockText(installed)).toContain('reviewer')
  })

  it('ignores a superseded discovery failure', async () => {
    const installed = install({ projection: teamProjection(), descendantsError: new Error('catalog unavailable') })

    emitAgentEvent(installed.harness.ctx, 'agent/created', 'teammate-1')
    await Promise.resolve()
    await Promise.resolve()

    expect(installed.harness.services.subagents.calls).toHaveLength(2)
    expect(installed.harness.ui.notices).toEqual([])
  })

  it('opens the read-only dock for every argument form', () => {
    const installed = install({ projection: teamProjection() })
    const command = installed.harness.ui.commands.get('team')

    for (const argument of [undefined, 'task Inspect the workspace', 'message Worker hi', 'unknown']) {
      void command?.run(argument)
    }

    expect(installed.harness.ui.docks).toHaveLength(4)
    expect(installed.harness.ui.notices).toEqual([])
    expect(installed.harness.ui.editors).toEqual([])
    expect(dockText(installed)).toContain(copy.team.title)
    expect(dockText(installed)).toContain(copy.team.membersTab)
    expect(dockText(installed)).toContain(copy.team.hint)
  })

  it('reports the unavailable notice without a projection', () => {
    const installed = install()

    void installed.harness.ui.commands.get('team')?.run(undefined)

    expect(installed.harness.ui.docks).toEqual([])
    expect(installed.harness.ui.notices).toContain(copy.team.unavailable)
  })

  it('reports that Team mode is off instead of opening the dock', () => {
    const installed = install({ projection: teamProjection({ enabled: false }) })

    void installed.harness.ui.commands.get('team')?.run(undefined)

    expect(installed.harness.ui.docks).toEqual([])
    expect(installed.harness.ui.notices).toContain(copy.team.disabled)
  })

  it('opens a read-only task detail and performs no task or message actions', () => {
    const installed = install({
      projection: teamProjection({
        tasks: [teamTask({ description: 'Full description from the projection.' })],
      }),
    })
    void installed.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(installed).handleInput('\t')
    dockComponent(installed).handleInput('\r')

    const text = dockText(installed)
    expect(text).toContain('Inspect the workspace')
    expect(text).toContain('Full description from the projection.')
    expect(text).toContain(copy.team.detailHint)

    for (const key of ['a', 'c', 'n', 'm']) dockComponent(installed).handleInput(key)
    expect(installed.harness.ui.editors).toEqual([])
    expect(installed.harness.ui.notices).toEqual([])
    expect(dockText(installed)).toContain('Full description from the projection.')

    dockComponent(installed).handleInput('\u001b')
    expect(dockText(installed)).toContain(copy.team.hint)
  })

  it('renders derived member rows with names, statuses, and descriptions', async () => {
    const installed = install({
      projection: teamProjection(),
      descendants: [
        memberEntry({ id: 'teammate-1', path: 'reviewer', label: 'Reviews diffs' }),
        diagnosticEntry({ id: 'teammate-2', path: 'reviewer/broken', reason: 'corrupt' }),
      ],
    })
    installed.harness.services.agentStatuses.set('teammate-1', 'running')
    void installed.harness.ui.commands.get('team')?.run(undefined)
    await waitFor(() => dockText(installed).includes('reviewer/broken'))
    const text = dockText(installed)

    expect(text).toContain(`reviewer  ${copy.team.memberStatuses.running} · Reviews diffs`)
    expect(text).toContain(copy.team.memberReasons.corrupt)
  })

  it('paints the direct-child catalog before descendant discovery settles', () => {
    const installed = install({
      projection: teamProjection(),
      descendants: [memberEntry({ id: 'teammate-1', path: 'reviewer' })],
      descendantsPending: true,
    })
    void installed.harness.ui.commands.get('team')?.run(undefined)

    expect(stripText(installed)).toContain(copy.team.teammates(1))
    expect(dockText(installed)).toContain('reviewer')
    expect(stripText(installed)).toBeDefined()
  })

  it('replaces the catalog seed with discovered descendants', async () => {
    const installed = install({
      projection: teamProjection(),
      subagentCatalog: [],
      descendants: [memberEntry({ id: 'teammate-1', path: 'reviewer' })],
    })
    expect(stripText(installed)).toBeUndefined()

    await waitFor(() => stripText(installed)?.includes(copy.team.teammates(1)) === true)
  })

  it('keeps the catalog seed when descendant discovery fails', async () => {
    const installed = install({
      projection: teamProjection(),
      descendants: [memberEntry({ id: 'teammate-1', path: 'reviewer' })],
      descendantsError: new Error('catalog unavailable'),
    })

    expect(stripText(installed)).toContain(copy.team.teammates(1))
    await Promise.resolve()
    expect(stripText(installed)).toContain(copy.team.teammates(1))
  })

  it('refreshes discovery on Agent and catalog changes and ignores foreign statuses', async () => {
    const installed = install({ projection: teamProjection(), descendants: [] })
    await waitFor(() => installed.harness.services.subagents.calls.length === 1)

    emitAgentEvent(installed.harness.ctx, 'agent/created', 'teammate-1')
    await waitFor(() => installed.harness.services.subagents.calls.length === 2)

    installed.harness.services.subagents.entries = [memberEntry({ id: 'teammate-1', path: 'reviewer' })]
    installed.harness.services.projections.values.subagentCatalog = [
      { id: sessionToken('teammate-1').id, createdAt: 1, mode: 'continuable', label: 'Reviews diffs', name: 'reviewer' },
    ]
    installed.harness.services.projections.emit(installed.harness.agent.session, 'subagentCatalog')
    await waitFor(() => installed.harness.services.subagents.calls.length === 3)
    expect(stripText(installed)).toContain(copy.team.teammates(1))

    emitAgentEvent(installed.harness.ctx, 'agent/status', 'teammate-1')
    await waitFor(() => installed.harness.services.subagents.calls.length === 4)

    emitAgentEvent(installed.harness.ctx, 'agent/status', 'foreign')
    emitAgentEvent(installed.harness.ctx, 'agent/disposed', 'teammate-1')
    await waitFor(() => installed.harness.services.subagents.calls.length === 5)

    installed.harness.services.projections.emit(installed.harness.agent.session, 'agentTeam')
    await Promise.resolve()
    expect(installed.harness.ui.renders).toBeGreaterThan(0)
  })
})

describe('TeamController teammate transcript', () => {
  it('observes the teammate Session, formats durable events, and appends live lines', async () => {
    const installed = install({
      projection: teamProjection(),
      descendants: [memberEntry({ id: 'teammate-1', path: 'reviewer' })],
      events: [
        userEvent('hello from the lead'),
        assistantEvent('assistant answer'),
        toolCallEvent('bash'),
        turnEndEvent('blocked'),
        { type: 'turn/end', data: { reason: { kind: 'completed' } } },
        { type: 'tool/call', data: { name: 42 } },
        { type: 'user/message', data: { content: [{ type: 'text', text: '   ' }] } },
        { type: 'user/message', data: {} },
        { type: 'assistant/message', data: { message: { content: [{ type: 'image' }] } } },
        { type: 'assistant/message', data: { message: {} } },
        { type: 'user/message', data: { content: [{ type: 'text' }] } },
        { type: 'user/message', data: { content: [{ type: 'image' }] } },
        { type: 'assistant/message', data: { message: { content: [{ type: 'text' }] } } },
        { type: 'command/run', data: { name: 'status' } },
      ],
    })
    void installed.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(installed).handleInput('\r')
    await waitFor(() => installed.harness.services.observed.length === 1)

    expect(installed.harness.services.observed[0]).toEqual({
      sessionId: 'teammate-1',
      options: { projectionMode: 'all' },
    })
    const loaded = dockText(installed)
    expect(loaded).toContain(copy.team.memberTitle('reviewer'))
    expect(loaded).toContain(copy.team.memberUser('hello from the lead'))
    expect(loaded).toContain(copy.team.memberAssistant('assistant answer'))
    expect(loaded).toContain(copy.team.memberTool('bash'))
    expect(loaded).toContain(copy.team.memberTurnEnd('blocked'))

    installed.harness.ctx.emit('session/event', sessionToken('teammate-1') as never, userEvent('live line') as never)
    await waitFor(() => dockText(installed).includes(copy.team.memberUser('live line')))
    installed.harness.ctx.emit('session/event', sessionToken('someone-else') as never, userEvent('foreign') as never)
    installed.harness.ctx.emit('session/event', sessionToken('teammate-1') as never, { type: 'command/run', data: {} } as never)
    await Promise.resolve()
    expect(dockText(installed)).not.toContain(copy.team.memberUser('foreign'))

    dockComponent(installed).handleInput('\u001b')
    expect(dockText(installed)).toContain(copy.team.title)

    dockComponent(installed).handleInput('\r')
    await waitFor(() => installed.harness.services.observed.length === 2)
    installed.harness.ui.docks.at(-1)?.close()
    expect(dockText(installed)).toContain(copy.team.title)
  })

  it('reports unavailable history without the query service', async () => {
    const installed = install({
      projection: teamProjection(),
      descendants: [memberEntry({ id: 'teammate-1', path: 'reviewer' })],
      withoutQuery: true,
    })
    void installed.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(installed).handleInput('\r')

    await waitFor(() => installed.harness.ui.notices.includes(copy.team.historyUnavailable))
    expect(installed.harness.services.observed).toEqual([])
  })

  it('reports history read failures thrown as Error and non-Error', async () => {
    const failing = install({
      projection: teamProjection(),
      descendants: [memberEntry({ id: 'teammate-1', path: 'reviewer' })],
      queryError: new Error('history unavailable'),
    })
    void failing.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(failing).handleInput('\r')
    await waitFor(() => failing.harness.ui.notices.includes(copy.team.actionFailed('history unavailable')))

    const nonError = install({
      projection: teamProjection(),
      descendants: [memberEntry({ id: 'teammate-1', path: 'reviewer' })],
      queryError: 'history unavailable',
    })
    void nonError.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(nonError).handleInput('\r')
    await waitFor(() => nonError.harness.ui.notices.includes(copy.team.actionFailed('history unavailable')))
  })
})

describe('TeamController projection updates', () => {
  it('refreshes an open dock and closes it when Team mode turns off or the projection disappears', () => {
    const installed = install({ projection: teamProjection({ tasks: [teamTask({ subject: 'Initial task' })] }) })
    void installed.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(installed).handleInput('\t')
    expect(dockText(installed)).toContain('Initial task')

    installed.harness.services.projections.values.agentTeam = teamProjection({ tasks: [teamTask({ subject: 'Updated task' })] })
    installed.harness.services.projections.emit(installed.harness.agent.session, 'agentTeam')
    expect(dockText(installed)).toContain('Updated task')
    expect(installed.harness.ui.renders).toBeGreaterThan(0)

    installed.harness.services.projections.emit({ id: 'foreign' }, 'agentTeam')
    expect(dockText(installed)).toContain('Updated task')

    installed.harness.services.projections.values.agentTeam = teamProjection({ enabled: false })
    installed.harness.services.projections.emit(installed.harness.agent.session, 'agentTeam')
    expect(installed.harness.ui.closed.count).toBe(1)

    void installed.harness.ui.commands.get('team')?.run(undefined)
    delete installed.harness.services.projections.values.agentTeam
    installed.harness.services.projections.emit(installed.harness.agent.session, 'agentTeam')
    expect(installed.harness.ui.closed.count).toBe(2)
  })

  it('closes the dock through the dock close callback', () => {
    const installed = install({ projection: teamProjection() })
    void installed.harness.ui.commands.get('team')?.run(undefined)
    const dock = installed.harness.ui.docks.at(-1)

    dock?.close()

    expect(installed.harness.ui.closed.count).toBe(1)
    expect(installed.harness.services.projections.listenerCount()).toBe(1)
  })

  it('refreshes the open dock when member rows change', async () => {
    const installed = install({
      projection: teamProjection(),
      subagentCatalog: [],
      descendants: [],
    })
    void installed.harness.ui.commands.get('team')?.run(undefined)
    expect(dockText(installed)).toContain(copy.team.emptyMembers)

    installed.harness.services.subagents.entries = [memberEntry({ id: 'teammate-1', path: 'reviewer' })]
    emitAgentEvent(installed.harness.ctx, 'agent/created', 'teammate-1')
    await waitFor(() => dockText(installed).includes('reviewer'))
  })
})

/**
 * Poll until the predicate holds.
 * @param predicate - condition to await.
 */
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition was not met')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

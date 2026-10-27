import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { DockComponent } from '../src/types.ts'
import { TeamController } from '../src/controller.ts'
import { copy, setCopyLocale } from '../src/copy.ts'
import {
  assistantEvent, controllerHarness, sessionToken, teamMember, teamProjection, teamTask,
  toolCallEvent, turnEndEvent, userEvent, type ControllerOptions,
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
 * @param options - projection, observation, and service overrides.
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
      projection: teamProjection({
        members: [teamMember(), teamMember({ id: 'teammate-1', name: 'Worker', role: 'teammate' })],
      }),
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
})

describe('TeamController strip', () => {
  it('renders the strip for a visible Team and hides it for a lead-only one', () => {
    const installed = install({
      projection: teamProjection({
        members: [teamMember(), teamMember({ id: 'teammate-1', name: 'Worker', role: 'teammate' })],
      }),
    })
    installed.harness.services.agentStatuses.set('teammate-1', 'running')

    const strip = installed.harness.ui.strips[0]
    if (strip === undefined) throw new Error('strip was not registered')
    const [line] = strip.render(200).map(text => text)

    expect(line).toContain(copy.team.teammates(1))
    expect(line).toContain(copy.team.running(1))

    installed.harness.services.projections.values.agentTeam = teamProjection()
    expect(strip.render(200)).toEqual([])
  })
})

describe('TeamController /team command', () => {
  it('opens the read-only roster for every argument form', () => {
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

  it('opens a read-only task detail and performs no task or message actions', () => {
    const installed = install({
      projection: teamProjection({
        members: [teamMember(), teamMember({ id: 'teammate-1', name: 'Worker', role: 'teammate', phase: 'active' })],
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

  it('opens a member transcript only for active teammates', () => {
    const installed = install({
      projection: teamProjection({
        members: [
          teamMember(),
          teamMember({ id: 'teammate-1', name: 'Worker', role: 'teammate', phase: 'active' }),
          teamMember({ id: 'teammate-2', name: 'Broken', role: 'teammate', phase: 'failed' }),
        ],
      }),
    })
    void installed.harness.ui.commands.get('team')?.run(undefined)

    dockComponent(installed).handleInput('\r')
    expect(installed.harness.services.observed).toEqual([])
    dockComponent(installed).handleInput('\u001b[B')
    dockComponent(installed).handleInput('\r')
    expect(installed.harness.services.observed).toHaveLength(1)
  })

  it('overlays live status and the persisted model on member rows', async () => {
    const installed = install({
      projection: teamProjection({
        members: [teamMember(), teamMember({ id: 'teammate-1', name: 'Worker', role: 'teammate', phase: 'active' })],
      }),
      members: { 'teammate-1': { status: 'running', model: 'live/m', sessionModel: 'persisted/m' } },
    })
    void installed.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(installed).handleInput('\u001b[B')
    await waitFor(() => dockText(installed).includes(copy.team.model))

    expect(dockText(installed)).toContain(copy.team.memberStatuses.running)
    expect(dockText(installed)).toContain('Model: persisted/m')

    installed.harness.services.members.set('teammate-1', { status: 'inactive', model: 'live/m', withoutSession: true })
    dockComponent(installed).handleInput('\u001b[A')
    dockComponent(installed).handleInput('\u001b[B')
    expect(dockText(installed)).toContain(copy.team.memberStatuses.inactive)
    expect(dockText(installed)).toContain('Model: live/m')

    installed.harness.services.members.set('teammate-1', { withoutAgent: true, sessionModel: 'persisted/m' })
    dockComponent(installed).handleInput('\u001b[A')
    dockComponent(installed).handleInput('\u001b[B')
    expect(dockText(installed)).toContain(copy.team.memberStatuses.inactive)
    expect(dockText(installed)).toContain('Model: persisted/m')
  })

  it('closes the roster dock on Escape and unsubscribes on install dispose', () => {
    const installed = install({ projection: teamProjection() })
    void installed.harness.ui.commands.get('team')?.run(undefined)

    dockComponent(installed).handleInput('\u001b')

    expect(installed.harness.ui.closed.count).toBe(1)
    expect(installed.harness.services.projections.listenerCount()).toBe(0)

    void installed.harness.ui.commands.get('team')?.run(undefined)
    expect(installed.harness.services.projections.listenerCount()).toBe(1)
    installed.dispose()
    expect(installed.harness.services.projections.listenerCount()).toBe(0)
  })
})

describe('TeamController teammate transcript', () => {
  it('observes the teammate Session, formats durable events, and appends live lines', async () => {
    const installed = install({
      projection: teamProjection({
        members: [teamMember(), teamMember({ id: 'teammate-1', name: 'Worker', role: 'teammate' })],
      }),
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
    dockComponent(installed).handleInput('\u001b[B')
    dockComponent(installed).handleInput('\r')
    await waitFor(() => installed.harness.services.observed.length === 1)

    expect(installed.harness.services.observed[0]).toEqual({
      sessionId: 'teammate-1',
      options: { projectionMode: 'all' },
    })
    const loaded = dockText(installed)
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

    dockComponent(installed).handleInput('\u001b[B')
    dockComponent(installed).handleInput('\r')
    await waitFor(() => installed.harness.services.observed.length === 2)
    installed.harness.ui.docks.at(-1)?.close()
    expect(dockText(installed)).toContain(copy.team.title)
  })

  it('reports unavailable history without the query service', async () => {
    const installed = install({
      projection: teamProjection({
        members: [teamMember(), teamMember({ id: 'teammate-1', name: 'Worker', role: 'teammate' })],
      }),
      withoutQuery: true,
    })
    void installed.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(installed).handleInput('\u001b[B')
    dockComponent(installed).handleInput('\r')

    await waitFor(() => installed.harness.ui.notices.includes(copy.team.historyUnavailable))
    expect(installed.harness.services.observed).toEqual([])
  })

  it('reports history read failures thrown as Error and non-Error', async () => {
    const failing = install({
      projection: teamProjection({
        members: [teamMember(), teamMember({ id: 'teammate-1', name: 'Worker', role: 'teammate' })],
      }),
      queryError: new Error('history unavailable'),
    })
    void failing.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(failing).handleInput('\u001b[B')
    dockComponent(failing).handleInput('\r')
    await waitFor(() => failing.harness.ui.notices.includes(copy.team.actionFailed('history unavailable')))

    const nonError = install({
      projection: teamProjection({
        members: [teamMember(), teamMember({ id: 'teammate-1', name: 'Worker', role: 'teammate' })],
      }),
      queryError: 'history unavailable',
    })
    void nonError.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(nonError).handleInput('\u001b[B')
    dockComponent(nonError).handleInput('\r')
    await waitFor(() => nonError.harness.ui.notices.includes(copy.team.actionFailed('history unavailable')))
  })
})

describe('TeamController projection updates', () => {
  it('refreshes an open roster and closes it when the projection disappears', () => {
    const installed = install({ projection: teamProjection({ tasks: [teamTask({ subject: 'Initial task' })] }) })
    void installed.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(installed).handleInput('\t')
    expect(dockText(installed)).toContain('Initial task')

    installed.harness.services.projections.values.agentTeam = teamProjection({ tasks: [teamTask({ subject: 'Updated task' })] })
    installed.harness.services.projections.emit(installed.harness.agent.session)
    expect(dockText(installed)).toContain('Updated task')
    expect(installed.harness.ui.renders).toBeGreaterThan(0)

    installed.harness.services.projections.emit({ id: 'foreign' })
    expect(dockText(installed)).toContain('Updated task')

    delete installed.harness.services.projections.values.agentTeam
    installed.harness.services.projections.emit(installed.harness.agent.session)
    expect(installed.harness.ui.closed.count).toBe(1)
  })

  it('closes the roster and member panels through the dock close callback', () => {
    const installed = install({ projection: teamProjection() })
    void installed.harness.ui.commands.get('team')?.run(undefined)
    const roster = installed.harness.ui.docks.at(-1)

    roster?.close()

    expect(installed.harness.ui.closed.count).toBe(1)
    expect(installed.harness.services.projections.listenerCount()).toBe(0)
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

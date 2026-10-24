import { afterEach, describe, expect, it } from 'vitest'
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
  it('opens the roster dock without an argument', () => {
    const installed = install({ projection: teamProjection() })
    const command = installed.harness.ui.commands.get('team')

    void command?.run(undefined)

    expect(installed.harness.ui.docks).toHaveLength(1)
    expect(dockText(installed)).toContain(copy.team.title)
    expect(dockText(installed)).toContain(copy.team.membersTab)
  })

  it('reports the unavailable notice without a projection', () => {
    const installed = install()

    void installed.harness.ui.commands.get('team')?.run(undefined)

    expect(installed.harness.ui.docks).toEqual([])
    expect(installed.harness.ui.notices).toContain(copy.team.unavailable)
  })

  it('creates a shared task through the command', async () => {
    const installed = install()
    void installed.harness.ui.commands.get('team')?.run('task Inspect the workspace')

    await waitFor(() => installed.harness.services.created.length === 1)
    expect(installed.harness.services.created).toEqual([
      { subject: 'Inspect the workspace', description: 'Inspect the workspace' },
    ])
    expect(installed.harness.ui.notices).toContain(copy.team.taskCreated('task-new'))
  })

  it('reports invalid argument forms as usage', () => {
    const installed = install()
    const command = installed.harness.ui.commands.get('team')

    void command?.run('task   ')
    void command?.run('message Worker')
    void command?.run('unknown')

    expect(installed.harness.ui.notices).toEqual([copy.team.usage, copy.team.usage, copy.team.usage])
  })

  it('sends a teammate message through the command', async () => {
    const installed = install()
    void installed.harness.ui.commands.get('team')?.run('message Worker please look')

    await waitFor(() => installed.harness.services.messages.length === 1)
    expect(installed.harness.services.messages).toEqual([
      { target: 'Worker', text: 'please look' },
    ])
    expect(installed.harness.ui.notices).toContain(copy.team.messageSent('Worker'))
  })

  it('reports success and failure paths for task and message actions', async () => {
    const failing = install({ serviceError: new Error('service rejected') })
    void failing.harness.ui.commands.get('team')?.run('task anything')
    await waitFor(() => failing.harness.ui.notices.includes(copy.team.actionFailed('service rejected')))

    const nonError = install({ serviceError: 'service rejected' })
    void nonError.harness.ui.commands.get('team')?.run('message Worker hi')
    await waitFor(() => nonError.harness.ui.notices.includes(copy.team.actionFailed('service rejected')))

    const missing = install({ withoutTeamService: true })
    void missing.harness.ui.commands.get('team')?.run('task anything')
    void missing.harness.ui.commands.get('team')?.run('message Worker hi')
    await waitFor(() => missing.harness.ui.notices.filter(text => text === copy.team.unavailable).length === 2)

    const agentless = install({ withoutAgent: true })
    void agentless.harness.ui.commands.get('team')?.run('task anything')
    await waitFor(() => agentless.harness.ui.notices.includes(copy.team.unavailable))
  })

  it('claims and completes tasks through the dock actions', async () => {
    const installed = install({
      projection: teamProjection({
        tasks: [
          teamTask({ id: 'first', revision: 3 }),
          teamTask({ id: 'second', revision: 8, status: 'in_progress' }),
        ],
      }),
    })
    void installed.harness.ui.commands.get('team')?.run(undefined)
    const panel = dockComponent(installed)
    panel.handleInput('\t')
    panel.handleInput('a')
    await waitFor(() => installed.harness.services.updates.length === 1)
    panel.handleInput('\u001b[B')
    panel.handleInput('c')
    await waitFor(() => installed.harness.services.updates.length === 2)

    expect(installed.harness.services.updates).toEqual([
      { taskId: 'first', expectedRevision: 3, action: 'claim' },
      { taskId: 'second', expectedRevision: 8, action: 'complete' },
    ])
    expect(installed.harness.ui.notices).toContain(copy.team.taskClaimed('first'))
    expect(installed.harness.ui.notices).toContain(copy.team.taskCompleted('second'))
  })

  it('reports non-Error create, message, and update failures', async () => {
    const createFailure = install({ serviceError: 'service rejected' })
    void createFailure.harness.ui.commands.get('team')?.run('task anything')
    await waitFor(() => createFailure.harness.ui.notices.includes(copy.team.actionFailed('service rejected')))

    const messageFailure = install({ serviceError: new Error('message rejected') })
    void messageFailure.harness.ui.commands.get('team')?.run('message Worker hi')
    await waitFor(() => messageFailure.harness.ui.notices.includes(copy.team.actionFailed('message rejected')))

    const updateFailure = install({
      projection: teamProjection({ tasks: [teamTask()] }),
      serviceError: 'update rejected',
    })
    void updateFailure.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(updateFailure).handleInput('\t')
    dockComponent(updateFailure).handleInput('a')
    await waitFor(() => updateFailure.harness.ui.notices.includes(copy.team.actionFailed('update rejected')))
  })

  it('reports task action failures and unavailable services', async () => {
    const failing = install({
      projection: teamProjection({ tasks: [teamTask()] }),
      serviceError: new Error('stale revision'),
    })
    void failing.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(failing).handleInput('\t')
    dockComponent(failing).handleInput('a')
    await waitFor(() => failing.harness.ui.notices.includes(copy.team.actionFailed('stale revision')))

    const missing = install({ projection: teamProjection({ tasks: [teamTask()] }), withoutTeamService: true })
    void missing.harness.ui.commands.get('team')?.run(undefined)
    dockComponent(missing).handleInput('\t')
    dockComponent(missing).handleInput('a')
    await waitFor(() => missing.harness.ui.notices.includes(copy.team.unavailable))
  })

  it('pre-fills the composer from the roster and task tabs', () => {
    const installed = install({
      projection: teamProjection({
        members: [teamMember(), teamMember({ id: 'teammate-1', name: 'Worker', role: 'teammate' })],
        tasks: [teamTask()],
      }),
    })
    const command = installed.harness.ui.commands.get('team')

    void command?.run(undefined)
    dockComponent(installed).handleInput('\u001b[B')
    dockComponent(installed).handleInput('m')
    expect(installed.harness.ui.editors.at(-1)).toBe('/team message Worker ')

    void command?.run(undefined)
    dockComponent(installed).handleInput('n')
    expect(installed.harness.ui.editors.at(-1)).toBe('/team task ')

    void command?.run(undefined)
    dockComponent(installed).handleInput('\t')
    dockComponent(installed).handleInput('n')
    expect(installed.harness.ui.editors.at(-1)).toBe('/team task ')
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

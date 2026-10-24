import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandId } from '@deepseek-ai/dsh-commands'
import type { CommandDescriptor } from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Composer, type ComposerDeps, type LocalCommands } from '../../src/commands.ts'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { chinese, copy, setCopyLocale } from '../../src/copy.ts'
import { mountSessions } from '../support/fakes.ts'
import {
  agentDouble, commandsDouble, freshContext, type AgentDouble, type CommandsDouble,
} from './harness.ts'

afterEach(() => {
  setCopyLocale('en')
})

/** One composer under test with its recorded outcomes. */
interface ComposerHarness {
  readonly composer: Composer
  readonly commands: CommandsDouble
  readonly local: string[]
  readonly reasoningArgs: (string | undefined)[]
  readonly effortArgs: (string | undefined)[]
  readonly permissionArgs: (string | undefined)[]
  readonly queueArgs: (string | undefined)[]
  readonly presetArgs: (string | undefined)[]
  readonly configures: string[]
  readonly notices: string[]
  readonly agent: AgentDouble
  readonly ready: (agent: Agent | undefined) => void
}

/**
 * Build one composer over a real Session store and a command-registry double.
 * @param options - descriptors, execution override, and initial Agent status.
 * @returns the composer harness.
 */
async function composerHarness(options: {
  descriptors?: readonly CommandDescriptor[]
  execute?: (line: string) => Promise<import('@deepseek-ai/dsh-commands').CommandExecution | undefined>
  status?: 'idle' | 'running'
  expandPrompt?: ComposerDeps['expandPrompt']
  choices?: ComposerDeps['choices']
} = {}): Promise<ComposerHarness> {
  const ctx = freshContext()
  await mountSessions(ctx)
  const session = ctx.sessions.create(SessionId('composer-session'))
  const agent = agentDouble({ session, ...(options.status === undefined ? {} : { status: options.status }) })
  const commands = commandsDouble({
    ...(options.descriptors === undefined ? {} : { descriptors: options.descriptors }),
    ...(options.execute === undefined ? {} : { execute: options.execute }),
  })
  ctx.provide('commands', commands.service)
  const local: string[] = []
  const reasoningArgs: (string | undefined)[] = []
  const effortArgs: (string | undefined)[] = []
  const permissionArgs: (string | undefined)[] = []
  const queueArgs: (string | undefined)[] = []
  const presetArgs: (string | undefined)[] = []
  const configures: string[] = []
  const notices: string[] = []
  let presented: Agent | undefined = agent.agent
  const record = (name: string) => (): void => { local.push(name) }
  const controls: LocalCommands = {
    help: record('help'),
    status: record('status'),
    model: record('model'),
    clear: record('clear'),
    reasoning: (argument) => { local.push('reasoning'); reasoningArgs.push(argument) },
    cards: record('cards'),
    redraw: record('redraw'),
    effort: (argument) => { local.push('effort'); effortArgs.push(argument) },
    permission: (argument) => { local.push('permission'); permissionArgs.push(argument) },
    queue: (argument) => { local.push('queue'); queueArgs.push(argument) },
    config: () => { local.push('config'); configures.push('config') },
    preset: (argument) => { local.push('preset'); presetArgs.push(argument) },
    exit: record('exit'),
  }
  const composer = new Composer({
    ctx,
    agent: () => presented,
    local: controls,
    notice: (text) => { notices.push(text) },
    ...(options.expandPrompt === undefined ? {} : { expandPrompt: options.expandPrompt }),
    ...(options.choices === undefined ? {} : { choices: options.choices }),
  })
  return {
    composer,
    commands,
    local,
    reasoningArgs,
    effortArgs,
    permissionArgs,
    queueArgs,
    presetArgs,
    configures,
    notices,
    agent,
    ready: (next) => { presented = next },
  }
}

describe('Composer.submit', () => {
  it.each([
    ['help', 'help'],
    ['status', 'status'],
    ['model', 'model'],
    ['clear', 'clear'],
    ['reasoning', 'reasoning'],
    ['cards', 'cards'],
    ['redraw', 'redraw'],
    ['effort', 'effort'],
    ['permission', 'permission'],
    ['queue', 'queue'],
    ['config', 'config'],
    ['preset', 'preset'],
    ['exit', 'exit'],
    ['quit', 'exit'],
  ] as const)('runs the terminal-local /%s control', async (name, control) => {
    const harness = await composerHarness()

    harness.composer.submit(`/${name}`)

    expect(harness.local).toEqual([control])
    expect(harness.commands.executed).toEqual([])
  })

  it('runs a local control with trailing arguments and tabs', async () => {
    const harness = await composerHarness()

    harness.composer.submit('/help\tignored')
    harness.composer.submit('/status later')

    expect(harness.local).toEqual(['help', 'status'])
  })

  it.each(['', '   ', '\n\t '])('ignores blank input %j', async (line) => {
    const harness = await composerHarness()

    harness.composer.submit(line)

    expect(harness.local).toEqual([])
    expect(harness.notices).toEqual([])
    expect(harness.agent.received).toEqual([])
  })

  it('treats a slash line with an uppercase name as a prompt', async () => {
    const harness = await composerHarness()

    harness.composer.submit('/Help me')

    expect(harness.agent.received).toEqual(['/Help me'])
    expect(harness.local).toEqual([])
  })

  it('reports an unregistered command while the agent is not ready', async () => {
    const harness = await composerHarness()
    harness.ready(undefined)

    harness.composer.submit('/missing')

    expect(harness.notices).toEqual(['The agent is not ready yet.'])
  })

  it('reports an unknown registered command', async () => {
    const harness = await composerHarness({ execute: async () => undefined })

    harness.composer.submit('/missing')
    await vi.waitFor(() => {
      expect(harness.notices).toEqual(['Unknown command: /missing. Type /help for the available commands.'])
    })
    expect(harness.commands.executed).toEqual(['/missing'])
  })

  it('stays silent when the registered command settles successfully', async () => {
    const harness = await composerHarness({
      execute: async () => ({ commandId: CommandId('command-1'), result: { kind: 'success' } }),
    })

    harness.composer.submit('/inspect')
    await Promise.resolve()
    await Promise.resolve()

    expect(harness.commands.executed).toEqual(['/inspect'])
    expect(harness.notices).toEqual([])
  })

  it.each([
    ['an Error', new Error('inspect failed'), 'Command failed: inspect failed'],
    ['a non-Error', 'inspect failed', 'Command failed: inspect failed'],
  ] as const)('reports a command rejection from %s', async (_label, rejection, message) => {
    const harness = await composerHarness({
      execute: async () => { throw rejection },
    })

    harness.composer.submit('/inspect')

    await vi.waitFor(() => { expect(harness.notices).toEqual([message]) })
  })

  it('reports a prompt while the agent is not ready', async () => {
    const harness = await composerHarness()
    harness.ready(undefined)

    harness.composer.submit('hello')

    expect(harness.notices).toEqual(['The agent is not ready yet.'])
    expect(harness.agent.received).toEqual([])
  })

  it('follows up with a prompt while the agent is idle', async () => {
    const harness = await composerHarness({ status: 'idle' })

    harness.composer.submit('  keep exact text ')

    expect(harness.agent.received).toEqual(['  keep exact text '])
  })

  it('steers a prompt while the agent is running', async () => {
    const harness = await composerHarness({ status: 'running' })

    harness.composer.submit('steer this')

    expect(harness.agent.received).toEqual(['steer this'])
  })

  it('sends the expanded prompt content and reports its notices', async () => {
    const attachment = {
      attachmentId: AttachmentId('attachment-1'),
      mediaType: 'image/png' as const,
      bytes: 3,
      width: 1,
      height: 1,
    }
    const content: ContentBlock[] = [{ type: 'text', text: 'look @a.png' }, { type: 'image', attachment }]
    const harness = await composerHarness({
      expandPrompt: async () => ({ content, notices: ['first notice', 'second notice'] }),
    })
    const sent: ContentBlock[][] = []
    vi.spyOn(harness.agent.agent, 'followup').mockImplementation((message) => { sent.push([...message.content]) })

    harness.composer.submit('look @a.png')

    await vi.waitFor(() => { expect(sent).toHaveLength(1) })
    expect(sent[0]?.map(block => block.type)).toEqual(['text', 'image'])
    expect(harness.notices).toEqual(['first notice', 'second notice'])
  })

  it('omits the expansion for a composition without mention services', async () => {
    const harness = await composerHarness()
    const sent: ContentBlock[][] = []
    vi.spyOn(harness.agent.agent, 'followup').mockImplementation((message) => { sent.push([...message.content]) })

    harness.composer.submit('plain @a.png prompt')

    expect(sent).toEqual([[{ type: 'text', text: 'plain @a.png prompt' }]])
    expect(harness.notices).toEqual([])
  })

  it.each([
    ['an Error', new Error('mentions failed'), 'mentions failed'],
    ['a non-Error', 'mentions failed', 'mentions failed'],
  ])('falls back to the plain prompt when expansion rejects with %s', async (_label, rejection, message) => {
    const harness = await composerHarness({
      expandPrompt: async () => { throw rejection },
    })
    const sent: ContentBlock[][] = []
    vi.spyOn(harness.agent.agent, 'followup').mockImplementation((received) => { sent.push([...received.content]) })

    harness.composer.submit('keep @a.png')

    await vi.waitFor(() => { expect(sent).toHaveLength(1) })
    expect(sent[0]).toEqual([{ type: 'text', text: 'keep @a.png' }])
    expect(harness.notices).toEqual([`Prompt preparation failed: ${message}`])
  })

  it('reports when the agent disappears while the prompt expands', async () => {
    let resolveExpansion!: (value: { content: ContentBlock[]; notices: string[] }) => void
    const harness = await composerHarness({
      expandPrompt: () => new Promise((resolve) => { resolveExpansion = resolve }),
    })

    harness.composer.submit('look @a.png')
    harness.ready(undefined)
    resolveExpansion({ content: [{ type: 'text', text: 'look @a.png' }], notices: [] })

    await vi.waitFor(() => { expect(harness.notices).toEqual(['The agent is not ready yet.']) })
    expect(harness.agent.received).toEqual([])
  })

  it('reports when the agent disappears after a failed expansion', async () => {
    let rejectExpansion!: (error: Error) => void
    const harness = await composerHarness({
      expandPrompt: () => new Promise((_resolve, reject) => { rejectExpansion = reject }),
    })

    harness.composer.submit('look @a.png')
    harness.ready(undefined)
    rejectExpansion(new Error('mentions failed'))

    await vi.waitFor(() => {
      expect(harness.notices).toEqual(['Prompt preparation failed: mentions failed'])
    })
    expect(harness.agent.received).toEqual([])
  })
})

describe('Composer.slashCommands', () => {
  it('lists the terminal-local controls while the agent is not ready', async () => {
    const harness = await composerHarness()
    harness.ready(undefined)

    const listed = harness.composer.slashCommands()

    expect(listed.map(command => command.name)).toEqual([
      'help', 'status', 'model', 'clear', 'reasoning', 'cards', 'redraw', 'effort', 'permission', 'queue', 'config', 'preset', 'exit', 'quit',
    ])
    expect(listed.every(command => command.description !== undefined && command.description.length > 0)).toBe(true)
  })

  it('appends registered commands with their argument hints', async () => {
    const harness = await composerHarness({
      descriptors: [
        { name: 'inspect', description: 'Inspect state', input: { hint: '<target>' } },
        { name: 'ping', description: 'Ping the agent' },
      ],
    })

    const listed = harness.composer.slashCommands()

    expect(listed.at(-2)).toEqual({ name: 'inspect', description: 'Inspect state', argumentHint: '<target>' })
    expect(listed.at(-1)).toEqual({ name: 'ping', description: 'Ping the agent' })
  })
})

describe('Composer.helpLines', () => {
  it('lists local controls without a registered catalog', async () => {
    const harness = await composerHarness()
    harness.ready(undefined)

    const lines = harness.composer.helpLines()

    expect(lines[0]).toBe('Keys')
    expect(lines).toContain('  /help               Show keys and commands')
    expect(lines).toContain('  /preset             ' + copy.commands.preset)
    expect(lines.some(line => line.includes('/inspect'))).toBe(false)
  })

  it('lists registered commands and their input hints', async () => {
    const harness = await composerHarness({
      descriptors: [
        { name: 'inspect', description: 'Inspect state', input: { hint: '<target>' } },
        { name: 'ping', description: 'Ping the agent' },
      ],
    })

    const lines = harness.composer.helpLines()

    expect(lines).toContain('  /inspect <target>   Inspect state')
    expect(lines).toContain('  /ping               Ping the agent')
  })
})

describe('Composer.statusLines', () => {
  it('reports the agent is not ready', async () => {
    const harness = await composerHarness()
    harness.ready(undefined)

    expect(harness.composer.statusLines()).toEqual(['The agent is not ready yet.'])
  })

  it('reports the Session, model, and status facts', async () => {
    const ctx = freshContext()
    await mountSessions(ctx)
    const session = ctx.sessions.create(SessionId('status-session'), { meta: { origin: 'subagent' } })
    const agent = agentDouble({ session, status: 'running', options: { provider: 'prov', model: 'mod' } })
    const composer = new Composer({
      ctx,
      agent: () => agent.agent,
      local: {
        help: () => {}, status: () => {}, model: () => {}, clear: () => {},
        reasoning: () => {}, cards: () => {}, redraw: () => {}, effort: () => {}, permission: () => {},
        queue: () => {}, config: () => {}, preset: () => {}, exit: () => {},
      },
      notice: () => {},
    })

    expect(composer.statusLines()).toEqual([
      'Session    status-session',
      `Created    ${new Date(session.header.createdAt).toISOString()}`,
      'Provider   prov',
      'Model      mod',
      'Status     running',
      '',
      copy.panel.closeHint,
    ])
  })

  it('labels the status facts through the active copy', async () => {
    const harness = await composerHarness()

    const lines = harness.composer.statusLines()

    expect(lines.some(line => line.startsWith(copy.statusPanel.session))).toBe(true)
    expect(lines.some(line => line.startsWith(copy.statusPanel.model))).toBe(true)
  })
})

describe('Composer command arguments', () => {
  it('passes a parsed local-control argument', async () => {
    const harness = await composerHarness()

    harness.composer.submit('/effort high')
    harness.composer.submit('/effort')
    harness.composer.submit('/effort   ')

    expect(harness.effortArgs).toEqual(['high', undefined, undefined])
    expect(harness.local).toEqual(['effort', 'effort', 'effort'])
  })

  it('passes a parsed permission argument', async () => {
    const harness = await composerHarness()

    harness.composer.submit('/permission read-only')
    harness.composer.submit('/permission')

    expect(harness.permissionArgs).toEqual(['read-only', undefined])
    expect(harness.local).toEqual(['permission', 'permission'])
  })

  it('dispatches a registered command with its argument text unchanged', async () => {
    const harness = await composerHarness({
      execute: async () => ({ commandId: CommandId('command-1'), result: { kind: 'success' } }),
    })

    harness.composer.submit('/inspect src/app.ts')

    await vi.waitFor(() => { expect(harness.commands.executed).toEqual(['/inspect src/app.ts']) })
  })

  it('offers effort argument completions through the choice provider', async () => {
    const harness = await composerHarness({
      choices: {
        efforts: async () => [
          { value: 'low', label: 'Low', description: 'fast' },
          { value: 'high', label: 'High' },
          { value: 'default', label: 'default' },
        ],
      },
    })

    const effort = harness.composer.slashCommands().find(command => command.name === 'effort')

    expect(effort?.argumentHint).toBe('<level>')
    expect(await effort?.getArgumentCompletions?.('lo')).toEqual([{ value: 'low', label: 'Low', description: 'fast' }])
    expect(await effort?.getArgumentCompletions?.('HIGH')).toEqual([{ value: 'high', label: 'High' }])
    expect(await effort?.getArgumentCompletions?.('zzz')).toEqual([])
  })

  it('returns null for effort completions without a choice provider', async () => {
    const harness = await composerHarness()

    const effort = harness.composer.slashCommands().find(command => command.name === 'effort')

    expect(await effort?.getArgumentCompletions?.('')).toBeNull()
  })

  it('keeps the local permission entry and drops the registered duplicate', async () => {
    const harness = await composerHarness({
      descriptors: [{ name: 'permission', description: 'Set the permission preset', input: { hint: '<preset>' } }],
    })

    const listed = harness.composer.slashCommands()

    expect(listed.filter(command => command.name === 'permission')).toEqual([
      { name: 'permission', description: 'Show or switch the permission preset' },
    ])
  })

  it('offers preset completions on the local permission command', async () => {
    const harness = await composerHarness({
      descriptors: [{ name: 'permission', description: 'Set the permission preset', input: { hint: '<preset>' } }],
      choices: {
        permissions: () => [
          { value: 'read-only', label: 'Read only', description: 'no writes' },
          { value: 'workspace-write', label: 'Workspace write' },
        ],
      },
    })

    const permission = harness.composer.slashCommands().find(command => command.name === 'permission')

    expect(permission?.argumentHint).toBe('<preset>')
    expect(await permission?.getArgumentCompletions?.('read')).toEqual([{ value: 'read-only', label: 'Read only', description: 'no writes' }])
    expect(await permission?.getArgumentCompletions?.('')).toHaveLength(2)
  })

  it('omits permission argument completions without a choice provider', async () => {
    const harness = await composerHarness({
      descriptors: [{ name: 'permission', description: 'Set the permission preset', input: { hint: '<preset>' } }],
    })

    const permission = harness.composer.slashCommands().find(command => command.name === 'permission')

    expect(permission?.argumentHint).toBeUndefined()
    expect(permission).not.toHaveProperty('getArgumentCompletions')
  })

  it('deduplicates the registered permission command in the help body', async () => {
    const harness = await composerHarness({
      descriptors: [{ name: 'permission', description: 'Set the permission preset', input: { hint: '<preset>' } }],
    })

    const lines = harness.composer.helpLines()

    expect(lines.filter(line => line.includes('/permission'))).toEqual([
      '  /permission         Show or switch the permission preset',
    ])
  })

  it('lists the Shift+Tab effort key in the help body', async () => {
    const harness = await composerHarness()

    const lines = harness.composer.helpLines()

    expect(lines).toContain('  Shift+Tab          cycle reasoning effort')
    expect(lines).toContain('  /effort             Show or set the reasoning effort')
    expect(lines).toContain('  /permission         Show or switch the permission preset')
    expect(lines).toContain('  /config             Show and change the configuration')
  })
})


describe('Composer copy and /queue', () => {
  it('sources every local description from the active copy', async () => {
    const harness = await composerHarness()

    const expected: Record<string, string> = {
      help: copy.commands.help,
      status: copy.commands.status,
      model: copy.commands.model,
      clear: copy.commands.clear,
      reasoning: copy.commands.reasoning,
      cards: copy.commands.cards,
      redraw: copy.commands.redraw,
      effort: copy.commands.effort,
      permission: copy.commands.permission,
      queue: copy.commands.queue,
      config: copy.commands.config,
      exit: copy.commands.exit,
      quit: copy.commands.quit,
    }
    for (const command of harness.composer.slashCommands()) {
      if (expected[command.name] !== undefined) expect(command.description).toBe(expected[command.name])
    }
    expect(harness.composer.helpLines()[0]).toBe(copy.commands.helpTitle)
    expect(harness.composer.helpLines()).toContain(copy.commands.helpCommandsTitle)
    expect(harness.composer.helpLines().join('\n')).toContain('  Ctrl+V             attach an image from the clipboard')
  })

  it('sources the status panel labels from the active copy', async () => {
    const harness = await composerHarness()

    const lines = harness.composer.statusLines()
    const labels = copy.statusPanel

    expect(lines[0]).toContain(labels.session)
    expect(lines[1]).toContain(labels.created)
    expect(lines[2]).toContain(labels.provider)
    expect(lines[3]).toContain(labels.model)
    expect(lines[4]).toContain(labels.state)
  })

  it('switches the command labels with the locale', async () => {
    setCopyLocale('zh')
    const harness = await composerHarness()

    const queue = harness.composer.slashCommands().find(command => command.name === 'queue')
    const lines = harness.composer.helpLines()

    expect(queue?.description).toBe(chinese.commands.queue)
    expect(lines[0]).toBe(chinese.commands.helpTitle)
    expect(lines).toContain(chinese.commands.helpCommandsTitle)
  })

  it('passes a parsed reasoning argument', async () => {
    const harness = await composerHarness()

    harness.composer.submit('/reasoning detailed')
    harness.composer.submit('/reasoning')

    expect(harness.reasoningArgs).toEqual(['detailed', undefined])
    expect(harness.local).toEqual(['reasoning', 'reasoning'])
  })

  it('offers the reasoning levels as argument completions', async () => {
    const harness = await composerHarness()
    const reasoning = harness.composer.slashCommands().find(command => command.name === 'reasoning')

    expect(reasoning?.argumentHint).toBe('<level>')
    expect(await reasoning?.getArgumentCompletions?.('det')).toEqual([{ value: 'detailed', label: 'detailed' }])
    expect(await reasoning?.getArgumentCompletions?.('VERB')).toEqual([{ value: 'verbose', label: 'verbose' }])
    expect(await reasoning?.getArgumentCompletions?.('')).toEqual([
      { value: 'compact', label: 'compact' },
      { value: 'standard', label: 'standard' },
      { value: 'detailed', label: 'detailed' },
      { value: 'verbose', label: 'verbose' },
    ])
    expect(await reasoning?.getArgumentCompletions?.('zzz')).toEqual([])
  })

  it('localizes the reasoning level completions', async () => {
    setCopyLocale('zh')
    const harness = await composerHarness()
    const reasoning = harness.composer.slashCommands().find(command => command.name === 'reasoning')

    expect(await reasoning?.getArgumentCompletions?.('详细')).toEqual([{ value: 'detailed', label: '详细' }])
    expect(await reasoning?.getArgumentCompletions?.('')).toHaveLength(4)
  })

  it('passes a parsed queue argument', async () => {
    const harness = await composerHarness()

    harness.composer.submit('/queue remember this')
    harness.composer.submit('/queue')

    expect(harness.queueArgs).toEqual(['remember this', undefined])
    expect(harness.local).toEqual(['queue', 'queue'])
  })
})

describe('Composer.statusLines provider fallback', () => {
  it('renders a dash when the Agent carries no provider route', async () => {
    const ctx = freshContext()
    await mountSessions(ctx)
    const session = ctx.sessions.create(SessionId('no-provider-session'))
    const agent = agentDouble({ session, options: { model: 'mod' } })
    const composer = new Composer({
      ctx,
      agent: () => agent.agent,
      local: {
        help: () => {}, status: () => {}, model: () => {}, clear: () => {},
        reasoning: () => {}, cards: () => {}, redraw: () => {}, effort: () => {}, permission: () => {},
        queue: () => {}, config: () => {}, preset: () => {}, exit: () => {},
      },
      notice: () => {},
    })

    expect(composer.statusLines().map(line => line.trimEnd())).toContain('Provider   -')
  })
})

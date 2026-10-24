/** The TUI app's Agent owner: preset-backed fresh creation, preset Session resume, and failure exits. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { apply, inject, name } from '../src/index.ts'

const contexts: Context[] = []
let stderr = ''

beforeEach(() => {
  stderr = ''
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk)
    return true
  })
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
  stderr = ''
})

/** One observation lease over a Session cut, as `sessionQuery.observeSession` returns it. */
interface ObservationStub {
  /** Immutable Session header metadata. */
  readonly header: SessionHeader
  /** The exact durable events the owner inspects. */
  readonly events: readonly { readonly type: string; readonly data: unknown }[]
  /** Release the lease. */
  [Symbol.dispose](): void
}

/** Model selection the owner turns into Agent options. */
interface Selection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** One agent-preset registry double and its recordings. */
interface PresetRegistryDouble {
  readonly service: Record<string, unknown>
  /** Ids passed to `resolve` (undefined means "the registry default"). */
  readonly resolved: (string | undefined)[]
  /** Ids passed to `acquireScope`. */
  readonly acquired: string[]
  /** Context/id pairs passed to `mount`. */
  readonly mounted: { readonly ctx: Context; readonly id: string }[]
  /** Ids released through the scope's async disposer. */
  readonly released: string[]
}

/**
 * Build an agent-preset registry double.
 * @param options - default id, mount failure, and resolve failure overrides.
 * @returns the service and its recordings.
 */
function presetRegistry(options: {
  defaultId?: string
  presets?: readonly { id: string; name?: string; description?: string }[]
  mountError?: Error
  resolveError?: Error
} = {}): PresetRegistryDouble {
  const defaultId = options.defaultId ?? 'standard'
  const presets = options.presets ?? [
    { id: 'standard', name: 'Standard' },
    { id: 'ptc', name: 'PTC' },
    { id: 'minimal', name: 'Minimal' },
    { id: 'cordis', name: 'Cordis' },
  ]
  const resolved: (string | undefined)[] = []
  const acquired: string[] = []
  const mounted: { ctx: Context; id: string }[] = []
  const released: string[] = []
  const service = {
    defaultId,
    list: async () => presets.map(preset => ({ ...preset })),
    resolve: async (id?: string) => {
      resolved.push(id)
      if (options.resolveError !== undefined) throw options.resolveError
      const wanted = id ?? defaultId
      return { id: wanted }
    },
    acquireScope: async (id?: string) => {
      const wanted = id ?? defaultId
      acquired.push(wanted)
      return {
        key: { wanted },
        [Symbol.asyncDispose]: async () => { released.push(wanted) },
      }
    },
    mount: async (ctx: Context, id?: string) => {
      if (options.mountError !== undefined) throw options.mountError
      const wanted = id ?? defaultId
      mounted.push({ ctx, id: wanted })
      return { id: wanted }
    },
    select: async (_agent: never, id: string) => id,
  }
  return { service, resolved, acquired, mounted, released }
}

/** Services every mounted owner needs beyond the test's own stubs. */
interface MountOptions {
  /** Default model resolution; provider/model are required by the owner. */
  readonly selection?: Selection
  /** Preset registry override; a standard-default double otherwise. */
  readonly presets?: PresetRegistryDouble
  /** Extra services for this scenario, provided after the common stubs. */
  readonly configure?: (ctx: Context) => void
}

/** One mounted session owner. */
interface Mounted {
  readonly ctx: Context
  readonly presets: PresetRegistryDouble
  /** Exit codes the owner requested. */
  readonly exits: readonly number[]
  /** Settles with the first exit code the owner requested. */
  readonly exited: Promise<number>
}

/**
 * Create a real persisted Session header and event log for one adoption attempt.
 * @param id - logical Session identity.
 * @param header - header facts layered over the fresh default.
 * @returns the detached Session.
 */
function seedSession(id: string, header: Partial<SessionHeader> = {}): Session {
  const sessionId = SessionId(id)
  return Session.create(sessionId, undefined, {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: 1,
    isSeeded: false,
    ...header,
  })
}

/**
 * Build one disposable observation over a real Session cut.
 * @param session - the seeded Session.
 * @param released - collects the identity of every released lease.
 * @returns the observation the query stub returns.
 */
function observeSession(session: Session, released: string[] = []): ObservationStub {
  return {
    header: session.header,
    events: session.ownEvents(),
    [Symbol.dispose]: () => { released.push(session.id) },
  }
}

/** The provider working directory the filesystem stub resolves. */
const WORKING_DIRECTORY = '/work'

/** A filesystem stub resolving every path to {@link WORKING_DIRECTORY}. */
const FILESYSTEM_STUB = {
  resolve: async () => ({ targetKey: WORKING_DIRECTORY, displayPath: WORKING_DIRECTORY }),
  processPath: () => WORKING_DIRECTORY,
}

/**
 * Mount the session owner with the launcher exit request, default-model stub, and preset registry.
 * @param config - row configuration the startup row would supply.
 * @param options - default-model selection and scenario services.
 * @returns the mounted owner and its exit request.
 */
function mount(
  config: { sessionId: string; resumeSessionId?: string; preset?: string },
  options: MountOptions = {},
): Mounted {
  const ctx = new Context()
  contexts.push(ctx)
  const exits: number[] = []
  const exited = Promise.withResolvers<number>()
  ctx.provide('appExit', (code: number) => {
    exits.push(code)
    exited.resolve(code)
  })
  const selection: Selection = options.selection ?? { provider: 'test-provider', model: 'test-model' }
  ctx.provide('agentDefaultModel', { currentSelection: () => selection } as never)
  const presets = options.presets ?? presetRegistry()
  ctx.provide('agentPresets', presets.service as never)
  options.configure?.(ctx)
  apply(ctx, config)
  return { ctx, presets, exits, exited: exited.promise }
}

/** A pending Agent handle the test resolves so the owner's next await is observable. */
interface HandleGate {
  readonly promise: Promise<AgentHandle>
  readonly resolve: (handle: AgentHandle) => void
}

/**
 * Create a pending Agent handle whose resolution the test controls.
 * @returns the pending handle gate.
 */
function handleGate(): HandleGate {
  const gate = Promise.withResolvers<AgentHandle>()
  return {
    promise: gate.promise,
    resolve: (handle) => { gate.resolve(handle) },
  }
}

/** Build one Agent handle that reports its disposal. */
function disposableHandle(disposed: string[], label: string): AgentHandle {
  return {
    agent: undefined as never,
    dispose: async () => { disposed.push(label) },
  }
}

describe('tui-session', () => {
  it('keeps the plugin identity the profile patch wires', () => {
    expect(name).toBe('tui-session')
    expect(inject).toEqual(['agentDefaultModel', 'agentPresets', 'agents'])
  })

  it('fails loud without the launcher-provided exit request', () => {
    expect(() => { apply(new Context(), { sessionId: 'session-fresh' }) }).toThrow(
      'tui-session: the launcher must provide ctx.appExit before the tree mounts',
    )
  })

  it('waits for the Loader, then creates the Agent under the registry default preset', async () => {
    const loader = Promise.withResolvers<undefined>()
    const created = Promise.withResolvers<CreateAgentOptions>()
    const handle = handleGate()
    const disposed: string[] = []
    const mounted = mount({ sessionId: 'session-fresh' }, {
      selection: { provider: 'test-provider', model: 'test-model', reasoningEffort: 'high' },
      configure: (ctx) => {
        ctx.provide('loader', { await: () => loader.promise } as never)
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('agents', {
          create: (options: CreateAgentOptions) => { created.resolve(options); return handle.promise },
        } as never)
      },
    })
    // Nothing is created until the rest of the Loader tree has mounted.
    await Promise.resolve()
    expect(mounted.exits).toEqual([])
    loader.resolve(undefined)
    const options = await created.promise
    expect(options).toMatchObject({
      sessionId: 'session-fresh',
      meta: { cwd: WORKING_DIRECTORY, agentPreset: 'standard' },
      agentOptions: { provider: 'test-provider', model: 'test-model', reasoningEffort: 'high' },
    })
    expect(typeof options.setup).toBe('function')
    expect(mounted.presets.resolved).toEqual([undefined])
    expect(mounted.presets.acquired).toEqual(['standard'])

    await options.setup?.(mounted.ctx, undefined as never)
    expect(mounted.presets.mounted).toEqual([{ ctx: mounted.ctx, id: 'standard' }])

    handle.resolve(disposableHandle(disposed, 'fresh'))
    await handle.promise
    await mounted.ctx.fiber.dispose()
    expect(disposed).toEqual(['fresh'])
    expect(mounted.presets.released).toEqual(['standard'])
  })

  it('creates the Session under an explicit --preset', async () => {
    const created = Promise.withResolvers<CreateAgentOptions>()
    const handle = handleGate()
    const mounted = mount({ sessionId: 'session-preset', preset: 'ptc' }, {
      configure: (ctx) => {
        ctx.provide('agents', {
          create: (options: CreateAgentOptions) => { created.resolve(options); return handle.promise },
        } as never)
      },
    })

    const options = await created.promise
    expect(options.meta).toEqual({ cwd: process.cwd(), agentPreset: 'ptc' })
    expect(mounted.presets.resolved).toEqual(['ptc'])
    expect(mounted.presets.acquired).toEqual(['ptc'])

    handle.resolve(disposableHandle([], 'preset'))
    await handle.promise
  })

  it('falls back to the process working directory without the filesystem service', async () => {
    const created = Promise.withResolvers<CreateAgentOptions>()
    const handle = handleGate()
    const disposed: string[] = []
    const mounted = mount({ sessionId: 'session-cwd' }, {
      configure: (ctx) => {
        ctx.provide('agents', {
          create: (options: CreateAgentOptions) => { created.resolve(options); return handle.promise },
        } as never)
      },
    })
    expect(await created.promise).toMatchObject({
      sessionId: 'session-cwd',
      meta: { cwd: process.cwd(), agentPreset: 'standard' },
      agentOptions: { provider: 'test-provider', model: 'test-model' },
    })
    handle.resolve(disposableHandle(disposed, 'cwd'))
    await handle.promise
    await mounted.ctx.fiber.dispose()
    expect(disposed).toEqual(['cwd'])
  })

  it('reports a non-Error creation failure through the launcher exit request', async () => {
    const rejected = {
      then(_resolve: (value: never) => void, reject: (reason: unknown) => void): void {
        reject('factory exploded')
      },
    }
    const mounted = mount({ sessionId: 'session-fresh' }, {
      configure: (ctx) => { ctx.provide('agents', { create: () => rejected } as never) },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(mounted.exits).toEqual([1])
    expect(stderr).toBe('dsh: factory exploded\n')
  })

  it('reports a mount failure through the launcher exit request', async () => {
    const created = Promise.withResolvers<CreateAgentOptions>()
    const presets = presetRegistry({ mountError: new Error('preset exploded') })
    const mounted = mount({ sessionId: 'session-mount' }, {
      presets,
      configure: (ctx) => {
        ctx.provide('agents', {
          create: async (options: CreateAgentOptions) => {
            created.resolve(options)
            await options.setup?.(new Context(), undefined as never)
            return disposableHandle([], 'mount')
          },
        } as never)
      },
    })
    expect(await created.promise).toMatchObject({ meta: { agentPreset: 'standard' } })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe('dsh: preset exploded\n')
  })

  it('reports an unknown preset resolution through the launcher exit request', async () => {
    const mounted = mount({ sessionId: 'session-unknown', preset: 'nope' }, {
      presets: presetRegistry({ resolveError: new Error('Unknown agent preset: nope') }),
      configure: (ctx) => {
        ctx.provide('agents', { create: () => Promise.resolve(disposableHandle([], 'unused')) } as never)
      },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe('dsh: Unknown agent preset: nope\n')
  })

  it('requires the persistence service before resuming', async () => {
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-resume' })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe('dsh: tui --resume requires the sessionPersistence service; dsh-base provides it\n')
  })

  it('requires the query service before resuming', async () => {
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-resume' }, {
      configure: (ctx) => { ctx.provide('sessionPersistence', {} as never) },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe('dsh: tui --resume requires the sessionQuery service; dsh-base provides it\n')
  })

  it('surfaces an unknown Session from the query service', async () => {
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-missing' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', {
          observeSession: () => Promise.reject(new SessionQueryError(
            'stored session "session-missing" is missing', 'SESSION_QUERY_SESSION_NOT_FOUND',
          )),
        } as never)
      },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe('dsh: stored session "session-missing" is missing\n')
  })

  it('resumes a Session created under a preset and mounts that preset', async () => {
    const session = seedSession('session-preset', { cwd: WORKING_DIRECTORY, agentPreset: 'standard' })
    const released: string[] = []
    const disposed: string[] = []
    const resumed = Promise.withResolvers<ResumeAgentOptions>()
    const secondCut = Promise.withResolvers<ObservationStub>()
    const handle = handleGate()
    let observations = 0
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-preset' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', {
          observeSession: () => {
            observations += 1
            if (observations === 1) return Promise.resolve(observeSession(session, released))
            return secondCut.promise
          },
        } as never)
        ctx.provide('agents', {
          resume: (options: ResumeAgentOptions) => { resumed.resolve(options); return handle.promise },
        } as never)
      },
    })
    const options = await resumed.promise
    expect(options).toMatchObject({
      resumeSessionId: 'session-preset',
      agentOptions: { provider: 'test-provider', model: 'test-model' },
    })
    expect(mounted.presets.resolved).toEqual(['standard'])
    expect(mounted.presets.acquired).toEqual(['standard'])

    await options.setup?.(mounted.ctx, undefined as never)
    expect(mounted.presets.mounted).toEqual([{ ctx: mounted.ctx, id: 'standard' }])

    handle.resolve(disposableHandle(disposed, 'resumed'))
    await handle.promise
    secondCut.resolve(observeSession(session, released))
    await secondCut.promise
    expect(mounted.exits).toEqual([])
    await mounted.ctx.fiber.dispose()
    expect(released).toEqual(['session-preset', 'session-preset'])
    expect(disposed).toEqual(['resumed'])
    expect(mounted.presets.released).toEqual(['standard'])
  })

  it('resumes a Session whose log selected the preset after creation', async () => {
    const session = seedSession('session-selected', { cwd: WORKING_DIRECTORY })
    session.append('turn/start', { turn: 1 })
    session.append('agent-preset/selected', { agentPreset: 'minimal' })
    const resumed = Promise.withResolvers<ResumeAgentOptions>()
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-selected' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', {
          observeSession: () => Promise.resolve(observeSession(session)),
        } as never)
        ctx.provide('agents', {
          resume: (options: ResumeAgentOptions) => { resumed.resolve(options); return Promise.resolve(disposableHandle([], 'selected')) },
        } as never)
      },
    })
    expect(await resumed.promise).toMatchObject({ resumeSessionId: 'session-selected' })
    expect(mounted.presets.resolved).toEqual(['minimal'])
  })

  it('accepts a matching --preset on resume', async () => {
    const session = seedSession('session-match', { cwd: WORKING_DIRECTORY, agentPreset: 'ptc' })
    const resumed = Promise.withResolvers<ResumeAgentOptions>()
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-match', preset: 'ptc' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', {
          observeSession: () => Promise.resolve(observeSession(session)),
        } as never)
        ctx.provide('agents', {
          resume: (options: ResumeAgentOptions) => { resumed.resolve(options); return Promise.resolve(disposableHandle([], 'match')) },
        } as never)
      },
    })
    await resumed.promise
    expect(mounted.presets.resolved).toEqual(['ptc'])
    expect(mounted.exits).toEqual([])
  })

  it('rejects a legacy Session with no recorded preset', async () => {
    const session = seedSession('session-legacy', { cwd: WORKING_DIRECTORY })
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-legacy' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', { observeSession: () => Promise.resolve(observeSession(session)) } as never)
      },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe(
      'dsh: session "session-legacy" recorded no agent preset; the terminal runs agent presets, so start a new Session\n',
    )
    expect(mounted.presets.resolved).toEqual([])
  })

  it('rejects a --preset that differs from the recorded preset', async () => {
    const session = seedSession('session-conflict', { cwd: WORKING_DIRECTORY, agentPreset: 'standard' })
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-conflict', preset: 'ptc' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', { observeSession: () => Promise.resolve(observeSession(session)) } as never)
      },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe(
      'dsh: session "session-conflict" runs under agent preset "standard", not "ptc"; drop --preset or start a new Session\n',
    )
    expect(mounted.presets.resolved).toEqual([])
  })

  it.each([
    { label: 'a non-string preset', agentPreset: 42 },
    { label: 'an empty preset', agentPreset: '' },
  ])('rejects a malformed agent-preset/selected record ($label)', async ({ agentPreset }) => {
    const seeded = seedSession('session-malformed', { cwd: WORKING_DIRECTORY })
    const malformed: ObservationStub = {
      header: seeded.header,
      events: [{ type: 'agent-preset/selected', data: { agentPreset } }],
      [Symbol.dispose]: () => {},
    }
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-malformed' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', { observeSession: () => Promise.resolve(malformed) } as never)
      },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe(
      'dsh: session "session-malformed" records a malformed agent-preset/selected event and cannot be resumed\n',
    )
  })

  it('rejects a subagent Session before resolving its preset', async () => {
    const session = seedSession('session-child', {
      cwd: WORKING_DIRECTORY, origin: 'subagent', agentPreset: 'standard',
    })
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-child' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', { observeSession: () => Promise.resolve(observeSession(session)) } as never)
      },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe(
      'dsh: session "session-child" is a subagent or forked session and cannot be driven directly\n',
    )
  })

  it('rejects a forked Session before resolving its preset', async () => {
    const session = seedSession('session-fork', {
      cwd: WORKING_DIRECTORY,
      parentSession: SessionId('session-parent'),
      agentPreset: 'standard',
    })
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-fork' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', { observeSession: () => Promise.resolve(observeSession(session)) } as never)
      },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe(
      'dsh: session "session-fork" is a subagent or forked session and cannot be driven directly\n',
    )
  })

  it('rejects a Session that recorded no working directory', async () => {
    const session = seedSession('session-nowhere', { agentPreset: 'standard' })
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-nowhere' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', { observeSession: () => Promise.resolve(observeSession(session)) } as never)
      },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe(
      'dsh: session "session-nowhere" recorded no working directory, so it cannot be resumed\n',
    )
  })

  it('rejects a Session recorded in another working directory', async () => {
    const session = seedSession('session-elsewhere', { cwd: '/elsewhere', agentPreset: 'standard' })
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-elsewhere' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', { observeSession: () => Promise.resolve(observeSession(session)) } as never)
      },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe(
      'dsh: session "session-elsewhere" was recorded in "/elsewhere", not "/work"; run dsh tui from that directory\n',
    )
  })

  it('rejects a re-observed Session that lost its recorded preset', async () => {
    const before = seedSession('session-cleared', { cwd: WORKING_DIRECTORY, agentPreset: 'standard' })
    const after = seedSession('session-cleared', { cwd: WORKING_DIRECTORY })
    const observations = [observeSession(before), observeSession(after)]
    let index = 0
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-cleared' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', {
          observeSession: () => Promise.resolve(observations[index++] ?? observations[0]!),
        } as never)
        ctx.provide('agents', {
          resume: () => Promise.resolve(disposableHandle([], 'resumed')),
        } as never)
      },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe(
      'dsh: session "session-cleared" changed agent preset to "none" while the terminal was resuming it\n',
    )
  })

  it('re-checks the log after resume and rejects a preset changed in between', async () => {
    const before = seedSession('session-recheck', { cwd: WORKING_DIRECTORY, agentPreset: 'standard' })
    const after = seedSession('session-recheck', { cwd: WORKING_DIRECTORY, agentPreset: 'ptc' })
    const observations = [observeSession(before), observeSession(after)]
    let index = 0
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-recheck' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', {
          observeSession: () => Promise.resolve(observations[index++] ?? observations[0]!),
        } as never)
        ctx.provide('agents', {
          resume: () => Promise.resolve(disposableHandle([], 'resumed')),
        } as never)
      },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe(
      'dsh: session "session-recheck" changed agent preset to "ptc" while the terminal was resuming it\n',
    )
  })
})

/** The TUI app's Agent owner: fresh creation, persisted-Session adoption rules, and failure exits. */

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

/** Services every mounted owner needs beyond the test's own stubs. */
interface MountOptions {
  /** Default model resolution; provider/model are required by the owner. */
  readonly selection?: Selection
  /** Extra services for this scenario, provided after the common stubs. */
  readonly configure?: (ctx: Context) => void
}

/** One mounted session owner. */
interface Mounted {
  readonly ctx: Context
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
 * Mount the session owner with the launcher exit request and default-model stub.
 * @param config - row configuration the startup row would supply.
 * @param options - default-model selection and scenario services.
 * @returns the mounted owner and its exit request.
 */
function mount(config: { sessionId: string; resumeSessionId?: string }, options: MountOptions = {}): Mounted {
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
  options.configure?.(ctx)
  apply(ctx, config)
  return { ctx, exits, exited: exited.promise }
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
    expect(inject).toEqual(['agentDefaultModel', 'agents'])
  })

  it('fails loud without the launcher-provided exit request', () => {
    expect(() => { apply(new Context(), { sessionId: 'session-fresh' }) }).toThrow(
      'tui-session: the launcher must provide ctx.appExit before the tree mounts',
    )
  })

  it('waits for the Loader, then creates the presented Agent from the default selection and provider cwd', async () => {
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
    expect(await created.promise).toEqual({
      sessionId: 'session-fresh',
      meta: { cwd: WORKING_DIRECTORY },
      agentOptions: { provider: 'test-provider', model: 'test-model', reasoningEffort: 'high' },
    })
    handle.resolve(disposableHandle(disposed, 'fresh'))
    await handle.promise
    await mounted.ctx.fiber.dispose()
    expect(disposed).toEqual(['fresh'])
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
    expect(await created.promise).toEqual({
      sessionId: 'session-cwd',
      meta: { cwd: process.cwd() },
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

  it('rejects a Session created under an agent preset', async () => {
    const session = seedSession('session-preset', {
      cwd: WORKING_DIRECTORY,
      agentPreset: 'review',
      isSeeded: false,
    })
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-preset' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', { observeSession: () => Promise.resolve(observeSession(session)) } as never)
      },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe(
      'dsh: session "session-preset" runs under agent preset "review", which the TUI profile does not compose\n',
    )
  })

  it('rejects a Session whose log selected an agent preset after creation', async () => {
    const session = seedSession('session-selected', { cwd: WORKING_DIRECTORY })
    session.append('turn/start', { turn: 1 })
    session.append('agent-preset/selected', { agentPreset: 'review' })
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-selected' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', { observeSession: () => Promise.resolve(observeSession(session)) } as never)
      },
    })
    await expect(mounted.exited).resolves.toBe(1)
    expect(stderr).toBe(
      'dsh: session "session-selected" runs under agent preset "review", which the TUI profile does not compose\n',
    )
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

  it('rejects a subagent Session', async () => {
    const session = seedSession('session-child', { cwd: WORKING_DIRECTORY, origin: 'subagent' })
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

  it('rejects a forked Session', async () => {
    const session = seedSession('session-fork', {
      cwd: WORKING_DIRECTORY,
      parentSession: SessionId('session-parent'),
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
    const session = seedSession('session-nowhere')
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
    const session = seedSession('session-elsewhere', { cwd: '/elsewhere' })
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

  it('resumes the exact identity after both observations pass, then disposes it with the tree', async () => {
    const released: string[] = []
    const disposed: string[] = []
    const session = seedSession('session-resume', { cwd: WORKING_DIRECTORY })
    session.append('turn/start', { turn: 1 })
    const resumed = Promise.withResolvers<ResumeAgentOptions>()
    const secondObserved = Promise.withResolvers<undefined>()
    const secondCut = Promise.withResolvers<ObservationStub>()
    const handle = handleGate()
    let observations = 0
    const mounted = mount({ sessionId: 'session-x', resumeSessionId: 'session-resume' }, {
      configure: (ctx) => {
        ctx.provide('fs', FILESYSTEM_STUB as never)
        ctx.provide('sessionPersistence', {} as never)
        ctx.provide('sessionQuery', {
          observeSession: () => {
            observations += 1
            if (observations === 1) return Promise.resolve(observeSession(session, released))
            secondObserved.resolve(undefined)
            return secondCut.promise
          },
        } as never)
        ctx.provide('agents', {
          resume: (options: ResumeAgentOptions) => { resumed.resolve(options); return handle.promise },
        } as never)
      },
    })
    expect(await resumed.promise).toEqual({
      resumeSessionId: 'session-resume',
      agentOptions: { provider: 'test-provider', model: 'test-model' },
    })
    handle.resolve(disposableHandle(disposed, 'resumed'))
    await secondObserved.promise
    secondCut.resolve(observeSession(session, released))
    await secondCut.promise
    expect(mounted.exits).toEqual([])
    await mounted.ctx.fiber.dispose()
    expect(released).toEqual(['session-resume', 'session-resume'])
    expect(disposed).toEqual(['resumed'])
  })

  it('re-checks the log after resume and rejects a preset appended in between', async () => {
    const before = seedSession('session-recheck', { cwd: WORKING_DIRECTORY })
    const after = seedSession('session-recheck', { cwd: WORKING_DIRECTORY, agentPreset: 'review' })
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
      'dsh: session "session-recheck" runs under agent preset "review", which the TUI profile does not compose\n',
    )
  })
})

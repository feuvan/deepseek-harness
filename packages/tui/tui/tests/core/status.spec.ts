import { describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { StatusModel } from '../../src/status.ts'
import type { StatusDeps } from '../../src/status.ts'
import { createSession, mountSessions } from '../support/fakes.ts'
import {
  agentDouble, freshContext, projectionsDouble, selectionRef, terminalConfig,
  type AgentDouble, type ProjectionsDouble,
} from './harness.ts'

/** A context carrying the real Session store and one projection service. */
interface StatusHarness {
  readonly ctx: ReturnType<typeof freshContext>
  readonly projections: ProjectionsDouble
  readonly agent: AgentDouble
}

/**
 * Build the status harness: a real Session store, the projection double, and an
 * Agent over one created Session.
 * @param options - Session cwd and initial client-visible values.
 * @returns the harness.
 */
async function statusHarness(options: { cwd?: string; values?: Record<string, unknown>; id?: string } = {}): Promise<StatusHarness> {
  const ctx = freshContext()
  await mountSessions(ctx)
  const projections = projectionsDouble(options.values ?? {})
  ctx.provide('sessionProjections', projections.service)
  const id = SessionId(options.id ?? 'status-session')
  const session = options.cwd === undefined
    ? createSession(ctx, id)
    : ctx.sessions.create(id, { meta: { cwd: options.cwd } })
  const agent = agentDouble({ session })
  return { ctx, projections, agent }
}

/**
 * Build one status model over the supplied dependencies.
 * @param overrides - dependency values to replace.
 * @returns the model and its render spy.
 */
function statusModel(overrides: Partial<StatusDeps> = {}): { model: StatusModel; requestRender: ReturnType<typeof vi.fn> } {
  const requestRender = vi.fn()
  const model = new StatusModel({
    ctx: freshContext(),
    agent: () => undefined,
    selection: selectionRef(),
    config: terminalConfig(),
    effort: () => ({ level: undefined, implicit: false }),
    turnStartedAt: () => undefined,
    requestRender,
    ...overrides,
  })
  return { model, requestRender }
}

describe('StatusModel', () => {
  it('reports a complete starting snapshot before the Agent exists', () => {
    const config = terminalConfig()
    const { model } = statusModel({ config })

    expect(model.snapshot()).toEqual({
      cwd: config.sessionId,
      title: undefined,
      model: 'starting',
      effort: undefined,
      effortImplicit: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheRate: undefined,
      contextPercent: undefined,
      permission: undefined,
      status: 'idle',
      elapsedSeconds: undefined,
      pendingSteering: 0,
      pendingQueued: 0,
    })
  })

  it('reports a starting snapshot when no model selection is installed yet', () => {
    const config = terminalConfig()
    const { model } = statusModel({
      config,
      selection: selectionRef(undefined),
    })

    expect(model.snapshot().model).toBe('starting')
    expect(model.snapshot().cwd).toBe(config.sessionId)
  })

  it('reads the Session cwd fallback and selected model without projections', async () => {
    const ctx = freshContext()
    await mountSessions(ctx)
    const session = createSession(ctx, SessionId('status-bare'))
    const agent = agentDouble({ session })
    const { model } = statusModel({
      ctx,
      agent: () => agent.agent,
      selection: selectionRef({ provider: 'test', model: 'test-model' }),
    })

    const snapshot = model.snapshot()
    expect(snapshot).toMatchObject({
      cwd: process.cwd(),
      title: undefined,
      model: 'test-model',
      effort: undefined,
      inputTokens: 0,
      outputTokens: 0,
      cacheRate: undefined,
      contextPercent: undefined,
      permission: undefined,
      status: 'idle',
      elapsedSeconds: undefined,
      pendingSteering: 0,
      pendingQueued: 0,
    })
  })

  it('reads every client-visible projection value', async () => {
    const harness = await statusHarness({
      cwd: '/work',
      values: {
        tokenUsage: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 0 },
        contextPressure: { projectedTokens: 500, pressureTokens: 400, contextWindow: 2000 },
        permissions: { currentValue: 'workspace-write' },
        title: 'Recorded title',
        workingDirectory: '/project',
      },
    })
    const { model } = statusModel({
      ctx: harness.ctx,
      agent: () => harness.agent.agent,
      selection: selectionRef({ provider: 'test', model: 'test-model', reasoningEffort: ReasoningEffortId('high') }),
      effort: () => ({ level: 'high', implicit: false }),
    })

    expect(model.snapshot()).toEqual({
      cwd: '/project',
      title: 'Recorded title',
      model: 'test-model',
      effort: 'high',
      effortImplicit: false,
      inputTokens: 400,
      outputTokens: 20,
      cacheRate: 0.75,
      contextPercent: 0.25,
      permission: 'workspace-write',
      status: 'idle',
      elapsedSeconds: undefined,
      pendingSteering: 0,
      pendingQueued: 0,
    })
  })

  it('prefers recorded pressure and falls back to the Session header cwd', async () => {
    const harness = await statusHarness({
      cwd: '/work',
      values: {
        contextPressure: { pressureTokens: 400, contextWindow: 2000 },
        title: null,
        workingDirectory: null,
        permissions: undefined,
      },
    })
    const { model } = statusModel({
      ctx: harness.ctx,
      agent: () => harness.agent.agent,
      selection: selectionRef({ provider: 'test', model: 'test-model' }),
    })

    expect(model.snapshot()).toMatchObject({
      cwd: '/work',
      title: undefined,
      inputTokens: 0,
      cacheRate: undefined,
      contextPercent: 0.2,
      permission: undefined,
    })
  })

  it('reads pending steering and queued counts from the inbox projection', async () => {
    const message = (index: number) => ({ type: 'text' as const, text: `m${String(index)}` })
    const harness = await statusHarness({
      values: {
        inbox: {
          'next-step': [message(1)],
          'next-turn': [message(2), message(3)],
        },
      },
    })
    const { model } = statusModel({
      ctx: harness.ctx,
      agent: () => harness.agent.agent,
      selection: selectionRef({ provider: 'test', model: 'test-model' }),
    })

    expect(model.snapshot()).toMatchObject({ pendingSteering: 1, pendingQueued: 2 })
  })

  it('reports zero pending input for absent and empty inbox values', async () => {
    const absent = await statusHarness()
    const absentModel = statusModel({
      ctx: absent.ctx,
      agent: () => absent.agent.agent,
      selection: selectionRef({ provider: 'test', model: 'test-model' }),
    })
    expect(absentModel.model.snapshot()).toMatchObject({ pendingSteering: 0, pendingQueued: 0 })

    const empty = await statusHarness({ values: { inbox: { 'next-step': [], 'next-turn': [] } } })
    const emptyModel = statusModel({
      ctx: empty.ctx,
      agent: () => empty.agent.agent,
      selection: selectionRef({ provider: 'test', model: 'test-model' }),
    })
    expect(emptyModel.model.snapshot()).toMatchObject({ pendingSteering: 0, pendingQueued: 0 })
  })

  it('omits context pressure without a known window or occupancy', async () => {
    const harness = await statusHarness({ values: { contextPressure: { projectedTokens: 500 } } })
    const { model } = statusModel({
      ctx: harness.ctx,
      agent: () => harness.agent.agent,
      selection: selectionRef({ provider: 'test', model: 'test-model' }),
    })
    expect(model.snapshot().contextPercent).toBeUndefined()

    harness.projections.values.contextPressure = { contextWindow: 2000 }
    expect(model.snapshot().contextPercent).toBeUndefined()
  })

  it('reports the effective effort from its reader', async () => {
    const harness = await statusHarness()
    const { model } = statusModel({
      ctx: harness.ctx,
      agent: () => harness.agent.agent,
      selection: selectionRef({ provider: 'test', model: 'test-model' }),
      effort: () => ({ level: 'medium', implicit: false }),
    })

    expect(model.snapshot()).toMatchObject({ effort: 'medium', effortImplicit: false })
  })

  it('marks an adapter default effort as implicit', async () => {
    const harness = await statusHarness()
    const { model } = statusModel({
      ctx: harness.ctx,
      agent: () => harness.agent.agent,
      selection: selectionRef({ provider: 'test', model: 'test-model' }),
      effort: () => ({ level: 'high', implicit: true }),
    })

    expect(model.snapshot()).toMatchObject({ effort: 'high', effortImplicit: true })
  })

  it('reports elapsed seconds only for a running turn', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const harness = await statusHarness()
    let startedAt: number | undefined = 93_500
    const { model } = statusModel({
      ctx: harness.ctx,
      agent: () => harness.agent.agent,
      selection: selectionRef({ provider: 'test', model: 'test-model' }),
      turnStartedAt: () => startedAt,
    })

    harness.agent.setStatus('running')
    expect(model.snapshot()).toMatchObject({ status: 'running', elapsedSeconds: 6 })

    startedAt = undefined
    expect(model.snapshot().elapsedSeconds).toBeUndefined()

    harness.agent.setStatus('idle')
    expect(model.snapshot()).toMatchObject({ status: 'idle', elapsedSeconds: undefined })

    harness.agent.setStatus('running')
    startedAt = 101_500
    expect(model.snapshot().elapsedSeconds).toBe(0)
  })

  it('renders on changes of the presented Session only and stops on dispose', async () => {
    const harness = await statusHarness()
    const other = (await statusHarness({ id: 'other-session' })).agent.agent.session
    const { model, requestRender } = statusModel({
      ctx: harness.ctx,
      agent: () => harness.agent.agent,
      selection: selectionRef({ provider: 'test', model: 'test-model' }),
    })

    harness.projections.emit(other)
    expect(requestRender).not.toHaveBeenCalled()
    harness.projections.emit(harness.agent.agent.session)
    expect(requestRender).toHaveBeenCalledOnce()

    model.dispose()
    expect(harness.projections.listenerCount()).toBe(0)
    harness.projections.emit(harness.agent.agent.session)
    expect(requestRender).toHaveBeenCalledOnce()
    model.dispose()
  })

  it('disposes cleanly without a projection registry', () => {
    const { model } = statusModel()
    expect(() => { model.dispose() }).not.toThrow()
  })
})

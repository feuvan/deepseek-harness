import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, name } from '../src/index.ts'
import { fakeUi } from './harness.ts'

/**
 * Poll until the predicate holds.
 * @param predicate - condition to await.
 */
async function waitFor(predicate: () => boolean): Promise<void> {
  await vi.waitFor(() => { expect(predicate()).toBe(true) })
}

describe('tui-agent-team plugin', () => {
  it('keeps the stable plugin identity', () => {
    expect(name).toBe('tui-agent-team')
  })

  it('stays inert without the terminal contribution seam', async () => {
    const ctx = new Context()

    expect(() => { apply(ctx) }).not.toThrow()
    await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
  })

  it('installs the controller when the seam exists and removes it on dispose', async () => {
    const ctx = new Context()
    const ui = fakeUi()
    ctx.provide('terminalUi', ui)

    apply(ctx)
    await waitFor(() => ui.strips.length === 1 && ui.commands.has('team'))

    await ctx.fiber.dispose()

    expect(ui.strips).toEqual([])
    expect(ui.commands.has('team')).toBe(false)
  })

  it('selects the locale provided by the seam', async () => {
    const ctx = new Context()
    const ui = fakeUi({ locale: 'zh' })
    ctx.provide('terminalUi', ui)

    apply(ctx)
    await waitFor(() => ui.strips.length === 1)
    const { copy } = await import('../src/copy.ts')

    expect(copy.team.membersTab).toBe('成员')
    await ctx.fiber.dispose()
  })
})

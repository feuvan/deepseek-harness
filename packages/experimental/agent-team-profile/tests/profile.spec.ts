/** The experimental bundle must carry one parseable, explicit Team layer plus its preset overlay. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { apply, name } from '../src/index.ts'

/** One inserted row in the parsed bundle patch. */
interface PatchRow {
  readonly id?: string
  readonly name?: string
  readonly config?: Record<string, unknown>
}

/** One parsed bundle patch entry. */
interface PatchEntry {
  readonly id?: string
  readonly disabled?: boolean
  readonly insert?: readonly PatchRow[]
}

describe('Agent Teams profile bundle', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    private?: boolean
    publishConfig?: { access?: string }
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    dsh?: { bundle?: { patch?: string } }
  }
  const parsed = yaml.load(
    readFileSync(resolve(root, manifest.dsh?.bundle?.patch ?? 'cordis.patch.yml'), 'utf8'),
    { schema: entryListSchema },
  ) as PatchEntry[]

  it('declares a public parseable layer with Team-owned controls', () => {
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig?.access).toBe('public')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-experimental-agent-team': 'workspace:*',
      '@deepseek-ai/dsh-experimental-client-ui-agent-team': 'workspace:*',
      '@deepseek-ai/dsh-experimental-tool-agent-team': 'workspace:*',
      '@deepseek-ai/dsh-experimental-tui-agent-team': 'workspace:*',
    })
    expect(manifest.peerDependencies).toHaveProperty('@deepseek-ai/dsh-agent-preset-registry')
    expect(manifest.devDependencies).toHaveProperty('@deepseek-ai/dsh-agent-preset-registry')

    expect(Array.isArray(parsed)).toBe(true)
  })

  it('disables the host subagent rows and inserts the Team rows', () => {
    for (const id of ['tool-subagent-control', 'tool-subagent', 'tool-subagent-fork']) {
      expect(parsed.find(patch => patch.id === id), id).toMatchObject({ disabled: true })
    }
    const inserted = parsed.flatMap(patch => patch.insert ?? [])
    expect(inserted.find(entry => entry.id === 'agent-team')).toMatchObject({
      name: '@deepseek-ai/dsh-experimental-agent-team',
      config: { maxMembers: 8 },
    })
    expect(inserted.find(entry => entry.id === 'tool-agent-team')).toMatchObject({
      name: '@deepseek-ai/dsh-experimental-tool-agent-team',
      config: { freshProvider: 'spawn', forkProvider: 'fork' },
    })
    expect(inserted.find(entry => entry.id === 'ui-agent-team')).toMatchObject({
      name: '@deepseek-ai/dsh-experimental-client-ui-agent-team',
    })
  })

  it('inserts the preset overlay row that replaces preset-scoped subagent controls', () => {
    const inserted = parsed.flatMap(patch => patch.insert ?? [])
    expect(inserted.find(entry => entry.id === 'agent-team-preset-overlay')).toMatchObject({
      name: '@deepseek-ai/dsh-experimental-agent-team-profile',
    })
    expect(inserted.find(entry => entry.id === 'tui-agent-team')).toMatchObject({
      name: '@deepseek-ai/dsh-experimental-tui-agent-team',
    })
    expect(name).toBe('agent-team-preset-overlay')
  })
})

describe('agent-team-preset-overlay', () => {
  it('suppresses the subagent rows through the injected registry and disposes them', async () => {
    const ctx = new Context()
    const calls: (readonly string[])[] = []
    let disposals = 0
    ctx.provide('agentPresets', {
      suppressPresetRows: (ids: readonly string[]) => {
        calls.push([...ids])
        return () => { disposals += 1 }
      },
    } as never)

    apply(ctx)
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    expect(calls[0]).toEqual([
      'tool-subagent-control',
      'tool-subagent',
      'tool-subagent-fork',
    ])

    await ctx.fiber.dispose()
    expect(disposals).toBe(1)
  })

  it('disposes cleanly without an agentPresets service', async () => {
    const ctx = new Context()

    expect(() => { apply(ctx) }).not.toThrow()
    await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
  })
})

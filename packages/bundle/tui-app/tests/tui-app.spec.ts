/** The TUI app bundle's declared profile patch and mounted plugin rows. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { inject as sessionInject, name as sessionName } from '../src/index.ts'
import { inject as startupInject, name as startupName, TUI_STARTUP_SERVICE } from '../src/startup.ts'

/** A `!!js` expression after the bundle schema has parsed it. */
interface PatchExpression {
  readonly __jsExpr: string
}

/** One loader patch entry as the bundle declares it. */
interface PatchEntry {
  readonly id?: string
  readonly disabled?: boolean
  readonly config?: Record<string, unknown>
  readonly insert?: readonly PatchRow[]
}

/** One inserted plugin row. */
interface PatchRow {
  readonly id?: string
  readonly name?: string
  readonly inject?: readonly string[]
  readonly config?: Record<string, unknown>
}

const root = fileURLToPath(new URL('..', import.meta.url))

/** The published manifest, read from the bundle root. */
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}

/** The parsed bundle patch, with `!!js` expressions intact. */
const patches = yaml.load(
  readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
  { schema: entryListSchema },
) as PatchEntry[]

/** The rows the bundle inserts over the base composition. */
const rows = patches.flatMap(patch => patch.insert ?? [])

/** Read one inserted row by id. */
function row(id: string): PatchRow {
  const found = rows.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`the tui-app patch inserts no row "${id}"`)
  return found
}

describe('dsh-tui-app bundle', () => {
  it('declares the terminal bundle patch and mounts only composed packages', () => {
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    for (const dependency of ['@deepseek-ai/dsh-tui', '@deepseek-ai/dsh-tool-ask-user', '@deepseek-ai/dsh-file-reference-local']) {
      expect(manifest.dependencies).toHaveProperty(dependency)
    }
    for (const peer of [
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-agent-default-model',
      '@deepseek-ai/dsh-fs',
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-session-persistence',
      '@deepseek-ai/dsh-session-query',
    ]) {
      expect(manifest.peerDependencies).toHaveProperty(peer)
    }
  })

  it('runs the terminal-specific composition choices over base', () => {
    expect(patches.find(patch => patch.id === 'hmr')).toMatchObject({ disabled: true })
    expect(patches.find(patch => patch.id === 'system-prompt')?.config?.['personaPrefix'])
      .toBe('You are a coding agent powered by the {{model}} model.')
  })

  it('inserts the startup provider, the session owner, the terminal, the file index, and the question tool', () => {
    expect(row('tui-startup').name).toBe('@deepseek-ai/dsh-tui-app/startup')
    expect(row('tui-session')).toMatchObject({ name: '@deepseek-ai/dsh-tui-app', inject: [TUI_STARTUP_SERVICE] })
    expect(row('terminal-ui')).toMatchObject({ name: '@deepseek-ai/dsh-tui', inject: [TUI_STARTUP_SERVICE] })
    expect(row('file-reference-local').name).toBe('@deepseek-ai/dsh-file-reference-local')
    expect(row('tool-ask-user').name).toBe('@deepseek-ai/dsh-tool-ask-user')
  })

  it('wires the published identity and resume target from the startup service into both rows', () => {
    const sessionConfig = row('tui-session').config ?? {}
    const terminalConfig = row('terminal-ui').config ?? {}
    const sessionId = sessionConfig['sessionId'] as PatchExpression
    const resumeSessionId = sessionConfig['resumeSessionId'] as PatchExpression
    const terminalSessionId = terminalConfig['sessionId'] as PatchExpression
    expect(sessionId.__jsExpr).toBe('ctx.tuiStartup.sessionId')
    expect(resumeSessionId.__jsExpr).toBe('ctx.tuiStartup.resumeSessionId')
    expect(terminalSessionId.__jsExpr).toBe('ctx.tuiStartup.sessionId')
    expect(Object.keys(sessionConfig).sort()).toEqual(['resumeSessionId', 'sessionId'])
    expect(Object.keys(terminalConfig)).toEqual(['sessionId'])
  })

  it('keeps the row inject lists aligned with the plugin exports they mount', () => {
    expect(startupName).toBe('tui-startup')
    expect(sessionName).toBe('tui-session')
    expect(startupInject).toEqual(['cmdlineArgs'])
    expect(sessionInject).toEqual(['agentDefaultModel', 'agents'])
    expect(TUI_STARTUP_SERVICE).toBe('tuiStartup')
  })
})

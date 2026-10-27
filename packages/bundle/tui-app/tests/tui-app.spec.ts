/** The TUI app bundle's declared profile patch, preset declarations, and mounted plugin rows. */

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
const webRoot = fileURLToPath(new URL('../../web-app/', import.meta.url))
const PRESET_IDS = ['standard', 'ptc', 'minimal', 'cordis'] as const

/** The published manifest, read from the bundle root. */
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: readonly string[] } }
  files?: readonly string[]
}

/**
 * Parse one bundle patch file with `!!js` expressions intact.
 * @param file - absolute path to the patch file.
 * @returns the patch entries.
 */
function parsePatch(file: string): PatchEntry[] {
  return yaml.load(readFileSync(file, 'utf8'), { schema: entryListSchema }) as PatchEntry[]
}

/** Every patch file the bundle applies, in manifest order. */
const patchFiles = (manifest.dsh!.bundle!.patch ?? []).map(file => resolve(root, file))

/** The parsed bundle patches, with `!!js` expressions intact. */
const patches = patchFiles.flatMap(parsePatch)

/** The rows the bundle inserts over the base composition. */
const rows = patches.flatMap(patch => patch.insert ?? [])

/** Read one inserted row by id. */
function row(id: string): PatchRow {
  const found = rows.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`the tui-app patch inserts no row "${id}"`)
  return found
}

describe('dsh-tui-app bundle', () => {
  it('declares the terminal patch followed by identical preset declarations', () => {
    expect(manifest.dsh?.bundle?.patch).toEqual([
      './cordis.patch.yml',
      './presets/standard.patch.yml',
      './presets/ptc.patch.yml',
      './presets/minimal.patch.yml',
      './presets/cordis.patch.yml',
    ])
    expect(manifest.files).toContain('presets/standard.patch.yml')
    for (const dependency of [
      '@deepseek-ai/dsh-agent-preset',
      '@deepseek-ai/dsh-agent-preset-registry',
      '@deepseek-ai/dsh-cordis-host-runner',
      '@deepseek-ai/dsh-tui',
      '@deepseek-ai/dsh-file-reference-local',
    ]) {
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
    expect(manifest.devDependencies).toHaveProperty('@deepseek-ai/dsh-agent-preset-registry')
  })

  it('runs the terminal-specific composition choices over base', () => {
    expect(patches.find(patch => patch.id === 'hmr')).toBeUndefined()
    expect(patches.find(patch => patch.id === 'system-prompt')?.config?.['personaPrefix'])
      .toBe('You are a coding agent powered by the {{model}} model.')
  })

  it('moves the agent plane behind presets and keeps the process-global host rows', () => {
    for (const id of [
      'tool-plugin-manager', 'tool-bash', 'tool-fs', 'tool-todo', 'tool-web',
      'compaction-basic', 'plan-mode', 'workflow-ptc', 'tool-subagent', 'tool-subagent-fork',
    ]) expect(patches.find(patch => patch.id === id), id).toMatchObject({ disabled: true })

    expect(row('subagent-model-selection-settings').name).toBe('@deepseek-ai/dsh-tool-subagent/model-selection-settings')
    expect(row('cordis-inspect-providers').name).toBe('@deepseek-ai/dsh-tool-cordis/host')
    expect(row('cordis-host-runner').name).toBe('@deepseek-ai/dsh-cordis-host-runner')
    expect(row('agent-preset-registry')).toMatchObject({
      name: '@deepseek-ai/dsh-agent-preset-registry',
      config: { default: 'standard' },
    })
    expect(rows.some(candidate => candidate.name === '@deepseek-ai/dsh-tool-ask-user')).toBe(false)
  })

  it('inserts the startup provider, session owner, terminal, and file index', () => {
    expect(row('tui-startup').name).toBe('@deepseek-ai/dsh-tui-app/startup')
    expect(row('tui-session')).toMatchObject({ name: '@deepseek-ai/dsh-tui-app', inject: [TUI_STARTUP_SERVICE] })
    expect(row('terminal-ui')).toMatchObject({ name: '@deepseek-ai/dsh-tui', inject: [TUI_STARTUP_SERVICE] })
    expect(row('file-reference-local').name).toBe('@deepseek-ai/dsh-file-reference-local')
  })

  it('wires the published identity, resume target, and preset into the session row', () => {
    const sessionConfig = row('tui-session').config ?? {}
    const terminalConfig = row('terminal-ui').config ?? {}
    const sessionId = sessionConfig['sessionId'] as PatchExpression
    const resumeSessionId = sessionConfig['resumeSessionId'] as PatchExpression
    const preset = sessionConfig['preset'] as PatchExpression
    const terminalSessionId = terminalConfig['sessionId'] as PatchExpression
    expect(sessionId.__jsExpr).toBe('ctx.tuiStartup.sessionId')
    expect(resumeSessionId.__jsExpr).toBe('ctx.tuiStartup.resumeSessionId')
    expect(preset.__jsExpr).toBe('ctx.tuiStartup.preset')
    expect(terminalSessionId.__jsExpr).toBe('ctx.tuiStartup.sessionId')
    expect(Object.keys(sessionConfig).sort()).toEqual(['preset', 'resumeSessionId', 'sessionId'])
    expect(Object.keys(terminalConfig)).toEqual(['sessionId'])
  })

  it('keeps the row inject lists aligned with the plugin exports they mount', () => {
    expect(startupName).toBe('tui-startup')
    expect(sessionName).toBe('tui-session')
    expect(startupInject).toEqual(['cmdlineArgs'])
    expect(sessionInject).toEqual(['agentDefaultModel', 'agentPresets', 'agents'])
    expect(TUI_STARTUP_SERVICE).toBe('tuiStartup')
  })

  it('declares one preset row per shipped declaration', () => {
    for (const id of PRESET_IDS) {
      const presetRows = rows.filter(candidate => candidate.name === '@deepseek-ai/dsh-agent-preset')
      expect(presetRows.map(candidate => candidate.config?.['id']).sort()).toEqual([...PRESET_IDS].sort())
      expect(presetRows.map(candidate => candidate.id)).toContain(`preset-${id}`)
      const declared = presetRows.find(candidate => candidate.config?.['id'] === id)
      expect(declared?.config?.['order'], id).toBe(PRESET_IDS.indexOf(id) + 1)
      expect(Array.isArray(declared?.config?.['plugins']), id).toBe(true)
    }
  })

  it.each(PRESET_IDS)('keeps the %s preset byte-identical to the Web profile declaration', (id) => {
    const tui = readFileSync(resolve(root, `presets/${id}.patch.yml`), 'utf8')
    const web = readFileSync(resolve(webRoot, `presets/${id}.patch.yml`), 'utf8')
    expect(tui).toBe(web)
  })
})

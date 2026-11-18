import { describe, expect, it, vi } from 'vitest'
import {
  LATEST_RELEASE_API,
  checkForTuiUpdate,
  compareReleaseVersions,
  detectTuiInstallation,
  releaseNoteLines,
  updateCommand,
  updateDetailLines,
} from '../../src/update-check.ts'

function releasePayload(version: string, body = '## Changes\n\n- Fixed **logs**'): Response {
  return new Response(JSON.stringify({
    tag_name: `dsh-tui-v${version}`,
    html_url: `https://github.com/feuvan/deepseek-harness/releases/tag/dsh-tui-v${version}`,
    body,
    published_at: '2026-11-18T00:00:00Z',
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const mac = '/opt/homebrew/Cellar/dsh-tui/0.2.2-rc.4-20261118.1/libexec/dsh-tui'
const github = '/Users/me/.local/share/dsh-tui/dsh-tui'

describe('detectTuiInstallation', () => {
  it('recognizes a Homebrew cellar from the executable path', () => {
    expect(detectTuiInstallation({ execPath: mac })).toEqual({
      channel: 'homebrew', version: '0.2.2-rc.4-20261118.1',
    })
  })

  it('falls back to the launcher path when canonicalization fails', () => {
    expect(detectTuiInstallation({ execPath: mac, realpath: () => { throw new Error('missing') } }))
      .toEqual({ channel: 'homebrew', version: '0.2.2-rc.4-20261118.1' })
  })

  it('reads the installer stamp for a GitHub download', () => {
    expect(detectTuiInstallation({
      execPath: github,
      realpath: path => path,
      readFile: () => JSON.stringify({ version: '0.2.2-rc.4-20261118.1' }),
    })).toEqual({ channel: 'github', version: '0.2.2-rc.4-20261118.1' })
  })

  it('treats a missing or malformed stamp as an unversioned manual install', () => {
    expect(detectTuiInstallation({ execPath: github, realpath: path => path, readFile: () => { throw new Error('missing') } }))
      .toEqual({ channel: 'manual' })
    expect(detectTuiInstallation({ execPath: github, realpath: path => path, readFile: () => JSON.stringify({ version: 7 }) }))
      .toEqual({ channel: 'manual' })
    expect(detectTuiInstallation({ execPath: github, realpath: path => path, readFile: () => 'not json' }))
      .toEqual({ channel: 'manual' })
  })

  it('uses the running process path by default', () => {
    expect(detectTuiInstallation()).toEqual({ channel: 'source' })
  })

  it('falls back to the default reader when no stamp reader is injected', () => {
    expect(detectTuiInstallation({ execPath: github, realpath: path => path })).toEqual({ channel: 'manual' })
  })

  it('does not treat a source launch as an install', () => {
    expect(detectTuiInstallation({ execPath: '/usr/local/bin/node' })).toEqual({ channel: 'source' })
  })
})

describe('compareReleaseVersions', () => {
  it('orders upstream bases and dated builds', () => {
    expect(compareReleaseVersions('0.2.2-rc.4-20261118.1', '0.2.2-rc.4-20261118.1')).toBe(0)
    expect(compareReleaseVersions('0.2.2-rc.4-20261118.1', '0.2.2-rc.4-20261118.2')).toBeLessThan(0)
    expect(compareReleaseVersions('0.2.2-rc.4-20261118.2', '0.2.2-rc.4-20261118.1')).toBeGreaterThan(0)
    expect(compareReleaseVersions('0.2.2-rc.4-20261117.1', '0.2.2-rc.4-20261118.1')).toBeLessThan(0)
    expect(compareReleaseVersions('0.2.2-rc.1-20261118.1', '0.2.2-rc.4-20261118.1')).toBeLessThan(0)
    expect(compareReleaseVersions('0.2.2-20261118.1', '0.2.2-rc.4-20261118.1')).toBeGreaterThan(0)
    expect(compareReleaseVersions('0.2.3-20261118.1', '0.2.2-rc.4-20261118.1')).toBeGreaterThan(0)
    expect(compareReleaseVersions('0.2.2-alpha.1', '0.2.2-rc.1')).toBeLessThan(0)
    expect(compareReleaseVersions('0.2.2-rc.1', '0.2.2-rc.2')).toBeLessThan(0)
    expect(compareReleaseVersions('0.2.2', '0.2.2-rc.1')).toBeGreaterThan(0)
    expect(compareReleaseVersions('0.2.2-rc', '0.2.2')).toBeLessThan(0)
    expect(compareReleaseVersions('0.2.2-1', '0.2.2-alpha')).toBeLessThan(0)
    expect(compareReleaseVersions('0.2.2-rc.1.1', '0.2.2-rc.1')).toBeGreaterThan(0)
    expect(compareReleaseVersions('0.2.2-rc.1', '0.2.2-rc.1.1')).toBeLessThan(0)
    expect(compareReleaseVersions('0.2.2-rc.1', '0.2.2-1')).toBeGreaterThan(0)
    expect(compareReleaseVersions('0.2.2-rc.2', '0.2.2-rc.1')).toBeGreaterThan(0)
    expect(compareReleaseVersions('0.2.2-rc.1', '0.2.2-rc.1')).toBe(0)
    expect(compareReleaseVersions('0.2', '0.2.0')).toBe(0)
    expect(compareReleaseVersions('0.2.0', '0.2')).toBe(0)
    expect(compareReleaseVersions('0.2.2-rcb', '0.2.2-rca')).toBeGreaterThan(0)
  })
})

describe('updateCommand', () => {
  it('selects the channel-specific upgrade path', () => {
    expect(updateCommand('homebrew')).toBe('brew upgrade dsh-tui')
    expect(updateCommand('github')).toContain('install.sh')
    expect(updateCommand('manual')).toContain('install.sh')
    expect(updateCommand('source')).toContain('/releases/latest')
    expect(updateCommand('unknown')).toContain('/releases/latest')
  })
})

describe('checkForTuiUpdate', () => {
  it('reports a newer Homebrew release with its notes and command', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => releasePayload('0.2.2-rc.4-20261119.1'))
    const result = await checkForTuiUpdate({ execPath: mac, fetchImpl })
    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe(LATEST_RELEASE_API)
    expect(init?.headers).toMatchObject({ 'User-Agent': 'dsh-tui-update-check' })
    expect(result.update.release.version).toBe('0.2.2-rc.4-20261119.1')
    expect(result.update.command).toBe('brew upgrade dsh-tui')
    expect(result.update.installation.channel).toBe('homebrew')
  })

  it('reports the installed release as current', async () => {
    expect(await checkForTuiUpdate({ execPath: mac, fetchImpl: vi.fn(async () => releasePayload('0.2.2-rc.4-20261118.1')) }))
      .toEqual({ status: 'current' })
  })

  it('skips source, manual, and explicitly disabled installations', async () => {
    const fetchImpl = vi.fn(async () => releasePayload('9.9.9-20260101.1'))
    expect(await checkForTuiUpdate({ execPath: '/usr/bin/node', fetchImpl })).toEqual({ status: 'unsupported' })
    expect(await checkForTuiUpdate({ execPath: github, realpath: p => p, readFile: () => '{}', fetchImpl })).toEqual({ status: 'unsupported' })
    expect(await checkForTuiUpdate({ execPath: mac, env: { DSH_TUI_UPDATE_CHECK: '0' }, fetchImpl })).toEqual({ status: 'unsupported' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('falls back to the generated release URL and empty notes', async () => {
    const body = { tag_name: 'dsh-tui-v0.2.2-rc.4-20261119.1' }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
    try {
      const result = await checkForTuiUpdate({ execPath: mac })
      expect(result.status).toBe('available')
      if (result.status !== 'available') return
      expect(result.update.release.url).toContain('/releases/tag/')
      expect(result.update.release.notes).toBe('')
      expect(result.update.release.publishedAt).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports unavailable on HTTP, payload, and network failures', async () => {
    expect(await checkForTuiUpdate({ execPath: mac, fetchImpl: vi.fn(async () => new Response('', { status: 503 })) }))
      .toEqual({ status: 'unavailable' })
    expect(await checkForTuiUpdate({ execPath: mac, fetchImpl: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) }))
      .toEqual({ status: 'unavailable' })
    expect(await checkForTuiUpdate({ execPath: mac, fetchImpl: vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v1.0.0' }), { status: 200 })) }))
      .toEqual({ status: 'unavailable' })
    expect(await checkForTuiUpdate({ execPath: mac, fetchImpl: vi.fn(async () => { throw new Error('offline') }) }))
      .toEqual({ status: 'unavailable' })
  })
})

describe('release notes formatting', () => {
  it('flattens Markdown headings and emphasis and honors the line limit', () => {
    expect(releaseNoteLines('## Heading\n\n- **bold** and `code`', 10)).toEqual(['Heading', '', '- bold and code'])
    expect(releaseNoteLines('one\ntwo\nthree', 2)).toEqual(['one', 'two'])
    expect(releaseNoteLines('a\r\nb')).toEqual(['a', 'b'])
  })

  it('renders details for both channels and an empty notes fallback', () => {
    const base = {
      installation: { channel: 'homebrew' as const, version: '0.2.2-rc.4-20261118.1' },
      release: {
        version: '0.2.2-rc.4-20261119.1', tag: 'dsh-tui-v0.2.2-rc.4-20261119.1',
        url: 'https://example.test', notes: '## Changes\n- fixed', publishedAt: '2026-11-19T00:00:00Z',
      },
      command: 'brew upgrade dsh-tui',
    }
    expect(updateDetailLines(base).join('\n')).toContain('Homebrew')
    expect(updateDetailLines(base).join('\n')).toContain('- fixed')
    expect(updateDetailLines({ ...base, release: { ...base.release, notes: '' } }).join('\n'))
      .toContain('(No release notes provided.)')
    expect(updateDetailLines({ ...base, installation: { channel: 'github', version: base.installation.version } }).join('\n'))
      .toContain('GitHub download')
  })
})

/**
 * Detect a newer prebuilt `dsh-tui` GitHub Release without delaying startup.
 *
 * The prebuilt runtime is distributed as a GitHub Release archive or through
 * the Homebrew tap. A successful check reports the channel-specific upgrade
 * command and the release notes; source and unknown installations are left
 * alone because their upgrade path differs.
 *
 * @module @deepseek-ai/dsh-tui/update-check
 */

import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** Public release feed queried by a startup check. */
export const LATEST_RELEASE_API = 'https://api.github.com/repos/feuvan/deepseek-harness/releases/latest'

/** Maximum time one startup check may take. */
export const UPDATE_CHECK_TIMEOUT_MS = 3_000

/** One installer channel that owns an installed prebuilt runtime. */
export type TuiInstallChannel = 'homebrew' | 'github' | 'manual' | 'source' | 'unknown'

/** Installed runtime channel and the release version it came from. */
export interface TuiInstallation {
  /** Installer channel that produced the current executable. */
  readonly channel: TuiInstallChannel
  /** Release version recorded by the installer or Homebrew cellar, when known. */
  readonly version?: string
}

/** Release metadata needed by the update notice and details panel. */
export interface TuiRelease {
  /** Release version without the tag prefix. */
  readonly version: string
  /** Git tag that names the release. */
  readonly tag: string
  /** Release page URL. */
  readonly url: string
  /** Markdown release notes. */
  readonly notes: string
  /** Publication timestamp from the GitHub API, when supplied. */
  readonly publishedAt?: string
}

/** Available update resolved for the current installation. */
export interface TuiUpdate {
  /** Current runtime installation. */
  readonly installation: TuiInstallation & { readonly version: string }
  /** Newer release information. */
  readonly release: TuiRelease
  /** Channel-specific command that installs the newer release. */
  readonly command: string
}

/** Outcome of one update check. */
export type TuiUpdateCheck =
  | { readonly status: 'available'; readonly update: TuiUpdate }
  | { readonly status: 'current' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'unavailable' }

/** Injectable process and filesystem inputs for tests. */
export interface UpdateCheckDeps {
  /** Fetch implementation; defaults to the process fetch. */
  readonly fetchImpl?: typeof fetch
  /** Executable path; defaults to the running process. */
  readonly execPath?: string
  /** Process environment; defaults to the current environment. */
  readonly env?: NodeJS.ProcessEnv
  /** Text-file reader used for the install stamp. */
  readonly readFile?: (path: string) => string
  /** Path canonicalizer used for the executable. */
  readonly realpath?: (path: string) => string
}

/** Release stamp written by the one-line installer. */
interface ReleaseStamp {
  readonly version?: unknown
  readonly channel?: unknown
}

/** Subset of the GitHub release payload the check reads. */
interface ReleasePayload {
  readonly tag_name?: unknown
  readonly html_url?: unknown
  readonly body?: unknown
  readonly published_at?: unknown
}

/**
 * Read the installer stamp beside one executable.
 * @param executable - canonical executable path.
 * @param readFile - text reader.
 * @returns the recorded version, when the stamp is valid.
 */
function readStamp(executable: string, readFile: (path: string) => string): string | undefined {
  try {
    const parsed = JSON.parse(readFile(join(dirname(executable), 'release.json'))) as ReleaseStamp
    return typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : undefined
  } catch (error: unknown) {
    // A missing or malformed stamp only means the version cannot be compared.
    void error
    return undefined
  }
}

/**
 * Detect which installer owns the running executable and which release it came from.
 * @param deps - injectable executable and filesystem facts.
 * @returns installation channel and release version.
 */
export function detectTuiInstallation(deps: UpdateCheckDeps = {}): TuiInstallation {
  const executable = deps.execPath ?? process.execPath
  if (!/^dsh-tui(?:\.exe)?$/u.test(basename(executable))) return { channel: 'source' }
  const realpath = deps.realpath ?? realpathSync
  let canonical = executable
  try {
    canonical = realpath(executable)
  } catch (error: unknown) {
    // A dangling launcher path still carries the channel name; use it as-is.
    void error
  }
  const celler = canonical.match(/[\\/]Cellar[\\/]dsh-tui[\\/]([^\\/]+)[\\/]/u)
  if (celler?.[1] !== undefined) return { channel: 'homebrew', version: celler[1] }
  const stamp = readStamp(canonical, deps.readFile ?? (path => readFileSync(path, 'utf8')))
  if (stamp !== undefined) return { channel: 'github', version: stamp }
  return { channel: 'manual' }
}

/**
 * Parse our release version into its upstream base and dated build suffix.
 * @param version - version string such as `0.2.2-rc.4-20261118.1`.
 * @returns base version, build date, and same-day sequence.
 */
function splitReleaseVersion(version: string): { base: string; date?: number; sequence?: number } {
  const match = /-(\d{8})\.(\d+)$/u.exec(version)
  if (match === null) return { base: version }
  return {
    base: version.slice(0, match.index),
    date: Number(match[1]),
    sequence: Number(match[2]),
  }
}

/**
 * Compare a numeric version core.
 * @param left - left numeric segments.
 * @param right - right numeric segments.
 * @returns negative, zero, or positive in semver order.
 */
function compareCore(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * Compare two upstream base versions, including prerelease identifiers.
 * @param left - left base version.
 * @param right - right base version.
 * @returns negative, zero, or positive in semver order.
 */
function compareBase(left: string, right: string): number {
  const [leftCore = '', leftPre] = left.split('-', 2)
  const [rightCore = '', rightPre] = right.split('-', 2)
  const core = compareCore(leftCore.split('.').map(Number), rightCore.split('.').map(Number))
  if (core !== 0) return core
  if (leftPre === undefined && rightPre === undefined) return 0
  if (leftPre === undefined) return 1
  if (rightPre === undefined) return -1
  const leftParts = leftPre.split('.')
  const rightParts = rightPre.split('.')
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index]
    const rightPart = rightParts[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftNumber = /^\d+$/u.test(leftPart) ? Number(leftPart) : undefined
    const rightNumber = /^\d+$/u.test(rightPart) ? Number(rightPart) : undefined
    if (leftNumber !== undefined && rightNumber !== undefined) {
      if (leftNumber !== rightNumber) return leftNumber - rightNumber
    } else if (leftNumber !== undefined) {
      return -1
    } else if (rightNumber !== undefined) {
      return 1
    } else if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1
    }
  }
  return 0
}

/**
 * Compare two release versions, including dated fork build suffixes.
 * @param left - left version.
 * @param right - right version.
 * @returns negative, zero, or positive when left is older, equal, or newer.
 */
export function compareReleaseVersions(left: string, right: string): number {
  const leftParts = splitReleaseVersion(left)
  const rightParts = splitReleaseVersion(right)
  const base = compareBase(leftParts.base, rightParts.base)
  if (base !== 0) return base
  const date = (leftParts.date ?? 0) - (rightParts.date ?? 0)
  if (date !== 0) return date
  return (leftParts.sequence ?? 0) - (rightParts.sequence ?? 0)
}

/**
 * Build the upgrade command for one installation channel.
 * @param channel - detected installer channel.
 * @returns a shell command or the release page for manual installs.
 */
export function updateCommand(channel: TuiInstallChannel): string {
  switch (channel) {
    case 'homebrew': return 'brew upgrade dsh-tui'
    case 'github':
    case 'manual': return 'curl -fsSL https://github.com/feuvan/deepseek-harness/releases/latest/download/install.sh | sh'
    case 'source':
    case 'unknown': return 'https://github.com/feuvan/deepseek-harness/releases/latest'
  }
}

/**
 * Query the latest release and select it when it is newer than the installation.
 * @param deps - injectable fetch, executable, environment, and filesystem facts.
 * @returns available, current, unsupported, or unavailable.
 */
export async function checkForTuiUpdate(deps: UpdateCheckDeps = {}): Promise<TuiUpdateCheck> {
  const env = deps.env ?? process.env
  if (env.DSH_TUI_UPDATE_CHECK === '0') return { status: 'unsupported' }
  const installation = detectTuiInstallation(deps)
  if ((installation.channel !== 'homebrew' && installation.channel !== 'github') || installation.version === undefined) {
    return { status: 'unsupported' }
  }
  try {
    const response = await (deps.fetchImpl ?? fetch)(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-tui-update-check' },
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    })
    if (!response.ok) return { status: 'unavailable' }
    const payload = await response.json() as ReleasePayload
    if (typeof payload.tag_name !== 'string' || !payload.tag_name.startsWith('dsh-tui-v')) return { status: 'unavailable' }
    const version = payload.tag_name.slice('dsh-tui-v'.length)
    if (compareReleaseVersions(version, installation.version) <= 0) return { status: 'current' }
    const release: TuiRelease = {
      version,
      tag: payload.tag_name,
      url: typeof payload.html_url === 'string' ? payload.html_url : `https://github.com/feuvan/deepseek-harness/releases/tag/${payload.tag_name}`,
      notes: typeof payload.body === 'string' ? payload.body : '',
      ...(typeof payload.published_at === 'string' ? { publishedAt: payload.published_at } : {}),
    }
    return {
      status: 'available',
      update: { installation: { ...installation, version: installation.version }, release, command: updateCommand(installation.channel) },
    }
  } catch (error: unknown) {
    // An offline or rate-limited startup check must not affect terminal startup.
    void error
    return { status: 'unavailable' }
  }
}

/**
 * Turn release notes into readable terminal lines.
 * @param notes - Markdown release notes.
 * @param limit - maximum source lines to keep.
 * @returns plain lines without Markdown emphasis or heading markers.
 */
export function releaseNoteLines(notes: string, limit = 80): string[] {
  return notes.replace(/\r/gu, '').split('\n').slice(0, limit).map(line => line
    .replace(/^#{1,6}\s*/u, '')
    .replace(/\*\*/gu, '')
    .replace(/`/gu, '')
    .trimEnd())
}

/**
 * Build the `/update` details panel lines.
 * @param update - available update.
 * @returns heading, upgrade command, and release notes.
 */
export function updateDetailLines(update: TuiUpdate): string[] {
  const channel = update.installation.channel === 'homebrew' ? 'Homebrew' : 'GitHub download'
  return [
    `Current: ${update.installation.version} (${channel})`,
    `Latest:  ${update.release.version}`,
    '',
    'Update with:',
    update.command,
    '',
    `Release notes — ${update.release.version}:`,
    ...(update.release.notes === '' ? ['(No release notes provided.)'] : releaseNoteLines(update.release.notes)),
  ]
}

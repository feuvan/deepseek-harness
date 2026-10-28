/**
 * DeepSeek account sign-in for the terminal onboarding flow.
 *
 * The account provider reuses the Desktop/Web browser authorization flow but
 * registers its callback through `ctx.webServer`. The terminal has no web
 * server of its own, so this module mounts the host's loopback-only HTTP
 * carrier for exactly one attempt, then disposes it again.
 *
 * @module @deepseek-ai/dsh-tui/account-login
 */

import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import type { AccountClientMetadata, AccountProfile, AccountView, SignInAttemptView, DeepSeekAccount } from '@deepseek-ai/dsh-deepseek-account'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot'

/** Progress values the onboarding panel renders while browser sign-in runs. */
export type AccountLoginPhase = 'starting' | 'waiting-browser' | 'exchanging' | 'committing'

/** Human-visible account sign-in state. */
export interface AccountLoginUpdate {
  /** Current phase, or `null` before the provider reports one. */
  readonly phase: AccountLoginPhase | null
  /** Browser URL the user must approve, when the provider has produced it. */
  readonly url?: string
}

/** Successful account sign-in. */
export interface AccountLoginResult {
  /** Platform profile, when the profile query succeeded after sign-in. */
  readonly profile: AccountProfile | null
}

/** Caller-supplied presentation and test hooks. */
export interface AccountLoginOptions {
  /** Active interface locale. */
  readonly locale?: string
  /** A custom browser opener; the default uses the platform's URL handler. */
  readonly openBrowser?: (url: string) => void
  /** Receives progress updates. */
  readonly onUpdate?: (update: AccountLoginUpdate) => void
  /** Cancels the attempt, including its browser wait and callback listener. */
  readonly signal?: AbortSignal
  /** How often to read the account view while waiting; defaults to 200ms. */
  readonly pollMs?: number
  /** Deadline for the whole attempt; defaults to ten minutes. */
  readonly timeoutMs?: number
}

/** One account sign-in failure with a stable category for copy lookup. */
export class AccountLoginError extends Error {
  /**
   * @param code - stable failure category.
   * @param message - developer-facing diagnostic.
   */
  constructor(
    readonly code: 'unavailable' | 'cancelled' | 'expired' | 'failed' | 'protocol' | 'no-response' | 'network' | 'storage',
    message: string,
  ) {
    super(message)
    this.name = 'AccountLoginError'
  }
}

/**
 * Open one authorization URL with the platform's system browser.
 * @param url - URL to hand to the platform opener.
 */
/* v8 ignore start -- launching a system browser is a platform side effect exercised outside unit tests */
export function openBrowserUrl(url: string): void {
  openExternalBrowser(url)
}
/* v8 ignore stop */

/** Default browser opener for one platform. */
/* v8 ignore start -- platform URL handlers are launched only on a real desktop; tests inject openBrowser */
function openExternalBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  } catch {
    // The URL remains visible in the onboarding panel when the platform has no opener.
  }
}
/* v8 ignore stop */

/** Map one attempt phase to a panel phase. */
function phaseOf(attempt: SignInAttemptView | null): AccountLoginPhase | null {
  switch (attempt?.phase) {
    case 'initializing': return 'starting'
    case 'waiting-browser': return 'waiting-browser'
    case 'exchanging': return 'exchanging'
    case 'committing': return 'committing'
    default: return null
  }
}

/** The user-facing failure for a terminal attempt phase. */
function failureOf(attempt: SignInAttemptView): AccountLoginError {
  if (attempt.phase === 'expired') return new AccountLoginError('expired', 'the DeepSeek account sign-in expired')
  const code = attempt.errorCode
  return new AccountLoginError(
    code === 'protocol' || code === 'no-response' || code === 'network' || code === 'storage' ? code : 'failed',
    `the DeepSeek account sign-in failed${code === undefined ? '' : ` (${code})`}`,
  )
}

/** Resolve after one poll interval, waking early when the caller aborts. */
async function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) throw new AccountLoginError('cancelled', 'the DeepSeek account sign-in was cancelled')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new AccountLoginError('cancelled', 'the DeepSeek account sign-in was cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Build the account client identity used by browser sign-in and account queries.
 * @param locale - active interface locale.
 * @returns the provider-facing client metadata.
 */
export function accountClientMetadata(locale?: string): AccountClientMetadata {
  return {
    version: getDshRuntimeVersion(),
    locale: locale ?? 'en-US',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

/** Read the profile without turning a profile-query failure into a failed sign-in. */
async function readProfile(account: DeepSeekAccount, client: {
  readonly version: string
  readonly locale: string
  readonly timezoneOffsetSeconds: number
}): Promise<AccountProfile | null> {
  try {
    const profile = await account.getProfile(client)
    return profile?.status === 'ready' ? profile.value : null
  } catch {
    return null
  }
}

/**
 * Open the DeepSeek account sign-in through the browser and wait for its result.
 *
 * The loopback `webServer` exists only while this call runs when the composition
 * does not already provide one. The account provider owns PKCE, state validation,
 * the callback route, and credential storage.
 *
 * @param ctx - context carrying `deepseekAccount` and the credential seam.
 * @param options - locale, presentation callbacks, cancellation, and test hooks.
 * @returns the signed-in profile, when readable.
 * @throws {AccountLoginError} for unavailable account support, cancellation, expiry, or provider failure.
 */
export async function signInWithAccount(ctx: Context, options: AccountLoginOptions = {}): Promise<AccountLoginResult> {
  const account = ctx.get('deepseekAccount')
  if (account === undefined) throw new AccountLoginError('unavailable', 'DeepSeek account sign-in is not composed in this terminal')
  const pollMs = options.pollMs ?? 200
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000
  const signal = options.signal
  let fiber: Awaited<ReturnType<Context['plugin']>> | undefined
  try {
    let server = ctx.get('webServer')
    if (server === undefined) {
      fiber = await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
      server = ctx.get('webServer')
      /* v8 ignore next -- a mounted WebServer either publishes the service or fails activation */
      if (server === undefined) throw new AccountLoginError('protocol', 'the loopback OAuth callback server did not start')
    }
    if (signal?.aborted === true) throw new AccountLoginError('cancelled', 'the DeepSeek account sign-in was cancelled')
    const origin = server.getOrigin()
    const client = accountClientMetadata(options.locale)
    let openedUrl: string | undefined
    options.onUpdate?.({ phase: 'starting' })
    await account.startSignIn(client, origin, 'web')
    const deadline = Date.now() + timeoutMs
    while (true) {
      if (Date.now() > deadline) throw new AccountLoginError('expired', 'the DeepSeek account sign-in timed out')
      const state: AccountView = await account.getState()
      if (state.status === 'credential-stored') {
        options.onUpdate?.({ phase: 'committing' })
        return { profile: await readProfile(account, client) }
      }
      const attempt = state.attempt
      if (attempt !== null && (attempt.phase === 'cancelled' || attempt.phase === 'expired' || attempt.phase === 'failed')) {
        throw failureOf(attempt)
      }
      if (attempt?.phase === 'succeeded') {
        // The credential record is written before the attempt reports success.
        options.onUpdate?.({ phase: 'committing' })
        return { profile: await readProfile(account, client) }
      }
      const phase = phaseOf(attempt)
      const url = attempt?.authorizeUrl
      /* v8 ignore next -- a real browser opener is not launched in headless tests */
      if (url !== undefined && url !== openedUrl) {
        openedUrl = url
        options.onUpdate?.({ phase, url })
        ;(options.openBrowser ?? openExternalBrowser)(url)
      } else {
        options.onUpdate?.({ phase })
      }
      await wait(pollMs, signal)
    }
  } finally {
    if (fiber !== undefined) await fiber.dispose()
  }
}

import { describe, expect, it, vi } from 'vitest'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account'
import { AccountLoginError, signInWithAccount } from '../../src/account-login.ts'
import { freshContext } from './harness.ts'

const profile = { id: null, name: 'Test User', contact: 't***@example.com' }

function views(sequence: readonly AccountView[]): { getState: () => Promise<AccountView>; startSignIn: ReturnType<typeof vi.fn> } {
  let index = 0
  return {
    startSignIn: vi.fn(async () => sequence[0] as AccountView),
    getState: async () => sequence[Math.min(index++, sequence.length - 1)] as AccountView,
  }
}

const stored: AccountView = {
  status: 'credential-stored',
  links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
  attempt: null,
}

const waiting: AccountView = {
  status: 'signed-out',
  links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
  attempt: {
    id: 'attempt' as never,
    phase: 'waiting-browser',
    authorizeUrl: 'https://platform.deepseek.com/authorize',
  },
}

function accountDouble(sequence: readonly AccountView[], profileValue: unknown = profile): {
  startSignIn: ReturnType<typeof vi.fn>
  getState: () => Promise<AccountView>
  getProfile: ReturnType<typeof vi.fn>
} {
  const state = views(sequence)
  return {
    ...state,
    getProfile: vi.fn(async () => ({ status: 'ready', value: profileValue })),
  }
}

const webServer = { getOrigin: () => 'http://127.0.0.1:4321', register: () => () => {} }

describe('signInWithAccount', () => {
  it('waits for the account view, opens the URL, and returns the profile', async () => {
    const account = accountDouble([waiting, stored])
    const ctx = freshContext({ deepseekAccount: account, webServer })
    const opened: string[] = []
    const updates: unknown[] = []

    const result = await signInWithAccount(ctx, {
      locale: 'en-US',
      openBrowser: (url) => { opened.push(url) },
      onUpdate: (update) => { updates.push(update) },
      pollMs: 1,
    })

    expect(result.profile).toEqual(profile)
    expect(opened).toEqual(['https://platform.deepseek.com/authorize'])
    expect(updates).toContainEqual({ phase: 'waiting-browser', url: 'https://platform.deepseek.com/authorize' })
    expect(account.startSignIn).toHaveBeenCalledOnce()
    expect(account.startSignIn.mock.calls[0]?.[2]).toBe('web')
  })

  it('reports a provider failure with its stable code', async () => {
    const failed: AccountView = {
      ...waiting,
      attempt: { id: 'attempt' as never, phase: 'failed', errorCode: 'network' },
    }
    const account = accountDouble([failed])
    const ctx = freshContext({ deepseekAccount: account, webServer })

    await expect(signInWithAccount(ctx, { openBrowser: () => {} })).rejects.toMatchObject({
      code: 'network',
    })
  })

  it('maps an expired attempt and timeout to expired', async () => {
    const expired: AccountView = { ...waiting, attempt: { id: 'attempt' as never, phase: 'expired' } }
    const ctx = freshContext({ deepseekAccount: accountDouble([expired]), webServer })
    await expect(signInWithAccount(ctx, { openBrowser: () => {} })).rejects.toMatchObject({ code: 'expired' })

    const ctx2 = freshContext({ deepseekAccount: accountDouble([waiting]), webServer })
    await expect(signInWithAccount(ctx2, { openBrowser: () => {}, timeoutMs: 0 })).rejects.toMatchObject({ code: 'expired' })
  })

  it('cancels before starting when the caller is already aborted', async () => {
    const ctx = freshContext({ deepseekAccount: accountDouble([waiting]), webServer })
    const controller = new AbortController()
    controller.abort()
    await expect(signInWithAccount(ctx, { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('reports a failed attempt without an error code', async () => {
    const failed: AccountView = { ...waiting, attempt: { id: 'attempt' as never, phase: 'failed' } }
    const ctx = freshContext({ deepseekAccount: accountDouble([failed]), webServer })
    await expect(signInWithAccount(ctx, { openBrowser: () => {} })).rejects.toMatchObject({
      message: 'the DeepSeek account sign-in failed',
    })
  })

  it('reports unavailable account support and propagates cancellation', async () => {
    const ctx = freshContext()
    await expect(signInWithAccount(ctx)).rejects.toMatchObject({ code: 'unavailable' })

    const account = accountDouble([waiting])
    const ctx2 = freshContext({ deepseekAccount: account, webServer })
    const controller = new AbortController()
    const pending = signInWithAccount(ctx2, {
      openBrowser: () => { controller.abort() },
      signal: controller.signal,
      pollMs: 1,
    })
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('mounts and disposes its own loopback callback server', async () => {
    const account = accountDouble([stored])
    const ctx = freshContext({ deepseekAccount: account })
    const result = await signInWithAccount(ctx, { openBrowser: () => {} })

    expect(result.profile).toEqual(profile)
    expect(account.startSignIn).toHaveBeenCalledOnce()
    expect(ctx.get('webServer')).toBeUndefined()
  })

  it('turns a profile query failure into a null profile without failing sign-in', async () => {
    const account = accountDouble([stored])
    account.getProfile.mockRejectedValueOnce(new Error('profile unavailable'))
    const ctx = freshContext({ deepseekAccount: account, webServer })

    await expect(signInWithAccount(ctx, { openBrowser: () => {} })).resolves.toEqual({ profile: null })
  })

  it('accepts the succeeded attempt phase before the credential status arrives', async () => {
    const succeeded: AccountView = {
      ...waiting,
      status: 'signed-out',
      attempt: { id: 'attempt' as never, phase: 'succeeded' },
    }
    const ctx = freshContext({ deepseekAccount: accountDouble([succeeded]), webServer })

    await expect(signInWithAccount(ctx, { openBrowser: () => {} })).resolves.toEqual({ profile })
  })

  it('uses the default browser opener without throwing when it is unavailable', async () => {
    const account = accountDouble([stored])
    const ctx = freshContext({ deepseekAccount: account, webServer })
    await expect(signInWithAccount(ctx)).resolves.toEqual({ profile })
  })

  it('exposes stable error messages', () => {
    expect(new AccountLoginError('failed', 'x').message).toBe('x')
  })
})

describe('signInWithAccount progress and failure mapping', () => {
  const initializing: AccountView = { ...waiting, attempt: { id: 'attempt' as never, phase: 'initializing' } }
  const exchanging: AccountView = { ...waiting, attempt: { id: 'attempt' as never, phase: 'exchanging' } }
  const committing: AccountView = { ...waiting, attempt: { id: 'attempt' as never, phase: 'committing' } }

  it('reports every non-terminal attempt phase while polling', async () => {
    const account = accountDouble([initializing, exchanging, committing, stored])
    const ctx = freshContext({ deepseekAccount: account, webServer })
    const phases: (string | null | undefined)[] = []

    await signInWithAccount(ctx, { openBrowser: () => {}, onUpdate: (update) => { phases.push(update.phase) }, pollMs: 1 })

    expect(phases).toEqual(expect.arrayContaining(['starting', 'exchanging', 'committing']))
  })

  it.each([
    ['protocol', 'protocol'],
    ['no-response', 'no-response'],
    ['storage', 'storage'],
    ['unknown', 'failed'],
  ])('maps %s to %s', async (errorCode, expected) => {
    const failed: AccountView = { ...waiting, attempt: { id: 'attempt' as never, phase: 'failed', errorCode: errorCode as never } }
    const ctx = freshContext({ deepseekAccount: accountDouble([failed]), webServer })
    await expect(signInWithAccount(ctx, { openBrowser: () => {} })).rejects.toMatchObject({ code: expected })
  })

  it('handles a signed-out view without an attempt before the browser starts', async () => {
    const empty: AccountView = { ...stored, status: 'signed-out' }
    const account = accountDouble([empty, waiting, stored])
    const ctx = freshContext({ deepseekAccount: account, webServer })
    const result = await signInWithAccount(ctx, { openBrowser: () => {}, pollMs: 1 })
    expect(result.profile).toEqual(profile)
  })

  it('cancels a browser wait through the abort signal', async () => {
    const account = accountDouble([waiting, waiting, waiting, waiting])
    const ctx = freshContext({ deepseekAccount: account, webServer })
    const controller = new AbortController()
    const pending = signInWithAccount(ctx, {
      openBrowser: () => { setTimeout(() =>{  controller.abort() }, 5) },
      signal: controller.signal,
      pollMs: 100,
    })
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('returns null when the profile query reports a failed status', async () => {
    const account = accountDouble([stored])
    account.getProfile.mockResolvedValueOnce({ status: 'failed' })
    const ctx = freshContext({ deepseekAccount: account, webServer })
    await expect(signInWithAccount(ctx, { openBrowser: () => {} })).resolves.toEqual({ profile: null })
  })
})

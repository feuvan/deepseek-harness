import { describe, expect, it, vi } from 'vitest'
import type { AccountLoginUpdate } from '../../src/account-login.ts'
import { AccountLoginError } from '../../src/account-login.ts'
import { copy } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'
import type { TuiModelRow } from '../../src/model-selector.ts'
import { OnboardingPanel } from '../../src/components/onboarding.ts'

const rows: readonly TuiModelRow[] = [
  { provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-flash', name: 'DeepSeek Flash', efforts: [], defaultEffort: 'high' },
  { provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', efforts: [] },
]

function fixture(overrides: {
  canSignIn?: boolean
  signIn?: (update: (value: AccountLoginUpdate) => void, signal: AbortSignal) => Promise<readonly TuiModelRow[]>
  saveApiKey?: (key: string) => Promise<readonly TuiModelRow[]>
  chooseModel?: (row: TuiModelRow) => Promise<void>
  skip?: () => void
} = {}): {
  panel: OnboardingPanel
  requestRender: ReturnType<typeof vi.fn>
  skip: ReturnType<typeof vi.fn>
  saveApiKey: ReturnType<typeof vi.fn>
  chooseModel: ReturnType<typeof vi.fn>
} {
  const requestRender = vi.fn()
  const skip = vi.fn(overrides.skip)
  const saveApiKey = vi.fn(overrides.saveApiKey ?? (async () => rows))
  const chooseModel = vi.fn(overrides.chooseModel ?? (async () => {}))
  const panel = new OnboardingPanel({
    palette: createPalette(false),
    rows: () => 18,
    actions: {
      canSignIn: overrides.canSignIn ?? true,
      signIn: overrides.signIn ?? (async () => rows),
      saveApiKey,
      chooseModel,
      skip,
      requestRender,
    },
  })
  return { panel, requestRender, skip, saveApiKey, chooseModel }
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('OnboardingPanel', () => {
  it('renders a full-screen welcome with the account choice first', () => {
    const { panel } = fixture()
    const lines = panel.render(80)

    expect(lines).toHaveLength(18)
    const text = lines.join('\n')
    expect(text).toContain(copy.onboarding.title)
    expect(text).toContain(copy.onboarding.account)
    expect(text.indexOf(copy.onboarding.account)).toBeLessThan(text.indexOf(copy.onboarding.apiKey))
    expect(lines.every(line => line.length <= 80)).toBe(true)
  })

  it('saves an API key and moves to model selection', async () => {
    const { panel, saveApiKey, chooseModel } = fixture()
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.apiKeyTitle)

    panel.handleInput('s')
    panel.handleInput('k')
    panel.handleInput('\r')
    await settle()

    expect(saveApiKey).toHaveBeenCalledWith('sk')
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.modelTitle)
    panel.handleInput('\r')
    await settle()
    expect(chooseModel).toHaveBeenCalledWith(rows[0])
  })

  it('shows a failed API key and allows another attempt', async () => {
    let attempts = 0
    const { panel } = fixture({
      saveApiKey: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('bad key')
        return rows
      },
    })
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    panel.handleInput('x')
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain('bad key')

    panel.handleInput('\r')
    await settle()
    expect(attempts).toBe(2)
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.modelTitle)
  })

  it('uses the browser URL from account progress and retries after failure', async () => {
    let attempts = 0
    const { panel } = fixture({
      signIn: async (update) => {
        attempts += 1
        update({ phase: 'waiting-browser', url: 'https://platform.deepseek.com/authorize' })
        if (attempts === 1) throw new AccountLoginError('expired', 'expired')
        return rows
      },
    })
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain('https://platform.deepseek.com/authorize')
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.accountFailures.expired)

    panel.handleInput('\r')
    await settle()
    expect(attempts).toBe(2)
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.modelTitle)
  })

  it('cancels a browser attempt with Escape and returns to welcome', async () => {
    let signal: AbortSignal | undefined
    const { panel } = fixture({
      signIn: (_update, pendingSignal) => new Promise((_resolve, reject) => {
        signal = pendingSignal
        pendingSignal.addEventListener('abort', () => { reject(new AccountLoginError('cancelled', 'cancelled')) })
      }),
    })
    panel.handleInput('\r')
    await settle()
    expect(signal?.aborted).toBe(false)

    panel.handleInput('\u001b')
    await settle()
    expect(signal?.aborted).toBe(true)
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.title)
  })

  it('skips from the welcome screen and supports keyboard navigation', () => {
    const { panel, skip } = fixture()
    panel.handleInput('\u001b[B')
    panel.handleInput('\u001b[A')
    panel.handleInput('\u001b')
    expect(skip).toHaveBeenCalledOnce()
  })

  it('navigates the discovered model list', async () => {
    const { panel, chooseModel } = fixture()
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    panel.handleInput('k')
    panel.handleInput('\r')
    await settle()
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    await settle()
    expect(chooseModel).toHaveBeenCalledWith(rows[1])
  })

  it('renders provider failures and model navigation', async () => {
    const { panel } = fixture({
      saveApiKey: async () => {
        throw new Error('no model route is available')
      },
    })
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    panel.handleInput('k')
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain('no model route is available')
  })
})

describe('OnboardingPanel interactions', () => {
  it('skips directly when the account choice is unavailable', () => {
    const { panel, skip } = fixture({ canSignIn: false })
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    expect(skip).toHaveBeenCalledOnce()
  })

  it('ignores empty and busy API-key submissions', async () => {
    let release: (() => void) | undefined
    const saveApiKey = vi.fn(() => new Promise<readonly TuiModelRow[]>((resolve) => {
      release = () => { resolve(rows) }
    }))
    const { panel } = fixture({ saveApiKey })
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    panel.handleInput('\r')
    await settle()
    expect(saveApiKey).not.toHaveBeenCalled()

    panel.handleInput('k')
    panel.handleInput('\r')
    await settle()
    panel.handleInput('x')
    panel.handleInput('\r')
    await settle()
    expect(saveApiKey).toHaveBeenCalledOnce()

    release?.()
    await settle()
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.modelTitle)
  })

  it('returns from the API-key and model steps with Escape', async () => {
    const { panel } = fixture()
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    panel.handleInput('\u001b')
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.title)

    panel.handleInput('\r')
    panel.handleInput('k')
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.modelTitle)
    panel.handleInput('\u001b')
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.title)
  })

  it('shows a choose-model failure and supports model up navigation', async () => {
    const { panel } = fixture({ chooseModel: async () => { throw new AccountLoginError('failed', 'cannot select') } })
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    panel.handleInput('k')
    panel.handleInput('\r')
    await settle()
    panel.handleInput('\u001b[B')
    panel.handleInput('\u001b[A')
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.accountFailures.failed)
  })

  it('renders account busy and exchanging phases and consumes other keys', async () => {
    let release: ((rows: readonly TuiModelRow[]) => void) | undefined
    const { panel } = fixture({
      signIn: async update => new Promise((resolve) => {
        release = resolve
        update({ phase: 'exchanging' })
        update({ phase: 'committing' })
      }),
    })
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.working)
    expect(panel.handleInput('x')).toBe(true)
    panel.handleInput('\u001b')
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.title)
    release?.(rows)
    await settle()
  })

  it('returns from the account error state and handles Enter without an error', async () => {
    const { panel } = fixture({
      signIn: async () => { throw new AccountLoginError('storage', 'storage failed') },
    })
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.accountFailures.storage)
    panel.handleInput('x')
    panel.handleInput('\u001b')
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.title)
  })

  it('consumes unknown welcome and account keys', async () => {
    let release: ((rows: readonly TuiModelRow[]) => void) | undefined
    const { panel } = fixture({
      signIn: async () => new Promise((resolve) => { release = resolve }),
    })
    expect(panel.handleInput('x')).toBe(true)
    panel.handleInput('\r')
    await settle()
    expect(panel.handleInput('x')).toBe(true)
    panel.handleInput('\u001b')
    release?.(rows)
    await settle()
  })
})

describe('OnboardingPanel edge cases', () => {
  it('reports an empty provider catalog from the API-key path', async () => {
    const { panel } = fixture({ saveApiKey: async () => [] })
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    panel.handleInput('k')
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.apiKeyInvalid)
  })

  it('ignores a second model choice while the first is running', async () => {
    let release: (() => void) | undefined
    const chooseModel = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const { panel } = fixture({ chooseModel })
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    panel.handleInput('k')
    panel.handleInput('\r')
    await settle()
    panel.handleInput('\r')
    await settle()
    panel.handleInput('\r')
    await settle()
    expect(chooseModel).toHaveBeenCalledOnce()
    release?.()
    await settle()
  })

  it('renders a model description when one is present', async () => {
    const described: readonly TuiModelRow[] = [
      { ...rows[0]!, description: 'Fast default model' },
    ]
    const { panel } = fixture({ saveApiKey: async () => described })
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    panel.handleInput('k')
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain('Fast default model')
  })
})

describe('OnboardingPanel remaining paths', () => {
  it('reports an account sign-in that discovers no model', async () => {
    const { panel } = fixture({ signIn: async () => [] })
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain('no model route is available')
  })

  it('returns from the model step and consumes unrelated model keys', async () => {
    const { panel } = fixture()
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    panel.handleInput('k')
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.modelTitle)
    expect(panel.handleInput('x')).toBe(true)
    panel.handleInput('\u001b')
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.title)
  })
})

describe('OnboardingPanel non-Error failures', () => {
  it('renders a thrown string and supports invalidate', async () => {
    const { panel } = fixture({ saveApiKey: async () => { throw 'plain failure' } })
    panel.invalidate()
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    panel.handleInput('k')
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain('plain failure')
  })

  it('renders an unknown account failure code', async () => {
    const { panel } = fixture({
      signIn: async () => { throw new AccountLoginError('failed', 'mystery') },
    })
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain(copy.onboarding.accountFailures.failed)
  })
})

describe('OnboardingPanel unknown account code', () => {
  it('falls back to the thrown message when the provider code is not localized', async () => {
    const { panel } = fixture({
      signIn: async () => { throw new AccountLoginError('weird' as never, 'unexpected provider failure') },
    })
    panel.handleInput('\r')
    await settle()
    expect(panel.render(80).join('\n')).toContain('unexpected provider failure')
  })
})

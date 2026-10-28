import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountPanel, type AccountPanelActions, type AccountPanelView } from '../../src/components/account.ts'
import { copy, setCopyLocale } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'

function fixture(): { panel: AccountPanel; actions: { [K in keyof AccountPanelActions]: ReturnType<typeof vi.fn> } } {
  const actions = {
    refresh: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    openUsage: vi.fn(),
    openTopUp: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    requestRender: vi.fn(),
  }
  return { panel: new AccountPanel({ palette: createPalette(false), actions }), actions }
}

const links = { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' }

afterEach(() => { setCopyLocale('en') })
const signedIn: AccountPanelView = {
  status: 'signed-in',
  canSignIn: true,
  profile: { id: null, name: 'Test User', contact: 't***@example.com' },
  wallets: [{ currency: 'CNY', balance: '12.50' }],
  bonusWallets: [{ currency: 'USD', balance: '1.00' }],
  links,
}

describe('AccountPanel', () => {
  it('renders identity and wallet balances', () => {
    const { panel } = fixture()
    panel.setView(signedIn)
    const text = panel.render(80).join('\n')
    expect(text).toContain(copy.account.title)
    expect(text).toContain('Test User')
    expect(text).toContain('t***@example.com')
    expect(text).toContain('CNY 12.50')
    expect(text).toContain('USD 1.00')
    expect(text).toContain(copy.account.refresh)
  })

  it('refreshes and retries through the action list', () => {
    const { panel, actions } = fixture()
    panel.setView({ status: 'signed-out', canSignIn: true })
    panel.handleInput('\r')
    expect(actions.signIn).toHaveBeenCalledOnce()
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    expect(actions.refresh).toHaveBeenCalledOnce()

    panel.setView({ status: 'error', canSignIn: true, error: 'network down' })
    panel.handleInput('\r')
    expect(actions.refresh).toHaveBeenCalledTimes(2)
    expect(panel.render(80).join('\n')).toContain('network down')
  })

  it('opens usage and top-up pages from the signed-in menu', () => {
    const { panel, actions } = fixture()
    panel.setView(signedIn)
    panel.handleInput('\u001b[B')
    panel.handleInput('\u001b[B')
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    expect(actions.openUsage).toHaveBeenCalledWith(links.usageUrl)
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    expect(actions.openTopUp).toHaveBeenCalledWith(links.topUpUrl)
  })

  it('confirms sign-out before calling the action', () => {
    const { panel, actions } = fixture()
    panel.setView(signedIn)
    panel.handleInput('\u001b[B')
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    expect(actions.signOut).not.toHaveBeenCalled()
    expect(panel.render(80).join('\n')).toContain(copy.account.confirmSignOut)

    panel.handleInput('\r')
    expect(actions.signOut).toHaveBeenCalledOnce()
  })

  it('cancels the sign-out confirmation with Escape', () => {
    const { panel, actions } = fixture()
    panel.setView(signedIn)
    panel.handleInput('\u001b[B')
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    panel.handleInput('\u001b')
    expect(panel.render(80).join('\n')).toContain(copy.account.refresh)
    expect(actions.close).not.toHaveBeenCalled()
  })

  it('closes from the menu and returns to it from an error', () => {
    const { panel, actions } = fixture()
    panel.setView({ status: 'signed-out', canSignIn: true })
    panel.handleInput('\u001b[B')
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    expect(actions.close).toHaveBeenCalledOnce()
  })

  it('renders sign-in progress and cancels it', () => {
    const { panel, actions } = fixture()
    panel.setView({
      status: 'signed-out',
      canSignIn: true,
      login: { phase: 'waiting-browser', url: 'https://platform.deepseek.com/authorize' },
    })
    const text = panel.render(80).join('\n')
    expect(text).toContain(copy.account.loginWaiting)
    expect(text).toContain('https://platform.deepseek.com/authorize')
    expect(text).toContain(copy.account.loginCancel)
    panel.handleInput('\u001b')
    expect(actions.cancel).toHaveBeenCalledOnce()
  })

  it('shows unavailable profile and balance fields', () => {
    const { panel } = fixture()
    panel.setView({ status: 'signed-in', canSignIn: false, profileFailed: true, balanceFailed: true })
    const text = panel.render(80).join('\n')
    expect(text).toContain(copy.account.profileUnavailable)
    expect(text).toContain(copy.account.balanceUnavailable)
  })

  it('renders loading, signed-out, and busy states', () => {
    const { panel } = fixture()
    expect(panel.render(80).join('\n')).toContain(copy.account.loading)
    panel.setView({ status: 'signed-out', canSignIn: false })
    expect(panel.render(80).join('\n')).toContain(copy.account.signedOut)
    panel.setView({ status: 'signed-in', canSignIn: true, busy: copy.account.working })
    expect(panel.render(80).join('\n')).toContain(copy.account.working)
    expect(panel.handleInput('x')).toBe(true)
  })

  it('ignores an enter action while signing in', () => {
    const { panel, actions } = fixture()
    panel.setView({ status: 'signed-in', canSignIn: true, busy: copy.account.working })
    panel.handleInput('\r')
    expect(actions.refresh).not.toHaveBeenCalled()
    panel.invalidate()
    expect(panel.render(80).length).toBeGreaterThan(0)
  })

  it('renders unknown name and empty wallets', () => {
    const { panel } = fixture()
    panel.setView({ status: 'signed-in', canSignIn: true, profile: { id: null, name: null, contact: null } })
    const text = panel.render(80).join('\n')
    expect(text).toContain(copy.account.signedInUnknown)
    expect(text).toContain('—')
  })
})

describe('AccountPanel navigation and fallbacks', () => {
  it('navigates upward and renders without links', () => {
    const { panel, actions } = fixture()
    panel.setView({ status: 'signed-in', canSignIn: false, profile: { id: null, name: 'No Links', contact: null } })
    panel.handleInput('\u001b[A')
    panel.handleInput('\r')
    expect(actions.close).toHaveBeenCalledOnce()
  })

  it('renders login progress without a URL', () => {
    const { panel } = fixture()
    panel.setView({ status: 'signed-out', canSignIn: true, login: { phase: 'exchanging' } })
    expect(panel.render(80).join('\n')).toContain(copy.account.loginWaiting)
  })

  it('shows the sign-in action from an error only when available', () => {
    const { panel } = fixture()
    panel.setView({ status: 'error', canSignIn: false, error: 'bad' })
    const text = panel.render(80).join('\n')
    expect(text).toContain(copy.account.retry)
    expect(text).not.toContain(copy.account.signIn)
  })

  it('ignores an empty action list and an out-of-range action', () => {
    const { panel } = fixture()
    const actionsFor = Reflect.get(panel, 'actionsFor') as () => readonly unknown[]
    const activate = Reflect.get(panel, 'activate') as () => void
    Reflect.set(panel, 'view', { status: 'signed-out', canSignIn: true })
    Reflect.set(panel, 'index', 99)
    activate.call(panel)
    expect(actionsFor.call(panel)).toHaveLength(3)
  })

  it('renders a confirm prompt and cancel choice', () => {
    const { panel } = fixture()
    panel.setView(signedIn)
    panel.handleInput('\u001b[B')
    panel.handleInput('\u001b[B')
    panel.handleInput('\r')
    const actionsFor = Reflect.get(panel, 'actionsFor') as () => readonly { label: string }[]
    expect(actionsFor.call(panel).map(action => action.label)).toEqual([copy.account.confirmYes, copy.account.confirmNo])
  })
})

describe('AccountPanel close paths', () => {
  it('returns its view and closes on Escape', () => {
    const { panel, actions } = fixture()
    panel.setView({ status: 'signed-out', canSignIn: true })
    expect(panel.currentView().status).toBe('signed-out')
    panel.handleInput('\u001b')
    expect(actions.close).toHaveBeenCalledOnce()
  })
})

describe('AccountPanel unusual input', () => {
  it('ignores unrelated keys and renders an error without detail', () => {
    const { panel } = fixture()
    panel.setView({ status: 'signed-out', canSignIn: true })
    expect(panel.handleInput('x')).toBe(true)
    panel.setView({ status: 'error', canSignIn: true })
    expect(panel.render(80).length).toBeGreaterThan(0)
  })
})


describe('AccountPanel Chinese copy', () => {
  it('renders the account dock in Chinese', () => {
    setCopyLocale('zh')
    const { panel } = fixture()
    panel.setView(signedIn)
    const text = panel.render(80).join('\n')
    expect(text).toContain(copy.account.title)
    expect(text).toContain(copy.account.balanceLabel)
    expect(text).toContain(copy.account.signOut)
  })
})

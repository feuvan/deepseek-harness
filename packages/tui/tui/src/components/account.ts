/**
 * Interactive `/account` dock: identity, wallet balances, browser sign-in,
 * retry, re-login, and sign-out. The terminal application owns the account
 * service calls; this component owns presentation and selection only.
 *
 * @module @deepseek-ai/dsh-tui/components/account
 */

import { matchesKey, truncateToWidth, type Component } from '@earendil-works/pi-tui'
import type { AccountProfile, AccountWallet } from '@deepseek-ai/dsh-deepseek-account'
import type { AccountLoginUpdate } from '../account-login.ts'
import { copy } from '../copy.ts'
import { displayText } from '../display-text.ts'
import type { Palette } from '../palette.ts'

/** Stable state rendered by the account panel. */
export interface AccountPanelView {
  /** Account presence or query outcome. */
  readonly status: 'loading' | 'signed-out' | 'signed-in' | 'error'
  /** Whether this composition can start browser sign-in. */
  readonly canSignIn: boolean
  /** Platform profile, when readable. */
  readonly profile?: AccountProfile | null | undefined
  /** Recharge wallets, when readable. */
  readonly wallets?: readonly AccountWallet[] | undefined
  /** Bonus wallets, when readable. */
  readonly bonusWallets?: readonly AccountWallet[] | undefined
  /** Profile query failed independently of the account state. */
  readonly profileFailed?: boolean | undefined
  /** Balance query failed independently of the account state. */
  readonly balanceFailed?: boolean | undefined
  /** Browser links supplied by the account provider. */
  readonly links?: { readonly usageUrl: string; readonly topUpUrl: string } | undefined
  /** Query or action failure. */
  readonly error?: string | undefined
  /** Short label while an action is running. */
  readonly busy?: string | undefined
  /** Browser sign-in progress. */
  readonly login?: AccountLoginUpdate | undefined
}

/** Parent operations the account panel can invoke. */
export interface AccountPanelActions {
  /** Reload the account view and wallet data. */
  refresh(): void
  /** Start browser sign-in or re-login. */
  signIn(): void
  /** Sign out after the panel's confirmation. */
  signOut(): void
  /** Open the provider's usage page. */
  openUsage(url: string): void
  /** Open the provider's top-up page. */
  openTopUp(url: string): void
  /** Close the dock. */
  close(): void
  /** Cancel an in-flight browser sign-in. */
  cancel(): void
  /** Request a repaint after state changes. */
  requestRender(): void
}

/** Constructor values for the account dock. */
export interface AccountPanelOptions {
  /** Terminal style table. */
  readonly palette: Palette
  /** Parent operations. */
  readonly actions: AccountPanelActions
}

/** One selectable account action. */
interface AccountAction {
  readonly id: 'refresh' | 'signIn' | 'signOut' | 'retry' | 'usage' | 'topUp' | 'close'
  readonly label: string
}

/** The `/account` bottom-dock component. */
export class AccountPanel implements Component {
  private readonly palette: Palette
  private readonly actions: AccountPanelActions
  private view: AccountPanelView = { status: 'loading', canSignIn: false }
  private index = 0
  private confirming = false

  /**
   * @param options - palette and parent operations.
   */
  constructor(options: AccountPanelOptions) {
    this.palette = options.palette
    this.actions = options.actions
  }

  /**
   * Replace the rendered account state.
   * @param view - latest account data.
   */
  setView(view: AccountPanelView): void {
    this.view = view
    this.index = 0
    this.actions.requestRender()
  }

  /**
   * Return the current view for the parent's request sequencing.
   * @returns the latest rendered account state.
   */
  currentView(): AccountPanelView {
    return this.view
  }

  /** @returns whether a browser sign-in is in progress. */
  private signingIn(): boolean {
    return this.view.login !== undefined || this.view.busy !== undefined
  }

  /** @returns the selectable actions for the current state. */
  private actionsFor(): readonly AccountAction[] {
    if (this.confirming) {
      return [
        { id: 'signOut', label: copy.account.confirmYes },
        { id: 'close', label: copy.account.confirmNo },
      ]
    }
    if (this.view.status === 'signed-in') {
      return [
        { id: 'refresh', label: copy.account.refresh },
        { id: 'signIn', label: copy.account.reLogin },
        { id: 'signOut', label: copy.account.signOut },
        ...(this.view.links === undefined ? [] : [
          { id: 'usage' as const, label: copy.account.usage },
          { id: 'topUp' as const, label: copy.account.topUp },
        ]),
        { id: 'close', label: copy.account.close },
      ]
    }
    if (this.view.status === 'error') {
      return [
        { id: 'retry', label: copy.account.retry },
        ...(this.view.canSignIn ? [{ id: 'signIn' as const, label: copy.account.signIn }] : []),
        { id: 'close', label: copy.account.close },
      ]
    }
    return [
      ...(this.view.canSignIn ? [{ id: 'signIn' as const, label: copy.account.signIn }] : []),
      { id: 'refresh', label: copy.account.refresh },
      { id: 'close', label: copy.account.close },
    ]
  }

  /** Run the highlighted action. */
  private activate(): void {
    const action = this.actionsFor()[this.index]
    /* v8 ignore next -- the index is clamped to a non-empty action list */
    if (action === undefined) return
    switch (action.id) {
      case 'refresh':
      case 'retry': this.actions.refresh(); return
      case 'signIn': this.actions.signIn(); return
      case 'signOut':
        if (!this.confirming) {
          this.confirming = true
          this.index = 0
          this.actions.requestRender()
          return
        }
        this.confirming = false
        this.actions.signOut()
        return
      case 'usage':
        /* v8 ignore next -- usage appears only when links exist */
        if (this.view.links !== undefined) this.actions.openUsage(this.view.links.usageUrl)
        return
      case 'topUp':
        /* v8 ignore next -- top-up appears only when links exist */
        if (this.view.links !== undefined) this.actions.openTopUp(this.view.links.topUpUrl)
        return
      case 'close': this.actions.close(); return
    }
  }

  /**
   * Handle one input sequence while the account dock owns focus.
   * @param data - raw terminal input.
   * @returns whether the sequence was consumed.
   */
  handleInput(data: string): boolean {
    if (matchesKey(data, 'escape')) {
      if (this.view.login !== undefined) { this.actions.cancel(); return true }
      if (this.signingIn() || this.confirming) {
        this.confirming = false
        this.actions.requestRender()
        return true
      }
      this.actions.close()
      return true
    }
    if (this.signingIn()) return true
    if (matchesKey(data, 'up') || data === 'k') {
      const actions = this.actionsFor()
      this.index = (this.index + actions.length - 1) % Math.max(1, actions.length)
      this.actions.requestRender()
      return true
    }
    if (matchesKey(data, 'down') || data === 'j') {
      const actions = this.actionsFor()
      this.index = (this.index + 1) % Math.max(1, actions.length)
      this.actions.requestRender()
      return true
    }
    if (matchesKey(data, 'enter')) this.activate()
    return true
  }

  /** @param wallets - wallets to render. @returns formatted wallet text. */
  private walletText(wallets: readonly AccountWallet[] | undefined): string {
    if (wallets === undefined || wallets.length === 0) return '—'
    return wallets.map(wallet => `${wallet.currency} ${displayText(wallet.balance)}`).join(' · ')
  }

  /** @returns the account details lines. */
  private details(): string[] {
    const view = this.view
    if (view.status === 'loading') return [this.palette.dim(copy.account.loading)]
    if (view.status === 'signed-out') return [copy.account.signedOut]
    if (view.status === 'error') return [this.palette.error(displayText(view.error ?? ''))]
    const lines = [
      view.profileFailed === true
        ? this.palette.dim(copy.account.profileUnavailable)
        : view.profile?.name ?? copy.account.signedInUnknown,
    ]
    if (view.profile?.contact !== null && view.profile?.contact !== undefined) {
      lines.push(this.palette.dim(`${copy.account.contactLabel}: ${displayText(view.profile.contact)}`))
    }
    lines.push(`${copy.account.balanceLabel}: ${this.walletText(view.wallets)}`)
    lines.push(`${copy.account.bonusLabel}: ${this.walletText(view.bonusWallets)}`)
    if (view.balanceFailed === true) lines.push(this.palette.dim(copy.account.balanceUnavailable))
    return lines
  }

  /** @returns the login-waiting lines. */
  private loginLines(): string[] {
    const login = this.view.login
    const lines = [this.palette.bold(copy.account.title), copy.account.loginWaiting]
    if (login?.url !== undefined) lines.push('', copy.account.loginUrl, this.palette.link(login.url))
    lines.push('', this.palette.dim(copy.account.loginCancel))
    return lines
  }

  /** @returns the action lines. */
  private actionLines(): string[] {
    return this.actionsFor().map((action, index) => {
      const marker = index === this.index ? this.palette.accent('❯') : ' '
      return `${marker} ${action.label}`
    })
  }

  /**
   * Render the account dock.
   * @param width - available columns.
   * @returns styled panel lines.
   */
  render(width: number): string[] {
    const lines: string[] = []
    if (this.view.login !== undefined) {
      lines.push(...this.loginLines())
    } else {
      lines.push(this.palette.heading(copy.account.title))
      if (this.view.busy !== undefined) lines.push(this.palette.dim(this.view.busy))
      if (this.confirming) lines.push('', copy.account.confirmSignOut)
      else lines.push(...this.details())
      if (!this.signingIn()) lines.push('', ...this.actionLines())
    }
    lines.push('', this.palette.dim(copy.account.hint))
    return lines.map(line => truncateToWidth(line, width))
  }

  /** No cached child renderer state exists. */
  invalidate(): void {}
}

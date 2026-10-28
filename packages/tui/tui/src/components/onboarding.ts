/**
 * Full-screen first-run connection flow: choose an account sign-in, an API
 * key, or skip; then select one of the discovered models.
 *
 * The panel renders as an overlay above the normal terminal interface so the
 * transcript and composer keep their layout while setup owns the keyboard.
 *
 * @module @deepseek-ai/dsh-tui/components/onboarding
 */

import {
  Input, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component,
} from '@earendil-works/pi-tui'
import type { AccountLoginUpdate } from '../account-login.ts'
import { AccountLoginError } from '../account-login.ts'
import { copy } from '../copy.ts'
import { displayText } from '../display-text.ts'
import type { Palette } from '../palette.ts'
import type { TuiModelRow } from '../model-selector.ts'

/** The parent operations the panel can invoke. */
export interface OnboardingActions {
  /** Whether DeepSeek account sign-in is composed. */
  readonly canSignIn: boolean
  /**
   * Run browser sign-in.
   * @param update - progress callback owned by the panel.
   * @param signal - aborts the attempt.
   * @returns discovered models, or an empty list when the route stays unavailable.
   */
  signIn(update: (update: AccountLoginUpdate) => void, signal: AbortSignal): Promise<readonly TuiModelRow[]>
  /**
   * Store one API key and discover its models.
   * @param key - pasted API key.
   * @returns discovered models.
   */
  saveApiKey(key: string): Promise<readonly TuiModelRow[]>
  /**
   * Apply one model selection and finish onboarding.
   * @param row - chosen model.
   */
  chooseModel(row: TuiModelRow): Promise<void>
  /** Leave setup without a model. */
  skip(): void
  /** Request one frame after panel state changes. */
  requestRender(): void
}

/** Constructor values for the first-run panel. */
export interface OnboardingOptions {
  /** Terminal style table. */
  readonly palette: Palette
  /** Current terminal rows, padded so the overlay covers the interface. */
  readonly rows: () => number
  /** Parent operations. */
  readonly actions: OnboardingActions
}

/** One welcome-screen choice. */
interface OnboardingChoice {
  readonly id: 'account' | 'api-key' | 'skip'
  readonly label: string
  readonly description: string
}

/** Wire an Input to submit/escape while preserving the panel mode. */
type Mode = 'welcome' | 'account' | 'api-key' | 'model'

/** First-run connection panel. */
export class OnboardingPanel implements Component {
  private readonly palette: Palette
  private readonly rows: () => number
  private readonly actions: OnboardingActions
  private readonly input: Input
  private mode: Mode = 'welcome'
  private index = 0
  private models: readonly TuiModelRow[] = []
  private error: string | undefined
  private busy = false
  private accountPhase: AccountLoginUpdate['phase'] = null
  private accountUrl: string | undefined
  private controller: AbortController | undefined

  /**
   * @param options - palette, terminal size, and parent operations.
   */
  constructor(options: OnboardingOptions) {
    this.palette = options.palette
    this.rows = options.rows
    this.actions = options.actions
    this.input = new Input()
    this.input.onSubmit = () => { void this.submitApiKey() }
  }

  /** @returns the welcome choices, filtered to what this build can offer. */
  private choices(): readonly OnboardingChoice[] {
    return [
      ...(this.actions.canSignIn ? [{
        id: 'account' as const,
        label: copy.onboarding.account,
        description: copy.onboarding.accountDescription,
      }] : []),
      { id: 'api-key', label: copy.onboarding.apiKey, description: copy.onboarding.apiKeyDescription },
      { id: 'skip', label: copy.onboarding.skip, description: copy.onboarding.skipDescription },
    ]
  }

  /** Select the highlighted welcome choice. */
  private choose(): void {
    /* v8 ignore next -- the computed choices are non-empty and the index is always in range */
    const choices = this.choices()
    const choice = choices[this.index]
    /* v8 ignore next -- the computed choices are non-empty and the index stays in range */
    if (choice === undefined) return
    if (choice.id === 'account') { void this.startAccount(); return }
    if (choice.id === 'api-key') {
      this.mode = 'api-key'
      this.error = undefined
      this.busy = false
      this.input.setValue('')
      this.actions.requestRender()
      return
    }
    this.actions.skip()
  }

  /** @returns the failure copy for one error. */
  private message(error: unknown): string {
    if (error instanceof AccountLoginError) {
      return copy.onboarding.accountFailures[error.code] ?? String(error)
    }
    return error instanceof Error ? error.message : String(error)
  }

  /** Begin the browser sign-in. */
  private async startAccount(): Promise<void> {
    this.mode = 'account'
    this.error = undefined
    this.busy = true
    this.accountPhase = 'starting'
    this.accountUrl = undefined
    this.controller = new AbortController()
    this.actions.requestRender()
    try {
      const models = await this.actions.signIn((update) => {
        this.accountPhase = update.phase
        if (update.url !== undefined) this.accountUrl = update.url
        this.actions.requestRender()
      }, this.controller.signal)
      if (models.length === 0) throw new Error(copy.onboarding.failed('no model route is available'))
      this.models = models
      this.index = 0
      this.mode = 'model'
    } catch (error: unknown) {
      if (error instanceof AccountLoginError && error.code === 'cancelled') {
        this.mode = 'welcome'
        this.error = undefined
      } else {
        this.error = this.message(error)
      }
    } finally {
      this.controller = undefined
      this.busy = false
      this.actions.requestRender()
    }
  }

  /** Store the typed API key and continue to model selection. */
  private async submitApiKey(): Promise<void> {
    /* v8 ignore next -- handleInput already routes every key while busy */
    if (this.busy) return
    const key = this.input.getValue().trim()
    if (key === '') return
    this.busy = true
    this.error = undefined
    this.actions.requestRender()
    try {
      const models = await this.actions.saveApiKey(key)
      if (models.length === 0) throw new Error(copy.onboarding.apiKeyInvalid)
      this.models = models
      this.index = 0
      this.mode = 'model'
    } catch (error: unknown) {
      this.error = this.message(error)
    } finally {
      this.busy = false
      this.actions.requestRender()
    }
  }

  /** Choose the highlighted model. */
  private async chooseModel(): Promise<void> {
    /* v8 ignore next -- handleInput already routes every key while busy */
    if (this.busy) return
    /* v8 ignore next -- model mode is entered only with a non-empty row list */
    const row = this.models[this.index] as TuiModelRow
    this.busy = true
    this.error = undefined
    this.actions.requestRender()
    try {
      await this.actions.chooseModel(row)
    } catch (error: unknown) {
      this.error = this.message(error)
    } finally {
      this.busy = false
      this.actions.requestRender()
    }
  }

  /** Go back one setup step. */
  private back(): void {
    if (this.mode === 'account') {
      this.controller?.abort()
      this.mode = 'welcome'
      this.busy = false
      this.error = undefined
      this.actions.requestRender()
      return
    }
    if (this.mode === 'welcome') {
      this.actions.skip()
      return
    }
    if (this.mode === 'api-key') {
      this.mode = 'welcome'
      this.error = undefined
      this.actions.requestRender()
      return
    }
    this.mode = 'welcome'
    this.error = undefined
    this.actions.requestRender()
  }

  /**
   * Handle one input sequence while setup owns the keyboard.
   * @param data - raw terminal input.
   * @returns whether the sequence was consumed.
   */
  handleInput(data: string): boolean {
    if (matchesKey(data, 'escape')) { this.back(); return true }
    if (this.busy) return true
    if (this.mode === 'welcome') {
      if (matchesKey(data, 'up') || data === 'k') {
        this.index = (this.index + this.choices().length - 1) % this.choices().length
        this.actions.requestRender()
        return true
      }
      if (matchesKey(data, 'down') || data === 'j') {
        this.index = (this.index + 1) % this.choices().length
        this.actions.requestRender()
        return true
      }
      if (matchesKey(data, 'enter')) { this.choose(); return true }
      return true
    }
    if (this.mode === 'account') {
      if (matchesKey(data, 'enter') && this.error !== undefined) { void this.startAccount(); return true }
      /* v8 ignore next -- the account mode is only interactive while an attempt owns the panel */
      return true
    }
    if (this.mode === 'api-key') {
      this.input.handleInput(data)
      this.actions.requestRender()
      return true
    }
    if (matchesKey(data, 'up') || data === 'k') {
      this.index = (this.index + this.models.length - 1) % Math.max(1, this.models.length)
      this.actions.requestRender()
      return true
    }
    if (matchesKey(data, 'down') || data === 'j') {
      this.index = (this.index + 1) % Math.max(1, this.models.length)
      this.actions.requestRender()
      return true
    }
    if (matchesKey(data, 'enter')) { void this.chooseModel() }
    return true
  }

  /** @returns the account-waiting body. */
  private accountBody(): string[] {
    const lines = [this.palette.bold(copy.onboarding.accountTitle)]
    if (this.busy) lines.push(this.palette.dim(copy.onboarding.working))
    lines.push('', copy.onboarding.accountWaiting)
    if (this.accountUrl !== undefined) {
      lines.push('', copy.onboarding.accountUrl, this.palette.link(this.accountUrl))
    }
    lines.push('', this.palette.dim(copy.onboarding.accountCancel))
    if (this.accountPhase === 'exchanging' || this.accountPhase === 'committing') {
      lines.push(this.palette.dim(copy.onboarding.working))
    }
    return lines
  }

  /** @returns the API-key body. */
  private apiKeyBody(): string[] {
    return [
      this.palette.bold(copy.onboarding.apiKeyTitle),
      '',
      this.palette.dim(copy.onboarding.apiKeyHint),
      '',
      `${this.palette.prompt('key>')} ${'•'.repeat(this.input.getValue().length)}`,
    ]
  }

  /** @returns the model-selection body. */
  private modelBody(): string[] {
    const lines = [this.palette.bold(copy.onboarding.modelTitle), '']
    const width = 100
    this.models.forEach((row, index) => {
      const marker = index === this.index ? this.palette.accent('❯') : ' '
      const label = `${row.providerName}/${row.name}`
      const detail = row.description === undefined ? '' : ` ${this.palette.dim(displayText(row.description))}`
      lines.push(truncateToWidth(`${marker} ${label}${detail}`, width))
    })
    lines.push('', this.palette.dim(copy.onboarding.modelHint))
    return lines
  }

  /** @returns the welcome body. */
  private welcomeBody(): string[] {
    const lines = [
      this.palette.heading(copy.onboarding.title),
      this.palette.dim(copy.onboarding.subtitle),
      '',
    ]
    for (const [index, choice] of this.choices().entries()) {
      const marker = index === this.index ? this.palette.accent('❯') : ' '
      lines.push(truncateToWidth(`${marker} ${this.palette.bold(choice.label)}`, 100))
      lines.push(truncateToWidth(`  ${this.palette.dim(choice.description)}`, 100))
    }
    lines.push('', this.palette.dim(copy.onboarding.selectHint))
    return lines
  }

  /** @returns the mode-specific body. */
  private body(): string[] {
    switch (this.mode) {
      case 'welcome': return this.welcomeBody()
      case 'account': return this.accountBody()
      case 'api-key': return this.apiKeyBody()
      case 'model': return this.modelBody()
    }
  }

  /**
   * Render the panel over the full terminal viewport.
   * @param width - available columns.
   * @returns exactly the terminal row count of styled lines.
   */
  render(width: number): string[] {
    const body = this.body()
    if (this.error !== undefined) body.push('', this.palette.error(displayText(this.error)))
    const lines: string[] = []
    const left = 2
    for (const line of body) {
      const wrapped = wrapTextWithAnsi(line, Math.max(1, width - left * 2))
      for (const row of wrapped) lines.push(' '.repeat(left) + row)
    }
    const height = Math.max(1, this.rows())
    while (lines.length < height) lines.push('')
    return lines.slice(0, height).map((line) => {
      const truncated = truncateToWidth(line, width)
      return truncated + ' '.repeat(Math.max(0, width - visibleWidth(truncated)))
    })
  }

  /** No cached child renderer state exists. */
  invalidate(): void {}
}

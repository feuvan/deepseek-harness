/**
 * Terminal application lifecycle: wait for the composed root Agent, take the
 * screen over, drive the composer and transcript, and restore the terminal on
 * every exit path.
 *
 * @module @deepseek-ai/dsh-tui/lifecycle
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { installModelSelection, type Agent, type ModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { AppExit } from '@deepseek-ai/dsh-cmdline'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  ScrollView, VStack, isViewportTUI, matchesKey, type MarkdownTheme, type TUI,
} from '@earendil-works/pi-tui'
import type { ResolvedConfig } from './config.ts'
import { copy } from './copy.ts'
import { Composer } from './commands.ts'
import { Banner } from './components/banner.ts'
import { Footer } from './components/footer.ts'
import { ModelSelectorPanel, loadTuiModelCatalog, nextEffort, type TuiModelCatalog, type TuiModelRow } from './model-selector.ts'
import { TerminalAutocompleteProvider } from './autocomplete.ts'
import { expandPromptMentions } from './mentions.ts'
import { ModalHost, registerApprovalAnswerer, registerQuestionAnswerer } from './interactions.ts'
import { StatusModel } from './status.ts'
import { TerminalTranscript } from './transcript.ts'
import { createMarkdownTheme, createSelectListTheme } from './markdown.ts'
import { createPalette, type Palette } from './palette.ts'
import { createTerminalSession, type TerminalSession } from './terminal.ts'
import { TextPanel } from './components/dialogs.ts'
import { ChoicePanel } from './components/choice.ts'
import { PromptEditor } from './components/editor.ts'

/** A startup or in-flight failure the terminal reports before exiting. */
export class TerminalApp {
  private readonly ctx: Context
  private readonly config: ResolvedConfig
  private readonly appExit: AppExit
  private readonly palette: Palette
  private readonly modal = new ModalHost()
  private readonly disposers: (() => void)[] = []
  private terminal: TerminalSession | undefined
  private tui: TUI | undefined
  private editor: PromptEditor | undefined
  private transcript: TerminalTranscript | undefined
  private footer: Footer | undefined
  private status: StatusModel | undefined
  private composer: Composer | undefined
  private catalog: TuiModelCatalog | undefined
  private markdownTheme: MarkdownTheme | undefined
  private started = false
  private agent: Agent | undefined
  private selection: ModelSelectionRef | undefined
  private animation: ReturnType<typeof setInterval> | undefined
  private lastSeq = -1
  private disposed = false
  private exiting = false
  private readonly createTerminal: () => TerminalSession

  /**
   * @param ctx - host context carrying every service the terminal consumes.
   * @param config - resolved terminal configuration.
   * @param appExit - launcher exit request.
   * @param createTerminal - terminal factory; tests supply a headless terminal.
   */
  constructor(
    ctx: Context,
    config: ResolvedConfig,
    appExit: AppExit,
    createTerminal: () => TerminalSession = () => createTerminalSession(),
  ) {
    this.ctx = ctx
    this.config = config
    this.appExit = appExit
    this.createTerminal = createTerminal
    this.palette = createPalette(config.color)
  }

  /**
   * Whether the application has begun disposal.
   * @returns whether disposal started.
   */
  private isDisposed(): boolean {
    return this.disposed
  }

  /** Begin the asynchronous startup sequence. */
  start(): void {
    void this.run().catch((error: unknown) => { this.fail(error) })
  }

  /** Stop every registration and restore the terminal; safe to call more than once. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.animation !== undefined) {
      clearInterval(this.animation)
      this.animation = undefined
    }
    this.modal.cancelCurrent()
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose()
      } catch (error: unknown) {
        // A disposer failure must not prevent terminal restoration; the
        // launcher's shutdown path reports the remaining diagnostics.
        void error
      }
    }
    this.status?.dispose()
    if (this.started) this.terminal?.stop()
  }

  /**
   * Report one failure and request a failing exit.
   * @param error - the failure to report.
   */
  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`dsh: ${message}\n`)
    this.dispose()
    if (!this.exiting) {
      this.exiting = true
      this.appExit(1)
    }
  }

  /** Resolve the composed Agent, build the interface, and replay history. */
  private async run(): Promise<void> {
    await this.ctx.get('loader')?.await()
    if (this.disposed) return
    const agent = await this.waitForAgent()
    if (agent === undefined || this.isDisposed()) return
    this.bindAgent(agent)
    const selection: ModelSelectionRef = { current: initialSelection(agent), assembled: undefined }
    this.selection = selection
    installModelSelection(agent.ctx, selection)
    this.startTerminal(agent)
    this.subscribe()
    this.startAnimation()
    void this.ensureCatalog()
    await this.observeHistory(agent)
    if (this.isDisposed()) return
    this.tui?.start()
    this.started = true
    if (this.editor !== undefined) this.tui?.setFocus(this.editor)
  }

  /**
   * Wait for the live root Agent of the configured Session.
   * @returns the Agent, or undefined when the application is disposed first.
   */
  private async waitForAgent(): Promise<Agent | undefined> {
    const existing = this.ctx.agents.get(this.config.sessionId)
    if (existing !== undefined) return existing
    return await new Promise<Agent | undefined>((resolve) => {
      let settled = false
      const finish = (agent: Agent | undefined): void => {
        if (settled) return
        settled = true
        resolve(agent)
      }
      const stop = this.ctx.on('agent/created', ({ agent }) => {
        if (agent.session.id !== this.config.sessionId) return
        stop()
        finish(agent)
      })
      this.disposers.push(() => {
        stop()
        finish(undefined)
      })
    })
  }

  /**
   * Bind the presented Agent to the transcript.
   * @param agent - the live root Agent.
   */
  private bindAgent(agent: Agent): void {
    this.agent = agent
    this.transcript?.setAgent(agent)
  }

  /**
   * Build the renderer, layout, composer, and interaction providers.
   * @param agent - the live root Agent.
   */
  private startTerminal(agent: Agent): void {
    const terminal = this.createTerminal()
    this.terminal = terminal
    const tui = terminal.tui
    this.tui = tui
    tui.terminal.setTitle(this.config.title)
    const markdown = createMarkdownTheme(this.palette)
    this.markdownTheme = markdown
    const transcript = new TerminalTranscript({
      palette: this.palette,
      markdown,
      previewLines: this.config.previewLines,
      windowBlocks: this.config.windowBlocks,
      requestRender: () => { tui.requestRender() },
      findTool: name => this.ctx.tools.get(name, agent),
    })
    this.transcript = transcript
    transcript.setAgent(agent)
    const selection = this.selection
    /* v8 ignore next -- run() installs the selection before this renderer is built */
    if (selection === undefined) throw new Error('terminal-ui: model selection was not installed before the renderer started')
    const status = new StatusModel({
      ctx: this.ctx,
      agent: () => this.agent,
      selection,
      config: this.config,
      effort: () => this.effectiveEffort(),
      turnStartedAt: () => transcript.turnStartedAt(),
      requestRender: () => { tui.requestRender() },
    })
    this.status = status
    const footer = new Footer(this.palette, () => status.snapshot())
    this.footer = footer
    const banner = new Banner(this.palette, {
      /* v8 ignore next -- run() installs a current selection before the banner can render */
      model: () => this.selection?.current?.model ?? '',
      sessionId: this.config.sessionId,
      cwd: () => status.snapshot().cwd,
    })
    const editor = new PromptEditor(
      tui,
      { borderColor: text => this.palette.border(text), selectList: createSelectListTheme(this.palette) },
      { prompt: `${this.palette.prompt('dsh>')} `, hint: copy.composer.idle },
    )
    this.editor = editor
    const composer = new Composer({
      ctx: this.ctx,
      agent: () => this.agent,
      notice: (text) => { this.transcript?.notice(text) },
      expandPrompt: text => this.expandPrompt(text),
      choices: {
        efforts: () => this.effortChoices(),
        permissions: () => this.permissionChoices(),
      },
      local: {
        help: () => { this.showText(copy.panel.help, composer.helpLines()) },
        status: () => { this.showStatus() },
        model: () => { void this.openModelSelector() },
        clear: () => { this.transcript?.clear() },
        reasoning: () => { this.transcript?.toggleReasoning() },
        cards: () => { this.transcript?.toggleCards() },
        effort: argument => this.setEffort(argument),
        permission: argument => this.choosePermission(argument),
        redraw: () => { tui.renderNow(true) },
        exit: () => { this.requestExit(0) },
      },
    })
    this.composer = composer
    editor.onSubmit = (line: string) => {
      editor.setText('')
      editor.addToHistory(line)
      composer.submit(line)
    }
    const transcriptView = new ScrollView(transcript.component, {
      follow: 'end',
      primary: true,
      overscroll: 'chain',
    })
    const lower = new VStack([editor, footer])
    if (isViewportTUI(tui)) {
      tui.setLayoutRoot(new VStack([
        { component: banner, basis: 'auto' },
        { component: transcriptView, basis: 0, grow: 1, minSize: 1 },
        { component: lower, basis: 'auto' },
      ]))
    } else {
      tui.addChild(banner)
      tui.addChild(transcriptView)
      tui.addChild(lower)
    }
    this.disposers.push(tui.addInputListener((data: string) => {
      if (matchesKey(data, 'ctrl+c')) {
        this.handleInterrupt()
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+o')) {
        this.transcript?.toggleCards()
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+r')) {
        this.transcript?.toggleReasoning()
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+l')) {
        tui.renderNow(true)
        return { consume: true }
      }
      if (matchesKey(data, 'shift+tab')) {
        void this.cycleEffort()
        return { consume: true }
      }
      return undefined
    }))
    this.refreshAutocomplete()
    tui.setShowHardwareCursor(true)
  }

  /**
   * Subscribe to the durable log, live frames, agent status, and interface events.
   * @param agent - the presented root Agent.
   */
  private subscribe(): void {
    this.disposers.push(this.ctx.on('session/event', (session, event) => {
      if (session !== this.agent?.session) return
      if (event.type === 'session/title') this.tui?.terminal.setTitle(this.titleLine())
      this.appendEvent(event)
    }))
    this.disposers.push(this.ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
      if (subject !== this.agent) return
      this.transcript?.live(frame)
    }))
    this.disposers.push(this.ctx.on('agent/status', ({ agent: subject }) => {
      if (subject !== this.agent) return
      this.editor?.setHint(subject.status === 'running' ? copy.composer.running : copy.composer.idle)
      this.tui?.requestRender()
    }))
    this.disposers.push(this.ctx.on('agent/created', ({ agent: subject }) => {
      if (subject.session.id !== this.config.sessionId || subject === this.agent) return
      this.bindAgent(subject)
      this.transcript?.clear()
      this.lastSeq = -1
      void this.observeHistory(subject).catch((error: unknown) => { this.fail(error) })
    }))
    this.disposers.push(this.ctx.on('agent/disposed', ({ agent: subject }) => {
      if (subject !== this.agent) return
      this.transcript?.notice('The agent was disposed; closing the terminal.', 'warning')
      this.requestExit(0)
    }))
    this.disposers.push(this.ctx.on('commands/change', () => { this.refreshAutocomplete() }))
    this.disposers.push(this.ctx.on('permission-presets/catalog-changed', () => { this.refreshAutocomplete() }))
    const markdown = this.markdownTheme
    /* v8 ignore next -- startTerminal() always records the markdown theme before subscribe() */
    if (markdown === undefined) throw new Error('terminal-ui: interaction providers require the markdown theme')
    this.disposers.push(registerQuestionAnswerer({
      ctx: this.ctx,
      tui: this.requireTui(),
      palette: this.palette,
      markdown,
      /* v8 ignore next -- the question answerer presents request.agent, not this dependency */
      agent: () => this.agent,
      requestRender: () => { this.tui?.requestRender() },
    }, this.config.sessionId, this.modal))
    this.disposers.push(registerApprovalAnswerer({
      ctx: this.ctx,
      tui: this.requireTui(),
      palette: this.palette,
      markdown,
      /* v8 ignore next -- the approval answerer presents request.agent, not this dependency */
      agent: () => this.agent,
      /* v8 ignore next -- approvals carry no timed-wait countdown to repaint */
      requestRender: () => { this.tui?.requestRender() },
    }, this.config.sessionId, this.modal))
  }

  /** @returns a title line combining the Session title and the configured prefix. */
  private titleLine(): string {
    const title = this.status?.snapshot().title
    return title === undefined ? this.config.title : `${title} — ${this.config.title}`
  }

  /** @returns the renderer, proving it was built before interaction providers registered. */
  private requireTui(): TUI {
    /* v8 ignore next -- every caller runs after startTerminal() recorded the renderer */
    if (this.tui === undefined) throw new Error('terminal-ui: interaction providers require the renderer')
    return this.tui
  }

  /**
   * Append one durable event with sequence continuity checks.
   * @param event - the committed Session event.
   */
  private appendEvent(event: SessionEvent): void {
    if (event.seq <= this.lastSeq) return
    if (this.lastSeq >= 0 && event.seq > this.lastSeq + 1) {
      this.transcript?.notice(`Transcript gap: events ${String(this.lastSeq + 1)}..${String(event.seq - 1)} are missing.`, 'warning')
    }
    this.lastSeq = event.seq
    this.transcript?.append(event)
  }

  /**
   * Replay the Session history and continue live from the first unseen event.
   * @param agent - the presented root Agent.
   */
  private async observeHistory(agent: Agent): Promise<void> {
    const query = this.ctx.get('sessionQuery')
    if (query === undefined) throw new Error('terminal-ui requires the sessionQuery service to read Session history')
    const buffered: SessionEvent[] = []
    let live = false
    const stop = this.ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      if (!live) {
        buffered.push(event)
        return
      }
      this.appendEvent(event)
    })
    this.disposers.push(stop)
    try {
      using observation = await query.observeSession(agent.session.id, { projectionMode: 'all' })
      for (const event of observation.events) this.appendEvent(event)
      live = true
      for (const event of buffered) this.appendEvent(event)
    } finally {
      live = true
    }
  }

  /** Start the running-status clock when animation is enabled. */
  private startAnimation(): void {
    if (!this.config.animation) return
    this.animation = setInterval(() => {
      if (this.agent?.status !== 'running') return
      this.footer?.invalidate()
      this.tui?.requestRender()
    }, 1000)
    this.animation.unref()
  }

  /** Rebuild the editor autocomplete from the current command catalog. */
  private refreshAutocomplete(): void {
    /* v8 ignore next -- startTerminal() installs both before it first refreshes autocomplete */
    if (this.editor === undefined || this.composer === undefined) return
    this.editor.setAutocompleteProvider(new TerminalAutocompleteProvider({
      ctx: this.ctx,
      agent: () => this.agent,
      cwd: () => this.status?.snapshot().cwd ?? process.cwd(),
      commands: () => this.composer?.slashCommands() ?? [],
    }))
  }

  /** Handle Ctrl+C: close a modal, cancel a turn, or exit. */
  private handleInterrupt(): void {
    if (this.modal.cancelCurrent()) return
    const agent = this.agent
    if (agent !== undefined && agent.status === 'running') {
      agent.cancel({ kind: 'user' })
      return
    }
    this.requestExit(0)
  }

  /**
   * Request a clean exit: cancel, settle, flush, restore, then exit.
   * @param code - the process exit code.
   */
  private requestExit(code: number): void {
    if (this.exiting) return
    this.exiting = true
    void (async () => {
      const agent = this.agent
      /* v8 ignore next -- every requestExit() caller runs after the Agent was bound */
      if (agent !== undefined) {
        if (agent.status === 'running') agent.cancel({ kind: 'user' })
        try {
          await agent.whenIdle()
        } catch (error: unknown) {
          void error
        }
        try {
          await this.ctx.sessions.flush(agent.session)
        } catch (error: unknown) {
          void error
        }
      }
      this.dispose()
      this.appExit(code)
    })()
  }

  /**
   * Present a read-only text panel.
   * @param title - panel heading.
   * @param lines - plain body lines.
   */
  private showText(title: string, lines: readonly string[]): void {
    const tui = this.requireTui()
    let handle: ReturnType<TUI['showOverlay']> | undefined
    void this.modal.run(
      () => { handle?.hide() },
      () => new Promise<void>((resolve) => {
        const panel = new TextPanel(title, lines, this.palette, () => {
          handle?.hide()
          resolve()
        })
        handle = tui.showOverlay(panel, { width: '90%', maxHeight: '80%', anchor: 'center', margin: 1 })
      }),
    )
  }

  /**
   * Load the advisory model catalog once, then refresh the footer so the
   * advertised default effort appears without opening the selector.
   * @returns the catalog, or undefined when provider enumeration failed entirely.
   */
  private async ensureCatalog(): Promise<TuiModelCatalog | undefined> {
    try {
      this.catalog ??= await loadTuiModelCatalog(this.ctx)
      this.footer?.invalidate()
      this.tui?.requestRender()
      return this.catalog
    } catch {
      return undefined
    }
  }

  /** @returns the catalog row matching the current selection, when both are available. */
  private currentModelRow(): ReturnType<TuiModelCatalog['rows']['find']> {
    const current = this.selection?.current
    if (current === undefined || this.catalog === undefined) return undefined
    return this.catalog.rows.find(row => row.provider === current.provider && row.model === current.model)
  }

  /**
   * The effort the next request uses: an explicitly selected level, otherwise
   * the adapter-advertised default.
   * @returns the effective effort id, or undefined when the route exposes none.
   */
  private effectiveEffort(): { level: string | undefined; implicit: boolean } {
    const selected = this.selection?.current?.reasoningEffort
    if (selected !== undefined) return { level: selected, implicit: false }
    const level = this.currentModelRow()?.defaultEffort
    return { level, implicit: level !== undefined }
  }

  /**
   * List the current model's effort choices for completion and the chooser.
   * @returns the advertised efforts, plus the provider default when the adapter offers no default.
   */
  private async effortChoices(): Promise<{ value: string; label: string; description?: string }[]> {
    await this.ensureCatalog()
    const row = this.currentModelRow()
    if (row === undefined || row.efforts.length === 0) return []
    const current = this.effectiveEffort().level
    const items = row.efforts.map(effort => ({
      value: effort.id,
      label: effort.name,
      ...(effort.id === current ? { description: copy.model.effortCurrent } : {}),
    }))
    if (row.defaultEffort === undefined) {
      items.unshift({
        value: copy.model.effortDefault,
        label: copy.model.effortDefault,
        ...(current === undefined ? { description: copy.model.effortCurrent } : {}),
      })
    }
    return items
  }

  /**
   * List the composed permission presets for `/permission` argument completion.
   * @returns the catalog options, or an empty list when the service is absent.
   */
  private permissionChoices(): { value: string; label: string; description?: string }[] {
    const presets = this.ctx.get('permissionPresets')
    if (presets === undefined) return []
    return presets.catalog().options.map(option => ({
      value: option.value,
      label: option.name,
      ...(option.description === undefined ? {} : { description: option.description }),
    }))
  }

  /**
   * Apply an effort id (or the provider default) to the current selection.
   * @param value - an advertised effort id or the `default` sentinel.
   */
  private applyEffort(value: string): void {
    const selection = this.selection
    const current = selection?.current
    if (selection === undefined || current === undefined) return
    if (value === copy.model.effortDefault) {
      selection.current = { provider: current.provider, model: current.model }
    } else {
      selection.current = { provider: current.provider, model: current.model, reasoningEffort: ReasoningEffortId(value) }
    }
    this.footer?.invalidate()
    this.tui?.requestRender()
    this.transcript?.notice(copy.model.effort(effectiveLabel(selection.current.reasoningEffort, this.currentModelRow())))
  }

  /**
   * Dispatch one registered command line and surface its immediate failure.
   * @param text - the command line, including its leading slash and argument.
   */
  private dispatchCommand(text: string): void {
    const agent = this.agent
    if (agent === undefined) {
      this.transcript?.notice('The agent is not ready yet.')
      return
    }
    const controller = new AbortController()
    void this.ctx.commands.execute(agent, text, [], controller.signal).then(
      (result) => {
        if (result === undefined) this.transcript?.notice(`Unknown command: ${text}`)
      },
      (error: unknown) => {
        this.transcript?.notice(`Command failed: ${error instanceof Error ? error.message : String(error)}`)
      },
    )
  }

  /**
   * Show the permission-preset chooser, or dispatch a preset name directly.
   * @param argument - the optional `/permission` argument.
   */
  private async choosePermission(argument: string | undefined): Promise<void> {
    const query = argument?.trim()
    if (query !== undefined && query !== '') {
      this.dispatchCommand(`/permission ${query}`)
      return
    }
    const choices = this.permissionChoices()
    if (choices.length === 0) {
      this.dispatchCommand('/permission')
      return
    }
    const current = this.status?.snapshot().permission
    const tui = this.requireTui()
    let handle: ReturnType<TUI['showOverlay']> | undefined
    await this.modal.run(
      () => { handle?.hide() },
      () => new Promise<void>((resolve) => {
        const panel = new ChoicePanel(
          copy.prompt.permissionTitle,
          text => this.palette.heading(text),
          choices.map(item => ({
            value: item.value,
            label: item.label,
            ...(item.value === current
              ? { description: copy.prompt.permissionCurrent }
              : item.description === undefined ? {} : { description: item.description }),
          })),
          createSelectListTheme(this.palette),
          (item) => {
            handle?.hide()
            this.dispatchCommand(`/permission ${item.value}`)
            resolve()
          },
          () => {
            handle?.hide()
            resolve()
          },
        )
        handle = tui.showOverlay(panel, { width: '60%', maxHeight: '60%', anchor: 'center', margin: 1 })
      }),
    )
  }

  /**
   * Show the effort chooser, or apply the argument directly.
   * @param argument - the optional `/effort` argument.
   */
  private async setEffort(argument: string | undefined): Promise<void> {
    const choices = await this.effortChoices()
    if (choices.length === 0) {
      this.transcript?.notice(copy.model.noEffort)
      return
    }
    const query = argument?.trim().toLowerCase()
    if (query !== undefined && query !== '') {
      const match = choices.find(item => item.value.toLowerCase() === query || item.label.toLowerCase() === query)
      if (match === undefined) {
        this.transcript?.notice(copy.model.effortAvailable(choices.map(item => item.value).join(', ')))
        return
      }
      this.applyEffort(match.value)
      return
    }
    const tui = this.requireTui()
    let handle: ReturnType<TUI['showOverlay']> | undefined
    await this.modal.run(
      () => { handle?.hide() },
      () => new Promise<void>((resolve) => {
        const panel = new ChoicePanel(
          copy.model.effortTitle,
          text => this.palette.heading(text),
          choices.map(item => ({
            value: item.value,
            label: item.label,
            ...(item.description === undefined ? {} : { description: item.description }),
          })),
          createSelectListTheme(this.palette),
          (item) => {
            handle?.hide()
            this.applyEffort(item.value)
            resolve()
          },
          () => {
            handle?.hide()
            resolve()
          },
        )
        handle = tui.showOverlay(panel, { width: '60%', maxHeight: '60%', anchor: 'center', margin: 1 })
      }),
    )
  }

  /**
   * Expand `@` mentions of one prompt into image blocks when the composition
   * mounts the services; every failure becomes a transcript notice.
   * @param text - the submitted prompt line.
   * @returns the message content and any attachment diagnostics.
   */
  private expandPrompt(text: string): Promise<{ content: readonly import('@deepseek-ai/dsh-llm').ContentBlock[]; notices: readonly string[] }> {
    const agent = this.agent
    return expandPromptMentions({
      ctx: this.ctx,
      cwd: () => this.status?.snapshot().cwd ?? agent?.session.header.cwd ?? process.cwd(),
      route: () => {
        const current = this.selection?.current
        return current === undefined ? undefined : { provider: current.provider, model: current.model }
      },
    }, text)
  }

  /** Advance the current model's reasoning effort and report the new level. */
  private async cycleEffort(): Promise<void> {
    const selection = this.selection
    const current = selection?.current
    if (selection === undefined || current === undefined) return
    try {
      this.catalog ??= await loadTuiModelCatalog(this.ctx)
      const row = this.catalog.rows.find(candidate => candidate.provider === current.provider && candidate.model === current.model)
      if (row === undefined || row.efforts.length === 0) {
        this.transcript?.notice(copy.model.noEffort)
        return
      }
      const effort = nextEffort(row, this.effectiveEffort().level)
      selection.current = {
        provider: current.provider,
        model: current.model,
        ...(effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) }),
      }
      this.footer?.invalidate()
      this.tui?.requestRender()
      this.transcript?.notice(copy.model.effort(effort ?? 'default'))
    } catch (error: unknown) {
      this.transcript?.notice(copy.model.effortFailed(error instanceof Error ? error.message : String(error)))
    }
  }

  /** Present the Session status panel. */
  private showStatus(): void {
    const state = this.status?.snapshot()
    const agent = this.agent
    /* v8 ignore next -- the status panel opens only after the interface exists */
    if (state === undefined || agent === undefined) {
      this.showText(copy.panel.status, ['The agent is not ready yet.'])
      return
    }
    const lines = [
      `Session      ${agent.session.id}`,
      `Created      ${new Date(agent.session.header.createdAt).toISOString()}`,
      `Working dir  ${state.cwd}`,
      /* v8 ignore start -- run() installs a current selection before the status panel opens */
      `Provider     ${this.selection?.current?.provider ?? agent.options.provider}`,
      /* v8 ignore stop */
      `Model        ${state.model}`,
      `Effort       ${state.effort ?? 'default'}${state.effortImplicit ? ' (default)' : ''}`,
      `Permissions  ${state.permission ?? 'unknown'}`,
      `Status       ${state.status}`,
      `Tokens       ↑${String(state.inputTokens)} ↓${String(state.outputTokens)}`,
      `Cache        ${state.cacheRate === undefined ? 'n/a' : `${String(Math.round(state.cacheRate * 100))}%`}`,
      `Context      ${state.contextPercent === undefined ? 'n/a' : `${String(Math.round(state.contextPercent * 100))}%`}`,
    ]
    this.showText(copy.panel.status, lines)
  }

  /** Present the model selector over the live advisory catalog. */
  private async openModelSelector(): Promise<void> {
    const tui = this.requireTui()
    const catalog = await loadTuiModelCatalog(this.ctx)
    this.catalog = catalog
    let handle: ReturnType<TUI['showOverlay']> | undefined
    await this.modal.run(
      () => { handle?.hide() },
      () => new Promise<void>((resolve) => {
        const panel = new ModelSelectorPanel(
          catalog,
          this.palette,
          (selection) => {
            /* v8 ignore next -- the selector opens only after run() installed the selection */
            if (this.selection !== undefined) this.selection.current = selection
            this.footer?.invalidate()
            this.tui?.requestRender()
            handle?.hide()
            resolve()
          },
          () => {
            handle?.hide()
            resolve()
          },
        )
        handle = tui.showOverlay(panel, { width: '90%', maxHeight: '80%', anchor: 'center', margin: 1 })
      }),
    )
  }
}

/**
 * Label one effective effort for the transcript notice.
 * @param selected - the explicitly selected effort, when any.
 * @param row - the current model row, when the catalog loaded.
 * @returns the selected level, the advertised default, or `default`.
 */
function effectiveLabel(selected: string | undefined, row: TuiModelRow | undefined): string {
  return selected ?? row?.defaultEffort ?? copy.model.effortDefault
}

/**
 * Choose the initial model selection: the latest logged request route when one
 * exists, otherwise the Agent's creation route.
 * @param agent - the presented root Agent.
 * @returns the selection installed on the Agent scope.
 */
function initialSelection(agent: Agent): ModelSelection {
  const config = agent.session.requestHeader()?.config
  if (config !== undefined) {
    return {
      provider: config.provider,
      model: config.model,
      ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }),
    }
  }
  const { provider, model } = agent.options
  if (provider === undefined || model === undefined) {
    throw new Error('terminal-ui: the presented Agent carries no provider/model route')
  }
  return {
    provider,
    model,
    ...(agent.options.reasoningEffort === undefined ? {} : { reasoningEffort: agent.options.reasoningEffort }),
  }
}

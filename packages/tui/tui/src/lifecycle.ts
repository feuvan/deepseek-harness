/**
 * Terminal application lifecycle: wait for the composed root Agent, take the
 * screen over, drive the composer and transcript, and restore the terminal on
 * every exit path.
 *
 * @module @deepseek-ai/dsh-tui/lifecycle
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { installModelSelection, type Agent, type ModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { AppExit } from '@deepseek-ai/dsh-cmdline'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  ScrollView, VStack, isKeyRelease, isViewportTUI, matchesKey, type Component, type MarkdownTheme, type TUI,
} from '@earendil-works/pi-tui'
import type { ResolvedConfig } from './config.ts'
import { copy } from './copy.ts'
import { Composer } from './commands.ts'
import { Banner } from './components/banner.ts'
import { Footer } from './components/footer.ts'
import { ModelSelectorPanel, loadTuiModelCatalog, nextEffort, type TuiModelCatalog, type TuiModelRow } from './model-selector.ts'
import { TerminalAutocompleteProvider } from './autocomplete.ts'
import { expandPromptMentions } from './mentions.ts'
import { readClipboardImage } from './clipboard.ts'
import { nextReasoningLevel, parseReasoningLevel, REASONING_LEVELS } from './reasoning.ts'
import { CARD_MODES, nextCardMode, parseCardMode } from './cards.ts'
import { ModalHost, registerApprovalAnswerer, registerQuestionAnswerer, type InteractionDock } from './interactions.ts'
import { StatusModel } from './status.ts'
import { TerminalTranscript } from './transcript.ts'
import { createMarkdownTheme, createSelectListTheme } from './markdown.ts'
import { createPalette, type Palette } from './palette.ts'
import { createTerminalSession, type TerminalSession } from './terminal.ts'
import { TextPanel } from './components/dialogs.ts'
import { BottomPanel, type DockSurface } from './components/bottom.ts'
import { BottomList } from './bottom-list.ts'
import { QueuePanel, type QueuePanelItem } from './components/queue-panel.ts'
import { ContributedStrips } from './components/contributed-strips.ts'
import type { TerminalCommand, TerminalDockComponent } from './contribution.ts'
import { CompletionController } from './completion.ts'
import { PendingStrip } from './components/pending.ts'
import { ConfigPanel, loadConfigRows, type ConfigPanelActions } from './config-panel.ts'
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
  private autocomplete: TerminalAutocompleteProvider | undefined
  private bottom: BottomPanel | undefined
  private bottomList: BottomList | undefined
  private queuePanel: QueuePanel | undefined
  private completion: CompletionController | undefined
  private configPanel: ConfigPanel | undefined
  private dockOverlay: DockSurface | undefined
  private pendingImages: import('@deepseek-ai/dsh-llm').ContentBlock[] = []
  private markdownTheme: MarkdownTheme | undefined
  private started = false
  private agent: Agent | undefined
  private selection: ModelSelectionRef | undefined
  private animation: ReturnType<typeof setInterval> | undefined
  private lastSeq = -1
  private disposed = false
  private exiting = false
  private readonly createTerminal: () => TerminalSession
  private readonly contributedStrips: Component[] = []
  private readonly pendingCommands: TerminalCommand[] = []
  private readonly contributedCommandDisposers = new Map<TerminalCommand, () => void>()

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

  /**
   * Add one contributed strip above the composer.
   * @param component - strip component; zero rendered lines stays hidden.
   * @returns disposer removing it.
   */
  registerStrip(component: Component): () => void {
    this.contributedStrips.push(component)
    this.tui?.requestRender()
    return () => {
      const index = this.contributedStrips.indexOf(component)
      if (index >= 0) this.contributedStrips.splice(index, 1)
      this.tui?.requestRender()
    }
  }

  /**
   * Register one contributed slash command.
   * @param command - command definition.
   * @returns disposer removing it.
   */
  registerCommand(command: TerminalCommand): () => void {
    const composer = this.composer
    if (composer === undefined) {
      if (this.pendingCommands.some(pending => pending.name === command.name)) {
        throw new Error(`terminal-ui: command "/${command.name}" is already registered`)
      }
      this.pendingCommands.push(command)
      return () => {
        const index = this.pendingCommands.indexOf(command)
        if (index >= 0) this.pendingCommands.splice(index, 1)
        this.contributedCommandDisposers.get(command)?.()
        this.contributedCommandDisposers.delete(command)
      }
    }
    const dispose = composer.registerCommand(command)
    this.contributedCommandDisposers.set(command, dispose)
    return () => {
      dispose()
      this.contributedCommandDisposers.delete(command)
    }
  }

  /**
   * Present one contributed component as the dock.
   * @param component - component owning dock input.
   * @param close - releases the dock.
   */
  openDock(component: TerminalDockComponent, close: () => void): void {
    this.setDockOverlay({
      component,
      handleInput: (data) => { component.handleInput(data); this.tui?.requestRender() },
      close: () => {
        close()
        this.setDockOverlay(undefined)
      },
    })
  }

  /** Release the contribution-owned dock. */
  closeDock(): void {
    this.setDockOverlay(undefined)
  }

  /**
   * Replace the composer text.
   * @param text - new editor content.
   */
  setEditorText(text: string): void {
    this.editor?.setText(text)
    this.tui?.requestRender()
  }

  /**
   * Append one terminal-only notice.
   * @param text - notice text.
   */
  notice(text: string): void {
    this.transcript?.notice(text)
  }

  /**
   * The terminal style table shared with contributed surfaces.
   * @returns the active palette.
   */
  get paletteTable(): Palette {
    return this.palette
  }

  /**
   * The presented root Agent.
   * @returns the Agent, or undefined before it exists.
   */
  currentAgent(): Agent | undefined {
    return this.agent
  }

  /** Ask the renderer for a frame. */
  requestRender(): void {
    this.tui?.requestRender()
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
    try {
      this.terminal?.terminal.setProgramStatus({ state: 'clear', app: 'dsh' })
    } catch (error: unknown) {
      void error
    }
    if (this.started) this.terminal?.stop()
  }

  /**
   * Report one failure and request a failing exit.
   * @param error - the failure to report.
   */
  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.dispose()
    process.stderr.write(`dsh: ${message}\n`)
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
    this.started = true
    this.tui?.start()
    this.updateActivity()
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
    terminal.setInputInterceptor?.(data => this.interceptDockInput(data))
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
    transcript.setRenderWidth(tui.terminal.columns)
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
      reasoning: () => this.transcript?.reasoningLevel() ?? 'standard',
      turnStartedAt: () => transcript.turnStartedAt(),
      requestRender: () => { tui.requestRender() },
    })
    this.status = status
    this.modal.onChange = () => { this.updateActivity() }
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
      { prompt: `${this.palette.prompt('dsh>')} `, hint: this.palette.dim(copy.composer.idle) },
    )
    this.editor = editor
    const composer = new Composer({
      ctx: this.ctx,
      agent: () => this.agent,
      notice: (text) => { this.transcript?.notice(text) },
      busyEnter: this.config.busyEnter,
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
        reasoning: (argument) => { this.setReasoningVisibility(argument) },
        cards: (argument) => { this.setCardsMode(argument) },
        effort: argument => this.setEffort(argument),
        permission: (argument) => { this.choosePermission(argument) },
        queue: argument => this.queuePrompt(argument),
        steer: argument => this.steerPrompt(argument),
        config: () => { void this.openConfigPanel() },
        preset: (argument) => { void this.pickPreset(argument) },
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
    const transcriptHost: Component = {
      render: (width) => {
        transcript.setRenderWidth(width)
        return transcript.component.render(width)
      },
      invalidate: () => { transcript.component.invalidate() },
    }
    const transcriptView = new ScrollView(transcriptHost, {
      follow: 'end',
      primary: true,
      overscroll: 'chain',
    })
    const pending = new PendingStrip(this.palette, () => status.snapshot())
    const bottom = new BottomPanel()
    this.bottom = bottom
    this.bottomList = new BottomList(this.palette, () => { this.syncDock(); tui.requestRender() })
    this.queuePanel = new QueuePanel(this.palette, {
      steer: (item) => { this.steerQueued(item.id) },
      edit: (item) => { this.editQueued(item.id) },
      remove: (item) => { this.removeQueued(item.id) },
      close: () => { this.closeQueuePanel() },
    })
    this.completion = new CompletionController({
      provider: () => this.autocomplete,
      editor: () => this.editor,
      palette: this.palette,
      requestRender: () => { this.syncDock(); tui.requestRender() },
      submit: (line) => { editor.onSubmit?.(line) },
    })
    editor.onChange = () => { this.completion?.schedule() }
    for (const command of this.pendingCommands.splice(0)) {
      this.contributedCommandDisposers.set(command, composer.registerCommand(command))
    }
    const lower = new VStack([new ContributedStrips(this.contributedStrips), pending, editor, bottom, footer])
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
      if (isKeyRelease(data) && this.activeDockSurface() !== undefined) return { consume: true }
      if (this.dockOverlay !== undefined) {
        this.dockOverlay.handleInput(data)
        this.tui?.requestRender()
        return { consume: true }
      }
      if (this.configPanel !== undefined) {
        this.configPanel.handleInput(data)
        this.tui?.requestRender()
        return { consume: true }
      }
      if (this.bottomList?.handleInput(data) === true) return { consume: true }
      if (this.completion?.handleInput(data) === true) return { consume: true }
      if (matchesKey(data, 'ctrl+enter')) {
        const text = this.editor?.getText() ?? ''
        if (text.trim() !== '') {
          this.editor?.setText('')
          this.composer?.submit(text, this.config.busyEnter === 'queue' ? 'steer' : 'queue')
        } else if (this.agent?.status === 'running') {
          this.steerAllQueued()
        }
        return { consume: true }
      }
      if (matchesKey(data, 'escape') && !isKeyRelease(data) && this.terminal?.isFollowingEnd() === false) {
        this.terminal.scrollToBottom()
        this.tui?.requestRender()
        return { consume: true }
      }
      if (matchesKey(data, 'escape') && this.editor?.getText() === '' && this.agent?.status === 'running' && !this.modal.hasActive()) {
        this.interruptTurn()
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+o')) {
        this.setCardsMode(undefined)
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+r')) {
        this.setReasoningVisibility(undefined)
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+l')) {
        tui.renderNow(true)
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+v')) {
        void this.attachClipboardImage()
        return { consume: true }
      }
      if (matchesKey(data, 'shift+tab')) {
        void this.cycleEffort()
        return { consume: true }
      }
      this.completion?.schedule()
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
      this.editor?.setHint(this.palette.dim(subject.status === 'running' ? copy.composer.running : copy.composer.idle))
      this.updateActivity()
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
      this.transcript?.notice(copy.commands.disposed, 'warning')
      this.requestExit(0)
    }))
    this.disposers.push(this.ctx.on('commands/change', () => { this.refreshAutocomplete() }))
    this.disposers.push(this.ctx.on('permission-presets/catalog-changed', () => { this.refreshAutocomplete() }))
    const markdown = this.markdownTheme
    /* v8 ignore next -- startTerminal() always records the markdown theme before subscribe() */
    if (markdown === undefined) throw new Error('terminal-ui: interaction providers require the markdown theme')
    this.disposers.push(registerQuestionAnswerer({
      ctx: this.ctx,
      dock: this.interactionDock(),
      palette: this.palette,
      markdown,
      /* v8 ignore next -- the question answerer presents request.agent, not this dependency */
      agent: () => this.agent,
      requestRender: () => { this.tui?.requestRender() },
    }, this.config.sessionId, this.modal))
    this.disposers.push(registerApprovalAnswerer({
      ctx: this.ctx,
      dock: this.interactionDock(),
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

  /**
   * Append one durable event with sequence continuity checks.
   * @param event - the committed Session event.
   */
  private appendEvent(event: SessionEvent): void {
    if (event.seq <= this.lastSeq) return
    if (this.lastSeq >= 0 && event.seq > this.lastSeq + 1) {
      this.transcript?.notice(copy.notice.gap(this.lastSeq + 1, event.seq - 1), 'warning')
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
    this.autocomplete = new TerminalAutocompleteProvider({
      ctx: this.ctx,
      agent: () => this.agent,
      cwd: () => this.status?.snapshot().cwd ?? process.cwd(),
      commands: () => this.composer?.slashCommands() ?? [],
    })
  }

  /** Cancel the running turn from the Esc binding, reporting the interrupt. */
  private interruptTurn(): void {
    const agent = this.agent
    if (agent === undefined || agent.status !== 'running') return
    this.transcript?.notice(copy.notice.interrupting)
    agent.cancel({ kind: 'user' })
    this.tui?.requestRender()
  }

  /**
   * Queue one message for the next turn, expanding `@` mentions first.
   * @param argument - the `/queue` text.
   */
  private async queuePrompt(argument: string | undefined): Promise<void> {
    const text = argument?.trim() ?? ''
    if (text === '') {
      this.openQueuePanel()
      return
    }
    const agent = this.agent
    if (agent === undefined) {
      this.transcript?.notice(copy.commands.agentNotReady)
      return
    }
    try {
      const expanded = await this.expandPrompt(text)
      for (const notice of expanded.notices) this.transcript?.notice(notice)
      const current = this.agent
      if (current === undefined) {
        this.transcript?.notice(copy.commands.agentNotReady)
        return
      }
      current.followup(createUserMessage({ content: [...expanded.content], source: { kind: 'user' } }))
    } catch (error: unknown) {
      this.transcript?.notice(copy.commands.promptFailed(error instanceof Error ? error.message : String(error)))
    }
  }

  /**
   * Steer one prompt into the running turn, or steer every queued message.
   * @param argument - the `/steer` text, or absent to steer the queue.
   */
  private async steerPrompt(argument: string | undefined): Promise<void> {
    const text = argument?.trim() ?? ''
    if (text === '') {
      this.steerAllQueued()
      return
    }
    const agent = this.agent
    if (agent === undefined) {
      this.transcript?.notice(copy.commands.agentNotReady)
      return
    }
    try {
      const expanded = await this.expandPrompt(text)
      for (const notice of expanded.notices) this.transcript?.notice(notice)
      const current = this.agent
      if (current === undefined) {
        this.transcript?.notice(copy.commands.agentNotReady)
        return
      }
      const message = createUserMessage({ content: [...expanded.content], source: { kind: 'user' } })
      if (current.status === 'running') {
        current.steer(message)
        this.transcript?.notice(copy.queue.steered)
      } else {
        current.followup(message)
        this.transcript?.notice(copy.queue.queued)
      }
    } catch (error: unknown) {
      this.transcript?.notice(copy.commands.promptFailed(error instanceof Error ? error.message : String(error)))
    }
  }

  /** @returns the queued next-turn Messages in delivery order. */
  private queuedMessages(): readonly UserMessage[] {
    return this.agent?.inbox.nextTurn ?? []
  }

  /**
   * Build one dock row for a queued Message.
   * @param message - the queued Message.
   * @param index - its zero-based position.
   * @returns the row.
   */
  private queueItem(message: UserMessage, index: number): QueuePanelItem {
    const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(' ').trim()
    const nonText = message.content.some(block => block.type !== 'text')
    return {
      id: String(message.id),
      label: `${String(index + 1)}. ${text === '' ? copy.queue.nonText : text}`,
      ...(nonText ? { description: copy.queue.nonText } : {}),
    }
  }

  /** Refresh the queue dock rows, closing it when the queue drains. */
  private refreshQueuePanel(): void {
    const panel = this.queuePanel
    if (panel === undefined) return
    const items = this.queuedMessages().map((message, index) => this.queueItem(message, index))
    if (items.length === 0) {
      this.closeQueuePanel()
      return
    }
    panel.setItems(items)
    this.tui?.requestRender()
  }

  /** Present the queued messages in the dock. */
  private openQueuePanel(): void {
    const panel = this.queuePanel
    if (panel === undefined) return
    const items = this.queuedMessages().map((message, index) => this.queueItem(message, index))
    if (items.length === 0) {
      this.transcript?.notice(copy.queue.empty)
      return
    }
    panel.setItems(items)
    this.setDockOverlay({
      component: panel,
      handleInput: (data) => { panel.handleInput(data); this.tui?.requestRender() },
      close: () => { this.closeQueuePanel() },
    })
  }

  /** Release the queue dock. */
  private closeQueuePanel(): void {
    this.queuePanel?.setItems([])
    if (this.queuePanel === undefined) return
    this.setDockOverlay(undefined)
  }

  /**
   * Steer one queued Message into the running turn.
   * @param id - queued Message identity.
   */
  private steerQueued(id: string): void {
    const agent = this.agent
    if (agent === undefined) return
    const message = agent.inbox.nextTurn.find(item => String(item.id) === id)
    if (message === undefined) {
      this.refreshQueuePanel()
      return
    }
    if (agent.status !== 'running') {
      this.transcript?.notice(copy.queue.steerUnavailable)
      return
    }
    agent.inbox.remove(message.id)
    agent.steer(message)
    this.transcript?.notice(copy.queue.steered)
    this.refreshQueuePanel()
  }

  /**
   * Move one queued Message's text back into the composer.
   * @param id - queued Message identity.
   */
  private editQueued(id: string): void {
    const agent = this.agent
    if (agent === undefined) return
    const message = agent.inbox.nextTurn.find(item => String(item.id) === id)
    if (message === undefined) {
      this.refreshQueuePanel()
      return
    }
    if (message.content.some(block => block.type !== 'text')) {
      this.transcript?.notice(copy.queue.editUnsupported)
      return
    }
    const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    agent.inbox.remove(message.id)
    this.editor?.setText(text)
    this.closeQueuePanel()
    this.transcript?.notice(copy.queue.editMoved)
    this.tui?.requestRender()
  }

  /**
   * Remove one queued Message.
   * @param id - queued Message identity.
   */
  private removeQueued(id: string): void {
    const agent = this.agent
    if (agent === undefined) return
    const message = agent.inbox.nextTurn.find(item => String(item.id) === id)
    if (message === undefined) {
      this.refreshQueuePanel()
      return
    }
    agent.inbox.remove(message.id)
    this.transcript?.notice(copy.queue.removed)
    this.refreshQueuePanel()
  }

  /** Steer every queued Message into the running turn. */
  private steerAllQueued(): void {
    const agent = this.agent
    if (agent === undefined) return
    const messages = [...agent.inbox.nextTurn]
    if (messages.length === 0) {
      this.transcript?.notice(copy.queue.empty)
      return
    }
    if (agent.status !== 'running') {
      this.transcript?.notice(copy.queue.steerUnavailable)
      return
    }
    for (const message of messages) {
      agent.inbox.remove(message.id)
      agent.steer(message)
    }
    this.transcript?.notice(copy.queue.steeredAll(messages.length))
    this.refreshQueuePanel()
  }

  /** @returns the surface that currently owns dock input, if any. */
  private activeDockSurface(): DockSurface | undefined {
    if (this.dockOverlay !== undefined) return this.dockOverlay
    const configPanel = this.configPanel
    if (configPanel !== undefined) {
      return {
        component: configPanel,
        handleInput: (data) => { configPanel.handleInput(data) },
        consumeAll: true,
        close: () => { this.closeConfigPanel() },
      }
    }
    const list = this.bottomList
    if (list?.active === true) {
      return {
        component: list,
        handleInput: data => list.handleInput(data),
        consumeAll: true,
        close: () => { list.close() },
      }
    }
    const completion = this.completion
    if (completion?.active === true) {
      return {
        component: completion,
        handleInput: data => completion.handleInput(data),
        consumeAll: false,
        close: () => { completion.close() },
      }
    }
    return undefined
  }

  /**
   * Page older transcript blocks into the scroll view when the reader reaches
   * the top. Input still flows to the viewport so its page/wheel scroll applies
   * after the content grows; the added line count keeps the viewport anchored
   * on the block it was showing.
   * @param data - one raw input sequence.
   */
  private loadOlderTranscript(data: string): void {
    const transcript = this.transcript
    const terminal = this.terminal
    if (transcript === undefined || terminal === undefined || !transcript.hasOlder()) return
    if (terminal.scrollTop() !== 0) return
    if (this.dockOverlay !== undefined || this.configPanel !== undefined || this.modal.hasActive()) return
    if (this.bottomList?.active === true || this.completion?.active === true) return
    if (isKeyRelease(data)) return
    const all = matchesKey(data, 'ctrl+home')
    const wheelUp = /^\x1b\[<64;\d+;\d+[Mm]$/.test(data)
    if (!all && !wheelUp && !matchesKey(data, 'pageUp')) return
    const added = transcript.showOlder(all)
    if (added > 0) terminal.scrollBy(added)
  }

  /**
   * Pre-dispatch input hook: while a dock surface owns input, every sequence
   * except Ctrl+C goes to it, so the renderer's viewport cannot also scroll or
   * edit the composer underneath.
   * @param data - raw terminal input.
   * @returns whether the sequence was consumed.
   */
  private interceptDockInput(data: string): boolean {
    if (matchesKey(data, 'ctrl+c')) return false
    const surface = this.activeDockSurface()
    if (surface === undefined) {
      this.loadOlderTranscript(data)
      return false
    }
    // Kitty key-release reports arrive after the press; consuming them keeps a
    // dock surface from acting twice per physical key.
    if (isKeyRelease(data)) return true
    const handled = surface.handleInput(data)
    if (surface.consumeAll === false && handled !== true) return false
    this.tui?.requestRender()
    return true
  }

  /**
   * Install or clear the exclusive dock surface (text panels, model selector, or an interaction panel).
   * @param surface - the surface to own the dock, or undefined to release it.
   */
  private setDockOverlay(surface: DockSurface | undefined): void {
    this.dockOverlay = surface
    this.syncDock()
    this.tui?.requestRender()
  }

  /** @returns the dock presenter the interaction answerers use. */
  private interactionDock(): InteractionDock {
    return {
      present: (panel) => {
        this.setDockOverlay({
          component: panel,
          handleInput: (data) => { panel.handleInput(data) },
          close: () => { this.setDockOverlay(undefined) },
        })
      },
      dismiss: () => { this.setDockOverlay(undefined) },
    }
  }

  /** Mirror the active bottom surface into the dock slot. */
  private syncDock(): void {
    if (this.dockOverlay !== undefined) {
      this.bottom?.setContent(this.dockOverlay.component)
      return
    }
    if (this.configPanel !== undefined) {
      this.bottom?.setContent(this.configPanel)
      return
    }
    if (this.bottomList?.active === true) {
      this.bottom?.setContent(this.bottomList)
      return
    }
    if (this.completion?.active === true) {
      this.bottom?.setContent(this.completion)
      return
    }
    this.bottom?.setContent(undefined)
  }

  /** Present the configuration panel over the composed services. */
  private async openConfigPanel(): Promise<void> {
    await this.ensureCatalog()
    const selection = this.selection?.current
    if (selection === undefined) {
      this.transcript?.notice(copy.commands.agentNotReady)
      return
    }
    const permissionPresets = this.ctx.get('permissionPresets')
    const pluginManager = this.ctx.get('pluginManager')
    const actions: ConfigPanelActions = {
      pickModel: () => { this.closeConfigPanel(); void this.openModelSelector(); return undefined },
      pickEffort: () => { this.closeConfigPanel(); void this.setEffort(undefined); return undefined },
      setPermission: (value) => { this.dispatchCommand(`/permission ${value}`) },
      setBundle: async (name, enabled) => {
        /* v8 ignore next -- the bundle rows exist only when the manager was passed to the loader */
        if (pluginManager === undefined) return { notice: copy.config.failed(copy.config.unavailable('pluginManager')) }
        try {
          const result = await pluginManager.setBundleEnabled(name, enabled)
          if (result.application === 'restart-required') return { restartRequired: true, notice: copy.config.restartRequired }
          if (result.application === 'applied') return undefined
          return { notice: copy.config.writeFailed(result.application) }
        } catch (error: unknown) {
          return { notice: copy.config.writeFailed(error instanceof Error ? error.message : String(error)) }
        }
      },
      toggleCards: () => { this.setCardsMode(undefined); return undefined },
      toggleReasoning: () => { this.setReasoningVisibility(undefined); return undefined },
    }
    const display = {
      color: this.config.color,
      animation: this.config.animation,
      previewLines: this.config.previewLines,
      windowBlocks: this.config.windowBlocks,
      title: this.config.title,
      locale: this.config.locale,
      busyEnter: this.config.busyEnter,
    }
    const rows = await loadConfigRows({
      model: {
        provider: selection.provider,
        model: selection.model,
        effort: selection.reasoningEffort,
        effortImplicit: this.effectiveEffort().implicit,
      },
      permission: this.status?.snapshot().permission,
      display,
      ...(permissionPresets === undefined
        ? {}
        : {
          permissionPresets: {
            catalog: () => ({
              options: permissionPresets.catalog().options.map((option) => {
                const description = option.description ?? copy.prompt.permissionDescriptions[option.value]
                return description === undefined ? option : { ...option, description }
              }),
            }),
          },
        }),
      ...(pluginManager === undefined ? {} : { pluginManager }),
      actions,
    })

    const panel = new ConfigPanel({
      rows,
      palette: this.palette,
      handlers: {
        onCancel: () => { this.closeConfigPanel() },
        onNotice: (message) => { this.transcript?.notice(message) },
        onRestartNotice: (message) => { this.transcript?.notice(message) },
      },
    })
    this.completion?.close()
    this.bottomList?.close()
    this.configPanel = panel
    this.syncDock()
    this.tui?.requestRender()
  }

  /** Close the bottom-dock configuration panel. */
  private closeConfigPanel(): void {
    this.configPanel = undefined
    this.syncDock()
    this.tui?.requestRender()
  }

  /**
   * Cycle or set the transcript's reasoning-visibility level.
   * @param argument - an optional level id or localized name.
   */
  private setReasoningVisibility(argument: string | undefined): void {
    const transcript = this.transcript
    if (transcript === undefined) return
    const query = argument?.trim()
    let level
    if (query === undefined || query === '') {
      level = nextReasoningLevel(transcript.reasoningLevel())
    } else {
      const parsed = parseReasoningLevel(query)
      if (parsed === undefined) {
        this.transcript?.notice(copy.reasoning.available(REASONING_LEVELS.join(', ')))
        return
      }
      level = parsed
    }
    transcript.setReasoningLevel(level)
    this.footer?.invalidate()
    this.tui?.requestRender()
    this.transcript?.notice(copy.reasoning.changed(copy.reasoning.levels[level]))
  }

  /**
   * Cycle or set the tool-card visibility mode.
   * @param argument - explicit mode id or localized name; absent cycles.
   */
  private setCardsMode(argument: string | undefined): void {
    const transcript = this.transcript
    if (transcript === undefined) return
    const query = argument?.trim()
    let mode
    if (query === undefined || query === '') {
      mode = nextCardMode(transcript.cardsMode())
    } else {
      const parsed = parseCardMode(query)
      if (parsed === undefined) {
        transcript.notice(copy.cards.available(CARD_MODES.join(', ')))
        return
      }
      mode = parsed
    }
    transcript.setCardsMode(mode)
    this.tui?.requestRender()
    transcript.notice(copy.cards.changed(copy.cards.levels[mode]))
  }

  /** Push the current turn and modal state to the terminal's own status reporting. */
  private updateActivity(): void {
    const terminal = this.terminal?.terminal
    if (terminal === undefined) return
    const running = this.agent?.status === 'running'
    terminal.setProgress(running)
    const status = this.modal.hasActive()
      ? { state: 'blocked' as const, app: 'dsh', kind: 'question' as const, message: copy.activity.blocked }
      : running
        ? { state: 'working' as const, app: 'dsh', message: copy.activity.working }
        : { state: 'idle' as const, app: 'dsh' }
    terminal.setProgramStatus(status)
  }

  /** Handle Ctrl+C: close a modal, cancel a turn, or exit. */
  private handleInterrupt(): void {
    if (this.modal.cancelCurrent()) return
    if (this.dockOverlay !== undefined) {
      this.dockOverlay.close()
      return
    }
    if (this.configPanel !== undefined) {
      this.closeConfigPanel()
      return
    }
    if (this.bottomList?.active === true) {
      this.bottomList.close()
      return
    }
    if (this.completion?.active === true) {
      this.completion.close()
      return
    }
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
    this.transcript?.notice(copy.exit.requested)
    this.tui?.renderNow(true)
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
    const panel = new TextPanel(title, lines, this.palette, () => { this.setDockOverlay(undefined) })
    this.setDockOverlay({
      component: panel,
      handleInput: (data) => { panel.handleInput(data) },
      close: () => { this.setDockOverlay(undefined) },
    })
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
    return presets.catalog().options.map((option) => {
      const description = option.description ?? copy.prompt.permissionDescriptions[option.value]
      return {
        value: option.value,
        label: option.name,
        ...(description === undefined ? {} : { description }),
      }
    })
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
      this.transcript?.notice(copy.commands.agentNotReady)
      return
    }
    const controller = new AbortController()
    void this.ctx.commands.execute(agent, text, [], controller.signal).then(
      (result) => {
        if (result === undefined) this.transcript?.notice(copy.commands.unknown(text.replace(/^\//u, '')))
      },
      (error: unknown) => {
        this.transcript?.notice(copy.commands.failed(error instanceof Error ? error.message : String(error)))
      },
    )
  }

  /**
   * Show the permission-preset chooser in the bottom dock, or dispatch a preset name directly.
   * @param argument - the optional `/permission` argument.
   */
  private choosePermission(argument: string | undefined): void {
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
    this.completion?.close()
    this.bottomList?.open(
      copy.prompt.permissionTitle,
      choices.map(item => ({
        value: item.value,
        label: item.label,
        ...(item.value === current
          ? { description: copy.prompt.permissionCurrent }
          : item.description === undefined ? {} : { description: item.description }),
      })),
      (item) => { this.dispatchCommand(`/permission ${item.value}`) },
      () => {},
    )
  }

  /**
   * Show the effort chooser in the bottom dock, or apply the argument directly.
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
    this.completion?.close()
    this.bottomList?.open(
      copy.model.effortTitle,
      choices.map(item => ({
        value: item.value,
        label: item.label,
        ...(item.description === undefined ? {} : { description: item.description }),
      })),
      (item) => { this.applyEffort(item.value) },
      () => {},
    )
  }

  /**
   * Expand `@` mentions of one prompt into image blocks when the composition
   * mounts the services; every failure becomes a transcript notice.
   * @param text - the submitted prompt line.
   * @returns the message content and any attachment diagnostics.
   */
  private async expandPrompt(text: string): Promise<{ content: readonly import('@deepseek-ai/dsh-llm').ContentBlock[]; notices: readonly string[] }> {
    const agent = this.agent
    const expanded = await expandPromptMentions({
      ctx: this.ctx,
      cwd: () => this.status?.snapshot().cwd ?? agent?.session.header.cwd ?? process.cwd(),
      route: () => {
        const current = this.selection?.current
        return current === undefined ? undefined : { provider: current.provider, model: current.model }
      },
    }, text)
    const pending = this.pendingImages
    if (pending.length === 0) return expanded
    this.pendingImages = []
    return { content: [...expanded.content, ...pending], notices: expanded.notices }
  }

  /** Admit one clipboard image and hold it for the next submitted prompt. */
  private async attachClipboardImage(): Promise<void> {
    const read = await readClipboardImage()
    if (read.kind === 'unavailable' || read.kind === 'none') {
      this.transcript?.notice(copy.clipboard.unsupported)
      return
    }
    if (read.kind === 'failed') {
      this.transcript?.notice(copy.clipboard.failed(read.message))
      return
    }
    const route = this.selection?.current
    if (route !== undefined) {
      const info = await this.ctx.llm.resolveModelInfo(route.provider, route.model)
      if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
        this.transcript?.notice(copy.mention.unsupportedModel(route.model))
        return
      }
    }
    const attachments = this.ctx.get('attachments')
    if (attachments === undefined) {
      this.transcript?.notice(copy.mention.noAttachments)
      return
    }
    try {
      const admitted = await attachments.admitPromptContent([{
        type: 'image',
        mediaType: read.mediaType,
        data: Buffer.from(read.bytes).toString('base64'),
        name: read.name,
      }])
      const block = admitted[0]
      /* v8 ignore next -- admitting one image part always returns one image part */
      if (block?.type !== 'image') return
      this.pendingImages.push(block)
      this.transcript?.notice(copy.clipboard.attached(read.name))
      this.tui?.requestRender()
    } catch (error: unknown) {
      this.transcript?.notice(copy.clipboard.failed(error instanceof Error ? error.message : String(error)))
    }
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

  /** @returns the preset recorded for the presented Session, if any. */
  private presetId(): string | undefined {
    const agent = this.agent
    if (agent === undefined) return undefined
    return this.ctx.get('sessionProjections')?.stateOf(agent.session, 'agentPreset') ?? undefined
  }

  /** @returns the localized display name for one preset identity. */
  private presetLabel(id: string): string {
    return copy.preset.names[id] ?? id
  }

  /**
   * Switch the Session to one agent preset before its first turn.
   * @param id - the requested preset identity.
   * @param label - display name already resolved for the chooser row.
   */
  private async selectPreset(id: string, label?: string): Promise<void> {
    const presets = this.ctx.get('agentPresets')
    const agent = this.agent
    if (presets === undefined || agent === undefined) {
      this.transcript?.notice(copy.preset.unavailable)
      return
    }
    const name = label ?? this.presetLabel(id)
    if (this.presetId() === id) {
      this.transcript?.notice(copy.preset.selected(name))
      return
    }
    const boundary = this.ctx.get('sessionProjections')?.stateOf(agent.session, 'turnBoundary')
    if (boundary !== undefined && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)) {
      this.transcript?.notice(copy.preset.locked)
      return
    }
    try {
      const selected = await presets.select(agent, id)
      this.transcript?.notice(copy.preset.selected(label ?? this.presetLabel(selected)))
    } catch (error: unknown) {
      this.transcript?.notice(copy.preset.failed(error instanceof Error ? error.message : String(error)))
    }
    this.tui?.requestRender()
  }

  /**
   * Choose an agent preset, or apply one named on the command line.
   * @param argument - explicit preset identity, when given.
   */
  private async pickPreset(argument: string | undefined): Promise<void> {
    const presets = this.ctx.get('agentPresets')
    const agent = this.agent
    if (presets === undefined || agent === undefined) {
      this.transcript?.notice(copy.preset.unavailable)
      return
    }
    const requested = argument?.trim()
    if (requested !== undefined && requested !== '') {
      await this.selectPreset(requested)
      return
    }
    const rows = await presets.list()
    const current = this.presetId()
    this.completion?.close()
    this.closeConfigPanel()
    this.bottomList?.open(
      copy.prompt.presetTitle,
      rows.map(row => ({
        value: row.id,
        label: row.name ?? this.presetLabel(row.id),
        ...(row.id === current
          ? { description: copy.prompt.presetCurrent }
          : copy.preset.descriptions[row.id] === undefined
            ? row.description === undefined ? {} : { description: row.description }
            : { description: copy.preset.descriptions[row.id] }),
      })),
      (item) => { void this.selectPreset(item.value, item.label) },
      () => {},
    )
  }

  /** Present the Session status panel. */
  private showStatus(): void {
    const state = this.status?.snapshot()
    const agent = this.agent
    /* v8 ignore next -- the status panel opens only after the interface exists */
    if (state === undefined || agent === undefined) {
      this.showText(copy.panel.status, [copy.commands.agentNotReady])
      return
    }
    const labels = copy.statusPanel
    const effort = state.effort === undefined
      ? labels.effortDefault
      : state.effortImplicit ? labels.effortImplicit(state.effort) : state.effort
    const lines = [
      `${labels.session.padEnd(12, ' ')} ${agent.session.id}`,
      `${labels.created.padEnd(12, ' ')} ${new Date(agent.session.header.createdAt).toISOString()}`,
      `${labels.cwd.padEnd(12, ' ')} ${state.cwd}`,
      /* v8 ignore start -- run() installs a current selection before the status panel opens */
      `${labels.provider.padEnd(12, ' ')} ${this.selection?.current?.provider ?? agent.options.provider}`,
      /* v8 ignore stop */
      `${labels.model.padEnd(12, ' ')} ${state.model}`,
      `${labels.preset.padEnd(12, ' ')} ${this.presetId() === undefined ? labels.notAvailable : this.presetLabel(this.presetId() ?? '')}`,
      `${labels.effort.padEnd(12, ' ')} ${effort}`,
      `${labels.reasoning.padEnd(12, ' ')} ${copy.reasoning.levels[this.transcript?.reasoningLevel() ?? 'standard']}`,
      `${labels.cards.padEnd(12, ' ')} ${copy.cards.levels[this.transcript?.cardsMode() ?? 'collapsed']}`,
      `${labels.permissions.padEnd(12, ' ')} ${state.permission ?? 'unknown'}`,
      `${labels.state.padEnd(12, ' ')} ${state.status}`,
      `${labels.tokens.padEnd(12, ' ')} ↑${String(state.inputTokens)} ↓${String(state.outputTokens)}`,
      `${labels.cache.padEnd(12, ' ')} ${state.cacheRate === undefined ? labels.notAvailable : `${String(Math.round(state.cacheRate * 100))}%`}`,
      `${labels.context.padEnd(12, ' ')} ${state.contextPercent === undefined ? labels.notAvailable : `${String(Math.round(state.contextPercent * 100))}%`}`,
    ]
    this.showText(copy.panel.status, lines)
  }

  /** Present the model selector over the live advisory catalog. */
  private async openModelSelector(): Promise<void> {
    const catalog = await loadTuiModelCatalog(this.ctx)
    this.catalog = catalog
    const close = (): void => { this.setDockOverlay(undefined) }
    const panel = new ModelSelectorPanel(
      catalog,
      this.palette,
      (selection) => {
        /* v8 ignore next -- the selector opens only after run() installed the selection */
        if (this.selection !== undefined) this.selection.current = selection
        this.footer?.invalidate()
        this.tui?.requestRender()
        close()
      },
      close,
    )
    this.setDockOverlay({
      component: panel,
      handleInput: (data) => { panel.handleInput(data) },
      close,
    })
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

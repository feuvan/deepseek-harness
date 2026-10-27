/**
 * Fixed interface copy for the terminal front door, in one place so every
 * component reads the active language without touching presentation code. The
 * process hosts one terminal, so the active locale is process-wide and is set
 * once at plugin activation.
 *
 * @module @deepseek-ai/dsh-tui/copy
 */

import type { Locale } from './locale.ts'

/** Interface copy in the source language, with literal types widened by {@link Copy}. */
const en = {
  /** Shared scrolling indicator text. */
  moreRows: (count: number): string => `${String(count)} more ${count === 1 ? 'row' : 'rows'}`,
  /** Startup banner and prompt labels. */
  banner: {
    /** Product name shown above the transcript. */
    title: 'DEEPSEEK HARNESS',
  },
  /** Composer copy. */
  composer: {
    /** Placeholder shown while the editor is empty and the agent is idle. */
    idle: 'Type a message. Enter sends; Ctrl+C cancels or exits.',
    /** Placeholder shown while a turn runs. */
    running: 'Enter queues for the next turn; Ctrl+C cancels the turn.',
    /** Label of the scroll-to-end indicator. */
    scrollToEnd: '↓ Back to bottom · esc',
  },
  /** Status labels. */
  status: {
    /** No driver activity. */
    idle: 'idle',
    /** A turn is running. */
    running: 'running',
    /** Cancellation is settling. */
    cancelling: 'cancelling',
  },
  /** Transcript notices. */
  notice: {
    /** Prefix for a user-authored message. */
    user: '›',
    /** Prefix for a host command invocation. */
    command: '❯',
    /** Marker shown when a compacted range was summarized. */
    compacted: 'Context compacted',
    /** Marker shown when a compaction failed. */
    compactionFailed: 'Context compaction failed',
    /** Marker shown when an attempt was abandoned without a settlement. */
    interrupted: 'Attempt interrupted',
    /** Notice shown when the user interrupts a running turn. */
    interrupting: 'Interrupting the running turn…',
    /** Notice naming a missing event range in the durable log. */
    gap: (from: number, to: number): string => `Transcript gap: events ${String(from)}..${String(to)} are missing.`,
    /** Label for a hidden card body. */
    hiddenLines: (count: number): string => `… ${count} more ${count === 1 ? 'line' : 'lines'}`,
  },
  /** Tool card labels. */
  card: {
    /** Header prefix for every tool card. */
    tool: 'Tool',
    /** Header suffix for a settled successful card. */
    success: 'ok',
    /** Header suffix for a failed card. */
    failed: 'failed',
    /** Header suffix for a pending card. */
    pending: 'running',
    /** Label before a shell command. */
    command: '$',
    /** Diff summary label. */
    diff: '+{added} -{removed}',
  },
  /** Interaction panels. */
  prompt: {
    /** Question panel heading. */
    question: 'Question',
    /** Approval panel heading. */
    approval: 'Approval required',
    /** Allow action label. */
    allow: 'Allow once',
    /** Reject action label. */
    reject: 'Reject',
    /** Hint line for an option list. */
    selectHint: '↑/↓ move · Enter select · Esc cancel',
    /** Hint line for a multi-select list. */
    multiHint: '↑/↓ move · Space toggle · Enter confirm · Esc cancel',
    /** Hint line for a plan-review option list. */
    planReviewHint: '↑/↓ move · Enter select · Esc cancel',
    /** Marker before the option that approves a reviewed plan. */
    approveMark: '✓',
    /** Marker before an option that declines a reviewed plan. */
    declineMark: '✗',
    /** Appended when a plan document is longer than the panel shows. */
    planTruncated: '… plan truncated; scroll the transcript for the full document',
    /** Hint line for the custom answer. */
    customHint: 'Type an answer · Enter confirm · Esc back',
    /** Label for the custom answer action. */
    custom: 'Other answer…',
    /** Heading for a plan-review question. */
    planReview: 'Plan review',
    /** Heading for the permission-preset chooser. */
    permissionTitle: 'Permission preset',
    /** Heading for the agent-preset chooser. */
    presetTitle: 'Agent preset',
    /** Description marking the current agent preset. */
    presetCurrent: 'current',
    /** Description marking the current permission preset. */
    permissionCurrent: 'current',
    /** Built-in explanations for the shipped permission presets, used when the catalog omits one. */
    permissionDescriptions: {
      'read-only': 'Read files only; no writes or state-changing commands.',
      'workspace-write': 'Write inside the workspace and run commands under the sandbox.',
      'danger-full-access': 'No sandbox; commands run with full host access.',
      'custom': 'The current knobs match no configured preset.',
      'auto': 'Experimental auto-review: risky calls are reviewed before running.',
    } as Readonly<Record<string, string>>,
    /** Batch progress formatter. */
    progress: (index: number, total: number): string => `${index}/${total}`,
  },
  /** Agent-preset labels and chooser copy. */
  preset: {
    /** Display names for the shipped presets; the id is the fallback. */
    names: {
      standard: 'Standard',
      ptc: 'PTC',
      minimal: 'Minimal',
      cordis: 'Cordis',
    } as Readonly<Record<string, string>>,
    /** One-line descriptions for the shipped presets. */
    descriptions: {
      standard: 'Full coding tools, plan mode, goals, subagents, and skills.',
      ptc: 'Standard tools plus the PTC runtime and workflow tooling.',
      minimal: 'A compact prompt with files, a persistent shell, and compaction.',
      cordis: 'Standard tools plus the Cordis self-modification tools and skills.',
    } as Readonly<Record<string, string>>,
    /** Notice naming the selected preset. */
    selected: (name: string): string => `Agent preset: ${name}`,
    /** Notice that the session already started and cannot switch. */
    locked: 'This session has already started; its agent preset is fixed.',
    /** Notice that no preset service is composed. */
    unavailable: 'Agent presets are not composed in this terminal.',
    /** Notice that the preset could not be changed. */
    failed: (message: string): string => `Agent preset unchanged: ${message}`,
  },
  /** Tool-card visibility labels. */
  cards: {
    /** Localized mode names, keyed by mode id. */
    levels: {
      collapsed: 'collapsed',
      expanded: 'expanded',
      hidden: 'hidden',
    },
    /** Notice after changing the mode. */
    changed: (mode: string): string => `Tool cards: ${mode}`,
    /** Usage hint for an unknown mode argument. */
    available: (values: string): string => `Available card modes: ${values}`,
  },
  /** Reasoning-visibility labels. */
  reasoning: {
    /** Heading for the reasoning chooser and status row. */
    title: 'Reasoning visibility',
    /** Localized level names, keyed by level id. */
    levels: {
      compact: 'compact',
      standard: 'standard',
      detailed: 'detailed',
      verbose: 'verbose',
    },
    /** Footer segment naming the current level. */
    label: (level: string): string => `reasoning ${level}`,
    /** Notice after changing the level. */
    changed: (level: string): string => `Reasoning visibility: ${level}`,
    /** Usage hint for an unknown level argument. */
    available: (values: string): string => `Available visibility levels: ${values}`,
  },
  /** Bottom-dock completion labels. */
  completion: {
    /** Heading of the suggestion window. */
    title: 'Completions',
    /** Hint line. */
    hint: '↑/↓ move · Tab insert · Enter run a command or insert · Esc close',
  },
  /** Completion descriptions. */
  autocomplete: {
    /** A directory candidate keeps completion open. */
    directory: 'directory',
    /** A file candidate finishes the mention. */
    file: 'file',
  },
  /** `@` mention and image-attachment notices. */
  mention: {
    /** Model route does not advertise image input. */
    unsupportedModel: (model: string): string => `Model "${model}" does not support image input; the image mention was not attached.`,
    /** The composition mounts no attachment store. */
    noAttachments: 'This composition has no attachment store; the image mention was not attached.',
    /** The composition mounts no filesystem reader. */
    noFilesystem: 'This composition has no filesystem service; the image mention was not attached.',
    /** The mentioned path does not name a readable file. */
    notFound: (path: string): string => `Image mention "${path}" is not a readable file.`,
    /** The image exceeds the configured per-image byte limit. */
    tooLarge: (path: string, limit: number): string => `Image mention "${path}" exceeds the ${String(limit)}-byte image limit.`,
    /** The per-message image count limit was reached. */
    tooMany: (limit: number): string => `Only ${String(limit)} images can be attached to one message.`,
    /** Reading or admitting one image failed. */
    failed: (path: string, message: string): string => `Image mention "${path}" could not be attached: ${message}`,
  },
  /** Pending-input strip shown while a turn runs. */
  /** Queued-message dock and delivery notices. */
  queue: {
    /** Panel heading. */
    title: 'Queued messages',
    /** Panel hint. */
    hint: '↑/↓ move · Enter steer · e edit · x remove · Esc close',
    /** Notice after queueing a prompt while a turn runs. */
    queued: 'Queued for the next turn',
    /** Notice after steering a queued message. */
    steered: 'Steered into the running turn',
    /** Notice after steering every queued message. */
    steeredAll: (count: number): string => `Steered ${String(count)} queued message(s)`,
    /** Notice after removing one queued message. */
    removed: 'Removed the queued message',
    /** Notice when a queued row contains non-text content. */
    editUnsupported: 'This queued message contains non-text content and cannot be edited here.',
    /** Notice after moving a queued message back into the composer. */
    editMoved: 'Queued message moved into the composer; press Enter to send it.',
    /** Placeholder for a queued row whose content is not text. */
    nonText: 'non-text content',
    /** Notice when there is nothing to list. */
    empty: 'No queued messages.',
    /** Notice when steering has no running turn to target. */
    steerUnavailable: 'Steering is available only while the agent is running.',
  },
  pending: {
    /** Steer messages waiting for the next step boundary. */
    steering: (count: number): string => `steering next step (${count})`,
    /** Follow-up messages queued for the next turn. */
    queued: (count: number): string => `queued for next turn (${count})`,
    /** Hint naming the interrupt key. */
    hint: 'Esc interrupts and sends now',
    /** Hint for opening the queue editor. */
    queueHint: '/queue edits · Ctrl+Enter steers',
  },
  /** Clipboard image-attachment notices. */
  clipboard: {
    /** The clipboard held no supported image. */
    unsupported: 'The clipboard holds no image the model can accept.',
    /** One clipboard image was admitted for the next prompt. */
    attached: (name: string): string => `Attached "${name}" from the clipboard.`,
    /** Reading or admitting a clipboard image failed. */
    failed: (message: string): string => `Clipboard image could not be attached: ${message}`,
  },
  /** Composer command descriptions and panel copy. */
  commands: {
    /** Local command descriptions, keyed by command name without the slash. */
    help: 'Show keys and commands',
    status: 'Show Session, model, and usage facts',
    model: 'Select the model for this session',
    effort: 'Show or set the reasoning effort',
    permission: 'Show or switch the permission preset',
    clear: 'Clear the rendered transcript',
    reasoning: 'Cycle or set the reasoning visibility',
    cards: 'Cycle or set the tool-card visibility',
    redraw: 'Repaint the screen',
    exit: 'Close the terminal',
    quit: 'Close the terminal',
    queue: 'Queue a message, or edit the queue without an argument',
    steer: 'Steer a message into the running turn, or steer all queued messages',
    config: 'Show and change the configuration',
    preset: 'Show or switch the agent preset',
    terminal: 'Show terminal, input, and rendering diagnostics',
    /** The Agent is not live yet. */
    agentNotReady: 'The agent is not ready yet.',
    /** The Agent was disposed while the terminal was open. */
    disposed: 'The agent was disposed; closing the terminal.',
    /** Unknown registered command. */
    unknown: (name: string): string => `Unknown command: /${name}. Type /help for the available commands.`,
    /** A registered command failed. */
    failed: (message: string): string => `Command failed: ${message}`,
    /** Prompt preparation failed. */
    promptFailed: (message: string): string => `Prompt preparation failed: ${message}`,
    /** Help panel key section title. */
    helpTitle: 'Keys',
    /** Help panel key descriptions. */
    helpKeys: [
      '  Enter              send, steer, or run a command',
      '  Esc                interrupt; in fullscreen mode it first returns to the transcript bottom',
      '  Alt+Enter/Ctrl+J   insert a newline',
      '  Ctrl+C             cancel a running turn, then exit when idle',
      '  Ctrl+O             cycle collapsed, expanded, and hidden tool cards',
      '  Ctrl+Enter         steer while running (queue when busy Enter is steer)',
      '  Ctrl+R             cycle reasoning visibility',
      '  Ctrl+L             repaint',
      '  Ctrl+V             attach an image from the clipboard',
      '  Shift+Tab          cycle reasoning effort',
      '  PgUp/PgDn          scroll the transcript (fullscreen mode pages older history in)',
    ],
    /** Help panel command section title. */
    helpCommandsTitle: 'Commands',
  },
  /** Command status panel labels. */
  statusPanel: {
    /** Session identity label. */
    session: 'Session',
    /** Creation time label. */
    created: 'Created',
    /** Working directory label. */
    cwd: 'Working dir',
    /** Provider label. */
    provider: 'Provider',
    /** Model label. */
    model: 'Model',
    /** Agent preset label. */
    preset: 'Agent preset',
    /** Reasoning effort label. */
    effort: 'Effort',
    /** Reasoning visibility label. */
    reasoning: 'Reasoning',
    /** Tool-card visibility label. */
    cards: 'Tool cards',
    /** Permission preset label. */
    permissions: 'Permissions',
    /** Agent status label. */
    state: 'Status',
    /** Token totals label. */
    tokens: 'Tokens',
    /** Cache rate label. */
    cache: 'Cache',
    /** Context occupancy label. */
    context: 'Context',
    /** Effort shown when no level is known. */
    effortDefault: 'default',
    /** Marker for an adapter default effort. */
    effortImplicit: (level: string): string => `${level} (default)`,
    /** Value shown for an unavailable ratio. */
    notAvailable: 'n/a',
  },
  /** `/terminal` diagnostic panel copy. */
  terminal: {
    title: 'Terminal diagnostics',
    environment: 'Environment',
    renderer: 'Renderer',
    input: 'Input',
    transcript: 'Transcript',
    emulator: 'emulator',
    term: 'TERM',
    multiplexer: 'multiplexer',
    ssh: 'ssh',
    size: 'size',
    screen: 'screen',
    screenInline: 'inline (terminal scrollback; no mouse capture)',
    screenFullscreen: 'fullscreen (alternate screen; mouse capture)',
    keyboard: 'keyboard protocol',
    keyboardKitty: 'kitty',
    keyboardLegacy: 'legacy',
    focus: 'focus',
    focused: 'focused',
    unfocused: 'unfocused',
    focusUnknown: 'unknown',
    viewport: 'viewport',
    wheel: 'wheel events',
    wheelNone: '0 — the terminal owns the wheel in inline mode',
    wheelSeen: (count: number, age: string): string => `${String(count)} (last ${age})`,
    transcriptValue: (blocks: number, archived: number): string => `${String(blocks)} blocks · ${String(archived)} archived`,
    hint: 'Inline mode keeps history in the terminal scrollback. If iTerm still scrolls its own history, check Profile → Terminal → Report mouse wheel events and keep the window focused.',
  },
  /** Configuration panel copy. */
  config: {
    /** Panel heading. */
    title: 'Configuration',
    /** Panel subtitle shown under the heading. */
    subtitle: 'Changes save automatically',
    /** Readiness labels for the dock header. */
    readyStatus: '● Ready',
    degradedStatus: '● Degraded',
    readOnlyStatus: '● Read only',
    /** Summary of actionable and read-only rows. */
    summary: (total: number, actions: number): string => `${String(actions)} actions · ${String(total - actions)} read-only`,
    /** Explanation shown when a read-only row is activated. */
    rowReadOnly: 'This value is owned by the profile and is read-only here.',
    /** Explanation shown when an unavailable row is activated. */
    rowUnavailable: 'This capability is unavailable in the current composition.',
    /** Contextual footer for an actionable row. */
    footerAction: 'Enter open',
    /** Contextual footer for a read-only row. */
    footerReadOnly: 'Enter explains read-only',
    /** Value shown for an action row. */
    action: 'Configure ›',
    /** One-sentence descriptions shown in the row description column. */
    descriptions: {
      modelCurrent: 'Current model route for this Session',
      modelChange: 'Choose the model used for this Session',
      effortCurrent: 'Current reasoning effort',
      effortChange: 'Choose how much reasoning the model shows',
      permission: 'Choose what the Agent may do in this workspace',
      bundle: 'Optional experimental capability; applies through profile HMR',
      cards: 'Cycle collapsed, expanded, and hidden tool cards',
      reasoning: 'Cycle compact, standard, detailed, and verbose reasoning',
      display: {
        color: 'Emit ANSI styling',
        animation: 'Advance the running clock once per second',
        previewLines: 'Body lines shown for a collapsed tool card',
        windowBlocks: 'Blocks attached before older history pages in',
        title: 'Terminal title suffix',
        locale: 'Interface language; auto follows the environment',
        busyEnter: 'Plain Enter while the Agent runs',
        screen: 'Inline keeps history in the terminal scrollback',
      },
    },
    /** Filter input placeholder. */
    filter: 'Filter configuration',
    /** Label for the row that opens the model selector. */
    changeModel: 'Change model',
    /** Label for the row that opens the effort chooser. */
    changeEffort: 'Change effort',
    /** Label for the tool-card density action. */
    toolCards: 'Tool cards',
    /** Label for the reasoning-visibility action. */
    reasoning: 'Reasoning',
    /** Shown when the filter matches no row. */
    noMatches: 'no matches',
    /** Label for an empty catalog. */
    none: 'none',
    /** Short row marker for a change that needs a restart. */
    restartMarker: 'restart',
    /** Short row marker for a toggle whose write is in flight. */
    saving: 'saving',
    /** Label when the owning service is not composed. */
    unavailable: (service: string): string => `${service} unavailable`,
    /** Heading for the model and effort category. */
    modelSection: 'Model & effort',
    /** Heading for the permissions category. */
    permissionSection: 'Permissions',
    /** Heading for the experimental-capability category. */
    experimentalSection: 'Experimental capabilities',
    /** Heading for the display category. */
    displaySection: 'Terminal display',
    /** Row suffix naming the affected scope. */
    scopeSession: 'session',
    /** Row suffix naming the profile scope. */
    scopeProfile: 'profile',
    /** Row suffix naming the repository scope. */
    scopeRepository: 'repository',
    /** Marker for a read-only row. */
    readOnly: 'read only',
    /** Notice that a change needs a restart. */
    restartRequired: 'Saved. It takes effect after a restart.',
    /** Row value for an unset option. */
    notSet: 'not set',
    /** Row value for an enabled toggle. */
    on: 'on',
    /** Row value for a disabled toggle. */
    off: 'off',
    /** A configuration read failed. */
    failed: (message: string): string => `Configuration unavailable: ${message}`,
    /** A configuration write failed. */
    writeFailed: (message: string): string => `Configuration was not saved: ${message}`,
    /** Hint line. */
    hint: '↑/↓ move · Enter open or toggle · Esc close',
    /** Hint line naming the tab keys. */
    tabHint: '←/→ group · / search · ↑/↓ move · Esc close',
    searchHint: 'type to filter · ↑/↓ move · Enter open · Esc clear/close',
    editPrompt: (label: string, value: string): string => `${label}: ${value}▌`,
    editHint: 'Enter save · Esc cancel',
    invalidValue: (field: string): string => `Invalid value for ${field}`,
  },
  /** Model selector copy. */
  model: {
    /** Heading. */
    title: 'Select model',
    /** Filter placeholder. */
    filter: 'Filter models',
    /** Hint line. */
    hint: '↑/↓ move · Enter select · Shift+Tab reasoning effort · Esc cancel',
    /** Model advertises no reasoning effort to cycle. */
    noEffort: 'This model exposes no reasoning effort.',
    /** Heading for the reasoning-effort chooser. */
    effortTitle: 'Reasoning effort',
    /** Description suffix marking the current choice. */
    effortCurrent: 'current',
    /** Provider/default choice label. */
    effortDefault: 'default',
    /** Available effort list shown after an unknown `/effort` argument. */
    effortAvailable: (values: string): string => `Available efforts: ${values}`,
    /** Notice after cycling the reasoning effort. */
    effort: (label: string): string => `Reasoning effort: ${label}`,
    /** Effort-cycle failure. */
    effortFailed: (message: string): string => `Could not switch reasoning effort: ${message}`,
  },
  /** Help and status panels. */
  panel: {
    /** Help heading. */
    help: 'Help',
    /** Status heading. */
    status: 'Status',
    /** Close hint. */
    closeHint: 'Esc or Enter closes',
    /** Scrolling hint for long dock panels. */
    scrollHint: '↑/↓ scroll · Esc or Enter closes',
  },
  /** Terminal-level program status messages. */
  activity: {
    /** One-line status while a turn runs. */
    working: 'Working…',
    /** One-line status while a panel waits for the user. */
    blocked: 'Waiting for your input…',
  },
  /** Exit path copy. */
  exit: {
    /** Notice appended when the user leaves. */
    requested: 'Closing terminal…',
  },
} as const

/** One copy tree with literal string types widened to `string`. */
type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : T extends (...args: infer A) => infer R
      ? (...args: A) => R
      : { readonly [K in keyof T]: Widen<T[K]> }

/** The interface copy contract every shipped locale satisfies. */
export type Copy = Widen<typeof en>

/** English interface copy. */
export const english: Copy = en

/** Chinese interface copy. */
export const chinese: Copy = {
  moreRows: count => `另外 ${String(count)} 行`,
  banner: {
    title: 'DEEPSEEK HARNESS',
  },
  composer: {
    idle: '输入消息。Enter 发送；Ctrl+C 取消或退出。',
    running: 'Enter 排队到下一轮；Ctrl+C 取消当前轮次。',
    scrollToEnd: '↓ 回到底部 · esc',
  },
  status: {
    idle: '空闲',
    running: '运行中',
    cancelling: '正在取消',
  },
  notice: {
    user: '›',
    command: '❯',
    compacted: '上下文已压缩',
    compactionFailed: '上下文压缩失败',
    interrupted: '尝试被中断',
    interrupting: '正在中断运行中的轮次…',
    gap: (from, to) => `Transcript 事件缺口：${String(from)}..${String(to)} 缺失。`,
    hiddenLines: count => `… 另外 ${String(count)} 行`,
  },
  card: {
    tool: '工具',
    success: '成功',
    failed: '失败',
    pending: '运行中',
    command: '$',
    diff: '+{added} -{removed}',
  },
  prompt: {
    question: '问题',
    approval: '需要审批',
    allow: '允许一次',
    reject: '拒绝',
    selectHint: '↑/↓ 移动 · Enter 选择 · Esc 取消',
    multiHint: '↑/↓ 移动 · Space 切换 · Enter 确认 · Esc 取消',
    planReviewHint: '↑/↓ 移动 · Enter 选择 · Esc 取消',
    approveMark: '✓',
    declineMark: '✗',
    planTruncated: '… 计划已截断；可在 transcript 中查看完整文档',
    customHint: '输入答案 · Enter 确认 · Esc 返回',
    custom: '其他答案…',
    planReview: '计划评审',
    permissionTitle: '权限预设',
    /** agent preset 选择列表的标题。 */
    presetTitle: 'Agent preset',
    /** 标记当前 agent preset 的描述。 */
    presetCurrent: '当前',
    permissionCurrent: '当前',
    permissionDescriptions: {
      'read-only': '只读取文件；不写入，也不执行改变状态的命令。',
      'workspace-write': '可在 workspace 内写入，并在沙箱中运行命令。',
      'danger-full-access': '不使用沙箱；命令拥有完整主机访问权限。',
      'custom': '当前的策略组合不匹配任何已配置预设。',
      'auto': '实验性自动审查：高风险调用先经审查再执行。',
    },
    progress: (index, total) => `${String(index)}/${String(total)}`,
  },
  completion: {
    title: '补全',
    hint: '↑/↓ 移动 · Tab 插入 · Enter 运行命令或插入 · Esc 关闭',
  },
  autocomplete: {
    directory: '目录',
    file: '文件',
  },
  mention: {
    unsupportedModel: model => `模型 "${model}" 不支持图片输入；该图片提及未附加。`,
    noAttachments: '当前组合没有附件存储；该图片提及未附加。',
    noFilesystem: '当前组合没有文件系统服务；该图片提及未附加。',
    notFound: path => `图片提及 "${path}" 不是可读文件。`,
    tooLarge: (path, limit) => `图片 "${path}" 超过 ${String(limit)} 字节的图片大小限制。`,
    tooMany: limit => `一条消息最多附加 ${String(limit)} 张图片。`,
    failed: (path, message) => `图片 "${path}" 附加失败：${message}`,
  },
  /** 排队消息面板与投递提示。 */
  queue: {
    title: '排队消息',
    hint: '↑/↓ 移动 · Enter 插话 · e 编辑 · x 删除 · Esc 关闭',
    queued: '已排队，下一轮发送',
    steered: '已插话到运行中的轮次',
    steeredAll: (count: number): string => `已插话 ${String(count)} 条排队消息`,
    removed: '已删除排队消息',
    editUnsupported: '这条排队消息包含非文本内容，无法在这里编辑。',
    editMoved: '排队消息已移回编辑器；按 Enter 发送。',
    nonText: '非文本内容',
    empty: '没有排队消息。',
    steerUnavailable: '只有 Agent 运行中才能插话。',
  },
  pending: {
    steering: count => `steering 下一步 (${String(count)})`,
    queued: count => `已排队到下一轮 (${String(count)})`,
    hint: 'Esc 中断并立即发送',
    queueHint: '/queue 编辑 · Ctrl+Enter 插话',
  },
  clipboard: {
    unsupported: '剪贴板中没有模型可接受的图片。',
    attached: name => `已从剪贴板附加 "${name}"。`,
    failed: message => `剪贴板图片附加失败：${message}`,
  },
  commands: {
    help: '显示按键与命令',
    status: '显示会话、模型与用量信息',
    model: '为本会话选择模型',
    effort: '显示或设置推理强度',
    permission: '显示或切换权限预设',
    clear: '清空已渲染的 transcript',
    reasoning: '循环或设置推理显示级别',
    cards: '循环或设置工具卡可见性',
    redraw: '重绘屏幕',
    exit: '关闭终端',
    quit: '关闭终端',
    queue: '排队一条消息；不带参数时编辑队列',
    steer: '把消息插话到运行中的轮次；不带参数时插话全部排队消息',
    config: '显示并修改配置',
    preset: '显示或切换 agent preset',
    terminal: '显示终端、输入与渲染诊断信息',
    agentNotReady: 'Agent 尚未就绪。',
    disposed: 'Agent 已被释放；正在关闭终端。',
    unknown: name => `未知命令：/${name}。输入 /help 查看可用命令。`,
    failed: message => `命令失败：${message}`,
    promptFailed: message => `提示准备失败：${message}`,
    helpTitle: '按键',
    helpKeys: [
      '  Enter              发送、steer 或执行命令',
      '  Esc                中断运行中的轮次；fullscreen 模式下先回到 transcript 底部',
      '  Alt+Enter/Ctrl+J   插入换行',
      '  Ctrl+C             取消运行中的轮次，空闲时退出',
      '  Ctrl+O             在折叠、展开与隐藏工具卡之间循环',
      '  Ctrl+Enter         运行中插话（busy Enter 为插话时改为排队）',
      '  Ctrl+R             循环推理显示级别',
      '  Ctrl+L             重绘',
      '  Ctrl+V             从剪贴板附加图片',
      '  Shift+Tab          循环推理强度',
      '  PgUp/PgDn          滚动 transcript（fullscreen 模式在顶部载入更早历史）',
    ],
    helpCommandsTitle: '命令',
  },
  statusPanel: {
    session: '会话',
    created: '创建时间',
    cwd: '工作目录',
    provider: 'Provider',
    model: '模型',
    preset: 'Agent preset',
    effort: '推理强度',
    reasoning: '推理显示',
    cards: '工具卡',
    permissions: '权限',
    state: '状态',
    tokens: 'Token',
    cache: '缓存',
    context: '上下文',
    effortDefault: '默认',
    effortImplicit: level => `${level}（默认）`,
    notAvailable: 'n/a',
  },
  /** `/terminal` 诊断面板文案。 */
  terminal: {
    title: '终端诊断',
    environment: '环境',
    renderer: '渲染',
    input: '输入',
    transcript: 'Transcript',
    emulator: '终端',
    term: 'TERM',
    multiplexer: '复用器',
    ssh: 'SSH',
    size: '尺寸',
    screen: '模式',
    screenInline: 'inline（终端 scrollback；不捕获鼠标）',
    screenFullscreen: 'fullscreen（alternate screen；捕获鼠标）',
    keyboard: '键盘协议',
    keyboardKitty: 'kitty',
    keyboardLegacy: 'legacy',
    focus: '焦点',
    focused: '聚焦',
    unfocused: '未聚焦',
    focusUnknown: '未知',
    viewport: '视口',
    wheel: '滚轮事件',
    wheelNone: '0——inline 模式下由终端处理滚轮',
    wheelSeen: (count: number, age: string): string => `${String(count)}（最近 ${age} 前）`,
    transcriptValue: (blocks: number, archived: number): string => `${String(blocks)} 块 · ${String(archived)} 归档`,
    hint: 'inline 模式把历史保留在终端 scrollback。如果 iTerm 仍在滚动自己的历史，请检查 Profile → Terminal → Report mouse wheel events，并保持窗口处于焦点。',
  },
  config: {
    title: '配置',
    subtitle: '修改会自动保存',
    readyStatus: '● 就绪',
    degradedStatus: '● 降级',
    readOnlyStatus: '● 只读',
    summary: (total, actions) => `${String(actions)} 个动作 · ${String(total - actions)} 个只读`,
    rowReadOnly: '该值由 profile 配置拥有，此处只读。',
    rowUnavailable: '当前组合中该能力不可用。',
    footerAction: 'Enter 打开',
    footerReadOnly: 'Enter 查看只读原因',
    action: '配置 ›',
    descriptions: {
      modelCurrent: '本会话当前使用的模型',
      modelChange: '选择本会话使用的模型',
      effortCurrent: '当前推理强度',
      effortChange: '选择模型展示多少推理',
      permission: '选择 Agent 在此工作区可以做什么',
      bundle: '可选的实验性能力；通过 profile HMR 应用',
      cards: '循环折叠、展开与隐藏工具卡',
      reasoning: '循环 compact、standard、detailed、verbose 推理显示',
      display: {
        color: '输出 ANSI 样式',
        animation: '运行中时钟每秒推进一次',
        previewLines: '折叠工具卡展示的正文行数',
        windowBlocks: '更早历史翻页前挂载的块数',
        title: '终端标题后缀',
        locale: '界面语言；auto 跟随环境',
        busyEnter: 'Agent 运行时普通 Enter 的行为',
        screen: 'inline 模式把历史保留在终端 scrollback',
      },
    },
    filter: '筛选配置',
    changeModel: '更改模型',
    changeEffort: '更改推理强度',
    toolCards: '工具卡',
    reasoning: '推理显示',
    noMatches: '无匹配项',
    none: '无',
    restartMarker: '重启后生效',
    /** 正在写入的开关的简短行标记。 */
    saving: '保存中',
    unavailable: service => `${service} 不可用`,
    modelSection: '模型与推理强度',
    permissionSection: '权限',
    experimentalSection: '实验性能力',
    displaySection: '终端显示',
    scopeSession: '会话',
    scopeProfile: 'profile',
    scopeRepository: '仓库',
    readOnly: '只读',
    restartRequired: '已保存，重启后生效。',
    notSet: '未设置',
    on: '开',
    off: '关',
    failed: message => `无法读取配置：${message}`,
    writeFailed: message => `配置未保存：${message}`,
    hint: '↑/↓ 移动 · Enter 打开或切换 · Esc 关闭',
    tabHint: '←/→ 分组 · / 搜索 · ↑/↓ 移动 · Esc 关闭',
    searchHint: '输入筛选 · ↑/↓ 移动 · Enter 打开 · Esc 清除/关闭',
    editPrompt: (label: string, value: string): string => `${label}: ${value}▌`,
    editHint: 'Enter 保存 · Esc 取消',
    invalidValue: (field: string): string => `字段 ${field} 的值无效`,
  },
  /** Agent preset 名称、描述与提示。 */
  preset: {
    names: {
      standard: '标准',
      ptc: 'PTC',
      minimal: '精简',
      cordis: 'Cordis',
    },
    descriptions: {
      standard: '完整编码工具、计划模式、目标、子代理与技能。',
      ptc: '标准工具加上 PTC 运行时与工作流工具。',
      minimal: '精简提示，只含文件工具、持久 shell 与压缩。',
      cordis: '标准工具加上 Cordis 自我修改工具与技能。',
    },
    selected: (name: string): string => `Agent preset：${name}`,
    locked: '本会话已经开始，agent preset 不能再切换。',
    unavailable: '当前终端没有组装 agent preset。',
    failed: (message: string): string => `agent preset 未更改：${message}`,
  },
  /** 工具卡可见性文案。 */
  cards: {
    levels: {
      collapsed: '折叠',
      expanded: '展开',
      hidden: '隐藏',
    },
    changed: (mode: string): string => `工具卡：${mode}`,
    available: (values: string): string => `可用工具卡模式：${values}`,
  },
  reasoning: {
    title: '推理显示',
    levels: {
      compact: '简洁',
      standard: '标准',
      detailed: '详细',
      verbose: '完全展开',
    },
    label: level => `推理 ${level}`,
    changed: level => `推理显示：${level}`,
    available: values => `可用推理显示级别：${values}`,
  },
  model: {
    title: '选择模型',
    filter: '筛选模型',
    hint: '↑/↓ 移动 · Enter 选择 · Shift+Tab 推理强度 · Esc 取消',
    noEffort: '该模型没有可用的推理强度。',
    effortTitle: '推理强度',
    effortCurrent: '当前',
    effortDefault: '默认',
    effortAvailable: values => `可用强度：${values}`,
    effort: label => `推理强度：${label}`,
    effortFailed: message => `无法切换推理强度：${message}`,
  },
  panel: {
    help: '帮助',
    status: '状态',
    closeHint: 'Esc 或 Enter 关闭',
    scrollHint: '↑/↓ 滚动 · Esc 或 Enter 关闭',
  },
  activity: {
    working: '运行中…',
    blocked: '等待你的输入…',
  },
  exit: {
    requested: '正在关闭终端…',
  },
}

/** Shipped dictionaries by locale. */
const DICTIONARIES: Readonly<Record<Locale, Copy>> = { en: english, zh: chinese }

/** The active dictionary; reassigned only by {@link setCopyLocale} at startup. */
export let copy: Copy = english

/**
 * Select the interface language for this process.
 * @param locale - the resolved interface locale.
 */
export function setCopyLocale(locale: Locale): void {
  copy = DICTIONARIES[locale]
}

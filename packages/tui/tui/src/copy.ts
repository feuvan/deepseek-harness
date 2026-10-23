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
    running: 'Enter steers the running turn; Ctrl+C cancels it.',
    /** Label of the scroll-to-end indicator. */
    scrollToEnd: 'Jump to end',
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
  pending: {
    /** Steer messages waiting for the next step boundary. */
    steering: (count: number): string => `steering next step (${count})`,
    /** Follow-up messages queued for the next turn. */
    queued: (count: number): string => `queued for next turn (${count})`,
    /** Hint naming the interrupt key. */
    hint: 'Esc interrupts and sends now',
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
    cards: 'Cycle collapsed, expanded, and hidden tool cards',
    redraw: 'Repaint the screen',
    exit: 'Close the terminal',
    quit: 'Close the terminal',
    queue: 'Queue a message for the next turn',
    config: 'Show and change the configuration',
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
      '  Esc                interrupt a running turn when the composer is empty',
      '  Alt+Enter/Ctrl+J   insert a newline',
      '  Ctrl+C             cancel a running turn, then exit when idle',
      '  Ctrl+O             cycle collapsed, expanded, and hidden tool cards',
      '  Ctrl+R             toggle reasoning visibility',
      '  Ctrl+L             repaint',
      '  Ctrl+V             attach an image from the clipboard',
      '  Shift+Tab          cycle reasoning effort',
      '  PgUp/PgDn          scroll the transcript',
    ],
    /** Help panel command section title. */
    helpCommandsTitle: 'Commands',
    /** Usage error for a local command that needs an argument. */
    usage: (name: string, hint: string): string => `Usage: /${name} ${hint}`,
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
    /** Reasoning effort label. */
    effort: 'Effort',
    /** Reasoning visibility label. */
    reasoning: 'Reasoning',
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
  /** Configuration panel copy. */
  config: {
    /** Panel heading. */
    title: 'Configuration',
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
    tabHint: 'Tab/←/→ switch · ↑/↓ move · Enter open or toggle · Esc close',
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
    running: 'Enter 在下个步骤 steer 运行中的轮次；Ctrl+C 取消。',
    scrollToEnd: '跳到末尾',
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
  pending: {
    steering: count => `steering 下一步 (${String(count)})`,
    queued: count => `已排队到下一轮 (${String(count)})`,
    hint: 'Esc 中断并立即发送',
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
    cards: '在收缩、展开与隐藏工具卡之间循环',
    redraw: '重绘屏幕',
    exit: '关闭终端',
    quit: '关闭终端',
    queue: '把一条消息排到下一轮',
    config: '显示并修改配置',
    agentNotReady: 'Agent 尚未就绪。',
    disposed: 'Agent 已被释放；正在关闭终端。',
    unknown: name => `未知命令：/${name}。输入 /help 查看可用命令。`,
    failed: message => `命令失败：${message}`,
    promptFailed: message => `提示准备失败：${message}`,
    helpTitle: '按键',
    helpKeys: [
      '  Enter              发送、steer 或执行命令',
      '  Esc                编辑器为空时中断运行中的轮次',
      '  Alt+Enter/Ctrl+J   插入换行',
      '  Ctrl+C             取消运行中的轮次，空闲时退出',
      '  Ctrl+O             在收缩、展开与隐藏工具卡之间循环',
      '  Ctrl+R             切换推理显示',
      '  Ctrl+L             重绘',
      '  Ctrl+V             从剪贴板附加图片',
      '  Shift+Tab          循环推理强度',
      '  PgUp/PgDn          滚动 transcript',
    ],
    helpCommandsTitle: '命令',
    usage: (name, hint) => `用法：/${name} ${hint}`,
  },
  statusPanel: {
    session: '会话',
    created: '创建时间',
    cwd: '工作目录',
    provider: 'Provider',
    model: '模型',
    effort: '推理强度',
    reasoning: '推理显示',
    permissions: '权限',
    state: '状态',
    tokens: 'Token',
    cache: '缓存',
    context: '上下文',
    effortDefault: '默认',
    effortImplicit: level => `${level}（默认）`,
    notAvailable: 'n/a',
  },
  config: {
    title: '配置',
    filter: '筛选配置',
    changeModel: '更改模型',
    changeEffort: '更改推理强度',
    toolCards: '工具卡',
    reasoning: '推理显示',
    noMatches: '无匹配项',
    none: '无',
    restartMarker: '重启后生效',
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
    tabHint: 'Tab/←/→ 切换 · ↑/↓ 移动 · Enter 打开或切换 · Esc 关闭',
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

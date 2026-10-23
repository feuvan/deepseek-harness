/**
 * Fixed English interface copy for the terminal front door, in one place so a
 * future locale service can replace it without touching presentation code.
 *
 * @module @deepseek-ai/dsh-tui/copy
 */

/** Fixed interface copy used by the terminal components. */
export const copy = {
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
    /** Heading for the permission-preset chooser. */
    permissionTitle: 'Permission preset',
    /** Description marking the current permission preset. */
    permissionCurrent: 'current',
    /** Heading for a plan-review question. */
    planReview: 'Plan review',
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
    /** Batch progress formatter. */
    progress: (index: number, total: number): string => `${index}/${total}`,
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
    /** Permission preset chooser entry label for the current value. */
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
  /** Exit path copy. */
  exit: {
    /** Notice appended when the user leaves. */
    requested: 'Closing terminal…',
  },
} as const

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AdmittedPromptContentPart, ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import type { ExpandedPrompt } from '../../src/mentions.ts'
import type { AttachmentAdmissionPart, ImageMediaType } from '@deepseek-ai/dsh-attachment/types'
import { FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type { MentionDeps, MentionRoute } from '../../src/mentions.ts'
import {
  expandPromptMentions, hasImageMention, imageMentions, mentionCwd, mentionStore,
} from '../../src/mentions.ts'
import { copy } from '../../src/copy.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountSessions, testAgent, testContext } from '../support/fakes.ts'

/** One admission request: the message parts handed to the attachment store. */
type AdmissionInput = readonly AttachmentAdmissionPart[]

/** The admission function the terminal reads. */
type AdmitFunction = (content: AdmissionInput) => Promise<readonly AdmittedPromptContentPart[]>

/** One expansion result asserted by the tests. */
/** The expansion result the harness returns. */
type TestExpansion = ExpandedPrompt

const LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 1024,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 4096,
  maxImagePixels: 1_000_000,
  maxImageDimension: 4096,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

/** The attachment reference a successful admission returns. */
function admission(mediaType: ImageMediaType = 'image/png', name = 'image.png'): AdmittedPromptContentPart {
  return {
    type: 'image',
    attachment: {
      attachmentId: AttachmentId('attachment-1'),
      mediaType,
      bytes: 3,
      width: 1,
      height: 1,
      name,
    },
  }
}

/** Filesystem double state. */
interface FsState {
  /** Per-path resolve failure. */
  readonly resolveError?: unknown
  /** Metadata returned by stat; defaults to a present regular file. */
  readonly stat?: (target: FsTarget) => Promise<FsInfo | undefined>
  /** Per-target read failure. */
  readonly readError?: unknown
  /** Exact bytes returned by readBytes. */
  readonly bytes?: Uint8Array
}

/** The values one mention harness exposes. */
interface MentionHarness {
  readonly deps: MentionDeps
  readonly resolved: string[]
  readonly stats: FsTarget[]
  readonly reads: FsTarget[]
  readonly admitted: AdmissionInput[]
  readonly routes: number
  readonly setRoute: (route: MentionRoute | undefined) => void
}

/**
 * Build the host doubles one expansion reads.
 * @param options - service overrides.
 * @returns the mention dependencies and their recordings.
 */
function mentionHarness(options: {
  readonly limits?: Partial<ImageAttachmentLimits>
  readonly fs?: FsState | false
  readonly attachments?: false | { admit?: AdmitFunction; limits?: Partial<ImageAttachmentLimits> }
  readonly route?: MentionRoute | undefined
  readonly resolveModelInfo?: (provider: string, model: string) => Promise<{ provider: string; id: string; name: string; inputModalities?: readonly ('text' | 'image')[] }>
  readonly cwd?: string
} = {}): MentionHarness {
  const resolved: string[] = []
  const stats: FsTarget[] = []
  const reads: FsTarget[] = []
  const admitted: AdmissionInput[] = []
  const state = { route: options.route, routes: 0 }
  const attachmentLimits = options.attachments === false ? undefined : options.attachments?.limits
  const limits: ImageAttachmentLimits = { ...LIMITS, ...options.limits, ...attachmentLimits }
  const admit = options.attachments === false ? undefined : options.attachments?.admit

  const fsState = options.fs === false ? undefined : options.fs ?? {}
  const fs = fsState === undefined ? undefined : {
    resolve: async (path: string): Promise<FsTarget> => {
      resolved.push(path)
      if (fsState.resolveError !== undefined) throw fsState.resolveError
      return { targetKey: FsTargetKey(path), displayPath: path }
    },
    stat: async (target: FsTarget): Promise<FsInfo | undefined> => {
      stats.push(target)
      if (fsState.stat !== undefined) return fsState.stat(target)
      return { version: FsVersion('v1'), type: 'file', size: 3 }
    },
    readBytes: async (target: FsTarget): Promise<Uint8Array> => {
      reads.push(target)
      if (fsState.readError !== undefined) throw fsState.readError
      return fsState.bytes ?? new Uint8Array([1, 2, 3])
    },
  }

  const attachments = options.attachments === false || fs === undefined ? undefined : {
    imageLimits: limits,
    admitPromptContent: async (content: AdmissionInput): Promise<readonly AdmittedPromptContentPart[]> => {
      admitted.push(content)
      if (admit !== undefined) return admit(content)
      return content.flatMap(part => part.type === 'image' ? [admission(part.mediaType, part.name)] : [])
    },
  }

  const llm = {
    resolveModelInfo: async (provider: string, model: string) => {
      if (options.resolveModelInfo !== undefined) return options.resolveModelInfo(provider, model)
      return { provider, id: model, name: model, inputModalities: ['text', 'image'] as const }
    },
  }

  const ctx = testContext({
    ...(fs === undefined ? {} : { fs }),
    ...(attachments === undefined ? {} : { attachments }),
    llm,
  })
  return {
    deps: {
      ctx,
      cwd: () => options.cwd ?? '/workspace',
      route: () => {
        state.routes += 1
        return state.route
      },
    },
    resolved,
    stats,
    reads,
    admitted,
    get routes() { return state.routes },
    setRoute: (route) => { state.route = route },
  }
}

/**
 * Run one expansion against the harness.
 * @param harness - the mention harness.
 * @param text - submitted prompt text.
 * @returns the expansion result.
 */
async function expand(harness: MentionHarness, text: string): Promise<TestExpansion> {
  return expandPromptMentions(harness.deps, text)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('imageMentions', () => {
  it.each([
    ['no mention', 'plain prompt', []],
    ['plain image path', 'look at @photo.png', [{ path: 'photo.png', mediaType: 'image/png' }]],
    ['quoted path with spaces', 'look at @"my photo.png"', [{ path: 'my photo.png', mediaType: 'image/png' }]],
    ['uppercase extension', 'look at @PHOTO.PNG', [{ path: 'PHOTO.PNG', mediaType: 'image/png' }]],
    ['jpeg alias', '@a.jpeg @b.jpg @c.gif @d.webp', [
      { path: 'a.jpeg', mediaType: 'image/jpeg' },
      { path: 'b.jpg', mediaType: 'image/jpeg' },
      { path: 'c.gif', mediaType: 'image/gif' },
      { path: 'd.webp', mediaType: 'image/webp' },
    ]],
    ['unsupported extension', '@notes.txt @archive.zip', []],
    ['missing extension', '@README', []],
    ['mention at the start of the prompt', '@start.png then text', [{ path: 'start.png', mediaType: 'image/png' }]],
    ['mention after punctuation', 'see (@paren.png) [@bracket.png] {@brace.png} <@angle.png>', [
      { path: 'paren.png', mediaType: 'image/png' },
      { path: 'bracket.png', mediaType: 'image/png' },
      { path: 'brace.png', mediaType: 'image/png' },
      { path: 'angle.png', mediaType: 'image/png' },
    ]],
    ['mention inside backticks and quotes', '`@tick.png` \'@single.png\' "@double.png"', [
      { path: 'tick.png', mediaType: 'image/png' },
      { path: 'single.png', mediaType: 'image/png' },
      { path: 'double.png', mediaType: 'image/png' },
    ]],
    ['email address is not a mention', 'mail a@b.png', []],
    ['multiple mentions keep prompt order', '@one.png then @"two words.jpg" then @three.gif', [
      { path: 'one.png', mediaType: 'image/png' },
      { path: 'two words.jpg', mediaType: 'image/jpeg' },
      { path: 'three.gif', mediaType: 'image/gif' },
    ]],
  ])('lists %s', (_label, text, expected) => {
    expect(imageMentions(text)).toEqual(expected)
  })

  it('reports whether a prompt carries an image mention', () => {
    expect(hasImageMention('@a.png')).toBe(true)
    expect(hasImageMention('plain prompt')).toBe(false)
  })
})

describe('expandPromptMentions', () => {
  it('returns the original text when no image is mentioned', async () => {
    const harness = mentionHarness()

    const expanded = await expand(harness, 'plain prompt')

    expect(expanded).toEqual({ content: [{ type: 'text', text: 'plain prompt' }], notices: [] })
    expect(harness.routes).toBe(0)
    expect(harness.resolved).toEqual([])
  })

  it('reports a composition without a filesystem service', async () => {
    const harness = mentionHarness({ fs: false })

    const expanded = await expand(harness, '@a.png')

    expect(expanded.notices).toEqual([copy.mention.noFilesystem])
    expect(expanded.content).toEqual([{ type: 'text', text: '@a.png' }])
  })

  it('reports a composition without an attachment store', async () => {
    const harness = mentionHarness({ attachments: false })

    const expanded = await expand(harness, '@a.png')

    expect(expanded.notices).toEqual([copy.mention.noAttachments])
  })

  it('reports a model that does not accept image input', async () => {
    const harness = mentionHarness({
      route: { provider: 'test', model: 'text-only' },
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model, inputModalities: ['text'] }),
    })

    const expanded = await expand(harness, '@a.png')

    expect(expanded.notices).toEqual([copy.mention.unsupportedModel('text-only')])
    expect(expanded.content).toEqual([{ type: 'text', text: '@a.png' }])
    expect(harness.resolved).toEqual([])
  })

  it('attaches without a route when no model is selected', async () => {
    const harness = mentionHarness()

    const expanded = await expand(harness, '@a.png')

    expect(expanded.notices).toEqual([])
    expect(expanded.content).toEqual([
      { type: 'text', text: '@a.png' },
      admission('image/png', 'a.png'),
    ])
  })

  it('attaches when the resolved model declares image input', async () => {
    const harness = mentionHarness({
      route: { provider: 'test', model: 'vision' },
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model, inputModalities: ['text', 'image'] }),
    })

    const expanded = await expand(harness, '@photo.png')

    expect(expanded.notices).toEqual([])
    expect(expanded.content.at(-1)).toEqual(admission('image/png', 'photo.png'))
  })

  it('attaches when the model declares no modalities at all', async () => {
    const harness = mentionHarness({
      route: { provider: 'test', model: 'unknown' },
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
    })

    const expanded = await expand(harness, '@photo.png')

    expect(expanded.notices).toEqual([])
    expect(expanded.content).toHaveLength(2)
  })

  it.each<[string, ImageMediaType]>([
    ['a.png', 'image/png'],
    ['a.jpg', 'image/jpeg'],
    ['a.jpeg', 'image/jpeg'],
    ['a.gif', 'image/gif'],
    ['a.webp', 'image/webp'],
  ])('maps %s to %s', async (path, mediaType) => {
    const harness = mentionHarness()

    await expand(harness, `@${path}`)

    expect(harness.admitted[0]?.[0]).toEqual({
      type: 'image',
      mediaType,
      data: Buffer.from([1, 2, 3]).toString('base64'),
      name: path,
    })
  })

  it('keeps the prompt order across text and admitted images', async () => {
    const harness = mentionHarness()

    const expanded = await expand(harness, 'first @one.png middle @"two words.jpg" last')

    expect(expanded.content.map(block => block.type)).toEqual(['text', 'image', 'image'])
    expect(expanded.content[0]).toEqual({ type: 'text', text: 'first @one.png middle @"two words.jpg" last' })
    expect(harness.admitted.map(parts => parts[0]?.type === 'image' ? parts[0].name : '')).toEqual(['one.png', 'two words.jpg'])
    expect(harness.resolved).toEqual(['one.png', 'two words.jpg'])
  })

  it('derives the display name from the leaf of a nested path', async () => {
    const harness = mentionHarness()

    await expand(harness, '@assets/images/photo.png')

    expect(harness.admitted[0]?.[0]?.type === 'image' ? harness.admitted[0][0].name : '').toBe('photo.png')
  })

  it('admits the base64 form of the read bytes', async () => {
    const harness = mentionHarness({ fs: { bytes: new Uint8Array([104, 105]) } })

    await expand(harness, '@a.png')

    expect(harness.admitted[0]?.[0]?.type === 'image' ? harness.admitted[0][0].data : '').toBe('aGk=')
  })

  it('reports a mention that is not a readable file', async () => {
    const missing = mentionHarness({ fs: { stat: async () => undefined } })
    const directory = mentionHarness({ fs: { stat: async target => ({ version: FsVersion('v1'), type: 'directory', targetKey: target.targetKey }) } })

    await expect(expand(missing, '@missing.png')).resolves.toMatchObject({ notices: [copy.mention.notFound('missing.png')] })
    await expect(expand(directory, '@dir.png')).resolves.toMatchObject({ notices: [copy.mention.notFound('dir.png')] })
  })

  it('reports an image above the per-image byte limit', async () => {
    const harness = mentionHarness({
      limits: { maxImageBytes: 2 },
      fs: { stat: async () => ({ version: FsVersion('v1'), type: 'file', size: 3 }) },
    })

    const expanded = await expand(harness, '@big.png')

    expect(expanded.notices).toEqual([copy.mention.tooLarge('big.png', 2)])
    expect(harness.reads).toEqual([])
  })

  it('reads a file whose size the backend does not report', async () => {
    const harness = mentionHarness({ fs: { stat: async () => ({ version: FsVersion('v1'), type: 'file' }) } })

    const expanded = await expand(harness, '@unknown-size.png')

    expect(expanded.notices).toEqual([])
    expect(harness.reads).toHaveLength(1)
  })

  it('stops after the per-message image limit and reports it once', async () => {
    const harness = mentionHarness({ limits: { maxImagesPerMessage: 1 } })

    const expanded = await expand(harness, '@one.png @two.png @three.png')

    expect(expanded.content.map(block => block.type)).toEqual(['text', 'image'])
    expect(expanded.notices).toEqual([copy.mention.tooMany(1)])
    expect(harness.resolved).toEqual(['one.png'])
  })

  it.each([
    ['an Error', new Error('read failed'), 'read failed'],
    ['a non-Error', 'read failed', 'read failed'],
  ])('reports a read failure thrown as %s', async (_label, readError, message) => {
    const harness = mentionHarness({ fs: { readError } })

    const expanded = await expand(harness, '@broken.png')

    expect(expanded.notices).toEqual([copy.mention.failed('broken.png', message)])
    expect(expanded.content).toEqual([{ type: 'text', text: '@broken.png' }])
  })

  it('reports a resolve failure and continues with the next mention', async () => {
    const harness = mentionHarness({ fs: { resolveError: new Error('outside workspace') } })

    const expanded = await expand(harness, '@first.png @second.png')

    expect(expanded.notices).toEqual([
      copy.mention.failed('first.png', 'outside workspace'),
      copy.mention.failed('second.png', 'outside workspace'),
    ])
  })

  it('reports an admission failure', async () => {
    const harness = mentionHarness({
      attachments: { admit: async () => { throw new Error('storage offline') } },
    })

    const expanded = await expand(harness, '@failed.png')

    expect(expanded.notices).toEqual([copy.mention.failed('failed.png', 'storage offline')])
  })

  it('keeps a successful attachment before a failing one', async () => {
    const harness = mentionHarness({
      fs: {
        stat: async target => target.displayPath === 'missing.png'
          ? undefined
          : { version: FsVersion('v1'), type: 'file', size: 3 },
      },
    })

    const expanded = await expand(harness, '@missing.png @present.png')

    expect(expanded.content.map(block => block.type)).toEqual(['text', 'image'])
    expect(expanded.notices).toEqual([copy.mention.notFound('missing.png')])
  })
})

describe('mention helpers', () => {
  it('reads the attachment store the expansion would use', () => {
    const store = { imageLimits: LIMITS, admitPromptContent: async () => [] }
    const withStore = testContext({ attachments: store })

    expect(mentionStore(withStore)).toBe(store)
    expect(mentionStore(testContext())).toBeUndefined()
  })

  it('uses the presented Session working directory', async () => {
    const ctx = new Context()
    await mountSessions(ctx)
    const session = ctx.sessions.create(SessionId('with-cwd'), { meta: { cwd: '/workspace/mentions' } })
    const { agent } = testAgent({ session })

    expect(mentionCwd(agent)).toBe('/workspace/mentions')
    expect(mentionCwd(undefined)).toBe(process.cwd())
  })
})

/**
 * `@path` prompt mentions: image mentions are read from the workspace and
 * admitted as durable image attachments on the outgoing user message, while
 * every other mention stays literal prompt text the model resolves with its
 * file-reading tools.
 *
 * @module @deepseek-ai/dsh-tui/mentions
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment/types'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { copy } from './copy.ts'

/** Model route used for the input-modality guard. */
export interface MentionRoute {
  readonly provider: string
  readonly model: string
}

/** Values the expander reads from the host at submission time. */
export interface MentionDeps {
  /** Host context carrying the filesystem, attachment store, and LLM registry. */
  readonly ctx: Context
  /** @returns the visible workspace root for relative mentions. */
  readonly cwd: () => string
  /** @returns the route the next request uses. */
  readonly route: () => MentionRoute | undefined
}

/** One expanded prompt: the original text plus durable image blocks. */
export interface ExpandedPrompt {
  readonly content: readonly ContentBlock[]
  /** User-facing diagnostics for mentions that could not be attached. */
  readonly notices: readonly string[]
}

/** Image extensions the terminal attaches, mapped to their media type. */
const IMAGE_MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** Token boundary before an `@` mention, mirroring the completion grammar. */
const MENTION = /(?:^|[\s(\[{<'"`])@(?:"([^"\n]+)"|([^\s"'`()[\]{}<>]+))/gu

/** One image mention: the prompt path plus the media type its extension declares. */
export interface ImageMention {
  /** Mention text after `@`, as written in the prompt. */
  readonly path: string
  /** Media type implied by the path extension. */
  readonly mediaType: ImageMediaType
}

/**
 * List the image references in one prompt.
 * @param text - submitted prompt text.
 * @returns mentions whose extension names a supported image, in prompt order.
 */
export function imageMentions(text: string): ImageMention[] {
  const mentions: ImageMention[] = []
  for (const match of text.matchAll(MENTION)) {
    /* v8 ignore next -- the mention regex captures exactly one of its two path groups */
    const path = match[1] ?? match[2]
    /* v8 ignore next -- the mention regex captures exactly one of its two path groups */
    if (path === undefined) continue
    const extension = /\.([a-z0-9]+)$/iu.exec(path)?.[1]?.toLowerCase()
    if (extension === undefined) continue
    const mediaType = IMAGE_MEDIA_TYPES[extension]
    if (mediaType === undefined) continue
    mentions.push({ path, mediaType })
  }
  return mentions
}

/**
 * Read and admit the image mentions of one prompt.
 * @param deps - host services plus the workspace and route readers.
 * @param text - submitted prompt text.
 * @returns the original text (always present) plus admitted image blocks and notices.
 */
export async function expandPromptMentions(deps: MentionDeps, text: string): Promise<ExpandedPrompt> {
  const content: ContentBlock[] = [{ type: 'text', text }]
  const notices: string[] = []
  const mentions = imageMentions(text)
  if (mentions.length === 0) return { content, notices }
  const fs = deps.ctx.get('fs')
  if (fs === undefined) return { content, notices: [copy.mention.noFilesystem] }
  const attachments = deps.ctx.get('attachments')
  if (attachments === undefined) return { content, notices: [copy.mention.noAttachments] }
  const route = deps.route()
  if (route !== undefined) {
    const model = await deps.ctx.llm.resolveModelInfo(route.provider, route.model)
    if (model.inputModalities !== undefined && !model.inputModalities.includes('image')) {
      return { content, notices: [copy.mention.unsupportedModel(route.model)] }
    }
  }
  const limits = attachments.imageLimits
  let attached = 0
  for (const { path, mediaType } of mentions) {
    if (attached >= limits.maxImagesPerMessage) {
      notices.push(copy.mention.tooMany(limits.maxImagesPerMessage))
      break
    }
    try {
      const target = await fs.resolve(path, { cwd: deps.cwd() })
      const info = await fs.stat(target)
      if (info === undefined || info.type !== 'file') {
        notices.push(copy.mention.notFound(path))
        continue
      }
      if (info.size !== undefined && info.size > limits.maxImageBytes) {
        notices.push(copy.mention.tooLarge(path, limits.maxImageBytes))
        continue
      }
      const bytes = await fs.readBytes(target, undefined, limits.maxImageBytes)
      const name = path.slice(path.lastIndexOf('/') + 1)
      const admitted = await attachments.admitPromptContent([{
        type: 'image',
        mediaType,
        data: Buffer.from(bytes).toString('base64'),
        name,
      }])
      const block = admitted[0]
      /* v8 ignore next -- admitting one image part always returns one image part */
      if (block?.type !== 'image') continue
      content.push(block)
      attached += 1
    } catch (error: unknown) {
      notices.push(copy.mention.failed(path, error instanceof Error ? error.message : String(error)))
    }
  }
  return { content, notices }
}

/**
 * Read the mounted attachment store for mention expansion.
 * @param ctx - host context.
 * @returns the attachment store, or undefined when the composition mounts none.
 */
export function mentionStore(ctx: Context): Context['attachments'] | undefined {
  return ctx.get('attachments')
}

/**
 * Test whether one prompt references any image the terminal can attach.
 * @param text - submitted prompt text.
 * @returns whether at least one mention names a supported image.
 */
export function hasImageMention(text: string): boolean {
  return imageMentions(text).length > 0
}

/**
 * Resolve the workspace root relative mentions use for one Agent.
 * @param agent - the presented Agent, when it exists.
 * @returns the recorded Session working directory, or the process cwd before the Agent exists.
 */
export function mentionCwd(agent: Agent | undefined): string {
  return agent?.session.header.cwd ?? process.cwd()
}

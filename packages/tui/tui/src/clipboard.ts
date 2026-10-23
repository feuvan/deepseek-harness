/**
 * Clipboard image input: read an image from the host clipboard and identify
 * its media type from the bytes, so the composer can attach it to the next
 * prompt through the same admission path as `@` image mentions.
 *
 * @module @deepseek-ai/dsh-tui/clipboard
 */

import { getNativeClipboard, type NativeClipboard } from '@earendil-works/pi-tui'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment/types'

/** One clipboard read outcome. */
export type ClipboardImageRead =
  | { readonly kind: 'image'; readonly bytes: Uint8Array; readonly mediaType: ImageMediaType; readonly name: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed'; readonly message: string }

/** File-extension suffix per supported image media type. */
const EXTENSIONS: Readonly<Record<ImageMediaType, string>> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** PNG signature. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
/** GIF signature prefix. */
const GIF = [0x47, 0x49, 0x46, 0x38] as const
/** JPEG signature prefix. */
const JPEG = [0xff, 0xd8, 0xff] as const

/**
 * Read 1-2 bytes of a byte array.
 * @param bytes - candidate image bytes.
 * @param offset - first byte offset.
 * @param expected - expected prefix bytes.
 * @returns whether the prefix matches.
 */
function startsWith(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (bytes.length < offset + expected.length) return false
  return expected.every((value, index) => bytes[offset + index] === value)
}

/**
 * Identify a supported image media type from its bytes.
 * @param bytes - clipboard image bytes.
 * @returns the media type, or undefined when the format is unsupported.
 */
export function detectImageMediaType(bytes: Uint8Array): ImageMediaType | undefined {
  if (startsWith(bytes, 0, PNG)) return 'image/png'
  if (startsWith(bytes, 0, JPEG)) return 'image/jpeg'
  if (startsWith(bytes, 0, GIF)) return 'image/gif'
  if (startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp'
  return undefined
}

/**
 * Read one image from the host clipboard.
 * @param clipboard - clipboard helper; defaults to the platform helper.
 * @returns the image bytes and media type, or why no image was read.
 */
export async function readClipboardImage(clipboard: NativeClipboard | undefined = getNativeClipboard()): Promise<ClipboardImageRead> {
  if (clipboard === undefined) return { kind: 'unavailable' }
  let bytes: Uint8Array | null | undefined
  try {
    bytes = await clipboard.getImage()
  } catch (error: unknown) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
  if (bytes === undefined) return { kind: 'unavailable' }
  if (bytes === null) return { kind: 'none' }
  const mediaType = detectImageMediaType(bytes)
  if (mediaType === undefined) return { kind: 'none' }
  return { kind: 'image', bytes, mediaType, name: `clipboard.${EXTENSIONS[mediaType]}` }
}

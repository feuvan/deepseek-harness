import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeClipboard } from '@earendil-works/pi-tui'
import { detectImageMediaType, readClipboardImage } from '../../src/clipboard.ts'

vi.mock('@earendil-works/pi-tui', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  getNativeClipboard: vi.fn(() => undefined),
}))

/** A PNG signature followed by one payload byte. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
/** A JPEG signature followed by one payload byte. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
/** A GIF signature followed by one payload byte. */
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
/** A WebP signature with its format marker. */
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56])

/** @returns a clipboard double resolving one image read. */
function clipboardDouble(getImage: () => Promise<Uint8Array | null | undefined>): NativeClipboard {
  return {
    getText: async () => undefined,
    getImage,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('detectImageMediaType', () => {
  it.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['GIF', GIF, 'image/gif'],
    ['WebP', WEBP, 'image/webp'],
  ] as const)('detects %s bytes', (_label, bytes, expected) => {
    expect(detectImageMediaType(bytes)).toBe(expected)
  })

  it.each([
    ['empty', new Uint8Array()],
    ['a one-byte prefix', new Uint8Array([0x89])],
    ['a truncated PNG', PNG.slice(0, 4)],
    ['a RIFF container that is not WebP', new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])],
    ['unknown bytes', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])],
  ])('returns undefined for %s', (_label, bytes) => {
    expect(detectImageMediaType(bytes)).toBeUndefined()
  })
})

describe('readClipboardImage', () => {
  it('reports an unavailable clipboard when the helper is absent', async () => {
    await expect(readClipboardImage(undefined)).resolves.toEqual({ kind: 'unavailable' })
    await expect(readClipboardImage()).resolves.toEqual({ kind: 'unavailable' })
  })

  it('reports unavailable when the helper returns undefined', async () => {
    await expect(readClipboardImage(clipboardDouble(async () => undefined))).resolves.toEqual({ kind: 'unavailable' })
  })

  it('reports none when the clipboard holds no image', async () => {
    await expect(readClipboardImage(clipboardDouble(async () => null))).resolves.toEqual({ kind: 'none' })
  })

  it('reports none when the bytes are an unsupported format', async () => {
    await expect(readClipboardImage(clipboardDouble(async () => new Uint8Array([9, 9, 9]))))
      .resolves.toEqual({ kind: 'none' })
  })

  it.each([
    ['PNG', PNG, 'image/png', 'clipboard.png'],
    ['JPEG', JPEG, 'image/jpeg', 'clipboard.jpg'],
    ['GIF', GIF, 'image/gif', 'clipboard.gif'],
    ['WebP', WEBP, 'image/webp', 'clipboard.webp'],
  ] as const)('returns %s bytes with a clipboard name', async (_label, bytes, mediaType, name) => {
    await expect(readClipboardImage(clipboardDouble(async () => bytes))).resolves.toEqual({
      kind: 'image',
      bytes,
      mediaType,
      name,
    })
  })

  it.each([
    ['an Error', new Error('clipboard unavailable'), 'clipboard unavailable'],
    ['a non-Error', 'clipboard unavailable', 'clipboard unavailable'],
  ] as const)('reports a read failure thrown as %s', async (_label, failure, message) => {
    await expect(readClipboardImage(clipboardDouble(async () => { throw failure }))).resolves.toEqual({
      kind: 'failed',
      message,
    })
  })
})

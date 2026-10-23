import { describe, expect, it } from 'vitest'
import { copy } from '../../src/copy.ts'

/** @returns whether a value is a nested copy group. */
function isCopyGroup(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Collect every non-formatter string in the copy tree with its dotted path. */
function leafStrings(value: Record<string, unknown>, prefix = ''): [path: string, text: string][] {
  const leaves: [string, string][] = []
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof entry === 'string') leaves.push([path, entry])
    else if (isCopyGroup(entry)) leaves.push(...leafStrings(entry, path))
  }
  return leaves
}

describe('copy', () => {
  it('defines every user-visible string as non-empty text', () => {
    const leaves = leafStrings(copy)
    expect(leaves.length).toBeGreaterThan(0)
    for (const [path, text] of leaves) expect(text.trim(), path).not.toBe('')
  })

  it('formats question batch progress as index over total', () => {
    expect(copy.prompt.progress(1, 3)).toBe('1/3')
    expect(copy.prompt.progress(2, 2)).toBe('2/2')
  })

  it('formats a single hidden line in the singular', () => {
    expect(copy.notice.hiddenLines(1)).toBe('… 1 more line')
  })

  it('formats several hidden lines in the plural', () => {
    expect(copy.notice.hiddenLines(2)).toBe('… 2 more lines')
    expect(copy.notice.hiddenLines(40)).toBe('… 40 more lines')
  })
})


describe('copy format helpers', () => {
  it('formats the mention diagnostics', () => {
    expect(copy.mention.unsupportedModel('text-only')).toBe(
      'Model "text-only" does not support image input; the image mention was not attached.',
    )
    expect(copy.mention.notFound('a.png')).toBe('Image mention "a.png" is not a readable file.')
    expect(copy.mention.tooLarge('a.png', 1024)).toBe('Image mention "a.png" exceeds the 1024-byte image limit.')
    expect(copy.mention.tooMany(4)).toBe('Only 4 images can be attached to one message.')
    expect(copy.mention.failed('a.png', 'read failed')).toBe('Image mention "a.png" could not be attached: read failed')
    expect(copy.mention.noAttachments).toContain('no attachment store')
    expect(copy.mention.noFilesystem).toContain('no filesystem service')
  })

  it('formats the reasoning-effort notices', () => {
    expect(copy.model.effort('high')).toBe('Reasoning effort: high')
    expect(copy.model.effortFailed('catalog offline')).toBe('Could not switch reasoning effort: catalog offline')
  })

  it('names every plan-review presentation value', () => {
    expect(copy.prompt.planReview).toBe('Plan review')
    expect(copy.prompt.planReviewHint).toBe('↑/↓ move · Enter select · Esc cancel')
    expect(copy.prompt.approveMark).toBe('✓')
    expect(copy.prompt.declineMark).toBe('✗')
    expect(copy.prompt.planTruncated).toContain('plan truncated')
    expect(copy.prompt.customHint).toContain('Enter confirm')
    expect(copy.prompt.custom).toBe('Other answer…')
  })

  it('names the permission-preset chooser values', () => {
    expect(copy.prompt.permissionTitle).toBe('Permission preset')
    expect(copy.prompt.permissionCurrent).toBe('current')
  })

  it('names the completion kinds', () => {
    expect(copy.autocomplete.directory).toBe('directory')
    expect(copy.autocomplete.file).toBe('file')
  })
})

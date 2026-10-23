import { describe, expect, it } from 'vitest'
import { createMarkdownTheme, createSelectListTheme } from '../../src/markdown.ts'
import { createPalette, type Palette } from '../../src/palette.ts'

const palette = createPalette(true)

/** Markdown theme fields that return styled text. */
type MarkdownTextField =
  | 'heading' | 'link' | 'linkUrl' | 'code' | 'codeBlock' | 'codeBlockBorder'
  | 'quote' | 'quoteBorder' | 'hr' | 'listBullet' | 'bold' | 'italic'
  | 'strikethrough' | 'underline'

/** Select-list theme fields. */
type SelectListTextField = 'selectedPrefix' | 'selectedText' | 'description' | 'scrollInfo' | 'noMatch'

describe('createMarkdownTheme', () => {
  it.each<[MarkdownTextField, (palette: Palette, text: string) => string]>([
    ['heading', (p, text) => p.heading(text)],
    ['link', (p, text) => p.link(text)],
    ['linkUrl', (p, text) => p.dim(text)],
    ['code', (p, text) => p.code(text)],
    ['codeBlock', (p, text) => p.text(text)],
    ['codeBlockBorder', (p, text) => p.border(text)],
    ['quote', (p, text) => p.dim(text)],
    ['quoteBorder', (p, text) => p.border(text)],
    ['hr', (p, text) => p.border(text)],
    ['listBullet', (p, text) => p.accent(text)],
    ['bold', (p, text) => p.bold(text)],
    ['italic', (p, text) => p.italic(text)],
    ['strikethrough', (p, text) => p.strike(text)],
    ['underline', (p, text) => p.underline(text)],
  ])('maps %s to its palette style', (field, expected) => {
    const theme = createMarkdownTheme(palette)
    expect(theme[field]('mark')).toBe(expected(palette, 'mark'))
  })

  it('highlights fenced code through the shared highlighter', () => {
    const theme = createMarkdownTheme(palette)

    expect(theme.highlightCode).toBeDefined()
    const lines = theme.highlightCode?.('const value = 42', 'ts') ?? []

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(palette.accent('const'))
    expect(lines[0]).toContain(palette.warning('42'))
  })

  it('renders unknown fence languages as plain code', () => {
    const theme = createMarkdownTheme(palette)

    expect(theme.highlightCode?.('a\nb', 'unknown')).toEqual([palette.code('a'), palette.code('b')])
  })

  it('renders fenced code unstyled for the plain palette', () => {
    const theme = createMarkdownTheme(createPalette(false))

    expect(theme.highlightCode?.('const value = 1', 'ts')).toEqual(['const value = 1'])
  })

  it('maps every theme field to a distinct palette style', () => {
    const theme = createMarkdownTheme(palette)
    expect(theme.heading('x')).not.toBe(theme.link('x'))
    expect(theme.codeBlock('x')).toBe('x')
    expect(theme.quote('x')).toBe(theme.linkUrl('x'))
    expect(theme.quoteBorder('x')).toBe(theme.hr('x'))
  })
})

describe('createSelectListTheme', () => {
  it.each<[SelectListTextField, (palette: Palette, text: string) => string]>([
    ['selectedPrefix', (p, text) => p.accent(text)],
    ['selectedText', (p, text) => p.inverse(text)],
    ['description', (p, text) => p.dim(text)],
    ['scrollInfo', (p, text) => p.dim(text)],
    ['noMatch', (p, text) => p.dim(text)],
  ])('maps %s to its palette style', (field, expected) => {
    const theme = createSelectListTheme(palette)
    expect(theme[field]('row')).toBe(expected(palette, 'row'))
  })
})

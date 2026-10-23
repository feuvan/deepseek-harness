import { describe, expect, it } from 'vitest'
import { createPalette, type Palette } from '../../src/palette.ts'

const ESC = '\u001b'

/** A named style and the SGR pair it must emit when color is enabled. */
interface StyleCase {
  readonly name: keyof Omit<Palette, 'color'>
  readonly open: string
  readonly close: string
}

const styles: readonly StyleCase[] = [
  { name: 'dim', open: '2', close: '22' },
  { name: 'bold', open: '1', close: '22' },
  { name: 'italic', open: '3', close: '23' },
  { name: 'underline', open: '4', close: '24' },
  { name: 'inverse', open: '7', close: '27' },
  { name: 'strike', open: '9', close: '29' },
  { name: 'accent', open: '36', close: '39' },
  { name: 'success', open: '32', close: '39' },
  { name: 'warning', open: '33', close: '39' },
  { name: 'error', open: '31', close: '39' },
  { name: 'info', open: '34', close: '39' },
  { name: 'secondary', open: '35', close: '39' },
  { name: 'link', open: '4;34', close: '24;39' },
  { name: 'code', open: '36', close: '39' },
  { name: 'border', open: '2', close: '22' },
  { name: 'diffAdd', open: '32', close: '39' },
  { name: 'diffRemove', open: '31', close: '39' },
]

/** Styles composed from two SGR pairs, outermost first. */
const composed: readonly { readonly name: 'prompt' | 'heading'; readonly pairs: readonly (readonly [string, string])[] }[] = [
  { name: 'prompt', pairs: [['1', '22'], ['36', '39']] },
  { name: 'heading', pairs: [['1', '22'], ['36', '39']] },
]

describe('createPalette', () => {
  it('reports whether color is enabled', () => {
    expect(createPalette(true).color).toBe(true)
    expect(createPalette(false).color).toBe(false)
  })

  it.each(styles)('wraps $name text in its SGR pair', ({ name, open, close }) => {
    const palette = createPalette(true)
    expect(palette[name]('hello')).toBe(`${ESC}[${open}mhello${ESC}[${close}m`)
  })

  it('leaves the default foreground text unescaped', () => {
    expect(createPalette(true).text('plain')).toBe('plain')
  })

  it.each(composed)('composes the $name style from bold and cyan', ({ name, pairs }) => {
    const [outer, inner] = pairs
    expect(createPalette(true)[name]('x')).toBe(
      `${ESC}[${outer?.[0]}m${ESC}[${inner?.[0]}mx${ESC}[${inner?.[1]}m${ESC}[${outer?.[1]}m`,
    )
  })

  it.each(styles)('returns $name text unchanged when color is disabled', ({ name }) => {
    expect(createPalette(false)[name]('hello')).toBe('hello')
  })

  it.each(composed)('returns $name text unchanged when color is disabled', ({ name }) => {
    expect(createPalette(false)[name]('hello')).toBe('hello')
  })

  it('keeps text and escape sequences untouched when color is disabled', () => {
    const palette = createPalette(false)
    expect(palette.dim(`${ESC}[31mred${ESC}[39m`)).toBe(`${ESC}[31mred${ESC}[39m`)
  })
})

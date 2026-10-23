import { describe, expect, it } from 'vitest'
import { createCodeHighlighter } from '../../src/highlight.ts'
import { createPalette, type Palette } from '../../src/palette.ts'
import { visibleLines } from '../support/terminal.ts'

const PLAIN = createPalette(false)
const COLOR = createPalette(true)

/** Palette methods the scope mapping under test can produce. */
type StyleName =
  | 'accent' | 'info' | 'heading' | 'success' | 'warning' | 'dim'
  | 'secondary' | 'error' | 'italic' | 'bold' | 'underline' | 'code'

/**
 * Highlight one fence without styling.
 * @param code - fence body.
 * @param language - fence language.
 * @returns the unstyled lines.
 */
function plainLines(code: string, language?: string): string[] {
  return createCodeHighlighter(PLAIN)(code, language)
}

/**
 * Highlight one fence with the color palette.
 * @param code - fence body.
 * @param language - fence language.
 * @returns the styled lines.
 */
function styledLines(code: string, language?: string): string[] {
  return createCodeHighlighter(COLOR)(code, language)
}

/**
 * Highlight one fence with the color palette as one text block.
 * @param code - fence body.
 * @param language - fence language.
 * @returns the styled text.
 */
function styledText(code: string, language?: string): string {
  return styledLines(code, language).join('\n')
}

/**
 * Wrap one run in a palette style.
 * @param palette - the palette that produces the style.
 * @param style - the palette method name.
 * @param run - run text.
 * @returns the styled run.
 */
function styledRun(palette: Palette, style: StyleName, run: string): string {
  return palette[style](run)
}

/**
 * Whether one palette style wraps a run in the highlighted text.
 * @param text - highlighted text.
 * @param style - the palette method name.
 * @param run - the run text expected to carry the style.
 * @returns whether the styled run is present.
 */
function hasStyledRun(text: string, style: StyleName, run: string): boolean {
  return text.includes(styledRun(COLOR, style, run))
}

describe('createCodeHighlighter languages', () => {
  it.each<[string, string, string, StyleName, string]>([
    ['keyword', 'const answer = 1', 'ts', 'accent', 'const'],
    ['keyword-like selector tag', 'div { }', 'css', 'accent', 'div'],
    ['title', 'struct Foo { int x; };', 'c', 'info', 'Foo'],
    ['function', 'def greet(): pass', 'py', 'info', 'greet'],
    ['built_in', 'echo hi', 'sh', 'heading', 'echo'],
    ['type', '/** @param {number} x */', 'js', 'heading', 'number'],
    ['class', 'struct Foo { int x; };', 'c', 'heading', ' {'],
    ['title class_', 'class Widget {}', 'ts', 'info', 'Widget'],
    ['string', 'const s = "hello"', 'ts', 'success', '"hello"'],
    ['regexp', 'const re = /ab+c/g;', 'js', 'success', '/ab+c/g'],
    ['symbol', '[text][ref]', 'md', 'success', 'ref'],
    ['quote', '> quoted', 'md', 'success', '> quoted'],
    ['addition', '+added', 'diff', 'success', '+added'],
    ['number', 'const n = 42', 'ts', 'warning', '42'],
    ['literal', 'x = True', 'py', 'warning', 'True'],
    ['meta', 'a: &anchor', 'yml', 'warning', '&anchor'],
    ['attribute', 'div { color: red }', 'css', 'warning', 'color'],
    ['bullet', '- item', 'yml', 'warning', '-'],
    ['selector-attr', 'a[href="x"]', 'css', 'warning', '[href='],
    ['selector-pseudo', 'a:hover', 'css', 'warning', ':hover'],
    ['comment', '// note', 'ts', 'dim', '// note'],
    ['doctag', '/** @param x */', 'js', 'dim', '@param'],
    ['variable', 'echo $HOME', 'sh', 'secondary', '$HOME'],
    ['template-variable', 'key: "{{ value }}"', 'yml', 'secondary', '{{ value }}'],
    ['params', 'function greet(name) {}', 'ts', 'secondary', 'name'],
    ['attr', 'key: value', 'yml', 'secondary', 'key:'],
    ['property', 'const x = obj.prop', 'ts', 'secondary', 'prop'],
    ['deletion', '-removed', 'diff', 'error', '-removed'],
    ['emphasis', '*em*', 'md', 'italic', '*em*'],
    ['strong', '**bold**', 'md', 'bold', '**bold**'],
    ['link', '[ref]: https://example.test', 'md', 'underline', 'https://example.test'],
  ])('styles the %s scope in %s code', (_scope, code, language, style, run) => {
    expect(hasStyledRun(styledText(code, language), style, run)).toBe(true)
  })

  it('styles each syntax family from its scope mapping', () => {
    const typescript = styledText('// note\nconst s = "hi"\nconst n = 42', 'ts')
    expect(hasStyledRun(typescript, 'accent', 'const')).toBe(true)
    expect(hasStyledRun(typescript, 'success', '"hi"')).toBe(true)
    expect(hasStyledRun(typescript, 'warning', '42')).toBe(true)
    expect(hasStyledRun(typescript, 'dim', '// note')).toBe(true)

    const python = styledText('def greet(name: str):\n    return 1', 'py')
    expect(hasStyledRun(python, 'info', 'greet')).toBe(true)

    const c = styledText('struct Foo { int x; };', 'c')
    expect(c).toContain(COLOR.accent('struct') + COLOR.heading(' ') + COLOR.info('Foo') + COLOR.heading(' {'))
    expect(hasStyledRun(c, 'info', 'Foo')).toBe(true)

    const diff = styledText('+added\n-removed', 'diff')
    expect(hasStyledRun(diff, 'success', '+added')).toBe(true)
    expect(hasStyledRun(diff, 'error', '-removed')).toBe(true)

    const markdown = styledText('*em* **bold** [x](https://example.test)', 'md')
    expect(hasStyledRun(markdown, 'italic', '*em*')).toBe(true)
    expect(hasStyledRun(markdown, 'bold', '**bold**')).toBe(true)
    expect(hasStyledRun(markdown, 'underline', 'https://example.test')).toBe(true)
  })

  it('styles built-in types, class names, and named functions', () => {
    const typescript = styledText('let n: number = 1\nclass Widget {}', 'ts')
    expect(hasStyledRun(typescript, 'heading', 'number')).toBe(true)
    expect(hasStyledRun(typescript, 'info', 'Widget')).toBe(true)

    const javascript = styledText('/** @param {number} x */\nfunction f(x) {}', 'js')
    expect(hasStyledRun(javascript, 'dim', '@param')).toBe(true)
    expect(hasStyledRun(javascript, 'heading', 'number')).toBe(true)
    expect(hasStyledRun(javascript, 'info', 'f')).toBe(true)
  })

  it('styles CSS selectors, attributes, and YAML meta values', () => {
    const css = styledText('div { color: red }\na[href="x"]:hover { display: none }', 'css')
    expect(hasStyledRun(css, 'accent', 'div')).toBe(true)
    expect(hasStyledRun(css, 'warning', 'color')).toBe(true)
    expect(hasStyledRun(css, 'warning', '[href=')).toBe(true)
    expect(hasStyledRun(css, 'warning', ':hover')).toBe(true)

    const yaml = styledText('- item\nkey: &anchor', 'yml')
    expect(hasStyledRun(yaml, 'warning', '-')).toBe(true)
    expect(hasStyledRun(yaml, 'warning', '&anchor')).toBe(true)

    const bash = styledText('echo $HOME', 'sh')
    expect(hasStyledRun(bash, 'secondary', '$HOME')).toBe(true)
    expect(hasStyledRun(bash, 'heading', 'echo')).toBe(true)
  })

  it('styles nested spans with the inner scope overriding the outer style', () => {
    const text = styledText('const t = `x${name}`', 'ts')

    expect(text).toContain(COLOR.success('`x'))
    expect(text).toContain(COLOR.code('${name}'))
    expect(text).toContain(COLOR.success('`'))
  })

  it('keeps the plain code identical to the source text', () => {
    const code = '<div class="a">&amp; &lt;x&gt; &quot;q&quot; &#x27;s&#x27; &#x60;t&#x60;</div>'
    expect(plainLines(code, 'html')).toEqual([code])
  })

  it('decodes the entities highlight.js emits instead of showing escape text', () => {
    const code = 'const s = "it\'s <fine> & done"'
    expect(plainLines(code, 'ts')).toEqual([code])
    const styled = styledText(code, 'ts')
    expect(styled).not.toContain('&quot;')
    expect(styled).not.toContain('&amp;')
    expect(styled).not.toContain('&#x27;')
    expect(styled).toContain('"it\'s <fine> & done"')
  })

  it('decodes a backtick in an XML attribute', () => {
    const code = '<div title="a`b">x</div>'
    expect(plainLines(code, 'html')).toEqual([code])
  })

  it('splits each rendered line at the source newlines', () => {
    const code = '/* one\n   two */\nconst x = 1'
    const styled = styledLines(code, 'ts')

    expect(styled).toHaveLength(3)
    expect(visibleLines(styled)).toEqual(['/* one', '   two */', 'const x = 1'])
    for (const line of styled.slice(0, 2)) {
      expect(line.startsWith('\u001b[2m')).toBe(true)
      expect(line.endsWith('\u001b[22m')).toBe(true)
    }
    expect(styled[2]).toContain(COLOR.accent('const'))
    expect(styled.join('\n')).not.toContain('\u001b[2m\n')
  })

  it('keeps a trailing newline as a final empty line', () => {
    for (const language of [undefined, 'ts', 'unknown']) {
      expect(plainLines('const x = 1\n', language)).toEqual(['const x = 1', ''])
    }
  })

  it.each<[string, string]>([
    ['ts', 'typescript'],
    ['tsx', 'typescript'],
    ['js', 'javascript'],
    ['py', 'python'],
    ['sh', 'bash'],
    ['shell', 'bash'],
    ['html', 'xml'],
    ['yml', 'yaml'],
    ['md', 'markdown'],
    ['rs', 'rust'],
    ['rb', 'ruby'],
    ['cxx', 'cpp'],
    ['hpp', 'cpp'],
    ['h', 'c'],
    ['mjs', 'javascript'],
    ['cjs', 'javascript'],
    ['jsx', 'javascript'],
    ['zsh', 'bash'],
  ])('resolves the %s alias to %s', (alias, canonical) => {
    const code = 'const value = 1'
    expect(plainLines(code, alias)).toEqual(plainLines(code, canonical))
  })

  it('treats unknown and absent languages as plain code', () => {
    const code = 'not <code> & "styled"'
    expect(plainLines(code, 'zig')).toEqual([code])
    expect(plainLines(code)).toEqual([code])
    expect(styledLines(code, undefined)).toEqual([COLOR.code(code)])
    expect(styledLines(code, 'zig')).toEqual([COLOR.code(code)])
  })

  it('normalizes the fence language before selecting a highlighter', () => {
    expect(plainLines('const value = 1', ' TS ')).toEqual(plainLines('const value = 1', 'typescript'))
    expect(styledText('const value = 1', 'TS')).toContain(COLOR.accent('const'))
  })

  it('renders an empty fence as one empty line', () => {
    expect(plainLines('', 'ts')).toEqual([''])
    expect(plainLines('', 'unknown')).toEqual([''])
  })

  it('falls back to the code style for an unmapped scope', () => {
    const text = styledText('<div>', 'html')
    expect(hasStyledRun(text, 'code', '<')).toBe(true)
    expect(hasStyledRun(text, 'code', 'div')).toBe(true)
  })
})

describe('createCodeHighlighter palette policy', () => {
  it('emits only standard 16-color SGR sequences', () => {
    const allowed = new Set([
      '1', '2', '3', '4', '7', '9', '22', '23', '24', '27', '29',
      '31', '32', '33', '34', '35', '36', '39', '4;34', '24;39',
    ])
    const samples = [
      styledText('// note\nconst s = "hi"\nconst n = 42\nfunction f(x: number) { return x }', 'ts'),
      styledText('@media screen { div[type=x]:hover { color: #fff } }', 'css'),
      styledText('- old\n+ new', 'diff'),
      styledText('# Title\n\n*em* **strong** [link](https://x)', 'md'),
      styledText('key: value\nother: {{ x }}', 'yml'),
      styledText('echo $HOME', 'sh'),
    ]
    for (const text of samples) {
      expect(text).not.toContain('\u001b[38;5')
      expect(text).not.toContain('\u001b[48;5')
      expect(text).not.toContain('\u001b[38;')
      expect(text).not.toContain('\u001b[48;')
      for (const match of text.matchAll(/\u001b\[([0-9;]+)m/gu)) {
        expect(allowed.has(match[1] ?? '')).toBe(true)
      }
    }
  })

  it('returns the source text unchanged for the disabled palette', () => {
    const highlighter = createCodeHighlighter(PLAIN)
    const lines = highlighter('const x = 1', 'ts')
    expect(lines.join('\n')).toBe('const x = 1')
    expect(lines.join('')).not.toContain('\u001b')
  })
})

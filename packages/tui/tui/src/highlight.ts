/**
 * Fenced-code syntax highlighting for the terminal transcript. The highlighter
 * maps `highlight.js` scopes onto the standard 16-color {@link Palette}, so
 * highlighted code obeys the same style policy as every other component.
 *
 * @module @deepseek-ai/dsh-tui/highlight
 */

import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import type { Palette } from './palette.ts'

/** Languages the transcript highlights; every other fence renders as plain code. */
const LANGUAGES = {
  bash, c, cpp, csharp, css, diff, go, java, javascript, json, kotlin,
  markdown, python, ruby, rust, sql, swift, typescript, xml, yaml,
} as const

for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language)

/** Common fence aliases mapped onto a registered language. */
const ALIASES: Readonly<Record<string, keyof typeof LANGUAGES>> = {
  cjs: 'javascript',
  cxx: 'cpp',
  h: 'c',
  hpp: 'cpp',
  html: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
  zsh: 'bash',
}

/** One styled run of one code line. */
interface Run {
  readonly text: string
  readonly scope: string | undefined
}

/**
 * Pick the palette style for one `highlight.js` scope name.
 * @param palette - the terminal style table.
 * @param scope - the `hljs-` scope, which may carry several classes.
 * @returns the style function for that scope.
 */
function scopeStyle(palette: Palette, scope: string): (text: string) => string {
  /* v8 ignore next -- splitting any scope string yields at least one element */
  const name = scope.split(/\s+/u)[0] ?? ''
  if (name.startsWith('keyword') || name === 'meta-keyword' || name === 'selector-tag') return text => palette.accent(text)
  if (name.startsWith('title') || name.startsWith('function')) return text => palette.info(text)
  if (name === 'built_in' || name === 'type' || name === 'class' || name === 'class_') return text => palette.heading(text)
  if (name === 'string' || name === 'regexp' || name === 'symbol' || name === 'quote' || name === 'addition') return text => palette.success(text)
  if (name === 'number' || name === 'literal' || name === 'meta' || name === 'attribute' || name === 'bullet' || name === 'selector-attr' || name === 'selector-pseudo') return text => palette.warning(text)
  if (name === 'comment' || name === 'doctag') return text => palette.dim(text)
  if (name === 'variable' || name === 'template-variable' || name === 'params' || name === 'property' || name === 'attr') return text => palette.secondary(text)
  if (name === 'deletion') return text => palette.error(text)
  if (name === 'emphasis') return text => palette.italic(text)
  if (name === 'strong') return text => palette.bold(text)
  if (name === 'link') return text => palette.underline(text)
  return text => palette.code(text)
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  gt: '>',
  lt: '<',
  quot: '"',
  '#x27': "'",
  '#x60': '`',
}

/**
 * Split the highlighted HTML into styled runs, decoding `highlight.js`
 * entities and tracking nested scopes.
 * @param html - the highlighted HTML fragment.
 * @returns ordered runs whose text contains no control sequences.
 */
function toRuns(html: string): Run[] {
  const runs: Run[] = []
  const scopes: string[] = []
  const token = /<span class="hljs-([^"]+)">|<\/span>|&(amp|gt|lt|quot|#x27|#x60);/gu
  let plain = ''
  const pushPlain = (): void => {
    if (plain === '') return
    runs.push({ text: plain, scope: scopes.at(-1) })
    plain = ''
  }
  let index = 0
  for (const match of html.matchAll(token)) {
    const [whole, open, entity] = match
    plain += html.slice(index, match.index)
    index = match.index + whole.length
    if (open !== undefined) {
      pushPlain()
      scopes.push(open)
      continue
    }
    if (entity !== undefined) {
      /* v8 ignore next -- the token regex captures exactly the declared entity names */
      plain += NAMED_ENTITIES[entity] ?? whole
      continue
    }
    pushPlain()
    scopes.pop()
  }
  plain += html.slice(index)
  pushPlain()
  return runs
}

/**
 * Group runs into lines, styling each run and resplitting at newlines so a
 * style never spans two rendered lines.
 * @param runs - ordered styled runs.
 * @returns one entry per code line.
 */
function toLines(runs: readonly Run[], palette: Palette): string[] {
  const lines: string[] = []
  let current = ''
  for (const run of runs) {
    const style = run.scope === undefined ? (text: string) => palette.code(text) : scopeStyle(palette, run.scope)
    for (const [offset, piece] of run.text.split('\n').entries()) {
      if (offset > 0) {
        lines.push(current)
        current = ''
      }
      if (piece !== '') current += style(piece)
    }
  }
  lines.push(current)
  return lines
}

/**
 * Build the Markdown `highlightCode` hook for one palette.
 * @param palette - the terminal style table.
 * @returns a synchronous highlighter; unknown or absent languages render as plain code.
 */
export function createCodeHighlighter(palette: Palette): (code: string, language?: string) => string[] {
  return (code, language) => {
    const requested = language?.trim().toLowerCase()
    const alias = requested === undefined ? undefined : ALIASES[requested] ?? requested
    if (alias === undefined || !(alias in LANGUAGES)) {
      return code.split('\n').map(line => palette.code(line))
    }
    const highlighted = hljs.highlight(code, { language: alias, ignoreIllegals: true })
    return toLines(toRuns(highlighted.value), palette)
  }
}

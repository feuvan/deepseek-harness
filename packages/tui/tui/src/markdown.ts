/**
 * Markdown and selection themes derived from the terminal palette.
 *
 * @module @deepseek-ai/dsh-tui/markdown
 */

import type { MarkdownTheme } from '@earendil-works/pi-tui'
import { createCodeHighlighter } from './highlight.ts'
import type { Palette } from './palette.ts'
import type { SelectListTheme } from '@earendil-works/pi-tui'

/**
 * Build the Markdown rendering theme for one palette.
 * @param palette - the terminal style table.
 * @returns theme functions for every Markdown element the renderer supports.
 */
export function createMarkdownTheme(palette: Palette): MarkdownTheme {
  return {
    heading: text => palette.heading(text),
    link: text => palette.link(text),
    linkUrl: text => palette.dim(text),
    code: text => palette.code(text),
    codeBlock: text => palette.text(text),
    codeBlockBorder: text => palette.border(text),
    quote: text => palette.dim(text),
    quoteBorder: text => palette.border(text),
    hr: text => palette.border(text),
    listBullet: text => palette.accent(text),
    bold: text => palette.bold(text),
    italic: text => palette.italic(text),
    strikethrough: text => palette.strike(text),
    underline: text => palette.underline(text),
    highlightCode: createCodeHighlighter(palette),
  }
}

/**
 * Build the selection-list theme shared by the editor autocomplete and every
 * modal option list.
 * @param palette - the terminal style table.
 * @returns the selection-list theme.
 */
export function createSelectListTheme(palette: Palette): SelectListTheme {
  return {
    selectedPrefix: text => palette.accent(text),
    selectedText: text => palette.inverse(text),
    description: text => palette.dim(text),
    scrollInfo: text => palette.dim(text),
    noMatch: text => palette.dim(text),
  }
}

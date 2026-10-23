/**
 * Typings for the untyped per-language `highlight.js` entry points. The shared
 * core carries the types; each language module default-exports a `LanguageFn`.
 *
 * @module @deepseek-ai/dsh-tui/highlight-languages
 */

declare module 'highlight.js/lib/core' {
  import type { HLJSApi } from 'highlight.js'

  const hljs: HLJSApi
  export default hljs
}

declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js'

  const language: LanguageFn
  export default language
}

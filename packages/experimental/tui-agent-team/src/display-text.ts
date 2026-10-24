/**
 * Render untrusted text into a single terminal line by escaping every C0 and
 * C1 control character except line feeds, so model output, tool content, and
 * diagnostics can never drive the terminal themselves.
 *
 * @module @deepseek-ai/dsh-tui/display-text
 */

/** Control characters that must never reach a terminal raw; LF stays rendered. */
const UNSAFE_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/gu

/**
 * Escape one string for terminal display.
 * @param text - untrusted text, possibly containing control characters.
 * @returns the same text with each unsafe control replaced by `\xHH`.
 */
export function displayText(text: string): string {
  return text.replace(UNSAFE_CONTROL, character => `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`)
}

/**
 * Escape one string and normalize it for single-line placement.
 * @param text - untrusted text.
 * @returns the escaped text with every line feed rendered as `\n`.
 */
export function displayInline(text: string): string {
  return displayText(text).replaceAll('\n', '\\n')
}

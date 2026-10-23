/**
 * Headless terminal sessions for component and lifecycle tests.
 *
 * @module tests/support/terminal
 */

import { HeadlessTerminal } from '@deepseek-ai/dsh-terminal-snapshot'
import { createTerminalSession, type TerminalSession } from '../../src/terminal.ts'

/** A headless terminal and the terminal session that owns it. */
export interface TestTerminal {
  /** The emulator-backed terminal. */
  readonly headless: HeadlessTerminal
  /** The renderer over that terminal. */
  readonly session: TerminalSession
}

/**
 * Build an alternate-screen renderer over a headless terminal.
 * @param options - geometry.
 * @returns the terminal session and its emulator.
 */
export function testTerminal(options: { columns?: number; rows?: number } = {}): TestTerminal {
  const headless = new HeadlessTerminal({ columns: options.columns ?? 100, rows: options.rows ?? 30 })
  const session = createTerminalSession(headless)
  return { headless, session }
}

/**
 * Render a component at one width.
 * @param component - the component.
 * @param width - terminal columns.
 * @returns the rendered lines with trailing spaces preserved.
 */
export function renderLines(component: { render(width: number): string[] }, width = 80): string[] {
  return component.render(width)
}

/**
 * Strip ANSI sequences from rendered lines for content assertions.
 * @param lines - rendered lines.
 * @returns the visible text per line.
 */
export function visibleLines(lines: readonly string[]): string[] {
  return lines.map(line => line.replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, '').replace(/\u001b\][^\u0007]*\u0007/gu, ''))
}

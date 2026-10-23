/**
 * Shared harness for terminal front doors: a pi-tui-compatible headless
 * terminal, the semantic screen projection that snapshots compare, and a PTY
 * driver for assembled process acceptance.
 *
 * @module @deepseek-ai/dsh-terminal-snapshot
 */

export { HeadlessTerminal, type HeadlessTerminalOptions } from './headless-terminal.ts'
export {
  formatTerminalState, projectTerminalState, terminalStyleViolations,
  type TerminalState, type TerminalStyleRun,
} from './project.ts'
export { PtyProcess, type PtyProcessOptions } from './pty-driver.ts'

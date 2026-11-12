/**
 * Launcher handoff used by the terminal's Session switcher: the app-owned
 * service that replaces the running process with another persisted Session.
 *
 * The terminal owns neither Agent creation nor process lifetime. A composed
 * app shell that can re-open a Session provides this service; without it the
 * terminal still lists stored Sessions but reports that resuming requires the
 * command line.
 *
 * @module @deepseek-ai/dsh-tui/handoff
 */

import type { SessionId } from '@deepseek-ai/dsh-session'

/** Stable service key the app shell provides and the terminal consumes. */
export const SESSION_HANDOFF_SERVICE = 'terminalSessionHandoff'

/**
 * Re-open one persisted Session by replacing the current application process.
 *
 * The implementation disposes the current tree before executing the
 * replacement, so a returned promise means the Session was not resumed.
 */
export interface SessionHandoff {
  /**
   * Replace this process with the same application presenting `sessionId` in
   * `cwd`.
   * @param sessionId - exact persisted Session identity to resume.
   * @param cwd - working directory recorded by that Session.
   * @returns only when the process could not be replaced; a successful
   *   handoff never returns.
   * @throws when the target directory is unreachable or replacement fails.
   */
  resume(sessionId: SessionId, cwd: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** App-shell handoff used by `/resume`; absent when the launcher cannot relaunch. */
    terminalSessionHandoff?: SessionHandoff
  }
}

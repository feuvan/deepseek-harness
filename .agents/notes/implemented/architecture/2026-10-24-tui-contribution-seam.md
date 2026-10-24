# Agent Note: Terminal UI contribution seam

Status: implemented

English | [中文](2026-10-24-tui-contribution-seam.zh.md)

## Problem

The terminal interface was a single closed plugin: plugins could not add a status strip, a slash command, or a dock surface without editing `@deepseek-ai/dsh-tui` itself. The Agent Teams panel was the first consumer that wanted to sit outside the stable terminal package, and future experimental surfaces (jobs, workflows, vendor panels) need the same entry point.

## Decision

`@deepseek-ai/dsh-tui` provides `ctx.terminalUi` (`src/contribution.ts`, `TERMINAL_UI_SERVICE`). A contribution registers a component strip, a slash command with optional argument completion, or a dock component; every registration returns a disposer that unwinds with the plugin. The terminal keeps layout, input routing, focus/cursor ownership, and the one-dock invariant: `openDock` wraps the contribution's close callback so releasing the slot always clears the terminal's own dock state, and interruption closes it the same way as a built-in panel. `registerCommand` rejects duplicate names against local and contributed commands, queues commands registered before the composer exists, and flushes them at startup with working disposers.

The seam intentionally exposes only presentations and text helpers (`setEditorText`, `notice`), not the transcript, composer, or Session internals: a contribution cannot bypass the dock's input ownership or drive an Agent directly.

## Verification

`packages/tui/tui/tests` covers strip ordering and disposal, pre/post-start command registration, duplicate rejection, help/completion, dock input routing and close, editor/notice forwarding, and service provision/disposal. The Team strip and `/team` command are registered through the seam in production and all Team behavior tests still pass.

## Consequences

Plugins can extend the terminal without depending on terminal internals. The API is deliberately narrow; richer surfaces need additional seam methods and a design review. The Team surface has since moved into `@deepseek-ai/dsh-experimental-tui-agent-team`, which installs through the seam; the stable package keeps no Team code.

## Alternatives considered

- **Let plugins import `TerminalApp` internals.** Rejected: it makes every private field a compatibility promise and lets a contribution steal focus or the dock.
- **Move Team into a separate experimental plugin immediately.** Deferred: the seam is the prerequisite and is now testable; moving the already-working panel adds packaging and profile work without changing user behavior.

# Agent Note: Read-only Agent Teams surfaces in the terminal

Status: implemented

English | [中文](2026-10-24-tui-agent-team-surface.zh.md)

## Problem

The experimental Agent Teams bundle shipped tools and a Web Client panel only. Enabling it in a terminal profile added Team tools at the host plane but produced no visible interface: `ui-agent-team` is a Web-only Client plugin, and the bundle's top-level `tool-subagent*` disables do not reach the preset-scoped registrations the terminal profile now mounts. A user could not tell whether teammates were running or what the shared task board contained.

## Decision

A plugin in its own package, `@deepseek-ai/dsh-tui-agent-team`, reads the Lead Session's `agentTeam` projection through the terminal contribution seam and registers a compact strip, a `/team` bottom dock with Members and Tasks tabs, and a read-only teammate transcript. The stable terminal owns the seam and hides the surfaces when the projection is absent; the Team code lives in `packages/tui/agent-team`, mounted by the `dsh-tui-app` bundle. Members open a read-only teammate transcript; Tasks are read-only detail views, and task and message mutations stay in the Team tools and the conversation. The stable TUI package takes no dependency on the Team package: the view mirrors only the fields it renders, so the Agent Teams schema remains the authority.

Agent Teams teammates are subagents, so the projection publishes the saved mode and the task board only. The plugin therefore derives member rows from the root Session's subagent tree: the root's `subagentCatalog` projection paints the cached rows and `ctx.subagents.listDescendants` refines them, unreadable branches stay visible as diagnostic rows, and live running state comes from the Agent registry. Team mode is a saved per-root-Session switch in `/config` → Model & effort; the plugin renders the same strip and dock whether the mode is on or off, and the strip stays hidden while the mode is off unless the projection reports a rejected record.

The strip shows teammate, running, and task counts and names a rejected persisted record; the panel shows member name, running state, and creation description (or the diagnostic reason for an unreadable branch) and task status/owner/blockers/write-scope warnings. Both follow projection changes for the presented Session, and teammate `agent/status` updates repaint the running count. `/team` without the Team service prints that Agent Teams is not composed in this profile, and with Team mode off it names the `/config` → Model & effort switch instead of opening an empty panel.

## Verification

`packages/tui/agent-team/tests` covers the projection reader, derived member rows and diagnostic rows, visibility gate, summary counts, strip and panel rendering in both locales, scrolling and tab keys, live projection and catalog updates, teammate-status repaint, non-blocking discovery with superseded-walk teardown, the unavailable and mode-off paths, help/completion, and copy parity. A manual PTY run in the `tui` profile showed `/team` presenting the derived member tree and the shared task board.

## Consequences

A terminal user can now see delegated work without the browser: teammate transcripts and the shared task board are viewable in the dock, and peer messaging stays in the Team tools and the conversation. Making a teammate the main Session remains a Web and Desktop workflow. The terminal reads the Team service and projection through documented structural faces, so a composition without Agent Teams simply shows no surface. The local structural view must be updated when the `agentTeam` fields the terminal renders change; the minimal subset keeps that maintenance small compared with a stable-package dependency on the Team package or a new TUI extension seam.

## Alternatives considered

- **Depend on the Team package's client types.** Rejected: the TUI typecheck then resolves the package's built declarations, which moved persistence-catalog sources from `src` to `lib` and coupled the stable package to another package's build. The final design instead moved the entire surface into its own package and kept only the structural seam in the stable package.
- **Add a generic TUI panel/strip contribution service and ship the Team UI as an experimental plugin.** Rejected for this increment: it is a new UI architecture, while the terminal already owns the dock and the requested visibility is read-only.
- **Render from Team tool output instead of the projection.** Rejected: tool output is not live and misses task-board changes the Lead never calls a tool for.

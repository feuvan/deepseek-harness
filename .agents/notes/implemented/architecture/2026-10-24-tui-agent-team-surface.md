# Agent Note: Read-only Agent Teams surfaces in the terminal

Status: implemented

English | [中文](2026-10-24-tui-agent-team-surface.zh.md)

## Problem

The experimental Agent Teams bundle shipped tools and a Web Client panel only. Enabling it in a terminal profile added Team tools at the host plane but produced no visible interface: `ui-agent-team` is a Web-only Client plugin, and the bundle's top-level `tool-subagent*` disables do not reach the preset-scoped registrations the terminal profile now mounts. A user could not tell whether teammates were running or what the shared task board contained.

## Decision

The terminal reads the Lead Session's `agentTeam` projection through a local structural view (`src/team.ts`) and renders two built-in surfaces: a compact strip above the composer and a `/team` bottom dock with Members and Tasks tabs. Neither surface is a plugin contribution; the terminal owns them and hides them when the projection is absent. Members open a read-only teammate transcript; Tasks expose claim, complete, and create; `/team task` and `/team message` reach the Team service from the composer. The stable TUI package takes no dependency on the experimental Agent Teams package: the view mirrors only the fields it renders, so the Agent Teams client schema remains the authority.

The strip shows teammate, running, and task counts and names a rejected persisted record; the panel shows member role/phase/error and task status/owner/blockers/write-scope warnings. Both follow projection changes for the presented Session, and teammate `agent/status` updates repaint the running count. `/team` without the bundle prints the enable path (`/config` → Experimental capabilities → restart) instead of opening an empty panel.

## Verification

`packages/tui/tui/tests` covers the projection reader, visibility gate, summary counts, strip and panel rendering in both locales, scrolling and tab keys, live projection updates, teammate-status repaint, the unavailable path, help/completion, and copy parity. A manual PTY run with the bundle enabled in a temporary TUI profile showed `/team` presenting the Lead roster; the enabled bundle still leaves preset-scoped subagent tools in place, which the package README records.

## Consequences

A terminal user can now see and act on delegated work without the browser: teammate transcripts are viewable in the dock, tasks can be created/claimed/completed, and peer messages can be sent. Making a teammate the main Session remains a Web and Desktop workflow. The team bundle additionally suppresses preset-scoped subagent rows, so Team tools replace them instead of being shadowed. The local structural view must be updated when the `agentTeam` fields the terminal renders change; the minimal subset keeps that maintenance small compared with a stable-package dependency on experimental types or a new TUI extension seam.

## Alternatives considered

- **Depend on the experimental package's client types.** Rejected: the TUI typecheck then resolves the package's built declarations, which moved persistence-catalog sources from `src` to `lib` and coupled a stable package to an experimental build.
- **Add a generic TUI panel/strip contribution service and ship the Team UI as an experimental plugin.** Rejected for this increment: it is a new UI architecture, while the terminal already owns the dock and the requested visibility is read-only.
- **Render from Team tool output instead of the projection.** Rejected: tool output is not live and misses roster/task changes the Lead never calls a tool for.

---
description: "Terminal Agent Teams surface: a compact strip, the read-only /team member and shared-task dock, and teammate transcripts over the terminal contribution seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-tui-agent-team

English | [中文](README.zh.md)

## Summary

This package provides the Agent Teams interface for `dsh tui`. It registers through the terminal's `ctx.terminalUi` contribution seam: a compact strip above the composer, a `/team` command, and a read-only Members / Shared tasks dock with teammate transcripts. The terminal app composes it; the base composition supplies the Team service and tools, and Team mode is a saved per-Session switch. The plugin is inert in compositions that have no terminal contribution seam, so other surfaces mount their own Team interfaces.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Team mode is off for a new Session. Turn on Use Agent Teams for the root Session in `/config` → Model & effort; the saved selection survives restart. Once Team mode is on and the Session has teammates or shared tasks, the strip appears above the composer, and `/team` opens the dock. With Team mode off, `/team` reports that the mode is off for the Session instead of opening the dock.

The dock mirrors the native panel as a read-only view: counted Members and Shared tasks sections. Members are derived from the root Session's subagent tree, so each row shows the teammate's path/name, running/inactive state, and creation description; Enter opens its read-only transcript. Shared tasks show status, readiness, owner, blockers, write scopes, and warnings; Enter expands a task's full description and metadata. Tab or ←/→ switch sections; ↑/↓ and PgUp/PgDn move. Esc returns from a transcript or task detail and closes the dock. The panel has no spawn/message/claim/complete/edit controls; those stay in the Team tools and the conversation. The teammate transcript is a viewer, not a driven conversation.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/index.ts` optionally injects `terminalUi` and installs a `TeamController`. The controller reads the Lead Session's `agentTeam` projection and the direct-child `subagentCatalog` seed through `ctx.sessionProjections`, refines member rows asynchronously with `ctx.subagents.listDescendants`, reads live turn state through `ctx.agents`, and reads teammate history through `ctx.sessionQuery`. Presentation lives in `src/components/`: the strip, the member/task panel, and the transcript viewer; `src/copy.ts` owns English and Chinese copy selected from the seam's resolved locale. All registrations and subscriptions are Cordis effects and unwind on disposal.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Optional seam injection and effect lifetime |
| [`src/controller.ts`](src/controller.ts) | Projection, member cache, command, dock, and read-only transcript/task viewing |
| [`src/team.ts`](src/team.ts) | Read-only projection and derived teammate rows with counts |
| [`src/components/`](src/components/) | Strip, member/task panel, transcript viewer |
| [`src/copy.ts`](src/copy.ts) | English and Chinese copy |
| [`src/types.ts`](src/types.ts) | Structural seam and palette contracts |

</details>

-----

## Model Experience

None, as the terminal surface only presents the Agent Teams projection and service without registering model-facing input.

#### KV Cache effect

No direct effect; the Team tools and ordinary conversation submission own any later model-visible use.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Derived members** — rows come from the root Session's subagent tree; a branch whose catalog cannot be read stays listed as a diagnostic row, and an external child without a local Session has no transcript.
- **Read-only panel** — the dock shows members and the shared task board but does not mutate either; spawn/message/task changes stay in the Team tools and conversation.
- **Read-only transcript** — teammate history is scrolled in the dock but not driven.
- **Dock-scoped** — a teammate cannot become the terminal's main Session.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

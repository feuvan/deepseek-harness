---
description: "Terminal Agent Teams surface: a compact strip, the /team roster and task dock, teammate transcripts, and task/message actions over the terminal contribution seam."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tui-agent-team

English | [中文](README.zh.md)

## Summary

This package provides the Agent Teams interface for `dsh tui`. It registers through the terminal's `ctx.terminalUi` contribution seam: a compact strip above the composer, a `/team` command, the Members/Tasks dock, read-only teammate transcripts, and task/message actions. It is shipped by [`@deepseek-ai/dsh-experimental-agent-team-profile`](../agent-team-profile/README.md), which also supplies the Team service and tools; enabling that bundle is the supported way to use it.

The plugin is inert in compositions that have no terminal contribution seam, so the same bundle can be composed for Web and Desktop.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Enable [`@deepseek-ai/dsh-experimental-agent-team-profile`](../agent-team-profile/README.md) in the `tui` profile from `/config` → Experimental capabilities (or `dsh plugin --profile tui add ...`), then restart the terminal. The strip appears while the Lead Session has teammates or shared tasks; `/team` opens the dock.

The dock opens with a readiness line (`Ready`/`Degraded` plus member/task/in-progress counts), counted tabs, column headers, and a footer that lists only actions available for the selected row. Tab or ←/→ switch Members/Tasks; ↑/↓ and PgUp/PgDn move; Members: Enter opens the read-only transcript, `m` pre-fills `/team message <name> `; Tasks: `a` claims a ready unowned task, `c` completes an in-progress task; `n` pre-fills a new task; Esc closes. Disabled actions explain why in the panel rather than failing silently. `/team task <subject>` and `/team message <member> <text>` work from the composer. The teammate transcript is a viewer: prompts are sent through `/team message`, not by typing into the transcript.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/index.ts` optionally injects `terminalUi` and installs a `TeamController`. The controller reads the Lead Session's `agentTeam` projection through `ctx.sessionProjections`, the teammate history through `ctx.sessionQuery`, running teardown through `ctx.agents`, and task/message actions through the composed `ctx.agentTeams` service. Presentation lives in `src/components/`: the strip, the roster/task panel, and the transcript viewer; `src/copy.ts` owns English and Chinese copy selected from the seam's resolved locale. All registrations are Cordis effects and unwind on disposal.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Optional seam injection and effect lifetime |
| [`src/controller.ts`](src/controller.ts) | Projection, command, dock, transcript, and task actions |
| [`src/components/`](src/components/) | Strip, roster/task panel, transcript viewer |
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

- **Read-only transcript** — teammate history is scrolled in the dock but not driven; prompts go through `/team message`.
- **Dock-scoped** — a teammate cannot become the terminal's main Session.
- **Task actions** — claim, complete, and create only; reassign/edit/delete remain model-tool and Web workflows.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

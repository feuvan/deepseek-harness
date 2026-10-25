---
description: "The full-screen terminal front door: a Cordis plugin that renders the durable Session log, streams live output, presents tool results, and answers human interactions in the current terminal."
kind: "package-reference"
---

# @deepseek-ai/dsh-tui

English | [中文](README.zh.md)

## Summary

`dsh-tui` presents one live root Agent in the current terminal. It replays the transcript, follows live assistant frames, renders tools through `presentCall`/`presentResult`, highlights fenced code, completes `/` commands and `@` mentions, attaches image mentions or clipboard images, and answers `ask_user_question` and approvals. It interrupts with Esc, queues input for the next turn, shows pending input and terminal activity, and switches between English and Chinese copy. It owns terminal input and presentation only: no Agent, no model-facing capability, and no Session write.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in a profile whose composition already creates the root Agent. The shipped [`@deepseek-ai/dsh-tui-app`](../../bundle/tui-app/README.md) bundle does both; a deployment that composes its own tree supplies the same two rows.

```yaml
- name: '@deepseek-ai/dsh-tui'
  config:
    sessionId: '<exact Session identity of the presented Agent>'
```

| Field | Default | Meaning |
|---|---|---|
| `sessionId` | required | Exact Session identity of the live root Agent this terminal presents |
| `color` | `true` | Emit ANSI styling; `false` renders unstyled text |
| `animation` | `true` | Advance the running footer clock once per second |
| `previewLines` | `10` | Body lines shown for a collapsed tool card |
| `windowBlocks` | `200` | Maximum transcript blocks kept rendered |
| `title` | `DeepSeek Harness` | Terminal title suffix; the Session title is shown before it |
| `locale` | `auto` | Interface language: `en`, `zh`, or `auto` to follow `DSH_LOCALE`, `LC_ALL`, `LC_MESSAGES`, then `LANG` |
| `busyEnter` | `queue` | Plain Enter while the Agent runs: `queue` for the next turn or `steer` into the running turn; Ctrl+Enter applies the opposite |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tui) is the exhaustive source for every accepted field and its JSDoc.

The terminal is claimed only when stdin and stdout are both TTYs. A piped launch fails before the screen is entered and names the one-shot alternative, `dsh --profile headless "<task>"`.

### Interaction surface

When the composition mounts the experimental Agent Teams bundle, its `@deepseek-ai/dsh-experimental-tui-agent-team` plugin contributes a dim Team strip above the composer via the seam, shows teammate and shared-task counts, and `/team` opens a dock with Members and Tasks tabs (Tab/←/→ switch, ↑/↓ and PgUp/PgDn move, Esc closes). It reads the Lead Session's `agentTeam` projection. Members: Enter opens the teammate's read-only transcript, `m` pre-fills a message command, `n` pre-fills a task command. Tasks: `a` claim, `c` complete, `n` create. `/team task <subject>` and `/team message <member> <text>` work from the composer. A profile without the bundle has neither the strip nor the panel, and `/team` explains how to enable it. Enter sends an idle prompt and queues it for the next turn while the Agent runs; Ctrl+Enter applies the opposite delivery, and with an empty composer it steers every queued message. `/queue <text>` queues explicitly, `/queue` opens the queue dock (↑/↓, Enter steer, `e` edit in the composer, `x` remove, Esc close), and `/steer <text>` steers directly. Esc interrupts a running turn when the composer is empty, Ctrl+C closes the active panel, cancels a running turn, or exits when idle. Ctrl+O cycles collapsed, expanded, and hidden tool cards; Ctrl+R toggles reasoning; Ctrl+L repaints; Ctrl+V attaches an image from the host clipboard; Shift+Tab advances the current model's reasoning effort. PgUp/PgDn scroll and page older history in at the top, the mouse wheel scrolls (the renderer disables xterm alternate-scroll mode while mouse capture is active, so iTerm2 does not turn wheel events into arrow keys), Ctrl+Home loads the full history, Ctrl+End jumps to the newest output, Esc returns to the bottom when scrolled, drag-select copies through OSC 52, and Ctrl+Shift+F opens the transcript search. A dim strip above the composer shows steering and queued messages until the Agent consumes them, and the terminal reports working/blocked/idle through OSC 9;4 and OSC 7501.

Registered commands (`/compact`, `/goal`, `/plan`, `/permission`, `/skill:...`) dispatch through `ctx.commands` and render their recorded outcome; terminal-only controls (`/help`, `/status`, `/model`, `/preset`, `/team`, `/effort`, `/permission`, `/queue`, `/steer`, `/config`, `/clear`, `/reasoning`, `/cards`, `/redraw`, `/exit`, `/quit`) are handled by the terminal itself.

Typing `/` or `@` opens a completion dock below the composer with each command's description or file kind; Up/Down move, Tab inserts, Enter runs an accepted command (or inserts a mention or argument), Esc closes. Prose and bare paths never open completion — a space does not list the workspace, and local files are referenced explicitly with `@` — and the editor's old inline dropdown is gone. Command arguments complete too: `/effort ` offers the current model's advertised levels, and `/permission ` offers the composed permission presets with their descriptions. `/effort` without an argument opens a titled chooser over the same levels; `/effort <level>` applies one directly, and the chosen (or adapter-default) level appears in the footer immediately after the model name. Bare `/permission` opens a bottom-dock chooser that lists every composed permission preset with its description and marks the current value; choosing one dispatches it through the registered command, and `/permission <preset>` dispatches directly. Bare `/effort` uses the same dock. An accepted `@` mention stays literal prompt text except when it names a supported image file: the image is read from the workspace, admitted by the attachment store, and attached to the outgoing user message. Any admission failure becomes a transcript notice while the text is still sent. Shift+Tab cycles the effort levels the adapter advertises for the current model and records the choice in the Session log through the same model selection the selector uses; the footer always shows the effective level, including a default the user never chose explicitly. A question tagged `plan-review` renders as a dedicated review: framed plan document, approve/decline verdict marks, and no free-text answer row.

A plugin extension seam (`ctx.terminalUi`, `src/contribution.ts`) lets plugins add strips, commands, and one dock component without importing the application internals; each registration is an effect and its disposer unwinds with the plugin. Every panel renders in the bottom dock — help/status, the model selector, questions, approvals, the choosers, and `/config`; no floating overlay exists, long pages scroll, and Esc closes the panel. `/config` opens a bottom-dock configuration panel with one tab per category (Model & effort, Permissions, Experimental capabilities, Terminal display); Tab/Left/Right switch tabs, Up/Down and PageUp/PageDown scroll the tab body, Enter activates, Esc closes. It reads the live services: model and effort, the session permission preset, the shipped optional bundles (toggles write through the plugin manager and report that they take effect after a restart), and the profile-owned terminal display values, which stay read-only with their owning layer named. Interface copy ships in English and Chinese. `locale` selects one explicitly; `auto` follows the launch environment. The status footer, panels, notices, help, and diagnostics all read the active dictionary.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin waits for the complete application (`ctx.get('loader')?.await()`), resolves the live Agent with the configured identity, installs one model selection on that Agent's scope, and only then starts the renderer. History is read through `ctx.sessionQuery.observeSession()` after subscribing to `session/event`, so the live tail and the replayed prefix splice by sequence number. The terminal never calls the deprecated synchronous Session readers.

Durable events fold into ordered blocks: user messages, settled assistant content, tool cards, command outcomes, compaction markers, and turn-end notices. Live `agent/assistant-stream` frames update one pending block per attempt; the durable settlement for the same step replaces it, so a committed message is rendered exactly once. Tool cards run `ctx.tools.get(name, agent)?.presentCall/presentResult` with the parsed call arguments and the recorded result content plus `meta`; a missing or throwing presenter falls back to the generic card and the raw content.

Questions and approvals are answerers on their Agent-scoped waterfalls. Every panel is presented in the one bottom dock through a serialized queue, so no floating overlay exists and only one surface owns input; a question that carries a timed wait claims it through `ctx.userQuestions.attachWait` and shows the remaining time. Cancellation settles the waterfall instead of leaving the tool waiting.

The palette is one table of standard 16-color SGR pairs; `color: false` returns every string unchanged. `displayText()` escapes every C0 and C1 control except line feeds before any model, tool, or diagnostic text reaches the renderer or the terminal title.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: configuration, TTY proof, application lifecycle |
| [`src/lifecycle.ts`](src/lifecycle.ts) | Agent wait, model selection, history replay, layout, input, exit |
| [`src/transcript.ts`](src/transcript.ts) | Durable fold and live assistant frames into ordered blocks |
| [`src/components/`](src/components) | Banner, footer, composer, transcript blocks, dialogs |
| [`src/interactions.ts`](src/interactions.ts) | Question and approval answerers presented in the bottom dock |
| [`src/commands.ts`](src/commands.ts) | Composer submission, terminal-local commands, command catalog |
| [`src/model-selector.ts`](src/model-selector.ts) | Advisory model catalog and selector |
| [`src/status.ts`](src/status.ts) | Footer values from Session projections |
| [`src/autocomplete.ts`](src/autocomplete.ts) | `/` command and `@` mention completion |
| [`src/mentions.ts`](src/mentions.ts) | Image mention expansion and attachment admission |
| [`src/highlight.ts`](src/highlight.ts) | Fenced-code highlighting over the standard palette |
| [`src/clipboard.ts`](src/clipboard.ts) | Clipboard image reading and media-type detection |
| [`src/locale.ts`](src/locale.ts) | Interface-locale resolution |
| [`src/components/pending.ts`](src/components/pending.ts) | Pending steering and queued-input strip |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Terminal front door subsystem](../../../docs/subsystems/tui.md) — configuration, lifecycle, transcript, and interaction contracts.
- [Session projection](../../session/session-projection/README.md) — the projection values the footer reads.
- [User questions](../../interaction/user-questions/README.md) and [approval](../../interaction/user-approval/README.md) — the seams the panels answer.

-----

<a id="model-experience"></a>
## Model Experience

None, as the plugin presents existing Sessions and registers no prompt, tool, schema, or Session event; the shipped bundle composes the file-reference provider, whose `@` guidance section that package owns.

#### KV Cache effect

No direct effect; the composed model route and prompt owner decide every request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Agent Teams view is terminal-local.** The teammate transcript is read-only (no prompt driving), and task actions are limited to claim/complete/create. Opening a teammate as the main Session remains a Web/Desktop workflow. The bundle now suppresses the preset-scoped subagent rows, so Team tools replace them.
- **Presets come from the bundle.** The terminal itself only reads and switches the composed preset registry; the shipped `@deepseek-ai/dsh-tui-app` bundle declares the four built-in presets and defaults to `standard`.
- **No clipboard image paste and no inline image rendering.** Images are attached by naming them with an `@` mention; an attached or received image block renders as a labeled placeholder rather than pixels. PTC mode is not selected by the shipped bundle.
- **No session picker.** Resume takes an exact `--resume <id>`; there is no in-terminal browser of stored Sessions.
- **Contribution seam, one dock.** A plugin can register compact strips and slash commands and open one bottom-dock component through `ctx.terminalUi`; the terminal still owns layout, input routing, and the single-dock ownership (questions, approvals, `/config`, and the other built-ins use the same slot).
- **Transcript history pages in.** `windowBlocks` bounds the blocks attached to the scroll view; reaching the top with PgUp, the mouse wheel, or Ctrl+Home reloads archived blocks above the current viewport instead of dropping them.
- **Reasoning visibility has four levels.** `compact`, `standard`, `detailed`, and `verbose` mirror the Desktop work-details modes and control how many lines of each reasoning block render; Ctrl+R or `/reasoning [level]` changes the level and the footer shows it. Other transcript-detail differences of the Desktop modes (process grouping, collapse timing) have no terminal equivalent.
- **Two interface languages.** English and Chinese ship in the terminal; other languages fall back to English until a dictionary is added.
- **Windows is unverified by the shipped acceptance lane.** The renderer uses pi-tui's process terminal, but the PTY acceptance runs on POSIX hosts.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The historical `@deepseek-ai/dsh-tui` package was deleted in August 2026 with the implicit bare-`dsh` entry point. This implementation starts from the current host contract instead: the composed profile supplies the Agent, the shared services own interaction state, and the terminal owns only presentation and input. The reintroduction decision and its verification are recorded in the [terminal front door note](../../../.agents/notes/implemented/architecture/2026-10-23-terminal-tui-front-door.md).

</details>

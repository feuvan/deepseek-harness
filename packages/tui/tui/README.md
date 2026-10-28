---
description: "The terminal front door: a Cordis plugin that renders the durable Session log, streams live output, presents tool results, and answers human interactions in the current terminal, inline by default and fullscreen on request."
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
| `screen` | `inline` | Renderer: `inline` keeps history in the terminal scrollback with no mouse capture; `fullscreen` uses the alternate screen with app-owned scrolling |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tui) is the exhaustive source for every accepted field and its JSDoc.

The terminal is claimed only when stdin and stdout are both TTYs. A piped launch fails before the screen is entered and names the one-shot alternative, `dsh --profile headless "<task>"`. While the screen is owned, direct writes to standard error, such as provider model-listing diagnostics, become dim transcript notices instead of overwriting the composer.

### Screen modes

`screen: inline` (default) renders the interface into the terminal's normal screen and scrollback: the first frame is bottom-anchored, later transcript output grows downward, and the terminal owns wheel scrolling, scrollback, and text selection because the application requests no mouse capture. `screen: fullscreen` uses the alternate screen with an app-owned scroll view, mouse capture, older-history paging, the back-to-bottom indicator, and transcript search. Set the mode in the profile's `cordis.yml`/patch (`config.screen`); HMR remounts the terminal surface, and `/terminal` reports the active mode.

### First-run setup

When the profile has neither a usable API-key credential nor a stored account route, the terminal opens a full-screen setup flow above the normal interface. It offers **Sign in with DeepSeek** through the system browser, **Use an API key**, or **Skip for now**. Account sign-in reuses the Desktop/Web account provider and starts a loopback-only OAuth callback server for the duration of the attempt; it stores the resulting grant in the shared credential store. API-key entry is masked, stores the key through `credentials.set` rather than in the profile patch, and then lists the discovered routes so the chosen model becomes the Session selection and the default for later Sessions. Setup never appears when a model route is already usable or when the composition has no credential/account seam, and `/login` reopens it later.

### Account and quota

`/account` opens an interactive dock for the DeepSeek account: sign-in state, profile identity, recharge and bonus wallets, usage/top-up links, refresh, re-login, and confirmed sign-out. Profile and wallet commands have a 15-second terminal deadline; a failure of one section keeps the other section visible, and retry is available from the same dock. Signing out clears the shared credential and never touches the Desktop `desktop` profile.

### Interaction surface

When the composition mounts the experimental Agent Teams bundle, its `@deepseek-ai/dsh-experimental-tui-agent-team` plugin contributes a dim Team strip above the composer via the seam, shows teammate and shared-task counts, and `/team` opens a read-only dock with Members and Shared tasks sections (Tab/←/→ switch, ↑/↓ and PgUp/PgDn move, Esc closes). It reads the Lead Session's `agentTeam` projection and shows the same roster/task facts as the native Agent Teams panel: member running/inactive/provisioning/failed state, model, current-chat tag, task status/readiness, owner, blockers, write scopes, and warnings. Enter opens the selected teammate's transcript or expands the selected task's full description; task and roster mutations stay in the Team tools and the conversation. A profile without the bundle has neither the strip nor the panel, and `/team` explains how to enable it. Enter sends an idle prompt and queues it for the next turn while the Agent runs; Ctrl+Enter applies the opposite delivery, and with an empty composer it steers every queued message. `/queue <text>` queues explicitly, `/queue` opens the queue dock (↑/↓, Enter steer, `e` edit in the composer, `x` remove, Esc close), and `/steer <text>` steers directly. Esc interrupts a running turn when the composer is empty, Ctrl+C closes the active panel, cancels a running turn, or exits when idle. Ctrl+O cycles collapsed, expanded, and hidden tool cards; Ctrl+R toggles reasoning; Ctrl+L repaints; Ctrl+V attaches an image from the host clipboard; Shift+Tab advances the current model's reasoning effort. In the default `inline` mode, history is written to the terminal's normal scrollback: the terminal's own wheel, scrollbar, and PgUp/PgDn handle it, text selection is native, and the application enables no mouse capture. In `fullscreen` mode, PgUp/PgDn page older history in at the top, the mouse wheel scrolls inside the alternate screen (alternate-scroll mode stays off so iTerm2 cannot turn wheel events into arrow keys), Ctrl+Home loads the full history, Ctrl+End jumps to the newest output, Esc returns to the bottom when scrolled, and Ctrl+Shift+F opens the transcript search. In both modes drag-select copies through OSC 52 where the terminal supports it. A dim strip above the composer shows steering and queued messages until the Agent consumes them, and the terminal reports working/blocked/idle through OSC 9;4 and OSC 7501.

Registered commands (`/compact`, `/goal`, `/plan`, `/permission`, `/skill:...`) dispatch through `ctx.commands` and render their recorded outcome; terminal-only controls (`/help`, `/status`, `/model`, `/preset`, `/team`, `/effort`, `/permission`, `/queue`, `/steer`, `/config`, `/login`, `/account`, `/terminal`, `/clear`, `/reasoning`, `/cards`, `/redraw`, `/exit`, `/quit`) are handled by the terminal itself.

Typing `/` or `@` opens a completion dock below the composer with each command's description or file kind; Up/Down move, Tab inserts, Enter runs an accepted command (or inserts a mention or argument), Esc closes. Prose and bare paths never open completion — a space does not list the workspace, and local files are referenced explicitly with `@` — and the editor's old inline dropdown is gone. Command arguments complete too: `/effort ` offers the current model's advertised levels, and `/permission ` offers the composed permission presets with their descriptions. `/effort` without an argument opens a titled chooser over the same levels; `/effort <level>` applies one directly, and the chosen (or adapter-default) level appears in the footer immediately after the model name. Bare `/permission` opens a bottom-dock chooser that lists every composed permission preset with its description and marks the current value; choosing one dispatches it through the registered command, and `/permission <preset>` dispatches directly. Bare `/effort` uses the same dock. An accepted `@` mention stays literal prompt text except when it names a supported image file: the image is read from the workspace, admitted by the attachment store, and attached to the outgoing user message. Any admission failure becomes a transcript notice while the text is still sent. Shift+Tab cycles the effort levels the adapter advertises for the current model and records the choice in the Session log through the same model selection the selector uses; the footer always shows the effective level, including a default the user never chose explicitly. A question tagged `plan-review` renders as a dedicated review: framed plan document, approve/decline verdict marks, and no free-text answer row.

`/terminal` opens a diagnostic panel with the emulator, TERM, multiplexer/SSH state, renderer mode, keyboard protocol, focus, transcript stats, and received wheel events; use it to distinguish terminal-side wheel handling from application-side capture. In inline mode, wheel events are expected to stay in the terminal scrollback and the panel reports zero captured events.

A plugin extension seam (`ctx.terminalUi`, `src/contribution.ts`) lets plugins add strips, commands, and one dock component without importing the application internals; each registration is an effect and its disposer unwinds with the plugin. Every panel renders in the bottom dock — help/status, the model selector, questions, approvals, the choosers, and `/config`; no floating overlay exists, long pages scroll, and Esc closes the panel. `/config` opens a structured bottom-dock configuration panel: a title and "Changes save automatically" subtitle, a readiness line (`Ready`, `Degraded`, or `Read only` with action/read-only counts), tabs per category (Model & effort, Permissions, Experimental capabilities, Terminal display), and three-column rows with label, value, and description. Tab/Left/Right switch tabs, Up/Down and PageUp/PageDown move, Enter activates, `/` starts a filter (typing narrows the rows, Esc clears it), and Esc closes. The footer shows only the actions available for the selected row; activating a read-only row explains why it cannot change. The selected row is highlighted across the full width. It reads the live services: model and effort, the session permission preset, the shipped optional bundles (On/Off toggles update immediately, show a `saving` marker while the write is in flight, apply through HMR when the profile supports it, and revert with an error notice when the write fails), and the terminal display values, which edit the profile's volatile `terminal-ui` fields through the settings service and apply live (booleans toggle, locale and busy-Enter cycle, line budgets and title use an inline prompt); `screen` stays read-only because changing the renderer mode remounts the terminal surface. Interface copy ships in English and Chinese. `locale` selects one explicitly; `auto` follows the launch environment. The status footer, panels, notices, help, and diagnostics all read the active dictionary.

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
| [`src/lifecycle.ts`](src/lifecycle.ts) | Agent wait, model selection, history replay, first-run setup, layout, input, exit |
| [`src/account-login.ts`](src/account-login.ts) | Browser account sign-in with a temporary loopback callback server |
| [`src/components/onboarding.ts`](src/components/onboarding.ts) | Full-screen account/API-key/model setup panel |
| [`src/components/account.ts`](src/components/account.ts) | `/account` identity, wallet, re-login, and sign-out dock |
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

- **Agent Teams view is read-only, like the native panel.** The teammate transcript is a viewer and the task board has no mutation controls; creating/updating tasks and messaging stay in the Team tools and the conversation. Opening a teammate as the main Session remains a Web/Desktop workflow. The bundle suppresses the preset-scoped subagent rows, so Team tools replace them.
- **Presets come from the bundle.** The terminal itself only reads and switches the composed preset registry; the shipped `@deepseek-ai/dsh-tui-app` bundle declares the four built-in presets and defaults to `standard`.
- **No clipboard image paste and no inline image rendering.** Images are attached by naming them with an `@` mention; an attached or received image block renders as a labeled placeholder rather than pixels. PTC mode is not selected by the shipped bundle.
- **No session picker.** Resume takes an exact `--resume <id>`; there is no in-terminal browser of stored Sessions.
- **Contribution seam, one dock.** A plugin can register compact strips and slash commands and open one bottom-dock component through `ctx.terminalUi`; the terminal still owns layout, input routing, and the single-dock ownership (questions, approvals, `/config`, and the other built-ins use the same slot).
- **Inline is the default renderer.** History lives in the terminal scrollback and the terminal owns wheel scrolling and selection; app-side paging keys, the back-to-bottom indicator, and transcript search apply to `fullscreen` mode only.
- **Fullscreen transcript history pages in.** `windowBlocks` bounds the blocks attached to the scroll view; reaching the top with PgUp, the mouse wheel, or Ctrl+Home reloads archived blocks above the current viewport instead of dropping them.
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

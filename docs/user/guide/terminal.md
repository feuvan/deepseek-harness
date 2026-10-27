# Use the terminal interface

English | [中文](terminal.zh.md)

`dsh tui` runs the agent in the terminal you are already in. It uses the same model, tools, sessions, permissions, and approval policy as the Web UI, and it keeps working when no browser or server is involved.


By default the transcript grows in the terminal's normal scrollback: the terminal's own wheel, scrollbar, and selection work, and the app requests no mouse capture. Set `screen: fullscreen` in the TUI profile to switch to an alternate-screen interface with an app-owned scroll view and transcript search. `/terminal` shows which renderer is active.
## Start it

Run the command from the directory you want the agent to work in:

```sh
dsh tui
```

The terminal must be interactive: stdin and stdout both have to be a terminal. A piped or redirected launch stops before the screen changes and prints how to run the same task without interaction:

```sh
dsh --profile headless "run the tests"
```

The first launch initializes the `tui` profile under your Harness home, exactly like the other named profiles.

### Model credentials

The terminal uses the composed `dsh-base` credential chain: the launch environment, then `.env` in the directory you started from, then `.env` under the Harness home. A key or sign-in saved from the Web UI is stored in the managed credential store, which the base composition also reads, so an already configured model usually works unchanged.

## What you see

The banner names the model and the Session. The transcript above the composer shows your prompts, streamed responses, tool cards, command results, and notices. The composer starts with `dsh>`. The footer shows the working directory, model and reasoning effort, token totals, context use, the permission preset, and whether the agent is idle or running.

### Keys

| Key | Action |
|---|---|
| Enter | Send a prompt; while a turn runs, queue it for the next turn |
| Ctrl+Enter | Steer while a turn runs (queues when busy Enter is set to steer); with an empty composer, steer every queued message |
| Alt+Enter or Ctrl+J | Insert a newline |
| Ctrl+C | Close the open panel, cancel a running turn, or exit when idle |
| Ctrl+O | Cycle tool-card visibility (collapsed → expanded → hidden) |
| Ctrl+R | Cycle reasoning visibility (compact → standard → detailed → verbose) |
| Ctrl+L | Repaint the screen |
| Esc | Interrupt a running turn when the composer is empty; in `fullscreen` mode also return to the transcript bottom when scrolled |
| Ctrl+V | Attach an image from the clipboard |
| Shift+Tab | Advance the current model's reasoning effort |
| PgUp / PgDn | Scroll the terminal scrollback in `inline` mode; page app-owned history in `fullscreen` mode |
| Mouse wheel / drag | Native terminal scrolling and selection in `inline` mode; app-owned scrolling in `fullscreen` mode |
| Ctrl+Home / Ctrl+End | `fullscreen` mode: load the full app history / jump to the newest output |
| Ctrl+Shift+F | `fullscreen` mode: search the rendered transcript |

Completion appears as you type, but only where it is meaningful: prose and bare paths never open it (a space does not list the workspace). Typing `/` lists commands with their descriptions; typing `@` completes files and directories from the workspace, including paths with spaces through the quoted `@"..."` form. `Tab` accepts the highlighted entry.

### Steering and the queue

Busy-Enter matches Desktop's default: plain Enter queues the prompt for the next turn instead of interrupting the current one, and `/queue <text>` does the same explicitly. `Ctrl+Enter` applies the opposite delivery: it steers the prompt into the running turn, and with an empty composer it steers every queued message. The `busyEnter` field of the `terminal-ui` row flips the two plain-Enter behaviours (`queue` or `steer`); `/config` shows the resolved value.

`/queue` without text opens the queue below the composer. ↑/↓ moves, Enter steers the selected message, `e` moves its text back into the composer for editing, `x` removes it, and Esc closes. `/steer <text>` steers one prompt into the running turn, or queues it as the next turn when the Agent is idle. The strip above the composer keeps showing how many messages are steering and queued.

### Mentions, images, and highlighting

An accepted `@` mention is ordinary prompt text: the model reads the referenced file with its tools. When the mention names an image (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`), the terminal also attaches that image to the message, provided the selected model accepts image input; otherwise it shows a notice and sends the text. Read and admission failures are notices, not lost prompts.

Fenced code in responses and plan reviews is syntax-highlighted in the terminal's colors. Very long plan documents are capped in the review panel so the options stay reachable.

A question tagged as a plan review renders its own panel: the plan document is framed, the approving option carries a check mark, declining options carry cross marks, and there is no free-text answer row.

### Reasoning effort

`Shift+Tab` cycles the effort levels the current model advertises and reports the new level in the transcript. The same choice can be made inside `/model` while selecting among models; both record the selection in the Session log.

### Commands

Terminal-only controls: `/help`, `/status`, `/model`, `/preset`, `/effort`, `/permission`, `/queue`, `/config`, `/terminal`, `/clear`, `/reasoning`, `/cards`, `/redraw`, `/exit`, `/quit`. `/terminal` reports the renderer, terminal environment, focus, transcript size, and received wheel events.

Registered agent commands also work from the composer, including `/compact`, `/goal`, `/plan`, `/permission`, and skill invocations. Their recorded outcome appears in the transcript like any other command.

`/model` opens the model list. Type to filter; `Shift+Tab` cycles the highlighted model's reasoning effort; Enter selects it for this session only. The switch is recorded in the Session log for later readers. Use `Shift+Tab` in the composer to change effort without opening the list.

`/effort` opens a bottom-dock chooser over the current model's levels, and `/effort high` (or any advertised level) applies one directly. `/permission` without an argument opens the same kind of list, showing every available permission preset with its description and marking the current one; `/permission <preset>` switches directly. Both go through the registered command, so the Session log records the switch. The footer always shows the effective level right after the model name, including the adapter default you never chose explicitly.

### Command arguments

Every panel opens in the dock below the composer: `/help`, `/status`, `/model`, `/config`, questions, approvals, and the choosers. Long pages such as `/help` scroll with ↑/↓ or PgUp/PgDn, and Esc closes the panel. While a panel owns the dock, keys go to it: they neither scroll the transcript nor edit the composer behind it.

Command arguments complete: type `/effort ` and press Tab to pick from the model's levels, or type `/permission ` and press Tab to pick from the composed permission presets, each with its description. The footer reflects a permission switch after the command completes.

### Pending input and interruption

While a turn runs, Enter steers it at the next step boundary. A dim strip above the composer shows how many steering and queued messages the Agent has accepted but not consumed yet. `/queue <text>` queues a message for the next turn instead of steering; it expands `@` mentions like a normal prompt. With the composer empty, Esc cancels the running turn; with text present, Esc stays in the editor, and while a panel is open it closes the panel.

### Clipboard images

Ctrl+V attaches an image from your system clipboard to the next prompt, provided the selected model accepts image input; otherwise the terminal explains why the image was not attached. Clipboard images and `@` image mentions can be combined in one prompt, and the attachment is cleared after the prompt is sent. Inline image rendering is still not implemented, so attached images appear as labeled placeholders in the transcript.

### Reasoning visibility

Reasoning blocks render at one of four visibility levels, matching the Desktop work-details modes: `compact` (a one-line preview), `standard` (a short preview), `detailed` (a longer preview), and `verbose` (the complete block). Ctrl+R cycles the levels, `/reasoning <level>` sets one directly (the localized names work too), and the footer shows the active level after the model and effort.

### Tool cards

Tool-card bodies render in one of three visibility modes: `collapsed` (a preview bounded by `previewLines`), `expanded` (the complete body), and `hidden` (no tool cards). Ctrl+O or `/cards` cycles the modes, `/cards <mode>` sets one directly (the localized names work too), and Tab completes the mode argument. Every change prints a `Tool cards: <mode>` notice, `/status` shows the active mode, and the Terminal display tab of `/config` cycles it through the same action.

### Configuration

`/config` opens a structured configuration dock below the composer with a title/subtitle, a readiness line (`Ready`, `Degraded`, or `Read only`), one tab per category, and label/value/description rows; Tab or Left/Right switches tabs, Up/Down and PgUp/PgDn move, Enter opens or toggles (read-only rows explain why), `/` starts a filter (Esc clears it), and Esc closes. The footer lists only actions available for the selected row. The selected row is highlighted across the full width; closing the dock redraws the terminal so the composer returns to the bottom. It shows the settings grouped by scope. Model and reasoning effort open the same selector and chooser as `/model` and `/effort`. The permission section switches the current session's preset. Experimental capabilities list the optional bundles this installation ships; On/Off toggles flip immediately, show a `saving` marker while the plugin manager writes, apply through HMR when the profile supports it, and revert with an error notice when the write fails. Terminal display values are editable: styling and animation toggle, language and busy-Enter cycle, and card lines, transcript window, and title use an inline prompt. Writes persist to the profile's volatile `terminal-ui` fields and apply to the running terminal; `screen` remains read-only because changing the renderer mode remounts the terminal surface.

### Interface language

The terminal ships English and Chinese copy. Set `locale` on the `terminal-ui` row to `en` or `zh`, or leave it `auto` to follow `DSH_LOCALE`, `LC_ALL`, `LC_MESSAGES`, then `LANG`. Every panel, notice, help line, and status label follows the selected language; other languages fall back to English.

## Agent presets

The terminal composes the same four built-in agent presets as Desktop and Web: `standard` (the default), `ptc`, `minimal`, and `cordis`. A fresh launch runs under `standard`; add `--preset <id>` to start under another one:

```sh
dsh tui --preset ptc
```

`/preset` lists the four with one-line descriptions and marks the current one. Choosing a preset before the first turn recomposes that Session and records `agent-preset/selected`; after the first turn the composition is fixed and `/preset` reports that it is locked. `/status` shows the current preset. Sessions created in Desktop or Web under any of these presets resume here, and Sessions created here resume there.

## Agent Teams

Enable the experimental Agent Teams bundle from `/config` → Experimental capabilities (or `dsh plugin --profile tui add @deepseek-ai/dsh-experimental-agent-team-profile`); HMR applies it to the running terminal. While the Lead Session runs a Team, a dim strip above the composer reports teammates, running members, and shared-task counts. `/team` opens the same read-only Agent Teams view as the native panel: Members and Shared tasks sections with counts, member runtime state/model/current-chat tag, and task status, readiness, owner, blockers, write scopes, and warnings. Tab or ←/→ switches sections, ↑/↓ and PgUp/PgDn move, Esc closes. Press Enter on a member to open its read-only transcript, or on a task to expand its full description and metadata; Esc returns. The task board has no mutation controls; tasks and messages are created/updated through the Team tools and the conversation. Updates arrive from the Lead Session's `agentTeam` projection while the panel stays open.

On Members, Enter opens the selected teammate's read-only transcript (↑/↓ scroll, Esc returns). On Tasks, Enter opens a read-only task detail with the full description, status, owner, blockers, scopes, and warnings; ↑/↓ scrolls and Esc returns. The panel does not spawn, message, claim, complete, or edit anything.

The teammate transcript is a viewer, not a driven conversation. Enabling the bundle replaces the preset-scoped subagent controls with the Team tools; a profile without the bundle shows no strip and `/team` explains how to enable it.

## Continue a session

Resume an exact Session identity with `--resume`:

```sh
dsh tui --resume session-<id>
```

The terminal replays the stored transcript before accepting input. It refuses an unknown identity, a subagent Session, a Session recorded in a different working directory, a Session recorded without an agent preset (an earlier preset-less terminal launch), and a `--preset` that conflicts with the recorded one.

## Exit

`/exit`, `/quit`, or Ctrl+C while idle closes the terminal and restores your prompt. A running turn is cancelled, queued input is discarded, and the Session is flushed before the process exits.

## Related documentation

- [Terminal front door subsystem](../../subsystems/tui.md) — the implementation contract.
- [Configure models](./providers.md) — providers and custom endpoints, shared with the Web UI.
- [Use the Web UI](./index.md) — the browser surface.

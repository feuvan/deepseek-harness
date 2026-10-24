# Use the terminal interface

English | [中文](terminal.zh.md)

`dsh tui` runs the agent in the terminal you are already in. It uses the same model, tools, sessions, permissions, and approval policy as the Web UI, and it keeps working when no browser or server is involved.

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
| Enter | Send a prompt; while a turn runs, steer it at its next step |
| Alt+Enter or Ctrl+J | Insert a newline |
| Ctrl+C | Close the open panel, cancel a running turn, or exit when idle |
| Ctrl+O | Cycle collapsed, expanded, and hidden tool cards |
| Ctrl+R | Cycle reasoning visibility (compact → standard → detailed → verbose) |
| Ctrl+L | Repaint the screen |
| Esc | Interrupt a running turn when the composer is empty |
| Ctrl+V | Attach an image from the clipboard |
| Shift+Tab | Advance the current model's reasoning effort |
| PgUp / PgDn | Scroll the transcript |
| Mouse wheel / drag | Scroll, and copy the selection through the terminal |
| Ctrl+Shift+F | Search the rendered transcript |

Completion appears as you type. Typing `/` lists commands with their descriptions; typing `@` completes files and directories from the workspace, including paths with spaces through the quoted `@"..."` form. `Tab` accepts the highlighted entry.

### Mentions, images, and highlighting

An accepted `@` mention is ordinary prompt text: the model reads the referenced file with its tools. When the mention names an image (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`), the terminal also attaches that image to the message, provided the selected model accepts image input; otherwise it shows a notice and sends the text. Read and admission failures are notices, not lost prompts.

Fenced code in responses and plan reviews is syntax-highlighted in the terminal's colors. Very long plan documents are capped in the review panel so the options stay reachable.

A question tagged as a plan review renders its own panel: the plan document is framed, the approving option carries a check mark, declining options carry cross marks, and there is no free-text answer row.

### Reasoning effort

`Shift+Tab` cycles the effort levels the current model advertises and reports the new level in the transcript. The same choice can be made inside `/model` while selecting among models; both record the selection in the Session log.

### Commands

Terminal-only controls: `/help`, `/status`, `/model`, `/preset`, `/effort`, `/permission`, `/queue`, `/config`, `/clear`, `/reasoning`, `/cards`, `/redraw`, `/exit`, `/quit`.

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

### Configuration

`/config` opens a configuration panel below the composer with one tab per category; Tab or Left/Right switches tabs, Up/Down and PgUp/PgDn scroll, Enter opens or toggles, Esc closes. It shows the settings grouped by scope. Model and reasoning effort open the same selector and chooser as `/model` and `/effort`. The permission section switches the current session's preset. Experimental capabilities list the optional bundles this installation ships; toggling one saves it through the plugin manager and tells you a restart is required (the terminal profile has no configuration reload), and rows the profile patch cannot change show their read-only reason. Terminal display values (styling, animation, card lines, transcript window, title, language) are shown read-only because the profile patch owns them; edit the `terminal-ui` row in your profile to change them.

### Interface language

The terminal ships English and Chinese copy. Set `locale` on the `terminal-ui` row to `en` or `zh`, or leave it `auto` to follow `DSH_LOCALE`, `LC_ALL`, `LC_MESSAGES`, then `LANG`. Every panel, notice, help line, and status label follows the selected language; other languages fall back to English.

## Agent presets

The terminal composes the same four built-in agent presets as Desktop and Web: `standard` (the default), `ptc`, `minimal`, and `cordis`. A fresh launch runs under `standard`; add `--preset <id>` to start under another one:

```sh
dsh tui --preset ptc
```

`/preset` lists the four with one-line descriptions and marks the current one. Choosing a preset before the first turn recomposes that Session and records `agent-preset/selected`; after the first turn the composition is fixed and `/preset` reports that it is locked. `/status` shows the current preset. Sessions created in Desktop or Web under any of these presets resume here, and Sessions created here resume there.

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

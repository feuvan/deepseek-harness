---
description: "The terminal front door: how the tui profile presents one live Agent, assembles its transcript, answers human interactions, and restores the terminal."
kind: "subsystem"
---

# Terminal front door

English | [中文](tui.zh.md)

`dsh tui` is the terminal product surface. The shipped `tui` profile composes [`dsh-base`](../../packages/bundle/base/README.md) with [`dsh-tui-app`](../../packages/bundle/tui-app/README.md), which owns the command line and the single process-wide Agent, while [`dsh-tui`](../../packages/tui/tui/README.md) owns presentation, input, and the two human-interaction answerers. The terminal adds no model-facing capability: the Agent, tools, prompt, Session log, and every interaction record belong to the shared services the other surfaces use.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `sessionId` | required | Exact Session identity of the live root Agent the terminal presents |
| `color` | `true` | Emit ANSI styling; `false` returns every string unchanged |
| `animation` | `true` | Advance the running footer clock once per second |
| `previewLines` | `10` | Body lines shown for a collapsed tool card |
| `windowBlocks` | `200` | Maximum transcript blocks kept rendered |
| `title` | `DeepSeek Harness` | Terminal title suffix |

The terminal refuses to activate unless stdin and stdout are both TTYs. The failure is a startup diagnostic that names `dsh --profile headless "<task>"`; the process never enters the alternate screen.

## Lifecycle

The startup row parses `--resume <id>` and mints `session-<uuid>` for a fresh launch, then publishes `tuiStartup`. The Agent owner waits for the complete application and creates or resumes the Agent under that identity. The terminal row waits for the matching live root Agent, installs one model selection on the Agent scope, replays history, and only then starts the renderer.

History is read through `ctx.sessionQuery.observeSession()` after subscribing to `session/event`; the replayed prefix and the live tail splice by sequence number, so no event is rendered twice or skipped. The terminal never calls the deprecated synchronous Session readers.

On exit it cancels an active turn, waits for idle, flushes the Session, restores the terminal, and requests the process exit. Every disposal path (normal exit, startup failure, signal-driven shutdown) runs the same idempotent restore, and a process-exit hook covers a hard exit that skips disposal.

## Transcript

Durable events fold into ordered blocks: user messages, settled assistant content, tool cards, command outcomes, compaction markers, and turn-end notices. Only append-origin `user/message` events enter the human transcript; model-selection notices render dimmed, and injected context stays model-visible without becoming conversation. A turn that ends for any reason other than `completed` appends a notice naming the reason.

Live `agent/assistant-stream` frames create or update one pending block per attempt. The committed `assistant/message` for the same turn and step replaces that block before the end frame arrives, so the response is rendered exactly once; an abandoned end frame removes the pending block.

Tool cards run `ctx.tools.get(name, agent)?.presentCall(presentedArguments)` and `presentResult(presentedArguments, { content, isError, meta })`. Arguments are parsed the way the executor parses them (empty is `{}`, invalid JSON stays raw). A missing presenter, a throwing presenter, or a result view the terminal does not render falls back to the generic card and the model-facing result content. Card bodies honor `previewLines` in collapsed mode, expand fully in expanded mode, and disappear in hidden mode.

## Composer

The editor completes `/` commands and `@` workspace paths. Command completion lists the terminal-local controls plus every registered command with its description and input hint; `@` completion asks the composed [`ctx.fileReferences`](session-reference.md) provider, so the terminal offers the same candidates and exclusion rules as the Web composer. The bundle mounts the provider row, which also installs the model guidance explaining that `@` tokens are user-referenced paths.

A submitted prompt is text, except that an `@` mention naming a supported image file (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`) is read from the worked workspace, admitted by `ctx.attachments`, and attached as an image block. The product checks the current model's advertised input modalities first; an unsupported mention, a missing file, an oversized image, a per-message limit, or an admission failure becomes a transcript notice and the prompt is still sent as text.

Fenced code in assistant markdown and plan reviews is highlighted by mapping `highlight.js` scopes onto the standard palette; unknown languages and absent fence languages render as plain code. Highlighting emits only standard foreground SGR, so it satisfies the same style policy as every other component.

`Shift+Tab` advances the current model's reasoning effort through the adapter-advertised cycle and records the choice through the same model selection the selector writes, so the next request uses it. `/effort` opens a titled chooser over the same levels, and `/effort <level>` applies one directly; both accept the provider-default sentinel when the adapter advertises no default. Command arguments complete through the same autocomplete surface: `/effort ` lists the model's levels and `/permission ` lists the composed permission presets with descriptions. Bare `/permission` opens a titled chooser over the same presets, marks the effective one, and dispatches the selected preset through the registered `/permission` command, which keeps the durable event and projection update in the owning package. The footer always shows the effective level right after the model name, using the adapter default when the selection carries none, and the status panel mirrors it.

## Human interaction

Questions and approvals are answerers on the Agent-scoped `user-questions/request` and `approval/request` waterfalls. One serialized modal queue owns focus, so a question, an approval, the model selector, and the built-in panels cannot overlap. A cancelled panel settles its waterfall; it never leaves a tool waiting. A timed question claims its wait through `ctx.userQuestions.attachWait` and shows the host-computed remaining time.

The question panel renders the option list, multi-select state, a free-text answer, and batch progress. A question tagged with the `plan-review` intent gets a dedicated review: the plan document renders framed inside the panel with a line budget, the option whose label matches the intent's `approve` carries a success verdict mark, the other options carry decline marks, the free-text row is omitted because the protocol answer is one of the offered labels, and the hint names the review keys. The approval panel returns `allowed-once`, `rejected`, or `cancelled`, and honors the request signal.

## Terminal policy

`displayText()` escapes every C0 and C1 control character except line feeds before model output, tool content, question text, diagnostics, or the terminal title reaches the renderer. The palette is one table of standard 16-color SGR pairs; body text and backgrounds stay at terminal defaults, selections use reverse video, and `color: false` removes all styling. The terminal does not define a theme, so the host terminal's light or dark palette applies.

The footer reads Session projections: `tokenUsage`, `contextPressure`, `permissions`, `title`, and `workingDirectory`. It never derives those values by re-folding the log.

## Verification

Package tests cover the render layer, the transcript fold, the interaction answerers, command and mention completion, image admission, highlighting, the plan-review presentation, effort cycling, and the lifecycle against a headless terminal. Assembled acceptance boots the shipped `tui` profile through the `dsh` launcher under a PTY with replayed model output, and compares semantic terminal state and process exit. The [testing policy](../testing.md) owns lane placement.

## Related documentation

- [TUI packages](../../packages/tui/README.md) — the presentation package and its source map.
- [TUI application bundle](../../packages/bundle/tui-app/README.md) — the profile, patch rows, and startup contract.
- [Terminal snapshot harness](../../packages/test-support/terminal-snapshot/README.md) — the headless terminal, projection, and PTY driver.
- [User questions](user-questions.md) and [approval](approval.md) — the seams the panels answer.
- [Session projection](session-projection.md) — the values the footer reads.

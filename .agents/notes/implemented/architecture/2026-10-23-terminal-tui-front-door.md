# Agent Note: A shipped terminal front door over the shared agent plane

Status: implemented

English | [中文](2026-10-23-terminal-tui-front-door.zh.md)

## Problem

The repository had no terminal surface after the August 2026 removal of the implicit bare-`dsh` TUI and its terminal package. That removal set the terms for returning: a named product entry rather than an implicit default, an explicit package boundary, a concrete interaction provider, and assembled lifecycle and transcript acceptance. The surrounding architecture also changed: profiles and bundles became the only application composition, tool presentation moved to provider-neutral `presentCall`/`presentResult` methods that no production surface consumes, and the old `ctx.userInteraction` provider was replaced by the `ctx.userQuestions` and `ctx.approval` waterfalls.

A terminal surface still has properties no other shipped surface offers: it runs inside the developer's shell, needs no browser, no port, and no client bundle, and it can present the durable transcript and the live stream from the same process that drives the Agent.

## Decision

Ship `dsh tui` as the named `tui` profile: `dsh-base` plus `@deepseek-ai/dsh-tui-app`. The bundle owns the application concerns — command-line arguments, the single process-wide root Agent, and the composition rows — while `@deepseek-ai/dsh-tui` owns terminal input and presentation only. The terminal never creates an Agent and writes no Session event of its own.

The terminal is an in-process Cordis plugin, not a client of the API Gateway, the SDK, or ACP. Those interfaces intentionally omit DSH presentation: the SDK forwards session events but no tool presenters, and ACP is automation-only. An in-process plugin can call `ctx.tools.get(name, agent)` for the exact definition that executed, read the Session projections synchronously, and register the interaction answerers without a wire protocol. The `api/remotes` Client face remains unavailable to it because it requires the Gateway, a browser Trust carrier, and the Web BFF.

History is the append-origin transcript, read through `ctx.sessionQuery.observeSession()` after subscribing to `session/event`. The terminal does not use the deprecated synchronous Session readers. Live assistant frames update one pending block per attempt; the durable settlement for the same step replaces it. Tool cards run the provider-neutral presenters with the recorded result content and `meta`, falling back to the generic card and the raw content when a presenter is absent, throws, or returns a view the terminal does not render. The [client-derived presentation decision](2026-08-23-client-derived-tool-presentation.md) left a future non-Client consumer open; this terminal is that Host-local consumer, and the Web Client keeps deriving its own cards from raw events.

The terminal composes the base agent-plane rows directly and mounts no agent-preset registry. It therefore refuses to resume a Session that records a preset, rather than running it under a composition its log does not describe. Questions and approvals are answered through the existing Agent-scoped waterfalls, serialized by one modal queue so only one panel owns focus.

The palette is one table of standard 16-color SGR pairs, `color: false` removes styling, and `displayText()` escapes C0 and C1 controls before any text reaches the renderer or the terminal title. Tests use a shared headless terminal that implements the renderer's terminal interface over `@xterm/headless`, and the assembled acceptance runs the shipped profile under a PTY.

## Verification

Package tests cover the render layer, transcript fold, interaction answerers, and lifecycle against a headless terminal. `apps/cli/tests/profiles/tui/` runs the shipped profile through the `dsh` launcher: `--help` behavior, the non-TTY refusal, and PTY-driven conversation, question, approval, and exit scenarios with replayed model output. The [TUI subsystem page](../../../../docs/subsystems/tui.md) owns the current contracts, and the [package README](../../../../packages/tui/tui/README.md) owns configuration and limitations.

## Alternatives considered

**Reuse the API Gateway Client.** The `api/remotes` Client face is React-free, but it needs the Gateway, a browser Connection carrier, Peer admission, and the Web session-controller tree. It would add a wire boundary and still withhold tool presenters and live agent events.

**Build the terminal over the SDK JSON-RPC or ACP.** Both already ship keyless transports, but neither exposes DSH tool presentation or the interaction seams the terminal must answer. A terminal on either protocol would be a weaker surface and a second application entry point.

**Own the renderer.** Hand-writing differential drawing, width handling, scrolling, and input parsing would delete a dependency but add a large maintenance surface with no product-specific behavior. The shipped renderer's alternate-screen viewport, editor, and overlay primitives cover the terminal contracts this surface needs.

**Mount the Web agent-preset registry to share Session composition.** The preset declarations live in the Web bundle, and moving them to a shared layer is a broader composition change than this surface requires. The terminal composes base rows and refuses preset Sessions instead of silently changing their composition.

**Keep the terminal unshipped or experimental.** A terminal front door without a shipped profile cannot provide the lifecycle and transcript acceptance its removal required. The profile, bundle, and package are the product commitment.

## Consequences

- The repository gains a third product surface without adding HTTP, a browser, or a second Agent composition.
- `presentCall`/`presentResult` gain their first production consumer, so the provider-neutral presentation vocabulary now has a live path beyond tests.
- The terminal cannot resume Sessions recorded under an agent preset; that limitation is explicit in both READMEs and rejected loudly at launch.
- The base agent-plane rows are now consumed directly by a product surface again, which keeps them from drifting into Web-only helpers.
- Terminal output acceptance is semantic screen state plus process behavior, not a recorded-session snapshot: the terminal adds no model-visible output, and a screen is not a Session fact.

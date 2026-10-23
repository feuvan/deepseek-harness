---
description: "A pi-tui-compatible headless terminal, semantic screen projection, and PTY driver for testing terminal front doors."
kind: "package-reference"
---

# @deepseek-ai/dsh-terminal-snapshot

English | [中文](README.zh.md)

## Summary

This harness lets a full-screen terminal application render without a TTY and be reviewed as terminal state rather than ANSI fragments. `HeadlessTerminal` implements the `@earendil-works/pi-tui` `Terminal` interface over `@xterm/headless`; `projectTerminalState()` reads the final buffer, cursor, and non-default style ranges; `formatTerminalState()` renders that state as reviewable text; `PtyProcess` spawns a real child under a PTY and exposes the same projection. It is test infrastructure, not a product API.

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

Mount the headless terminal where a test constructs the renderer:

```ts ignore-check
const terminal = new HeadlessTerminal({ columns: 100, rows: 30 })
const tui = new TuiAltScreen(terminal)
// ... mount components and start ...
await terminal.settle()
const state = terminal.state()
expect(terminalStyleViolations(state)).toEqual([])
```

`press(data)` feeds one input sequence to the handlers the renderer attached; `resize()` changes geometry and notifies them; `state({ full: true })` includes retained scrollback instead of only the viewport. The application-requested title, progress flag, and program status are recorded on the terminal and included in the projection.

`PtyProcess.start()` runs a real executable under a PTY, parses its output, and offers `waitForText()`, `waitFor()`, `screen()`, `write()`, `resize()`, `settle()`, `exited`, and `dispose()`. Use it for assembled process acceptance; use `HeadlessTerminal` for component-level snapshots.

### Projected state

`TerminalState` carries the current geometry, active buffer kind, viewport cursor, right-trimmed row text, and one style run per contiguous non-default cell range. Text and style are separate so a reviewer can tell a content change from a presentation change. `terminalStyleViolations()` reports the palette contract: explicit backgrounds, truecolor foregrounds, and palette entries above the standard 16.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`HeadlessTerminal` forwards every renderer write to a `@xterm/headless` emulator and keeps a promise chain so `settle()` resolves after the parser has consumed every accepted write. The renderer's terminal API calls (`hideCursor`, `clearLine`, `moveBy`, …) become the matching control sequences, which the emulator also parses; this is why the projected screen matches what a real terminal would show.

`projectTerminalState()` walks the active buffer from the viewport top (or from zero with `full`) and describes each cell with the emulator's public cell API. `PtyProcess` requires `node-pty` lazily, so importing the harness on a host without a usable native PTY does not fail until a PTY test starts.

### Source map

| File | Role |
|---|---|
| [`src/headless-terminal.ts`](src/headless-terminal.ts) | pi-tui `Terminal` implementation over `@xterm/headless` |
| [`src/project.ts`](src/project.ts) | Semantic state projection, formatting, and style-policy checks |
| [`src/pty-driver.ts`](src/pty-driver.ts) | PTY child process with the same projection and screen waits |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Testing policy](../../../docs/testing.md) — where assembled terminal acceptance belongs.
- [Terminal front door subsystem](../../../docs/subsystems/tui.md) — the renderer contracts this harness observes.

-----

<a id="model-experience"></a>
## Model Experience

None, as the harness parses terminal bytes and invokes no model.

#### KV Cache effect

No direct effect; it never constructs a request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No image or hyperlink projection.** The state projection covers text, cursor, and style ranges; inline images and OSC 8 targets are not compared.
- **No Windows CI lane in the reference suite.** `PtyProcess` uses the same `node-pty` dependency as production terminals, but the shipped acceptance runs on POSIX hosts.
- **No scrollback search.** `full` reads retained rows once; the harness does not search or page them.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The harness lives in `test-support` because it has no product contract: it exists to keep terminal snapshots semantic and reviewable, and to let component-level tests and process-level acceptance share one projection.

</details>

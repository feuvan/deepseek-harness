---
description: "The dsh TUI bundle: the terminal surface over dsh-base, with command-line startup and the single process-wide Agent the terminal presents."
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui-app

English | [中文](README.zh.md)

## Summary

`dsh-tui-app` is the patch layer that makes `dsh tui` a product surface. It rides over [`dsh-base`](../base/README.md), parses the app's own `--resume` and `--help`, creates or resumes the one process-wide root Agent, and mounts the presentation-only terminal plugin. It opens no port and runs no browser or Host layer; configuration HMR comes from `dsh-base`, so profile patches and plugin toggles apply to the running terminal. `dsh tui` is single-session by construction.

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

Run the shipped profile from an interactive terminal:

```sh
dsh tui
dsh tui --preset ptc
dsh tui --resume session-<id>
```

The first launch initializes the `tui` profile under `$DSH_HOME/profiles/tui` from the shipped template, exactly like the other named profiles. A fresh Session runs under an agent preset: the shipped four are `standard` (the default), `ptc`, `minimal`, and `cordis`, matching Desktop and Web, and `--preset <id>` picks another before the first turn. `/preset` lists them and switches the current Session until its first turn starts. `--resume` takes an exact Session identity; the run refuses an unknown identity, a subagent or forked Session, a Session recorded without an agent preset (an earlier preset-less terminal launch), a `--preset` that conflicts with the recorded one, and a Session recorded in another working directory.

`dsh tui --help` prints the app's own help and exits without claiming the terminal. Non-interactive launches fail before the screen is entered and name `dsh --profile headless "<task>"`.

The profile inherits `dsh-base`'s host plane and replaces its agent plane with the same four preset declarations the Web profile ships, so a preset Session created in either surface can be resumed in the other. Only the deployment persona and the terminal rows differ from base.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The patch inserts five rows in order. `tui-startup` (the `./startup` entry) parses the app's arguments and publishes `tuiStartup` with the Session identity a fresh launch mints or the identity to resume. `tui-session` (the package entry) waits for the complete application, resolves provider, model, and reasoning effort from the composed default-model service, and creates or resumes the Agent; it disposes that Agent with the application and reports creation failures on stderr with a failing exit. `terminal-ui` mounts the terminal plugin with the same Session identity. `file-reference-local` provides the workspace file index behind the composer's `@` completion and the matching model guidance. The patch also mounts `ask_user_question`, because base deliberately leaves the model-facing question tool to the compositions whose host registers an answerer.

### Source map

| File | Role |
|---|---|
| [`src/startup.ts`](src/startup.ts) | `tui-startup`: `--resume`, `--help`, and the `tuiStartup` provider |
| [`src/index.ts`](src/index.ts) | `tui-session`: create or resume the presented Agent |
| [`cordis.patch.yml`](cordis.patch.yml) | The terminal patch over `dsh-base` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Terminal front door subsystem](../../../docs/subsystems/tui.md) — the presentation contract and lifecycle.
- [dsh app](../../../apps/cli/README.md) — profile selection and launcher flags.
- [Profile plugin bundles](../README.md) — how bundle layers stack.

-----

<a id="model-experience"></a>
## Model Experience

### File-reference guidance

#### What the model sees

The mounted [`@deepseek-ai/dsh-file-reference-local`](../../context/file-reference-local/README.md) row installs the `FILE_REFERENCE_PROMPT` system-prompt section on each presented Agent when the `read` tool is present. It explains that `@`-prefixed tokens are paths the user explicitly referenced and that the model resolves them with its file tools, matching the terminal's `@` completion.

#### Token effect

One short fixed section per request.

#### KV Cache effect

The section is stable across requests in one composition, so it does not invalidate the prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Schedule tools need the Web host.** The preset declarations are copied verbatim from Web, whose `schedule` host row depends on the API session controller; the terminal does not compose that controller, so the preset's `tool-schedule` row registers no tools here.
- **Preset composition is a copy.** The four declarations under `presets/` are byte-identical copies of the Web bundle's files; a parity test fails when they drift.
- **Live terminal configuration.** Profile patches and plugin toggles apply through HMR; volatile terminal settings (`color`, `animation`, `previewLines`, `windowBlocks`, `title`, `locale`, `busyEnter`) edit from `/config` and update the running terminal, while `screen` remains read-only and remounts the surface when changed in the profile.
- **No automatic session picker.** Resume requires the exact Session identity.
- **Windows is unverified by the shipped acceptance lane.** The PTY profile acceptance runs on POSIX hosts.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The bundle is the named product entry the removed TUI lacked: `dsh tui` selects the profile explicitly, and the Agent owner stays separate from the presentation package so a future terminal host can reuse the plugin. The [terminal front door note](../../../.agents/notes/implemented/architecture/2026-10-23-terminal-tui-front-door.md) records the decision and its alternatives.

</details>

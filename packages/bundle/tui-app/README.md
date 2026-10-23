---
description: "The dsh TUI bundle: the terminal surface over dsh-base, with command-line startup and the single process-wide Agent the terminal presents."
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui-app

English | [中文](README.zh.md)

## Summary

`dsh-tui-app` is the patch layer that makes `dsh tui` a product surface. It rides over [`dsh-base`](../base/README.md), parses the app's own `--resume` and `--help`, creates or resumes the one process-wide root Agent, and mounts the presentation-only terminal plugin. It opens no port, runs no browser or Host layer, and reads no configuration HMR; `dsh tui` is single-session by construction.

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
dsh tui --resume session-<id>
```

The first launch initializes the `tui` profile under `$DSH_HOME/profiles/tui` from the shipped template, exactly like the other named profiles. `--resume` takes an exact Session identity; the run refuses an unknown identity, a subagent or forked Session, a Session recorded under an agent preset this bundle does not compose, and a Session recorded in another working directory.

`dsh tui --help` prints the app's own help and exits without claiming the terminal. Non-interactive launches fail before the screen is entered and name `dsh --profile headless "<task>"`.

The profile inherits `dsh-base` unchanged apart from the deployment persona and the disabled configuration HMR row; every other capability, tool, and policy comes from base.

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

- **No preset composition.** The bundle mounts the base agent-plane rows directly, so Sessions created under an agent preset cannot be resumed here.
- **No configuration HMR.** Composition is read once per launch; restart the terminal after editing profile patches.
- **No automatic session picker.** Resume requires the exact Session identity.
- **Windows is unverified by the shipped acceptance lane.** The PTY profile acceptance runs on POSIX hosts.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The bundle is the named product entry the removed TUI lacked: `dsh tui` selects the profile explicitly, and the Agent owner stays separate from the presentation package so a future terminal host can reuse the plugin. The [terminal front door note](../../../.agents/notes/implemented/architecture/2026-10-23-terminal-tui-front-door.md) records the decision and its alternatives.

</details>

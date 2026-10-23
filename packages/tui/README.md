---
description: "The terminal front-door package group: the full-screen Cordis plugin that presents a live Agent in the current terminal."
kind: "package-group"
---

# tui/ — the terminal front door

English | [中文](README.zh.md)

## Summary

This group owns the terminal surface of DeepSeek Harness. `dsh tui` boots the shipped `tui` profile, whose bundle creates the one process-wide Agent and mounts the terminal plugin over `dsh-base`. The plugin renders the durable Session log, streams live assistant output, presents tool results through each tool's own presentation methods, and registers the answerers for questions and approvals. It adds no model-facing capability and no session event; the Web and Desktop surfaces keep their own client and transport layers.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tui`](tui/README.md) | Full-screen terminal presentation plugin over the shared Agent, Session, tool, command, and interaction services | none (consumer only) |

The shipped composition is [`@deepseek-ai/dsh-tui-app`](../bundle/tui-app/README.md); the headless terminal, screen projection, and PTY driver used by its tests live in [`terminal-snapshot`](../test-support/terminal-snapshot/README.md).

<a id="related-documentation"></a>
## Related documentation

- [Terminal front door subsystem](../../docs/subsystems/tui.md) — configuration, lifecycle, transcript assembly, and interaction contracts.
- [dsh app](../../apps/cli/README.md) — the launcher that boots the `tui` profile.
- [Profile plugin bundles](../bundle/README.md) — how the `tui` bundle stacks over `dsh-base`.
- [Testing policy](../../docs/testing.md) — the assembled acceptance lane for terminal output.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The package group exists because the terminal surface is a product front door, not a reusable rendering library: its contracts are the shipped `tui` profile's lifecycle, transcript output, and restoration behavior. A future host that needs the same rendering under another deployment composes this package and provides the same services.

</details>

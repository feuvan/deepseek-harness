---
kind: upgrade-guide
description: "The TUI profile runs agent presets and defaults to standard; preset-less terminal Sessions cannot be resumed."
---

# Terminal sessions run agent presets

English | [中文](guide.zh.md)

## Change

The `tui` profile now composes the same four built-in agent presets as Desktop and Web: `standard` (the default), `ptc`, `minimal`, and `cordis`. A fresh `dsh tui` launch runs under `standard`; `dsh tui --preset <id>` starts another one, and `/preset` switches the current Session until its first turn starts. `/status` shows the current preset.

Sessions created in Desktop or Web under one of these presets can now be resumed with `dsh tui --resume <id>`; Sessions created in the terminal can be opened in Desktop or Web. The preset recorded in a Session's header (`agent-preset/selected`) must match the preset the terminal mounts, and a `--preset` that conflicts with the recorded one is rejected before the screen opens.

Sessions created by an earlier TUI release recorded no agent preset, so they cannot be resumed by this version: the terminal fails with `recorded no agent preset; the terminal runs agent presets, so start a new Session`.

## Migration

1. Start a fresh terminal Session with `dsh tui` (or `dsh tui --preset <id>`); the new Session records its preset in the header.
2. To continue earlier terminal work, read it in Web or Desktop where it remains available, or start a new terminal Session; the old Session log is unchanged.
3. Use `/preset` before the first prompt to change the composition, and `/status` to confirm the recorded preset.

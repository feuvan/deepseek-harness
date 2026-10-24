# Agent Note: Terminal sessions run the composed agent-preset realm

Status: implemented

English | [中文](2026-10-24-tui-agent-presets.zh.md)

## Problem

The terminal profile mounted the base agent-plane rows directly and refused Sessions that recorded an agent preset. Desktop and Web already run every Session behind the preset registry with four shipped declarations (`standard`, `ptc`, `minimal`, `cordis`); a terminal user could not choose a composition, could not open Web or Desktop preset Sessions, and a Session created in the terminal was not portable back.

## Decision

`@deepseek-ai/dsh-tui-app` now composes the same realm as `@deepseek-ai/dsh-web-app`: it disables the base agent-plane rows, inserts the process-global rows presets read (`subagent-model-selection-settings`, `cordis-host-runner`, `cordis-inspect-providers`), inserts `agent-preset-registry` with `default: standard`, and lists four `@deepseek-ai/dsh-agent-preset` declarations after its own patch. The declaration files under `presets/` are byte-identical copies of the Web bundle's files; a package test fails when they drift, because bundle patch paths are package-relative and a shared bundle would change how existing Web profiles resolve their preset rows.

The Agent owner resolves`--preset` or the registry default for a fresh Session, mounts the preset in the Agent setup, and records it on the create call. A resume resolves the preset from the Session header advanced by `agent-preset/selected`, refuses a missing record (an earlier preset-less terminal Session) or a conflicting `--preset`, mounts the recorded preset, and re-checks the preset after acquiring the writer.

The terminal plugin stays presentation-only: `/preset` lists the registry, marks the current projection value, and calls the registry's `select` only before the first turn; after that the composition is fixed and the command reports the locked state. `/status` shows the recorded preset. The dock, copy, and key routing are unchanged.

## Verification

`packages/bundle/tui-app/tests` covers the patch composition, the byte parity of the declarations, startup flag publication, fresh and resumed preset mounting, legacy/conflicting/malformed records, and setup failures. `packages/tui/tui/tests` covers the chooser, names and descriptions, current marker, locked and unavailable paths, explicit argument, notices, status row, and copy parity. The shipped profile acceptance continues to run the PTY conversation, question, approval, and exit flow.

## Consequences

Fresh terminal Sessions default to `standard` and every Session records its preset, so Desktop, Web, and the terminal can open each other's Sessions under the same four declarations. Sessions from earlier terminal releases have no recorded preset and are rejected with an actionable message; [the upgrade guide](../../../../docs/upgrade-guide/v0.2.1-rc.2/tui-agent-presets/guide.md) owns that migration. The terminal does not compose the Web's API session controller, so the preset `schedule` row registers no tools here; the bundle README records that limitation. Changing a shipped declaration must update both copies or the parity test fails.

## Alternatives considered

- **Mount the base agent plane and emulate presets in the terminal.** Rejected: it would diverge from the recorded `agentPreset` projection, and Sessions would not be portable to Desktop or Web.
- **Move the declarations into a shared bundle package.** Rejected for now: bundle patch paths are package-relative, and adding a bundle to existing profile manifests needs migration machinery for every installed Web profile.

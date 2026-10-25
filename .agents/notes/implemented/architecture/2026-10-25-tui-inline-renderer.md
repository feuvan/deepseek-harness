# Agent Note: Inline terminal renderer

Status: implemented

English | [中文](2026-10-25-tui-inline-renderer.zh.md)

## Problem

The terminal always owned the alternate screen. Wheel handling therefore depended on the emulator reporting SGR mouse events and on the user's profile settings; iTerm2 can instead consume the wheel for its own scrollback, and no application-side sequence can override a disabled "Report mouse wheel events" setting. An inline viewport keeps transcript history in normal terminal scrollback, so the terminal owns the wheel natively.

## Decision

The default `screen` is `inline`. `createTerminalSession` constructs `TuiMainScreen` for inline and `TuiAltScreen` only when `screen: fullscreen` is configured. Inline mode writes the transcript into normal scrollback through a one-time bottom-anchored first frame, requests no mouse capture, and leaves wheel scrolling, scrollback, and text selection to the terminal. App-owned scroll features (archived-block paging, jump-to-end indicator, transcript search) remain fullscreen-only. Both modes keep the same composer, dock, status, contribution seam, and Session replay.

`/terminal` reports the renderer, emulator/TERM/multiplexer/SSH environment, keyboard protocol, focus, retained transcript size, and received wheel events. In inline mode zero captured wheel events is expected; the panel tells the user the terminal owns the wheel.

## Verification

Terminal-session tests cover both renderers, default inline selection, no alt-screen/mouse sequences inline, and neutral viewport controls; lifecycle tests cover the inline layout, oversized inline transcript window, `/terminal` diagnostics in both modes, wheel counting, and focus tracking. The TUI profile acceptance lanes and real iTerm2 manual checks cover the resumed-history layout and native scrolling.

## Consequences

iTerm2 and other terminals scroll history without application mouse capture, matching the default inline behaviour. Fullscreen remains available for users who want app-owned scrolling, the indicator, and transcript search. Inline mode renders the whole retained transcript through `TuiMainScreen`; very long histories cost more rendering work, and width changes trigger the renderer's full redraw and scrollback clear.

## Alternatives considered

- **Keep fullscreen and document iTerm settings.** Rejected: it makes native wheel scrolling dependent on a per-profile terminal setting that the application cannot read or override.
- **Enable alternate-scroll (DECSET 1007) and interpret arrows.** Rejected: wheel-generated arrow keys are indistinguishable from keyboard arrows, so the composer would navigate history incorrectly.

---
kind: upgrade-guide
description: "TUI profile 运行 agent preset 且默认 standard；无 preset 的终端会话无法恢复。"
---

# 终端会话运行 agent preset

[English](guide.md) | 中文

## 变更

`tui` profile 现在组装与 Desktop、Web 相同的四个内置 agent preset：`standard`（默认）、`ptc`、`minimal`、`cordis`。新的 `dsh tui` 启动运行 `standard`；`dsh tui --preset <id>` 可改用其他 preset，`/preset` 在第一轮开始前切换当前会话。`/status` 显示当前 preset。

在 Desktop 或 Web 下用这些 preset 创建的会话现在可以用 `dsh tui --resume <id>` 恢复；终端创建的会话也可以在 Desktop 或 Web 中打开。会话 header 记录的 preset（`agent-preset/selected`）必须与终端挂载的 preset 一致，与已记录 preset 冲突的 `--preset` 会在进入屏幕前被拒绝。

更早的 TUI 版本创建的会话没有记录 agent preset，因此无法被本版本恢复：终端会报错 `recorded no agent preset; the terminal runs agent presets, so start a new Session`。

## 迁移

1. 用 `dsh tui`（或 `dsh tui --preset <id>`）新建终端会话；新会话会在 header 记录 preset。
2. 若要继续更早的终端工作，可在 Web 或 Desktop 中查看（它们仍然可用），或新建终端会话；旧会话日志不变。
3. 在第一条提示前用 `/preset` 更改组合，用 `/status` 确认已记录的 preset。

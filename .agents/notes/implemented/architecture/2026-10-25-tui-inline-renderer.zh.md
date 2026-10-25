# Agent Note: Inline 终端渲染器

Status: implemented

[English](2026-10-25-tui-inline-renderer.md) | 中文

## 问题

终端始终占用 alternate screen，因此滚轮依赖模拟器上报 SGR mouse 事件以及用户 profile 设置；iTerm2 可能把滚轮用于自身 scrollback，而应用侧无法覆盖被关闭的 "Report mouse wheel events"。inline viewport 把 transcript 历史保留在终端普通 scrollback 中，滚轮天然由终端处理。

## 决策

默认 `screen` 为 `inline`。`createTerminalSession` 在 inline 下构造 `TuiMainScreen`，只有配置 `screen: fullscreen` 时才使用 `TuiAltScreen`。inline 模式通过一次底部对齐的首帧把 transcript 写入普通 scrollback，不请求鼠标捕获，滚轮、scrollback 与文本选择全部交给终端。应用自管滚动功能（归档块翻页、回到底部提示、transcript 搜索）仅保留在 fullscreen。两种模式共用 composer、dock、状态、贡献 seam 与 Session replay。

`/terminal` 显示渲染器、终端/TERM/复用器/SSH 环境、键盘协议、焦点、保留的 transcript 规模与收到的滚轮事件。inline 模式下捕获到 0 个滚轮事件是预期行为；面板会说明滚轮由终端负责。

## 验证

终端 session 测试覆盖两种渲染器、默认 inline、inline 不发送 alt-screen/鼠标序列，以及中性视口控制；lifecycle 测试覆盖 inline 布局、超大 inline transcript 窗口、两种模式的 `/terminal` 诊断、滚轮计数与焦点跟踪。TUI profile 验收与真实 iTerm2 手工检查覆盖恢复历史后的布局与原生滚动。

## 后果

iTerm2 等终端无需应用捕获鼠标即可滚动历史，与默认 inline 行为一致。需要应用自管滚动、回到底部提示与 transcript 搜索的用户仍可用 fullscreen。inline 模式通过 `TuiMainScreen` 渲染全部保留的 transcript；极长历史会增加渲染成本，宽度变化还会触发渲染器的全量重绘与 scrollback 清空。

## 考虑的备选方案

- **保留 fullscreen 并让用户调整 iTerm 设置。** 否决：原生滚轮依赖应用无法读取或覆盖的 profile 设置。
- **启用 alternate-scroll（DECSET 1007）并解释方向键。** 否决：滚轮产生的方向键与键盘方向键无法区分，会导致 composer 的历史导航行为错误。

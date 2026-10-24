# Agent Note: 终端 UI 贡献 seam

Status: implemented

[English](2026-10-24-tui-contribution-seam.md) | 中文

## 问题

终端界面原本是单个封闭插件：插件无法在不改 `@deepseek-ai/dsh-tui` 的情况下添加状态行、slash 命令或 dock 界面。Agent Teams 面板是第一个想留在稳定终端包之外的消费者，未来的实验性界面（jobs、workflow、vendor 面板）也需要同一个入口。

## 决策

`@deepseek-ai/dsh-tui` 提供 `ctx.terminalUi`（`src/contribution.ts`，`TERMINAL_UI_SERVICE`）。贡献可以注册组件状态行、带参数补全的 slash 命令，或一个 dock 组件；每次注册返回随插件卸载的 disposer。终端保留布局、输入路由、焦点/光标所有权与单 dock 不变量：`openDock` 包装贡献的 close 回调，确保释放槽位时总是清除终端自己的 dock 状态；中断时与内建面板一样关闭。`registerCommand` 会拒绝与本地/其他贡献重名，缓存 composer 创建前注册的命令并在启动时 flush，且 disposer 在 flush 后仍有效。

seam 刻意只暴露呈现与文本辅助（`setEditorText`、`notice`），不暴露 transcript、composer 或 Session 内部：贡献无法绕过 dock 的输入所有权，也不能直接驱动 Agent。

## 验证

`packages/tui/tui/tests` 覆盖状态行排序与卸载、启动前后命令注册、重名拒绝、help/补全、dock 输入路由与关闭、editor/notice 转发，以及服务提供与卸载。生产中的 Team 状态行与 `/team` 命令通过该 seam 注册，所有 Team 行为测试仍然通过。

## 后果

插件无需依赖终端内部即可扩展界面。API 刻意保持狭窄；更丰富的界面需要新增 seam 方法并经过设计评审。Team 面板暂时仍留在稳定包内，因为把它迁到实验性插件会为一个已工作的呈现增加包与迁移成本，而它已经通过 seam 注册。

## 考虑的备选方案

- **允许插件引用 `TerminalApp` 内部。** 否决：会把每个私有字段变成兼容承诺，并允许贡献抢焦点或抢占 dock。
- **立即把 Team 迁到独立实验性插件。** 暂缓：seam 是前提且现在可测试；迁移一个已工作的面板只会增加打包与 profile 工作，不改变用户行为。

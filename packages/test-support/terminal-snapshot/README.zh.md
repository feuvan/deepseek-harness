---
description: "与 pi-tui 兼容的无头终端、语义屏幕投影与 PTY 驱动器，用于测试终端前门。"
kind: "package-reference"
---

# @deepseek-ai/dsh-terminal-snapshot

[English](README.md) | 中文

## 概述

该 harness 让全屏终端应用无需 TTY 即可渲染，并可以按终端状态而不是 ANSI 片段来评审。`HeadlessTerminal` 在 `@xterm/headless` 之上实现 `@earendil-works/pi-tui` 的 `Terminal` 接口；`projectTerminalState()` 读取最终缓冲区、光标与非默认样式区间；`formatTerminalState()` 将该状态渲染为可评审文本；`PtyProcess` 在 PTY 下启动真实子进程并暴露同一份投影。它是测试基础设施，不是产品 API。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在测试构造渲染器的地方挂载无头终端：

```ts ignore-check
const terminal = new HeadlessTerminal({ columns: 100, rows: 30 })
const tui = new TuiAltScreen(terminal)
// ... mount components and start ...
await terminal.settle()
const state = terminal.state()
expect(terminalStyleViolations(state)).toEqual([])
```

`press(data)` 向渲染器挂载的处理器送入一个输入序列；`resize()` 改变尺寸并通知它们；`state({ full: true })` 包含保留的 scrollback，而不只是视口。应用请求的标题、进度标志与程序状态记录在终端上，并包含在投影中。

`PtyProcess.start()` 在 PTY 下运行真实可执行文件、解析其输出，并提供 `waitForText()`、`waitFor()`、`screen()`、`write()`、`resize()`、`settle()`、`exited` 与 `dispose()`。它用于组装级进程验收；`HeadlessTerminal` 用于组件级快照。

### 投影状态

`TerminalState` 携带当前尺寸、活动缓冲区类型、视口光标、右裁剪的行文本，以及每个连续非默认单元格区间的一条样式记录。文本与样式分开，评审者因此能区分内容变更与呈现变更。`terminalStyleViolations()` 报告调色板契约违规：显式背景、真彩色前景，以及超过标准 16 色的调色板条目。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

`HeadlessTerminal` 把每个渲染器写入转发给 `@xterm/headless` 模拟器，并维护一条 promise 链，使 `settle()` 在解析器消费完所有已接受的写入后完成。渲染器的终端 API 调用（`hideCursor`、`clearLine`、`moveBy` 等）变成对应的控制序列，同样由模拟器解析；投影屏幕因此与真实终端显示一致。

`projectTerminalState()` 从视口顶部（或 `full` 时的零行）开始遍历活动缓冲区，并用模拟器的公开单元格 API 描述每个单元格。`PtyProcess` 惰性加载 `node-pty`，因此在没有可用原生 PTY 的主机上导入 harness 不会立刻失败，只有 PTY 测试启动时才会。

### 源码映射

| 文件 | 角色 |
|---|---|
| [`src/headless-terminal.ts`](src/headless-terminal.ts) | 基于 `@xterm/headless` 的 pi-tui `Terminal` 实现 |
| [`src/project.ts`](src/project.ts) | 语义状态投影、格式化与样式策略检查 |
| [`src/pty-driver.ts`](src/pty-driver.ts) | 带同一投影与屏幕等待的 PTY 子进程 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [测试策略](../../../docs/testing.zh.md)——组装级终端验收应放在哪里。
- [终端前门子系统](../../../docs/subsystems/tui.zh.md)——该 harness 观察的渲染器契约。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该 harness 只解析终端字节，不调用模型。

#### KV Cache effect

无直接影响；它从不构造请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有图片或超链接投影。** 状态投影覆盖文本、光标与样式区间；内联图片与 OSC 8 目标不参与比较。
- **参考测试套件没有 Windows CI 通道。** `PtyProcess` 使用与生产终端相同的 `node-pty` 依赖，但随附验收运行在 POSIX 主机上。
- **没有 scrollback 搜索。** `full` 一次性读取保留行；harness 不搜索也不分页。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

该 harness 位于 `test-support`，因为它没有产品契约：它的存在是为了让终端快照保持语义化与可评审，并让组件级测试与进程级验收共享同一份投影。

</details>

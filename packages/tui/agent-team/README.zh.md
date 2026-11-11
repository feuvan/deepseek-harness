---
description: "终端 Agent Teams 界面：紧凑状态行、/team 只读成员与共享任务 dock、teammate transcript，基于终端贡献 seam。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tui-agent-team

[English](README.md) | 中文

## 概述

本包提供 `dsh tui` 的 Agent Teams 界面。它通过终端的 `ctx.terminalUi` 贡献 seam 注册：编辑器上方的紧凑状态行、`/team` 命令，以及只读的 Members / Shared tasks dock 与 teammate transcript。终端应用组装本包；基础组合提供 Team 服务与工具，Team 模式是按 Session 保存的开关。没有终端贡献 seam 的组合中本插件保持静默，由对应界面提供自己的 Team 入口。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

新 Session 默认关闭 Team 模式。在根 Session 的 `/config` → 模型与推理强度 中打开 Use Agent Teams，保存的选择在重启后保留。Team 模式开启且该 Session 有成员或共享任务后，编辑器上方出现状态行，`/team` 打开 dock。Team 模式关闭时，`/team` 会提示当前 Session 未启用该模式，而不打开 dock。

dock 对齐 native 面板，是只读视图：带计数的 Members 与 Shared tasks 两个区段。成员来自由根 Session 的 subagent 树派生，因此每行显示 teammate 的路径/名称、运行中/未运行状态与创建描述；按 Enter 打开其只读 transcript。共享任务显示状态、可开始性、Owner、依赖、写入范围与告警；按 Enter 展开任务完整描述与元数据。Tab 或 ←/→ 切换区段；↑/↓ 与 PgUp/PgDn 移动。Esc 从 transcript 或任务详情返回并关闭 dock。面板没有创建/发消息/claim/complete/edit 控件，这些操作仍属于 Team 工具与对话。teammate transcript 只是查看器，不是被驱动的对话。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

`src/index.ts` 可选注入 `terminalUi` 并安装 `TeamController`。控制器通过 `ctx.sessionProjections` 读取 Lead Session 的 `agentTeam` 投影与直接子级 `subagentCatalog` 种子，通过 `ctx.subagents.listDescendants` 异步补全成员行，通过 `ctx.agents` 读取实时回合状态，通过 `ctx.sessionQuery` 读取 teammate 历史。展示代码位于 `src/components/`：状态行、成员/任务面板与 transcript 查看器；`src/copy.ts` 保存从 seam 解析出的 locale 选定的中英文文案。所有注册与订阅都是 Cordis effect，随销毁释放。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 可选的 seam 注入与 effect 生命周期 |
| [`src/controller.ts`](src/controller.ts) | 投影、成员缓存、命令、dock 与只读 transcript/任务查看 |
| [`src/team.ts`](src/team.ts) | 只读投影与派生成员行及计数 |
| [`src/components/`](src/components/) | 状态行、成员/任务面板、transcript 查看器 |
| [`src/copy.ts`](src/copy.ts) | 中英文文案 |
| [`src/types.ts`](src/types.ts) | 结构化 seam 与 palette 契约 |

</details>

-----

## 模型体验

无：终端界面只呈现 Agent Teams 投影与服务，不注册面向模型的输入。

#### KV Cache effect

无直接影响；后续的模型可见使用由 Team 工具与普通对话提交负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **成员为派生结果** — 行来自根 Session 的 subagent 树；某个分支的 catalog 读取失败时仍以诊断行保留，没有本地 Session 的 external 子级没有 transcript。
- **只读面板** — dock 展示成员与共享任务板但不修改二者；创建/发消息/任务变更仍属于 Team 工具与对话。
- **只读 transcript** — teammate 历史可在 dock 中滚动查看，但不能被驱动。
- **限于 dock** — teammate 不能成为终端的主 Session。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

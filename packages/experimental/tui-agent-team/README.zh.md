---
description: "终端 Agent Teams 界面：紧凑状态行、/team 只读 roster 与共享任务 dock、teammate transcript，基于终端贡献 seam。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tui-agent-team

[English](README.md) | 中文

## 概述

本包提供 `dsh tui` 的 Agent Teams 界面。它通过终端的 `ctx.terminalUi` 贡献 seam 注册：编辑器上方的紧凑状态行、`/team` 命令，以及只读的 Members / Shared tasks dock 与 teammate transcript。它与 native 智能体团队面板对齐，由 [`@deepseek-ai/dsh-experimental-agent-team-profile`](../agent-team-profile/README.zh.md) 组合包提供——该组合包同时提供 Team 服务与工具；启用该 bundle 是受支持的使用方式。

在没有终端贡献 seam 的组合（Web / Desktop）中插件是惰性的，因此同一个 bundle 可以跨界面复用。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `tui` profile 的 `/config` → 实验性能力中启用 [`@deepseek-ai/dsh-experimental-agent-team-profile`](../agent-team-profile/README.zh.md)（或执行 `dsh plugin --profile tui add ...`），然后重启终端。Lead Session 有 teammate 或共享任务时状态行出现；`/team` 打开 dock。

dock 与 native 面板一致，是只读视图：带计数的 Members / Shared tasks 区块、成员运行状态/模型/当前会话标记，以及任务状态、可开始/阻塞、owner、依赖、写入范围与警告。Tab 或 ←/→ 切换区块；↑/↓ 与 PgUp/PgDn 移动。Enter 打开 teammate 的只读 transcript，或展开任务的完整描述与元数据；Esc 返回或关闭。面板没有 spawn/消息/认领/完成/编辑控件；这些操作仍由 Team 工具与会话完成。teammate transcript 是查看器，不驱动对话。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内部——点击展开</summary>

`src/index.ts` 可选注入 `terminalUi` 并安装 `TeamController`。控制器通过 `ctx.sessionProjections` 读取 Lead Session 的 `agentTeam` projection，通过 `ctx.sessionQuery` 读取 teammate 历史，通过 `ctx.agents` 计算运行状态，通过已组装的 `ctx.agentTeams` 服务执行任务/消息动作。呈现层在 `src/components/`：状态行、roster/任务面板与 transcript 查看器；`src/copy.ts` 根据 seam 解析出的 locale 提供中英文文案。所有注册都是 Cordis effect，随卸载释放。

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 可选 seam 注入与 effect 生命周期 |
| [`src/controller.ts`](src/controller.ts) | projection、命令、dock 与只读 transcript/任务查看 |
| [`src/components/`](src/components/) | 状态行、roster/任务面板、transcript 查看器 |
| [`src/copy.ts`](src/copy.ts) | 中英文文案 |
| [`src/types.ts`](src/types.ts) | 结构化 seam 与调色板契约 |

</details>

-----

## 模型体验

None, as the terminal surface only presents the Agent Teams projection and service without registering model-facing input.

#### KV Cache effect

无直接影响；后续模型可见内容由 Team 工具与普通对话提交负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只读面板** — dock 只展示 roster 与共享任务板，不修改它们；spawn/消息/任务变更仍由 Team 工具与会话完成。
- **只读 transcript** — teammate 历史在 dock 中滚动查看，但不能驱动。
- **限于 dock** — teammate 不能成为终端主 Session。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

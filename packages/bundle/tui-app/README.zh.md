---
description: "dsh 的 TUI 组合包：基于 dsh-base 的终端界面，包含命令行启动与终端所呈现的唯一进程级 Agent。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui-app

[English](README.md) | 中文

## 概述

`dsh-tui-app` 是让 `dsh tui` 成为产品界面的 patch 层。它叠放在 [`dsh-base`](../base/README.zh.md) 之上，解析应用自己的 `--resume` 与 `--help`，创建或恢复唯一的进程级根 Agent，并挂载只负责呈现的终端插件。它不打开端口、不运行浏览器或 Host 层，也不读取配置 HMR；`dsh tui` 在构造上就是单会话的。

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

在交互式终端中运行随附 profile：

```sh
dsh tui
dsh tui --resume session-<id>
```

首次启动会像其他具名 profile 一样，从随附模板在 `$DSH_HOME/profiles/tui` 下初始化 `tui` profile。`--resume` 接受精确的会话标识；运行会拒绝未知标识、subagent 或 fork 的会话、记录了本组合包未组装之 agent preset 的会话，以及记录在另一个工作目录中的会话。

`dsh tui --help` 打印应用自己的帮助并在占用终端前退出。非交互启动会在进入屏幕前失败，并指出 `dsh --profile headless "<task>"`。

该 profile 除部署 persona 与被禁用的配置 HMR 条目外原样继承 `dsh-base`；其他所有能力、工具与策略都来自 base。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

patch 按顺序插入五个条目。`tui-startup`（`./startup` 入口）解析应用参数，并发布 `tuiStartup`，其中带有新启动生成的会话标识或待恢复的标识。`tui-session`（包入口）等待完整应用就绪，从组合的默认模型服务解析 provider、model 与 reasoning effort，并创建或恢复 Agent；它随应用一起 dispose 该 Agent，并在创建失败时向 stderr 报告并以失败退出。`terminal-ui` 用同一会话标识挂载终端插件。`file-reference-local` 提供编辑器 `@` 补全背后的工作区文件索引以及对应的模型指引。patch 还会挂载 `ask_user_question`，因为 base 刻意把模型可见的问题工具留给注册了应答者的组合。

### 源码映射

| 文件 | 角色 |
|---|---|
| [`src/startup.ts`](src/startup.ts) | `tui-startup`：`--resume`、`--help` 与 `tuiStartup` provider |
| [`src/index.ts`](src/index.ts) | `tui-session`：创建或恢复所呈现的 Agent |
| [`cordis.patch.yml`](cordis.patch.yml) | 叠放在 `dsh-base` 上的终端 patch |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [终端前门子系统](../../../docs/subsystems/tui.zh.md)——呈现契约与生命周期。
- [dsh 应用](../../../apps/cli/README.zh.md)——profile 选择与 launcher 标志。
- [Profile 组合包](../README.zh.md)——组合包层如何叠放。

-----

<a id="model-experience"></a>
## 模型体验

### File-reference 指引

#### 模型看到什么

挂载的 [`@deepseek-ai/dsh-file-reference-local`](../../context/file-reference-local/README.zh.md) 条目会在 `read` 工具存在时为每个呈现的 Agent 安装 `FILE_REFERENCE_PROMPT` system-prompt 小节。它说明 `@` 前缀的 token 是用户显式引用的路径，模型应使用其文件工具解析，与终端的 `@` 补全一致。

#### Token 影响

每个请求一个固定的短小节。

#### KV Cache effect

同一组合内该小节跨请求稳定，不会使前缀失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不组装 preset。** 组合包直接挂载 base 的 agent 平面条目，因此在 agent preset 下创建的会话无法在这里恢复。
- **没有配置 HMR。** 组装在每次启动时读取一次；编辑 profile patch 后请重启终端。
- **没有自动会话选择器。** 恢复需要精确的会话标识。
- **Windows 未由随附验收通道验证。** PTY profile 验收运行在 POSIX 主机上。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

该组合包正是被删除的 TUI 所缺少的具名产品入口：`dsh tui` 显式选择 profile，且 Agent 所有者与呈现包分离，未来终端宿主可复用该插件。[终端前门 Agent Note](../../../.agents/notes/implemented/architecture/2026-10-23-terminal-tui-front-door.zh.md)记录了该决策及其备选方案。

</details>

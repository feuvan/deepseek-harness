---
description: "终端前门包组：在当前终端中呈现一个活动 Agent 的全屏 Cordis 插件。"
kind: "package-group"
---

# tui/ — 终端前门

[English](README.md) | 中文

## 概述

本组拥有 DeepSeek Harness 的终端界面。`dsh tui` 启动随附的 `tui` profile，其组合包创建唯一的进程级 Agent，并在 `dsh-base` 之上挂载终端插件。该插件渲染持久会话日志、流式呈现助手输出、通过各工具自己的呈现方法展示工具结果，并注册问题与审批的应答者。它不增加任何模型可见能力，也不写入会话事件；Web 与 Desktop 界面保有各自的客户端与传输层。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发者注记](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`tui`](tui/README.zh.md) | 基于共享 Agent、会话、工具、命令与交互服务的全屏终端呈现插件 | 无（仅消费） |

随附组装为 [`@deepseek-ai/dsh-tui-app`](../bundle/tui-app/README.zh.md)；其测试使用的无头终端、屏幕投影与 PTY 驱动器位于 [`terminal-snapshot`](../test-support/terminal-snapshot/README.zh.md)。

<a id="related-documentation"></a>
## 相关文档

- [终端前门子系统](../../docs/subsystems/tui.zh.md)——配置、生命周期、转录组装与交互契约。
- [dsh 应用](../../apps/cli/README.zh.md)——启动 `tui` profile 的 launcher。
- [Profile 组合包](../bundle/README.zh.md)——`tui` 组合包如何叠放在 `dsh-base` 之上。
- [测试策略](../../docs/testing.zh.md)——终端输出的组装级验收通道。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

该包组存在的原因是：终端界面是一个产品前门，而不是一个可复用的渲染库；它的契约是随附 `tui` profile 的生命周期、transcript（文本记录）输出与终端恢复行为。未来若另一个宿主需要在别的部署下复用同一套渲染，可组装本包并提供相同的服务。

</details>

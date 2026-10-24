# Agent Note: 终端中的只读 Agent Teams 界面

Status: implemented

[English](2026-10-24-tui-agent-team-surface.md) | 中文

## 问题

实验性 Agent Teams bundle 只随附工具与 Web Client 面板。在终端 profile 中启用它，会在 host 平面追加 Team 工具，却没有任何可见界面：`ui-agent-team` 是 Web-only Client 插件，而 bundle 顶层的 `tool-subagent*` disable 命中不到终端 profile 现在使用的 preset-scope 注册。用户无法判断 teammate 是否在运行，也看不到共享任务板。

## 决策

终端通过本地的结构化视图（`src/team.ts`）读取 Lead Session 的 `agentTeam` projection，并渲染两个内建界面：编辑器上方的紧凑状态行，以及带 Members / Tasks tab 的 `/team` 底部 dock。两者都不是插件贡献；终端自己拥有它们，在 projection 不存在时隐藏。Members 可打开只读 teammate transcript；Tasks 提供认领、完成、创建；`/team task` 与 `/team message` 可从编辑器调用 Team 服务。稳定的 TUI 包不依赖实验性 Agent Teams 包：本地视图只镜像它实际渲染的字段，Agent Teams client schema 仍是权威。

状态行显示 teammate、运行中与任务计数，并标明被拒绝的持久化记录；面板显示成员角色/阶段/错误，以及任务状态/owner/阻塞项/写作用域警告。两者跟随当前 Session 的 projection 变化；teammate 的 `agent/status` 更新会重绘运行计数。未启用 bundle 时，`/team` 打印启用路径（`/config` → 实验性能力 → 重启），而不是打开空面板。

## 验证

`packages/tui/tui/tests` 覆盖 projection 读取、可见性判断、计数汇总、两种语言下的状态行与面板渲染、滚动与 tab 键、projection 实时更新、teammate 状态重绘、未启用路径、help/补全与文案一致性。在临时 TUI profile 启用 bundle 的手动 PTY 运行中，`/team` 显示了 Lead roster；启用的 bundle 仍保留 preset-scope 的 subagent 工具，组合包 README 记录了这一点。

## 后果

终端用户无需浏览器即可查看并操作委派工作：可在 dock 中查看 teammate transcript、创建/认领/完成任务、发送 peer 消息。把 teammate 作为主会话打开仍属于 Web 与 Desktop 流程。team bundle 还会抑制 preset scope 的 subagent 行，由 Team 工具替换而不是被遮蔽。当终端渲染的 `agentTeam` 字段变化时，需同步更新本地结构化视图；这个最小子集比依赖实验性类型或引入新的 TUI 扩展 seam 维护成本更低。

## 考虑的备选方案

- **依赖实验性包的 client 类型。** 否决：TUI 的类型检查会解析该包的构建声明，使 persistence catalog 的来源从 `src` 变成 `lib`，并让稳定包耦合实验性构建。
- **增加通用 TUI 面板/状态行贡献服务，把 Team UI 作为实验性插件发布。** 本次否决：这是新的 UI 架构；终端已拥有 dock，而本次请求的可见性是只读的。
- **从 Team 工具输出渲染而不是 projection。** 否决：工具输出不是实时的，且会漏掉 Lead 没有调用工具时发生的 roster/任务变化。

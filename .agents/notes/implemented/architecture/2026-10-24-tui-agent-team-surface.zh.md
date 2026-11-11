# Agent Note: 终端中的只读 Agent Teams 界面

Status: implemented

[English](2026-10-24-tui-agent-team-surface.md) | 中文

## 问题

实验性 Agent Teams bundle 只随附工具与 Web Client 面板。在终端 profile 中启用它，会在 host 平面追加 Team 工具，却没有任何可见界面：`ui-agent-team` 是 Web-only Client 插件，而 bundle 顶层的 `tool-subagent*` disable 命中不到终端 profile 现在使用的 preset-scope 注册。用户无法判断 teammate 是否在运行，也看不到共享任务板。

## 决策

独立包中的插件 `@deepseek-ai/dsh-tui-agent-team` 通过终端贡献 seam 读取 Lead Session 的 `agentTeam` projection，并注册紧凑状态行、带 Members / Tasks tab 的 `/team` 底部 dock，以及只读 teammate transcript。稳定终端拥有 seam，并在 projection 不存在时隐藏这些界面；Team 代码位于 `packages/tui/agent-team`，由 `dsh-tui-app` 组合包挂载。Members 可打开只读 teammate transcript；Tasks 是只读详情视图，任务与消息的变更仍由 Team 工具和会话完成。稳定的 TUI 包不依赖 Team 包：本地视图只镜像它实际渲染的字段，Agent Teams schema 仍是权威。

Agent Teams 的 teammate 就是 subagent，因此 projection 只发布保存的模式与任务板。插件因此从根 Session 的 subagent 树派生成员行：根的 `subagentCatalog` projection 先绘制缓存行，`ctx.subagents.listDescendants` 再细化；不可读分支仍以诊断行显示，运行状态实时取自 Agent 注册表。Team 模式是保存在根 Session 上的开关，位于 `/config` → Model & effort；无论模式开关如何，插件都渲染同一状态行与 dock，模式关闭时状态行保持隐藏，除非 projection 报告了被拒绝的记录。

状态行显示 teammate、运行中与任务计数，并标明被拒绝的持久化记录；面板显示成员名称、运行状态与创建描述（不可读分支显示诊断原因），以及任务状态/owner/阻塞项/写作用域警告。两者跟随当前 Session 的 projection 变化；teammate 的 `agent/status` 更新会重绘运行计数。未组装 Team 服务时，`/team` 说明当前 profile 没有 Agent Teams；Team 模式关闭时，它指向 `/config` → Model & effort 的开关，而不是打开空面板。

## 验证

`packages/tui/agent-team/tests` 覆盖 projection 读取、派生的成员行与诊断行、可见性判断、计数汇总、两种语言下的状态行与面板渲染、滚动与 tab 键、projection 与 catalog 实时更新、teammate 状态重绘、非阻塞发现与被取代遍历的释放、未组装与模式关闭路径、help/补全与文案一致性。在 `tui` profile 的手动 PTY 运行中，`/team` 显示了派生的成员树与共享任务板。

## 后果

终端用户无需浏览器即可查看委派工作：可在 dock 中查看 teammate transcript 与共享任务板，peer 消息仍通过 Team 工具与会话完成。把 teammate 作为主会话打开仍属于 Web 与 Desktop 流程。终端通过文档化的结构化接口读取 Team 服务与 projection，因此没有组装 Agent Teams 的组合不会显示任何界面。当终端渲染的 `agentTeam` 字段变化时，需同步更新本地结构化视图；这个最小子集比依赖 Team 包或引入新的 TUI 扩展 seam 维护成本更低。

## 考虑的备选方案

- **依赖 Team 包的 client 类型。** 否决：TUI 的类型检查会解析该包的构建声明，使 persistence catalog 的来源从 `src` 变成 `lib`，并让稳定包耦合其他包的构建。最终设计把整个界面迁入独立包，稳定包只保留结构化 seam。
- **增加通用 TUI 面板/状态行贡献服务，把 Team UI 作为实验性插件发布。** 本次否决：这是新的 UI 架构；终端已拥有 dock，而本次请求的可见性是只读的。
- **从 Team 工具输出渲染而不是 projection。** 否决：工具输出不是实时的，且会漏掉 Lead 没有调用工具时发生的任务板变化。

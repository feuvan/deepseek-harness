# Agent Note: 在共享 agent 平面之上交付终端前门

Status: implemented

[English](2026-10-23-terminal-tui-front-door.md) | 中文

## 问题

在 2026 年 8 月删除隐式裸 `dsh` TUI 及其终端包之后，仓库不再有终端界面。那次删除也为重新引入设定了条件：具名产品入口而非隐式默认、明确的包边界、具体交互 provider，以及组装级生命周期与 transcript 验收。周边架构也发生了变化：profile 与组合包成为唯一应用组装方式；工具呈现移至 provider-neutral 的 `presentCall`/`presentResult` 方法，而当前没有任何生产界面消费它们；旧的 `ctx.userInteraction` provider 被 `ctx.userQuestions` 与 `ctx.approval` waterfall 取代。

终端界面仍具备其他随附界面没有的特性：它运行在开发者的 shell 内，不需要浏览器、端口或客户端 bundle，并且能在驱动 Agent 的同一进程中同时呈现持久 transcript 与实时流。

## 决策

将 `dsh tui` 作为具名 `tui` profile 交付：`dsh-base` 加 `@deepseek-ai/dsh-tui-app`。组合包拥有应用层关注点——命令行参数、唯一进程级根 Agent 与组装条目——而 `@deepseek-ai/dsh-tui` 只拥有终端输入与呈现。终端从不创建 Agent，也不自行写入会话事件。

终端是进程内 Cordis 插件，而不是 API Gateway、SDK 或 ACP 的客户端。那些接口刻意省略 DSH 呈现：SDK 转发会话事件但不提供工具呈现，ACP 仅用于自动化。进程内插件可以调用 `ctx.tools.get(name, agent)` 取得实际执行的精确定义、同步读取会话投影，并注册交互应答者，无需 wire 协议。它无法使用 `api/remotes` 的 Client 面，因为后者需要 Gateway、浏览器 Trust 载体与 Web BFF。

历史是 append-origin transcript，在订阅 `session/event` 之后通过 `ctx.sessionQuery.observeSession()` 读取。终端不使用已废弃的同步会话读取方法。实时助手帧为每次尝试更新一个待定块；同一步骤的持久定稿替换它。工具卡用记录的结果内容与 `meta` 调用 provider-neutral 呈现方法；呈现方法缺失、抛错或返回终端不渲染的视图时，回退到通用卡片与原始内容。[客户端派生呈现决策](2026-08-23-client-derived-tool-presentation.zh.md)为未来的非 Client 消费者留出了空间；本终端就是该 Host 本地消费者，而 Web Client 继续从原始事件派生自己的卡片。

终端直接组装 base 的 agent 平面条目，且不挂载 agent preset 注册表。因此它拒绝恢复记录了 preset 的会话，而不是在与日志不符的组装下运行它。问题与审批通过既有 Agent 作用域 waterfall 应答，并由一个模态队列串行化，从而同一时刻只有一个面板拥有焦点。

调色板是一张标准 16 色 SGR 对的表，`color: false` 移除样式，且在文本到达渲染器或终端标题之前，`displayText()` 转义 C0 与 C1 控制字符。测试使用共享无头终端：它在 `@xterm/headless` 之上实现渲染器的终端接口；组装验收则在 PTY 下运行随附 profile。

## 验证

包测试覆盖渲染层、transcript 折叠、交互应答者，以及针对无头终端的生命周期。`apps/cli/tests/profiles/tui/` 通过 `dsh` launcher 运行随附 profile：`--help` 行为、非 TTY 拒绝，以及使用回放模型输出的 PTY 驱动对话、提问、审批与退出场景。[TUI 子系统页面](../../../../docs/subsystems/tui.zh.md)拥有当前契约，[包 README](../../../../packages/tui/tui/README.zh.md)拥有配置与限制。

## 考虑的备选方案

**复用 API Gateway Client。** `api/remotes` 的 Client 面不依赖 React，但它需要 Gateway、浏览器 Connection 载体、Peer 准入与 Web session-controller 树。它会增加 wire 边界，却仍不提供工具呈现与实时 agent 事件。

**基于 SDK JSON-RPC 或 ACP 构建终端。** 两者都已提供无密钥传输，但都不暴露 DSH 工具呈现或终端必须应答的交互 seam。基于任一协议的终端都会是更弱的界面，并成为第二个应用入口。

**自行实现渲染器。** 手写差分绘制、宽度处理、滚动与输入解析会删掉一个依赖，却增加一大片没有产品特有行为的维护面。随附渲染器的备用屏视口、编辑器与 overlay 原语已覆盖该界面所需的终端契约。

**挂载 Web agent preset 注册表以共享会话组装。** preset 声明位于 Web 组合包中，把它们移到共享层是比本界面所需更广的组装变更。终端组装 base 条目并拒绝 preset 会话，而不是静默改变其组装。

**不交付终端或仅作实验。** 没有随附 profile 的终端前门无法提供其删除时所要求的生命周期与 transcript 验收。profile、组合包与包本身就是产品承诺。

## 后果

- 仓库获得第三个产品界面，且不增加 HTTP、浏览器或第二个 Agent 组装。
- `presentCall`/`presentResult` 获得首个生产消费者，provider-neutral 呈现词汇因此有了测试之外的实时路径。
- 终端无法恢复在 agent preset 下记录的会话；该限制在两份 README 中明确说明，并在启动时显式拒绝。
- base 的 agent 平面条目再次被产品界面直接消费，从而不会漂移成 Web 专属 helper。
- 终端输出验收是语义屏幕状态加进程行为，而不是 recorded-session 快照：终端不增加模型可见输出，而屏幕也不是会话事实。

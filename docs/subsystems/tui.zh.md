---
description: "终端前门：tui profile 如何呈现单个活动 Agent、组装其 transcript、应答人工交互并恢复终端。"
kind: "subsystem"
---

# 终端前门

[English](tui.md) | 中文

`dsh tui` 是终端产品界面。随附 `tui` profile 组装 [`dsh-base`](../../packages/bundle/base/README.zh.md) 与 [`dsh-tui-app`](../../packages/bundle/tui-app/README.zh.md)：后者拥有命令行与唯一的进程级 Agent，而 [`dsh-tui`](../../packages/tui/tui/README.zh.md) 只拥有呈现、输入以及两个人工交互应答者。终端不增加任何模型可见能力：Agent、工具、prompt、会话日志与每条交互记录都属于其他界面共用的共享服务。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `sessionId` | 必填 | 本终端呈现的活动根 Agent 的精确会话标识 |
| `color` | `true` | 输出 ANSI 样式；`false` 时每个字符串原样返回 |
| `animation` | `true` | 运行中页脚时钟每秒推进一次 |
| `previewLines` | `10` | 折叠工具卡展示的正文行数 |
| `windowBlocks` | `200` | 保留渲染的 transcript 块上限 |
| `title` | `DeepSeek Harness` | 终端标题后缀 |

除非 stdin 与 stdout 均为 TTY，终端拒绝激活。该失败是启动诊断，并指出 `dsh --profile headless "<task>"`；进程从不进入备用屏。

## 生命周期

启动条目解析 `--resume <id>`，并为新启动生成 `session-<uuid>`，随后发布 `tuiStartup`。Agent 所有者等待完整应用就绪，并按该标识创建或恢复 Agent。终端条目等待匹配的活动根 Agent，在该 Agent 作用域上安装唯一的模型选择，回放历史，然后才启动渲染器。

历史在订阅 `session/event` 之后通过 `ctx.sessionQuery.observeSession()` 读取；回放前缀与实时尾部按序号拼接，因此没有事件被渲染两次或跳过。终端从不调用已废弃的同步会话读取方法。

退出时它取消活动轮次、等待空闲、flush 会话、恢复终端并请求进程退出。每条 dispose 路径（正常退出、启动失败、信号驱动的关闭）都执行同一套幂等恢复，进程退出钩子覆盖跳过 dispose 的硬退出。

## Transcript（文本记录）

持久事件折叠为有序块：用户消息、已定稿助手内容、工具卡、命令结果、压缩标记与轮次结束通知。只有 append-origin 的 `user/message` 事件进入人类 transcript；模型选择通知以暗淡样式渲染，注入上下文保持模型可见但不进入对话。除 `completed` 之外任何原因结束的轮次都会追加一条指明原因的通知。

实时 `agent/assistant-stream` 帧为每次尝试创建或更新一个待定块。同一轮次与步骤的已提交 `assistant/message` 在其结束帧到达前替换该块，因此响应只渲染一次；被放弃的结束帧移除待定块。

工具卡调用 `ctx.tools.get(name, agent)?.presentCall(presentedArguments)` 与 `presentResult(presentedArguments, { content, isError, meta })`。参数按执行器的解析方式解析（空串为 `{}`，非法 JSON 保留原文）。呈现方法缺失、抛错，或返回终端不渲染的结果视图时，回退到通用卡片与模型可见结果内容。卡片正文在收缩模式遵守 `previewLines`，展开模式完整显示，隐藏模式消失。

## 编辑器

编辑器会补全 `/` 命令与 `@` 工作区路径。命令补全列出终端本地控制以及每条已注册命令及其描述与输入提示；`@` 补全向组合的 [`ctx.fileReferences`](session-reference.zh.md) provider 查询，因此终端给出的候选与排除规则与 Web 编辑器一致。组合包挂载该 provider 条目，它同时安装说明 `@` token 是用户引用路径的模型指引。

提交的提示默认是文本；当 `@` 提及指向受支持的图片文件（`.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`）时，终端从工作区读取该图片、经 `ctx.attachments` 准入后作为图片块附加。产品会先检查当前模型声明的输入模态；不支持的提及、文件缺失、图片过大、超出单条消息限制或准入失败都会变成 transcript 通知，同时提示仍以文本发送。

助手 Markdown 与 plan review 中的代码围栏通过把 `highlight.js` 的 scope 映射到标准调色板来高亮；未知语言与未标注语言的围栏按纯代码渲染。高亮只输出标准前景色 SGR，因此与其他组件遵守同一套样式策略。

`Shift+Tab` 在当前模型适配器声明的强度循环中前进，并通过选择器写入的同一模型选择记录该选择，从而作用于下一次请求。`/effort` 打开同组强度的带标题选择器，`/effort <level>` 直接应用；当适配器没有声明默认值时，两者都接受 provider 默认哨兵值。命令参数通过同一补全面板补全：`/effort ` 列出模型强度，`/permission ` 列出组合的权限预设及其描述。不带参数的 `/permission` 会打开同组预设的带标题选择器，标记当前生效值，并把所选预设交给已注册的 `/permission` 命令派发，从而由该所有者包保留持久事件与投影更新。页脚始终在模型名之后显示实际生效的强度，选择中未携带时使用适配器默认值，状态面板与之保持一致。

## 人工交互

问题与审批是 Agent 作用域 `user-questions/request` 与 `approval/request` waterfall 上的应答者。一个串行化模态队列拥有焦点，因此问题、审批、模型选择器与内置面板不能重叠。被取消的面板会结算其 waterfall；它绝不会让工具继续等待。定时问题通过 `ctx.userQuestions.attachWait` 声明占用，并显示 Host 计算的剩余时间。

问题面板渲染选项列表、多选状态、自由文本答案与批量进度。带 `plan-review` 意图的问题会获得专用评审：计划文档以带边框、带行数预算的形式渲染在面板内；标签与意图 `approve` 相同的选项带成功标记，其他选项带拒绝标记；由于协议答案必须是已提供的标签之一，自由文本行被省略；提示行显示评审按键。审批面板返回 `allowed-once`、`rejected` 或 `cancelled`，并遵循请求 signal。

## 终端策略

在模型输出、工具内容、问题文本、诊断或终端标题到达渲染器之前，`displayText()` 转义除换行以外的所有 C0 与 C1 控制字符。调色板是一张标准 16 色 SGR 对的表；正文与背景保持终端默认值，选择使用反显，`color: false` 移除全部样式。终端不定义主题，因此宿主终端的浅色或深色调色板生效。

页脚读取会话投影：`tokenUsage`、`contextPressure`、`permissions`、`title` 与 `workingDirectory`。它从不通过重新折叠日志来推导这些值。

## 验证

包测试覆盖渲染层、transcript 折叠、交互应答者、命令与提及补全、图片准入、高亮、plan-review 呈现、强度循环，以及针对无头终端的生命周期。组装验收通过 `dsh` launcher 在 PTY 下启动随附 `tui` profile，使用回放的模型输出，并比较语义终端状态与进程退出。[测试策略](../testing.zh.md)拥有通道归属。

## 相关文档

- [TUI 包](../../packages/tui/README.zh.md)——呈现包及其源码映射。
- [TUI 应用组合包](../../packages/bundle/tui-app/README.zh.md)——profile、patch 条目与启动契约。
- [终端快照 harness](../../packages/test-support/terminal-snapshot/README.zh.md)——无头终端、投影与 PTY 驱动器。
- [用户问题](user-questions.zh.md)与[审批](approval.zh.md)——面板应答的 seam。
- [会话投影](session-projection.zh.md)——页脚读取的值。

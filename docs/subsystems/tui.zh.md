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
| `locale` | `auto` | 界面语言：`en`、`zh`，或 `auto` 依次跟随 `DSH_LOCALE`、`LC_ALL`、`LC_MESSAGES`、`LANG` |
| `screen` | `inline` | 渲染模式：`inline` 历史进入终端 scrollback（不捕获鼠标）；`fullscreen` 使用 alternate screen 与应用自管滚动 |

除非 stdin 与 stdout 均为 TTY，终端拒绝激活。该失败是启动诊断，并指出 `dsh --profile headless "<task>"`；进程从不进入备用屏。

默认 `inline` 渲染器（`TuiMainScreen`）把界面与全部 transcript 历史打印到终端普通屏幕与 scrollback：首帧底部对齐，后续输出向下增长；由于应用不请求鼠标捕获，滚轮、scrollback 与文本选择都由终端负责。`screen: fullscreen` 选择 alternate-screen 渲染器（`TuiAltScreen`），提供应用自管 `ScrollView`、鼠标捕获、归档块翻页、回到底部提示与 transcript 搜索。两种模式共用 composer、dock、状态与 projection 机制；inline 模式关闭仅属于 fullscreen 的翻页与搜索路径。

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

`Ctrl+R`（或 `/reasoning [level]`）在四个推理显示级别（`compact`、`standard`、`detailed`、`verbose`）之间循环，决定每个推理块渲染多少行；页脚显示当前级别。`Shift+Tab` 在当前模型适配器声明的强度循环中前进，并通过选择器写入的同一模型选择记录该选择，从而作用于下一次请求。`/effort` 打开同组强度的带标题选择器，`/effort <level>` 直接应用；当适配器没有声明默认值时，两者都接受 provider 默认哨兵值。命令参数通过同一补全面板补全：`/effort ` 列出模型强度，`/permission ` 列出组合的权限预设及其描述。不带参数的 `/permission` 会打开同组预设的带标题选择器，标记当前生效值，并把所选预设交给已注册的 `/permission` 命令派发，从而由该所有者包保留持久事件与投影更新。页脚始终在模型名之后显示实际生效的强度，选择中未携带时使用适配器默认值，状态面板与之保持一致。

## 编辑器输入与中断

轮次运行时，普通 Enter 遵循配置的 `busyEnter`（默认 `queue`，与 Desktop 一致）：提示排队到下一轮；Ctrl+Enter 使用相反投递方式，编辑器为空时插话全部排队消息。`/queue <text>` 显式排队，`/queue` 在 `agent.inbox.nextTurn` 上打开队列 dock（插话/编辑/删除），`/steer <text>` 直接插话。两个显式命令都会像普通提示一样展开 `@` 提及。队列修改与 API session controller 一致：编辑替换待处理消息内容，删除移除它，插话在 Agent 运行中移除并重新发送到 `next-step`。编辑器上方的待处理提示行读取 `inbox` 投影，在 Agent 消费之前显示 steering 与排队计数，运行中时还会显示 Esc 提示。编辑器为空时 Esc 取消运行中的轮次；有文本或面板打开时，Esc 仍交给编辑器或面板处理。Ctrl+V 从宿主剪贴板读取一张图片，校验当前模型的输入模态，经附件存储准入后与 `@` 图片提及一起暂存，随下一条提交的提示发送。

组合包组装与 Web profile 相同的 agent preset realm：禁用 base 的 agent 平面条目，在 `presets/` 下随附四个 `@deepseek-ai/dsh-agent-preset` 声明，并让 `agent-preset-registry` 默认 `standard`。Agent 所有者在创建前解析 preset（新会话用 `--preset` 或注册表默认值；恢复会话用已记录的 `agent-preset/selected`），在 Agent setup 中挂载它；终端的 `/preset` 选择器只在第一轮开始前调用注册表的 `select`。当组合挂载实验性 Agent Teams bundle 时，其 `@deepseek-ai/dsh-experimental-tui-agent-team` 条目通过 `ctx.terminalUi` 安装 Team 界面：编辑器上方的紧凑状态行，以及 `/team` dock（Members / Tasks tab、teammate transcript、任务动作、peer 消息）。终端核心不包含 Team 代码，也不依赖 Agent Teams；实验性插件读取 `agentTeam` projection 与 `sessionQuery` 历史、调用已组装的 Team 服务，并在没有贡献 seam 的界面（Web）中保持惰性。bundle 的 overlay 会抑制 preset scope 的 subagent 行，让 Team 工具接管委派。插件通过 `ctx.terminalUi` 扩展界面：`registerStrip` 在编辑器上方添加组件，`registerCommand` 添加 slash 命令，`openDock`/`closeDock` 呈现一个 dock 组件并在关闭时释放槽位；布局、输入路由与 teardown 仍由终端持有。编辑器与页脚之间有一个底部 dock。同一时刻只有一个 surface 占用它：`/` 与 `@` 补全窗口（带描述、↑/↓、Tab 插入、Enter 运行或插入、Esc、最多 8 行并显示滚动指示），`/permission` 与不带参数的 `/effort` 使用的带说明选择列表，按 tab 组织的配置面板，以及帮助/状态、模型选择器、问题与审批面板。不存在浮动 overlay；长页面在 dock 内滚动（↑/↓ 或 PgUp/PgDn，并显示剩余行数）。编辑器内置下拉已停用，因此所有补全、选择与面板都在编辑器下方渲染，而不是遮住 transcript。

终端层输入钩子在渲染器之前把每个按键交给当前 dock surface：面板占用 dock 时，翻页键滚动面板而不是 transcript，下方编辑器也不会被编辑。只有补全窗口打开时未处理的字符才会落回编辑器，用于继续输入过滤。

`/config` 在这个 dock 中打开按 tab 组织的配置面板，数据来自实时服务而不是静态配置文件：每个分类一个 tab，Tab/←/→ 切换，↑/↓ 与 PageUp/PageDown 滚动当前 tab，Enter 激活，Esc 关闭。模型与强度行激活已有的选择器与选择面板；权限行通过已注册的 `/permission` 命令写入本会话预设；实验性行读取 `ctx.pluginManager.listBundles()`，只切换随附的可选组合包，并报告 manager 结果（由于终端组合包禁用 HMR，通常为 `restart-required`，或显示只读原因）；显示行展示已解析的 profile 值，保持只读并标注归属层。写入从不绕过归属服务，失败会直接显示而不是盲目重试。

终端也会在 transcript 之外报告自身状态：运行中通过 OSC 9;4 报告进度，通过 OSC 7501 报告程序状态（`working`；问题或审批面板等待时为 `blocked`；其他情况为 `idle`），dispose 时清除。界面文案提供中英文；`locale` 显式选择字典，`auto` 跟随启动环境，页脚、面板、通知、帮助与诊断会一起切换。鼠标上报已启用，滚轮可滚动 transcript，拖拽选择通过 OSC 52 复制，滚动视图显示跳到末尾指示；`Ctrl+Shift+F` 打开 transcript 搜索。

## 人工交互

问题与审批是 Agent 作用域 `user-questions/request` 与 `approval/request` waterfall 上的应答者。它们与帮助/状态、模型选择器、选择列表和 `/config` 一样呈现在同一个底部 dock 中；串行队列保证同一时刻只有一个 surface 拥有输入，且不存在浮动 overlay。键盘输入只进入当前 dock surface，不会再传给下方的编辑器。被取消的面板会结算其 waterfall；它绝不会让工具继续等待。定时问题通过 `ctx.userQuestions.attachWait` 声明占用，并显示 Host 计算的剩余时间。

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

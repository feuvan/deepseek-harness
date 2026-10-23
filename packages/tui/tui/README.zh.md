---
description: "全屏终端前门：一个 Cordis 插件，在当前终端中渲染持久会话日志、流式输出、工具呈现，并应答人工交互。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tui

[English](README.md) | 中文

## 概述

`dsh-tui` 在当前终端中呈现一个活动根 Agent。它回放 transcript、跟随实时助手帧、通过每个工具自己的 `presentCall`/`presentResult` 渲染该工具、高亮代码围栏、补全 `/` 命令与 `@` 提及、附加 `@` 图片提及或剪贴板图片，并应答 `ask_user_question` 与审批。它支持 Esc 中断、把输入排队到下一轮、显示待处理输入与终端活动状态，并在中英文文案间切换。它只拥有终端输入与呈现：不创建 Agent、不增加模型可见能力，也不自行写入会话事件。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发者注记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已经创建根 Agent 的 profile 中挂载本插件。随附的 [`@deepseek-ai/dsh-tui-app`](../../bundle/tui-app/README.zh.md) 组合包同时完成两件事；自行组装配置树的部署需提供相同的两个条目。

```yaml
- name: '@deepseek-ai/dsh-tui'
  config:
    sessionId: '<exact Session identity of the presented Agent>'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `sessionId` | 必填 | 本终端呈现的活动根 Agent 的精确会话标识 |
| `color` | `true` | 输出 ANSI 样式；`false` 时渲染无样式文本 |
| `animation` | `true` | 运行中页脚时钟每秒推进一次 |
| `previewLines` | `10` | 折叠工具卡展示的正文行数 |
| `windowBlocks` | `200` | 保留渲染的 transcript 块上限 |
| `title` | `DeepSeek Harness` | 终端标题后缀；会话标题显示在其前面 |
| `locale` | `auto` | 界面语言：`en`、`zh`，或 `auto` 依次跟随 `DSH_LOCALE`、`LC_ALL`、`LC_MESSAGES`、`LANG` |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tui)是全部可接受字段及其 JSDoc 的权威来源。

只有当 stdin 与 stdout 均为 TTY 时才会占用终端。管道启动会在进入屏幕前失败，并指出一次性替代方式 `dsh --profile headless "<task>"`。

### 交互界面

Enter 发送空闲提示并 steer 运行中的轮次；`/queue <text>` 改为把消息排到下一轮。编辑器为空时 Esc 中断运行中的轮次；Ctrl+C 关闭活动面板、取消运行中的轮次，或空闲时退出。Ctrl+O 在收缩、展开与隐藏工具卡之间循环；Ctrl+R 切换推理显示；Ctrl+L 重绘；Ctrl+V 从宿主剪贴板附加图片；Shift+Tab 推进当前模型的推理强度。PgUp/PgDn 滚动，鼠标滚轮滚动，拖拽选择通过 OSC 52 复制，Ctrl+Shift+F 打开 transcript 搜索。编辑器上方的一条暗色提示行显示 Agent 尚未消费的 steering 与排队消息，终端通过 OSC 9;4 与 OSC 7501 报告 working/blocked/idle。

已注册命令（`/compact`、`/goal`、`/plan`、`/permission`、`/skill:...`）通过 `ctx.commands` 派发并渲染其记录结果；终端专属控制（`/help`、`/status`、`/model`、`/effort`、`/permission`、`/queue`、`/config`、`/clear`、`/reasoning`、`/cards`、`/redraw`、`/exit`、`/quit`）由终端自身处理。

输入 `/` 或 `@` 会在编辑器下方打开补全 dock，显示每条命令的描述或文件类型；↑/↓ 移动，Tab 插入，Enter 运行已接受的命令（或在提及/参数补全时插入），Esc 关闭。编辑器原有的内联下拉已移除。命令参数同样可补全：`/effort ` 提供当前模型声明的强度，`/permission ` 提供组合的权限预设及其描述。不带参数的 `/effort` 会打开同组强度的带标题选择器；`/effort <level>` 直接应用，所选（或适配器默认）强度会立即显示在页脚中模型名之后。不带参数的 `/permission` 在编辑器下方打开选择 dock，逐项列出组合的权限预设及说明并标记当前值；选中后交给已注册命令执行，`/permission <preset>` 直接派发。不带参数的 `/effort` 使用同一 dock。接受的 `@` 提及通常保留为字面提示文本；当它指向受支持的图片文件时，终端会从工作区读取该图片、经附件存储准入后附到发出的用户消息。任何准入失败都会变成 transcript 通知，同时文本仍照常发送。Shift+Tab 在当前模型适配器声明的强度之间循环，并通过与选择器相同的模型选择把选择记入会话日志；页脚始终显示实际生效的强度，包括用户未显式选择的默认值。带 `plan-review` 标记的问题会以专用评审呈现：带边框的计划文档、批准/拒绝标记，且不提供自由文本答案行。

所有面板都在编辑器下方的 dock 中渲染——帮助/状态、模型选择器、问题、审批、各选择列表与 `/config`；不存在浮动 overlay，长页面可滚动，Esc 关闭面板。`/config` 在编辑器下方打开配置面板，每个分类一个 tab（模型与推理强度、权限、实验性能力、终端显示）；Tab/←/→ 切换 tab，↑/↓ 与 PageUp/PageDown 滚动当前 tab，Enter 激活，Esc 关闭。面板读取实时服务：模型与推理强度、本会话的权限预设、随附的可选组合包（切换经 plugin manager 写入，并提示重启后生效），以及由 profile 拥有的终端显示值（保持只读并标注归属层）。界面文案提供中英文。`locale` 可显式选择；`auto` 跟随启动环境。页脚、面板、通知、帮助与诊断都读取当前字典。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

插件等待完整应用就绪（`ctx.get('loader')?.await()`），按配置的标识解析活动 Agent，在该 Agent 作用域上安装唯一的模型选择，然后才启动渲染器。历史在订阅 `session/event` 之后通过 `ctx.sessionQuery.observeSession()` 读取，因此实时尾部与回放前缀按序号拼接。终端从不调用已废弃的同步会话读取方法。

持久事件折叠为有序块：用户消息、已定稿助手内容、工具卡、命令结果、压缩标记与轮次结束通知。实时 `agent/assistant-stream` 帧为每次尝试更新一个待定块；同一步骤的持久定稿替换它，因此已提交消息只渲染一次。工具卡用解析后的调用参数、记录的结果内容与 `meta` 调用 `ctx.tools.get(name, agent)?.presentCall/presentResult`；呈现方法缺失或抛错时回退到通用卡片与原始内容。

问题与审批是其 Agent 作用域 waterfall 上的应答者。所有面板通过串行队列呈现在唯一的底部 dock 中，因此没有浮动 overlay，同一时刻只有一个 surface 拥有输入；带定时等待的问题通过 `ctx.userQuestions.attachWait` 声明占用并显示剩余时间。取消会结算对应的 waterfall，而不是让工具继续等待。

调色板是一张标准 16 色 SGR 对的表；`color: false` 使每个字符串原样返回。`displayText()` 在模型输出、工具内容、问题文本、诊断或终端标题到达渲染器之前，转义除换行以外的所有 C0 与 C1 控制字符。

### 源码映射

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置、TTY 校验、应用生命周期 |
| [`src/lifecycle.ts`](src/lifecycle.ts) | Agent 等待、模型选择、历史回放、布局、输入、退出 |
| [`src/transcript.ts`](src/transcript.ts) | 将持久事件与实时助手帧折叠为有序块 |
| [`src/components/`](src/components) | 横幅、页脚、编辑器、transcript 块、对话框 |
| [`src/interactions.ts`](src/interactions.ts) | 在底部 dock 中呈现的问题与审批应答者 |
| [`src/commands.ts`](src/commands.ts) | 编辑器提交、终端本地命令、命令目录 |
| [`src/model-selector.ts`](src/model-selector.ts) | 建议性模型目录与选择器 |
| [`src/status.ts`](src/status.ts) | 来自会话投影的页脚数值 |
| [`src/autocomplete.ts`](src/autocomplete.ts) | `/` 命令与 `@` 提及补全 |
| [`src/mentions.ts`](src/mentions.ts) | 图片提及展开与附件准入 |
| [`src/highlight.ts`](src/highlight.ts) | 基于标准调色板的代码围栏高亮 |
| [`src/clipboard.ts`](src/clipboard.ts) | 剪贴板图片读取与媒体类型识别 |
| [`src/locale.ts`](src/locale.ts) | 界面语言解析 |
| [`src/components/pending.ts`](src/components/pending.ts) | 待处理 steering/排队输入提示行 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [终端前门子系统](../../../docs/subsystems/tui.zh.md)——配置、生命周期、transcript 与交互契约。
- [会话投影](../../session/session-projection/README.zh.md)——页脚读取的投影值。
- [用户问题](../../interaction/user-questions/README.zh.md)与[审批](../../interaction/user-approval/README.zh.md)——面板应答的 seam。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该插件呈现既有会话，且不注册 prompt、工具、schema 或会话事件；随附组合包会挂载 file-reference provider，其 `@` 指引小节由该包负责。

#### KV Cache effect

无直接影响；组合的模型路由与 prompt 所有者决定每个请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不组装 preset。** 终端直接运行 base 的 agent 平面行，并拒绝恢复记录了 agent preset 的会话；需要 preset 的部署必须组装一个挂载同一注册表的终端组合包。
- **没有剪贴板图片粘贴，也没有内联图片渲染。** 图片通过 `@` 提及命名后附加；已附加或收到的图片块渲染为带标签的占位符，而不是像素。随附组合包不选择 PTC 模式。
- **没有会话选择器。** 恢复使用精确的 `--resume <id>`；终端内没有已存会话浏览器。
- **没有扩展面板服务。** 插件无法添加自己的终端面板；问题、审批、模型选择器、帮助/状态与 `/config` 共享唯一的底部 dock。
- **transcript 窗口会丢弃较旧的块。** `windowBlocks` 限制渲染树；向上滚动超出窗口不会重新加载较旧块。
- **推理显示有四个级别。** `compact`、`standard`、`detailed`、`verbose` 对齐 Desktop 的工作细节模式，决定每个推理块渲染多少行；Ctrl+R 或 `/reasoning [level]` 切换，页脚显示当前级别。Desktop 模式里的其他 transcript 差异（过程分组、折叠时机）在终端没有对应行为。
- **提供两种界面语言。** 终端随附英文与中文；其他语言回退到英文，直到补充相应字典。
- **Windows 未由随附验收通道验证。** 渲染器使用 pi-tui 的进程终端，但 PTY 验收运行在 POSIX 主机上。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

历史上的 `@deepseek-ai/dsh-tui` 包随隐式裸 `dsh` 入口于 2026 年 8 月删除。本实现从当前宿主契约出发：组装的 profile 提供 Agent，共享服务拥有交互状态，终端只拥有呈现与输入。重新引入的决策及其验证记录在[终端前门 Agent Note](../../../.agents/notes/implemented/architecture/2026-10-23-terminal-tui-front-door.zh.md)。

</details>

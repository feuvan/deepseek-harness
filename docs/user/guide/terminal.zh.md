# 使用终端界面

[English](terminal.md) | 中文

`dsh tui` 在你当前所在的终端中运行 agent（智能体）。它使用与 Web UI 相同的模型、工具、会话、权限与审批策略，并且在没有浏览器或服务器参与时也能工作。


默认情况下 transcript 写在终端普通 scrollback 中：终端自己的滚轮、滚动条与文本选择都可用，应用不捕获鼠标。在 TUI profile 中设置 `screen: fullscreen` 可切换到 alternate-screen 界面，获得应用自管滚动视图与 transcript 搜索。`/terminal` 显示当前渲染器。
## 启动

在你希望 agent 工作的目录中运行：

```sh
dsh tui
```

终端必须是交互式的：stdin 与 stdout 都必须是终端。管道或重定向启动会在屏幕改变前停止，并打印如何以非交互方式运行同一任务：

```sh
dsh --profile headless "run the tests"
```

首次启动会在你的 Harness home 下初始化 `tui` profile，与其他具名 profile 完全一致。

### 模型凭据

终端使用组合的 `dsh-base` 凭据链：启动环境，然后是你启动目录中的 `.env`，最后是 Harness home 下的 `.env`。从 Web UI 保存的密钥或登录信息存放在受管理凭据库中，base 组合同样会读取它，因此已配置好的模型通常无需改动即可使用。

## 界面

横幅显示模型与会话。编辑器上方的 transcript（文本记录）显示你的提示、流式响应、工具卡、命令结果与通知。编辑器以 `dsh>` 开头。页脚显示工作目录、模型与推理强度、token 总量、上下文使用、权限预设，以及 agent 处于空闲还是运行中。

### 按键

| 按键 | 操作 |
|---|---|
| Enter | 发送提示；轮次运行时排队到下一轮 |
| Ctrl+Enter | 轮次运行时插话（busy Enter 设为插话时改为排队）；编辑器为空时插话全部排队消息 |
| Alt+Enter 或 Ctrl+J | 插入换行 |
| Ctrl+C | 关闭打开的面板、取消运行中的轮次，或空闲时退出 |
| Ctrl+O | 循环工具卡可见性（折叠 → 展开 → 隐藏） |
| Ctrl+R | 显示或隐藏推理 |
| Ctrl+L | 重绘屏幕 |
| Esc | 编辑器为空时中断运行中的轮次；`fullscreen` 模式下滚动时回到底部 |
| Ctrl+V | 从剪贴板附加图片 |
| Shift+Tab | 推进当前模型的推理强度 |
| PgUp / PgDn | `inline` 模式滚动终端 scrollback；`fullscreen` 模式翻动应用自管历史 |
| 鼠标滚轮 / 拖拽 | `inline` 模式使用终端原生滚动与选择；`fullscreen` 模式为应用自管滚动 |
| Ctrl+Home / Ctrl+End | `fullscreen` 模式：载入完整应用历史 / 跳到最新输出 |
| Ctrl+Shift+F | `fullscreen` 模式：在已渲染的 transcript 中搜索 |

补全只在有意义的位置出现：普通文字与裸路径不会触发补全（输入空格不会列出工作区）。输入 `/` 会列出命令及其描述；输入 `@` 会补全工作区中的文件与目录，含空格的路径通过带引号的 `@"..."` 形式补全。`Tab` 接受高亮条目。

### 插话与队列

忙碌时的 Enter 与 Desktop 默认一致：普通 Enter 把提示排队到下一轮，而不是打断当前轮次；`/queue <text>` 显式做同样的事。`Ctrl+Enter` 使用相反的投递方式：把提示插话到运行中的轮次；编辑器为空时插话全部排队消息。`terminal-ui` 行的 `busyEnter` 字段可翻转普通 Enter 的两种行为（`queue` 或 `steer`）；`/config` 显示解析后的值。

不带参数的 `/queue` 在编辑器下方打开队列。↑/↓ 移动，Enter 插话选中的消息，`e` 把文本移回编辑器继续修改，`x` 删除，Esc 关闭。`/steer <text>` 把一条提示插话到运行中的轮次；Agent 空闲时则排队到下一轮。编辑器上方的状态条继续显示插话与排队数量。

### 提及、图片与高亮

接受的 `@` 提及就是普通提示文本：模型使用其工具读取所引用的文件。当提及指向图片（`.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`）时，终端还会把该图片附加到消息；前提是所选模型接受图片输入，否则显示通知并只发送文本。读取或准入失败会变成通知，提示不会丢失。

响应与 plan review 中的代码围栏会用终端颜色高亮。很长的计划文档在评审面板中会被截断，以保证选项仍可操作。

带 plan review 标记的问题使用专用面板：计划文档带边框，批准选项带勾选标记，拒绝选项带叉号标记，且没有自由文本答案行。

### 推理强度

`Shift+Tab` 在当前模型声明的强度之间循环，并在 transcript 中报告新强度。也可以在 `/model` 中选择模型时做同样选择；两者都会把选择记入会话日志。

### 命令

终端专属控制：`/help`、`/status`、`/model`、`/preset`、`/effort`、`/permission`、`/queue`、`/config`、`/terminal`、`/clear`、`/reasoning`、`/cards`、`/redraw`、`/exit`、`/quit`。`/terminal` 显示渲染器、终端环境、焦点、transcript 规模与收到的滚轮事件。

已注册的 agent 命令也可从编辑器使用，包括 `/compact`、`/goal`、`/plan`、`/permission` 以及 skill 调用。它们记录的结果会像其他命令一样出现在 transcript 中。

`/model` 打开模型列表。输入以过滤；`Shift+Tab` 循环高亮模型的推理强度；Enter 仅为当前会话选择它。该切换会记入会话日志，供后续读者查看。在编辑器中直接按 `Shift+Tab` 可不开列表切换强度。

`/effort` 在编辑器下方打开当前模型强度选择列表，`/effort high`（或任意已声明强度）直接应用。不带参数的 `/permission` 打开同类列表，逐项显示可用权限预设及说明并标记当前值；`/permission <preset>` 直接切换。两者都经过已注册命令，因此会话日志会记录切换。页脚始终在模型名之后显示实际生效的强度，包括你未显式选择的适配器默认值。

### 命令参数

所有面板都在编辑器下方的 dock 中打开：`/help`、`/status`、`/model`、`/config`、问题、审批与各选择列表。`/help` 等长页面可用 ↑/↓ 或 PgUp/PgDn 滚动，Esc 关闭面板。面板占用 dock 时按键只作用于面板：既不会滚动 transcript，也不会编辑下方编辑器。

命令参数可补全：输入 `/effort ` 后按 Tab 从模型强度中选择，或输入 `/permission ` 后按 Tab 从组合的权限预设中选择，每项都带描述。权限切换在命令完成后反映到页脚。

### 待处理输入与中断

轮次运行时，Enter 会在下一个步骤边界 steer 它。编辑器上方的暗色提示行显示 Agent 已接受但尚未消费的 steering 与排队消息数量。`/queue <text>` 把消息排到下一轮而不是 steer；它会像普通提示一样展开 `@` 提及。编辑器为空时 Esc 取消运行中的轮次；有文本时 Esc 留在编辑器内，面板打开时 Esc 关闭面板。

### 剪贴板图片

Ctrl+V 把系统剪贴板中的图片附加到下一条提示，前提是所选模型接受图片输入；否则终端会说明未附加图片的原因。剪贴板图片与 `@` 图片提及可以出现在同一条提示里，提示发送后暂存的附件会被清空。内联图片渲染仍未实现，因此附加的图片在 transcript 中显示为带标签的占位符。

### 推理显示

推理块按四级可见性渲染，与 Desktop 的工作细节模式对应：`compact`（单行预览）、`standard`（短预览）、`detailed`（较长预览）、`verbose`（完整块）。Ctrl+R 循环切换，`/reasoning <level>` 直接设置（也接受中文级别名），页脚在模型与推理强度之后显示当前级别。

### 工具卡

工具卡正文有三种可见模式：`collapsed`（按 `previewLines` 限制的预览）、`expanded`（完整正文）、`hidden`（不显示工具卡）。Ctrl+O 或 `/cards` 循环切换，`/cards <mode>` 直接设置（也接受中文模式名），Tab 可补全模式参数。每次切换都会打印 `工具卡：<模式>` 通知，`/status` 显示当前模式，`/config` 的 Terminal display tab 通过同一动作循环切换。

### 配置

`/config` 在编辑器下方打开结构化配置 dock：标题/副标题、readiness 行（`就绪`、`降级` 或 `只读`）、每个分类一个 tab，以及 label/value/description 三列行；Tab 或 ←/→ 切换 tab，↑/↓ 与 PgUp/PgDn 移动，Enter 打开或切换（只读行会解释原因），`/` 开始筛选（Esc 清除），Esc 关闭。footer 只列出当前行可用的动作。面板按归属层分组显示设置。模型与推理强度会打开与 `/model`、`/effort` 相同的选择器；权限区切换当前会话的预设。实验性能力列出本安装随附的可选组合包；切换会经 plugin manager 保存，并通过 profile HMR 应用；profile patch 无法修改的行会显示只读原因。终端显示值可编辑：样式与动画切换，语言与 busy-Enter 循环，卡片行数、transcript 窗口与标题使用行内输入。写入会持久化到 profile 的 volatile `terminal-ui` 字段并应用到运行中的终端；`screen` 保持只读，因为切换渲染模式会重新挂载终端表面。

### 界面语言

终端随附中英文文案。把 `terminal-ui` 行的 `locale` 设为 `en` 或 `zh`，或保持 `auto` 依次跟随 `DSH_LOCALE`、`LC_ALL`、`LC_MESSAGES`、`LANG`。面板、通知、帮助行与状态标签都会跟随所选语言；其他语言回退到英文。

## Agent preset

终端组装与 Desktop、Web 相同的四个内置 agent preset：`standard`（默认）、`ptc`、`minimal`、`cordis`。新启动默认运行 `standard`；加 `--preset <id>` 可改用其他 preset：

```sh
dsh tui --preset ptc
```

`/preset` 列出四项及一行说明并标记当前项。第一轮开始前选择会重新组装该会话并记录 `agent-preset/selected`；第一轮开始后组合固定，`/preset` 会提示已锁定。`/status` 显示当前 preset。在 Desktop 或 Web 下用这些 preset 创建的会话可以在这里恢复，反之亦然。

## Agent Teams

在 `/config` → 实验性能力中启用实验性 Agent Teams bundle（或执行 `dsh plugin --profile tui add @deepseek-ai/dsh-experimental-agent-team-profile`）；HMR 会将其应用到运行中的终端。Lead Session 运行 Team 时，编辑器上方会显示一行状态：teammate、运行中的成员与共享任务计数。`/team` 打开与 native 面板一致的只读智能体团队视图：Members 与 Shared tasks 两个区块及计数、成员运行状态/模型/当前会话标记，以及任务状态、可开始/阻塞、owner、依赖、写入范围与警告。Tab 或 ←/→ 切换区块，↑/↓ 与 PgUp/PgDn 移动，Esc 关闭。在成员上按 Enter 打开只读 transcript；在任务上按 Enter 展开完整描述与元数据，Esc 返回。任务板没有修改控件；任务与消息通过 Team 工具和会话创建/更新。面板打开期间数据随 Lead Session 的 `agentTeam` projection 实时更新。

Members 中 Enter 打开选中 teammate 的只读 transcript（↑/↓ 滚动，Esc 返回）。Tasks 中 Enter 打开只读任务详情，显示完整描述、状态、owner、依赖、写作用域与警告；↑/↓ 滚动，Esc 返回。面板不会 spawn、发送消息、认领、完成或编辑任何内容。

teammate transcript 只是查看器，不驱动对话。启用 bundle 会用 Team 工具替换 preset scope 的 subagent 控件；未启用 bundle 的 profile 不显示状态行，`/team` 会说明如何启用。

## 继续会话

使用 `--resume` 恢复精确的会话标识：

```sh
dsh tui --resume session-<id>
```

终端在接受输入前回放已存 transcript。它会拒绝未知标识、subagent 会话、记录在不同工作目录中的会话、没有记录 agent preset 的会话（更早的无 preset 终端启动），以及 `--preset` 与已记录 preset 冲突的会话。

## 退出

空闲时 `/exit`、`/quit` 或 Ctrl+C 会关闭终端并恢复你的提示符。运行中的轮次会被取消，排队输入被丢弃，会话在进程退出前 flush。

## 相关文档

- [终端前门子系统](../../subsystems/tui.zh.md)——实现契约。
- [配置模型](./providers.zh.md)——与 Web UI 共用的 provider 与自定义端点。
- [使用 Web UI](./index.zh.md)——浏览器界面。

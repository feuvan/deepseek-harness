# Agent Note: 终端会话运行已组装的 agent preset realm

Status: implemented

[English](2026-10-24-tui-agent-presets.md) | 中文

## 问题

终端 profile 直接挂载 base 的 agent 平面条目，并拒绝记录了 agent preset 的会话。Desktop 与 Web 已经让每个会话运行在 preset 注册表之后，并随附四个声明（`standard`、`ptc`、`minimal`、`cordis`）；终端用户无法选择组合，无法打开 Web 或 Desktop 的 preset 会话，终端创建的会话也不能带回去。

## 决策

`@deepseek-ai/dsh-tui-app` 现在组装与 `@deepseek-ai/dsh-web-app` 相同的 realm：禁用 base 的 agent 平面条目，插入 preset 需要的进程级 host 条目（`subagent-model-selection-settings`、`cordis-host-runner`、`cordis-inspect-providers`），插入默认 `standard` 的 `agent-preset-registry`，并在自身 patch 之后列出四个 `@deepseek-ai/dsh-agent-preset` 声明。`presets/` 下的声明是 Web bundle 文件的逐字节副本；包测试在漂移时失败，因为 bundle patch 路径是包相对的，抽成共享 bundle 会改变既有 Web profile 解析 preset 条目的方式。

Agent 所有者为新会话解析 `--preset` 或注册表默认值，在 Agent setup 中挂载 preset 并记录到创建调用。恢复会话时从会话 header 与 `agent-preset/selected` 解析 preset，拒绝缺少记录（更早的无 preset 终端会话）或与 `--preset` 冲突的会话，挂载已记录的 preset，并在取得写租约后再次校验 preset。

终端插件保持纯呈现：`/preset` 列出注册表、标记当前投影值，并只在第一轮开始前调用注册表的 `select`；之后组合固定，命令报告锁定状态。`/status` 显示已记录的 preset。dock、文案与按键路由不变。

## 验证

`packages/bundle/tui-app/tests` 覆盖 patch 组装、声明逐字节一致性、启动参数发布、新会话与恢复会话的 preset 挂载、legacy/冲突/损坏记录以及 setup 失败。`packages/tui/tui/tests` 覆盖选择列表、名称与描述、当前标记、锁定与不可用路径、显式参数、通知、状态行与文案一致性。随附 profile 验收继续运行 PTY 对话、问题、审批与退出流程。

## 后果

新的终端会话默认 `standard`，每个会话都记录自己的 preset，因此 Desktop、Web 与终端可以在相同的四个声明下互相打开会话。更早终端版本创建的会话没有记录 preset，会被带有可操作提示地拒绝；[升级指南](../../../../docs/upgrade-guide/v0.2.1-rc.2/tui-agent-presets/guide.zh.md)负责该迁移。终端不组装 Web 的 API session controller，因此 preset 的 `schedule` 条目在这里不注册工具；组合包 README 记录了这一限制。修改随附声明时必须同时更新两份副本，否则 parity 测试失败。

## 考虑的备选方案

- **挂载 base agent 平面并在终端内模拟 preset。** 否决：会与已记录的 `agentPreset` 投影不一致，会话无法在 Desktop 或 Web 中移植。
- **把声明移到共享 bundle 包。** 暂缓：bundle patch 路径是包相对的，给既有 profile manifest 增加 bundle 需要面向每个已安装 Web profile 的迁移机制。

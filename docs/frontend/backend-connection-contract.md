---
title: 前端现在怎样连接后端
description: 说明 renderer 侧如何读取设置、宿主运行态与开发态覆盖，并决定最小后端连接链路。
sidebar_position: 2
sidebar_label: 后端连接契约
---

# 前端现在怎样连接后端

## 这篇文档适合谁看

这篇文档适合：

- 准备做桌面前后端联调，但想先知道 renderer 现在到底依赖什么事实来源的人
- 需要区分“用户设置”“宿主运行态”“开发态覆盖”三层语义的人
- 接手 Electron + React 前端，想快速看懂最小连接链路的人

如果你想继续查附录，可以优先看：

- [reference-current-fields.md](./reference-current-fields.md)
- [reference-runtime-states.md](./reference-runtime-states.md)

## 先给结论

- renderer 现在不再默认靠自己猜测 `runtimeUrl`，而是优先读取 Electron 主进程导出的宿主运行态摘要。
- preload 当前同时暴露两类最小接口：一类用于读取 / 保存用户 Copilot 设置，另一类用于读取 / 受控重试宿主运行态。
- 宿主管理链路优先；只有在开发态且宿主当前没有可用 runtime URL 时，才允许使用手工 `runtimeUrl` 作为 dev override / fallback。
- `agentName` 目前仍来自本地设置；它不再决定宿主是否 ready，但仍决定 CopilotKit 最终是否能完成最小接入。
- 前端现在区分 `loading`、`empty`、`incomplete`、`starting`、`ready`、`failed`、`degraded`、`error` 这些状态。
- CopilotKit 现在会在 `ready` 或 `degraded` 且存在可用 `runtimeUrl` / `agentName` 时初始化；其接入路径本身没有被破坏。

## 当前连接信息从哪里来

当前前端连接后端时，会同时读取两类信息：

1. **用户设置**
   - 仍保存在 Electron `userData/desktop-runtime/config/copilot-settings.json`
   - 当前主要字段仍是 `runtimeUrl` 与 `agentName`
   - 其中 `runtimeUrl` 现在主要只用于开发态 override，而不是发布态主来源

2. **宿主运行态摘要**
   - 由 Electron 主进程维护 hosted backend 状态
   - 通过 preload 暴露给 renderer
   - 当前摘要至少包含：宿主状态、预期 / 已解析模式、当前 runtime URL、是否打包态、最小失败摘要

换句话说，renderer 现在消费的是：

- 一份**用户可编辑设置**
- 一份**宿主管理的运行事实**

而不是继续把两者混成一个“只要配了 `runtimeUrl` 就算可以了”的单层模型。

## 当前最小桥接面是什么

当前 preload 暴露的能力仍然保持在最小范围：

- 读取 / 保存 Copilot 设置
- 读取当前宿主运行态摘要
- 触发一次受控的 hosted backend 重试启动

它**不会**向 renderer 暴露：

- Python 解释器路径
- spawn 参数
- token 原文
- 任意文件系统访问能力
- 任意诊断文件读写能力

因此，renderer 看到的是已经裁剪过的摘要，而不是底层宿主细节。

## 应用启动时会怎么决定连接状态

当前前端启动时，会按下面的顺序工作：

1. renderer 通过 preload 读取本地 Copilot 设置
2. renderer 通过 preload 读取主进程维护的 hosted backend 运行态摘要
3. 前端先判断宿主当前是否已经提供可用 runtime URL
4. 如果宿主尚未提供，且当前处于开发态，则再判断是否允许使用手工 `runtimeUrl` 作为 override
5. 再结合 `agentName` 是否存在，整理为最终连接状态
6. 只有在可连接状态下，才把结果交给 CopilotKit

这里最关键的变化是：

- **正式宿主管理链路优先**
- **开发态 override 只是补充，不是默认主路径**

## 现在怎样理解各类状态

当前前端最少需要区分下面几类：

- `loading`：正在读取设置和宿主运行态
- `empty`：既没有宿主提供的可用 runtime URL，也没有开发态 override，且 `agentName` 也缺失
- `incomplete`：已读取到部分信息，但仍缺少 `runtimeUrl` 或 `agentName`
- `starting`：宿主正在启动本地 hosted backend，renderer 等待宿主提供地址
- `ready`：已拿到可用 runtime URL 与 `agentName`，可以初始化 CopilotKit
- `failed`：宿主启动失败，且当前没有可用 dev override 可回退
- `degraded`：宿主记录到降级 / 异常退出，但当前仍保留可用 runtime URL，因此前端仍可维持最小连接入口
- `error`：preload / IPC / 设置读取链路本身失败

这里尤其要注意：

- `failed` / `degraded` 是**宿主运行态问题**
- `empty` / `incomplete` 是**连接信息不足**
- `error` 是**读取链路本身有问题**

这三类语义不能混在一起写。

## `runtimeUrl` 和 `agentName` 现在分别扮演什么角色

### `runtimeUrl`

`runtimeUrl` 现在有两种来源：

1. 宿主 hosted backend 成功启动后自动导出的地址
2. 开发态下显式配置的 override 地址

优先级是：

1. 宿主管理地址
2. 开发态 override
3. 无可用地址

因此，发布态用户不应该再被默认要求手工填写内置 runtime 地址。

### `agentName`

`agentName` 当前仍来自设置层。

这意味着：

- 宿主 ready 并不自动等于 CopilotKit 一定可初始化
- 如果 `agentName` 为空，前端仍会落到 `incomplete`
- 当前仍保留“agent 名称来源来自设置”的最小语义

## 当前 UI 会怎样反映这些状态

当前聊天面板已经从“单纯检查配置完整性”转为“显示宿主运行态 + 可选开发态覆盖”的最小状态 UI：

- 能区分启动中 / 已连接 / 启动失败 / 配置缺失 / 读取失败 / 运行降级
- `ready` 会展示当前有效 runtime URL、来源、agent 来源、模式来源等摘要
- `failed` 会展示最小失败摘要，并允许受控重试
- `degraded` 会明确提示宿主已降级，但仍可能保留可用连接入口
- `empty` / `incomplete` 会明确提示“这主要是连接信息不足”，而不是误导成后端异常

## 当前边界

当前已经成立的事实是：

- renderer 已优先消费宿主运行态，而不是自己推断地址
- preload 暴露面仍保持在受控最小范围
- CopilotKit 注入路径仍然沿用原有入口
- 开发态手工地址仍可作为 fallback，但边界已经显式化

当前还**不是**这篇文档要声称的事实：

- bundled Python staging 已完成
- 安装包资源布局已完成
- 打包后发布态验收矩阵已完成
- 完整聊天产品 UI 已经完成
- renderer 可以直接访问底层运行日志或任意诊断文件

## 继续阅读

- 字段事实：[reference-current-fields.md](./reference-current-fields.md)
- 状态附录：[reference-runtime-states.md](./reference-runtime-states.md)
- 页面能力：[reference-page-capabilities.md](./reference-page-capabilities.md)
- 未来接口讨论草案：[future-backend-api-draft.md](./future-backend-api-draft.md)

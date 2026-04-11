---
title: 系统架构
description: 从开发者视角说明 Electron 宿主、前端工作台、后端运行时、配置存储和共享目录之间的当前关系。
sidebar_position: 2
---

# 系统架构

- 这页给谁看：已经把项目跑起来，想先建立整体结构心智的开发者。
- 这页解决什么问题：用一页说明当前桌面宿主、前端工作台、后端运行时、共享配置与 Provider 目录之间怎样分工。
- 当前覆盖到哪：覆盖当前主链上的真实组件和跨边界关系，不把旧兼容壳重新写成系统主入口。
- 当前状态：架构主干已可用；部分外围工作区与领域接入面部分接通。

先说结论：当前最可靠的结构，不是“一个前端连一个通用后端”这么简单，而是**Electron 主进程负责宿主与配置边界，renderer 负责工作台与页面状态，Python runtime 负责控制面与 `thread/run` 执行链，`provider-catalog/` 负责共享目录事实**。

## 先看整体关系

```text
Electron Main Process
  ├─ 配置中心与 settings workspace
  ├─ Provider route 解析与 secret 真源
  ├─ Python runtime 生命周期管理
  └─ preload / IPC
             │
             ▼
Renderer Workbench
  ├─ 根装配与启动状态
  ├─ 助手工作区
  ├─ 设置工作区
  └─ 其余工作区骨架
             │
             ▼
Python Desktop Runtime
  ├─ 控制面端点
  ├─ thread/run 聊天主链
  ├─ 工具与 Thinking 适配
  └─ 会话与 run 记录
```

## 四个最重要的 owner

| 组件 | 当前主要负责什么 | 当前状态 |
| --- | --- | --- |
| Electron 宿主 | 配置 owner、secret owner、runtime launcher、宿主私桥 owner。 | 已可用 |
| 前端工作台 | 根装配、助手聊天界面、设置工作区、页面级状态。 | 已可用 |
| Python runtime | 控制面端点、`thread/run` 主链、事件流、工具与 Thinking 适配。 | 已可用 |
| 外围工作区与领域接入面 | Blackboard、TIS、文件、开发、能力等方向的扩展入口。 | 部分接通 |

## Electron 宿主为什么是主边界

当前需要先记住一件事：**Electron 主进程不是简单壳层，而是系统主边界的一部分。**

它当前至少承担这些职责：

- 持有公开配置中心。
- 持有 settings workspace 的普通状态与 secret 状态。
- 拉起和停止 Python runtime。
- 为运行时提供受控的 route 解析与取密钥能力。
- 通过 preload 暴露前端真正需要的受控接口。

这也是为什么当前开发者文档必须把 Electron 宿主写成主链，而不是把旧兼容壳当成系统中心。

## 前端工作台当前负责什么

renderer 的重点不是文件 owner，而是**工作台和交互 owner**。当前最重要的两条 UI 主线是：

1. 助手工作区：进入聊天主链、消费流式事件、展示工具步骤和可见 Thinking 行为。
2. 设置工作区：维护模型服务、默认模型和其他设置项。

其余工作区当前已经有稳定结构，但很多数据面仍处在部分接通状态。要保守判断边界时，请回到[能力边界 / 状态总表](../reference/capabilities.md)。

## Python runtime 当前负责什么

Python runtime 当前是一个本地 loopback HTTP 服务。它负责：

- 控制面端点，例如健康检查、就绪状态和诊断入口。
- `POST /` 方法分发。
- `thread/create`、`thread/get`、`run/start`、`run/stream`、`run/cancel` 这组主链。
- 工具生命周期事件、Thinking 元数据和终态收口。

如果你要看完整方法和事件集合，请直接跳到[运行时接口 / 事件参考](../reference/runtime-events.md)。

## Provider 相关事实放在哪里

Provider 的共享目录事实不在前端页面代码，也不在 Python runtime 配置文件里单独各写一份。当前更合理的分工是：

- `provider-catalog/`：保存共享 Provider 目录事实。
- Electron settings workspace：保存用户自己的 provider profile 与 secret。
- 运行时请求：携带这次执行真正要走的模型路由。

完整口径请看[Provider 与模型路由说明](../reference/providers-and-routing.md)。

## 当前最关键的跨边界数据流

### 1. 启动流

1. Electron 主进程准备路径和运行参数。
2. 它启动 Python runtime。
3. renderer 读取公开配置快照与 runtime 快照。
4. 工作台进入启动、就绪或失败分支。

### 2. 聊天流

1. 前端读取智能体目录并创建 thread。
2. 用户发送消息时显式带上模型路由、Thinking 和工具选择。
3. Python runtime 通过宿主边界解析这次执行要用的 route 和凭据。
4. `run/stream` 返回流式事件。
5. 前端按 run 生命周期更新界面。

### 3. 设置流

1. 用户在设置页编辑模型服务或其他设置。
2. Electron 主进程把普通状态和 secret 状态分别保存。
3. 前端重新读取或水合这些状态。
4. 聊天区在需要时消费默认模型和 provider profile。

## 当前最容易误解的地方

### 不要把旧兼容壳写成系统主入口

`session/create`、`capabilities/get`、`message/send` 仍然存在，但它们不是新的系统架构中心。

### 不要把 Python runtime 写成配置 owner

当前配置 owner 在 Electron 主进程。Python runtime 解释启动参数，也在执行阶段按需取 route 解析结果，但它不直接读取 settings workspace 文档。

### 不要把前端页面结构误写成已经全部接通的数据面

助手与设置已经是主线。能力、文件、开发等工作区目前更适合写成已有结构、部分接通。

## 建议接着读什么

- 想理解聊天主链，读[聊天运行时](./chat-runtime.md)。
- 想理解配置和状态由谁持有，读[配置与状态模型](./config-and-state.md)。
- 想开始读代码，继续看[前端实现](./frontend.md)和[后端实现](./backend.md)。
- 想补历史材料，读[系统架构总览](../system/architecture-overview.md)。

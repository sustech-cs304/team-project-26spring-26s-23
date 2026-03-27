---
title: 会话与状态模型
description: 解释统一配置中心公共快照、宿主运行时状态与后端会话模型如何协同工作。
sidebar_position: 4
---

# 会话与状态模型

## 概述

本文档解释当前系统中的两类“状态”：

1. **前端 bootstrap / 连接状态**
2. **后端 session / thread 状态**

它重点回答这些问题：

- renderer 现在到底从哪里拿配置状态
- 配置中心公共快照和 runtime 快照怎样合并
- `threadId` 为什么可以维持多轮对话上下文
- 哪些状态是宿主 runtime 的，哪些状态是 renderer 侧派生出来的

## 当前边界

- 会话存储当前仍为内存态，Python runtime 重启后丢失
- 当前默认仍是单 agent
- renderer 当前真正参与聊天连接判断的 bootstrap fields 只有 `agentName` 和 `runtimeUrl`
- 统一配置中心公共快照现在已经可以推送配置更新，但 runtime 运行事实本身还不是完整实时流

## 前端状态层次

### Renderer 侧现在读的不是旧 settings 接口

当前 renderer 不再以旧 renderer settings API 作为正式来源。

现在它主要读取两类输入：

1. **统一配置中心公共快照**
2. **hosted runtime 快照**

然后由 renderer 自己把这两部分归并成最终的 bootstrap 状态。

### 配置中心公共快照当前提供什么

当前公共快照包含 4 个域：

- `frontendPreferences`
- `assistantBehavior`
- `hostConfig`
- `backendExposed`

但它们在状态模型里的角色并不一样：

| 域 | 当前字段 | 在状态模型中的角色 |
| --- | --- | --- |
| `frontendPreferences` | `theme` | 前端显示偏好，不参与聊天连接判断 |
| `assistantBehavior` | `agentName` | bootstrap field，直接影响聊天入口是否完整 |
| `hostConfig` | `runtimeUrl` | bootstrap field，在开发态下作为 runtime override 候选 |
| `backendExposed` | `model` | 当前由主进程读取并投影给 runtime，不参与 renderer bootstrap 判断 |

### Renderer 侧配置状态

renderer 当前通过 `resolveCopilotConfigState()` 把多来源状态归并为统一的 `CopilotConfigState`。

### 当前状态来源

1. **配置中心 bootstrap fields**
   - `agentName`
   - `runtimeUrl`
2. **Hosted runtime 状态**
   - `starting` / `ready` / `failed` / `stopped` / `degraded`
3. **派生决策**
   - `runtimeSource`（`hosted` / `dev-override` / `none`）
   - `agentNameSource`
   - 最终 `status`

### 当前配置状态类型

renderer 当前会归并出这些状态：

- `empty`
- `incomplete`
- `starting`
- `ready`
- `failed`
- `degraded`
- `error`

另外，根装配层还会在外层额外加一个：

- `loading`

### 这些状态分别是什么意思

| 状态 | 当前语义 |
| --- | --- |
| `loading` | 根层还在读取配置中心公共快照和 runtime 快照 |
| `empty` | `runtimeUrl` 和 `agentName` 都缺失 |
| `incomplete` | 只读到部分连接信息 |
| `starting` | 宿主正在启动本地后端 |
| `ready` | 最终连接信息完整，可以挂载聊天入口 |
| `failed` | 宿主启动失败，且当前没有可用 dev override |
| `degraded` | 宿主已降级，但当前仍保留可用 URL |
| `error` | 读取链路本身失败 |

## Bootstrap fields 当前怎样参与判断

### `agentName`

当前 `agentName` 来自：

- `snapshot.domains.assistantBehavior.agentName`

它现在仍然是进入 `ready` / `degraded` 的必需字段之一。

这意味着：

- 宿主 `ready` 并不自动代表聊天入口一定 `ready`
- 如果 `agentName` 为空，前端仍会落到 `incomplete`

### `runtimeUrl`

当前 `runtimeUrl` 来自：

- `snapshot.domains.hostConfig.runtimeUrl`

但它并不是任何时候都直接拿来用。

当前选择规则是：

1. 如果 hosted runtime 已经提供 URL，则优先使用 hosted URL
2. 只有当 hosted 状态为 `failed` / `stopped`，且当前处于开发态时，才允许把配置中心中的 `runtimeUrl` 当作 dev override
3. 否则视为没有可用 URL

所以当前 `runtimeUrl` 更准确的语义是：

- **开发态 override 候选**

而不是：

- **发布态总是由用户手填的正式服务地址**

## Hosted backend 运行时状态

宿主后端状态由 Electron 主进程维护。

### 当前状态字段

它当前至少包含：

- `status`
- `mode`
- `baseUrl`
- `pid`
- `startedAt` / `readyAt` / `stoppedAt`
- `exitCode` / `signal`
- `lastFailure`

### 当前状态转换

- `stopped` → `starting`
- `starting` → `ready`
- `starting` / `ready` → `failed`
- `ready` → `degraded`

这些状态通过 IPC 传给 renderer，成为 renderer 归并状态的重要输入。

## 配置更新与状态更新时机

### 初始加载

应用启动时，根装配层会：

1. 读取配置中心公共快照
2. 读取 hosted runtime 快照
3. 归并成初始 bootstrap 状态
4. 缓存在根层

### 配置中心被动更新

这是当前和旧实现相比最重要的变化之一。

现在配置中心公共快照已经支持订阅更新，所以：

- 当 `theme` 更新时，App 可以同步主题
- 当 `agentName` 或 `runtimeUrl` 更新时，根装配层会重新计算 bootstrap 状态

这意味着当前配置状态不再只是“启动时读一次”的模型。

### Runtime 状态更新

但当前还要注意另一半边界：

- **配置中心公共快照更新可以推送**
- **runtime 运行事实本身仍主要是快照式读取**

所以当前不能把系统写成“所有运行态变化都会实时推送到 renderer”。

## UI 展示状态

`CopilotChatPanel` 当前根据 `CopilotBootstrapState` 渲染不同 UI：

- `loading`：等待根层完成装配
- `error`：读取失败
- `empty` / `incomplete`：提示缺失字段
- `starting`：提示宿主正在启动
- `failed`：显示失败摘要与重试按钮
- `degraded`：显示降级警告，但仍可连接
- `ready`：连接入口已就绪，挂载聊天区域

### 诊断信息现在主要解释什么

当前 UI 里的诊断信息主要回答：

- 当前 hosted 状态是什么
- 当前 runtime URL 来自哪里
- 当前模式来自宿主已解析值，还是只拿到了 expected mode
- 当前是否有可重试失败信息

## 后端会话存储

### Session Store 设计

后端当前使用 `InMemorySessionStore` 维护会话记录。

### 核心语义

- 以 `thread_id` 为 key 存储在内存中
- 每个 session 保存完整消息历史
- 会话记录包含：
  - `thread_id`
  - `agent_name`
  - `metadata`
  - `messages`
  - `created_at` / `updated_at`

### 当前限制

- Python runtime 重启后会话丢失
- 当前没有持久化记忆、长期记忆或摘要压缩机制

## `threadId` 传递链路

### 前端侧

1. `AssistantWorkspace` 把当前选中的话题 ID 作为 `threadId` 传给聊天面板
2. `CopilotChatPanel` 把它传给 CopilotKit
3. CopilotKit 在请求体中携带该 `threadId`

### 后端侧

1. Copilot runtime 合约接收 `thread_id`
2. `RuntimeBridge.run()` 读取该字段
3. `session_store` 用它获取已有 session
4. agent 执行成功后，把这一轮 user / assistant 消息追加回同一个 `thread_id`

### 结果是什么

只要继续使用同一个 `threadId`，后端就会复用已有历史，于是多轮上下文能够延续。

## 多轮上下文当前怎样实现

### 历史加载

运行时执行前：

- Bridge 从 session store 读取已有消息
- 再把内部消息结构转换为模型上下文历史

### 成功持久化

只有当 agent 执行成功后，系统才会：

- 追加 user + assistant 消息对
- 更新 session 的 `updated_at`
- 记录最新 metadata

### 失败处理

如果 agent 执行失败：

- 当前不会把失败轮次写回 session store
- 这样可以避免把损坏或不完整结果写进历史

## 当前边界与限制

### 1. 统一配置中心并不等于所有状态都进了配置中心

当前统一配置中心只承载**稳定配置**。

下面这些内容仍然不是配置中心的一部分：

- hosted runtime 状态
- runtime snapshot
- last failure
- session store
- 消息历史

### 2. `model` 当前不属于 renderer bootstrap 字段

虽然 `backendExposed.model` 已进入统一配置中心，但它当前作用在：

- 主进程读取
- 宿主参数投影
- Python `--model` 解析

它现在不是 renderer 判断 `ready` / `incomplete` 的必需字段。

### 3. 旧 `copilot-settings.json` 当前只剩 migration 语义

当前 renderer 已不再把旧 settings 文件当作正式接口。

它现在只在主进程内部承担：

- legacy disk migration 输入来源

### 4. 前端状态同步仍是不对称的

当前系统里有一个容易忽略的不对称：

- 配置更新：已经支持公共快照订阅更新
- runtime 运行事实：仍主要依赖按需读取和重试

这正是当前文档里需要如实说明的边界。

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [运行时生命周期](./runtime-lifecycle.md)
- [聊天运行时契约](./chat-runtime-contract.md)
- [前端现在怎样连接后端](../frontend/backend-connection-contract.md)
- [当前生效字段参考](../frontend/reference-current-fields.md)

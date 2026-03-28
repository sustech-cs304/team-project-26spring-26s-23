---
title: 会话与状态模型
description: 解释统一配置中心、宿主运行态、前端会话壳与后端内存会话之间现在怎样协同工作。
sidebar_position: 4
---

# 会话与状态模型

本文档专门回答一个很容易混淆的问题：

> 现在系统里到底有哪些“状态”，分别放在哪里，又是谁负责更新它们？

如果先不把这些层次分开，后面很容易把配置、运行态、会话和消息历史写成一团。

## 先给结论

当前系统里最重要的状态，不是只有一种，而是至少有四层：

1. **统一配置中心状态**：稳定配置，放在 Electron 主进程管理的分域 JSON 文档里。
2. **宿主运行态状态**：Python runtime 当前有没有启动、是否 ready、最近有没有失败，放在 hosted runtime 快照里。
3. **前端助手工作区状态**：当前窗口里拉到的智能体目录、已创建会话列表、当前激活会话，主要放在 renderer 内存里。
4. **后端会话状态**：runtime 里的内存态消息历史，放在 Python runtime 的 `InMemorySessionStore` 里。

当前正式聊天主路径已经是：

- 后端目录决定可选智能体；
- 会话决定当前绑定的智能体；
- 每次消息请求决定本次使用的模型和工具。

## 文档范围

本文档覆盖：

- 配置中心公共快照与 hosted runtime 快照怎样参与前端状态装配。
- `AssistantWorkspace` 里的目录、会话和聊天区域当前怎样分工。
- Python runtime 里的会话存储现在怎样工作。
- 当前哪些状态会自动更新，哪些还不会。

本文档不展开：

- desktop runtime 的完整 HTTP 契约细节
- Electron 如何启动 Python runtime
- 设置页里每个表单项的实现细节

## 第一层：统一配置中心状态

### 现在有哪些正式字段

当前配置中心公共快照里已经有 4 个域、5 个正式字段：

| 域 | 字段 | 当前作用 |
| --- | --- | --- |
| `frontendPreferences` | `theme` | 控制主题 |
| `frontendPreferences` | `animationsEnabled` | 控制动画开关 |
| `assistantBehavior` | `agentName` | assistant 行为偏好字段 |
| `hostConfig` | `runtimeUrl` | 开发态运行时覆盖地址 |
| `backendExposed` | `model` | 后端默认模型字段 |

### 哪些字段会影响聊天入口

当前要把两件事分开：

- **会影响前端显示的字段**：`theme`、`animationsEnabled`
- **会影响聊天连接判断的字段**：当前主要看 `runtimeUrl`

这里最重要的变化是：

- `agentName` 仍然存在于配置中心里；
- 但当前聊天 readiness 已经**不再**以它为硬门槛。

所以现在不能再把系统描述成“缺少全局 agentName 就无法进入聊天主路径”。

## 第二层：宿主运行态状态

这部分由 Electron 主进程维护，再通过 preload 暴露给 renderer。

### 当前 hosted runtime 状态值

当前宿主运行态至少会落在这些状态里：

- `stopped`
- `starting`
- `ready`
- `failed`
- `degraded`

### 这层状态回答什么问题

它主要回答：

- 本地 Python runtime 有没有启动。
- 现在有没有可用的 runtime URL。
- 最近一次失败是什么。
- 当前运行模式是什么。

这层状态是**运行事实**，不是用户配置。

## 第三层：renderer 根装配状态

### 根装配层现在会做什么

应用启动后，根装配层会并行读取：

1. 配置中心公共快照。
2. hosted runtime 快照。

然后把这两部分合并成当前 `CopilotBootstrapState`。

### 当前 renderer 状态值

renderer 现在会归并出这些状态：

- `loading`
- `empty`
- `incomplete`
- `starting`
- `ready`
- `failed`
- `degraded`
- `error`

### 现在怎样理解这些状态

| 状态 | 当前含义 |
| --- | --- |
| `loading` | 根装配层还在读取配置与运行态 |
| `empty` | 当前没有可用 runtime URL，且宿主也没有提供可用地址 |
| `incomplete` | 宿主状态允许继续判断，但当前仍缺少关键连接条件，主要还是 runtime URL |
| `starting` | 宿主正在启动本地后端 |
| `ready` | 已有可用 runtime URL，可继续进入助手工作区主路径 |
| `failed` | 宿主启动失败，且没有可用 dev override |
| `degraded` | 宿主降级，但当前仍保留可用 URL |
| `error` | 配置或运行态读取链路本身失败 |

### 当前真正的连接门槛是什么

当前前端进入 connectable 状态，关键看的是：

- 是否有可用 runtime URL

而不是：

- 是否先拿到了一个全局 `agentName`

这也是当前文档必须更新的重点之一。

## 第四层：助手工作区状态

助手工作区内部，现在还要再拆成三块来看。

### 1. 智能体目录状态

当前 `AssistantWorkspace` 会在 connectable 状态下调用后端目录接口，形成一份目录状态：

- `idle`
- `loading`
- `ready`
- `error`

目录项当前来自后端，而不是前端静态真源。

目录数据里会包含：

- `agentId`
- `status`
- `displayName`
- `description`
- `recommendedTools`
- `defaultModelPreference`
- `iconKey`

前端只是在这份后端目录之上做展示增强，例如图标映射和中文标签收敛。

### 2. 会话列表状态

当前窗口内，前端还会维护一份会话列表状态：

- `sessions`
- `activeSessionId`

这里要特别注意：

- 这份会话列表当前主要存在于 renderer 内存里。
- 它不是统一配置中心的一部分。
- 重新加载窗口后，这份列表本身不会自动恢复。

### 3. 当前激活会话壳

当用户点击“创建会话”时，前端会：

1. 调用 `session/create`
2. 拿到 `sessionId`
3. 再调用 `capabilities/get`
4. 把结果整理成一个 `AssistantSessionShell`

这个会话壳里当前主要包含：

- `sessionId`
- `boundAgent`
- `createdAt`
- `updatedAt`
- `capabilities`

其中 `capabilities` 又会带出：

- `capabilitiesVersion`
- `allAvailableTools`
- `recommendedToolsForAgent`
- `defaultEnabledTools`
- `toolSelectionMode`
- `defaultModelPreference`

## 第五层：聊天面板本地状态

聊天面板里还有一层更细的前端本地状态。

### 当前本地维护什么

聊天面板当前会维护：

- 输入框草稿
- 当前选中的模型
- 当前启用的工具列表
- `requestOptions` 文本
- 正在发送状态
- 当前面板中的消息列表

### 这层状态和后端会话状态有什么区别

这是当前很容易误写错的地方。

- 后端会话状态保留在 runtime 的内存会话存储里。
- 前端消息列表只是当前聊天面板中的可见消息状态。

也就是说：

- 前端会在本地追加用户消息、助手消息和错误消息。
- 切换到另一个会话时，当前面板里的消息列表会清空并重新开始。
- 当前前端**不会**在切换会话后主动从后端回放完整历史。

所以现在不能把当前 UI 写成“已经具备完整历史回放能力”。

## 后端会话状态现在放在哪里

### 当前使用的会话存储

后端当前使用的是内存态会话存储。

它的核心特点是：

- 以 `session_id` 为 key
- 记录会话绑定的智能体
- 保留 user / assistant 文本消息历史
- 只存在于 Python runtime 进程内存中

### 当前每条会话记录至少包含什么

后端会话记录当前至少包含：

- `session_id`
- `bound_agent_id`
- `metadata`
- `messages`
- `created_at`
- `updated_at`

### 成功发送消息后会发生什么

当 `message/send` 成功时，runtime 会：

1. 找到对应会话。
2. 校验可选的 `agent` 是否和会话绑定智能体一致。
3. 读取已有消息历史。
4. 用当前请求里的模型、工具和请求选项执行一次消息。
5. 成功后把 user / assistant 这一轮消息追加回会话。

所以当前多轮上下文的真正持有者仍然是后端会话存储，而不是前端 textarea 或本地消息数组。

## `sessionId` 和 `threadId` 现在怎么理解

当前系统里这两个名字同时存在，但地位不一样。

### 当前正式前端主路径

当前前端正式主路径使用的是：

- `sessionId`

它来自：

- `session/create`
- `capabilities/get`
- `message/send`

### 旧兼容路径

旧的 `agent/connect` / `agent/run` 仍然使用：

- `threadId`

在 runtime 内部，`threadId` 本质上仍然会映射到同一个会话标识语义上，只是这属于旧桥接方法留下的命名。

因此当前文档里更准确的写法是：

- **当前前端主路径使用 `sessionId`**
- **旧 SSE 兼容路径仍保留 `threadId` 命名**

## 当前哪些状态会自动更新

### 会自动更新到 renderer 的

配置中心公共快照现在已经支持订阅更新。

因此这些字段变化后，前端可以自动同步：

- `theme`
- `animationsEnabled`
- `agentName`
- `runtimeUrl`
- `model`

不过它们影响的对象不同：

- `theme`、`animationsEnabled` 主要影响显示。
- `runtimeUrl` 会影响连接判断。
- `model` 会影响后端下次启动时的默认模型投影。
- `agentName` 当前更多是配置连续性，不再是聊天 readiness 的主门槛。

### 当前还不会自动形成完整实时流的

下面这些状态，当前还没有形成完整、持续、对称的实时推送：

- hosted runtime 的所有变化
- 后端会话历史回放
- 当前窗口外创建的会话列表
- 会话能力面变化后的自动失效刷新

它们大多仍然是：

- 启动时读取
- 用户操作时再读
- 或在局部范围内重算

## 当前最容易误写错的几件事

### 1. 不要把 `agentName` 继续写成聊天就绪硬门槛

它现在仍然存在，但当前主路径已经不是“必须先有全局 agentName 才能聊天”。

### 2. 不要把前端会话列表写成后端持久化能力

当前前端会话列表主要还是 renderer 内存态状态。

### 3. 不要把前端消息流写成完整历史视图

当前消息区主要展示当前面板内累积的发送结果，不会自动重放后台已有历史。

### 4. 不要把统一配置中心写成所有状态的总仓库

统一配置中心现在只负责稳定配置，不负责：

- 宿主运行快照
- 会话列表
- 消息历史
- 最近消息流视图

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [聊天运行时契约](./chat-runtime-contract.md)
- [前端运行时状态参考](../frontend/reference-runtime-states.md)
- [前端当前 UI 状态说明](../frontend/ui-current-state.md)
- [后端运行与配置](../backend/run-and-config.md)

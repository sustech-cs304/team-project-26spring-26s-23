---
title: 会话与状态模型
description: 解释公开配置中心、settings workspace、宿主运行态、会话壳与后端内存会话当前怎样协同工作。
sidebar_position: 4
---

# 会话与状态模型

这份文档专门解决一个常见混淆：现在系统里有哪些状态，它们分别放在哪里，又是谁负责更新。

如果这几层没有先分开，文档里很容易把公开配置、设置页持久化、宿主运行态、会话壳和消息历史写成一团。

## 先看当前状态地图

当前系统至少需要分成六层状态来看：

| 状态层 | owner | 主要存放位置 | 典型内容 |
| --- | --- | --- | --- |
| 公开配置中心状态 | Electron 主进程负责持久化与公开投影。 | `config-center/*.json` 与公开快照。 | `theme`、`animationsEnabled`、`runtimeUrl`、`model`、`agentName`。 |
| settings workspace 普通状态 | Electron 主进程负责持久化。 | `settings-workspace-state.json`。 | provider profiles、默认模型路由、API 设置、SUSTech 普通字段。 |
| settings workspace secret 状态 | Electron 主进程负责持久化与访问控制。 | `settings-workspace-secrets.json`。 | provider API key、SUSTech CAS 密码。 |
| 宿主运行态 | Electron 主进程负责维护。 | hosted runtime 内存快照与诊断文件。 | `starting`、`ready`、`failed`、`degraded`、`runtimeUrl`、失败摘要。 |
| 会话状态 | renderer 与 Python runtime 分别持有不同部分。 | renderer 内存中的会话列表，加上后端 `InMemorySessionStore`。 | `sessionId`、`boundAgent`、创建时间、更新时间、后端消息历史。 |
| 消息级临时状态 | renderer 页面负责维护。 | 聊天面板本地 state。 | 输入草稿、当前模型、启用工具、`requestOptions`、发送中状态、当前面板消息列表。 |

这张图说明，当前系统已经不能再用“配置状态只有一层”来概括。

## 第一层：公开配置中心状态

### 公开配置中心保存的是可公开的稳定配置

公开配置中心由[`frontend-copilot/electron/config-center/service.ts`](../../frontend-copilot/electron/config-center/service.ts)负责读写，并由[`frontend-copilot/electron/config-center/public-snapshot.ts`](../../frontend-copilot/electron/config-center/public-snapshot.ts)投影为 renderer 可消费的公共快照。

当前公开快照中正式存在的字段主要有：

| 域 | 字段 | 当前作用 |
| --- | --- | --- |
| `frontendPreferences` | `theme` | 这个字段控制前端主题。 |
| `frontendPreferences` | `animationsEnabled` | 这个字段控制动画开关。 |
| `assistantBehavior` | `agentName` | 这个字段保留为助手行为偏好。 |
| `hostConfig` | `runtimeUrl` | 这个字段提供开发态 runtime 地址覆盖。 |
| `backendExposed` | `model` | 这个字段供主进程在启动 runtime 时投影默认模型。 |

### 这层状态怎样影响启动与聊天入口

[`frontend-copilot/src/features/copilot/config.ts`](../../frontend-copilot/src/features/copilot/config.ts)会把 `runtimeUrl` 和 `agentName` 提取为启动装配字段。当前真正影响连接判断的关键字段是 `runtimeUrl`。`agentName` 仍然保留在公开快照里，但它已经不是进入聊天主路径的硬门槛。

### 这层状态已经有公开订阅链路

[`frontend-copilot/src/features/copilot/config-center.ts`](../../frontend-copilot/src/features/copilot/config-center.ts)提供 `subscribeToConfigCenterPublicSnapshotUpdates()`。主进程在公开补丁生效后，会向所有窗口广播新快照。根装配收到后会重新计算 bootstrap 状态。

## 第二层：settings workspace 普通状态

### 这层状态服务的是设置工作区本身

settings workspace 普通状态定义位于[`frontend-copilot/electron/settings-workspace/schema.ts`](../../frontend-copilot/electron/settings-workspace/schema.ts)，读写逻辑位于[`frontend-copilot/electron/settings-workspace/service.ts`](../../frontend-copilot/electron/settings-workspace/service.ts)。

这部分状态当前包含很多设置页字段，例如：

- 它会保存 SUSTech 学号、邮箱和 Blackboard 下载相关字段。
- 它会保存 provider profiles 与默认模型路由。
- 它会保存 API、搜索、文档输出、数据路径、MCP 等普通设置。

### 这层状态不会进入公开快照

虽然这份文档和公开配置中心共享同一持久化根目录，但它不会被投影进 `ConfigCenterPublicSnapshot`。这意味着设置工作区的普通状态与根装配读取的公开快照是两层不同的系统状态。

renderer 访问这部分状态时，会经过[`frontend-copilot/src/workbench/settings/workspace-state.ts`](../../frontend-copilot/src/workbench/settings/workspace-state.ts)中的 `loadSettingsWorkspaceState()` 和 `saveSettingsWorkspaceState()`。

## 第三层：settings workspace secret 状态

### 这层状态单独保存敏感值

settings workspace secrets 与普通状态分开存放，文档结构同样定义在[`frontend-copilot/electron/settings-workspace/schema.ts`](../../frontend-copilot/electron/settings-workspace/schema.ts)。当前典型 secret 包括：

- provider API key。
- SUSTech CAS 密码。

### 这层状态由主进程直接 owner 持有

主进程通过[`frontend-copilot/electron/settings-workspace/main-process.ts`](../../frontend-copilot/electron/settings-workspace/main-process.ts)封装了专用接口，用于加载 secret 状态、读取具体 secret、保存 secret 和清除 secret。公开配置快照不会包含这些值，设置工作区也只能通过定向 API 与之交互。

这条边界有两个结果：

- secret 不会随公开配置广播到全局页面状态。
- “设置工作区已持久化”并不意味着“全部设置都可以通过公开快照看到”。

## 第四层：宿主运行态

### 这层状态描述的是当前 runtime 运行事实

hosted runtime 快照由主进程构建，返回结构定义在[`frontend-copilot/electron/copilot-runtime.ts`](../../frontend-copilot/electron/copilot-runtime.ts)。它回答的是下面这些问题：

- 当前本地 Python runtime 是否在启动、已就绪、失败或降级。
- 当前是否存在可用 `runtimeUrl`。
- 最近一次失败发生在什么阶段，是否可以重试。
- 当前期望模式和已解析模式分别是什么。

### 这层状态会参与根装配

[`frontend-copilot/src/CopilotAppRoot.tsx`](../../frontend-copilot/src/CopilotAppRoot.tsx)启动时，会把公开配置快照和 runtime 快照一起装配为 `CopilotBootstrapState`。因此，renderer 的 `loading`、`starting`、`ready`、`failed`、`degraded`、`empty` 和 `incomplete`，都来自配置事实和运行事实的合并结果。

## 第五层：会话状态

会话状态当前需要继续拆成三块来看。

### 智能体目录状态来自后端目录

[`frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx`](../../frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx)会在可连接状态下请求 `agents/list`，形成目录状态。目录数据来自后端，前端只做展示增强。目录项当前至少会提供：

- `agentId`。
- `status`。
- `displayName`。
- `description`。
- `recommendedTools`。
- `defaultModelPreference`。
- `iconKey`。

因此，智能体目录当前属于后端真源的一部分。

### 会话列表状态当前保留在 renderer 内存里

同一个文件中的 `AssistantSessionListState` 维护的是当前窗口里已经创建的会话列表和激活会话。它主要包含 `sessions` 与 `activeSessionId`，并通过 `appendAssistantSessionShell()` 等函数在本地更新。

这层状态当前有三个特点：

- 它主要存在于 renderer 内存里。
- 它不是公开配置中心的一部分。
- 它也不是后端提供的持久化会话列表接口。

### 当前激活会话壳已经包含正式会话能力面

创建会话时，前端会先请求 `session/create`，再请求 `capabilities/get`，最后整理出 `AssistantSessionShell`。类型定义位于[`frontend-copilot/src/workbench/types.ts`](../../frontend-copilot/src/workbench/types.ts)。

当前会话壳中至少包含：

- `sessionId`。
- `boundAgent`。
- `createdAt`。
- `updatedAt`。
- `capabilities`。

其中 `capabilities` 当前会继续带出：

- `capabilitiesVersion`。
- `allAvailableTools`。
- `recommendedToolsForAgent`。
- `defaultEnabledTools`。
- `toolSelectionMode`。
- `defaultModelPreference`。

[`frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx`](../../frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx)中的 `createAssistantSessionCapabilities()` 目前会把 `recommendedTools` 直接映射为新会话的 `defaultEnabledTools`。因此，默认启用工具来源当前就是能力面中的推荐工具集合。

## 第六层：消息级临时状态

### 这层状态只服务当前聊天面板交互

[`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx)当前会维护下面这些本地状态：

- 输入框草稿文本。
- 本次发送选中的模型。
- 本次启用的工具列表。
- `requestOptions` 文本与解析结果。
- 发送中状态。
- 当前面板可见的消息列表。

### 这层状态与后端会话历史不是同一层

聊天面板中的 `conversation` 只代表当前页面上已经展示的会话片段。用户切换到另一个会话时，面板会清空本地消息数组重新开始。当前前端不会在切换会话后自动向后端回放完整历史。

因此，消息级临时状态是界面状态，不是会话总历史。

## 会话优先聊天主路径当前怎样工作

### 第一步由后端目录给出智能体

前端首先调用 `agents/list`。返回值中会包含 `directoryVersion`、`defaultAgentId` 和智能体列表，因此会话创建前的可选智能体范围由后端目录决定。

### 第二步在创建会话时绑定智能体

前端调用 `session/create` 时会带上 `agentId`。后端响应中已经返回 `sessionId`、`boundAgent`、`createdAt`、`updatedAt`、`recommendedTools` 和 `defaultModelPreference`。因此，绑定智能体是会话的一部分，而不是事后补充出来的页面状态。

### 第三步由能力面补足正式会话上下文

前端随后调用 `capabilities/get`。当前响应会提供：

- `sessionId`。
- `boundAgent`。
- `capabilitiesVersion`。
- `tools`。
- `recommendedTools`。
- `toolSelectionMode`。
- `defaultModelPreference`。

有了这一步，当前会话壳已经能稳定表达“这个会话当前绑定了谁、有哪些可用工具、默认会启用哪些工具、当前能力版本是什么”。

### 第四步在消息请求里显式携带请求级策略

前端发送消息时会调用 `message/send`，并显式传入：

- `sessionId`。
- `agent`，用于和会话绑定智能体保持一致。
- `message`。
- `model`。
- `enabledTools`。
- `requestOptions`。

因此，当前消息主路径同时具有下面三层语义：

- 会话级语义由 `sessionId` 和 `boundAgent` 表达。
- 能力级语义由 `capabilitiesVersion`、工具目录和默认启用工具表达。
- 请求级语义由 `model`、`enabledTools` 和 `requestOptions` 表达。

## 后端会话状态目前怎样保存

### 当前使用的是进程内 `InMemorySessionStore`

[`backend/app/copilot_runtime/session_store.py`](../../backend/app/copilot_runtime/session_store.py)中的 `InMemorySessionStore` 当前按 `session_id` 保存会话。每条 `RuntimeSessionRecord` 至少包含：

- `session_id`。
- `bound_agent_id`。
- `metadata`。
- `messages`。
- `created_at`。
- `updated_at`。

### 成功发送消息后，后端会把这一轮消息追加进会话

当 `message/send` 成功时，runtime 会读取当前会话，校验请求中的可选 `agent` 是否与会话绑定一致，再按当前请求使用的模型、工具和 `requestOptions` 执行一轮消息。执行成功后，后端会把 user 与 assistant 这一轮文本追加进会话记录。

这说明，多轮上下文的正式持有者当前仍然是后端会话存储。

### 这份历史当前不会跨 runtime 重启保存

因为会话存储仍然只在 Python 进程内存里，所以 runtime 一旦重启，会话历史就会丢失。当前前端也没有一条正式的“按 `sessionId` 回放完整历史”链路。

## 当前哪些状态会自动更新

### 已经具备自动更新链路的状态

公开配置中心快照当前已经支持订阅更新。因此，`theme`、`animationsEnabled`、`agentName`、`runtimeUrl` 和 `model` 这些公开字段发生变化后，根装配可以收到新的公开快照并重新计算状态。

### 当前还没有形成完整实时流的状态

下面这些状态目前还没有形成完整、持续的实时推送：

- hosted runtime 的全部状态变化。
- settings workspace 的普通状态与 secrets 变化。
- 会话列表的跨窗口同步。
- 后端会话历史回放。
- 能力面变化后的自动失效刷新。

这些状态当前更多还是通过启动时读取、用户操作触发读取或局部重算来更新。

## 当前最容易写错的地方

### 公开配置中心不是所有状态的总仓库

公开配置中心当前只负责可公开的稳定配置。它不会负责会话列表、后端消息历史、运行失败摘要和聊天面板瞬时状态。

### settings workspace 已经是独立状态层

当前系统除了公开配置中心之外，还存在 settings workspace 普通状态层和 settings workspace secret 状态层。这两层都属于主进程持久化系统，但它们不进入公开快照。

### `agentName` 仍然存在，但当前聊天入口主要看 `runtimeUrl`

公开快照里保留 `agentName` 有其连续性价值，不过当前前端能否进入聊天主路径，关键条件仍然是有没有可用 `runtimeUrl`。

### 当前前端消息列表不是完整历史视图

聊天面板里的本地消息数组只反映当前面板已经展示的消息结果。它不等于后端会话总历史，也不能写成“已经具备完整历史回放能力”。

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [运行时生命周期](./runtime-lifecycle.md)
- [聊天运行时契约](./chat-runtime-contract.md)
- [前端运行时状态参考](../frontend/reference-runtime-states.md)
- [后端运行与配置](../backend/run-and-config.md)

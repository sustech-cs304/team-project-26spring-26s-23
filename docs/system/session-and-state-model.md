---
title: 会话与状态模型
description: 解释公开配置中心、settings workspace、宿主运行态、renderer 会话壳与后端进程内会话当前怎样分层持有。
sidebar_position: 4
---

# 会话与状态模型

这篇文档只回答一个问题：当前系统里有哪些状态，它们分别放在哪里，由谁持有，又怎样彼此影响。

系统结构见 [系统架构总览](./architecture-overview.md)，启动顺序见 [运行时生命周期](./runtime-lifecycle.md)，聊天字段与方法见 [聊天运行时契约](./chat-runtime-contract.md)。

## 先看当前状态地图

当前系统至少要分成下面六层状态来理解：

| 状态层 | 主要 owner | 主要位置 | 典型内容 |
| --- | --- | --- | --- |
| 公开配置中心状态 | Electron 主进程 | `config-center` 域文档与公开快照 | `theme`、`animationsEnabled`、`agentName`、`runtimeUrl`、`model` |
| settings workspace 普通状态 | Electron 主进程 | `settings-workspace-state.json` | provider profiles、默认模型路由、SUSTech 普通字段、API 与其他设置页字段 |
| settings workspace secret 状态 | Electron 主进程 | `settings-workspace-secrets.json` | provider API key、SUSTech CAS 密码 |
| 宿主运行态 | Electron 主进程 | hosted runtime 内存快照与诊断文件 | `starting`、`ready`、`failed`、`degraded`、`runtimeUrl`、失败摘要 |
| renderer 根装配状态 | renderer | `CopilotConfigState` | `loading`、`starting`、`ready`、`failed`、`degraded`、`empty`、`incomplete` |
| 会话与消息状态 | renderer 与 Python runtime 分层持有 | renderer 内存会话壳 + 后端 `InMemorySessionStore` + 聊天面板本地 state | 智能体目录、会话壳、消息历史、当前模型、启用工具、输入草稿 |

这张图背后最关键的一点是：当前系统已经不再是“一个 settings 文件 + 一份前端本地状态”的结构。

## 第一层：公开配置中心状态

### 这层保存的是可公开、稳定、可投影的配置

统一配置中心由 Electron 主进程读写，并投影成 renderer 可消费的公开快照。当前公开字段主要是：

| 配置域 | 字段 | 当前作用 |
| --- | --- | --- |
| `frontend-preferences` | `theme` | 控制前端主题。 |
| `frontend-preferences` | `animationsEnabled` | 控制动画开关。 |
| `assistant-behavior` | `agentName` | 保留助手偏好信息。 |
| `host-config` | `runtimeUrl` | 提供 development 场景的 runtime 地址 override。 |
| `backend-exposed` | `model` | 供主进程在启动 hosted backend 时投影默认模型参数。 |

### 这层已经具备订阅更新链路

主进程在公开补丁写回后，会广播新的公开快照。renderer 收到后会重新计算根装配状态，因此这层状态已经不是一次性读取。

### `agentName` 仍然存在，但它已经不是聊天入口门槛

当前公开快照里仍然保留 `agentName`，这对连续性和偏好记录仍然有价值。但在根装配状态里，真正决定缺失字段的关键项已经只剩 `runtimeUrl`。换句话说，`agentName` 仍然是公开配置的一部分，却不再是进入主聊天路径的硬条件。

## 第二层：settings workspace 普通状态

### 这层服务设置工作区本身

settings workspace 普通状态由主进程持久化，当前保存的是设置页需要完整回显和编辑的一整组字段，例如：

- provider profiles 与模型清单。
- 默认模型路由。
- SUSTech 学号、邮箱和 Blackboard 普通字段。
- API、搜索、数据、文档导出、MCP、记忆等设置项。

### 这层不会进入公开快照

虽然这层和统一配置中心共享同一持久化根目录，但它不会投影进公开配置快照。根装配读取的是公开配置中心；设置页自己的完整表单状态，则通过 settings workspace 独立接口读取。

### 当前首次状态已经更空白

最近实现里有一条很重要的变化：provider 与模型默认值已经清空。当前默认行为是：

- provider profiles 默认是空数组。
- 默认模型路由里的主模型与快速模型默认都是空字符串。
- 设置页首次进入时不会自动带上一组预置 provider。

这说明设置工作区的首次状态已经从“预填一组模型服务配置”收成“允许用户从空白开始配置”。

### 这层仍然保留其他类别的基础默认值

虽然 provider 与默认模型已经清空，但普通状态文档里仍然保留一些非敏感的基础默认值，例如默认语言、搜索参数、数据路径或文档导出目录。这些值属于设置页体验默认值，不等同于聊天链路已经有可用 provider 或模型。

## 第三层：settings workspace secret 状态

### secrets 已经单独成层

settings workspace secrets 与普通状态分文档保存。当前典型 secret 包括：

- provider API key。
- SUSTech CAS 密码。

### 这层继续由主进程直接持有

renderer 不能通过公开快照获取这类值，而是只能通过专门的 secrets API 去读取状态、保存或清除。当前设计强调的是“受控访问”，而不是“把敏感值并入通用页面状态”。

### secret 状态与普通状态的关系

设置页会把普通状态与 secret 状态一起水合成可编辑视图。例如 provider profile 上的 `hasApiKey` 是主进程把 secrets 状态投影回普通可编辑态后的结果，但实际 API key 仍然保存在 secret 文档里。

## 第四层：宿主运行态

### 这层描述的是当前 Python runtime 的运行事实

主进程会构建 hosted runtime 快照，并通过 preload 暴露给 renderer。当前这层状态主要回答：

- hosted backend 现在处于 `starting`、`ready`、`failed`、`degraded` 还是 `stopped`。
- 当前期望模式与已解析模式分别是什么。
- 当前有没有可用 `runtimeUrl`。
- 最近一次失败发生在什么阶段，是否可重试。

### 这层由主进程统一持有

Python runtime 自己并不会把这些状态直接推给 renderer。当前 renderer 看到的是主进程整理过的快照，因此这层状态是典型的宿主运行态，而不是页面本地状态。

## 第五层：renderer 根装配状态

### 这层是“配置事实 + 运行事实”的合成结果

renderer 启动时会并行读取公开配置快照与 runtime 快照，再合成为 `CopilotConfigState`。当前状态值包括：

- `loading`
- `starting`
- `ready`
- `failed`
- `degraded`
- `empty`
- `incomplete`

### `empty` 状态反映当前更空白的首次进入语义

当 hosted runtime 处于 `stopped`，同时公开配置里也没有 `runtimeUrl` 时，根装配会把当前状态视为 `empty`。这和当前更空白的 provider 与模型初始状态是一致的：系统允许第一次进入时没有现成的运行地址，也没有现成的模型服务配置。

### development override 会影响这层状态计算

在 development 场景里，如果公开配置中存在 `runtimeUrl` override，renderer 仍然可能进入可连接状态。这说明根装配状态不是只看 hosted backend 成功与否，还会考虑公开配置里的开发态覆盖来源。

## 第六层：会话与消息状态

这层最容易混淆，因为它其实由前后端分开持有。

### 6.1 智能体目录状态来自后端

前端进入可连接状态后，会先调用 `agents/list`。当前目录状态由后端目录给出，前端只做展示增强。目录项至少会包含：

- `agentId`
- `status`
- `displayName`
- `description`
- `recommendedTools`
- `defaultModelPreference`
- `iconKey`

因此，智能体目录当前属于后端事实，而不是前端静态常量。

### 6.2 renderer 会话壳状态只保留在当前窗口内存里

前端当前会在 renderer 内存里维护已创建的会话列表与激活会话。每个会话壳至少会包含：

- `sessionId`
- `boundAgent`
- `createdAt`
- `updatedAt`
- `capabilities`

其中 `capabilities` 当前会带出：

- `capabilitiesVersion`
- `allAvailableTools`
- `recommendedToolsForAgent`
- `defaultEnabledTools`
- `toolSelectionMode`
- `defaultModelPreference`

前端当前会把 `recommendedTools` 直接映射成 `defaultEnabledTools`，所以“新会话默认勾选哪些工具”已经进入正式会话壳，而不是聊天面板临时拼接的值。

### 6.3 会话绑定发生在后端会话级

当前正式链路里，前端会先调用 `session/create`，后端立即返回 `sessionId` 和 `boundAgent`。这意味着“某个会话属于哪个智能体”在创建时就已经固定下来。

随后如果前端在 `message/send` 里显式带了 `agent`，后端会把它当成防串会话校验值；如果它和会话绑定智能体不一致，就会返回 `agent_mismatch`。

### 6.4 后端消息历史保存在进程内 `InMemorySessionStore`

当前 Python runtime 会按 `sessionId` 持有会话记录。每条会话记录至少保存：

- `session_id`
- `bound_agent_id`
- `metadata`
- `messages`
- `created_at`
- `updated_at`

当 `message/send` 成功时，后端会把这一轮 user 与 assistant 文本追加进这份进程内历史。多轮上下文的正式持有者，当前仍然是后端会话存储。

### 6.5 这份历史当前不会跨 runtime 重启保存

因为会话存储仍然是进程内内存结构，所以 runtime 一旦重启，会话历史就会丢失。前端当前也没有一条正式的“按 `sessionId` 回放完整历史”的链路。

### 6.6 聊天面板还有一层页面级临时状态

聊天面板本地还会维护一组更短生命周期的交互状态，例如：

- 输入框草稿文本。
- 当前选中的模型。
- 当前启用的工具列表。
- `requestOptions` 文本与解析结果。
- 发送中状态。
- 当前面板中已经展示的消息列表。

这层状态只是当前页面交互所需的临时状态，不等于后端会话总历史。

## 当前哪些状态会自动更新

### 已经有明确更新链路的状态

下面这些状态当前已经有比较明确的刷新路径：

- 公开配置中心快照会在补丁写回后广播更新。
- 根装配状态会在收到公开快照后重新计算。
- settings workspace 普通状态和 secret 状态会在设置页重新加载或保存后更新。
- 会话壳会在 `session/create` 和 `capabilities/get` 完成后建立或刷新。

### 当前仍然没有完整实时流的状态

下面这些状态还没有形成完整、持续的实时推送：

- hosted runtime 的全部状态变化。
- settings workspace 跨页面、跨窗口的同步更新。
- renderer 会话列表的跨窗口同步。
- 后端完整会话历史的主动回放。
- 能力面变化后的自动失效刷新。

## 当前最容易写错的地方

### 公开配置中心不是所有状态的总仓库

它当前只负责可公开、稳定、适合根装配消费的配置事实，不负责会话列表、后端消息历史或设置页全部表单字段。

### settings workspace 已经是独立持久化面

它和统一配置中心同属主进程持久化系统，但保存的是另一类状态：设置工作区自己的完整状态与 secrets。

### `agentName` 还在，但聊天主路径已经改成 session-first

`agentName` 仍然存在于公开配置里，但正式聊天链路已经不再围绕它组织。当前会话由 `session/create` 绑定智能体，消息再通过请求级字段指定模型与工具策略。

### 首次空白状态是当前实现的一部分

当前没有预置 provider 与默认模型，并不是文档缺失，而是代码现实。看到空白的模型服务配置、空白的默认模型路由或 `empty` 根状态时，应该把它理解成当前首次启动语义，而不是异常回退。

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [运行时生命周期](./runtime-lifecycle.md)
- [聊天运行时契约](./chat-runtime-contract.md)
- [前端运行时状态参考](../frontend/reference-runtime-states.md)

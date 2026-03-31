---
title: 当前生效字段参考
description: 按持久化 owner 和当前生效范围整理 frontend 中真实存在的字段。
sidebar_position: 3
---

# 当前生效字段参考

这页只回答一个问题：前端里真正会被保存的字段，现在分别归谁管理，以及它们当前影响到哪里。页面布局和交互请看[前端当前 UI 状态](./ui-current-state.md)，页面成熟度请看[页面能力参考](./reference-page-capabilities.md)。

## 先看两层正式持久化

当前 frontend 的持久化已经分成两层：

1. 公开配置中心负责少量公开字段，并通过公共快照、公共补丁和订阅读取给 renderer。
2. settings workspace 负责大部分设置状态与 secrets，并通过专用 IPC 接口给设置页和聊天发送区使用。

两层数据当前落在同一个配置根目录下，但文档职责不同，字段 owner 也不同。

## 第一层：公开配置中心

公开配置中心当前更适合承载少量公开字段。前端今天真正依赖的公开字段，可以概括成下面这张表。

| 字段 | 当前用途 | 当前前端里的可见落点 | 备注 |
| --- | --- | --- | --- |
| `theme` | 控制桌面主题 | `显示设置` 页和启动主题链路 | 这是最明确的公开显示字段。 |
| `animationsEnabled` | 控制动画偏好 | 当前前端根节点仍会消费 | 字段仍在，但界面里不再强调它是独立主入口。 |
| `agentName` | 保留为 assistant 行为偏好与状态摘要 | 主要进入 bootstrap 诊断信息 | 当前不再作为聊天 readiness 的硬条件。 |
| `runtimeUrl` | 提供开发态运行时覆盖地址 | `API 服务器` 页中的公开配置卡片 | 这是连接判断里最关键的公开字段。 |
| `model` | 作为宿主投影给后端 runtime 的默认模型字段 | 当前没有单独突出成聊天主路径入口 | 它不等于每次消息真正发送时使用的模型。 |

### 这一层当前最容易写错的地方

- `runtimeUrl` 是开发态 override 字段，不是发布态默认后端地址。
- `agentName` 仍然存在，但现在主要起到偏好和摘要作用。
- `model` 仍然保留在公开配置中心，但它和聊天发送区的请求级模型不是一回事。

## 第二层：settings workspace state

settings workspace state 负责保存设置工作区里大部分普通字段。它当前至少包含下面这些分组。

| 分组 | 代表字段 | 当前主要被谁消费 |
| --- | --- | --- |
| `sustech` | 学号、邮箱、Blackboard 偏好 | `SUSTech 信息` 页 |
| `providerProfiles` | 服务商元数据、模型列表、默认模型、快速模型、备注等 | `模型服务` 页和聊天模型目录 |
| `defaultModelRouting` | `primaryAssistantModel`、`fastAssistantModel` | `默认模型` 页和聊天发送区默认模型选择 |
| `general` | 语言、代理、通知、自动备份 | `常规设置` 页 |
| `data` | 数据目录、备份周期、启动同步 | `数据设置` 页 |
| `mcp` | 自动发现、工具权限策略 | `MCP 服务器` 页 |
| `search` | 搜索引擎、结果数量、压缩方式 | `网络搜索` 页 |
| `memory` | 记忆策略、自动清理 | `全局记忆` 页 |
| `api` | 地址草稿、重连策略、健康轮询 | `API 服务器` 页 |
| `docs` | 导出格式、输出目录、自动文件名 | `文档处理` 页 |
| `externalSource` | `wakeupShareLink` | `外部源` 页 |

### 当前真正进入聊天主路径的 settings workspace 字段

虽然 settings workspace 里的字段很多，但当前和聊天发送区关系最直接的，主要是下面两组：

- `providerProfiles` 提供聊天面板可选模型目录。
- `defaultModelRouting.primaryAssistantModel` 提供聊天草稿的首选模型 ID。

这也解释了为什么首次初始化可以是空白状态：`initialProviderProfiles` 当前就是空数组，settings workspace 的默认 provider 与默认模型路由也会随之落成空值。前端不会再自带示例 provider 或默认模型。

## 第三层：settings workspace secrets

敏感值不会进入公开配置中心快照，而是进入 settings workspace 的 secrets 文档。

当前已经明确存在的 secret 类型有两类：

| secret 字段 | 当前用途 | 当前界面落点 |
| --- | --- | --- |
| `sustech.casPassword` | 保存校园 CAS 密码 | `SUSTech 信息` 页 |
| `providerSecrets[providerId].apiKey` | 保存服务商 API 密钥 | `模型服务` 页 |

这层的意义很直接：前端需要记住这些敏感值，但又不能把它们放进公开快照里。

## 当前初始化状态怎样理解

当前 frontend 初始化时，不会自动补出示例 provider、默认模型或预选模型目录。这个事实会直接影响两个地方：

- 设置工作区第一次打开时，`模型服务` 和 `默认模型` 可能都处于空白状态。
- 聊天面板第一次进入时，如果 settings workspace 里还没有 providerProfiles 和 defaultModelRouting，就不会自动出现内置默认模型。

这比旧文档里的“先带几个示例 provider 再修改”更接近当前代码现状。

## 当前值得优先区分的两组相似字段

### 公开 `model` 和默认模型路由

这两组名称容易相似，但作用不同：

- 公开配置中心里的 `model` 面向宿主投影给后端 runtime。
- settings workspace 里的 `defaultModelRouting` 面向前端工作区中的默认模型选择。

真正发送消息时，前端还会在 `message/send` 里显式带上本次模型 ID，因此文档里需要把这三层语义分开。

### 公开 `runtimeUrl` 和 API 页中的工作区字段

`API 服务器` 页当前同时展示两类字段：

- 公开配置中心中的 `runtimeUrl`。
- settings workspace 中的 `apiBaseUrl`、`apiReconnectMode` 和 `healthPollingEnabled`。

因此这页属于混合页。看到同一页里有很多“地址”或“连接”相关输入框时，不能默认把它们都当成当前聊天主路径的真实连接地址。

## 哪些东西不属于这份字段表

下面这些状态对前端很重要，但它们不属于持久化字段：

- 当前窗口里的会话列表。
- 当前会话能力面返回的工具目录。
- 聊天发送区这一次勾选的工具集合。
- 根装配层计算出来的 `empty`、`starting`、`degraded` 等运行态。

这些内容更适合分别去看[前端运行时状态参考](./reference-runtime-states.md)和[前端现在怎样连接后端](./backend-connection-contract.md)。

## 相关文档

- [前端当前 UI 状态](./ui-current-state.md)
- [页面能力参考](./reference-page-capabilities.md)
- [前端运行时状态参考](./reference-runtime-states.md)
- [会话与状态模型](../system/session-and-state-model.md)

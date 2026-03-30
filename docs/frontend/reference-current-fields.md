---
title: 当前生效字段参考
description: 从字段分层角度说明当前前端哪些数据属于公开配置中心，哪些属于 settings workspace 普通字段，哪些属于 settings workspace secret 字段。
sidebar_position: 3
---

# 当前生效字段参考

这份文档的目的很简单：帮助接手项目的人迅速建立一个稳定判断——**前端里的设置字段，今天分别存在哪里，又由谁来消费。**

只要先把这件事看清，后面再读设置页、聊天页和运行时状态文档，就不会把“页面里看得到的控件”“真正会被保存的字段”“当前已经进入主路径的配置”混在一起。

## 先建立一个三层视角

当前前端字段，最适合按三层来理解：

1. **公开配置中心字段**：数量不多，但会进入公共快照和系统主链路。
2. **settings workspace 普通字段**：范围更大，主要服务设置工作区本身，也会被正式持久化。
3. **settings workspace secret 字段**：专门保存敏感值，不进入公开快照。

这三层里，第一层最“公开”，第二层最“丰富”，第三层最“敏感”。

## 先看两套文件体系

### 公开配置中心

公开配置中心负责少量、公开、跨页面共享的字段。

它当前按域拆分成多份 JSON 文档，主进程负责：

- 读取与写回
- 默认值归一化
- 从旧 `copilot-settings.json` 迁移可用字段
- 向 renderer 暴露公共快照、公共补丁和更新订阅

对 renderer 来说，这一层更像“正式公开配置接口”。

### settings workspace

settings workspace 是设置工作区自己的正式持久化层。

当前至少包括两份文档：

- `settings-workspace-state.json`
- `settings-workspace-secrets.json`

它与公开配置中心共用同一配置根目录，但承担的是另一类职责：

- 公开配置中心保存少量公共字段
- settings workspace 保存更大范围的设置工作区字段与敏感值

从接手者视角看，可以把它理解成：

- **公开配置中心**回答“哪些字段属于全局公开配置接口”
- **settings workspace**回答“设置页里大量内容现在记到哪里去”

## 第一层：公开配置中心字段

### 当前域划分

| 配置域 | 当前字段 | 主要职责 |
| --- | --- | --- |
| `frontend-preferences` | `theme`、`animationsEnabled` | 前端显示偏好 |
| `assistant-behavior` | `agentName` | assistant 偏好与兼容语义 |
| `host-config` | `runtimeUrl` | 宿主连接相关公开字段 |
| `backend-exposed` | `model` | 宿主可公开投影给后端的默认模型字段 |

### 当前公开字段总表

| 字段 | 所属域 | 当前系统角色 | 在当前界面中的位置 |
| --- | --- | --- | --- |
| `theme` | `frontend-preferences` | 控制启动壳与工作台主题 | 显示设置页中的主题入口 |
| `animationsEnabled` | `frontend-preferences` | 控制动画偏好并影响前端根节点动画状态 | 当前界面里已不再单独暴露开关 |
| `agentName` | `assistant-behavior` | 保留为 assistant 偏好与配置摘要字段 | 当前设置页里已不再作为独立主入口展示 |
| `runtimeUrl` | `host-config` | 提供开发态运行时覆盖地址，参与连接判断 | API 服务器页中的开发态 runtime override 卡片 |
| `model` | `backend-exposed` | 保留为后端默认模型公开字段 | 当前需要与默认模型路由页分开理解 |

### 逐个字段怎么读

#### `theme`

这是当前最清晰的一项公开配置字段。

它已经形成完整主链路：

1. 启动壳优先读取主题。
2. 根节点应用主题数据属性。
3. 显示页允许用户切换主题。
4. 更新结果通过公开补丁写回主进程。

因此它既是“被保存的字段”，也是“会立刻影响用户看到的界面”的字段。

#### `animationsEnabled`

这个字段仍然保留在公开配置中心里，并继续影响前端动画偏好。

它的当前特点是：

- 字段仍存在
- 前端仍会消费它
- 当前显示设置页已经不再把它单独放成一个可见开关

所以在阅读文档时，可以把它理解成：

- **仍在系统里发挥作用的公开字段**
- **但已经不是当前显示页里的主入口项**

#### `agentName`

`agentName` 仍然保留在公开配置中心中。

它现在更适合这样理解：

- 作为 assistant 偏好字段继续存在
- 继续参与配置摘要与兼容语义
- 聊天主路径已经不再围绕它组织

也就是说，当前聊天真正依赖的是：

- 后端智能体目录
- 会话创建
- 会话绑定的智能体

因此 `agentName` 的位置更像“保留中的公开偏好字段”，而不是聊天主入口的决定项。

#### `runtimeUrl`

这是当前最值得优先关注的公开字段之一。

它负责：

- 提供开发态运行时覆盖地址
- 参与根层连接判断
- 决定前端能否继续进入“目录 → 会话 → 消息”主路径

从阅读顺序看，如果你正在排查“为什么前端进不了聊天主路径”，这一项通常比其它公开字段更重要。

#### `model`

`model` 继续保留在 `backend-exposed` 中，表示宿主可公开投影给后端的默认模型字段。

阅读这一项时，最重要的是先分清两个层次：

- 这一项属于**公开配置中心字段**
- 默认模型页中的“主助手模型 / 快速执行模型”属于**settings workspace 路由字段**

两者名称相近，但服务的是不同场景。

## 第二层：settings workspace 普通字段

这一层是当前设置页最值得补上的事实。

大量设置项虽然不在公开配置中心里，但已经进入 settings workspace 普通状态文档，并会被正式保存。

### 当前普通字段分组

| 分组 | 代表字段 | 当前页面语义 |
| --- | --- | --- |
| `sustech` | `studentId`、`email`、`blackboardAutoDownloadEnabled`、`blackboardDownloadLimitMb` | `SUSTech 信息` 页中的基础信息与 Blackboard 偏好 |
| `providerProfiles` | 服务商基本信息、模型列表、备注等 | `模型服务` 页的服务商与模型管理 |
| `defaultModelRouting` | `primaryAssistantModel`、`fastAssistantModel` | `默认模型` 页中的模型路由 |
| `general` | `language`、`proxyMode`、`assistantNotificationsEnabled`、`backupEnabled` | `常规设置` |
| `data` | `dataPath`、`backupCycle`、`launchSyncEnabled` | `数据设置` |
| `mcp` | `mcpAutoDiscoveryEnabled`、`toolPermissionMode` | `MCP 服务器` |
| `search` | `searchEngine`、`searchResultCount`、`compressionMode` | `网络搜索` |
| `memory` | `memoryStrategy`、`memoryCleanupEnabled` | `全局记忆` |
| `api` | `apiReconnectMode`、`healthPollingEnabled`、`apiBaseUrl` | `API 服务器` 页中的工作区字段 |
| `docs` | `docsFormat`、`outputDirectory`、`autoFileNameEnabled` | `文档处理` |
| `externalSource` | `wakeupShareLink` | `外部源` 页中的 WakeUP 分享链接 |

### 哪几组字段最值得先认识

#### `providerProfiles`

这一组字段说明，模型服务页已经是当前设置工作区里最成熟的一部分之一。

它会记住的内容包括：

- 服务商名称、协议、地址
- 默认模型、快速模型、回退模型
- 组织、区域、备注
- 服务商拥有的模型清单
- 每个模型的能力标记与附加信息

因此当你看到模型服务页里的这些交互时，可以直接把它理解成 settings workspace 的正式持久化能力：

- 添加服务商
- 复制服务商
- 删除服务商
- 排序服务商
- 编辑模型列表

#### `defaultModelRouting`

这组字段与当前默认模型页一一对应。

它承载的是：

- `primaryAssistantModel`
- `fastAssistantModel`

从命名上就能看出，这一层关注的是“当前前端如何在不同场景下选模型路由”，而不是“宿主公开给后端的默认模型字段”。

#### `api`

`API 服务器` 页中同时存在两类字段：

1. 公开配置中心中的 `runtimeUrl`
2. settings workspace 中的 `apiBaseUrl`、`apiReconnectMode`、`healthPollingEnabled`

这也是为什么这页读起来最像一个“混合页”：

- 一部分字段直接参与当前连接主路径
- 一部分字段属于设置工作区自己的长期记录

## 第三层：settings workspace secret 字段

敏感值当前不进入公开快照，而是单独保存在 settings workspace secret 文档中。

### 当前 secret 字段总表

| secret 字段 | 当前用途 | 当前界面位置 |
| --- | --- | --- |
| `sustech.casPassword` | 保存校园 CAS 密码 | `SUSTech 信息` 页 |
| `providerSecrets[providerId].apiKey` | 保存服务商 API 密钥 | `模型服务` 页 |

### 这一层的实际意义

从接手者角度看，secret 层解决的是两个非常实际的问题：

1. 敏感值需要被长期记住。
2. 它们又不适合进入公开配置快照。

当前界面里的表现也与此一致：

- provider API key 有独立的保存、清除和状态读取链路
- CAS 密码也有独立的读取、保存和清除链路
- 已保存的 secret 会在界面中重新载入并回填到对应表单

因此 settings workspace 的持久化范围，应该始终分成：

- 普通字段
- secret 字段

## 阅读字段时，建议按这个顺序判断

当你遇到一个新字段时，可以顺着下面三个问题判断它归哪一层：

### 问题 1：它会不会进入公共快照

如果答案是会，它大概率属于公开配置中心。

### 问题 2：它是不是设置页里的长期工作区字段

如果答案是会，而且又不需要进入公共快照，它通常属于 settings workspace 普通字段。

### 问题 3：它是不是敏感值

如果答案是会，它通常属于 settings workspace secret 字段。

这个判断顺序对阅读当前前端特别有帮助，因为它正好对应了三种不同的文档责任：

- 公开配置说明
- 设置工作区说明
- secret 管理说明

## 两组最值得优先分清的字段关系

### 1. 公开 `model` 与默认模型路由

这两组字段经常同时出现，但职责不同：

- 公开配置中心里的 `model`：面向宿主公开投影给后端的默认模型字段
- settings workspace 里的 `defaultModelRouting`：面向前端设置工作区的模型路由字段

阅读时先把这两个层次拆开，会更容易理解为什么当前默认模型页看上去和公开字段名称相近，但语义并不相同。

### 2. `runtimeUrl` 与 API 页中的工作区字段

在 `API 服务器` 页里：

- `runtimeUrl` 属于公开配置中心
- `apiBaseUrl`、`apiReconnectMode`、`healthPollingEnabled` 属于 settings workspace

这说明当前 API 页并不是单一来源页面，而是一个同时承载公开配置与工作区配置的混合页。

## 还有哪些状态不属于这三层

为了把字段文档和运行态文档区分开，还可以顺手记住几类“不是持久化字段”的状态：

- 聊天面板中的请求级模型选择
- 聊天面板中的工具选择结果
- 当前窗口中的会话列表
- 根层 bootstrap 的瞬时运行态摘要

这些状态对当前界面很重要，但它们更适合放在运行时状态和聊天主路径文档中理解。

## 快速结论

如果只用一句话概括当前前端字段层次，可以这样记：

- **公开配置中心**保存少量公开字段
- **settings workspace 普通层**保存大范围设置工作区字段
- **settings workspace secret 层**保存敏感值

有了这个框架，再去阅读当前设置页，就会更容易看出：

- 哪些项进入了系统主链路
- 哪些项已经能被长期记住
- 哪些项属于敏感值管理

## 相关文档

- [前端分册入口](./README.md)
- [页面能力参考](./reference-page-capabilities.md)
- [前端当前 UI 状态说明](./ui-current-state.md)
- [前端运行时状态参考](./reference-runtime-states.md)
- [系统架构总览](../system/architecture-overview.md)

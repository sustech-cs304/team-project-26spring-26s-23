---
title: 前端现在怎样连接后端
description: 说明 renderer 当前如何根据配置中心与 hosted runtime 事实进入 session-first 聊天主路径。
sidebar_position: 2
sidebar_label: 后端连接契约
---

# 前端现在怎样连接后端

这篇文档专门回答一个问题：

> 前端现在到底靠什么条件，才能真正开始和后端说话？

如果你最近读过旧文档，最需要先忘掉两件事：

1. 不是 renderer 自己直接围着旧 settings 文件转。
2. 也不是“先拿到全局 agentName，再直接进入聊天”。

## 先给结论

当前前端连接后端分成两段：

### 第一段：先判断“有没有可用运行时”

根装配层会同时读取：

- 配置中心公共快照
- hosted runtime 快照

然后据此判断当前有没有可用 `runtimeUrl`。

### 第二段：进入 session-first 聊天主路径

只有当 renderer 已经处于 connectable 状态时，助手工作区才会继续：

1. 调用 `agents/list` 拉后端智能体目录。
2. 选择一个智能体。
3. 调用 `session/create` 创建会话。
4. 调用 `capabilities/get` 读取这个会话的能力面。
5. 调用 `message/send` 发送消息，并在请求里显式带上模型和工具选择。

这意味着当前主路径已经变成：

- **后端目录是真源**
- **会话绑定智能体**
- **请求级决定模型和工具**

## 当前连接信息从哪里来

### 1. 配置中心公共快照

renderer 现在通过 preload 读取配置中心公共快照。

快照里当前有 4 个域：

- `frontendPreferences`
- `assistantBehavior`
- `hostConfig`
- `backendExposed`

其中和连接最直接相关的是：

- `hostConfig.runtimeUrl`
- `assistantBehavior.agentName`

但这两个字段现在的地位已经不同了。

#### `runtimeUrl` 的当前地位

`runtimeUrl` 现在主要是：

- 开发态运行时覆盖地址

它只会在特定条件下被拿来当连接地址，而不是发布态默认后端地址。

#### `agentName` 的当前地位

`agentName` 仍然保留在配置中心里，也有正式设置入口。

但当前准确说法是：

- 它是 assistant 行为偏好字段；
- 当前不会自动替用户创建会话；
- 当前也不再作为聊天 readiness 的硬门槛。

所以现在不能再把系统写成“缺少 `agentName` 就无法进入聊天主路径”。

### 2. Hosted runtime 快照

renderer 还会读取主进程维护的 hosted runtime 快照。

这部分表示的是宿主当前的运行事实，例如：

- hosted 状态：`stopped`、`starting`、`ready`、`failed`、`degraded`
- 当前可用 runtime URL
- 运行模式
- 是否为打包态
- 最近失败摘要

这部分是**运行事实**，不是用户设置。

## 当前最小桥接面是什么

preload 当前暴露给 renderer 的能力很克制：

- 读取配置中心公共快照
- 订阅配置中心公共快照更新
- 发送配置中心公共补丁
- 读取 hosted runtime 快照
- 触发一次受控的 runtime retry

它不会直接把这些能力交给 renderer：

- 底层配置文件路径
- Python 启动参数
- local token 明文
- 任意日志文件读写
- 任意文件系统访问

因此，renderer 现在拿到的是一个已经裁剪过的 UI 友好外观。

## 应用启动时怎样决定“能不能继续连后端”

当前大致按下面的顺序工作：

1. 根装配层读取配置中心公共快照。
2. 根装配层读取 hosted runtime 快照。
3. renderer 先判断宿主当前有没有给出可用 runtime URL。
4. 如果宿主没有给出，再判断当前是否允许使用开发态 override。
5. 最后把结果整理成当前 bootstrap 状态。

当前最重要的变化是：

- readiness 不再以全局 `agentName` 为硬门槛；
- 根装配层也不再靠旧 Provider 成功与否决定聊天主路径；
- 当前主路径先解决“有没有可用 runtime”，再进入“目录 → 会话 → 消息”。

## `runtimeUrl` 现在到底怎么选

### 宿主已经给出可用地址时

当 hosted runtime 状态是：

- `ready`
- `degraded`

前端会继续把宿主给出的地址当作当前连接地址。

### 宿主没给出可用地址时

当 hosted runtime 状态是：

- `failed`
- `stopped`

前端才会继续判断，当前是否满足开发态 override 条件：

- 不是打包态
- 当前运行模式是 development
- 配置中心里已经填写了 `hostConfig.runtimeUrl`

满足时，才会使用这个 override。

### 当前优先级

可以直接记成：

1. 宿主提供的 hosted runtime URL
2. 开发态 override
3. 无可用地址

## 当前前端连接后端后的正式主路径

### 第一步：拉智能体目录

当 bootstrap 状态已经是 connectable 时，助手工作区会先调用：

- `agents/list`

这一步的意义是：

- 当前有哪些智能体可选，以后端返回为准。
- 前端不会再把本地静态列表当聊天真源。

### 第二步：创建会话

用户选择智能体后，前端会调用：

- `session/create`

这一步的意义是：

- 创建一个新的 `sessionId`
- 把当前智能体绑定到这个会话上

### 第三步：读取能力面

会话创建成功后，前端会调用：

- `capabilities/get`

这一步主要拿到：

- 可用工具目录
- 推荐工具集合
- 默认模型偏好提示
- 当前能力面版本号

### 第四步：发送消息

真正发送消息时，前端会调用：

- `message/send`

并在请求里显式带上：

- `sessionId`
- 可选的 `agent` 校验值
- 当前用户消息
- 本次模型 ID
- 本次启用工具列表
- 本次请求选项

这就是当前“请求级模型 / 工具策略”的实际落点。

## 模型和工具现在分别在哪里决定

### 模型

当前要分清两类模型概念：

1. **后端默认模型字段**
   - 来自配置中心的 `backendExposed.model`
   - 由宿主在下次完整启动时投影成 Python `--model`

2. **本次消息使用的模型**
   - 来自聊天面板中的模型选择器
   - 通过 `message/send` 显式传给后端

所以现在不能把 `backendExposed.model` 写成“当前聊天每次消息最终都会用它”。

### 工具

当前工具选择来自会话能力面：

- 后端通过 `capabilities/get` 告诉前端当前有哪些工具
- 前端工具选择器再从这份目录里选择本次启用项
- `message/send` 把这些启用项作为 `enabledTools` 发给后端

因此工具选择现在已经不只是 UI 装饰，而是进入了真实请求契约。

## 配置更新后会不会影响连接状态

会，但需要分清两类更新。

### 会自动反映的：配置中心更新

当前配置中心公共快照已经支持订阅更新。

因此这些字段更新后，renderer 能收到变化：

- `theme`
- `animationsEnabled`
- `agentName`
- `runtimeUrl`
- `model`

其中和连接判断最相关的是：

- `runtimeUrl`

### 当前还不是完整实时流的：runtime 运行事实

另一方面，hosted runtime 事实当前还不是一套完整持续推送流。

所以现在不能把系统写成：

- “所有运行态变化都会实时流式推送到前端”

更准确的说法是：

- 配置中心更新已经能推到前端；
- runtime 事实仍然主要是快照式读取与重试后重算。

## 旧设置链路现在还剩什么

这里最容易混淆，必须分开写。

### Renderer 侧

renderer 已经不再直接使用旧 `copilot settings` renderer 语义。

现在 renderer 的正式入口是：

- 配置中心公共快照
- 配置中心公共补丁
- hosted runtime 快照

### Main process 内部

主进程内部仍然保留从旧 `copilot-settings.json` 提取字段的迁移语义。

它现在主要做的是：

- 在新的分域文档不存在时
- 从旧文件里尝试迁移 `runtimeUrl` 和 `agentName`

所以旧文件现在还有价值，但这个价值是：

- **迁移输入源**

而不是：

- **renderer 当前正式接口**

## 当前不要再写成这些说法

下面这些写法现在都不准确：

- “前端现在还是靠全局 `agentName` 决定聊天是否可用。”
- “只要 runtime ready 且有 `agentName`，就会直接进入聊天。”
- “前端主路径还是旧 Provider 挂载后的消息链路。”
- “智能体列表主要是前端静态定义。”
- “工具选择器只是界面样式，没有真实请求语义。”
- “`backendExposed.model` 就是当前每条消息实际使用的模型。”

## 继续阅读

- [当前生效字段参考](./reference-current-fields.md)
- [前端运行时状态参考](./reference-runtime-states.md)
- [前端当前 UI 状态说明](./ui-current-state.md)
- [系统架构总览](../system/architecture-overview.md)
- [聊天运行时契约](../system/chat-runtime-contract.md)

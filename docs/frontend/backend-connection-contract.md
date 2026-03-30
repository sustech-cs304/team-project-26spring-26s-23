---
title: 前端现在怎样连接后端
description: 从 renderer 视角说明当前怎样判断连接可用，并进入 session-first 聊天主路径。
sidebar_position: 2
sidebar_label: 后端连接契约
---

# 前端现在怎样连接后端

这页只从前端视角说明当前连接链路。系统级 HTTP 方法、请求体和响应体，已经收口在[聊天运行时契约](../system/chat-runtime-contract.md)。这里关注的是：renderer 先读哪些输入，怎样判断自己可以继续往下走，连接建立后前端实际会做什么。

## 当前连接链路分成三段

1. 根装配层先判断有没有可用 `runtimeUrl`。
2. 助手工作区再进入“目录、会话、消息”这条 session-first 主路径。
3. 聊天面板在每次发送消息时显式带上模型和工具选择。

## 第一段：根装配层怎样判断可连接

当前前端会先同时读取两类输入：

- 公开配置中心的公共快照。
- 主进程维护的 hosted runtime 快照。

公开配置中心当前包含 `theme`、`animationsEnabled`、`agentName`、`runtimeUrl` 和 `model` 这些公开字段。这里真正影响聊天连接判断的字段，仍然是 `runtimeUrl`。

hosted runtime 快照提供的是宿主当前运行事实，例如：

- 当前状态值。
- 当前可用地址。
- 运行模式。
- 是否处于打包态。
- 最近失败摘要。

根装配层会把这两类输入合并，得到当前 bootstrap 状态。

## 当前 `runtimeUrl` 的选择顺序

前端当前按下面的顺序决定真正使用哪个地址：

1. 宿主已经给出可用 hosted runtime 地址时，优先使用宿主管理的地址。
2. 宿主没有给出可用地址，但当前处于开发模式、不是打包态，而且公开配置中心里已经填写 `runtimeUrl` 时，允许使用开发态 override。
3. 上面两条都不满足时，当前没有可用地址。

可以把这条规则理解成“先看宿主运行事实，再看开发态覆盖地址”。

## `agentName` 在当前连接链路里的位置

`agentName` 仍然保留在公开配置中心里，也会继续进入前端状态对象和诊断摘要。

当前聊天 readiness 已经不再依赖它。只要前端拿到了可用 `runtimeUrl`，就可以继续进入后面的 session-first 路径。真正决定聊天对象的步骤，已经后移到了智能体目录选择和会话创建。

## 第二段：前端怎样进入 session-first 聊天主路径

当前 bootstrap 状态进入可连接分支后，助手工作区会按下面的顺序继续：

1. 调用 `agents/list` 拉取后端智能体目录。
2. 让用户从目录里选择一个智能体。
3. 调用 `session/create` 创建会话，并把当前智能体绑定到这个 `sessionId` 上。
4. 调用 `capabilities/get` 读取这个会话的能力面。

这条路径已经把聊天主线收口为三件事：

- 智能体目录以后端返回为准。
- 会话是聊天过程中的明确边界。
- 工具目录和默认模型偏好先挂在会话能力面上，再进入发送阶段。

## 第三段：模型和工具怎样进入消息发送

进入会话后，前端会再读取 settings workspace 状态，用来补齐聊天发送区自己的模型目录与默认路由。

当前聊天模型目录来自 settings workspace 里的两组数据：

- `providerProfiles` 提供可选模型列表。
- `defaultModelRouting.primaryAssistantModel` 提供首选模型 ID。

聊天面板会先把 `providerProfiles` 展开成模型目录，再尝试用 `primaryAssistantModel` 找到匹配项。匹配成功时，输入区会用它作为当前草稿模型；如果 settings workspace 里还没有任何 provider 或模型，聊天区会保持空白模型状态，并提示用户先去设置页补齐模型服务。

这也是当前一个容易写错的事实：前端聊天模型目录不再依赖静态内置默认模型。首次初始化可以是完全空白的。

工具选择的来源也已经明确：

- `capabilities/get` 返回当前会话可用的工具目录、推荐工具和默认启用项。
- 前端工具选择器从这份能力面里生成本次消息的工具草稿。

真正发送消息时，前端会调用 `message/send`，并在请求里显式带上：

- `sessionId`
- 可选的 `agent` 校验值
- 当前用户消息
- 本次模型 ID
- 本次启用工具列表
- 当前请求选项

因此，模型和工具都已经进入请求级策略，而不是停留在界面展示层。

## 前端当前依赖的最小桥接面

从 renderer 视角看，当前真正依赖的桥接面相对克制：

- 读取、订阅和写回公开配置中心公共快照。
- 读取 hosted runtime 快照，并触发受控 retry。
- 读取和保存 settings workspace 的 state 与 secrets。

前端不会直接持有底层配置文件路径、启动参数、原始日志文件或任意文件系统访问能力。它拿到的是已经过裁剪的 UI 友好接口。

## 当前连接链路里的几条边界

- 首次初始化不会自动生成示例 provider，也不会自动填入默认聊天模型。
- `backendExposed.model` 仍然是公开配置字段，但它对应的是宿主投影给后端 runtime 的默认模型，不等于聊天面板本次消息最终使用的模型。
- runtime 运行事实当前仍以快照读取和重试后重算为主，前端还没有拿到完整持续推送的运行时流。
- `外部源`、WakeUP 解析和其他设置页流程都不属于当前稳定的后端连接主路径。

## 相关文档

- [前端当前 UI 状态](./ui-current-state.md)
- [当前生效字段参考](./reference-current-fields.md)
- [前端运行时状态参考](./reference-runtime-states.md)
- [会话与状态模型](../system/session-and-state-model.md)
- [聊天运行时契约](../system/chat-runtime-contract.md)

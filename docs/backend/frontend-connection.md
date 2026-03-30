---
title: 前后端连接现状说明
description: 从当前代码事实出发，说明后端今天已经能向前端提供什么，以及哪些能力仍不是正式业务接口。
sidebar_position: 5
sidebar_label: 前后端连接现状
---

# 前后端连接现状说明

这是一份现状说明，不是未来接口设计稿。

它重点回答的是：

- 当前前端今天到底已经能从后端连到什么。
- 哪些东西已经是正式聊天主路径的一部分。
- 哪些 Blackboard / TIS 能力还不能写成面向前端的完整业务 API。

## 先给结论

当前前后端连接已经不能再写成“前端只能参考 CLI 输出，尚无真实后端接口”。

更准确的说法是：

### 当前已经存在的正式前端连接面

- desktop runtime 控制面端点
- session-first 聊天主路径：
  - `agents/list`
  - `session/create`
  - `capabilities/get`
  - `message/send`

### 当前还没有整体形成正式业务 API 的部分

- Blackboard 复杂业务 Web API
- TIS 复杂业务 Web API
- 跨领域统一服务化接口层

所以现在系统的真实状态是：

- **聊天运行时接口已经存在并被前端使用**
- **Blackboard / TIS 业务能力仍主要停留在 CLI、工具层和 provider 能力层**

## 当前前端真正已经在连什么

### 1. Desktop runtime 控制面

前端当前可以观察和依赖的控制面端点包括：

- `GET /health`
- `GET /ready`
- `GET /version`
- `GET /build-info`
- `GET /diagnostics`
- `GET /diagnostics/runtime-info`

这些端点主要回答：

- 本地 runtime 是否启动
- 当前是否 ready
- 当前运行模式和版本信息
- 当前诊断摘要

### 2. 当前聊天主路径

前端当前正式聊天主路径已经是：

1. `agents/list`
2. `session/create`
3. `capabilities/get`
4. `message/send`

这四条接口现在已经不是草案，而是当前前端实际使用的后端连接面。

#### 它们分别解决什么问题

- `agents/list`
  - 后端告诉前端当前有哪些智能体

- `session/create`
  - 前端把用户选中的智能体绑定到一个新会话

- `capabilities/get`
  - 后端告诉前端这个会话当前可见的工具目录、推荐工具和模型偏好提示

- `message/send`
  - 前端发消息时显式带上本次模型、工具和请求参数

因此现在前后端对齐时，真正需要先对齐的，不再是“有没有全局 agentName”，而是：

- 智能体目录
- 会话绑定
- 能力面版本
- 请求级模型 / 工具策略

## 当前还不能写成完整前端业务接口的内容

### 1. Blackboard 方向

Blackboard 当前已经有：

- CLI
- 工具层返回字典
- 结构化结果对象
- 数据同步和本地持久化链路

但它当前还没有整体收束成：

- 面向前端的正式业务 Web API

### 2. TIS 方向

TIS 当前已经有：

- provider use case
- 结构化结果对象
- 部分持久化能力

但它也还没有整体收束成：

- 面向前端的正式业务 Web API

### 3. `api/` 目录不等于前端 API 层

当前 `blackboard/api/` 和 `teaching_information_system/api/` 主要是：

- 访问上游系统
- 抓取数据
- 解析页面或 JSON

它们不是：

- 给前端直接调用的 Web API 层

## 如果今天要和前端对齐，应该怎样说

当前比较稳妥的说法是：

### 已经可以直接联调的

- 本地 desktop runtime 控制面
- session-first 聊天主路径四方法

### 可以作为未来服务化输入的

- Blackboard CLI 输出 JSON
- Blackboard 工具层返回字典
- TIS provider 结果对象
- 本地数据库中最终沉淀的数据结构

### 还不能当成已完成服务接口的

- Blackboard / TIS 复杂业务 Web API
- 统一鉴权后的业务服务层
- 稳定的跨领域资源接口集合

## 当前前端最适合参考哪些后端内容

如果前端团队当前目的是：

- 理解聊天主路径
- 提前理解未来业务数据方向

那么最值得先看的内容是：

1. desktop runtime 控制面契约
2. session-first 聊天契约
3. Blackboard CLI JSON 报告
4. Blackboard 工具层返回字典
5. TIS provider 结果对象

这组材料能帮助前端回答两类问题：

- 当前已经能真实连接到什么
- 未来业务能力可能会产出什么数据

## 当前更像“两个层次的连接”

### 第一层：已经可用的聊天运行时连接

这是当前已经真实存在的运行时连接面。

### 第二层：未来待服务化的业务能力连接

这是 Blackboard / TIS 相关能力目前所处的位置。

因此，当前前后端连接的真实形态不是“完全没有接口”，而是：

- **聊天运行时接口已经存在**
- **业务能力接口仍待进一步服务化**

## 联调阶段的现实建议

如果今天要推进前后端协作，较现实的顺序通常是：

1. 先按当前聊天运行时契约完成聊天主路径联调
2. 再根据前端实际页面需求梳理 Blackboard / TIS 需要暴露的数据视图
3. 对照当前 CLI 输出和工具层结果，整理哪些字段已经具备、哪些字段还缺
4. 在真正进入业务联调前，再把这些能力收束成正式 API 草案

## 一句话总结

当前前后端之间已经有一条正式可用的本地聊天连接面，但 Blackboard / TIS 复杂业务能力仍主要停留在内部能力层和可观察输出层，尚未整体收束为正式前端业务接口。

---
title: 未来 API 草案参考
description: 记录 backend 未来若继续服务化可能扩展的资源方向与待决问题。
sidebar_position: 8
---

# 未来 API 草案参考

只保留未来草案，不记录当前事实。已落地的实现请回看[后端暴露契约与前端接入点](./frontend-connection.md)和[当前契约参考](./reference-current-contracts.md)。

## 使用方式

以下内容只按"未来可能的服务化方向"理解，均未定型：

- 已开放接口。
- 已冻结字段。
- 已承诺 URL 设计。
- 已确定鉴权和错误码方案。

如果一项内容只存在于这页，它在 backend 分册里就只是草案。

## 草案的出发点

后端已有几类可以继续收束的能力基础：

- Blackboard 的 CLI、工具层和同步能力。
- TIS 的 provider 用例和结构化结果对象。
- 现有 runtime 已形成的会话、能力面和消息执行语义。

未来如果继续服务化，这些现有能力更可能被整理成资源接口，而不是推倒重做一套完全无关的新边界。

## Blackboard 方向的草案资源

### 课程目录搜索

最易继续服务化的能力：Blackboard 课程目录搜索，已同时具备 CLI、工具层返回和结构化结果对象。

可能的资源方向：

```text
GET /api/blackboard/course-catalog/search
```

草案层面可保留的查询参数方向：

- `keyword`
- `field`
- `operator`
- `limit`

### 日历刷新与事件读取

Blackboard 日历方向已有同步入口，服务化通常需拆成两类资源：

```text
POST /api/blackboard/calendar/refresh
GET /api/blackboard/calendar/events
```

前者是触发同步动作，后者是日历视图消费的数据接口。

### Snapshot 同步任务

Blackboard snapshot 同步能力已经很完整。若放进正式 API，更自然的形态可能是任务接口：

```text
POST /api/blackboard/snapshots/sync
```

如果走到这一步，还需补齐：同步是否异步、是否需要任务状态、是否保留历史记录。

## TIS 方向的草案资源

TIS 能力基础比 Blackboard 更分散，草案保持克制。

### 个人成绩

```text
GET /api/tis/personal-grades
```

### 学分绩

```text
GET /api/tis/credit-gpa
```

### 已选课程

```text
GET /api/tis/selected-courses
```

如果未来对接页面，可能引入查询参数：

- `semester`
- `page_num`
- `page_size`

### 诊断类接口

TIS 也可能整理出链路诊断相关接口：

```text
POST /api/tis/diagnostics/link-check
```

这类接口更偏向内部诊断和运维用途，不一定适合变成普通页面依赖的公开接口。

## runtime 外围能力的草案方向

聊天主契约已成立，未来补接口的方向不是重写聊天根端点，而是补齐外围管理能力。

### 会话列表与历史回放

```text
GET /api/runtime/sessions
GET /api/runtime/sessions/{sessionId}/messages
```

### 会话管理动作

- 删除会话。
- 重命名会话。
- 归档会话。
- 标记固定会话。

这些内容今天还不属于已实现事实。

## 服务化之前需补齐的问题

- 统一鉴权方式。
- 错误码和失败响应的稳定性。
- 同步动作是同步执行还是异步任务。
- 字段版本管理。
- 日志、诊断信息的暴露边界。
- 本地 SQLite、桌面 runtime 与未来正式服务部署之间的分层。

这些问题今天没有统一答案，所以这页只保留方向。

## 引用方式

- "如果未来继续服务化，可以优先从这些资源方向整理。"
- "下面这些 URL 和字段只代表草案，不代表接口承诺。"
- "真实契约以后端 runtime 和参考页为准。"

## 快速结论

- Blackboard 与 TIS 都已具备未来服务化的材料基础。
- runtime 外围管理能力存在扩展空间。
- 只要这些内容还停留在这页，它们就只是草案。

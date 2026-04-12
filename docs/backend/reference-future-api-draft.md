---
title: 未来 API 草案参考
description: 记录 backend 未来若继续服务化，可能扩展出的资源方向与待决问题。
sidebar_position: 8
---

# 未来 API 草案参考

这页只保留未来草案，不记录当前事实。当前已经落地的实现，请回看[后端暴露契约与前端接入点](./frontend-connection.md)和[当前契约参考](./reference-current-contracts.md)。

## 使用方式先说清楚

下面所有内容都只能按“未来可能的服务化方向”理解，不能当成：

- 当前已开放接口。
- 已冻结字段。
- 已承诺 URL 设计。
- 已确定鉴权和错误码方案。

如果一项内容还只存在于这页，它在 backend 分册里就仍然只是草案。

## 草案的出发点

当前后端已经有几类可以继续收束的能力基础：

- Blackboard 的 CLI、工具层和同步能力。
- TIS 的 provider 用例和结构化结果对象。
- 现有 runtime 已经形成的会话、能力面和消息执行语义。

未来如果真的继续服务化，这些现有能力更可能被整理成资源接口，而不是推倒重做一套完全无关的新边界。

## Blackboard 方向的草案资源

### 课程目录搜索

当前最容易继续服务化的一类能力，是 Blackboard 课程目录搜索。它已经同时具备 CLI、工具层返回和结构化结果对象。

可能的资源方向示意如下：

```text
GET /api/blackboard/course-catalog/search
```

草案层面可以先保留这些查询参数方向：

- `keyword`
- `field`
- `operator`
- `limit`

### 日历刷新与事件读取

Blackboard 日历方向的能力已经有同步入口，但若要真正服务化，通常需要拆成两类资源：

```text
POST /api/blackboard/calendar/refresh
GET /api/blackboard/calendar/events
```

前者更像触发同步动作，后者才更接近日历视图真正会消费的数据接口。

### Snapshot 同步任务

Blackboard snapshot 同步能力已经很完整，但如果以后要放进正式 API，更自然的形态可能会偏向任务接口：

```text
POST /api/blackboard/snapshots/sync
```

如果走到这一步，还会继续遇到一些必须补齐的问题，例如同步是否异步、是否需要任务状态，以及是否保留历史记录。

## TIS 方向的草案资源

TIS 当前能力基础比 Blackboard 更分散，因此草案更适合保持克制。

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

如果未来真的对接页面，这类资源还可能继续引入这些查询参数：

- `semester`
- `page_num`
- `page_size`

### 诊断类接口

TIS 也可能继续整理出链路诊断相关接口，例如：

```text
POST /api/tis/diagnostics/link-check
```

不过这类接口更可能偏向内部诊断和运维用途，不一定适合直接变成普通页面依赖的公开接口。

## runtime 外围能力的草案方向

既然当前聊天主契约已经成立，未来如果继续补接口，更自然的方向通常不是重写聊天根端点，而是补齐外围管理能力。

### 会话列表与历史回放

如果以后要做会话恢复和历史重建，可能会出现这类资源：

```text
GET /api/runtime/sessions
GET /api/runtime/sessions/{sessionId}/messages
```

### 会话管理动作

继续往前走时，也可能出现这些动作接口：

- 删除会话。
- 重命名会话。
- 归档会话。
- 标记固定会话。

这些内容今天都还不属于已实现事实。

## 真正服务化之前仍要补齐的问题

如果未来真的从草案走向正式 API，至少还要先补清这些问题：

- 统一鉴权方式是什么。
- 错误码和失败响应怎样稳定下来。
- 同步动作是同步执行还是异步任务。
- 哪些字段需要版本管理。
- 哪些日志、诊断信息允许暴露给前端。
- 本地 SQLite、桌面 runtime 与未来正式服务部署之间如何分层。

这些问题在今天都还没有形成统一答案，所以这页只保留方向，不给出过度肯定的承诺。

## 这页在其他文档里应该怎样被引用

更合适的引用方式通常是：

- “如果未来继续服务化，可以优先从这些资源方向整理。”
- “下面这些 URL 和字段只代表草案，不代表当前接口承诺。”
- “当前真实契约仍以后端当前 runtime 和参考页为准。”

## 快速结论

- Blackboard 与 TIS 都已经具备未来服务化的材料基础。
- runtime 外围管理能力也存在继续扩展的空间。
- 但只要这些内容还停留在这页，它们就仍然只是草案。

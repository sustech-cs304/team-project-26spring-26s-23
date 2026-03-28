---
title: 未来 API 草案参考
description: 草拟未来后端在现有 runtime 之外，可能进一步收束出的业务 API 方向，不代表当前实现承诺。
sidebar_position: 8
---

# 未来 API 草案参考

> 这是一份**未来草案**，不是当前已经实现或已经承诺的接口规范。
>
> 当前已经存在 desktop runtime 控制面和 session-first 聊天 runtime。本文讨论的是：在这些已实现事实之外，未来如果继续做业务服务化，最自然的资源方向可能是什么。

## 先确认边界

当前已经是事实的内容包括：

- desktop runtime 已经可以启动本地 HTTP 服务
- 当前已有控制面端点
- 当前已有聊天主路径：
  - `agents/list`
  - `session/create`
  - `capabilities/get`
  - `message/send`

因此本文不是在重复设计这些现有 runtime 契约，而是讨论：

- Blackboard / TIS 领域能力未来如果服务化，可能长成什么资源形态
- 当前 runtime 之外，还可能需要补哪些业务或管理接口

## 使用边界

下面所有内容都只能按“未来可能的整理方向”理解，不能当成：

- 当前已开放接口
- 已冻结字段
- 已承诺 URL 设计
- 已确定鉴权和错误码方案

## 草案设计原则

如果未来要从当前代码形态走向正式 API，比较合理的原则应是：

1. 先沿用现在已经真实存在的能力边界
2. 优先把当前 CLI 输出和工具返回字典收束成资源接口
3. 不把内部 DTO、日志明细和实现细枝末节原样暴露给前端
4. Blackboard 与 TIS 分开建模，不假装它们成熟度完全一致
5. 当前 runtime 已做实的聊天契约不再重复推翻，而是在其外继续补业务层接口

## 1. Blackboard 方向的草案资源

### 1.1 课程目录搜索

#### 对应当前事实

- 已有课程目录搜索 CLI
- 已有工具层字典返回
- 已有结构化结果对象

#### 草案资源方向

```text
GET /api/blackboard/course-catalog/search
```

#### 草案查询参数

| 参数 | 含义 | 来源依据 |
| --- | --- | --- |
| `keyword` | 搜索关键词 | 当前 CLI 必填参数 |
| `field` | 搜索字段 | 当前 CLI / 工具层已支持 |
| `operator` | 搜索操作符 | 当前 CLI / 工具层已支持 |
| `limit` | 限制返回条数 | 当前 CLI / 工具层已支持 |

#### 草案说明

这条能力最容易先服务化，因为它当前已经同时具备：

- CLI 入口
- 工具层返回
- 结构化结果对象

### 1.2 日历 ICS 刷新与事件视图

#### 对应当前事实

- 已有 ICS CLI
- 已有工具层字典返回
- 已有本地数据库同步

#### 草案资源方向 A：触发刷新

```text
POST /api/blackboard/calendar/refresh
```

#### 草案资源方向 B：读取事件

```text
GET /api/blackboard/calendar/events
```

#### 草案说明

当前代码最明确的是“刷新并同步”。如果未来要接前端日历视图，通常还需要补一条读取已同步事件的资源接口。

### 1.3 Blackboard snapshot 同步

#### 对应当前事实

- 已有完整 snapshot 抓取与同步 use case
- 已有工具层字典返回
- 已有同步统计、完整性检查与二次同步校验

#### 草案资源方向

```text
POST /api/blackboard/snapshots/sync
```

#### 草案说明

这类能力更像“后台任务”而不是普通列表接口。未来若服务化，可能还需要进一步讨论：

- 同步是否异步执行
- 是否需要任务状态
- 是否需要审计记录或历史结果列表

## 2. TIS 方向的草案资源

TIS 当前的事实基础弱于 Blackboard CLI 面，因此这里更应保持克制。

### 2.1 个人成绩

#### 对应当前事实

- 已有 provider use case
- 已有结构化结果
- 可选持久化

#### 草案资源方向

```text
GET /api/tis/personal-grades
```

### 2.2 学分绩

#### 草案资源方向

```text
GET /api/tis/credit-gpa
```

### 2.3 已选课程

#### 草案资源方向

```text
GET /api/tis/selected-courses
```

#### 可能的查询参数方向

| 参数 | 含义 |
| --- | --- |
| `semester` | 指定学期；不传时可回退到当前学期 |
| `page_num` | 页码 |
| `page_size` | 每页数量 |

### 2.4 TIS 诊断

#### 草案资源方向

```text
POST /api/tis/diagnostics/link-check
```

#### 草案说明

这类接口更适合内部诊断或运维工具使用，不一定应该直接暴露给普通前端页面。

## 3. runtime 之外可能继续补的接口方向

既然当前聊天 runtime 已经存在，未来更可能需要补的，不是“再造一个聊天根端点”，而是围绕已有 runtime 补外围能力。

### 3.1 历史会话列表

当前前端会话列表主要在窗口内存里。未来如果要做持久化恢复，可能需要讨论：

```text
GET /api/runtime/sessions
```

### 3.2 历史消息回放

当前前端不会自动回放完整历史。未来如果要补完整体验，可能需要讨论：

```text
GET /api/runtime/sessions/{sessionId}/messages
```

### 3.3 会话管理动作

例如：

- 删除会话
- 归档会话
- 重命名会话
- 标记固定会话

当前这些都还不是已实现事实，只是未来可能需要的管理能力。

## 4. 未来如果真的做正式业务 API，还需要补什么

这些内容当前都还**没有在代码中形成正式实现**，因此这里只作为提醒：

- 统一鉴权方式
- 错误码和失败响应格式
- 同步执行还是异步任务
- 字段版本管理
- 哪些日志 / 调试信息允许暴露给前端
- 本地 SQLite 与正式服务部署之间的关系
- 业务 API 与本地 runtime API 的边界

如果这些问题没先补齐，就算把 URL 写出来，也还谈不上真正可依赖的 API。

## 5. 当前文档中应该如何引用这份草案

正确引用方式类似：

- “未来若继续服务化，可优先考虑这些资源方向。”
- “以下字段仅为草案参考，不代表当前接口承诺。”
- “当前真实契约仍以 runtime 契约、CLI JSON 和工具返回字典为主。”

不正确的引用方式则包括：

- “后端当前提供以下业务 API”
- “前端可直接按以下接口联调业务能力”
- “以下为正式接口规范”

## 6. 快速结论

### 当前已实现

- desktop runtime 控制面
- session-first 聊天 runtime 主路径
- Blackboard CLI 与工具输出
- Blackboard snapshot 同步能力
- TIS 若干 provider use case

### 可作为未来接口设计输入

- Blackboard CLI JSON 报告
- Blackboard 工具层返回字典
- TIS provider 结果对象
- 现有 runtime 会话与能力面语义

### 仍属于未来草案

- Blackboard / TIS 正式业务 API
- 历史会话与历史消息回放 API
- 更完整的 runtime 管理接口
- 统一鉴权、统一错误码和版本化设计

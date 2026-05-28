---
title: 边界与未覆盖范围（旧资料）
description: 旧 backend 分册边界页。保留历史边界说明。
sidebar_position: 7
---

# 边界与未覆盖范围（旧资料）

旧 `backend` 分册，保留历史边界说明。需要讨论未来服务化方向时，请看[未来 API 草案参考](./reference-future-api-draft.md)；需要看正式状态，请优先看[能力边界 / 状态总表](../reference/capabilities.md)。

## 一句话

`backend/` 已具备本地桌面 runtime、`thread/run` 聊天主链、Blackboard 领域能力和 TIS 领域能力；`session/create`、`capabilities/get` 与 `message/send` 作为兼容壳保留，但尚未形成一套统一、稳定、面向前端的完整业务 Web API 服务。

backend 分册常见误区：代码里有目录或函数就被提前写成"已经存在成熟服务层"。

## 尚未实现的内容

### Python runtime 直接读取统一配置中心

统一配置中心和 settings workspace 由 Electron 主进程持有。Python runtime 不会直接读取：

- `config-center/*.json`
- `settings-workspace-state.json`
- `settings-workspace-secrets.json`

### 跨设备 / 云端历史同步能力

聊天 runtime 已切到本地 SQLite 持久化。运行时或应用重启后：

- thread 列表可从本地 truth / projection 恢复。
- 历史时间线可按需重建并恢复。
- 已结束 run 可从持久化事件做基础 replay。

但不包括：

- 多设备同步。
- 云端共享或托管备份。
- 全局 retention / search 策略。

### `services/` 已成为统一服务层

`app/services/` 仍然很薄，不存在统一编排层。目录存在只说明保留扩展位置，不说明是运行时或业务接口的主入口。

### Blackboard 与 TIS 已整体进入默认聊天工具目录

默认聊天工具目录只包含有限的最小工具集合。Blackboard 和 TIS 的能力不会因为目录成熟就自动进入正式聊天主路径。

## 已实现但仍有边界的内容

### 旧外层方法已退役

`info`、`agent/connect` 和 `agent/run` 已从 runtime surface 退役。它们不再属于 supported methods，旧调用得到 `method_not_implemented`。

### Blackboard 有完整 HTTP API

`routes/blackboard_ui.py` 提供了 14 个面向前端的 HTTP 端点，覆盖同步触发、数据查询与资源下载管理。

- Blackboard HTTP API 已对前端开放。
- TIS 仍然是 Python 内部能力和未来服务化输入。
- TIS 不应写成和 Blackboard 一样有完整 HTTP API。

### `api/` 目录的两种含义

- `integrations/sustech/blackboard/api/` 和 `integrations/sustech/teaching_information_system/api/` 用于访问上游系统、抓取数据和解析响应，不是给前端直接调用的服务端 API 层。
- `routes/blackboard_ui.py` 中的端点才是面向前端的 HTTP API。

### `copilot-settings.json` 仍然存在

这个文件路径仍会出现在 runtime 参数和宿主路径中，但主要保留给兼容和迁移场景。不适合继续写成正式配置中心。

## 写文档时的常见注意点

### 用目录名推断成熟度

看到 `api/`、`services/`、`provider/` 或 `tools/` 这些目录名时，回到入口、调用方式和暴露面来判断，不根据命名直接推断已形成完整架构。

### 用依赖或测试推断对外接口已成立

代码里出现 `fastapi`、`uvicorn`、CLI、工具层或测试覆盖，不自动等于"已有完整对外 API"。这些只说明能力基础已具备，不说明产品化暴露面已完成。

### 把 settings workspace 字段等同于 runtime 生效字段

设置页能保存很多字段，但它们未必都已进入 Python runtime 的真实配置。需要区分：

- 哪些字段只是主进程持久化。
- 哪些字段已通过宿主参数投影进入 runtime。
- 哪些字段只是 UI 状态或未来预留项。

## 可以放心依赖的现实边界

- 本地 `desktop_runtime` 控制面已成立。
- `thread/run` 聊天主路径已成立，旧兼容壳继续保留。
- Electron 主进程是配置 owner 和 runtime launcher。
- Blackboard 有完整 HTTP API（14 个端点），WakeUP 和日历事件也有 HTTP API。
- TIS 有真实领域能力（但无正式 HTTP API）。

需先确认的内容：

- 跨设备 / 云端历史同步。
- Python 直接读取统一配置中心。
- 成熟的统一服务编排层。
- TIS 的正式前端 HTTP API。

## 相关文档

- [后端模块布局](./module-layout.md)
- [后端运行与配置](./run-and-config.md)
- [后端暴露契约与前端接入点](./frontend-connection.md)
- [未来 API 草案参考](./reference-future-api-draft.md)

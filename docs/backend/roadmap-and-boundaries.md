---
title: 边界与未覆盖范围（旧资料）
description: 旧的 backend 分册边界页。保留历史边界说明，当前能力状态请先看新的共享事实层。
sidebar_position: 7
---

# 边界与未覆盖范围（旧资料）

这页属于旧的 `backend` 分册。它只保留历史边界说明，不再作为当前能力状态的主入口。需要讨论未来服务化方向时，请看[未来 API 草案参考](./reference-future-api-draft.md)；需要看当前正式状态，请优先看[能力边界 / 状态总表](../reference/capabilities.md)。

## 当前边界先看一句话

今天的 `backend/` 已经具备本地桌面 runtime、`thread/run` 聊天主链、Blackboard 领域能力和 TIS 领域能力；`session/create`、`capabilities/get` 与 `message/send` 仍然作为兼容壳保留，但它还没有形成一套统一、稳定、面向前端的完整业务 Web API 服务。

backend 分册里最容易写错的地方，通常都来自“代码里有目录或函数”就被提前写成“已经存在成熟服务层”。这页就是专门用来避免这种误写。

## 当前不应写成已实现事实的内容

### Blackboard 与 TIS 完整业务 Web API

Blackboard 和 TIS 当前已经有真实能力，但这些能力主要表现为：

- CLI。
- 工具层返回字典。
- provider 用例。
- 结构化结果对象。
- 本地数据同步与持久化。

这些事实已经足以说明后端能力不是空壳，但它们仍然不等于“已经对前端开放的稳定业务 HTTP API”。

### Python runtime 直接读取统一配置中心

统一配置中心和 settings workspace 现在由 Electron 主进程持有。Python runtime 当前不会直接读取：

- `config-center/*.json`
- `settings-workspace-state.json`
- `settings-workspace-secrets.json`

backend 分册如果把这层关系写成“Python runtime 直接读取配置中心”，就会把 owner 边界写错。

### 会话持久化恢复能力

当前聊天 runtime 的 session store 仍然是内存态。运行时重启后：

- 会话不会自动恢复。
- 消息历史不会自动回放。
- 前端窗口内状态和 Python 进程内状态不会形成持久化对账。

因此，backend 分册不适合把当前聊天描述成已经具备持久化会话管理能力。

### `services/` 已经成为统一服务层

`app/services/` 当前仍然很薄，还不能代表已经形成统一编排层。目录存在，只说明这里保留了扩展位置，并不说明它已经是当前运行时或业务接口的主入口。

### Blackboard 与 TIS 已整体进入默认聊天工具目录

当前默认聊天工具目录只包含非常有限的最小工具集合。Blackboard 和 TIS 的能力并不会因为目录已经成熟，就自动进入当前正式聊天主路径。

## 当前更适合写成“已实现但仍有边界”的内容

### 旧外层方法已经退役

`info`、`agent/connect` 和 `agent/run` 已从 runtime surface 退役。它们不再属于当前 supported methods，也不再承担兼容链路职责；旧调用当前只会得到 `method_not_implemented`。

### Blackboard 与 TIS 已经有可调用能力

Blackboard 和 TIS 都已经有真实能力，文档不应把它们写成“还没开始”。更合适的说法是：

- 它们已经有能力和结果对象。
- 它们当前缺少统一的前端业务接口层。
- 它们更像未来服务化输入，而不是今天已经完成的外部 API 产品面。

### `api/` 目录不是前端 API 层

`blackboard/api/` 和 `teaching_information_system/api/` 当前主要用于访问上游系统、抓取数据和解析响应。它们不是给前端直接调用的服务端 API 层。

### `copilot-settings.json` 仍然存在

这个文件路径今天仍然会出现在 runtime 参数和宿主路径中，但它现在主要保留给兼容和迁移场景。backend 分册不适合继续把它写成现行正式配置中心。

## 当前写文档时最常见的误写

### 用目录名推断成熟度

看到 `api/`、`services/`、`provider/` 或 `tools/` 这些目录名时，更可靠的做法是回到当前入口、当前调用方式和当前暴露面来判断，而不是根据命名直接推断它们已经形成完整架构。

### 用依赖或测试推断对外接口已经成立

代码里出现 `fastapi`、`uvicorn`、CLI、工具层或测试覆盖，并不自动等于“已经存在完整对外 API”。这些事实只说明能力基础已经具备，不说明产品化暴露面已经完成。

### 把 settings workspace 字段等同于 runtime 生效字段

设置页今天确实已经能保存很多字段，但它们未必都已经进入 Python runtime 的真实配置。需要区分：

- 哪些字段只是主进程持久化。
- 哪些字段已经通过宿主参数投影进入 runtime。
- 哪些字段仍然只是 UI 状态或未来预留项。

## 当前可以放心依赖的现实边界

如果只保留最实际的一层判断，当前可以放心写成事实的内容是：

- 本地 `desktop_runtime` 控制面已经成立。
- `thread/run` 聊天主路径已经成立，旧兼容壳继续保留。
- Electron 主进程已经是配置 owner 和 runtime launcher。
- Blackboard 与 TIS 已经有真实领域能力。

与此同时，当前仍然应保守描述的内容是：

- 完整业务 Web API。
- 会话持久化恢复。
- Python 直接读取统一配置中心。
- 成熟的统一服务编排层。

## 相关文档

- [后端模块布局](./module-layout.md)
- [后端运行与配置](./run-and-config.md)
- [后端暴露契约与前端接入点](./frontend-connection.md)
- [未来 API 草案参考](./reference-future-api-draft.md)

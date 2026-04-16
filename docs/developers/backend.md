---
title: 后端实现
description: 帮开发者快速定位 Python desktop runtime、copilot runtime、领域模块和当前后端边界。
sidebar_position: 6
---

# 后端实现

- 这页给谁看：准备修改 Python runtime、聊天协议、工具链路、Thinking 适配或领域模块的开发者。
- 这页解决什么问题：说明当前后端代码按什么边界组织、应该先从哪里读、哪些目录已经进入主链、哪些仍要保守表述。
- 当前覆盖到哪：覆盖 `backend/app/` 下与桌面运行时直接相关的目录，以及 Blackboard、TIS 等领域模块的当前位置。
- 当前状态：desktop runtime 与 `copilot_runtime` 主链已可用；领域对前端的产品化接入面仍属部分接通。

先说结论：当前后端不是一个面向公网的完整业务 API 平台，而是**由 `desktop_runtime` 托管、以 `copilot_runtime` 组织聊天主链、再挂接领域能力和工具目录的本地运行时**。

## 先按目录理解后端

| 目录 | 当前主要角色 | 当前状态 |
| --- | --- | --- |
| `backend/app/desktop_runtime/` | Python runtime 入口、控制面端点、宿主桥客户端、生命周期装配。 | 已可用 |
| `backend/app/copilot_runtime/` | 聊天协议、方法分发、run 编排、事件流、工具与 Thinking 适配。 | 已可用 |
| `backend/app/tools/` | 当前工具实现与文件处理等辅助能力。 | 已可用 |
| `backend/app/integrations/sustech/blackboard/` | Blackboard 相关领域能力。 | 部分接通 |
| `backend/app/integrations/sustech/teaching_information_system/` | TIS 相关领域能力。 | 部分接通 |
| `backend/app/core/` | 认证等基础能力。 | 已可用 |
| `backend/app/services/` | 预留或薄层服务位。 | 部分接通 |

## 建议的读码顺序

### 1. 先看 `desktop_runtime`

如果你要知道后端怎样被桌面宿主管起来，先看：

- `backend/app/desktop_runtime/__main__.py`
- `backend/app/desktop_runtime/server.py`
- `backend/app/desktop_runtime/config.py`
- `backend/app/desktop_runtime/host_model_route_bridge.py`

这一层帮你先分清：控制面端点在哪里、启动参数怎么解析、宿主私桥怎样进入运行时边界。

### 2. 再看 `copilot_runtime`

如果你要继续看聊天主线，建议按这个顺序：

1. `backend/app/copilot_runtime/router.py`
2. `backend/app/copilot_runtime/protocol.py`
3. `backend/app/copilot_runtime/message_runs.py`
4. `backend/app/copilot_runtime/run_events.py`
5. `backend/app/copilot_runtime/session_store.py`
6. `backend/app/copilot_runtime/tool_registry.py`
7. `backend/app/copilot_runtime/thinking_adapter.py`

这条线能把方法分发、协议解析、run 编排、事件编码、存储和 Thinking 适配串起来。

## Provider 和模型路由在后端里怎么落点

当前 Provider 相关逻辑不再围绕旧的“active provider + 单个 model 字符串”展开。后端里更值得先看的位置包括：

- `backend/app/copilot_runtime/provider_catalog.py`
- `backend/app/copilot_runtime/provider_adapter_registry.py`
- `backend/app/copilot_runtime/model_routes.py`

但要注意：完整口径仍以[Provider 与模型路由说明](../reference/providers-and-routing.md)为准，后端页面不再复制一整套事实定义。

## Thinking 在后端里怎么落点

Thinking 当前已经进入主链。对后端来说，最相关的位置通常是：

- `backend/app/copilot_runtime/thinking_adapter.py`
- `backend/app/copilot_runtime/message_runs.py`
- `backend/app/copilot_runtime/bridge.py`

这里最重要的开发心智是：Thinking 不是旧 intent 字段的简单别名，而是当前请求、能力查询和 run 元数据的一部分。统一口径请看[Thinking 能力说明](../reference/thinking.md)。

## 工具链路现在怎么落点

工具相关主线主要集中在：

- `backend/app/copilot_runtime/tool_registry.py`
- `backend/app/copilot_runtime/execution_support.py`
- `backend/app/copilot_runtime/execution_event_graph.py`
- `backend/app/tools/`

从开发者视角，当前需要先分清三件事：

1. 工具目录怎样被暴露。
2. 一轮 run 里哪些工具被启用。
3. 工具生命周期怎样通过 `tool_event` 回到前端。

## Blackboard 与 TIS 当前应该怎样理解

这两块都已经不是空壳。它们当前已经有：

- 真实能力模块。
- 数据获取或同步逻辑。
- 测试或集成痕迹。

但更准确的写法仍然是：**它们已经有能力基础，但面向前端的完整产品化接入面仍然只是部分接通。**

所以读码时可以深入这些目录，但写文档或设计接口时不要把它们直接写成成熟业务 API 平台。

## 后端实现最容易写错的地方

### 不要把 `desktop_runtime` 写成通用服务平台入口

它当前首先服务桌面宿主管理下的本地运行时。

### 不要把 Python runtime 写成配置 owner

配置 owner 仍然在 Electron 主进程。后端解释启动参数，也在执行阶段使用 route 解析结果，但不直接读取 settings workspace 文档。

### 不要把领域模块存在感等同于前端接入面已经成熟

Blackboard、TIS 目录已经很真实，但对前端的产品化接入仍要保守描述。

## 进一步阅读

- [后端分册入口](../backend/README.md)
- [后端运行与配置](../backend/run-and-config.md)
- [边界与未覆盖范围](../backend/roadmap-and-boundaries.md)
- [聊天运行时](./chat-runtime.md)
- [配置与状态模型](./config-and-state.md)

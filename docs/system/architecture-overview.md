---
title: 系统架构总览
description: 从系统级视角说明 Electron、统一配置中心、Python runtime 与当前 session-first 聊天主路径的关系。
sidebar_position: 1
---

# 系统架构总览

本文档帮助读者先建立一张全局地图，再去读更细的前端、后端和运行时专题。

它重点回答这些问题：

- 统一配置中心现在位于哪一层。
- Electron 主进程、preload、renderer、Python runtime 分别负责什么。
- 当前聊天为什么已经不再是“全局 agent + 旧聊天桥”的理解方式。
- 旧 `copilot-settings.json` 现在还剩什么作用。

## 先给一句话结论

当前系统可以概括成：

> **Electron 主进程负责配置与宿主治理，Python runtime 负责本地 HTTP 服务，renderer 负责工作台 UI，而聊天主路径已经切到“后端智能体目录 → 会话绑定智能体 → 请求级模型与工具策略”的 session-first 模式。**

## 系统现在有哪些核心层

### 1. Electron 主进程

主进程当前负责四类事情：

- 桌面窗口与生命周期。
- 统一配置中心的磁盘读写、归一化和迁移。
- hosted backend 的启动、停止、失败记录和重试。
- 对 renderer 暴露受控 IPC，而不是直接把底层文件系统或进程细节开放出去。

### 2. Preload

preload 的作用很克制：

- 给 renderer 暴露配置中心公共快照与公共补丁。
- 给 renderer 暴露 hosted runtime 快照和 retry 动作。
- 隐藏底层目录、spawn 参数、token 和文件系统细节。

### 3. Electron Renderer

renderer 当前不是传统浏览器里的单页应用，而是运行在 Electron 中的 React 工作台。

它主要负责：

- 启动时先读取配置中心公共快照与 hosted runtime 快照。
- 根据这些事实决定工作台当前应该显示什么状态。
- 承载助手工作区、设置工作区以及其余占位工作区。
- 在 connectable 状态下，用 session-first 聊天壳继续向后端拉目录、建会话、发消息。

### 4. Python Desktop Runtime

Python runtime 负责本地 loopback HTTP 服务：

- 提供 `/health`、`/ready`、`/version`、`/diagnostics` 等控制面端点。
- 提供统一的聊天根端点 `POST /`。
- 维护运行时智能体目录、工具目录与内存态会话存储。

## 当前组件关系

```text
Electron Main Process
  ├─ 统一配置中心（多文件 JSON、归一化、迁移、广播）
  ├─ Hosted Runtime 管理（启动 / 停止 / 失败 / 重试）
  └─ IPC / preload 暴露面
           │
           ▼
Electron Renderer
  ├─ 根装配层：读取配置与运行态
  ├─ AssistantWorkspace：拉智能体目录、创建会话、渲染聊天壳
  └─ SettingsWorkspace：编辑已正式接入的配置字段
           │
           ▼
Python Desktop Runtime
  ├─ 控制面端点
  ├─ 智能体目录 / 工具目录
  └─ 会话与消息处理
```

## 统一配置中心现在放在哪一层

统一配置中心当前明确属于 **Electron 主进程层**。

这条链路现在已经不是早期那种“renderer 直接围着单个 settings 文件转”的做法，而是：

1. 主进程读取分域配置文档。
2. 如果新文档不存在，再尝试从旧 `copilot-settings.json` 里提取可迁移字段。
3. 主进程把可安全暴露给 renderer 的部分投影成公共快照。
4. preload 把公共快照、公共补丁和更新订阅暴露给 renderer。
5. renderer 只消费这个公共外观，不再直接碰底层配置文件。

## 当前正式配置域与字段

当前统一配置中心按 4 个稳定域组织：

| 配置域 | 当前正式字段 | 主要作用 |
| --- | --- | --- |
| `frontend-preferences` | `theme`、`animationsEnabled` | 纯前端显示偏好 |
| `assistant-behavior` | `agentName` | 助手行为偏好字段，当前不再决定聊天是否可连接 |
| `host-config` | `runtimeUrl` | 开发态运行时覆盖地址 |
| `backend-exposed` | `model` | 宿主可投影给 runtime 的默认模型字段 |

### 现在怎样理解这些字段

- `theme`：前端主题，立即生效。
- `animationsEnabled`：前端动画开关，立即生效。
- `agentName`：仍然会持久化，也有设置入口，但当前 session-first 主路径不再靠它决定聊天 readiness。
- `runtimeUrl`：主要是开发态 override 候选，不是发布态默认后端地址。
- `model`：由宿主读取后，在下一次完整启动时投影给 Python `--model`。

## 当前主数据流

### 1. 启动与状态装配流

应用启动后，renderer 会先做两件事：

1. 读取配置中心公共快照。
2. 读取 hosted runtime 快照。

然后把这两部分归并为当前的 bootstrap 状态。

这里最关键的事实是：

- 当前 bootstrap 的硬门槛主要是 **有没有可用 runtime URL**。
- `agentName` 仍然存在于快照里，但已经不再是聊天就绪前提。

### 2. 配置写回流

当前配置写回链路是：

1. 设置页提交公共补丁。
2. preload 把补丁转给主进程。
3. 主进程把补丁写回对应的域文件。
4. 主进程广播新的公共快照。
5. renderer 订阅方同步更新界面与状态。

这意味着配置中心现在已经是一套：

- 多文件 JSON
- 人可读
- 有默认值归一化
- 有 legacy migration
- 有公共订阅更新

的正式持久化系统。

### 3. 聊天主路径

当前聊天主路径不是“读一个全局 agentName 然后直接开聊”，而是：

1. renderer 先确认当前有可用 runtime URL。
2. `AssistantWorkspace` 调用 `agents/list` 拉取后端智能体目录。
3. 用户在目录里选择一个智能体。
4. renderer 调用 `session/create` 创建会话，并把该智能体绑定到会话。
5. renderer 调用 `capabilities/get` 读取这个会话的工具目录、推荐工具和模型偏好提示。
6. 用户发消息时，renderer 调用 `message/send`，并在请求里显式带上本次模型、启用工具和请求选项。

可以把它拆成三层理解：

- **目录层**：后端告诉前端有哪些智能体。
- **会话层**：会话决定当前绑定的是哪个智能体。
- **请求层**：每次消息再决定本次使用哪个模型和哪些工具。

### 4. Runtime 参数投影流

`backend-exposed.model` 的作用不在 renderer，而在宿主启动链路：

1. 主进程读取 `backend-exposed.model`。
2. 宿主决定是否把它投影成 Python `--model`。
3. Python runtime 继续只解释 CLI 参数、环境变量和默认值。

所以统一配置中心新增的是 **宿主治理层**，不是“让 Python runtime 直接读配置文件”。

## 为什么说后端目录才是真源

当前前端虽然会把后端目录项加工成更适合展示的卡片，但它不再自己定义一份聊天主路径专用的智能体真源。

后端目录项当前至少会告诉前端：

- `agentId`
- `status`
- `displayName`
- `description`
- `recommendedTools`
- `defaultModelPreference`
- `iconKey`

前端再基于这份目录做展示增强与默认选择。

## 会话状态分别放在哪

当前要分清三层状态：

### 1. 配置状态

放在统一配置中心里。

例如：

- 主题
- 动画开关
- 开发态 runtime override
- 后端默认模型字段

### 2. 宿主运行状态

放在 hosted runtime 快照里。

例如：

- `starting`
- `ready`
- `failed`
- `degraded`
- 最近失败摘要

### 3. 聊天会话状态

分成前后两部分：

- renderer 里保留当前窗口的会话列表与激活项。
- Python runtime 里保留每个会话的内存态消息历史。

这意味着：

- 会话列表当前不是配置中心的一部分。
- 会话历史当前也不是配置中心的一部分。
- Python runtime 重启后，内存态消息历史会丢失。

## 旧 `copilot-settings.json` 现在还剩什么语义

准确说法只有一句：

> **它现在主要是主进程内部的迁移输入源。**

也就是说：

- renderer 已经不再把它当正式接口。
- 统一配置中心才是当前正式配置入口。
- 旧文件仍然保留，是为了从历史版本迁移 `runtimeUrl` 和 `agentName`。

## 当前目录结构应该怎么理解

默认情况下，运行时目录大致是：

```text
<userData>/desktop-runtime/
├─ config/
│  ├─ config-center/
│  │  ├─ frontend-preferences.json
│  │  ├─ assistant-behavior.json
│  │  ├─ host-config.json
│  │  └─ backend-exposed.json
│  └─ copilot-settings.json
├─ logs/
├─ database/
└─ state/
```

其中：

- `config-center/*.json` 是当前正式配置文档。
- `copilot-settings.json` 是旧格式迁移输入路径。
- `state/*.json` 是运行观测产物，不是配置源。

## 当前边界

### 已经成立的事实

- Electron 主进程已经正式承载统一配置中心。
- 配置中心已经是多文件、可读、带迁移的持久化系统。
- renderer 已经不再依赖旧 renderer settings 语义。
- 当前聊天主路径已经是 session-first。
- 后端目录、会话绑定、请求级模型和工具策略已经进入正式文档范围。

### 还不能写成已完成的事

- Python runtime 直接读取统一配置中心文档。
- 会话列表已经有后端持久化接口。
- 所有运行态变化都实时推送到前端。
- 设置页所有分区都已进入正式配置闭环。
- 旧 `agent/connect` / `agent/run` 仍然是正式前端主路径。

## 相关文档

- [聊天运行时契约](./chat-runtime-contract.md)
- [会话与状态模型](./session-and-state-model.md)
- [运行时生命周期](./runtime-lifecycle.md)
- [前端分册入口](../frontend/README.md)
- [后端运行与配置](../backend/run-and-config.md)

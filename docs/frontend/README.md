# 前端分册入口

## 文档目标

本文档作为前端分册的权威入口，帮助读者理解当前 Electron + renderer 前端子系统的职责边界、组成部分与阅读路径。阅读时间约 5-10 分钟。

## 前端子系统定位

当前前端不是通用浏览器端 SPA，而是**桌面宿主下的 Electron renderer + IPC + hosted runtime consumption**。它的核心职责是：

- 提供桌面应用窗口与工作区界面
- 通过 Electron IPC 读取宿主管理的 runtime 状态与本地配置
- 消费宿主托管的 Python desktop runtime 提供的 HTTP 聊天端点
- 展示最小聊天 UI，支持纯文本多轮对话

## 前端组成部分

### 1. Electron 主进程层

**代码位置**：[`frontend-copilot/electron/`](../../frontend-copilot/electron/)

**核心模块**：
- [`main.ts`](../../frontend-copilot/electron/main.ts) - 主进程入口，管理窗口生命周期、IPC handlers、Python runtime 托管
- [`preload.ts`](../../frontend-copilot/electron/preload.ts) - 预加载脚本，通过 `contextBridge` 暴露 `copilotSettings` 与 `copilotRuntime` API
- [`copilot-settings.ts`](../../frontend-copilot/electron/copilot-settings.ts) - Copilot 配置读写封装
- [`copilot-runtime.ts`](../../frontend-copilot/electron/copilot-runtime.ts) - Runtime 状态快照与重试接口

**职责边界**：
- 主进程负责启动/停止 Python 子进程，不直接处理聊天业务逻辑
- 主进程通过 IPC 向 renderer 提供 runtime URL、状态快照、配置读写能力
- 主进程在 `before-quit` 时优雅关闭 Python runtime

### 2. Runtime 托管层

**代码位置**：[`frontend-copilot/electron/runtime/`](../../frontend-copilot/electron/runtime/)

**核心模块**：
- [`hosted-backend-service.ts`](../../frontend-copilot/electron/runtime/hosted-backend-service.ts) - 封装 Python runtime manager，提供统一 start/stop 接口
- [`python-runtime-manager.ts`](../../frontend-copilot/electron/runtime/python-runtime-manager.ts) - 管理 Python 子进程启动、健康检查、停止
- [`python-runtime-resolver.ts`](../../frontend-copilot/electron/runtime/python-runtime-resolver.ts) - 解析 development 与 bundled 两种运行模式
- [`runtime-config.ts`](../../frontend-copilot/electron/runtime/runtime-config.ts) - 解析 CLI 参数（`--runtime-model`、`--runtime-host` 等）
- [`runtime-state.ts`](../../frontend-copilot/electron/runtime/runtime-state.ts) - 定义 hosted backend 状态机（stopped、starting、ready、failed、degraded）
- [`runtime-paths.ts`](../../frontend-copilot/electron/runtime/runtime-paths.ts) - 定义运行时目录结构（config、logs、database、state）
- [`runtime-diagnostics.ts`](../../frontend-copilot/electron/runtime/runtime-diagnostics.ts) - 定义失败诊断结构
- [`runtime-observability.ts`](../../frontend-copilot/electron/runtime/runtime-observability.ts) - 日志写入封装
- [`runtime-redaction.ts`](../../frontend-copilot/electron/runtime/runtime-redaction.ts) - 敏感信息脱敏

**职责边界**：
- 托管层只负责"启动 Python 进程、等待就绪、监控状态、优雅停止"
- 不负责聊天协议解析、session 管理或业务逻辑
- 开发态优先使用 `../backend/.venv/` 虚拟环境，回退到系统 Python
- Packaged 模式从 `resources/python-runtime/` 读取 bundled runtime manifest

**测试依据**：
- [`runtime-config.test.ts`](../../frontend-copilot/electron/runtime/runtime-config.test.ts) - CLI 参数解析测试
- [`runtime-state.test.ts`](../../frontend-copilot/electron/runtime/runtime-state.test.ts) - 状态流转测试

### 3. Renderer 根装配层

**代码位置**：[`frontend-copilot/src/`](../../frontend-copilot/src/)

**核心模块**：
- [`main.tsx`](../../frontend-copilot/src/main.tsx) - Renderer 入口，挂载 React 根组件
- [`CopilotAppRoot.tsx`](../../frontend-copilot/src/CopilotAppRoot.tsx) - 根装配层，负责：
  - 通过 IPC 加载 runtime snapshot 与 settings
  - 决策是否注入 CopilotKit Provider
  - 按需懒加载工作台与 Provider 模块
  - 提供启动失败兜底与重试机制
- [`App.tsx`](../../frontend-copilot/src/App.tsx) - 工作台外壳，提供左侧导航与工作区路由

**职责边界**：
- 根装配层不自行读取配置或猜测 runtime URL，统一消费主进程提供的状态快照
- 只有当 runtime 状态为 `ready` 或 `degraded` 且具备 `runtimeUrl` 与 `agentName` 时，才注入 CopilotKit Provider
- 启动链路：`main.tsx` → `CopilotAppRoot.tsx` → 懒加载 `App.tsx` 与 CopilotKit

**测试依据**：
- [`CopilotAppRoot.test.tsx`](../../frontend-copilot/src/CopilotAppRoot.test.tsx) - 根装配层状态决策测试

### 4. Copilot 聊天能力层

**代码位置**：[`frontend-copilot/src/features/copilot/`](../../frontend-copilot/src/features/copilot/)

**核心模块**：
- [`config.ts`](../../frontend-copilot/src/features/copilot/config.ts) - 从 IPC 读取 runtime snapshot 与 settings，决策 bootstrap 状态
- [`CopilotChatPanel.tsx`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx) - 聊天面板 UI，展示不同 bootstrap 状态的提示与聊天区
- [`runtime.ts`](../../frontend-copilot/src/features/copilot/runtime.ts) - Runtime API 封装（load、retry）
- [`settings.ts`](../../frontend-copilot/src/features/copilot/settings.ts) - Settings API 封装（load、save）
- [`types.ts`](../../frontend-copilot/src/features/copilot/types.ts) - 类型定义

**职责边界**：
- 聊天面板只负责 UI 展示与用户交互，不直接管理 HTTP 请求
- CopilotKit 负责实际的 HTTP 聊天请求（POST 到 `runtimeUrl`）
- 当前支持最小纯文本聊天 MVP：单 agent、多轮上下文、显式失败展示
- 不包含工具调用、确认机制或完整会话产品化

**测试依据**：
- [`config.test.ts`](../../frontend-copilot/src/features/copilot/config.test.ts) - Bootstrap 状态决策测试
- [`CopilotChatPanel.test.tsx`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.test.tsx) - 聊天面板渲染测试
- [`runtime.test.ts`](../../frontend-copilot/src/features/copilot/runtime.test.ts) - Runtime API 测试

### 5. 工作区界面层

**代码位置**：[`frontend-copilot/src/workbench/`](../../frontend-copilot/src/workbench/)

**核心模块**：
- [`assistant/AssistantWorkspace.tsx`](../../frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx) - 助手工作区，提供三段式布局（助手类型列、话题列、聊天区）
- [`settings/SettingsWorkspace.tsx`](../../frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx) - 设置工作区
- [`hub/HubWorkspace.tsx`](../../frontend-copilot/src/workbench/hub/HubWorkspace.tsx) - 能力中心工作区
- 其他工作区（files、developer）当前为占位骨架

**职责边界**：
- 助手工作区已接入最小聊天 UI，当前话题 ID 作为 `threadId` 传给聊天区
- 设置工作区大部分字段仍为前端本地交互，未完整接入后端配置能力
- 当前设置页没有 `agentName` 的正式编辑入口（需手动编辑 `copilot-settings.json`）

**测试依据**：
- [`AssistantWorkspace.test.tsx`](../../frontend-copilot/src/workbench/assistant/AssistantWorkspace.test.tsx) - 助手工作区渲染测试

## 前端在整个系统中的位置

### 与 Electron 主进程的关系

```
┌─────────────────────────────────────────────────────────────┐
│ Electron 主进程 (main.ts)                                    │
│  - 管理窗口生命周期                                           │
│  - 启动/停止 Python runtime                                   │
│  - 提供 IPC 桥接（settings、runtime snapshot）                │
└────────────┬────────────────────────────────────────────────┘
             │
             │ IPC (contextBridge)
             ↓
┌─────────────────────────────────────────────────────────────┐
│ Electron Renderer (CopilotAppRoot.tsx)                      │
│  - 通过 IPC 读取 runtime snapshot                            │
│  - 决策是否注入 CopilotKit Provider                          │
│  - 渲染工作台与聊天 UI                                        │
└─────────────────────────────────────────────────────────────┘
```

**关键 IPC 通道**：
- `COPILOT_SETTINGS_LOAD_CHANNEL` / `COPILOT_SETTINGS_SAVE_CHANNEL` - 配置读写
- `COPILOT_RUNTIME_LOAD_CHANNEL` / `COPILOT_RUNTIME_RETRY_CHANNEL` - Runtime 状态与重试

**代码锚点**：
- [`frontend-copilot/electron/preload.ts`](../../frontend-copilot/electron/preload.ts#L13-L29) - IPC API 暴露
- [`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts#L188-L212) - IPC handlers 注册

### 与 Hosted Backend 的关系

```
┌─────────────────────────────────────────────────────────────┐
│ Electron 主进程                                              │
│  - 启动 Python 子进程                                         │
│  - 等待 /ready 端点可用                                       │
│  - 提供 runtimeUrl 给 renderer                               │
└────────────┬────────────────────────────────────────────────┘
             │
             │ spawn 子进程
             ↓
┌─────────────────────────────────────────────────────────────┐
│ Python Desktop Runtime (backend/app/desktop_runtime/)       │
│  - FastAPI HTTP 服务（默认 127.0.0.1:8765）                  │
│  - 挂载 Copilot Runtime 单端点路由（POST /）                 │
└────────────┬────────────────────────────────────────────────┘
             │
             │ HTTP (fetch)
             ↓
┌─────────────────────────────────────────────────────────────┐
│ Electron Renderer                                           │
│  - CopilotKit 发起 HTTP POST 请求到 runtimeUrl              │
│  - 接收 SSE 流式响应                                          │
│  - 展示 user/assistant 消息                                  │
└─────────────────────────────────────────────────────────────┘
```

**关键契约**：
- Renderer 不直接管理 Python 进程，只消费主进程提供的 `runtimeUrl`
- CopilotKit 负责实际的 HTTP 聊天请求，前端只需提供 `runtimeUrl` 与 `agentName`
- 后端显式失败会以内联红色错误消息显示在聊天区

**系统专题参考**：
- [系统架构总览](../system/architecture-overview.md) - 完整组件拓扑
- [Runtime 生命周期](../system/runtime-lifecycle.md) - 启动链路详解
- [聊天 Runtime 契约](../system/chat-runtime-contract.md) - HTTP 协议规范

## 当前已实现什么

### 已落地能力

- ✅ Electron 桌面壳与窗口管理
- ✅ Python runtime 托管层（development 与 bundled 两种模式）
- ✅ IPC 桥接（settings 读写、runtime snapshot 读取、重试机制）
- ✅ 根装配层状态决策（loading、empty、incomplete、starting、ready、failed、degraded、error）
- ✅ 最小聊天工作区（三段式布局：助手类型列、话题列、聊天区）
- ✅ 纯文本多轮对话（当前话题 ID 作为 `threadId` 传给后端）
- ✅ Runtime state 消费（区分 hosted status、runtime URL 来源、agent 来源）
- ✅ Settings 读写（保存在 `userData/desktop-runtime/config/copilot-settings.json`）
- ✅ 错误展示（后端显式失败以内联红色消息显示）
- ✅ 启动失败兜底与重试机制

**代码锚点**：
- [`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts#L366-L390) - Hosted backend 启动
- [`frontend-copilot/src/CopilotAppRoot.tsx`](../../frontend-copilot/src/CopilotAppRoot.tsx#L160-L434) - 根装配层
- [`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx#L221-L384) - 聊天 UI
- [`frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx`](../../frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx) - 助手工作区

### 尚不是什么

- ⚠️ 不是完整业务前端：会话列表、助手类型、能力中心、文件工作区当前主要使用前端本地静态数据
- ⚠️ 不是多 agent orchestration UI：当前只支持单 agent（名为 `"default"`）
- ⚠️ 不是完整配置管理界面：设置页大部分字段仍为前端本地交互，未完整接入后端
- ⚠️ 设置页没有 `agentName` 的正式编辑入口：首次联调需手动编辑 `copilot-settings.json`
- ⚠️ 聊天面板仅覆盖最小 MVP：不包含工具调用、确认机制或完整会话产品化

## 推荐阅读顺序

### 新成员快速上手

如果你是第一次接触前端子系统，推荐按以下顺序阅读：

1. **先建立系统全貌**：
   - [系统架构总览](../system/architecture-overview.md) - 理解 Electron + Python runtime 整体架构
   - [Runtime 生命周期](../system/runtime-lifecycle.md) - 理解启动链路与两种运行模式

2. **再深入前端实现**：
   - [`frontend-copilot/README.md`](../../frontend-copilot/README.md) - 前端快速上手指南（安装、启动、构建）
   - 本文档（`docs/frontend/README.md`）- 前端分册入口（你正在阅读）

3. **查阅前端分册其他页面**（按需）：
   - [UI 当前状态](./ui-current-state.md) - 界面结构与交互程度
   - [后端连接契约](./backend-connection-contract.md) - 前端如何连接后端
   - [路线图与占位](./roadmap-and-placeholders.md) - 已实现与未来计划

### 开发时查表

如果你已经在写代码，只需快速查事实：

- [参考：当前生效字段](./reference-current-fields.md) - 查当前真正生效的配置字段
- [参考：Runtime 状态](./reference-runtime-states.md) - 查 `loading` / `ready` / `error` 等状态含义
- [参考：页面能力](./reference-page-capabilities.md) - 查各工作区当前的数据来源与交互程度

### 理解跨前后端主题

如果你需要理解跨前后端的系统级概念，优先阅读系统专题：

- [聊天 Runtime 契约](../system/chat-runtime-contract.md) - 单端点协议、请求/响应格式
- [Session 与状态模型](../system/session-and-state-model.md) - threadId 语义、状态管理

**重要**：不要在前端分册中重复展开这些系统级主题，应引导读者去相应 system 文档。

## 关键判断与代码锚点

### 1. 前端如何决策是否注入 CopilotKit Provider？

**决策逻辑**：[`frontend-copilot/src/CopilotAppRoot.tsx`](../../frontend-copilot/src/CopilotAppRoot.tsx#L148-L158)

```typescript
export function shouldLoadCopilotProvider(input: {
  configState: CopilotBootstrapState
  providerLoadState: ProviderLoadState
  allowWorkbenchWithoutProvider: boolean
  providerLoaded: boolean
}): boolean {
  return isCopilotConnectableState(input.configState)
    && !input.allowWorkbenchWithoutProvider
    && !input.providerLoaded
    && (input.providerLoadState.status === 'idle' || input.providerLoadState.status === 'loading')
}
```

**关键条件**：
- `configState.status` 必须为 `ready` 或 `degraded`
- 必须具备 `runtimeUrl` 与 `agentName`
- Provider 尚未加载

### 2. 前端如何读取 runtime snapshot？

**IPC 调用**：[`frontend-copilot/src/features/copilot/runtime.ts`](../../frontend-copilot/src/features/copilot/runtime.ts)

```typescript
export async function loadCopilotRuntimeSnapshot(): Promise<CopilotRuntimeLoadResult> {
  return await window.copilotRuntime.load()
}
```

**主进程实现**：[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts#L214-L237)

返回的 snapshot 包含：
- `hosted.status` - Hosted backend 状态（stopped、starting、ready、failed、degraded）
- `hosted.runtimeUrl` - Runtime URL（如 `http://127.0.0.1:8765`）
- `hosted.failure` - 失败摘要（如果有）

### 3. 前端如何区分 runtime URL 来源？

**决策逻辑**：[`frontend-copilot/src/features/copilot/config.ts`](../../frontend-copilot/src/features/copilot/config.ts)

Runtime URL 来源优先级：
1. **Hosted**：主进程托管的 Python runtime 提供（`snapshot.hosted.runtimeUrl`）
2. **Dev override**：开发态手填覆盖（`settings.runtimeUrl`，仅当 hosted 未提供时）
3. **None**：无有效来源

Agent 来源：
1. **Settings**：本地配置提供（`settings.agentName`）
2. **Missing**：未提供

### 4. 前端如何展示不同 bootstrap 状态？

**状态定义**：[`frontend-copilot/src/features/copilot/types.ts`](../../frontend-copilot/src/features/copilot/types.ts)

```typescript
export type CopilotBootstrapState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'empty'; missingFields: string[]; ... }
  | { status: 'incomplete'; missingFields: string[]; ... }
  | { status: 'starting'; ... }
  | { status: 'ready'; runtimeUrl: string; agentName: string; ... }
  | { status: 'failed'; ... }
  | { status: 'degraded'; runtimeUrl: string; agentName: string; ... }
```

**UI 渲染**：[`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx#L51-L219)

- `loading` / `starting` - 显示等待提示
- `empty` / `incomplete` - 显示缺失字段提示
- `failed` - 显示失败摘要与重试按钮
- `degraded` - 显示警告提示，但仍挂载聊天区
- `ready` - 显示连接详情，挂载聊天区
- `error` - 显示 IPC 读取失败

## 质量保证

### 测试覆盖

当前前端测试主要覆盖：

1. **Runtime 托管层**：
   - [`runtime-config.test.ts`](../../frontend-copilot/electron/runtime/runtime-config.test.ts) - CLI 参数解析
   - [`runtime-state.test.ts`](../../frontend-copilot/electron/runtime/runtime-state.test.ts) - 状态流转

2. **Copilot 能力层**：
   - [`config.test.ts`](../../frontend-copilot/src/features/copilot/config.test.ts) - Bootstrap 状态决策
   - [`CopilotChatPanel.test.tsx`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.test.tsx) - 聊天面板渲染
   - [`runtime.test.ts`](../../frontend-copilot/src/features/copilot/runtime.test.ts) - Runtime API

3. **工作区层**：
   - [`AssistantWorkspace.test.tsx`](../../frontend-copilot/src/workbench/assistant/AssistantWorkspace.test.tsx) - 助手工作区渲染
   - [`CopilotAppRoot.test.tsx`](../../frontend-copilot/src/CopilotAppRoot.test.tsx) - 根装配层

**运行测试**：

```bash
cd frontend-copilot
npm run test
```

当前测试共 27 passed。

### 类型检查

```bash
cd frontend-copilot
npx tsc --noEmit
```

### Lint

```bash
cd frontend-copilot
npm run lint
```

## 相关文档

### 系统专题（跨前后端）

- [系统架构总览](../system/architecture-overview.md) - 完整组件拓扑与数据流
- [Runtime 生命周期](../system/runtime-lifecycle.md) - 启动链路、两种运行模式
- [聊天 Runtime 契约](../system/chat-runtime-contract.md) - 单端点协议、请求/响应格式
- [Session 与状态模型](../system/session-and-state-model.md) - threadId 语义、状态管理

### 前端分册（本分册其他页面）

- [UI 当前状态](./ui-current-state.md) - 界面结构与交互程度
- [后端连接契约](./backend-connection-contract.md) - 前端如何连接后端
- [路线图与占位](./roadmap-and-placeholders.md) - 已实现与未来计划
- [参考：当前生效字段](./reference-current-fields.md) - 配置字段查表
- [参考：Runtime 状态](./reference-runtime-states.md) - 状态含义查表
- [参考：页面能力](./reference-page-capabilities.md) - 工作区能力查表

### 后端分册

- [后端分册入口](../backend/README.md) - 后端子系统总览
- [模块布局](../backend/module-layout.md) - 后端代码组织
- [运行与配置](../backend/run-and-config.md) - 后端启动与配置

### 快速上手

- [`frontend-copilot/README.md`](../../frontend-copilot/README.md) - 前端快速上手指南

---

**文档版本**：2026-03-25  
**对应代码版本**：当前 main 分支

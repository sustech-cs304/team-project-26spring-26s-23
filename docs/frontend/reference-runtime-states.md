# 前端运行时状态参考

## 文档用途

本文档是前端运行时状态的权威说明，帮助读者理解：

- 前端如何表示、归并和消费运行时状态
- 为什么会显示 loading / disconnected / degraded / failed / ready 等不同体验
- 这些状态分别由谁产生、如何转换
- 哪些字段决定是否真正加载 Copilot provider

适用场景：

- 联调时快速判断当前卡在哪一步
- 理解 Electron 主进程托管的 hosted backend 状态如何传递到 renderer
- 理解用户手填 runtime URL 与 hosted runtime snapshot 如何统一归并
- 排查为什么 UI 显示特定状态

## 使用边界

- 本文档聚焦运行时与配置状态，不是完整聊天协议说明，也不是完整 UI 文档
- 本文档严格基于当前仓库事实，不虚构未实现的状态机或未来 UI 行为
- 跨进程启动链路、HTTP 契约、session store 语义请参考 [`docs/system/`](../system/) 相关文档

## 状态层次概览

前端运行时状态分为两个层次：

1. **Electron 主进程层**：[`HostedBackendState`](../../frontend-copilot/electron/runtime/runtime-state.ts) - 托管后端的生命周期状态
2. **Renderer 层**：[`CopilotConfigState`](../../frontend-copilot/src/features/copilot/types.ts) - 归并用户设置、hosted runtime snapshot、错误态后的 UI 可消费状态

### 状态流转路径

```
Electron 主进程
  └─> HostedBackendState (starting/ready/failed/degraded/stopped)
        └─> IPC 传递 snapshot
              └─> Renderer 侧
                    └─> 读取用户设置 (runtimeUrl, agentName)
                          └─> resolveCopilotConfigState()
                                └─> CopilotConfigState (empty/incomplete/starting/ready/failed/degraded/error)
                                      └─> CopilotBootstrapState（加 loading 包装）
                                            └─> UI 消费
```

## Electron 主进程层：HostedBackendState

### 状态定义

定义位置：[`frontend-copilot/electron/runtime/runtime-state.ts`](../../frontend-copilot/electron/runtime/runtime-state.ts)

```typescript
export type HostedBackendStatus = 'starting' | 'ready' | 'failed' | 'stopped' | 'degraded'

export interface HostedBackendState {
  status: HostedBackendStatus
  mode: PythonRuntimeMode | null
  baseUrl: string | null
  pid: number | null
  startedAt: string | null
  readyAt: string | null
  stoppedAt: string | null
  exitCode: number | null
  signal: NodeJS.Signals | null
  lastFailure: HostedBackendFailure | null
}
```

### 状态语义与转换

| 状态 | 语义 | 典型转换路径 | 关键字段 |
|------|------|-------------|---------|
| `stopped` | 初始状态或已停止 | 初始 → `starting`<br/>任意状态 → `stopped` | `exitCode`, `signal` 可能保留上次退出信息 |
| `starting` | 后端进程已启动，等待健康检查通过 | `stopped` → `starting` → `ready`/`failed` | `mode`, `baseUrl`, `pid`, `startedAt` |
| `ready` | 后端健康检查通过，可用 | `starting` → `ready` | `readyAt` 记录就绪时间 |
| `failed` | 启动失败或运行中遇到不可恢复错误 | `starting` → `failed`<br/>`ready` → `failed` | `lastFailure` 记录失败详情 |
| `degraded` | 曾经 ready，但后续异常退出；保留 baseUrl 供 renderer 继续尝试连接 | `ready` → `degraded` | `lastFailure` 记录降级原因，`baseUrl` 仍保留 |

### 状态转换函数

核心转换函数（[`runtime-state.ts`](../../frontend-copilot/electron/runtime/runtime-state.ts)）：

- [`createInitialHostedBackendState()`](../../frontend-copilot/electron/runtime/runtime-state.ts#L36) - 创建初始 `stopped` 状态
- [`markHostedBackendStarting()`](../../frontend-copilot/electron/runtime/runtime-state.ts#L51) - 标记为 `starting`，清空上次失败信息
- [`markHostedBackendReady()`](../../frontend-copilot/electron/runtime/runtime-state.ts#L70) - 标记为 `ready`，记录 `readyAt`
- [`markHostedBackendFailed()`](../../frontend-copilot/electron/runtime/runtime-state.ts#L81) - 标记为 `failed`，记录失败详情
- [`markHostedBackendDegraded()`](../../frontend-copilot/electron/runtime/runtime-state.ts#L96) - 标记为 `degraded`，保留 `baseUrl`
- [`markHostedBackendStopped()`](../../frontend-copilot/electron/runtime/runtime-state.ts#L111) - 标记为 `stopped`

测试覆盖：[`runtime-state.test.ts`](../../frontend-copilot/electron/runtime/runtime-state.test.ts#L46)

### 关键设计决策

1. **`degraded` 与 `failed` 的区别**：
   - `failed`：从未成功启动，或遇到不可恢复错误
   - `degraded`：曾经 `ready`，但后续异常退出；保留 `baseUrl` 允许 renderer 继续尝试连接

2. **失败信息结构化**：`lastFailure` 包含 `code`、`phase`、`message`、`retryable` 等字段，支持 UI 显示详细诊断信息

## Renderer 层：CopilotConfigState

### 状态定义

定义位置：[`frontend-copilot/src/features/copilot/types.ts`](../../frontend-copilot/src/features/copilot/types.ts)

```typescript
export type CopilotConfigStatus = 'empty' | 'incomplete' | 'starting' | 'ready' | 'failed' | 'degraded' | 'error'

export type CopilotConfigState =
  | CopilotConfigEmptyState
  | CopilotConfigIncompleteState
  | CopilotConfigStartingState
  | CopilotConfigReadyState
  | CopilotConfigFailedState
  | CopilotConfigDegradedState
  | CopilotConfigErrorState

// loading 属于 bootstrap 包装层，不属于 CopilotConfigState
export type CopilotBootstrapState = CopilotConfigState | { status: 'loading' }
```

> **注意**：`loading` 状态属于 `CopilotBootstrapState`，不属于 `CopilotConfigState`。`loading` 由根层（`CopilotAppRoot`）在异步读取配置之前注入，表示配置尚未装配完成，此时尚无 `CopilotConfigState` 可消费。

### 状态语义

| 状态 | 语义 | UI 表现 | 是否加载 Provider |
|------|------|---------|------------------|
| `error` | 配置或运行时读取链路本身失败 | 显示错误信息，提示检查 IPC 链路 | 否 |
| `empty` | `runtimeUrl` 和 `agentName` 都缺失 | 显示"尚未获得可用运行时" | 否 |
| `incomplete` | `runtimeUrl` 或 `agentName` 缺失其一 | 显示"连接信息仍不完整"，列出缺失字段 | 否 |
| `starting` | Hosted backend 正在启动 | 显示"宿主正在启动本地后端" | 否 |
| `ready` | 连接信息完整，可加载 Copilot provider | 显示"Copilot 连接入口已就绪"，展示连接信息 | 是 |
| `failed` | Hosted backend 启动失败，且无 dev override | 显示失败详情，提供重试按钮 | 否 |
| `degraded` | Hosted backend 降级，但保留可用 URL | 显示降级警告，仍加载 Copilot provider | 是 |

> **`loading` 状态（`CopilotBootstrapState` 专属）**：根层正在读取配置与运行时 snapshot，显示 loading 提示，不加载 Provider。该状态由根层注入，属于 `CopilotBootstrapState` 而非 `CopilotConfigState`。

### 状态归并逻辑

核心函数：[`resolveCopilotConfigState()`](../../frontend-copilot/src/features/copilot/config.ts#L41)

输入：
- `settingsResult`：用户本地设置（`runtimeUrl`, `agentName`）
- `runtimeResult`：Electron 主进程提供的 hosted runtime snapshot

输出：`CopilotConfigState`

#### 归并规则

1. **错误态优先**：
   - 如果 `settingsResult` 或 `runtimeResult` 读取失败 → `error`

2. **Runtime URL 来源选择**（[`resolveRuntimeSelection()`](../../frontend-copilot/src/features/copilot/config.ts#L233)）：
   - Hosted backend 为 `ready`/`starting`/`degraded` → 使用 hosted `runtimeUrl`，来源标记为 `hosted`
   - Hosted backend 为 `failed`/`stopped` 且允许 dev override（开发模式 + 用户填写了 `runtimeUrl`）→ 使用用户填写的 `runtimeUrl`，来源标记为 `dev-override`
   - 否则 → `runtimeUrl` 为 `null`，来源标记为 `none`

3. **状态映射**（基于 hosted backend status）：
   - `ready` + 连接信息完整 → `ready`
   - `ready` + 连接信息不完整 → `incomplete`
   - `starting` → `starting`
   - `degraded` + 连接信息完整 → `degraded`
   - `degraded` + 连接信息不完整 → `incomplete`
   - `failed` + dev override 可用 → `ready`（使用 dev override）
   - `failed` + dev override 不可用 → `failed`
   - `stopped` + dev override 可用 → `ready`（使用 dev override）
   - `stopped` + 两个字段都缺失 → `empty`
   - `stopped` + 部分字段缺失 → `incomplete`

测试覆盖：[`config.test.ts`](../../frontend-copilot/src/features/copilot/config.test.ts)

### 关键字段说明

每个 `CopilotConfigState`（除 `error`）都包含以下字段：

- `settings`：归一化后的用户设置
- `storageState`：设置存储状态（`empty`/`stored`/`error`）
- `runtime`：Hosted runtime snapshot
- `runtimeUrl`：最终选定的 runtime URL（可能来自 hosted 或 dev override）
- `runtimeSource`：URL 来源（`hosted`/`dev-override`/`none`）
- `agentName`：Agent 名称
- `agentNameSource`：Agent 名称来源（`settings`/`missing`）
- `diagnostics`：诊断摘要，包含 hosted status、failure、mode 等信息
- `devOverrideAllowed`：是否允许 dev override（开发模式 + 非打包）
- `devOverrideConfigured`：是否已配置 dev override

`ready` 和 `degraded` 状态额外保证：
- `runtimeUrl` 和 `agentName` 都非 `null`

## UI 消费

### 根层装配（CopilotAppRoot）

位置：[`frontend-copilot/src/CopilotAppRoot.tsx`](../../frontend-copilot/src/CopilotAppRoot.tsx)

根层负责：
1. 读取配置与运行时状态（[`loadCopilotConfigState()`](../../frontend-copilot/src/features/copilot/config.ts#L196)）
2. 决策是否加载 CopilotKit provider（[`shouldLoadCopilotProvider()`](../../frontend-copilot/src/CopilotAppRoot.tsx#L148)）
3. 提供统一的 bootstrap controller 给工作台

加载 Provider 条件：
- `configState` 为 `ready` 或 `degraded`
- Provider 尚未加载
- 不允许无 Provider 进入工作台

### 聊天面板消费（CopilotChatPanel）

位置：[`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx)

根据 `CopilotBootstrapState.status` 渲染不同 UI：

- `loading`：显示"正在等待根层完成运行态装配"（来自 `CopilotBootstrapState`，`CopilotConfigState` 不含此状态）
- `error`：显示"读取运行态失败"，展示错误信息
- `empty`：显示"尚未获得可用运行时"，说明缺少连接信息
- `incomplete`：显示"连接信息仍不完整"，列出缺失字段
- `starting`：显示"宿主正在启动本地后端"
- `failed`：显示"宿主启动后端失败"，展示失败详情，提供重试按钮
- `degraded`：显示"宿主运行态已降级"警告，但仍挂载聊天区域
- `ready`：显示"Copilot 连接入口已就绪"，挂载聊天区域

失败态重试条件（[`canRetry()`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx#L505)）：
- 状态为 `failed`
- `diagnostics.failure` 存在
- `diagnostics.failure.retryable` 为 `true`

## 典型场景示例

### 场景 1：正常启动（hosted backend）

1. 初始：`HostedBackendState.status = 'stopped'`
2. Electron 主进程启动 Python runtime → `starting`
3. 健康检查通过 → `ready`，`baseUrl = 'http://127.0.0.1:8765'`
4. Renderer 读取 snapshot + 用户设置（`agentName = 'campus-agent'`）
5. `resolveCopilotConfigState()` → `CopilotConfigState.status = 'ready'`，`runtimeSource = 'hosted'`
6. UI 显示"Copilot 连接入口已就绪"，加载 CopilotKit provider

### 场景 2：启动失败，允许 dev override

1. Hosted backend 启动失败 → `HostedBackendState.status = 'failed'`
2. 用户在开发模式下手填 `runtimeUrl = 'http://127.0.0.1:3000'`，`agentName = 'campus-agent'`
3. `resolveCopilotConfigState()` 检测到 dev override 可用 → `CopilotConfigState.status = 'ready'`，`runtimeSource = 'dev-override'`
4. UI 显示"Copilot 连接入口已就绪"，使用 dev override URL

### 场景 3：运行中降级

1. Hosted backend 曾经 `ready`，后异常退出
2. Electron 主进程标记为 `degraded`，保留 `baseUrl`
3. Renderer 读取 snapshot → `CopilotConfigState.status = 'degraded'`
4. UI 显示降级警告，但仍挂载聊天区域，允许用户继续尝试连接

### 场景 4：配置不完整

1. Hosted backend 为 `stopped`
2. 用户只填写了 `runtimeUrl`，未填写 `agentName`
3. `resolveCopilotConfigState()` → `CopilotConfigState.status = 'incomplete'`，`missingFields = ['agentName']`
4. UI 显示"连接信息仍不完整"，列出缺失字段

## 常见问题

### Q: 为什么 `ready` 状态下仍看不到完整聊天 UI？

A: `ready` 只表示"连接信息完整，可加载 Copilot provider"，不等于"聊天 UI 已完成"。当前实现中，`ready` 后会挂载聊天区域，但完整消息界面取决于 CopilotKit 的加载与连接状态。

### Q: `degraded` 和 `failed` 有什么区别？

A: 
- `failed`：从未成功启动，或遇到不可恢复错误，无可用 runtime URL
- `degraded`：曾经 `ready`，但后续异常退出；保留 runtime URL，允许 renderer 继续尝试连接

### Q: Dev override 什么时候生效？

A: 仅在以下条件同时满足时生效：
- 开发模式（`expectedMode = 'development'`）
- 非打包环境（`isPackaged = false`）
- Hosted backend 为 `failed` 或 `stopped`
- 用户手填了 `runtimeUrl`

### Q: 如何排查 `error` 状态？

A: `error` 表示配置或运行时读取链路本身失败，优先检查：
- Electron 主进程是否正常读取配置文件
- Preload 是否正常暴露 IPC 桥接
- Renderer 中 `window.copilotRuntime` 和 `window.copilotSettings` 是否可用

### Q: 为什么用户手填 runtime URL 与 hosted runtime snapshot 会被统一？

A: [`resolveCopilotConfigState()`](../../frontend-copilot/src/features/copilot/config.ts#L41) 负责归并两者：
- 优先使用 hosted runtime 提供的 URL（如果可用）
- 仅在 hosted runtime 不可用且允许 dev override 时，才使用用户手填 URL
- 最终输出统一的 `CopilotConfigState`，UI 只需消费这一状态

## 代码锚点

### 主进程层

- 状态定义：[`frontend-copilot/electron/runtime/runtime-state.ts`](../../frontend-copilot/electron/runtime/runtime-state.ts)
- 状态测试：[`frontend-copilot/electron/runtime/runtime-state.test.ts`](../../frontend-copilot/electron/runtime/runtime-state.test.ts)
- Runtime manager：[`frontend-copilot/electron/runtime/python-runtime-manager.ts`](../../frontend-copilot/electron/runtime/python-runtime-manager.ts)
- IPC 契约：[`frontend-copilot/electron/copilot-runtime.ts`](../../frontend-copilot/electron/copilot-runtime.ts)

### Renderer 层

- 状态定义：[`frontend-copilot/src/features/copilot/types.ts`](../../frontend-copilot/src/features/copilot/types.ts)
- 状态归并：[`frontend-copilot/src/features/copilot/config.ts`](../../frontend-copilot/src/features/copilot/config.ts)
- 归并测试：[`frontend-copilot/src/features/copilot/config.test.ts`](../../frontend-copilot/src/features/copilot/config.test.ts)
- 根层装配：[`frontend-copilot/src/CopilotAppRoot.tsx`](../../frontend-copilot/src/CopilotAppRoot.tsx)
- 聊天面板：[`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx)

## 相关文档

- 系统架构总览：[`docs/system/architecture-overview.md`](../system/architecture-overview.md)
- 运行时生命周期：[`docs/system/runtime-lifecycle.md`](../system/runtime-lifecycle.md)
- Session 与状态模型：[`docs/system/session-and-state-model.md`](../system/session-and-state-model.md)
- 前端分册入口：[`docs/frontend/README.md`](./README.md)

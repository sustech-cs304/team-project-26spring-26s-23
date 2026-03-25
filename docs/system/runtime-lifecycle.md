# 运行时生命周期

## 文档目标

本文档描述 CanDue 桌面应用的运行时如何被启动、配置、就绪、使用与回收，覆盖当前已落地的两种主路径：

- **development / hosted backend 模式**：开发环境下，Electron 主进程启动本地 Python 后端子进程
- **packaged / bundled runtime 模式**：打包环境下，Electron 主进程启动捆绑的 Python 运行时

本文档聚焦运行时生命周期管理，不展开聊天协议细节或 session/state 模型细节（这些属于后续专题文档）。

## 运行时模式

系统支持两种运行时模式，由 Electron 主进程根据 `app.isPackaged` 自动判断：

### development 模式

- **触发条件**：`app.isPackaged === false`
- **Python 解析策略**：使用工作区 `backend/` 目录下的源码，通过 `python -m app.desktop_runtime` 启动
- **依赖管理**：不强制依赖 `uv`，开发者可自行管理 Python 虚拟环境
- **代码锚点**：[`frontend-copilot/electron/runtime/python-runtime-resolver.ts`](../../frontend-copilot/electron/runtime/python-runtime-resolver.ts)

### bundled 模式

- **触发条件**：`app.isPackaged === true`
- **Python 解析策略**：使用 `app.getPath('resources')` 下的 `python-runtime/` 目录，包含预打包的 Python 解释器与依赖；具体布局以 `backend-runtime-manifest.json` 为准，由 `python-runtime-resolver.ts` 解析
- **打包脚本**：[`frontend-copilot/scripts/prepare-bundled-runtime.mjs`](../../frontend-copilot/scripts/prepare-bundled-runtime.mjs)
- **代码锚点**：[`frontend-copilot/electron/runtime/python-runtime-resolver.ts`](../../frontend-copilot/electron/runtime/python-runtime-resolver.ts)

## 启动阶段

### 1. Electron 主进程初始化

**入口**：[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)

```
app.whenReady() → registerHandlers() → startHostedBackend() → createWindow()
```

**关键步骤**：

1. 注册 IPC handlers：
   - `COPILOT_SETTINGS_LOAD_CHANNEL` / `COPILOT_SETTINGS_SAVE_CHANNEL`
   - `COPILOT_RUNTIME_LOAD_CHANNEL` / `COPILOT_RUNTIME_RETRY_CHANNEL`
2. 解析命令行参数（如果提供）：
   - `--runtime-model`：指定 Copilot 模型
   - `--runtime-host`：指定监听地址（默认 `127.0.0.1`）
   - `--runtime-app-mode`：指定应用模式（默认 `desktop`）
   - `--runtime-environment`：指定运行环境（默认 `development` 或 `production`）
   - `--runtime-local-token`：指定本地令牌
3. 创建 `HostedBackendService` 实例
4. 异步启动 hosted backend（不阻塞窗口创建）
5. 创建 BrowserWindow 并加载 renderer

**代码锚点**：
- 命令行参数解析：[`frontend-copilot/electron/runtime/runtime-config.ts`](../../frontend-copilot/electron/runtime/runtime-config.ts) `parseHostedRuntimeCommandLineArguments()`
- 服务创建：[`frontend-copilot/electron/runtime/hosted-backend-service.ts`](../../frontend-copilot/electron/runtime/hosted-backend-service.ts)

### 2. 运行时配置组装

**负责模块**：[`frontend-copilot/electron/runtime/runtime-config.ts`](../../frontend-copilot/electron/runtime/runtime-config.ts)

**配置来源优先级**（从高到低）：

1. **CLI 参数**（主路径）：
   - Electron 主进程参数：`--runtime-*`
   - 传递给 Python 子进程的参数：`--host`, `--port`, `--model`, `--local-token` 等
2. **环境变量**（兼容回退）：
   - `COPILOT_DESKTOP_RUNTIME_HOST`
   - `COPILOT_DESKTOP_RUNTIME_ENVIRONMENT`
   - `COPILOT_RUNTIME_MODEL` / `COPILOT_MODEL`（legacy）
   - 其他 `COPILOT_DESKTOP_RUNTIME_*` 变量
3. **默认值**：
   - `host`: `127.0.0.1`
   - `port`: 动态分配（通过 `allocateLoopbackPort()`）
   - `appMode`: `desktop`
   - `environment`: `development`（开发）或 `production`（打包）
   - `localToken`: 自动生成（24 字节随机 hex）

**关键函数**：
- `createHostedRuntimeLaunchConfig()`：组装完整启动配置
- `buildDesktopRuntimeArguments()`：构建传递给 Python 子进程的 CLI 参数数组
- `allocateLoopbackPort()`：动态分配可用端口

**测试依据**：[`frontend-copilot/electron/runtime/runtime-config.test.ts`](../../frontend-copilot/electron/runtime/runtime-config.test.ts)

### 3. Python 运行时解析

**负责模块**：[`frontend-copilot/electron/runtime/python-runtime-resolver.ts`](../../frontend-copilot/electron/runtime/python-runtime-resolver.ts)

**解析逻辑**：

```typescript
resolvePythonRuntimeLaunchSpec({
  appRoot,
  resourcesPath,
  isPackaged
}) → PythonRuntimeLaunchSpec
```

**development 模式解析**：
- `workspaceRoot`: `appRoot` 的父目录
- `backendDir`: `workspaceRoot/backend`
- `command`: `python`（系统 PATH 中的 Python）
- `args`: `['-m', 'app.desktop_runtime']`
- `workingDirectory`: `backendDir`
- `entryModule`: `app.desktop_runtime`

**bundled 模式解析**：
- `resourcesRoot`: `resourcesPath`
- `backendDir`: `resourcesRoot/python-runtime`
- `command`: `backendDir/python/bin/python`（Windows 为 `python.exe`）
- `args`: `['-m', 'app.desktop_runtime']`
- `workingDirectory`: `backendDir`
- `entryModule`: `app.desktop_runtime`

**失败面**：
- Python 可执行文件不存在
- `backend/` 目录结构不完整
- `python-runtime/` 目录缺失或损坏

### 4. Python 子进程启动

**负责模块**：[`frontend-copilot/electron/runtime/python-runtime-manager.ts`](../../frontend-copilot/electron/runtime/python-runtime-manager.ts)

**启动流程**：

```typescript
PythonRuntimeManager.start() →
  prepareRuntimePaths() →
  resolvePythonRuntimeLaunchSpec() →
  allocateLoopbackPort() →
  createHostedRuntimeLaunchConfig() →
  spawn(command, args, options) →
  waitForRuntimeReady()
```

**spawn 参数**：
- `command`: Python 可执行文件路径
- `args`: `['-m', 'app.desktop_runtime', '--host', '127.0.0.1', '--port', '54321', ...]`
- `cwd`: `backendDir`
- `env`: 清理后的环境变量（移除 `COPILOT_DESKTOP_RUNTIME_*`，添加 `PYTHONUNBUFFERED=1`）
- `stdio`: `['ignore', 'pipe', 'pipe']`（捕获 stdout/stderr）

**状态流转**：
- `stopped` → `starting`（spawn 成功）
- `starting` → `ready`（健康检查通过）
- `starting` → `failed`（spawn 失败或健康检查超时）

**代码锚点**：
- `PythonRuntimeManager.startInternal()`
- `trackSpawnedProcess()`：监听子进程事件
- `waitForRuntimeReady()`：轮询健康检查

**测试依据**：[`frontend-copilot/electron/runtime/runtime-state.test.ts`](../../frontend-copilot/electron/runtime/runtime-state.test.ts)

### 5. Python 后端配置解析与 FastAPI 启动

**入口**：[`backend/app/desktop_runtime/__main__.py`](../../backend/app/desktop_runtime/__main__.py) → [`backend/app/desktop_runtime/server.py`](../../backend/app/desktop_runtime/server.py)

**配置解析**：[`backend/app/desktop_runtime/config.py`](../../backend/app/desktop_runtime/config.py)

```python
parse_runtime_config(argv, env=os.environ) → DesktopRuntimeConfig
```

**配置来源优先级**（从高到低）：

1. **CLI 参数**（主路径）：
   - `--host`, `--port`, `--app-mode`, `--environment`
   - `--model`, `--local-token`
   - 路径参数：`--user-data-dir`, `--root-dir`, `--config-dir`, `--logs-dir`, `--database-dir`, `--state-dir`
   - 文件参数：`--settings-file`, `--host-log-file`, `--backend-stdout-log-file`, `--backend-stderr-log-file`
2. **环境变量**（兼容回退）：
   - `COPILOT_DESKTOP_RUNTIME_HOST`, `COPILOT_DESKTOP_RUNTIME_PORT`
   - `COPILOT_RUNTIME_MODEL` / `COPILOT_MODEL`（legacy）
   - 其他 `COPILOT_DESKTOP_RUNTIME_*` 变量
3. **默认值**：
   - `host`: `127.0.0.1`（仅允许 loopback 地址）
   - `port`: `8765`
   - `app_mode`: `desktop`
   - `environment`: `development`

**FastAPI 应用创建**：

```python
create_app(config) →
  RuntimeLifecycleManager(config) →
  build_default_runtime_dependencies() →
  FastAPI(lifespan=lifespan)
```

**lifespan 管理**：
- `startup()`：初始化 session store、agent registry、tool registry
- `shutdown()`：清理资源

**HTTP 端点**：
- `/health`：健康检查
- `/ready`：就绪检查（返回 `{"ready": true}`）
- `/version` / `/build-info`：版本信息
- `/diagnostics`：诊断信息（需要 local token）
- `/agent/*`：Copilot 聊天运行时端点

**代码锚点**：
- `create_app()`：[`backend/app/desktop_runtime/server.py`](../../backend/app/desktop_runtime/server.py)
- `parse_runtime_config()`：[`backend/app/desktop_runtime/config.py`](../../backend/app/desktop_runtime/config.py)

**测试依据**：
- [`backend/tests/unit/desktop_runtime/test_config.py`](../../backend/tests/unit/desktop_runtime/test_config.py)
- [`backend/tests/unit/desktop_runtime/test_server.py`](../../backend/tests/unit/desktop_runtime/test_server.py)

### 6. 就绪检查与状态同步

**Electron 侧健康检查**：[`frontend-copilot/electron/runtime/python-runtime-manager.ts`](../../frontend-copilot/electron/runtime/python-runtime-manager.ts)

```typescript
waitForRuntimeReady(child, config) →
  循环轮询 GET /ready (每 300ms) →
  超时 30s 后失败
```

**就绪判定**：
- HTTP 200 响应
- 响应体包含 `{"ready": true}`

**状态流转**：
- `starting` → `ready`：就绪检查通过
- `starting` → `failed`：超时或子进程退出

**renderer 侧等待**：[`frontend-copilot/src/features/copilot/runtime.ts`](../../frontend-copilot/src/features/copilot/runtime.ts)

```typescript
loadCopilotRuntime() →
  IPC: COPILOT_RUNTIME_LOAD_CHANNEL →
  返回 CopilotRuntimeSnapshot
```

**CopilotRuntimeSnapshot 结构**：
- `hosted.status`：`starting` | `ready` | `failed` | `stopped` | `degraded`
- `hosted.runtimeUrl`：运行时 base URL
- `hosted.failure`：失败摘要（如果有）

**代码锚点**：
- `probeRuntimeReadiness()`：[`frontend-copilot/electron/runtime/python-runtime-manager.ts`](../../frontend-copilot/electron/runtime/python-runtime-manager.ts)
- `buildCopilotRuntimeSnapshot()`：[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)

## 运行时状态模型

### HostedBackendState

**定义**：[`frontend-copilot/electron/runtime/runtime-state.ts`](../../frontend-copilot/electron/runtime/runtime-state.ts)

**状态枚举**：

- `stopped`：初始状态或已停止
- `starting`：子进程已 spawn，等待就绪
- `ready`：就绪检查通过，可接受请求
- `failed`：启动失败或运行时崩溃
- `degraded`：运行时曾就绪但后续退出

**状态字段**：

```typescript
{
  status: HostedBackendStatus
  mode: 'development' | 'bundled' | null
  baseUrl: string | null
  pid: number | null
  startedAt: string | null  // ISO 8601
  readyAt: string | null
  stoppedAt: string | null
  exitCode: number | null
  signal: NodeJS.Signals | null
  lastFailure: HostedBackendFailure | null
}
```

**状态转换函数**：
- `markHostedBackendStarting()`
- `markHostedBackendReady()`
- `markHostedBackendFailed()`
- `markHostedBackendDegraded()`
- `markHostedBackendStopped()`

**测试依据**：[`frontend-copilot/electron/runtime/runtime-state.test.ts`](../../frontend-copilot/electron/runtime/runtime-state.test.ts)

## 停止与回收

### 正常停止

**触发时机**：
- 用户关闭应用窗口
- Electron `before-quit` 事件

**停止流程**：[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)

```typescript
app.on('before-quit') →
  stopHostedBackend() →
  PythonRuntimeManager.stop() →
  发送 SIGTERM →
  等待子进程退出（超时 5s）→
  必要时发送 SIGKILL
```

**状态流转**：
- `ready` → `stopped`：正常退出
- `ready` → `failed`：停止超时

**代码锚点**：
- `stopInternal()`：[`frontend-copilot/electron/runtime/python-runtime-manager.ts`](../../frontend-copilot/electron/runtime/python-runtime-manager.ts)

### 异常退出处理

**监听机制**：`child.once('exit', (code, signal) => ...)`

**退出分类**：[`frontend-copilot/electron/runtime/runtime-diagnostics.ts`](../../frontend-copilot/electron/runtime/runtime-diagnostics.ts)

- `code === 0`：正常退出
- `code !== 0`：异常退出
- `signal !== null`：被信号终止

**失败记录**：
- `HostedBackendFailure` 对象
- 持久化到 `last-failure.json`
- 包含 stdout/stderr 尾部输出（最多 8000 字符）

**状态流转**：
- `starting` 时退出 → `failed`
- `ready` 时退出 → `degraded`

## 配置来源总结

### CLI 参数为主路径

当前运行时配置以 CLI 参数为主导，环境变量仅作为兼容回退。这一设计确保：

1. **显式配置**：Electron 主进程完全控制 Python 子进程的启动参数
2. **隔离性**：子进程不继承宿主的 `COPILOT_DESKTOP_RUNTIME_*` 环境变量
3. **可测试性**：配置解析逻辑可独立测试，不依赖全局环境

**Electron → Python 参数传递**：

```
Electron CLI: --runtime-model=gpt-4
              ↓
Python CLI:   --model=gpt-4
```

**代码锚点**：
- Electron 侧：[`frontend-copilot/electron/runtime/runtime-config.ts`](../../frontend-copilot/electron/runtime/runtime-config.ts) `buildDesktopRuntimeArguments()`
- Python 侧：[`backend/app/desktop_runtime/config.py`](../../backend/app/desktop_runtime/config.py) `parse_runtime_config()`

### 环境变量兼容回退

环境变量支持以下场景：

1. **开发调试**：临时覆盖配置而不修改启动脚本
2. **CI/CD**：在自动化环境中注入配置
3. **向后兼容**：支持旧版本的配置方式

**优先级**：CLI 参数 > 环境变量 > 默认值

## 当前边界

### 已实现

- ✅ development / bundled 两种运行时模式
- ✅ CLI 参数主导的配置体系
- ✅ 动态端口分配
- ✅ 自动生成 local token
- ✅ 健康检查与就绪探测
- ✅ 子进程 stdout/stderr 捕获与日志持久化
- ✅ 失败诊断与状态快照
- ✅ 优雅停止与超时强制终止

### 未实现（非当前范围）

- ❌ 运行时热重启
- ❌ 多实例并发管理
- ❌ 外部部署模式（非 hosted backend）
- ❌ 运行时健康度量与自动恢复
- ❌ 配置文件持久化（当前仅支持 CLI/环境变量）

### 关键约束

1. **loopback 限制**：运行时仅监听 `127.0.0.1` / `localhost` / `::1`，不支持外部访问
2. **单实例模型**：每个 Electron 主进程仅管理一个 Python 子进程
3. **同步启动**：窗口创建不等待运行时就绪，renderer 需轮询状态
4. **无持久化编排**：运行时不作为系统服务运行，随 Electron 进程生命周期

## 相关文档

- [系统架构总览](./architecture-overview.md)：理解运行时在整体架构中的位置
- [聊天运行时契约](./chat-runtime-contract.md)：理解运行时就绪后的 HTTP 端点契约
- [Session 与状态模型](./session-and-state-model.md)：理解运行时内部的 session 管理

## 代码锚点索引

### Electron 主进程

- 启动入口：[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)
- 配置解析：[`frontend-copilot/electron/runtime/runtime-config.ts`](../../frontend-copilot/electron/runtime/runtime-config.ts)
- 运行时管理：[`frontend-copilot/electron/runtime/python-runtime-manager.ts`](../../frontend-copilot/electron/runtime/python-runtime-manager.ts)
- 运行时解析：[`frontend-copilot/electron/runtime/python-runtime-resolver.ts`](../../frontend-copilot/electron/runtime/python-runtime-resolver.ts)
- 状态模型：[`frontend-copilot/electron/runtime/runtime-state.ts`](../../frontend-copilot/electron/runtime/runtime-state.ts)
- 失败诊断：[`frontend-copilot/electron/runtime/runtime-diagnostics.ts`](../../frontend-copilot/electron/runtime/runtime-diagnostics.ts)

### Python 后端

- 启动入口：[`backend/app/desktop_runtime/__main__.py`](../../backend/app/desktop_runtime/__main__.py)
- 服务创建：[`backend/app/desktop_runtime/server.py`](../../backend/app/desktop_runtime/server.py)
- 配置解析：[`backend/app/desktop_runtime/config.py`](../../backend/app/desktop_runtime/config.py)
- 生命周期管理：[`backend/app/desktop_runtime/lifecycle.py`](../../backend/app/desktop_runtime/lifecycle.py)
- 健康检查：[`backend/app/desktop_runtime/health.py`](../../backend/app/desktop_runtime/health.py)

### 测试

- Electron 配置测试：[`frontend-copilot/electron/runtime/runtime-config.test.ts`](../../frontend-copilot/electron/runtime/runtime-config.test.ts)
- Electron 状态测试：[`frontend-copilot/electron/runtime/runtime-state.test.ts`](../../frontend-copilot/electron/runtime/runtime-state.test.ts)
- Python 配置测试：[`backend/tests/unit/desktop_runtime/test_config.py`](../../backend/tests/unit/desktop_runtime/test_config.py)
- Python 服务测试：[`backend/tests/unit/desktop_runtime/test_server.py`](../../backend/tests/unit/desktop_runtime/test_server.py)
- 集成测试：[`backend/tests/integration/test_copilot_runtime_http.py`](../../backend/tests/integration/test_copilot_runtime_http.py)

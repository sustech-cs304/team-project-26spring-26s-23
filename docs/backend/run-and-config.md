# 后端运行与配置

本文档说明当前 Python desktop runtime 的启动方式、配置来源与运行边界。

## 文档范围

本文档覆盖：

- Desktop runtime / copilot runtime 的启动入口与运行路径
- CLI 参数主导、环境变量兼容回退的配置规则
- 关键参数类别与运行时路径的角色
- Loopback-only / local desktop runtime 的安全边界

本文档不覆盖：

- Blackboard / TIS 业务能力说明（参见 [`docs/backend/README.md`](README.md)）
- 完整 HTTP 契约文档（参见 [`docs/system/chat-runtime-contract.md`](../system/chat-runtime-contract.md)）
- 跨进程启动链路（参见 [`docs/system/runtime-lifecycle.md`](../system/runtime-lifecycle.md)）

## 启动入口

### 主要启动路径

当前后端的主要启动入口是 [`backend/app/desktop_runtime/__main__.py`](../../backend/app/desktop_runtime/__main__.py)，它会调用 [`server.py`](../../backend/app/desktop_runtime/server.py#L165) 中的 `main()` 函数。

启动方式：

```bash
python -m app.desktop_runtime [参数...]
```

或在仓库根目录使用 `uv`：

```bash
uv run --directory backend python -m app.desktop_runtime [参数...]
```

### 配置解析入口

配置解析由 [`parse_runtime_config()`](../../backend/app/desktop_runtime/config.py#L234) 完成，它会：

1. 解析 CLI 参数（通过 [`build_runtime_argument_parser()`](../../backend/app/desktop_runtime/config.py#L202)）
2. 读取环境变量作为回退
3. 应用默认值
4. 构造 [`DesktopRuntimeConfig`](../../backend/app/desktop_runtime/config.py#L102) 对象

### 服务器创建与启动

[`create_app()`](../../backend/app/desktop_runtime/server.py#L73) 函数负责：

- 创建 FastAPI 应用实例
- 配置 CORS 中间件（仅允许 loopback origin）
- 注册健康检查端点（`/health`、`/ready`、`/version`、`/diagnostics`）
- 挂载 copilot runtime 路由（单端点协议，路径 `/`）
- 配置生命周期管理（startup/shutdown）

[`main()`](../../backend/app/desktop_runtime/server.py#L165) 函数使用 uvicorn 启动服务器。

## 配置来源与优先级

### 优先级规则

配置来源按以下优先级应用（高优先级覆盖低优先级）：

1. **CLI 参数**（最高优先级）
2. **环境变量**
3. **默认值**（最低优先级）

这一规则在 [`parse_runtime_config()`](../../backend/app/desktop_runtime/config.py#L234) 中实现，通过 `_resolve_optional_text_value()` 等辅助函数完成。

### 测试验证

优先级规则在 [`backend/tests/unit/desktop_runtime/test_config.py`](../../backend/tests/unit/desktop_runtime/test_config.py#L109) 中有明确测试：

```python
def test_cli_arguments_override_environment_values(tmp_path: Path) -> None:
    # CLI 参数会覆盖环境变量
```

## 关键参数类别

### 网络参数

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
|------|---------|---------|--------|------|
| Host | `--host` | `COPILOT_DESKTOP_RUNTIME_HOST` | `127.0.0.1` | 监听地址，仅允许 loopback |
| Port | `--port` | `COPILOT_DESKTOP_RUNTIME_PORT` | `8765` | 监听端口 |

**安全约束**：Host 必须是 loopback 地址（`127.0.0.1`、`localhost`、`::1`），否则会抛出 `ValueError`。这一约束在 [`_resolve_host()`](../../backend/app/desktop_runtime/config.py#L362) 中强制执行。

### 应用模式与环境

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
|------|---------|---------|--------|------|
| App Mode | `--app-mode` | `COPILOT_DESKTOP_RUNTIME_APP_MODE` | `desktop` | 应用模式标识 |
| Environment | `--environment` | `COPILOT_DESKTOP_RUNTIME_ENVIRONMENT` | `development` | 运行环境标识 |

### 目录参数

所有目录参数支持相对路径（相对于 `cwd`）和绝对路径。相对路径会被解析为绝对路径。

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
|------|---------|---------|--------|------|
| User Data Dir | `--user-data-dir` | `COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR` | `backend/data` | 运行时 user data 根目录（Electron 传入 userData；CLI 默认 `backend/data`） |
| Runtime Root Dir | `--root-dir` | `COPILOT_DESKTOP_RUNTIME_ROOT_DIR` | `{user_data_dir}/desktop-runtime` | 运行时根目录 |
| Config Dir | `--config-dir` | `COPILOT_DESKTOP_RUNTIME_CONFIG_DIR` | `{runtime_root_dir}/config` | 配置目录 |
| Logs Dir | `--logs-dir` | `COPILOT_DESKTOP_RUNTIME_LOGS_DIR` | `{runtime_root_dir}/logs` | 日志目录 |
| Database Dir | `--database-dir` | `COPILOT_DESKTOP_RUNTIME_DATABASE_DIR` | `{runtime_root_dir}/database` | 数据库目录 |
| State Dir | `--state-dir` | `COPILOT_DESKTOP_RUNTIME_STATE_DIR` | `{runtime_root_dir}/state` | 诊断与状态目录 |

### 文件路径参数

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
|------|---------|---------|--------|------|
| Settings File | `--settings-file` | `COPILOT_DESKTOP_RUNTIME_SETTINGS_FILE` | `{config_dir}/copilot-settings.json` | Copilot 设置文件 |
| Host Log File | `--host-log-file` | `COPILOT_DESKTOP_RUNTIME_HOST_LOG_FILE` | `{logs_dir}/electron-host.log` | Electron 主进程日志 |
| Backend Stdout Log | `--backend-stdout-log-file` | `COPILOT_DESKTOP_RUNTIME_BACKEND_STDOUT_LOG_FILE` | `{logs_dir}/backend.stdout.log` | Python 子进程 stdout |
| Backend Stderr Log | `--backend-stderr-log-file` | `COPILOT_DESKTOP_RUNTIME_BACKEND_STDERR_LOG_FILE` | `{logs_dir}/backend.stderr.log` | Python 子进程 stderr |
| Runtime Snapshot | `--runtime-snapshot-file` | `COPILOT_DESKTOP_RUNTIME_SNAPSHOT_FILE` | `{state_dir}/runtime-snapshot.json` | 运行态快照 |
| Last Failure | `--last-failure-file` | `COPILOT_DESKTOP_RUNTIME_LAST_FAILURE_FILE` | `{state_dir}/last-failure.json` | 最近失败摘要 |

### 模型与认证参数

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
|------|---------|---------|--------|------|
| Model | `--model` | `COPILOT_RUNTIME_MODEL`<br>`COPILOT_MODEL`（兼容） | `None` | Copilot 聊天运行时模型名称 |
| Local Token | `--local-token` | `COPILOT_DESKTOP_RUNTIME_LOCAL_TOKEN` | `None` | 本地宿主调用令牌（可选） |

**模型参数说明**：

- 推荐通过 `--model` 显式传入
- 环境变量 `COPILOT_RUNTIME_MODEL` 优先于 `COPILOT_MODEL`
- 开发态验证协议链路时可用 `--model test`

**Local Token 说明**：

- 可选参数，若提供则保护 `/diagnostics` 端点
- 需通过 `X-Local-Token` 请求头传递
- Diagnostics 响应与日志不会写出 token 明文

## 运行时路径与产物

### 目录结构

默认目录结构（基于 `backend/data`）：

```
backend/data/
└── desktop-runtime/          # runtime_root_dir
    ├── config/               # config_dir
    │   └── copilot-settings.json
    ├── logs/                 # logs_dir
    │   ├── electron-host.log
    │   ├── backend.stdout.log
    │   └── backend.stderr.log
    ├── database/             # database_dir
    └── state/                # state_dir
        ├── runtime-snapshot.json
        └── last-failure.json
```

### 路径角色说明

| 路径 | 角色 | 创建时机 |
|------|------|---------|
| `copilot-settings.json` | Copilot 用户设置持久化 | 按需创建 |
| `electron-host.log` | Electron 主进程日志（由前端写入） | 前端启动时 |
| `backend.stdout.log` | Python 子进程标准输出 | 前端重定向时 |
| `backend.stderr.log` | Python 子进程标准错误 | 前端重定向时 |
| `runtime-snapshot.json` | 运行态快照（配置、状态、能力） | 启动时 |
| `last-failure.json` | 最近失败摘要 | 失败时 |

### 目录初始化

目录在运行时启动时自动创建，通过 [`DesktopRuntimePaths.ensure_directories()`](../../backend/app/desktop_runtime/config.py#L71) 实现。

## 前端调用方如何传参

Electron 主进程通过 [`frontend-copilot/electron/runtime/runtime-config.ts`](../../frontend-copilot/electron/runtime/runtime-config.ts) 构造启动参数。

关键函数：

- [`createHostedRuntimeLaunchConfig()`](../../frontend-copilot/electron/runtime/runtime-config.ts#L315)：创建启动配置
- [`buildDesktopRuntimeArguments()`](../../frontend-copilot/electron/runtime/runtime-config.ts#L459)：构造 CLI 参数数组
- [`allocateLoopbackPort()`](../../frontend-copilot/electron/runtime/runtime-config.ts#L369)：分配可用端口

前端会：

1. 分配一个可用的 loopback 端口
2. 生成随机 local token（通过 [`createLocalToken()`](../../frontend-copilot/electron/runtime/runtime-config.ts#L162)）
3. 构造完整的 CLI 参数数组
4. 启动 Python 子进程并传递参数

## 安全边界

### Loopback-only 约束

Desktop runtime 强制执行 loopback-only 约束：

- Host 必须是 `127.0.0.1`、`localhost` 或 `::1`
- 尝试绑定其他地址会导致启动失败
- CORS 中间件仅允许 loopback origin（通过正则 [`_DESKTOP_LOOPBACK_ORIGIN_REGEX`](../../backend/app/desktop_runtime/server.py#L43)）

### Electron 打包应用的特殊处理

对于 `Origin: null` 的请求（Electron 打包应用的典型行为），[`DesktopNullOriginMiddleware`](../../backend/app/desktop_runtime/server.py#L49) 会：

1. 检查 User-Agent 是否包含 `electron/`
2. 仅允许来自 Electron 的 `null` origin 请求
3. 拒绝其他 `null` origin 请求（返回 400）

### Local Token 保护

当配置 `--local-token` 时：

- `/diagnostics` 和 `/diagnostics/runtime-info` 端点需要 `X-Local-Token` 请求头
- Token 不匹配时返回 401 Unauthorized
- Token 不会出现在日志、快照或 diagnostics 响应中

## 开发运行示例

### 最小启动

```bash
cd backend
python -m app.desktop_runtime
```

使用默认配置：`127.0.0.1:8765`，数据目录 `backend/data/desktop-runtime`。

### 显式指定参数

```bash
python -m app.desktop_runtime \
  --host 127.0.0.1 \
  --port 8771 \
  --app-mode desktop \
  --environment development \
  --root-dir ./backend/data/desktop-runtime-cli \
  --model test \
  --local-token cli-token
```

### 使用 uv（从仓库根目录）

```bash
uv run --directory backend python -m app.desktop_runtime \
  --host 127.0.0.1 \
  --port 8771 \
  --model test
```

**注意**：开发运行时不强制依赖 `uv`。`uv` 仅作为后端虚拟环境/依赖管理工具，不是 Electron 开发运行时的必要依赖。

### 验证启动

启动后可访问：

- `http://127.0.0.1:8765/health` - 健康检查
- `http://127.0.0.1:8765/ready` - 就绪状态
- `http://127.0.0.1:8765/version` - 版本信息
- `http://127.0.0.1:8765/diagnostics` - 运行时诊断（需要 local token）

## 与系统专题的关系

本文档聚焦于"如何运行、如何理解配置"。相关系统专题：

- **跨进程启动链路**：参见 [`docs/system/runtime-lifecycle.md`](../system/runtime-lifecycle.md)
- **HTTP 契约**：参见 [`docs/system/chat-runtime-contract.md`](../system/chat-runtime-contract.md)
- **会话语义**：参见 [`docs/system/session-and-state-model.md`](../system/session-and-state-model.md)

## 参考

- 配置模型：[`backend/app/desktop_runtime/config.py`](../../backend/app/desktop_runtime/config.py)
- 服务器入口：[`backend/app/desktop_runtime/server.py`](../../backend/app/desktop_runtime/server.py)
- 配置测试：[`backend/tests/unit/desktop_runtime/test_config.py`](../../backend/tests/unit/desktop_runtime/test_config.py)
- 前端配置构造：[`frontend-copilot/electron/runtime/runtime-config.ts`](../../frontend-copilot/electron/runtime/runtime-config.ts)

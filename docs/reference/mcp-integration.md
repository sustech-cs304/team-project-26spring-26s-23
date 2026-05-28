---
title: MCP 集成说明
description: 说明 CanDue 如何通过 MCP（Model Context Protocol）接入外部工具服务器，以及从前端配置到后端执行的整体链路。
sidebar_position: 6
---

# MCP 集成说明

- 这页给谁看：需要理解 MCP 工具怎样在 CanDue 中工作、怎样配置 MCP 服务器、以及工具调用链路是怎样打通的使用者和开发者。
- 这页解决什么问题：把 MCP 从前端配置到后端执行的完整链路统一说明，避免各个页面碎片化地提到 MCP 但缺少整体视图。
- 当前覆盖到哪：覆盖当前 MCP 服务器管理（前端）、快照同步、工具编目和后端执行的主链路。MCP 服务端适配器（`tooling/mcp_adapter/`）是前瞻边界，不在此页展开。
- 当前状态：已可用。

## 先说结论

CanDue 通过 MCP（Model Context Protocol）接入外部工具服务器。整体链路是：

1. 用户在**「能力」工作区**中配置 MCP 服务器（支持 stdio 子进程和 HTTP/SSE 两种传输方式）。
2. Electron 主进程管理服务器连接生命周期，执行 `initialize` 握手和 `tools/list` 发现，生成工具快照。
3. Python 后端加载快照，将 MCP 工具合并到全局工具目录中，供智能体按需调用。
4. 智能体执行 MCP 工具时，请求通过宿主桥传到 Electron 主进程，再由对应的 MCP 连接器执行 `tools/call`，结果返回给模型。

## MCP 服务器配置

### 支持的传输方式

| 方式 | 适用场景 | 配置要点 |
| --- | --- | --- |
| **stdio** | 本地子进程（如 npx、uvx 启动的 MCP 服务） | 命令（command）、参数（args）、工作目录（cwd）、环境变量（env） |
| **HTTP/SSE** | 远程 HTTP 服务 | base URL、请求头（headers）、环境变量（env）、可选的 SSE 路径覆盖（ssePathOverride） |

### 配置入口

在**「能力」工作区 → 「MCP 服务器」**面板中，可以：

- 添加服务器（视觉表单或 JSON 导入）。
- 编辑服务器配置。
- 启用/禁用服务器。
- 测试连接。
- 删除服务器。
- 刷新工具目录。

支持导入标准 MCP 配置格式（兼容 Cline / VS Code 的 `mcpServers` 格式）。

### 连接生命周期

1. 用户保存服务器配置 → Electron 主进程持久化到 `<configDir>/mcp-registry/registry.json`。
2. 如果服务器已启用，主进程创建对应的 MCP 连接器。
3. 连接器执行 MCP `initialize` 握手（协议版本 `2024-11-05`），再执行 `tools/list` 发现工具列表。
4. 工具快照写入 `<stateDir>/mcp-capability-snapshot.json` 和 `capability-bridge-state.json`。
5. 快照变更后，主进程通过 IPC 通知前端刷新。

### 重连与超时

- 自动重连：最多 2 次尝试，50ms 指数退避。
- 连接超时：5 秒。
- 工具调用超时：20 秒（stdio）。

## MCP 工具快照

### 快照结构

Electron 主进程生成的快照包含：

```json
{
  "version": 1,
  "registryRevision": 3,
  "snapshotRevision": 5,
  "generatedAt": "2026-05-20T10:30:00.000Z",
  "servers": [
    {
      "serverId": "my-server",
      "displayName": "My Server",
      "transportKind": "stdio",
      "connectionState": "connected",
      "toolCount": 3
    }
  ],
  "tools": [
    {
      "toolId": "mcp.my-server.search.hash",
      "serverId": "my-server",
      "remoteToolName": "search",
      "displayName": "My Server / Search",
      "description": "...",
      "inputSchema": { "...": "..." },
      "availability": "available"
    }
  ],
  "groups": [
    {
      "groupId": "mcp.server.my-server",
      "displayName": "My Server",
      "sourceKind": "mcp-server",
      "toolIds": ["mcp.my-server.search.hash"]
    }
  ]
}
```

### 安全过滤

快照在写入前会扫描敏感字段。以下路径中的内容会被拒绝写入快照（`inputSchema` 内部除外）：

- `apiKey`、`token`、`password`、`secret`
- `headers`、`env`、`args`、`command`

如果发现敏感字段出现在快照顶层或工具描述中，整个快照会被丢弃。

### 版本与漂移检测

- `registryRevision`：服务器配置变更时递增。
- `snapshotRevision`：工具列表变更时递增。
- Python 后端在加载快照时如果发现 `snapshotRevision` 不匹配，会使用最新版本，避免持有过期工具引用。

## 后端工具编目与执行

### 工具编目

Python 后端的 `McpCatalogProvider` 读取快照，将每个 MCP 工具转换为全局工具目录中的条目：

| 字段 | 来源 |
| --- | --- |
| `toolId` | 快照中的 `toolId` |
| `kind` | `mcp` |
| `displayName` | 格式化为 `ServerName / Tool Name` |
| `group` | 按 `groupId` 分组，标签从快照组的 `displayName` 获取 |
| `inputSchema` | 从快照的 `inputSchema` 标准化得到 |
| `availability` | 从快照继承（`available` / `degraded` / `unavailable`） |

工具目录通过 `tools/catalog/get` 方法暴露，Python 后端会将 MCP 工具与内置工具合并去重后返回。

### 工具执行

当智能体选择执行 MCP 工具时：

1. Python 后端的 `McpExecutableToolLoader` 已将所有可用 MCP 工具注册为可执行工具。
2. 执行时调用 `execute_mcp_tool()`：
   - 解析最新执行目标（检查快照版本漂移）。
   - 通过宿主桥调用 Electron 主进程的 `callTool`。
   - Electron 主进程找到对应的连接器，执行 MCP `tools/call` JSON-RPC 请求。
   - 结果通过宿主桥返回给 Python 后端，标准化为 `ToolResultEnvelope`。
3. 模型收到工具结果后继续生成回复。

### 错误码映射

| MCP 原始错误 | 标准化错误码 |
| --- | --- |
| `invalid_input` | `invalid_input` |
| `authentication_required` | `authentication_required` |
| `permission_denied` | `permission_denied` |
| `not_found`、`tool_not_found` | `not_found` |
| `rate_limited` | `rate_limited` |
| `temporarily_unavailable`、`server_not_ready` | `temporarily_unavailable` |
| `timeout` | `timeout` |
| `cancelled` | `cancelled` |
| `execution_failed` | `execution_failed` |

## 工具权限

每个 MCP 工具都可以在**「能力」工作区 → 「工具权限」**面板中设置权限模式：

| 模式 | 行为 |
| --- | --- |
| `allow` | 允许自动执行 |
| `ask` | 执行前询问用户 |
| `deny` | 禁止执行 |

权限设置保存在 settings workspace 中，与工具快照版本关联。

## 当前边界

- MCP 工具属于**运行时工具**，通过 Electron 宿主桥间接执行，不走 Python 后端的直接工具执行路径。
- 快照中的工具 ID 是确定性的（`mcp.<serverId>.<toolName>.<hash>`），服务器 ID 或工具名变更会导致工具 ID 变化，引起已保存会话的漂移检测。
- `tooling/mcp_adapter/` 目录是目前的前瞻边界，用于评估内置工具契约未来能否通过 MCP 服务端方式暴露，当前不参与运行时执行。

## 相关页面

- [术语表](./glossary.md)
- [运行时接口 / 事件参考](./runtime-events.md)
- [能力边界 / 状态总表](./capabilities.md)
- [Provider 与模型路由说明](./providers-and-routing.md)

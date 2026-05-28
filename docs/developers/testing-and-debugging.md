---
title: 测试与调试
description: 汇总最常用的测试命令、smoke 入口和排查顺序，帮助开发者快速定位问题。
sidebar_position: 7
---

# 测试与调试

排查问题时，最有效的顺序是**先确认是哪一层出错，再跑对应层最小测试，最后再跑跨层 smoke 和文档构建**。

## 最常用命令速查

### 后端

```powershell
uv run --directory backend pytest
uv run --directory backend pyright app
uv run --directory backend python -m app.desktop_runtime
```

适用场景：

- 想先确认 Python 侧单元测试是否通过。
- 想确认类型检查是否仍然成立。
- 想单独观察 runtime 控制面和后端日志。

### 前端桌面应用

```powershell
cd frontend-copilot
npm run test
npm run typecheck
npm run lint
npm run dev
```

适用场景：

- `npm run test`：跑 Vitest 测试。
- `npm run typecheck`：确认 TypeScript 类型没有漂移。
- `npm run lint`：确认静态检查通过。
- `npm run dev`：直接观察 Electron 宿主和桌面工作台联动。

### 文档站点

```powershell
cd website
npm run typecheck
npm run build
npm run start
```

适用场景：

- `npm run typecheck`：确认 Docusaurus 配置和 TypeScript 没问题。
- `npm run build`：做文档构建回归。
- `npm run start`：本地预览文档站点。

## 最重要的 smoke 入口

聊天 smoke 以 `thread/run` smoke 为主：

```powershell
cd frontend-copilot
node .\scripts\smoke-thread-run-chat.mjs --provider-profile-id custom-provider-1
node .\scripts\smoke-thread-run-chat.mjs --provider-profile-id custom-provider-1 --enable-weather-tool
```

仓库没有单独的 streaming smoke 脚本；相关验证主要通过 `smoke-thread-run-chat.mjs` 完成，公共的 runtime 启动、路由解析预检和共享 harness 逻辑收口在 `smoke-runtime-shared.mjs`。

它们的区别是：

| 项目 | 主要验证什么 | 状态 |
| --- | --- | --- |
| `smoke-thread-run-chat.mjs` | 直接验证 `thread/run` 主链，也可附带天气工具闭环。 | 已可用 |
| `smoke-runtime-shared.mjs` | 供现有 smoke 脚本复用的共享逻辑，不是单独执行的 streaming smoke 入口。 | 已可用 |
| `--enable-weather-tool` | 顺带验证真实工具步骤闭环。 | 已可用 |

## 查聊天主链问题的排查顺序

### 第一步：判断问题在前端、宿主还是后端

- 页面启动就异常：先看 Electron 宿主和根装配。
- 进入聊天区前就没有模型：先看 settings workspace 和默认模型。
- 能发请求但流不回来：先看后端 run 编排和事件流。

### 第二步：跑最小测试而不是跑全量

- 聊天合同或消息流问题：先运行 `frontend-copilot/src/features/copilot/` 附近测试。
- settings workspace 问题：先运行 `frontend-copilot/electron/settings-workspace/` 和 `src/workbench/settings/` 附近测试。
- 后端协议或 run 问题：先运行 `backend/tests/unit/` 下对应目录。

### 第三步：用 smoke 确认跨层有没有断

当单层测试通过、但整条链仍有问题时，再回到 smoke。这样更容易分清是局部逻辑错了，还是跨层合同没对齐。

## 测试目录分布

| 目录 | 主要内容 |
| --- | --- |
| `backend/tests/unit/` | 后端单元测试。 |
| `backend/tests/integration/` | 后端集成测试。 |
| `backend/tests/e2e/` | 更长链路的端到端验证。 |
| `frontend-copilot/electron/` 下的 `*.test.ts` | 宿主、preload、runtime 生命周期等测试。 |
| `frontend-copilot/src/features/copilot/` 下的 `*.test.ts(x)` | 聊天主线、合同、消息流和 UI 组件测试。 |
| `frontend-copilot/src/workbench/` 下的 `*.test.ts(x)` | 工作台与设置相关测试。 |

## Chain debug 什么时候开

如果你怀疑问题出在 text → tool → text 交错链、工具阶段、终态收口或后端 collector 选择，打开调试环境变量：

```powershell
cd frontend-copilot
$env:COPILOT_RUNTIME_CHAIN_DEBUG='1'
node .\scripts\smoke-thread-run-chat.mjs --provider-profile-id custom-provider-1
```

这在你已经确认基本链路能跑、但细节事件顺序或工具行为不对时使用。

## 最常见的排查入口

| 现象 | 先看哪里 |
| --- | --- |
| 页面打不开或卡在启动阶段 | `frontend-copilot/electron/`、`frontend-copilot/src/CopilotAppRoot.tsx` |
| 模型列表为空 | `frontend-copilot/electron/settings-workspace/`、`src/workbench/settings/`、[Provider 与模型路由说明](../reference/providers-and-routing.md) |
| Thinking 行为不一致 | `src/workbench/thinking-capabilities.ts`、`backend/app/copilot_runtime/thinking_adapter.py`、[Thinking 能力说明](../reference/thinking.md) |
| run 已开始但文本不对 | `runtime-message-stream.ts`、`message_runs.py`、`run_events.py` |
| 工具步骤异常 | `tool_registry.py`、`execution_support.py`、`tool_event` 相关处理 |
| 文档改完侧边栏或链接不对 | `website/docusaurus.config.ts`、`website/sidebars.ts`、`npm run build` |

## 建议接着读什么

- 想回到主链入口，读[给开发者](./getting-started.md)。
- 想统一运行时事件口径，读[运行时接口 / 事件参考](../reference/runtime-events.md)。
- 想先理解系统边界，读[系统架构](./architecture.md)。

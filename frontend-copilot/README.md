# Frontend Copilot 快速上手

## 这是什么

[frontend-copilot](./) 是这个仓库里当前的桌面前端实验实现。它的目标不是先把所有业务做完，而是先把“桌面应用壳 + 多工作区界面 + Copilot 最小接入链路”搭起来，方便后续继续接真实聊天、真实配置和真实后端能力。

可以把它先理解成：

- 一个用 Electron 包起来的桌面前端
- 一个用 React 写的工作台界面
- 一个已经能读取本地 Copilot 配置、并据此决定是否初始化 Copilot 外层能力的前端骨架

## 先看结论

- 这是一个 **Electron + React + TypeScript + Vite** 的桌面前端，不是单纯的网页原型。
- 当前最明确、最能依赖的前端事实，是 **只存在两个真正生效的 Copilot 配置字段：`runtimeUrl` 和 `agentName`**。
- 应用启动时会先读取本地配置；只有这两个字段都齐了，前端才会把它们传给 Copilot 外层能力。
- 现在最完整的界面是工作区结构、助手切换、会话列表骨架和设置页外观；**真实聊天 UI 还没有接上**。
- 设置页里很多字段虽然能点、能改、能切换，但大多数还只是前端本地交互，**不能当成已经生效的配置能力**。

## 怎么安装

在仓库根目录执行：

```bash
cd frontend-copilot
npm install
```

## 怎么启动开发环境

在 `frontend-copilot` 目录执行：

```bash
npm run dev
```

这个项目使用 Electron 和 Vite 的集成开发方式。当前 `dev` 脚本会走 Vite 开发流程，并由现有插件配置带起桌面端开发链路。

## 怎么预览构建后的前端页面

在 `frontend-copilot` 目录执行：

```bash
npm run preview
```

这个命令更适合单独确认 renderer（也就是 React 界面层）的构建结果。

## 怎么构建桌面应用

在 `frontend-copilot` 目录执行：

```bash
npm run build
```

当前构建流程会顺序执行：

1. TypeScript 类型检查
2. Vite 构建 renderer
3. Electron 打包

## 怎么做代码检查

在 `frontend-copilot` 目录执行：

```bash
npm run lint
```

## 现在做到哪一步了

### 当前已经能确认的代码事实

- 已经有 Electron 桌面壳，可以作为桌面应用启动和打包的基础。
- 已经有稳定的前端启动链路：`src/main.tsx` → `src/CopilotAppRoot.tsx` → `src/App.tsx`。
- 已经有左侧工作区导航，当前工作区包括：`assistant`、`capabilities`、`files`、`developer`、`settings`。
- `assistant` 工作区已经有三段式骨架：助手类型列、话题列、右侧主内容区。
- 应用启动时会先读取本地 Copilot 配置；只有 `runtimeUrl` 和 `agentName` 都完整时，才会把这两个值传给 Copilot 外层能力。
- 这两个字段保存在 Electron `userData` 目录下的 `copilot-settings.json` 文件里。
- 前端已经能区分 `loading`、`empty`、`incomplete`、`ready`、`error` 这些运行态，并在聊天面板里给出不同提示。

### 当前只是前端交互、占位或骨架的部分

- 右侧聊天区现在还是“状态说明面板 + 占位文案”，不是完整聊天窗口。
- 会话列表、助手类型、能力中心、文件工作区、开发工作区，当前主要使用前端本地静态数据。
- 设置页里大部分内容——比如模型服务、默认模型、网络搜索、全局记忆、API 服务器——目前主要由 React 本地 state 驱动。
- 设置页虽然出现了“测试连接”“保存配置”等按钮，但当前代码并没有把这些设置正式接成可依赖的后端配置能力。
- 当前前端里虽然存在 Copilot 设置的底层读写封装，但**现有设置界面并没有提供 `runtimeUrl` 和 `agentName` 的正式编辑入口**。

## 不要误解的地方

- `ready` 的意思只是“前端最小配置条件齐了”，**不是**“真实聊天能力已经做完了”。
- 设置页里看到的字段很多，**不等于**这些字段已经被保存、已经接到后端、或者已经形成接口规范。
- 当前文档只会写代码里能确认的事实，不会补写还不存在的 HTTP 路径、请求体、响应体或认证流程。

## 如果你刚接手前端，推荐这样继续看

### 先顺着读

1. [../docs/frontend/README.md](../docs/frontend/README.md)：前端文档总入口，先建立阅读地图。
2. [../docs/frontend/ui-current-state.md](../docs/frontend/ui-current-state.md)：看懂界面现在到底长什么样、哪些区域能交互。
3. [../docs/frontend/backend-connection-contract.md](../docs/frontend/backend-connection-contract.md)：看懂前端现在到底怎样连接后端。
4. [../docs/frontend/roadmap-and-placeholders.md](../docs/frontend/roadmap-and-placeholders.md)：看懂哪些已实现，哪些还是占位，下一步通常先补哪一块。

### 需要查表时再看

- [../docs/frontend/reference-current-fields.md](../docs/frontend/reference-current-fields.md)：查当前真正生效的字段。
- [../docs/frontend/reference-runtime-states.md](../docs/frontend/reference-runtime-states.md)：查 `loading` / `empty` / `incomplete` / `ready` / `error` 的含义。
- [../docs/frontend/reference-page-capabilities.md](../docs/frontend/reference-page-capabilities.md)：查各工作区当前的数据来源、交互程度和接通情况。
- [../docs/frontend/future-backend-api-draft.md](../docs/frontend/future-backend-api-draft.md)：看未来可能需要讨论的后端接口主题，但这份是草案，不是当前实现。

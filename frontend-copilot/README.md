# Frontend Copilot 前端说明

## 项目定位

[frontend-copilot](./) 是本项目当前的桌面前端实验实现，目标是提供一个以智能体协作体验为核心的桌面界面。当前实现由 Electron 桌面壳层与 React 渲染层组成，已经具备：

- 桌面应用启动与打包基础能力
- 多工作区 UI 骨架
- Copilot 连接配置的读取与保存底层链路
- 基于配置状态的 Copilot Provider 条件包裹逻辑

同时需要明确：当前前端仍处于“基础框架已搭建、真实业务能力逐步接入”的阶段。部分界面已经可以交互，但许多设置项和工作区内容仍以占位实现为主，不应视为已经完成的产品能力。

## 技术栈

当前前端代码基于以下技术栈构建：

- 渲染层：React、React DOM、TypeScript、Vite
- 桌面壳层：Electron
- Electron / Vite 集成：通过 Vite 插件接入主进程与 preload
- Copilot 接入：CopilotKit（当前实际使用 `@copilotkit/react-core`）
- 图标库：`lucide-react`

## 目录结构

```text
frontend-copilot/
├─ electron/                  # Electron 主进程与 preload 代码
├─ public/                    # 静态资源
├─ src/                       # Renderer 代码
│  ├─ features/copilot/       # Copilot 相关功能与设置封装
│  ├─ App.tsx                 # 主界面
│  ├─ CopilotAppRoot.tsx      # 启动配置读取与 Provider 条件包裹
│  └─ main.tsx                # Renderer 入口
├─ electron-builder.json5     # Electron 打包配置
├─ package.json               # 脚本与依赖声明
└─ README.md                  # 当前文档
```

其中，Renderer 的入口链路为：

`src/main.tsx` → `src/CopilotAppRoot.tsx` → `src/App.tsx`

Copilot 相关实现集中在 `src/features/copilot/` 目录下。

## 安装依赖

在仓库根目录下执行：

```bash
cd frontend-copilot
npm install
```

## 启动开发环境

### 联合开发模式

执行：

```bash
npm run dev
```

该命令会启动 Electron 与 renderer 的联合开发流程，用于本地桌面前端调试。

### 预览构建产物

执行：

```bash
npm run preview
```

该命令用于预览 Vite 构建产物，适合单独验证 renderer 构建结果。

## 代码检查与构建

### Lint

执行：

```bash
npm run lint
```

该命令运行 ESLint 检查当前前端代码。

### 构建与打包

执行：

```bash
npm run build
```

当前构建流程包含：

1. 类型检查
2. Vite 构建 renderer
3. Electron 打包

Electron 打包相关配置位于 `electron-builder.json5`。

## 当前配置方式

### 已生效的配置链路

当前真正接入 Electron 持久化并对 Copilot 启动链路生效的字段只有两个：

- `runtimeUrl`
- `agentName`

这些配置会保存在 Electron `userData` 目录下的 `copilot-settings.json` 文件中。

Electron preload 会向 renderer 暴露以下桥接方法：

- `window.copilotSettings.load()`
- `window.copilotSettings.save()`

Renderer 侧通过 `src/features/copilot/settings.ts` 调用上述桥接 API。

### 配置读取与生效时机

应用启动时，`src/CopilotAppRoot.tsx` 会先读取 Copilot 配置，并根据配置状态决定是否包裹 CopilotKit Provider。

只有当配置状态为 `ready` 时，前端才会把已保存的连接信息传入 CopilotKit。当前真正参与连接的字段仍只有：

- `runtimeUrl`
- `agentName`

### 状态语义

当前配置状态语义包括：

- `empty`：尚未配置
- `incomplete`：配置未完成
- `ready`：配置完整，可用于包裹 Copilot Provider
- `error`：配置读取链路发生异常

此外，聊天区域在启动期还会出现 `loading` 状态，用于表示配置加载过程中。

需要特别区分：

- `empty` / `incomplete` 表示“未完成连接配置”
- `error` 表示“读取配置发生异常”，并不等同于未配置

## 当前实现边界

### 已实现部分

当前可以确认已经实现的内容包括：

- Electron 桌面壳层
- Copilot Provider 条件包裹逻辑
- Copilot 设置的底层读取 / 保存链路
- 工作区级别的 UI 架构
- 设置页基础交互

### 尚未完成或仍为占位的部分

当前仍应视为占位、演示或计划中的内容包括：

- 真实聊天 UI
- 设置页大部分字段与 Electron 持久化的正式接通
- 后端健康检查
- capabilities / files / developer 工作区的真实数据能力
- “API 服务器”“模型服务商”等多数设置项的真实业务契约

尤其需要注意：虽然设置页中已经存在多个开关、下拉、输入框和服务商列表，但其中大多数仍然只是前端本地 React state 交互，并未构成已经生效的后端连接契约。

## 与后端连接的当前事实

当前前端对后端的“已生效依赖”非常有限，仅能确认以下最低要求：

- 需要一个可被 `runtimeUrl` 指向的可访问运行时端点
- 需要一个可与 `agentName` 对应的智能体名称

在配置状态为 `ready` 时，这两个值会传给 CopilotKit 相关运行时配置。

除此之外，文档不应把任何 HTTP 接口细节、请求 / 响应结构、认证流程写成既成事实，因为这些内容并未在当前前端代码中形成已生效契约。

## 文档索引

更细分的前端文档位于 [../docs/frontend/README.md](../docs/frontend/README.md)：

- [../docs/frontend/ui-current-state.md](../docs/frontend/ui-current-state.md)：当前界面结构、工作区布局与设置页现状
- [../docs/frontend/roadmap-and-placeholders.md](../docs/frontend/roadmap-and-placeholders.md)：当前已实现能力、占位部分与后续计划边界
- [../docs/frontend/backend-connection-contract.md](../docs/frontend/backend-connection-contract.md)：当前后端连接契约、配置状态语义与对接边界

## 适用阅读顺序

建议按以下顺序阅读：

1. 先阅读当前文档，了解项目定位、启动方式与实现边界
2. 再阅读前端文档索引页，快速定位专题文档
3. 需要了解界面现状时，阅读 UI 现状说明
4. 需要讨论后端对接时，优先阅读后端连接契约说明
5. 需要规划下一步开发时，参考路线图与占位说明

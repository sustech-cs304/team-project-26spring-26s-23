# 前端文档

## 文档定位

本目录用于集中说明当前桌面前端的实现现状、配置与启动方式、与后端连接的最低契约，以及后续迭代边界。

这些文档的目标不是描述理想设计，而是基于当前代码事实，帮助开发者快速区分：

- 哪些能力已经实现并可作为当前事实依赖
- 哪些界面和设置仍属于占位实现
- 后端对接时，当前前端真正会消费哪些字段
- 后续开发应优先补齐哪些链路

## 阅读建议

建议按照以下顺序阅读：

1. `frontend-copilot/README.md`：了解项目定位、技术栈、安装、启动、构建与总体边界
2. `ui-current-state.md`：了解当前界面布局、工作区结构与设置页交互现状
3. `backend-connection-contract.md`：了解当前已生效的后端连接字段、状态语义与对接边界
4. `roadmap-and-placeholders.md`：了解哪些部分已经落地，哪些仍是占位或下一阶段计划

## 文档索引

### 1. 当前界面与交互现状

- [ui-current-state.md](./ui-current-state.md)

重点说明：

- 左侧工作区切换结构
- assistant 工作区的三段布局
- settings 工作区的独立布局
- capabilities / files / developer 的占位状态
- 设置页中哪些交互只是本地状态，哪些已经接入 Electron 持久化

### 2. 路线图与占位边界

- [roadmap-and-placeholders.md](./roadmap-and-placeholders.md)

重点说明：

- 当前已实现的前端基础能力
- 仍处于占位或演示状态的模块
- 后续开发应优先接入的真实功能
- 文档中如何区分“已实现事实”与“计划中事项”

### 3. 后端连接契约

- [backend-connection-contract.md](./backend-connection-contract.md)

重点说明：

- 当前真正生效的连接字段只有 `runtimeUrl` 与 `agentName`
- 配置状态 `empty` / `incomplete` / `ready` / `error` 以及启动期 `loading` 的语义
- “未连接”与“读取异常”的区别
- 前端当前对后端运行时的最低预期
- 设置页其他字段为何不能视为已生效契约

## 使用原则

阅读和维护本目录文档时，应遵循以下原则：

1. 只描述当前代码已经体现的事实
2. 对占位功能明确标注“占位”或“计划中”
3. 不把设置页展示字段写成已完成的接口契约
4. 不虚构后端 HTTP API、请求 / 响应 schema 或认证流程
5. 在讨论前后端联调时，优先以当前实际生效的字段和状态机为准

## 与总体说明的关系

如果需要项目级总体引导，请先阅读 [../../frontend-copilot/README.md](../../frontend-copilot/README.md)。该文档负责概述：

- 前端项目定位
- 技术栈与目录结构
- 安装、启动、构建与打包方式
- 当前配置链路
- 当前实现边界

本目录则进一步展开专题说明，便于分别讨论 UI 现状、后端连接边界与后续计划。

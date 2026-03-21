# 前端文档首页

## 这篇文档适合谁看

这篇文档主要给两类人看：

- 刚加入项目、需要先找到正确阅读入口的人
- 已经开始改前端代码，但需要快速分清“先读说明”还是“直接查表”的人

如果你还没有看过总入口，建议先读 [frontend-copilot/README.md](../../frontend-copilot/README.md)。那一篇负责回答“这是什么、怎么安装、怎么启动、怎么构建、现在做到哪一步”。

## 这篇文档回答什么问题

这篇文档主要回答下面几个问题：

- 前端文档现在分成几层，各自负责什么
- 我应该先读哪篇，后读哪篇
- 哪些文档在讲“当前事实”，哪些文档在讲“占位和路线”，哪些文档适合当参考附录来查
- 当我想确认字段、运行态、页面能力或未来接口讨论时，应该去哪里看

## 先给结论

- 前端文档现在采用“三层结构”：先白话入口，再说明型专题，最后是结构化附录。
- 第一层只有一篇：[frontend-copilot/README.md](../../frontend-copilot/README.md)。它优先帮助新同学把项目跑起来，并快速知道当前做到了哪一步。
- 第二层放在 [docs/frontend](./) 目录里，负责解释界面现状、当前边界、占位部分和前后端连接现状。
- 第三层同样放在 [docs/frontend](./) 目录里，但以表格为主，适合开发时快速查字段、状态和工作区能力。
- 当前真正可以当“前端已生效事实”依赖的内容非常有限，尤其是后端连接部分，现阶段请优先以 [backend-connection-contract.md](./backend-connection-contract.md) 和结构化附录为准。

## 再展开说明

### 第一层：白话快速上手入口

- [frontend-copilot/README.md](../../frontend-copilot/README.md)

这一层只做一件事：让第一次接手前端的人，先在短时间内建立基本认识。

它重点回答：

- 这是什么
- 怎么安装和启动
- 怎么构建
- 现在到底做到哪一步
- 进一步该去哪里看

如果你此时最关心的是“先跑起来再说”，先读这一篇最省时间。

### 第二层：说明型专题文档

这一层负责“帮助人理解”，不是只给结论，还会解释背景、边界和容易误解的地方。

#### 1. 界面现状导览

- [ui-current-state.md](./ui-current-state.md)

适合在你想回答“现在界面到底长什么样、哪些区域是真的能交互、哪些只是前端骨架”时阅读。

#### 2. 已实现 / 占位 / 下一步说明

- [roadmap-and-placeholders.md](./roadmap-and-placeholders.md)

适合在你想回答“当前哪些能力已经落地、哪些还是占位、通常下一步先补哪里”时阅读。

#### 3. 前端现在怎样连接后端

- [backend-connection-contract.md](./backend-connection-contract.md)

适合在你想回答“前端现在到底怎样连后端、哪些字段真正生效、哪些状态表示没配好或读取失败”时阅读。

虽然文件名里还保留“contract”这个词，但这篇文档已经尽量改成白话写法，重点讲“现状和边界”，不是假装已经有完整接口规范。

### 第三层：结构化参考附录

这一层负责“帮助人查”，适合开发中断点式使用，而不是从头顺着读。

#### 1. 当前生效字段参考

- [reference-current-fields.md](./reference-current-fields.md)

用于确认现阶段真正生效的字段、它们存在哪里、什么时候被读取，以及是否真正接到了界面。

#### 2. 运行态参考

- [reference-runtime-states.md](./reference-runtime-states.md)

用于确认 `loading`、`empty`、`incomplete`、`ready`、`error` 分别在什么条件下出现、用户会看到什么、是否会初始化 Copilot 外层能力。

#### 3. 页面能力参考

- [reference-page-capabilities.md](./reference-page-capabilities.md)

用于确认 `assistant`、`settings`、`capabilities`、`files`、`developer` 五个工作区当前各自的数据来源、交互程度、是否持久化、是否接后端。

#### 4. 未来后端 API 讨论草案

- [future-backend-api-draft.md](./future-backend-api-draft.md)

这篇只用于设计讨论。它不是当前实现，也不是已经确认的接口规范，更不能拿来当联调依据。

## 推荐阅读顺序

### 如果你是第一次接手项目

1. [frontend-copilot/README.md](../../frontend-copilot/README.md)
2. [ui-current-state.md](./ui-current-state.md)
3. [backend-connection-contract.md](./backend-connection-contract.md)
4. [roadmap-and-placeholders.md](./roadmap-and-placeholders.md)

### 如果你已经开始写代码，只是想快速查事实

1. [reference-current-fields.md](./reference-current-fields.md)
2. [reference-runtime-states.md](./reference-runtime-states.md)
3. [reference-page-capabilities.md](./reference-page-capabilities.md)

### 如果你正在讨论后端联调或未来接口规划

1. 先看 [backend-connection-contract.md](./backend-connection-contract.md)，确认当前事实边界
2. 再看 [future-backend-api-draft.md](./future-backend-api-draft.md)，只把它当讨论草案使用

## 按问题找文档

| 你现在想回答的问题 | 优先阅读 |
| --- | --- |
| 这个前端是什么，怎么跑起来 | [frontend-copilot/README.md](../../frontend-copilot/README.md) |
| 当前界面是什么结构 | [ui-current-state.md](./ui-current-state.md) |
| 哪些能力已经落地，哪些只是占位 | [roadmap-and-placeholders.md](./roadmap-and-placeholders.md) |
| 前端现在怎样连接后端 | [backend-connection-contract.md](./backend-connection-contract.md) |
| 当前真正生效的字段有哪些 | [reference-current-fields.md](./reference-current-fields.md) |
| `ready` 和 `error` 到底有什么区别 | [reference-runtime-states.md](./reference-runtime-states.md) |
| 五个工作区各自做到什么程度 | [reference-page-capabilities.md](./reference-page-capabilities.md) |
| 未来可能需要哪些后端接口主题 | [future-backend-api-draft.md](./future-backend-api-draft.md) |

## 当前边界 / 不要误解的地方

- 这些文档优先写“当前代码事实”，不是写理想设计稿。
- 设置页里有很多字段和按钮，但其中大部分当前仍然只是前端交互，不等于已经持久化，也不等于已经接到后端。
- 当前后端连接相关内容不能随意补写 HTTP 路径、请求体、响应体或认证流程，因为这些细节并没有在当前前端代码里形成稳定事实。
- [future-backend-api-draft.md](./future-backend-api-draft.md) 必须始终当成“未来草案”，不能反向覆盖当前实现说明。

## 继续阅读

- 从项目入口继续：[frontend-copilot/README.md](../../frontend-copilot/README.md)
- 看界面现状：[ui-current-state.md](./ui-current-state.md)
- 看前后端连接现状：[backend-connection-contract.md](./backend-connection-contract.md)
- 直接查结构化附录：[reference-current-fields.md](./reference-current-fields.md)、[reference-runtime-states.md](./reference-runtime-states.md)、[reference-page-capabilities.md](./reference-page-capabilities.md)

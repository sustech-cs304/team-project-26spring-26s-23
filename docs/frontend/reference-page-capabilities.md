---
title: 页面能力参考
description: 用能力分层表说明前端工作区与设置分区的成熟度。
sidebar_position: 5
---

# 页面能力参考

速查表。不重复页面布局与字段 schema，只回答"这一页做到哪一步"。界面结构见[前端当前 UI 状态](./ui-current-state.md)，字段 owner 见[当前生效字段参考](./reference-current-fields.md)。

## 三种页面状态

frontend 页面按下面三种状态分类：

| 状态 | 含义 |
| --- | --- |
| 主路径页面 | 页面直接参与聊天、主题或连接链路。 |
| 正式持久化页面 | 页面有稳定入口，字段会保存，但下游消费范围仍然有限或不均衡。 |
| 半接通 / 占位页面 | 页面有入口或交互，但后端数据面、业务闭环或跨页面联动还不完整。 |

## 工作区总表

| 工作区 | 主要数据来源 | 状态 | 说明 |
| --- | --- | --- | --- |
| `assistant` | hosted runtime、后端智能体目录、会话能力面、窗口内会话状态 | 主路径页面 | 最完整的一条业务主线。 |
| `settings` | 公开配置中心 + settings workspace state + secrets | 主路径页面和正式持久化页面并存 | 设置工作区已稳定，不同分区成熟度差异很大。 |
| `capabilities` | MCP 服务器、技能面板、工具权限 | 部分接通 | 已具备 MCP 服务器管理（添加/编辑/删除/测试连接）、技能面板和工具权限管理。 |
| `files` | 本地文件系统 IPC | 部分接通 | 已具备完整文件树操作（CRUD、拖拽、上下文菜单、键盘导航）。 |
| `sustech` | Blackboard HTTP API、同步状态 | 部分接通 | 已接入 Blackboard 数据浏览器（课程/公告/作业/成绩/资源）和同步面板。 |
| `developer`（日历） | frappe-gantt、timeline.db | 部分接通 | 已具备看板视图、Gantt 图和 Timeline 视图。 |

## 助手工作区定位

`assistant` 是前端主路径，连成了下面这条链路：

1. 根装配层确认有可用 `runtimeUrl`。
2. 助手工作区拉取后端智能体目录。
3. 用户选择智能体并创建 `thread`。
4. 前端读取 `thread` 的能力面。
5. 聊天面板通过 `run/start` 发起本轮 run，显式发送模型路由、Thinking 和工具选择。
6. 前端通过 `run/stream` 消费事件流；需要时走 `run/cancel`。

`session/create`、`capabilities/get` 和 `message/send` 继续保留，只是兼容壳。

边界主要有两条：

- 会话列表首先服务窗口内的会话操作。
- 历史消息回放、服务端会话目录和跨刷新恢复还没有成为成熟产品能力。

## 设置工作区分区速查表

| 设置分区 | 主要 owner | 状态 | 边界 |
| --- | --- | --- | --- |
| `SUSTech 信息` | settings workspace state + secrets | 正式持久化页面 | 页面已成立，但下游业务接线仍然有限。 |
| `模型服务` | settings workspace state + secrets | 主路径页面 | provider profiles 已经会影响聊天模型目录。 |
| `默认模型` | settings workspace state | 主路径页面 | 默认模型路由已经会影响聊天草稿模型选择。 |
| `常规设置` | settings workspace state | 正式持久化页面 | 字段会保存，但大多首先是设置资产。 |
| `显示设置` | 公开配置中心 | 主路径页面 | 主题直接影响启动和工作台外观。 |
| `数据设置` | settings workspace state | 正式持久化页面 | 页面稳定，偏长期设置资产。 |
| `MCP 服务器` | settings workspace state | 正式持久化页面 | 页面已存在，真实数据面和运行时接线仍有限。 |
| `网络搜索` | settings workspace state | 正式持久化页面 | 页面稳定，尚未形成成熟搜索配置闭环。 |
| `全局记忆` | settings workspace state | 正式持久化页面 | 页面稳定，真实记忆能力仍然有限。 |
| `API 服务器` | 公开配置中心 + settings workspace state | 主路径页面 | 开发态 `runtimeUrl` 属于主路径，其余字段偏设置资产。 |
| `文档处理` | settings workspace state | 正式持久化页面 | 页面稳定，还不是成熟后端处理链路。 |
| `外部源` | settings workspace state | 半接通 / 占位页面 | WakeUP 链接可保存，可触发前端解析流程，但尚未形成成熟后端接入。 |

## 为什么 `模型服务` 和 `默认模型` 要单独提高优先级

这两页虽然属于设置工作区，但和聊天发送区的关系比其他分区更直接。

`模型服务` 负责维护 provider profiles 与模型清单。聊天面板把这些 provider profiles 展开成模型目录，它不是单纯的本地表单页。

`默认模型` 负责保存默认模型路由。聊天发送区优先读取 `primaryAssistantModel`，再结合 provider profiles 找到首选模型。这页也已进入聊天主路径。

边界：首次状态可以完全空白。没有 provider profiles 时，聊天区不会自动出现示例模型。

## 为什么 `API 服务器` 是混合页

`API 服务器` 同时包含两类内容：

- 公开配置中心里的开发态运行时覆盖地址。
- settings workspace 里的地址草稿、重连策略和轮询字段。

一部分直接影响连接判断，另一部分主要是长期设置项。整页不应视为"已全面接入 runtime 的配置页"。

## 为什么 `外部源` 在边界区

`外部源` 不是空白入口，用户可以输入 WakeUP 分享链接并触发解析弹窗。

但流程主要停留在前端半接通阶段：

- 分享链接保存到 settings workspace。
- 解析反馈主要由前端侧流程控制。
- 尚未形成成熟后端同步能力的稳定页面。

## 其余工作区定位

`capabilities`、`files`、`sustech` 和 `developer`（日历）四个工作区拥有统一的 Hub 页面结构，各自已在不同程度上接入了真实数据面。

写法：

- `sustech`：数据面已部分接通（Blackboard HTTP API + 浏览器/同步面板）。
- `capabilities`：已具备 MCP 管理、技能面板和工具权限等真实功能。
- `files`：已具备完整文件树操作。
- `developer`（日历）：已具备看板、Gantt 和 Timeline 视图。
- 各工作区的业务闭环和数据回流成熟度仍在持续演进中。

## 相关文档

- [前端当前 UI 状态](./ui-current-state.md)
- [当前生效字段参考](./reference-current-fields.md)
- [已实现、占位与下一步](./roadmap-and-placeholders.md)

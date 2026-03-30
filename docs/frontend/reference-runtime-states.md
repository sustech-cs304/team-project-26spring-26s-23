---
title: 前端运行时状态参考
description: 作为参考页，汇总 frontend 当前 bootstrap 状态、hosted runtime 状态与关键判定字段。
sidebar_position: 4
---

# 前端运行时状态参考

这页属于 frontend 分册的参考层，专门用来查状态名和判定规则。连接主路径请看[前端现在怎样连接后端](./backend-connection-contract.md)，界面结构请看[前端当前 UI 状态](./ui-current-state.md)。

## 当前状态分成两层

当前前端运行时状态至少分成两层：

1. hosted runtime 状态由 Electron 主进程维护，描述宿主管理的本地后端现在是什么情况。
2. bootstrap 状态由 renderer 计算，描述前端工作台下一步应该怎样走。

这两层不要混写。hosted runtime 更接近运行事实，bootstrap 更接近前端入口判断。

## 第一层：hosted runtime 状态

hosted runtime 当前使用下面几个状态值：

- `stopped`
- `starting`
- `ready`
- `failed`
- `degraded`

这层状态主要回答的是：

- 宿主有没有成功拉起本地 runtime。
- 当前是否拿到了可用地址。
- 当前运行模式是什么。
- 最近一次失败摘要是什么。

### `failed` 和 `degraded` 的区别

- `failed` 表示宿主当前没有形成稳定可用的 hosted 地址。
- `degraded` 表示宿主出现异常，但当前仍然保留了一个可继续使用的地址。

## 第二层：bootstrap 状态

renderer 当前会把公开配置中心的 bootstrap 字段和 hosted runtime 快照合并，然后得到 bootstrap 状态。

当前状态值包括：

- `loading`
- `empty`
- `incomplete`
- `starting`
- `ready`
- `failed`
- `degraded`
- `error`

## 当前各状态的含义

| 状态 | 当前含义 |
| --- | --- |
| `loading` | 根装配层还在读取公开配置中心与 hosted runtime 快照。 |
| `empty` | 当前没有可用 `runtimeUrl`。 |
| `incomplete` | 当前缺少继续进入主路径所需的最小字段。现在实际仍然主要就是 `runtimeUrl`。 |
| `starting` | 宿主正在启动本地 runtime。 |
| `ready` | 前端已经拿到了可用地址，可以继续进入智能体目录与会话路径。 |
| `failed` | 宿主启动失败，而且当前也没有可用的开发态 override。 |
| `degraded` | 宿主处于降级状态，但仍然提供了可用地址。 |
| `error` | 读取公开快照或 runtime 快照的链路本身失败。 |

## 当前判断里最关键的字段

当前 bootstrap 判断真正依赖的最小字段，仍然是 `runtimeUrl`。

`agentName` 仍然会进入状态对象，但它现在主要用于偏好与诊断摘要，不再是前端进入聊天主路径的硬门槛。

## `runtimeUrl` 当前怎样选出来

前端当前按下面的顺序决定真正使用的连接地址：

1. 如果 hosted runtime 当前状态是 `ready`、`starting` 或 `degraded`，优先使用宿主管理的地址。
2. 如果 hosted runtime 当前状态是 `failed` 或 `stopped`，而且当前是开发模式、不是打包态，并且公开配置中心里已经配置了 `runtimeUrl`，就允许使用开发态 override。
3. 上面两条都不满足时，当前没有可用地址。

对应的 `runtimeSource` 当前有三种取值：

- `hosted`
- `dev-override`
- `none`

## 当前归并规则速查表

| hosted runtime 状态 | 是否存在可用地址 | 最终 bootstrap 状态 |
| --- | --- | --- |
| `ready` | 是 | `ready` |
| `ready` | 否 | `incomplete` |
| `starting` | 无论是否完整 | `starting` |
| `degraded` | 是 | `degraded` |
| `degraded` | 否 | `incomplete` |
| `failed` | 有开发态 override | `ready` |
| `failed` | 无开发态 override | `failed` |
| `stopped` | 有开发态 override | `ready` |
| `stopped` | 无开发态 override | `empty` |

## 这些状态在界面里怎样被消费

根装配层当前会根据这些状态决定是显示启动说明、错误说明，还是继续进入工作台。

助手工作区只有在 `ready` 或 `degraded` 这两个可连接分支里，才会继续拉智能体目录、创建会话和展示真正的聊天发送区。

## 当前需要记住的边界

- 前端现在已经不再要求先拿到全局 `agentName` 才能进入聊天路径。
- 配置中心更新已经能推送到 renderer，但 runtime 运行事实当前仍主要靠快照读取和重试后重算。
- `theme`、`animationsEnabled` 和公开 `model` 仍然是正式字段，但它们不直接决定聊天连接是否成立。

## 相关文档

- [前端现在怎样连接后端](./backend-connection-contract.md)
- [当前生效字段参考](./reference-current-fields.md)
- [会话与状态模型](../system/session-and-state-model.md)

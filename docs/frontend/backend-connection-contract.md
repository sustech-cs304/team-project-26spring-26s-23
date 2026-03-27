---
title: 前端现在怎样连接后端
description: 说明 renderer 当前如何通过统一配置中心公共快照与 hosted runtime 快照决定最小连接链路。
sidebar_position: 2
sidebar_label: 后端连接契约
---

# 前端现在怎样连接后端

## 这篇文档适合谁看

这篇文档适合：

- 准备做桌面前后端联调，但想先知道 renderer 现在到底依赖哪些事实来源的人
- 想确认“统一配置中心接入以后，连接链路到底改成什么样了”的人
- 接手 Electron + React 前端，想快速看懂当前最小连接主路径的人

如果你还想继续查表，可以配合阅读：

- [当前生效字段参考](./reference-current-fields.md)
- [前端运行时状态参考](./reference-runtime-states.md)
- [会话与状态模型](../system/session-and-state-model.md)

## 先给结论

当前 renderer 连接后端时，不再走“自己读取旧 settings 文件接口”的做法，而是同时消费两类信息：

1. **统一配置中心公共快照**
   - 当前真正用于 bootstrap 的字段是：
     - `assistantBehavior.agentName`
     - `hostConfig.runtimeUrl`
2. **hosted runtime 快照**
   - 由 Electron 主进程维护当前本地 Python runtime 的运行事实

然后 renderer 会把这两类信息合并，整理成最终的连接状态。

现在最重要的几条事实是：

- renderer 已经不再直接使用旧 `CopilotSettings` renderer API
- preload 暴露的是“配置中心公共接口 + runtime 接口”，而不是旧 settings 读写接口
- 宿主管理的 runtime URL 仍然优先于手工填写值
- `runtimeUrl` 现在主要表示**开发态 override**
- `agentName` 仍然是进入 `ready` / `degraded` 聊天入口的必需字段之一
- `model` 已经在统一配置中心里存在，但它当前属于主进程投影给 runtime 的字段，不属于 renderer 连接判断字段

## 当前连接信息从哪里来

### 1. 统一配置中心公共快照

renderer 当前通过 preload 调用配置中心公共快照接口，拿到一份裁剪后的配置视图。

当前公共快照里包含 4 个域：

- `frontendPreferences`
- `assistantBehavior`
- `hostConfig`
- `backendExposed`

但真正参与当前聊天连接判断的只有两个字段：

- `assistantBehavior.agentName`
- `hostConfig.runtimeUrl`

这两个字段会先被 renderer 归一化成 bootstrap fields，再与 runtime 快照一起参与状态计算。

### 2. Hosted runtime 快照

renderer 还会读取 Electron 主进程给出的 hosted runtime 快照。它当前至少会告诉 renderer：

- 宿主状态：`starting` / `ready` / `failed` / `stopped` / `degraded`
- 当前可用 runtime URL
- 当前预期模式和已解析模式
- 是否为打包态
- 最小失败摘要

这部分表示的是**宿主当前运行事实**，不是用户设置。

## 当前最小桥接面是什么

现在 preload 暴露给 renderer 的最小能力是：

- 读取配置中心公共快照
- 订阅配置中心公共快照更新
- 发送配置中心公共补丁
- 读取当前 hosted runtime 快照
- 触发一次受控的 runtime 重试

它不会把这些能力直接交给 renderer：

- Python 可执行文件路径
- spawn 参数
- local token 明文
- 任意文件系统访问
- 任意日志和诊断文件读写

所以 renderer 看到的是一个**已经裁剪过、适合 UI 消费的桥接面**。

## 应用启动时怎样决定连接状态

当前前端启动时，大致会按下面的顺序工作：

1. 根装配层读取配置中心公共快照
2. 根装配层读取 hosted runtime 快照
3. renderer 先从公共快照中整理 bootstrap fields
4. renderer 再判断宿主当前是否已经提供可用 runtime URL
5. 如果宿主没有提供，且当前处于开发态，再判断是否允许使用 `hostConfig.runtimeUrl` 作为 dev override
6. 最后再结合 `agentName` 是否存在，整理出最终连接状态
7. 只有在连接条件满足时，才会加载 CopilotKit Provider

这里最关键的变化是：

- **宿主管理链路优先**
- **开发态 override 只是补充**
- **renderer 的配置读取入口已经统一到配置中心公共快照**

## `runtimeUrl` 和 `agentName` 现在分别扮演什么角色

### `runtimeUrl`

`runtimeUrl` 现在有两种来源：

1. hosted backend 成功启动后，由宿主直接提供的地址
2. 开发态下配置中心中的 `hostConfig.runtimeUrl`

优先级是：

1. 宿主提供的 hosted runtime URL
2. 开发态 override
3. 无可用地址

所以现在不能再把 `runtimeUrl` 理解成“用户总是需要手填的正式后端地址”。

### `agentName`

`agentName` 当前来自统一配置中心中的 `assistantBehavior.agentName`。

这意味着：

- 宿主进入 `ready` 并不自动代表聊天入口一定可用
- 如果 `agentName` 缺失，renderer 仍会落到 `incomplete`
- 当前最小聊天接入仍然需要它

## 当前 UI 会怎样反映这些状态

当前聊天面板和根装配层已经把下面几类情况分开：

- `loading`：根层还在读取配置与运行态
- `empty`：既没有宿主地址，也没有 dev override，且 `agentName` 也缺失
- `incomplete`：只拿到了一部分连接信息
- `starting`：宿主正在启动本地后端
- `ready`：连接信息完整，可加载聊天入口
- `failed`：宿主启动失败，且没有可用 dev override
- `degraded`：宿主曾经就绪，但后来降级；当前仍保留可用 URL
- `error`：读取链路本身失败

这里尤其要注意：

- `failed` / `degraded` 主要是**宿主运行态问题**
- `empty` / `incomplete` 主要是**连接信息不足**
- `error` 主要是**读取链路本身出错**

这三类语义不应混写。

## 配置更新后，连接状态会不会跟着变

会，但当前方式仍然比较克制。

现在已经有一条明确链路：

1. 设置页通过配置中心公共补丁修改 `agentName` 或 `runtimeUrl`
2. 主进程写入配置中心分域文件
3. 主进程广播新的公共快照
4. 根装配层收到公共快照更新后，重新计算 bootstrap 状态

所以当前这两个字段已经不只是“启动时读一次”的静态输入了。

不过要注意：

- 这是**配置更新触发的重算**
- 不是 runtime 状态本身已经变成了持续推送流

也就是说，runtime 运行事实仍然是按需读取的快照式模型，只是配置中心现在已经有了公共订阅更新。

## 旧设置链路现在还剩什么

这里最容易混淆，必须分清两层：

### Renderer 侧

旧 renderer settings API 已经移除。

现在 renderer 不应再被描述成：

- “通过旧 `copilotSettings.load()` 读取设置”
- “直接保存旧 settings 文件”

### Main process 内部

主进程内部仍然保留从旧 `copilot-settings.json` 提取 `runtimeUrl` / `agentName` 的迁移语义。

这表示：

- 旧磁盘格式还有 **legacy disk migration** 价值
- 但它已经不是 renderer 正式接口
- 也不是未来长期配置外观

## 当前不要误写成已实现的事

下面这些写法当前都不准确：

- “renderer 仍然通过旧 settings API 连接后端”
- “preload 现在主要暴露 settings load/save 接口”
- “`runtimeUrl` 是发布态默认连接方式”
- “设置页里的 API 服务器表单都已经接到真实后端”
- “`model` 已经成为 renderer 连接后端时的正式必需字段”

其中最后一点尤其重要：

- `model` 确实已经纳入统一配置中心
- 但它当前属于主进程向 runtime 投影的样板字段
- 它现在**不是** renderer bootstrap 判断字段

## 当前边界

当前已经成立的事实：

- renderer 已经优先消费配置中心公共快照与 hosted runtime 快照
- preload 暴露面仍保持在受控最小范围
- 配置中心公共补丁已经能驱动部分连接字段更新
- `agentName` 与 `runtimeUrl` 已经有设置页正式入口
- CopilotKit 注入路径仍然沿用根装配层统一决策

当前还不是这篇文档要声称的事实：

- 设置页整个“API 服务器”分区都已接通真实运行闭环
- 后端可暴露字段样板已经做完整套产品化
- Python runtime 会直接读取配置中心分域文件
- renderer 可以直接访问底层日志或诊断文件

## 继续阅读

- [当前生效字段参考](./reference-current-fields.md)
- [前端当前 UI 状态说明](./ui-current-state.md)
- [前端运行时状态参考](./reference-runtime-states.md)
- [会话与状态模型](../system/session-and-state-model.md)
- [后端运行与配置](../backend/run-and-config.md)

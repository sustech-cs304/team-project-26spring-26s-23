---
title: 页面能力参考
description: 对比当前五个前端工作区的数据来源、持久化层、真实交互程度，以及设置页中哪些分区已经进入正式路径、哪些更适合作为结构承载来理解。
sidebar_position: 5
---

# 页面能力参考

这份附录适合在两种场景下使用：

- 新同学快速判断“这页今天做到哪一步了”。
- 评审文档时核对“这页主要承载的是主路径、持久化，还是结构布局”。

相比单纯看界面完整度，这种读法更容易帮助读者建立稳定判断。

## 先给结论

当前前端页面的成熟度，至少可以分成三层：

1. **系统主路径页面**：直接影响当前聊天、主题或连接行为。
2. **正式持久化页面**：页面已经稳定，字段也会被记住，但下游消费范围还在继续扩展。
3. **结构承载页面**：已有入口与布局，当前重点在信息架构和容器角色上。

其中最值得先补上的新认识是：

- **设置页已经至少有两层正式持久化。**
- **“会被记住”和“已经进入系统主路径”是两个不同维度。**

## 先把两层持久化看清楚

### 第一层：公开配置中心

这一层适合承载少量、公开、跨页面共享、需要明确进入系统主链路的字段。

它当前的特点是：

- 按域拆分成多份 JSON 文档
- 主进程负责默认值归一化与迁移
- renderer 通过公共快照、公共补丁和更新订阅读写
- 当前公开字段数量较少，但职责明确

当前公开字段主要集中在：

- `theme`
- `animationsEnabled`
- `agentName`
- `runtimeUrl`
- `model`

### 第二层：settings workspace 专用持久化

这一层是设置页当前形态的核心。

设置工作区已经有一套专用持久化，至少包括：

- `settings-workspace-state.json`
- `settings-workspace-secrets.json`

它承载的范围远大于公开配置中心，包括：

- `SUSTech 信息`
- 模型服务商列表与模型清单
- 默认模型路由
- 常规、数据、MCP、搜索、记忆、文档处理等页面的大量普通字段
- provider API key、CAS 密码等 secret 字段
- `外部源` 页中的 WakeUP 分享链接

从页面能力角度看，这层最重要的意义是：设置页中已经有一大批内容具备了“正式保存”的能力。

## 总表：五个工作区现在分别做到哪一步

| 工作区 | 当前主要数据来源 | 当前持久化情况 | 是否影响真实主链路 | 当前定位 |
| --- | --- | --- | --- | --- |
| `assistant` | 后端 `agents/list`、`session/create`、能力面接口，以及当前窗口内会话状态 | 连接相关字段部分依赖公开配置中心；会话列表本身仍是窗口内存态 | 是 | 已进入当前聊天主路径 |
| `settings` | 公开配置中心 + settings workspace state + settings workspace secrets | 是，且至少有两层持久化 | 部分：有些页面直接影响 UI/连接，有些当前更像工作区长期设置 | 已是正式工作区，但内部成熟度差异很大 |
| `capabilities` | 前端静态内容 | 否 | 否 | 结构承载页 |
| `files` | 前端静态内容 | 否 | 否 | 结构承载页 |
| `developer` | 前端静态内容 | 否 | 否 | 结构承载页 |

## `assistant` 为什么已经是正式主路径

当前助手工作区已经形成真实三栏主路径：

1. **左侧智能体目录**：以后端目录为真源。
2. **中间会话列**：负责创建会话、切换会话、排序会话、右键会话菜单。
3. **右侧聊天区**：负责真正的消息发送壳，包括模型选择器、工具选择器和底部输入区。

从页面能力角度看，它已经具备一条非常清晰的主路径：

- 后端目录
- 会话创建
- 能力面读取
- 消息发送

当前仍在继续扩展的部分主要是：

- 会话列表跨刷新恢复
- 更完整的会话历史体验
- 更成熟的消息展示能力

所以它的定位可以概括成一句话：

- **当前聊天主路径已经成立，产品细节还在继续丰富。**

## `settings` 为什么要分层理解

设置页现在同时容纳三类页面：

1. **公开配置中心主路径页**
2. **settings workspace 正式持久化页**
3. **仍以结构承载为主的设置页或子区域**

这样分层之后，读每个分区会更清楚。

### 第一类：公开配置中心主路径页

#### `display`

显示页当前最核心的入口是：

- 主题

它直接影响启动壳与工作台外观，因此属于公开配置主路径中的关键页面之一。

阅读这页时，可以把它理解成“当前聚焦主题外观的页面”。

#### `api`

API 页中最接近主路径的部分包括：

- 开发态 `runtimeUrl` 入口
- 根层启动摘要
- 根层 retry 动作

这些入口会直接影响当前连接判断与宿主后端启动体验。

### 第二类：settings workspace 正式持久化页

这类页面已经有稳定页面，也会把字段写入 settings workspace。

#### `sustech-info`

当前这一页已经承载：

- 学号
- 邮箱
- CAS 密码
- Blackboard 自动下载与大小限制

其中普通字段进入 settings workspace state，CAS 密码进入 settings workspace secrets。同页中的 `TIS 信息` 当前更适合作为预留扩展区来理解。

#### `model-service`

这是当前设置工作区里最成熟的一页之一。

它已经具备：

- 服务商列表
- 搜索
- 添加
- 右键菜单
- 复制服务商
- 删除服务商
- 拖动排序
- 无服务商空状态
- API 密钥回填、显示 / 隐藏、复制与替换
- 模型列表管理与模型编辑弹层

从页面能力角度看，这页已经同时覆盖了：

- 普通字段管理
- secret 字段管理
- 列表与详情联动

#### `default-model`

这一页当前承载的是：

- 主助手模型
- 快速执行模型

也就是 **default model routing**。它更适合作为前端工作区中的模型路由页来理解。

#### `external-source`

这一页已经有真实入口：

- WakeUP 分享链接
- 解析按钮
- 解析结果弹窗

当前更适合作为“已有工作区入口、后续继续扩展来源接入逻辑”的页面来看待。

### 第三类：更适合作为结构承载理解的设置页

这一类页面通常同时具备两个特点：

1. 页面已经存在，而且很多字段会被 settings workspace 记住。
2. 当前主要价值仍然在于稳定承载这类设置主题，并为后续下游消费预留空间。

当前更适合这样理解的页面包括：

- `general`
- `data`
- `mcp`
- `search`
- `memory`
- `docs`

它们已经进入正式设置工作区，但页面的主要价值更偏向“结构稳定、字段可记住、后续继续扩展消费逻辑”。

## 设置页逐页速查表

| 设置分区 | 当前主要存储层 | 是否已有正式入口 | 当前更适合怎样理解 |
| --- | --- | --- | --- |
| `sustech-info` | settings workspace state + secrets | 是 | 正式持久化页，内部仍保留扩展子区 |
| `model-service` | settings workspace state + secrets | 是 | 成熟度很高的正式持久化页 |
| `default-model` | settings workspace state | 是 | 默认模型路由页 |
| `general` | settings workspace state | 是 | 基础工作区设置页 |
| `display` | 公开配置中心 | 是 | 公开配置主路径页，当前聚焦主题 |
| `data` | settings workspace state | 是 | 稳定的结构承载页 |
| `mcp` | settings workspace state | 是 | 稳定的结构承载页 |
| `search` | settings workspace state | 是 | 稳定的结构承载页 |
| `memory` | settings workspace state | 是 | 稳定的结构承载页 |
| `api` | 公开配置中心 + settings workspace state | 是 | 混合页：一部分连接主路径，一部分工作区设置 |
| `docs` | settings workspace state | 是 | 稳定的结构承载页 |
| `external-source` | settings workspace state | 是 | 已有入口的外部来源页 |

## `capabilities`、`files`、`developer` 为什么更适合作为结构页来理解

这三页当前有几个共同点：

- 有入口
- 有布局
- 有静态条目和说明
- 当前重点仍在信息架构与容器角色上

因此它们的阅读重点更适合放在：

- 未来会承载什么主题
- 当前已经把布局和栏目关系组织成什么样

## 快速结论

### 当前已经属于正式主路径的页面 / 页面片段

- `assistant`
- `settings/display` 中的主题入口
- `settings/api` 中的开发态 `runtimeUrl`、启动摘要与 retry

### 当前已经正式持久化，并成为设置工作区稳定组成部分的页面

- `settings/sustech-info`
- `settings/model-service`
- `settings/default-model`
- `settings/general`
- `settings/data`
- `settings/mcp`
- `settings/search`
- `settings/memory`
- `settings/docs`
- `settings/external-source`

### 当前主要承担结构承载角色的页面

- `capabilities`
- `files`
- `developer`
- `settings` 内的若干扩展子区，例如 `TIS 信息` 与 WakeUP 解析后的后续业务承载区

## 相关文档

- [前端分册入口](./README.md)
- [当前生效字段参考](./reference-current-fields.md)
- [前端当前 UI 状态说明](./ui-current-state.md)
- [已实现、占位与下一步](./roadmap-and-placeholders.md)

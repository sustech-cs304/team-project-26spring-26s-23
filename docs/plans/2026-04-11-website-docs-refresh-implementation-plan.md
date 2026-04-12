---
title: 网站文档翻修实施计划
description: 基于已确认设计，将 Docusaurus 文档重构为双入口与共享事实层的分阶段执行计划。
---

# 2026-04-11 网站文档翻修实施计划

## 文档定位

本文将已确认的设计文档转换为可直接执行的实施计划，只覆盖文档重构顺序、页面去向、导航调整、事实核对、回归验证与风险控制，不包含任何正文实施结果。

本文默认后续实施对象是 Docusaurus 文档站点：站点配置位于 `website/docusaurus.config.ts`，文档源目录位于 `docs/`，计划目标是把现有文档从旧的 `system / frontend / backend` 技术分册主入口，重构为“给使用者”“给开发者”“共享事实层”三层信息架构。

## 实施目标与范围

### 实施目标

1. 重写 `docs/README.md`，把站点首页改造成双入口首页。
2. 新建 `docs/users/`、`docs/developers/`、`docs/reference/` 三个一级目录，并补齐必要的 `_category_.json` 元数据文件。
3. 先完成共享事实页收口，再围绕两类读者重写主路径页面，避免高变化事实在多页重复扩散。
4. 明确现有页面的保留、拆分、并入、降权和迁出策略，避免旧目录继续以主路径形式暴露。
5. 在不扩展新产品能力的前提下，让文档表述对齐当前项目实际进度，尤其是 provider、thinking、thread/run、配置模型与能力边界。
6. 为后续文档实施提供可顺序执行的阶段清单、迁移映射和验收检查点。

### 本轮实施范围

本轮实施计划覆盖以下内容：

- `docs/README.md` 的首页重写策略。
- 新的 `docs/users/`、`docs/developers/`、`docs/reference/` 页面集合。
- 现有 `docs/system/`、`docs/frontend/`、`docs/backend/` 内容向新结构的迁移映射。
- `docs/analysis/`、`docs/meetings/`、`docs/proposal-26s-23.md` 等历史材料的降权策略。
- 如有必要，对 `website/docusaurus.config.ts` 与 `website/sidebars.ts` 的最小调整建议。

### 明确不在本轮实施范围

- 不新增任何产品功能或运行时能力。
- 不把历史会议记录、计划稿、草案页改写为主路径教程。
- 不承诺保留旧 URL 兼容层。
- 不把未来草案类页面重新抬升为当前事实。
- 不要求一次性整理完所有历史材料，只要求它们不继续污染主路径。

## 执行总原则

1. **先收口事实，再重写路径。** 先完成共享事实页，再写使用者页和开发者页。
2. **先搭骨架，再填正文。** 先建立目录、首页、分类元数据和导航，再逐页填充内容。
3. **旧文档只作为素材，不作为结构。** 迁移时按新页面职责拆分，不按旧目录原样搬运。
4. **普通使用者路径只写动作和结果。** 内部实现术语下沉到 `docs/reference/` 或 `docs/developers/`。
5. **开发者路径按上手顺序组织。** 先本地运行，再架构，再聊天运行时，再配置状态，再前后端落点。
6. **共享事实只保留一份权威表达。** Provider、thinking、能力边界、运行时事件与术语不得在多页重复展开。
7. **降权材料不阻塞主路径落地。** 历史材料只要不继续占据主入口，就不应拖慢本轮改版。

## 目标目录骨架

建议后续实施以以下目录骨架为目标：

```text
docs/
├─ README.md
├─ users/
│  ├─ _category_.json
│  ├─ overview.md
│  ├─ quickstart.md
│  ├─ configure-models.md
│  ├─ chat-and-thinking.md
│  └─ limits.md
├─ developers/
│  ├─ _category_.json
│  ├─ getting-started.md
│  ├─ architecture.md
│  ├─ chat-runtime.md
│  ├─ config-and-state.md
│  ├─ frontend.md
│  ├─ backend.md
│  └─ testing-and-debugging.md
├─ reference/
│  ├─ _category_.json
│  ├─ glossary.md
│  ├─ providers-and-routing.md
│  ├─ thinking.md
│  ├─ capabilities.md
│  └─ runtime-events.md
└─ 其余历史材料目录
```

说明：

- `users`、`developers`、`reference` 是新的正式发布主路径。
- `plans` 继续由 `website/docusaurus.config.ts` 排除出站点构建。
- `analysis`、`meetings`、`proposal-26s-23.md` 以及被新页面吸收后的旧分册，应转入降权区域或从发布面排除。

## 分阶段任务拆解

## 阶段总览

| 阶段 | 名称 | 主要目标 | 主要输出 |
| --- | --- | --- | --- |
| 阶段 0 | 事实盘点与迁移分桶 | 锁定事实基线、页面职责和旧页去向 | 事实核对矩阵、迁移分桶表、实施顺序 |
| 阶段 1 | 信息架构骨架与首页重写 | 搭好双入口骨架与目录元数据 | 新首页、三大目录、分类元数据 |
| 阶段 2 | 共享事实层收口 | 先建立唯一事实源 | `reference` 五页 |
| 阶段 3 | 使用者路径重写 | 完成普通使用者 5 页闭环 | `users` 五页 |
| 阶段 4 | 开发者路径重写 | 完成开发者主阅读链路 | `developers` 六页主干加一页延伸 |
| 阶段 5 | 旧页面迁移收口与降权 | 去除旧技术分册主入口地位 | 链接修复、旧页并入或排除 |
| 阶段 6 | 验收与回归 | 验证导航、事实一致性与可构建性 | 构建通过、链接通过、路径通过 |

```mermaid
flowchart LR
  A[阶段0 事实盘点] --> B[阶段1 信息架构骨架]
  B --> C[阶段2 共享事实层]
  C --> D[阶段3 使用者路径]
  C --> E[阶段4 开发者路径]
  D --> F[阶段5 迁移收口]
  E --> F
  F --> G[阶段6 验收回归]
```

### 阶段 0：事实盘点与迁移分桶

#### 目标

在开始真正改写页面前，先把“什么是当前事实”“哪些页面必须拆分”“哪些页面必须降权”明确下来，避免边写边改方向。

#### 执行项

1. 以设计稿为最高信息架构依据，建立页面职责表。
2. 按“使用者 / 开发者 / 共享事实 / 历史材料”四类，对现有 `docs/` 页面做迁移分桶。
3. 为高变化主题建立事实核对矩阵，明确核对优先级是代码、测试、近期设计记录、旧文档。
4. 列出所有将被替换或下线的旧页面，提前识别潜在内部链接断点。

#### 完成标志

- 已得到一份明确的迁移映射表。
- 已锁定不得继续沿用的旧口径。
- 后续页面编写顺序已固定，不再需要临时决定页面职责。

### 阶段 1：信息架构骨架与首页重写

#### 目标

先把站点从旧技术分册入口切换到新骨架，即使正文尚未全部完善，也要先让入口方向正确。

#### 执行项

1. 重写 `docs/README.md`，把首页改成双入口首页。
2. 新建 `docs/users/`、`docs/developers/`、`docs/reference/` 目录。
3. 为三个目录创建 `_category_.json`，明确标签、排序和是否默认展开。
4. 先写清每个目录的边界和推荐阅读顺序，再填具体正文。
5. 如实施时确认有必要，最小调整站点导航配置，使首页、导航栏与侧边栏都优先暴露双入口。

#### 完成标志

- 首页已经不再以 `system / frontend / backend` 为第一入口。
- 侧边栏根节点已经能看到 `users / developers / reference` 三大主类。
- 后续所有新页面都有稳定落点。

### 阶段 2：共享事实层收口

#### 目标

优先建立唯一事实源，先把最容易过时和跨页重复的内容收口，再开始写使用者页和开发者页。

#### 推荐编写顺序

1. `docs/reference/glossary.md`
2. `docs/reference/providers-and-routing.md`
3. `docs/reference/thinking.md`
4. `docs/reference/runtime-events.md`
5. `docs/reference/capabilities.md`

#### 执行项

1. 统一术语定义，明确 thread、run、provider profile、settings workspace 等关键名词。
2. 用一页说明 provider、模型目录、默认模型路由、请求级模型路由与宿主解析边界。
3. 用一页说明 thinking 能力的当前语义、展示方式和边界，不再沿用旧 intent / 档位叙事。
4. 用一页说明 runtime 事件集合、终态规则、兼容壳与主链关系。
5. 用一页统一列出已可用、部分接通、规划中的能力状态，不让边界信息散落在各分册。

#### 完成标志

- 用户页与开发者页在写作时已经可以只链接共享页，不再重复定义事实。
- Provider、thinking、能力边界和运行时事件都已经有单一事实页面可引用。

### 阶段 3：使用者路径重写

#### 目标

建立普通使用者 5 页闭环，让读者在不阅读架构细节的前提下完成“是什么、怎么开始、怎么配置、怎么用、有什么边界”的基础认知。

#### 推荐编写顺序

1. `docs/users/overview.md`
2. `docs/users/quickstart.md`
3. `docs/users/configure-models.md`
4. `docs/users/chat-and-thinking.md`
5. `docs/users/limits.md`

#### 执行项

1. `overview` 只讲产品定位、适用场景、当前状态和读者应从哪里开始。
2. `quickstart` 只讲首次进入、最短操作路径和预期看到的结果，不承诺当前并不存在的安装分发方式。
3. `configure-models` 只讲用户需要做的配置动作，复杂 provider 事实全部链接到共享页。
4. `chat-and-thinking` 只讲聊天主流程、thinking 的可见行为和常见使用动作，不写底层事件与协议细节。
5. `limits` 统一说明当前能力边界、已知限制和半接通主题。

#### 完成标志

- 普通使用者无需阅读开发者页即可完成基础上手。
- 使用者路径中不再出现成片的内部运行时术语。
- 配置和能力边界表达与共享事实页一致。

### 阶段 4：开发者路径重写

#### 目标

建立开发者主干路径，让读者按“先运行、再理解、再定位代码”的顺序读完主线。

#### 推荐编写顺序

1. `docs/developers/getting-started.md`
2. `docs/developers/architecture.md`
3. `docs/developers/chat-runtime.md`
4. `docs/developers/config-and-state.md`
5. `docs/developers/frontend.md`
6. `docs/developers/backend.md`
7. `docs/developers/testing-and-debugging.md`

#### 执行项

1. `getting-started` 说明本地运行方式、仓库目录总览和推荐阅读顺序。
2. `architecture` 说明宿主、前端、后端和共享配置边界，不重复铺开协议细表。
3. `chat-runtime` 说明 thread/run 主线、兼容壳、流式事件与归档规则。
4. `config-and-state` 说明公开配置、settings workspace、宿主运行态与页面 run 状态。
5. `frontend` 说明前端工作区、设置工作区和代码入口。
6. `backend` 说明 desktop runtime、copilot runtime 以及 Blackboard / TIS 的边界。
7. `testing-and-debugging` 作为延伸页，补充测试结构、smoke 脚本、调试入口和排错顺序。

#### 完成标志

- 开发者闭环主线由前六页完成。
- `testing-and-debugging` 作为延伸页，不抢占主线入口，但能作为后续深挖入口。
- 开发者路径已经不再依赖旧分册入口才能建立整体心智。

### 阶段 5：旧页面迁移收口与降权

#### 目标

把旧页面从主阅读路径上真正移走，防止新结构建成后，旧结构仍通过侧边栏、搜索或内部链接继续成为事实入口。

#### 执行项

1. 将旧 `system / frontend / backend` 页面的有效内容并入新页面。
2. 对已完成吸收的旧页面执行以下之一：删除、归档到降权区域、或从发布面排除。
3. 将 `analysis`、`meetings`、`proposal-26s-23.md` 和未来草案页降权处理，不再作为主路径推荐阅读。
4. 修复新页面之间的内部链接，并清理指向旧页面的链接。
5. 复查搜索结果和侧边栏，确认旧技术分册不会重新抢占主入口。

#### 完成标志

- 新站点主路径不再要求读者进入旧技术分册。
- 历史材料仍可保留，但不会继续出现在主阅读流中。
- 搜索结果和导航入口不再把旧口径排在新页面之前。

### 阶段 6：验收与回归

#### 目标

验证这次改版不仅目录变了，而且阅读路径、事实一致性和站点构建都真正成立。

#### 执行项

1. 执行 Docusaurus 构建检查，确保新目录、链接和元数据没有破坏站点。
2. 做双入口人工走查，确认普通使用者与开发者都能在少量页面内完成认知闭环。
3. 做共享事实一致性检查，确认高变化主题只在共享页有完整定义。
4. 做降权检查，确认旧目录和历史材料没有回到主导航和首页推荐位。
5. 做术语和状态口径复核，确认全站统一使用“已可用 / 部分接通 / 规划中”。

#### 完成标志

- 构建通过。
- 关键导航、链接和搜索路径通过人工回归。
- 高变化主题没有多版本并存。

## 拟新增 / 重写 / 保留 / 降权的页面清单

### 拟新增页面

| 路径 | 角色 | 页面职责 | 预计阶段 |
| --- | --- | --- | --- |
| `docs/users/_category_.json` | 分类元数据 | 定义使用者目录标签、排序与展开策略 | 阶段 1 |
| `docs/users/overview.md` | 新增 | 使用者入口页，回答产品是什么、适合谁、当前覆盖到哪 | 阶段 3 |
| `docs/users/quickstart.md` | 新增 | 5 分钟上手路径 | 阶段 3 |
| `docs/users/configure-models.md` | 新增 | 用户视角的模型与 provider 配置动作页 | 阶段 3 |
| `docs/users/chat-and-thinking.md` | 新增 | 聊天流程与 thinking 可见行为说明 | 阶段 3 |
| `docs/users/limits.md` | 新增 | 能力边界、限制与半接通主题说明 | 阶段 3 |
| `docs/developers/_category_.json` | 分类元数据 | 定义开发者目录标签、排序与展开策略 | 阶段 1 |
| `docs/developers/getting-started.md` | 新增 | 本地运行、目录导览与推荐阅读顺序 | 阶段 4 |
| `docs/developers/architecture.md` | 新增 | 宿主、前端、后端和共享状态的架构总览 | 阶段 4 |
| `docs/developers/chat-runtime.md` | 新增 | thread/run 主线、兼容壳、事件流与归档规则 | 阶段 4 |
| `docs/developers/config-and-state.md` | 新增 | 配置模型、状态分层与设置工作区边界 | 阶段 4 |
| `docs/developers/frontend.md` | 新增 | 前端工作区、设置区与读码入口 | 阶段 4 |
| `docs/developers/backend.md` | 新增 | 后端模块边界、运行时入口与领域能力边界 | 阶段 4 |
| `docs/developers/testing-and-debugging.md` | 新增 | 测试矩阵、smoke 入口与调试建议 | 阶段 4 |
| `docs/reference/_category_.json` | 分类元数据 | 定义共享事实层标签、排序与展开策略 | 阶段 1 |
| `docs/reference/glossary.md` | 新增 | 统一术语表 | 阶段 2 |
| `docs/reference/providers-and-routing.md` | 新增 | provider、模型目录、默认路由与请求路由说明 | 阶段 2 |
| `docs/reference/thinking.md` | 新增 | thinking 概念、状态与边界说明 | 阶段 2 |
| `docs/reference/capabilities.md` | 新增 | 能力边界总表 | 阶段 2 |
| `docs/reference/runtime-events.md` | 新增 | 运行时方法、事件和终态规则参考 | 阶段 2 |

### 拟重写页面

| 路径 | 重写方向 | 原因 |
| --- | --- | --- |
| `docs/README.md` | 改为双入口首页 | 当前首页仍以系统层权威源和技术分册为主心智 |

### 拟保留页面

| 路径 | 保留方式 | 说明 |
| --- | --- | --- |
| `docs/plans/**` | 保留为仓库计划材料 | 继续排除出站点发布面 |
| `docs/meetings/**` | 保留为历史记录 | 不进入主路径 |
| `docs/proposal-26s-23.md` | 保留为背景材料 | 不作为当前产品说明 |

### 拟降权页面与目录

| 路径 | 降权方式 | 说明 |
| --- | --- | --- |
| `docs/analysis/**` | 从主路径移除 | 仅保留研究背景价值 |
| `docs/frontend/future-backend-api-draft.md` | 降为草案 | 不得作为当前事实 |
| `docs/backend/reference-future-api-draft.md` | 降为草案 | 不得作为当前事实 |
| `docs/system/**` | 内容吸收后移出主入口 | 不再作为首层阅读路径 |
| `docs/frontend/**` | 内容吸收后移出主入口 | 不再作为首层阅读路径 |
| `docs/backend/**` | 内容吸收后移出主入口 | 不再作为首层阅读路径 |

说明：`system / frontend / backend` 三组目录不是简单原样保留，而是“完成迁移后降权或退出发布主路径”。

## 现有页面到新页面的迁移映射

| 现有页面 | 新页面去向 | 处理方式 |
| --- | --- | --- |
| `docs/README.md` | `docs/README.md` | 原位重写为双入口首页 |
| `docs/system/architecture-overview.md` | `docs/developers/architecture.md`、`docs/reference/capabilities.md` | 架构叙述进入开发者页，边界状态进入共享页 |
| `docs/system/runtime-lifecycle.md` | `docs/developers/getting-started.md`、`docs/developers/architecture.md` | 启动顺序并入运行与架构页 |
| `docs/system/chat-runtime-contract.md` | `docs/developers/chat-runtime.md`、`docs/reference/runtime-events.md` | 主链说明进入开发者页，方法和事件表进入共享页 |
| `docs/system/session-and-state-model.md` | `docs/developers/config-and-state.md`、`docs/reference/providers-and-routing.md` | 状态模型进入开发者页，配置与路由边界进入共享页 |
| `docs/frontend/README.md` | `docs/developers/frontend.md` | 入口页职责并入前端实现页 |
| `docs/frontend/backend-connection-contract.md` | `docs/developers/chat-runtime.md`、`docs/developers/frontend.md` | 连接路径按运行时和前端职责拆分 |
| `docs/frontend/ui-current-state.md` | `docs/users/overview.md`、`docs/users/chat-and-thinking.md`、`docs/developers/frontend.md` | 用户可见行为进入用户页，结构细节进入开发者页 |
| `docs/frontend/reference-current-fields.md` | `docs/developers/config-and-state.md`、`docs/reference/providers-and-routing.md` | 字段 owner 与配置分层重写到新结构 |
| `docs/frontend/reference-page-capabilities.md` | `docs/reference/capabilities.md`、`docs/users/limits.md` | 页面成熟度和边界统一并入能力边界页 |
| `docs/frontend/reference-runtime-states.md` | `docs/developers/config-and-state.md` | 运行态与页面状态并入配置和状态模型页 |
| `docs/frontend/roadmap-and-placeholders.md` | `docs/users/limits.md`、`docs/reference/capabilities.md` | 半接通信息进入边界页，不保留路线图语气 |
| `docs/frontend/future-backend-api-draft.md` | 无主路径去向 | 保留为降权草案 |
| `docs/backend/README.md` | `docs/developers/backend.md` | 入口页职责并入后端实现页 |
| `docs/backend/module-layout.md` | `docs/developers/backend.md`、`docs/developers/architecture.md` | 模块边界分别进入后端页和架构页 |
| `docs/backend/run-and-config.md` | `docs/developers/getting-started.md`、`docs/developers/config-and-state.md` | 本地运行与配置 owner 拆分吸收 |
| `docs/backend/frontend-connection.md` | `docs/developers/chat-runtime.md` | 前后端接入面统一并入聊天运行时页 |
| `docs/backend/reference-run-and-config.md` | `docs/developers/getting-started.md`、`docs/developers/testing-and-debugging.md` | 运行命令和调试入口分别并入新页 |
| `docs/backend/reference-current-contracts.md` | `docs/developers/chat-runtime.md`、`docs/reference/runtime-events.md` | 当前契约转入运行时页和参考页 |
| `docs/backend/roadmap-and-boundaries.md` | `docs/users/limits.md`、`docs/reference/capabilities.md` | 业务边界收口到用户边界页和共享能力页 |
| `docs/backend/reference-future-api-draft.md` | 无主路径去向 | 保留为降权草案 |
| `docs/analysis/**` | 无主路径去向 | 作为研究材料保留 |
| `docs/meetings/**` | 无主路径去向 | 作为历史记录保留 |
| `docs/proposal-26s-23.md` | 无主路径去向 | 作为背景材料保留 |

## 导航与目录调整策略

### 首页策略

1. `docs/README.md` 保持站点根路径入口职责。
2. 首页首屏直接给出“给使用者”和“给开发者”两个入口。
3. `reference` 作为共享事实层入口出现，但不应抢占首屏主按钮位。
4. 首页正文不再用“系统层权威源 + 分册边界”组织叙事。

### 侧边栏策略

优先采用最小改动方案：

1. 保持 `website/sidebars.ts` 的自动生成思路不变。
2. 通过新增 `users / developers / reference` 目录及 `_category_.json` 控制排序与展示。
3. 将旧 `system / frontend / backend / analysis / meetings` 从主发布面移出，避免它们继续占据自动生成侧边栏。

如果实施时发现仅靠目录和元数据无法稳定达到目标顺序，再追加最小配置调整：

- 在 `website/sidebars.ts` 中改为显式定义首页、`users`、`developers`、`reference` 的主顺序。

### 顶层导航策略

当前 `website/docusaurus.config.ts` 的导航栏仍只有一个泛化的“文档”入口。后续实施建议最小调整为：

1. 顶栏直接出现“给使用者”。
2. 顶栏直接出现“给开发者”。
3. 顶栏保留“共享事实”或“参考”。
4. 搜索与 GitHub 继续保留。

### 发布面排除策略

如果旧目录和历史材料继续留在 `docs/` 中，建议在站点发布层做最小排除，避免它们重新进入主路径。优先级如下：

1. 继续排除 `plans/**`。
2. 视迁移结果排除 `analysis/**`、`meetings/**`。
3. 在旧分册内容完全并入新结构后，排除 `system/**`、`frontend/**`、`backend/**`。

说明：这一步属于 `website/` 侧最小调整建议，只列入计划，不在本文件中实施。

## 事实核对重点

后续写作时，应针对以下主题建立逐页核对清单。

| 主题 | 必须核对的当前事实 | 不得继续沿用的旧口径 | 优先核对面 |
| --- | --- | --- | --- |
| Provider 与模型路由 | provider catalog、多 provider profile、默认模型路由、请求级模型路由、宿主解析边界 | active provider 是唯一真相；示例 provider 预置为默认状态 | 代码、测试、近期 provider 设计与实现记录 |
| thinking | thinking 已存在且应说明可见行为、状态和边界 | 旧 intent / 档位体系仍是当前主语义 | 代码、测试、近期 thinking 设计记录 |
| 聊天主链 | 当前主线是 thread/run，兼容壳仍存在但不是主路径 | `session/create` / `message/send` 是正式主链 | 代码、测试、近期运行时设计记录 |
| 配置模型 | 公开配置中心与 settings workspace 是双层模型，敏感值不进入公开快照 | 单一配置中心覆盖全部设置；Python 直接读取配置中心 | 代码、测试、近期配置设计记录 |
| 能力边界 | Blackboard / TIS 已有真实能力，但尚未整体产品化 | 已形成成熟、完整、对前端开放的业务 Web API | 代码、测试、边界页与近期设计记录 |
| 运行时事件 | 事件集合已围绕 run 语义稳定 | 旧整包响应模型仍是主路径 | 代码、测试、运行时契约记录 |
| 首次状态 | 默认可为空白配置，不保证预置 provider 或默认模型 | 应用首次进入必带完整模型配置 | 代码、测试、当前设置与聊天实现 |

### 建议的核对顺序

1. 先核对 `reference` 页所需事实。
2. 再核对会被用户页引用的动作型事实。
3. 最后核对开发者页中的实现细节和代码入口。

### 逐页写作时必须重点检查的事实点

1. **provider**：页面必须区分 provider profile、默认模型路由、请求级模型路由和宿主解析。
2. **thinking**：页面必须写清用户可见行为与边界，不得回退到旧档位叙事。
3. **thread/run**：页面必须明确 thread/create、thread/get、run/start、run/stream、run/cancel 与兼容壳的关系。
4. **配置模型**：页面必须明确公开配置、settings workspace、secret 与运行态快照的 owner 差异。
5. **能力边界**：页面必须区分“已有能力”“部分接通”“规划中”，尤其是 Blackboard、TIS、外部源、会话恢复等主题。

## 验收步骤与回归检查点

### 阶段性验收

| 阶段 | 必做验收 | 通过标准 |
| --- | --- | --- |
| 阶段 1 | 首页与目录走查 | 首页已双入口，侧边栏已出现三大主类 |
| 阶段 2 | 共享事实一致性检查 | 高变化主题已有唯一事实页 |
| 阶段 3 | 使用者路径走查 | 5 页内完成基础认知闭环，无需阅读开发者页 |
| 阶段 4 | 开发者路径走查 | 前六页完成主干理解，第七页作为延伸入口 |
| 阶段 5 | 旧页回流检查 | 旧技术分册和历史材料不再占主入口 |
| 阶段 6 | 构建、链接、搜索回归 | 站点可构建，无坏链，新搜索结果优先新页 |

### 最终验收步骤

1. 打开首页，验证是否能一眼看到“给使用者”和“给开发者”。
2. 从使用者入口走读 `overview -> quickstart -> configure-models -> chat-and-thinking -> limits`，确认无需进入开发者页即可完成理解。
3. 从开发者入口走读 `getting-started -> architecture -> chat-runtime -> config-and-state -> frontend -> backend`，确认主线完整。
4. 检查 `reference` 五页，确认 provider、thinking、能力边界、事件和术语已收口为唯一事实源。
5. 检查站点侧边栏与导航栏，确认旧 `system / frontend / backend` 不再是首层入口。
6. 检查站内搜索，确认搜索 provider、thinking、thread、run 等关键词时，新页面排在旧材料之前。
7. 执行站点构建验证，确认 Docusaurus 没有 broken links、分类元数据错误或未解析链接。

### 回归检查点

- 首页是否仍然残留“先看 system、再看 frontend、再看 backend”的旧阅读顺序。
- 使用者页是否意外展开了 runtime event、状态机和内部 owner 细节。
- 开发者页是否重复复制了 reference 页中的事实正文。
- 共享事实页是否出现了和用户页、开发者页冲突的状态描述。
- 搜索和导航是否仍能把历史材料暴露成默认入口。
- 旧页面删除或降权后，是否存在新的死链。

## 风险与缓解措施

| 风险 | 具体表现 | 缓解措施 |
| --- | --- | --- |
| 双入口已建但旧分册仍然抢入口 | 首页改了，但侧边栏和导航仍把旧分册放在前面 | 先做阶段 1 骨架，再做正文；必要时最小调整 `website/sidebars.ts` |
| 共享事实层没有真正收口 | Provider、thinking、能力边界继续在多页重复复制 | 强制阶段 2 先完成，主路径页只允许链接引用 |
| 使用者页被内部术语污染 | 普通使用者页出现 session、SSE、owner 等大量术语 | 规定用户页只写动作与结果，复杂概念统一下沉到 `reference` |
| 开发者页仍沿用旧模块目录叙事 | 只是把旧分册换目录名，没有改变阅读顺序 | 开发者页按上手顺序写，禁止直接搬运旧 README 结构 |
| 事实核对不彻底 | 新页面只是把旧口径重新包装 | 先做事实核对矩阵，按代码、测试、近期设计、旧文档优先级复核 |
| 历史材料回流搜索结果 | 旧草案和旧分册仍占搜索前列 | 迁移完成后从发布面排除或归档旧材料 |
| URL 和链接收口不完整 | 删除旧页面后出现 broken links | 阶段 5 统一清理内部链接，阶段 6 做构建和搜索回归 |
| 状态口径继续混乱 | 页面混用实验性、基本可用、部分支持等词 | 全站统一只用“已可用 / 部分接通 / 规划中” |
| 使用者 quickstart 误写成不存在的安装流程 | 文档承诺了当前并未稳定提供的分发方式 | quickstart 只写已证实的进入路径和首次使用动作，不编造安装形态 |

## 最小 website 侧调整建议

以下内容如实施时确认必要，可作为最小站点配套调整列入执行，但不应扩大为网站重做：

1. 在 `website/docusaurus.config.ts` 中把顶栏从单一“文档”入口调整为双入口加共享事实入口。
2. 根据迁移结果，调整 `docs.exclude` 规则，避免旧目录与历史材料进入发布面。
3. 若自动生成侧边栏无法稳定满足排序要求，再最小调整 `website/sidebars.ts` 为显式主顺序。
4. 如首页卡片或顶部说明需要微调视觉文案，应只服务双入口导流，不扩展成新的视觉改版任务。

## 关键迁移结论

1. `docs/README.md` 必须原位重写为双入口首页，这是整次改版的第一落点。
2. `docs/reference/` 必须先于 `docs/users/` 和 `docs/developers/` 落地，否则 provider、thinking、运行时事件和能力边界会再次多处复制。
3. 旧 `docs/system/`、`docs/frontend/`、`docs/backend/` 不是继续保留为主入口，而是完成内容吸收后降权或退出发布主路径。
4. 使用者主路径固定为 5 页，开发者主路径固定为 6 页闭环加 1 页延伸，避免再次长回技术分册树。
5. 如需最小站点配套改动，优先改导航与发布面排除，不优先投入复杂网站结构改造。

## 实施顺序摘要

后续在代码模式中，建议严格按以下顺序推进：

1. 阶段 0：完成事实盘点、迁移分桶和旧口径禁用清单。
2. 阶段 1：先重写首页，建立 `users / developers / reference` 与 `_category_.json`。
3. 阶段 2：写完 `reference` 五页，建立共享事实层。
4. 阶段 3：完成 `users` 五页。
5. 阶段 4：完成 `developers` 主干六页和调试延伸页。
6. 阶段 5：清理旧页面入口、修复链接并降权历史材料。
7. 阶段 6：做站点构建、搜索、导航和事实一致性回归。

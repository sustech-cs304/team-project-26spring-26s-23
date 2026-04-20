# 后端 Pydantic 化改造实施计划（P0-P2）

> 依据：`docs/plans/2026-04-19-backend-pydantic-design.md`
>
> 说明：本文档仅做实施计划，不修改已批准设计，也不包含任何后端源码实现内容。除引用已批准设计中的范围、顺序与约束外，不扩展新的事实前提。

## 1. 计划目标与适用边界

本实施计划用于把已批准设计中的 P0 到 P2 改造顺序落成可执行批次，确保执行时满足以下总原则：

- 严格按已批准顺序推进：`P0-1 -> P0-2 -> P1-1 -> P1-2 -> P2`。
- 采用“单批次、可回退、逐批验收”的执行骨架。
- 本轮只在**边界层**优先引入 Pydantic：HTTP 输入输出、bridge 消息、工具参数与结果、history API 返回体、配置文档对象。
- 以“入口校验 + 出口序列化模型化”为先，不追求一次性删掉全部旧手写解析。
- 不做全仓对象风格重写；内部业务逻辑、现有 dataclass、ORM 实体可暂时保留。
- 不在第三方抓取解析结果的最底层直接强套严格模型，而是在归一化产物上建模。
- 暂不运行 live 与 e2e 测试。

## 2. 全局实施约束

### 2.1 协议与行为兼容要求

所有批次都必须以兼容为前提，默认保持以下内容不变：

- 字段名
- 默认值语义
- 可空性
- 嵌套 shape
- 对外协议/bridge 协议/history API 的当前契约形态

### 2.2 字段修复约束

若实施中发现“明显不合理的字段定义/行为”，允许修复，但必须同时满足：

1. 补充对应测试；
2. 在批准设计文档底部“明显不合理字段修复记录位”中登记；
3. 不把该修复扩展为额外范围蔓延。

### 2.3 扩展性约束

- 对外协议、bridge 协议、history API 默认采用严格字段控制。
- 必须预留扩展时，只能通过显式 `metadata` / `details` 等扩展桶承接，而不是放宽整个对象约束。

### 2.4 失败与止损约束

- 一次只动一个高风险子域。
- 某批次失败时，必须停留在该批次内修复，不得带病进入下一批。
- 若 Pydantic 化导致协议行为偏移，优先保留模型并恢复旧字段语义。
- 若暴露结构性问题，先记录问题与补丁思路，再继续推进。

## 3. 批次总览

| 批次 | 目标子域 | 目标文件/目录 | 批次目标 | 优先级 |
| --- | --- | --- | --- | --- |
| P0-1 | copilot runtime 请求/响应/事件协议 | `backend/app/copilot_runtime/protocol.py`、`backend/app/copilot_runtime/contracts.py`、及直接相关值对象 | 把请求/响应/事件的手写解析逐步替换为 Pydantic 模型 | 最高 |
| P0-2 | desktop runtime capability bridge / host route 协议 | `backend/app/desktop_runtime/` | 收敛 schema、解析和运行时校验的重复表达 | 高 |
| P1-1 | sustech 集成工具边界 | `backend/app/integrations/sustech/` | 只触碰 facade / tool boundary，不深入抓取解析深处 | 高 |
| P1-2 | history API 读模型 | `backend/app/copilot_runtime/persistence/query_dtos.py` 及相关 history API 读模型 | 让 timeline / block / snapshot 的 shape 显式化 | 中 |
| P2 | thinking / provider catalog / 其他配置能力模型 | thinking / provider catalog / 其他配置能力对应文件或目录（实施时按批准设计限定范围识别） | 完成剩余配置与能力对象的边界模型化 | 中 |

## 4. 每批统一执行模板

每批执行时都应按以下顺序落地：

1. 确认前置批次已完成并通过验收；
2. 梳理当前子域的边界字段，对照旧协议建模；
3. 先补入口模型，再补出口模型与必要联合/嵌套子模型；
4. 保留旧字段语义，重点核对字段名、默认值、可空性、未知字段处理与序列化输出；
5. 若发生明显不合理字段修复，同步补测试并登记到批准设计文档记录位；
6. 运行本批必跑校验；
7. 以独立小发布标准完成验收后，才允许进入下一批。

## 5. 分批详细实施计划

### 5.1 P0-1：copilot runtime 请求/响应/事件协议模型化

#### 5.1.1 目标子域与目标文件/目录

- 目标子域：copilot runtime 的请求/响应/事件边界
- 目标文件/目录：
  - `backend/app/copilot_runtime/protocol.py`
  - `backend/app/copilot_runtime/contracts.py`
  - 直接相关值对象

#### 5.1.2 预计引入的 Pydantic 模型类别

- 请求模型（request models）
- 响应模型（response models）
- 事件模型（event models）
- 联合模型 / 变体模型（尤其是事件 type 变体）
- 嵌套子模型：
  - runtime options
  - thinking
  - tool 权限
- 与上述协议直接关联的值对象模型

#### 5.1.3 建议实施拆法

- 第一步：只为最外层请求/响应壳体建立模型，先接住入口与出口。
- 第二步：补齐事件联合模型，显式化 type 与 payload 变体关系。
- 第三步：补齐 runtime options / thinking / tool 权限等嵌套子模型。
- 第四步：保留必要转换层，避免在首批同时重写内部业务流转。

#### 5.1.4 保持兼容的关键点

- 对外请求/响应字段名、字段 shape、默认值语义保持不变。
- 事件序列化结果与现有契约一致。
- thinking、runtime options、tool 权限等联合/嵌套对象的可空性与缺省表现保持一致。
- 未知字段处理策略必须与当前契约一致；若要收紧，只能在确认不破坏当前行为后进行。
- 如需扩展字段，优先走显式扩展桶，不直接放宽主对象。

#### 5.1.5 该批主要风险

- 请求/响应/事件往往包含多层嵌套，容易在默认值、缺省字段与 `null` 语义上出现偏移。
- 事件联合模型若判别方式处理不稳，可能导致序列化/反序列化不兼容。
- 旧手写解析与新模型并存阶段，可能出现双重校验或行为不一致。
- 首批属于高流量边界，任何协议偏移都会快速放大。

#### 5.1.6 必跑测试与校验命令

```bash
# 1) 运行全部非 live 自动化测试
# 要求：使用仓库既有标准入口，执行“全部非 live 自动化测试”，不得只跑当前子域子集。
<repo-standard-command-for-all-non-live-automated-tests>

# 2) 运行后端综合检查
python backend/check.py
```

#### 5.1.7 批次完成判定标准

- `protocol.py` / `contracts.py` 对应的边界请求、响应、事件已由 Pydantic 模型显式承接。
- runtime options、thinking、tool 权限等重点嵌套对象已模型化。
- 对外协议字段名、默认值、可空性、未知字段处理与序列化结果经验证未偏离当前契约。
- 全部非 live 自动化测试与 `backend/check.py` 通过。
- 若发生字段修复，已补测试并已登记到批准设计文档记录位。

---

### 5.2 P0-2：desktop runtime capability bridge / host route 协议模型化

#### 5.2.1 目标子域与目标文件/目录

- 目标子域：desktop runtime 中 capability bridge / host route 等协议对象
- 目标文件/目录：
  - `backend/app/desktop_runtime/`

#### 5.2.2 预计引入的 Pydantic 模型类别

- bridge 请求模型
- bridge 响应模型
- host route 输入/输出模型
- operation-specific payload 模型
- operation-specific result 模型
- 共用 schema 基类或共享子模型
- 运行时校验复用模型

#### 5.2.3 建议实施拆法

- 第一步：梳理 capability bridge 与 host route 的公共壳体字段。
- 第二步：把 operation-specific payload/result 显式拆成联合或分型模型。
- 第三步：用统一模型收敛“schema 定义、解析逻辑、运行时校验”三处重复表达。
- 第四步：保留必要的适配层，避免把 bridge 行为变更与模型化耦合在一起。

#### 5.2.4 保持兼容的关键点

- bridge 协议字段 shape 与操作语义保持不变。
- host route 入口/出口序列化结果保持一致。
- operation-specific payload/result 的区分方式必须稳定，不改变既有调用方预期。
- 默认采用严格字段控制，但扩展对象仍须通过显式扩展桶承载。

#### 5.2.5 该批主要风险

- 同一协议对象可能在 schema、解析、运行时校验中重复存在，迁移时容易漏改一处。
- operation-specific payload/result 一旦拆分不完整，会造成某些操作分支失配。
- bridge/host route 通常是跨边界协议，兼容性问题隐蔽且影响面广。

#### 5.2.6 必跑测试与校验命令

```bash
# 1) 运行全部非 live 自动化测试
# 要求：使用仓库既有标准入口，执行“全部非 live 自动化测试”，不得只跑当前子域子集。
<repo-standard-command-for-all-non-live-automated-tests>

# 2) 运行后端综合检查
python backend/check.py
```

#### 5.2.7 批次完成判定标准

- `backend/app/desktop_runtime/` 中 capability bridge / host route 的边界协议对象已完成模型化。
- schema、解析和运行时校验的重复表达已被统一收敛到模型层。
- operation-specific payload/result 的 shape 已显式化且兼容现有契约。
- 全部非 live 自动化测试与 `backend/check.py` 通过。
- 若发生字段修复，已补测试并已登记到批准设计文档记录位。

---

### 5.3 P1-1：sustech 集成工具参数与结果模型化

#### 5.3.1 目标子域与目标文件/目录

- 目标子域：`sustech` 集成的工具边界
- 目标文件/目录：
  - `backend/app/integrations/sustech/`

#### 5.3.2 预计引入的 Pydantic 模型类别

- 工具参数模型
- 工具结果模型
- facade 输入模型
- facade 输出模型
- 归一化结果模型（仅限 facade / tool boundary）
- 必要的嵌套子模型

#### 5.3.3 建议实施拆法

- 第一步：锁定 tool boundary 与 facade 边界，不深入第三方抓取解析底层。
- 第二步：把工具参数先模型化，优先解决入口校验。
- 第三步：把工具结果与归一化产物模型化，保证出口 shape 显式化。
- 第四步：仅在边界完成转换，不重写抓取/解析深处实现。

#### 5.3.4 保持兼容的关键点

- 只触碰 facade / tool boundary，严格避免超出批准范围深入抓取解析底层。
- 工具参数名、默认值、可空性与现有调用契约一致。
- 工具结果 shape 保持现状，尤其是归一化后对上游暴露的结构不变。
- 不将第三方原始抓取结果直接套为严格模型，而是在归一化产物上建模。

#### 5.3.5 该批主要风险

- 工具边界与抓取解析内部可能耦合较深，容易范围失控。
- 第三方数据源不稳定，若模型落点下探过深，会使模型过脆或产生大量兼容问题。
- 工具结果往往兼具“可展示”和“可继续处理”双重用途，shape 偏移风险较高。

#### 5.3.6 必跑测试与校验命令

```bash
# 1) 运行全部非 live 自动化测试
# 要求：使用仓库既有标准入口，执行“全部非 live 自动化测试”，不得只跑当前子域子集。
<repo-standard-command-for-all-non-live-automated-tests>

# 2) 运行后端综合检查
python backend/check.py
```

#### 5.3.7 批次完成判定标准

- `backend/app/integrations/sustech/` 的工具参数与结果边界已完成模型化。
- 变更范围严格停留在 facade / tool boundary，未侵入抓取解析深处。
- 归一化产物的输出 shape 已显式化且兼容现有契约。
- 全部非 live 自动化测试与 `backend/check.py` 通过。
- 若发生字段修复，已补测试并已登记到批准设计文档记录位。

---

### 5.4 P1-2：history API 读模型显式化

#### 5.4.1 目标子域与目标文件/目录

- 目标子域：history API 读模型
- 目标文件/目录：
  - `backend/app/copilot_runtime/persistence/query_dtos.py`
  - 相关 history API 读模型

#### 5.4.2 预计引入的 Pydantic 模型类别

- query DTO 读模型
- history API 返回模型
- timeline 模型
- block 模型
- snapshot 模型
- terminal state 模型
- 必要的嵌套联合/子模型

#### 5.4.3 建议实施拆法

- 第一步：以 `query_dtos.py` 为中心梳理对外返回 shape。
- 第二步：先把最外层 history API 返回体模型化。
- 第三步：继续细化 timeline / block / snapshot / terminal state。
- 第四步：对照现有契约逐层核对序列化输出，不同时引入写路径改造。

#### 5.4.4 保持兼容的关键点

- history API 返回字段、嵌套结构与序列化结果保持不变。
- timeline / block / snapshot / terminal state 的层级关系和可空性保持一致。
- history API 默认采用严格字段控制；如需扩展，仅使用显式扩展桶。
- 本批仅覆盖读模型，不扩大到未获批准的写路径或持久化内部结构重构。

#### 5.4.5 该批主要风险

- 历史数据对象层次多，嵌套深，容易出现局部 shape 漏建模。
- snapshot / terminal state 等终态对象若定义不严谨，可能造成读取兼容问题。
- query DTO 与 API 返回体之间若存在隐式转换，迁移时容易遗漏序列化细节。

#### 5.4.6 必跑测试与校验命令

```bash
# 1) 运行全部非 live 自动化测试
# 要求：使用仓库既有标准入口，执行“全部非 live 自动化测试”，不得只跑当前子域子集。
<repo-standard-command-for-all-non-live-automated-tests>

# 2) 运行后端综合检查
python backend/check.py
```

#### 5.4.7 批次完成判定标准

- `query_dtos.py` 及相关 history API 读模型已显式化为 Pydantic 模型。
- timeline / block / snapshot / terminal state 的 shape 已被明确建模。
- history API 的字段名、默认值、可空性、未知字段处理与序列化输出保持兼容。
- 全部非 live 自动化测试与 `backend/check.py` 通过。
- 若发生字段修复，已补测试并已登记到批准设计文档记录位。

---

### 5.5 P2：thinking / provider catalog / 其他配置能力模型

#### 5.5.1 目标子域与目标文件/目录

- 目标子域：
  - thinking
  - provider catalog
  - 其他配置能力模型
- 目标文件/目录：
  - thinking / provider catalog / 其他配置能力对应文件或目录
  - 由于批准设计未进一步枚举具体路径，实施时仅可在上述已批准子域内识别并落点，禁止超范围扩张

#### 5.5.2 预计引入的 Pydantic 模型类别

- thinking 配置模型
- provider catalog 文档对象模型
- 其他配置能力对象模型
- 嵌套配置子模型
- 严格字段控制模型
- 使用 `metadata` / `details` 等扩展桶的扩展对象模型

#### 5.5.3 建议实施拆法

- 第一步：先做 thinking 模型，收紧高价值配置边界。
- 第二步：再做 provider catalog 文档对象模型。
- 第三步：最后覆盖其他配置能力模型。
- 第四步：统一检查严格字段控制与扩展桶策略是否落实一致。

#### 5.5.4 保持兼容的关键点

- 配置对象字段名、默认值、可空性、嵌套结构保持不变。
- provider catalog 等配置文档对象的现有 shape 不发生破坏性变化。
- 严格字段控制是默认策略，但需要扩展时必须使用显式扩展桶。
- 避免把配置对象模型化演变成全域配置系统重构。

#### 5.5.5 该批主要风险

- 配置对象往往扩展点多，若严格字段控制与扩展桶边界定义不清，容易引起未来演进受阻或当前兼容问题。
- P2 涉及多个剩余子域，若前序批次沉淀的建模方式不一致，会在此批集中暴露。
- provider catalog / 其他配置能力如果一次铺太广，容易偏离“单批次、可回退”的原则。

#### 5.5.6 必跑测试与校验命令

```bash
# 1) 运行全部非 live 自动化测试
# 要求：使用仓库既有标准入口，执行“全部非 live 自动化测试”，不得只跑当前子域子集。
<repo-standard-command-for-all-non-live-automated-tests>

# 2) 运行后端综合检查
python backend/check.py
```

#### 5.5.7 批次完成判定标准

- thinking / provider catalog / 其他配置能力模型已在已批准范围内完成边界模型化。
- 严格字段控制与扩展桶策略在相关配置对象上已统一落实。
- 配置对象 shape 与当前契约保持兼容。
- 全部非 live 自动化测试与 `backend/check.py` 通过。
- 若发生字段修复，已补测试并已登记到批准设计文档记录位。

## 6. 批次依赖与进入条件

| 当前批次 | 前置条件 | 不满足时处理 |
| --- | --- | --- |
| P0-1 | 无 | 不适用 |
| P0-2 | P0-1 已完成并通过验收 | 留在 P0-1 修复 |
| P1-1 | P0-2 已完成并通过验收 | 留在 P0-2 修复 |
| P1-2 | P1-1 已完成并通过验收 | 留在 P1-1 修复 |
| P2 | P1-2 已完成并通过验收 | 留在 P1-2 修复 |

## 7. 统一验收清单

每批提交验收前，必须同时满足以下条件：

1. 批次范围未超出批准设计；
2. 改造落点限定在边界层；
3. 对外字段名、默认值、可空性、嵌套 shape、未知字段处理、序列化输出均完成兼容核对；
4. 全部非 live 自动化测试已完整执行；
5. `backend/check.py` 已执行通过；
6. 若发生明显不合理字段修复，已补测试并登记到批准设计文档记录位；
7. 当前批次可以作为独立小发布接受，不依赖下一批补救。

## 8. 建议的首批实施范围

建议首批只实施 **P0-1**，且进一步收敛为以下最小可验收范围：

- 先处理 `backend/app/copilot_runtime/protocol.py`
- 再处理 `backend/app/copilot_runtime/contracts.py`
- 仅覆盖请求模型、响应模型、事件模型，以及与其直接耦合的 runtime options / thinking / tool 权限等嵌套子模型
- 不在首批扩展到 desktop runtime、history API、sustech 集成或更深层内部业务对象

这样可以先在“最高价值协议边界”验证以下关键假设：

- Pydantic 模型能否稳定承接请求/响应/事件边界；
- 联合模型与嵌套子模型是否能在不改变外部契约的前提下落地；
- 批次级回归验证流程（全部非 live 自动化测试 + `backend/check.py`）是否顺畅。

若 P0-1 验收稳定，再按批准顺序进入 P0-2。

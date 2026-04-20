# 后端 warning 清理设计

## 1. 背景与目标

本文档用于落地已经获批的后端 warning 清理设计，并作为后续自动实施、批次验收、回滚处理与最终收尾的唯一事实来源。

本轮工作的目标有三项。

- 尽可能将后端全部非 `live` 自动化测试中的 warning 清零。
- 清理策略以真实升级为主，不通过全局 warning 过滤制造表面清零结果。
- 每完成一个批次，都必须执行全部非 `live` 自动化测试与 `python backend/check.py`，验证通过后立即独立提交。

## 2. 非目标

- 本轮工作不修改业务功能目标，也不把 warning 清理扩展成无关的现代化大扫除。
- 本轮工作不先通过 `filterwarnings` 或其他全局 warning 压制手段换取表面通过。
- 本轮工作不对不是 warning 直接来源的代码顺手做大范围重构。
- 本轮工作不将测试侧 `ResourceWarning` 提前并入业务 warning 修复批次，该类问题统一后置到 W4 处理。
- 本轮工作的验证范围以全部非 `live` 自动化测试为准，不把 `live` 测试纳入本次清理目标。

## 3. 总体执行架构

已批准的总体执行架构采用方案 A。

执行顺序按 warning 来源分批推进，先完成业务侧过时 API 的真实升级，再处理测试侧 `ResourceWarning` 与剩余静态尾项。整个过程严格按 W1 到 W4 的顺序执行，不交叉合并批次，不提前处理后续批次内容。

每个批次都应当满足以下执行约束。

- 当前批次只处理本批范围内的 warning 来源及其直接相关测试。
- 当前批次完成后，必须立刻执行完整验证。
- 当前批次验证通过后，必须立刻形成独立提交。
- 若当前批次出现回退，问题必须在当前批次内解决，不能带入下一批。

## 4. 真实升级原则

### 4.1 真实替换优先

warning 清理以真实替换过时 API 为首要原则。实施时先修正真实来源，再考虑兼容处理；在进入最终收尾前，不启用全局 warning 过滤作为默认路径。

### 4.2 已批准的真实升级点

下列 warning 来源必须采用真实升级方案处理。

- `backend/app/tooling/file_tools/image_reader.py` 中与 `imghdr` 相关的 warning 必须通过真实替换完成清理。
- `backend/app/copilot_runtime/provider_adapter_registry.py` 中旧模型类名相关 warning 必须通过真实升级完成清理。
- Blackboard 域中的 UTC 时间 warning 必须通过真实时间语义迁移完成清理。
- `backend/app/event_manager/data/db_manager.py` 中与 `datetime.utcnow()` 相关的剩余业务时间 warning 必须通过真实升级完成清理。

### 4.3 行为兼容要求

真实升级必须保持行为兼容，兼容要求如下。

- 图片探测替换完成后，支持的图片格式集合与原有错误语义应尽量保持稳定。
- provider 分发行为与相关测试语义应保持稳定，不改变原有路由意图与断言含义。
- UTC 时间迁移不能做机械式全局替换，必要时应通过 helper 或显式转换保持原有 naive UTC 语义稳定。

### 4.4 变更边界要求

- 任何批次都不应将 warning 清理扩展成与 warning 无关的整理工作。
- 任何兼容修复都应优先限制在同一子域内完成。
- 测试侧 `ResourceWarning` 统一后置到 W4，不提前拆入 W1 到 W3。

## 5. 批次计划

### 5.1 W1

W1 的范围是 `backend/app/tooling/file_tools/image_reader.py`、`backend/app/copilot_runtime/provider_adapter_registry.py` 以及直接相关测试。

W1 的目标是清理 `imghdr` 相关 warning 与 `OpenAIModel` 相关 warning。该批次应优先完成业务侧最直接的过时 API 替换，并确认相关测试语义没有偏移。

W1 不处理测试资源清理问题，也不扩展到与上述文件没有直接关系的 provider 或图片处理代码。

### 5.2 W2

W2 的范围是以下 Blackboard 域文件。

- `backend/app/integrations/sustech/blackboard/data/models.py`
- `backend/app/integrations/sustech/blackboard/data/sync_support.py`
- `backend/app/integrations/sustech/blackboard/data/sync_operations.py`
- `backend/app/integrations/sustech/blackboard/provider/use_cases/calendar_ics.py`

W2 的目标是清理 Blackboard 域的 UTC 时间 warning。该批次应围绕时间生成、传递、序列化与比较路径做兼容性迁移，并保持既有 naive UTC 语义稳定。

W2 不处理 `event_manager` 子域中的剩余业务时间 warning，也不提前处理测试资源类 warning。

### 5.3 W3

W3 的范围是 `backend/app/event_manager/data/db_manager.py` 及必要测试。

W3 的目标是处理剩余业务时间 warning，重点是清理该子域内与 `datetime.utcnow()` 相关的问题。该批次只处理完成本子域 warning 清理所需的最小兼容修改。

W3 不扩展到与本文件无直接关系的全局时间工具改造。

### 5.4 W4

W4 的范围是测试资源清理与静态尾项。

W4 的重点包括以下内容。

- 处理与 `ResourceWarning: unclosed event loop` 相关的测试。
- 处理 `backend/tests/unit/desktop_runtime/test_server.py` 一类可以直接修复的静态尾项。
- 处理 `backend/tests/unit/provider/test_tis_persistence_integration.py` 一类可以直接修复的静态尾项。

W4 只处理测试资源清理与剩余静态尾项，不重新打开已经在 W1 到 W3 完成并通过验收的业务 warning 批次，除非当前尾项修复直接暴露出同一位置的兼容问题。

## 6. 每批统一执行流程

后续自动实施必须按同一流程推进每个批次。

1. 实施者先确认当前批次的目标 warning 来源、目标文件与允许修改范围。
2. 实施者在当前批次内完成真实升级或资源清理，并将改动限制在本批范围与直接相关测试内。
3. 实施者完成修改后，立即执行全部非 `live` 自动化测试与 `python backend/check.py`。
4. 实施者验证 warning 计数变化，确认目标类别显著下降，并确认没有引入新的主类 warning。
5. 实施者在验证通过后立即提交当前批次，提交内容不得混入其他批次。
6. 实施者记录当前批次的 warning 变化、验证结论与提交信息，供后续批次与最终收尾复核使用。

## 7. 每批验收标准

每一批都必须同时满足以下验收标准。

- 全部非 `live` 自动化测试通过。
- `python backend/check.py` 通过。
- warning 计数与目标类别相较于批次开始前有显著下降，且没有引入新的主类 warning。
- 验证通过后立即形成独立提交，提交中不混入其他批次内容。

只要任一条件未满足，当前批次就不能视为完成。

## 8. 回滚与止损策略

每个批次都必须遵守以下回滚与止损规则。

- 若当前批次导致测试结果回退，必须在当前批次内修复。
- 若当前批次导致 warning 计数回退，必须在当前批次内修复。
- 若当前批次导致 `python backend/check.py` 回退，必须在当前批次内修复。
- 兼容性问题优先在同一子域内修复，避免扩大影响面。
- 若当前批次在同一子域内仍无法稳定收敛，只回退当前批次，不回退其他已验收批次。
- 不使用全局 warning 压制作为兜底方案。只有在最终确认存在短期不可控、且来源纯粹属于第三方依赖噪音的 warning 时，才允许单独评估这一路径；当前设计默认不启用该路径。

## 9. 最终收尾标准

W1 到 W4 全部完成后，必须再次执行一次完整的非 `live` 测试 warning 复核与 `python backend/check.py`。

最终收尾时按照以下规则判定结果。

- 若 warning 已清零，则按 warning 清零完成收尾。
- 若仍有极少数不可避免项，则必须明确列出来源、原因与后续建议。
- 最终收尾只做总结与复核，不再把多个批次重新合并成一个提交。
- 每一批仍然维持立即独立提交的要求，最终收尾不改变此前的批次提交边界。

## 10. 执行约束总结

后续自动实施必须同时满足以下约束。

- 只按照本文档定义的批次顺序推进。
- 只在当前批次范围内处理 warning 直接来源与直接相关测试。
- 只采用真实升级优先的清理路径。
- 只在当前批次完成完整验证后独立提交。
- 只在最终收尾阶段输出全局结论与遗留项说明。

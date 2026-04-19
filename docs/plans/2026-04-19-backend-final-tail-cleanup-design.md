# 后端最终尾项收尾设计

日期：2026-04-19

## 1. 背景

主任务已完成 [`runtime`](backend/app/copilot_runtime/)、[`desktop_runtime`](backend/app/desktop_runtime/)、[`tooling`](backend/app/tooling/)、Blackboard API 与解析层，以及 TIS 主波次的大部分整改。

本设计文档仅记录已获批准的最终收尾设计，用于约束最后一轮后端复杂度尾项清理边界。本文档只覆盖 Blackboard 与 TIS 的剩余整改设计，不包含代码实现、排期拆解或额外扩展方案。

## 2. 收尾顺序

最终收尾按以下固定顺序推进：

1. 先完成 [`Blackboard`](backend/app/integrations/sustech/blackboard/) 同步与快照层的函数级 [`xenon`](backend/check.py:42) 尾项
2. 再处理 [`TIS`](backend/app/integrations/sustech/teaching_information_system/) 的模块级复杂度尾项
3. 最后重新运行 [`backend/check.py`](backend/check.py) 做总验收

## 3. Blackboard 收尾设计

### 3.1 目标范围

本波只处理 Blackboard 同步层与快照编排层中阻塞函数级复杂度收尾，重点文件如下：

- [`backend/app/integrations/sustech/blackboard/data/sync_operations.py`](backend/app/integrations/sustech/blackboard/data/sync_operations.py)
- [`backend/app/integrations/sustech/blackboard/provider/use_cases/snapshot_sync.py`](backend/app/integrations/sustech/blackboard/provider/use_cases/snapshot_sync.py)

### 3.2 同步层设计

在 [`backend/app/integrations/sustech/blackboard/data/sync_operations.py`](backend/app/integrations/sustech/blackboard/data/sync_operations.py) 中，围绕以下函数提取共享内部 helper：

- [`sync_assignments()`](backend/app/integrations/sustech/blackboard/data/sync_operations.py:76)
- [`sync_resources()`](backend/app/integrations/sustech/blackboard/data/sync_operations.py:176)
- [`sync_grades()`](backend/app/integrations/sustech/blackboard/data/sync_operations.py:286)
- [`sync_announcements()`](backend/app/integrations/sustech/blackboard/data/sync_operations.py:383)
- [`sync_calendar_events()`](backend/app/integrations/sustech/blackboard/data/sync_operations.py:528)

函数主体收敛为统一骨架：预处理 → 标准化 → 持久化 → 汇总。

该设计的核心约束如下：

- 只抽取共享内部 helper
- 不改变外部函数签名
- 不改变既有返回结构
- 不借机扩大到无关清理

### 3.3 快照编排层设计

在 [`backend/app/integrations/sustech/blackboard/provider/use_cases/snapshot_sync.py`](backend/app/integrations/sustech/blackboard/provider/use_cases/snapshot_sync.py) 中，将以下函数压缩为更薄的 orchestration：

- [`fetch_blackboard_snapshot()`](backend/app/integrations/sustech/blackboard/provider/use_cases/snapshot_sync.py:721)
- [`run_blackboard_course_resources_sync()`](backend/app/integrations/sustech/blackboard/provider/use_cases/snapshot_sync.py:991)

上述 orchestration 仅负责以下职责：

- 上下文解析
- 逐课程执行
- 错误映射
- 结果汇总

除上述职责外，其余控制流与重复细节应下沉到内部 helper，不在顶层 orchestration 中继续堆积。

### 3.4 Blackboard 波次边界

本波 Blackboard 的主目标只盯函数级阻塞。

若 [`sync_operations.py`](backend/app/integrations/sustech/blackboard/data/sync_operations.py) 或 [`snapshot_sync.py`](backend/app/integrations/sustech/blackboard/provider/use_cases/snapshot_sync.py) 在本轮结束后仍有模块级残留，则应单独记录，不在本波为追分继续扩大改动面。

## 4. TIS 收尾设计

### 4.1 目标范围

TIS 后续单独处理以下文件的模块级复杂度尾项：

- [`backend/app/integrations/sustech/teaching_information_system/provider/use_cases/diagnostics.py`](backend/app/integrations/sustech/teaching_information_system/provider/use_cases/diagnostics.py)
- [`backend/app/integrations/sustech/teaching_information_system/provider/use_cases/personal_grades.py`](backend/app/integrations/sustech/teaching_information_system/provider/use_cases/personal_grades.py)

### 4.2 设计约束

TIS 波次采用与 Blackboard 一致的最小兼容原则：

- 只抽内部 helper
- 只拆控制流
- 不改外部签名
- 不改返回结构

如整改过程中涉及导入路径或类型分支，则顺带执行最小范围导入环境核验，但不扩展为额外重构任务。

## 5. 验证与风险控制设计

### 5.1 子波次验证顺序

每个子波次都先运行目标范围 [`xenon`](backend/check.py:42)，再运行 [`ruff check`](backend/check.py:31)。

若涉及以下任一情况，则补跑同范围 [`pyright`](backend/check.py:34)：

- helper 返回值调整
- 分支类型收窄
- 摘要结构调整

### 5.2 提交控制

允许阶段性提交，但只有在同时满足以下条件时才允许提交：

- 函数级或模块级整改形成净改进
- 局部验证通过
- 无 breaking change

### 5.3 结果记录要求

每个波次的结果都必须明确记录：

- 剩余函数尾项
- 剩余模块级尾项
- 各尾项未继续处理的原因

### 5.4 总验收

最终只在 Blackboard 与 TIS 尾项全部收完后，重新运行 [`backend/check.py`](backend/check.py) 作为总验收。

## 6. 非目标

本设计明确不包含以下内容：

- 不做 Python 代码实现
- 不编写实施计划
- 不扩展到已获批准范围之外的模块
- 不为了追求更高分数而扩大改单面

## 7. 交付物定义

本轮设计交付物仅为一份正式设计文档，用于准确记录已批准的最终收尾方案，并作为后续实现波次的唯一设计依据。

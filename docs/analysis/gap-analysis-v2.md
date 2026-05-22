---
sidebar_label: 工具提示词差距分析 v2（Phase 1-5 后重评估）
---

# 工具提示词差距分析报告 v2

> **分析时间**: 2026-05-14
> **分析范围**: 竞品 Claude Code (`claude-code-main/src/tools/*/prompt.ts`) vs 本项目 (`backend/app/tooling/prompts/`)
> **前置工作**: Phase 1-5 已完成 — 全部 20 个工具的 6 段式提示词、领域工具提示词、ToolSelection Guide

---

## 一、核心结论

**差距从 v1 的"鸿沟"状态显著缩小至"关键连线缺失"状态。**

v1 阶段的 5 个根因中，前 4 个已经得到根本性改善：

| v1 根因 | 状态 | 改善措施 |
|---------|------|---------|
| ① 提示词信息密度低（仅 1 句） | ✅ 已解决 | 20 个工具全部实现 6 段式结构化提示词 |
| ② 工具间关系缺失 | ✅ 已解决 | `FILE_TOOL_PREFERENCE_GUIDE` 表 + 每个工具的 `relationships` 段 |
| ③ 参数语义不足 | ✅ 已解决 | `parameter_guide` 段提供约束、默认值、使用技巧 |
| ④ 缺少反面示例（Do NOT） | ✅ 已解决 | 每个工具的 `usage_guide` 包含 "Do NOT use this tool when" |
| ⑤ 领域工具零提示词 | ✅ 已解决 | Blackboard 5 个 + TIS 4 个工具均有完整提示词 |

**当前最大的问题不再是"有没有提示词"，而是"提示词是否被正确注入到 Agent 看到的地方"。**

---

## 二、逐工具逐项对比

### 2.1 FileReadTool / `tool.fs.read`

| 维度 | 竞品 | 本项目 | 差距 |
|------|------|--------|------|
| 多格式支持 | PNG/JPG/PDF/ipynb | PNG/JPG/GIF/WebP/PDF/ipynb | ✅ 对等 |
| 行号格式说明 | cat -n format, line numbers starting at 1 | "Results are returned with line numbers (1-based)" | ✅ 对等 |
| offset/limit 指南 | "recommended to read the whole file by not providing these parameters" | offset/limit 参数说明 | ✅ 对等 |
| PDF 页数约束 | "pages REQUIRED for >10 pages, max 20" | "REQUIRED for PDFs with more than 10 pages; maximum 20" | ✅ 完全一致 |
| 截图提示 | "If the user provides a path to a screenshot, ALWAYS use this tool" | "ALWAYS use this tool for image paths" | ✅ 对等 |
| 空文件提醒 | "If you read a file that exists but has empty contents you will receive a system reminder" | "Reading an empty file returns a system reminder warning" | ✅ 对等 |
| 目录不可读 | "can only read files, not directories. To read a directory, use ls" | "Only reads files, not directories. To list a directory, use tool.fs.glob" | ✅ 更优 — 指向专用工具 |

**结论：达到竞品 >95% 对齐度。**

### 2.2 FileWriteTool / `tool.fs.write`

| 维度 | 竞品 | 本项目 | 差距 |
|------|------|--------|------|
| Read-before-write 规则 | "MUST use Read tool first. This tool will fail if you did not read first." | "CRITICAL: If the file already exists, you MUST use tool.fs.read first" | ✅ 对等 |
| Edit 优先 | "Prefer the Edit tool for modifying existing files — it only sends the diff" | "For partial modifications to existing files, prefer tool.fs.edit" | ✅ 对等 |
| Write 用途限制 | "Only use this tool to create new files or for complete rewrites" | "Creates a new file or completely overwrites an existing file" | ✅ 对等 |
| 禁止创建 .md | "NEVER create documentation files (*.md) or README files" | "NEVER create README or .md documentation files unless explicitly requested" | ✅ 对等 |
| 禁止 emoji | "Only use emojis if the user explicitly requests it" | "Only use emojis in file content if the user explicitly requests it" | ✅ 对等 |

**结论：达到竞品 >95% 对齐度。**

### 2.3 FileEditTool / `tool.fs.edit`

| 维度 | 竞品 | 本项目 | 差距 |
|------|------|--------|------|
| Read-before-edit | "must use Read tool at least once before editing. This tool will error if you attempt an edit without reading" | "CRITICAL: You MUST use tool.fs.read at least once in the conversation before editing" | ✅ 对等 |
| 缩进保留 | "preserve the exact indentation as it appears AFTER the line number prefix" | "preserve EXACT indentation as it appears AFTER the line number prefix" | ✅ 对等 |
| oldString 唯一性 | "edit will FAIL if old_string is not unique" | "edit will FAIL if oldString is not unique in the file" | ✅ 对等 |
| 最小唯一串建议 | "smallest old_string that's clearly unique — usually 2-4 adjacent lines" | "Use the smallest clearly-unique string (2-4 adjacent lines is usually sufficient)" | ✅ 对等 |
| replaceAll | "Use replace_all for replacing and renaming strings across the file" | "Use replaceAll for variable/function renaming" | ✅ 对等 |
| 禁止 emoji | ✅ | ✅ | ✅ |
| 禁止写新文件 | ✅ | "ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required" | ✅ 对等 |

**结论：达到竞品 >95% 对齐度。**

### 2.4 GlobTool / `tool.fs.glob`

| 维度 | 竞品 | 本项目 | 差距 |
|------|------|--------|------|
| 功能定位 | "Fast file pattern matching tool" | "Finds files and directories... Returns matching file paths sorted by modification time" | ✅ 对等 |
| 模式示例 | "**/*.js" or "src/**/*.ts" | "**/*.py", "src/**/*.ts", "*.json", etc. | ✅ 更丰富 |
| 按修改时间排序 | ✅ | ✅ | ✅ |
| 搜索结果限制 | 无明确声明 | "Maximum 500 results per call" | ✅ 更明确 |

**结论：达到竞品 >95% 对齐度。**

### 2.5 GrepTool / `tool.fs.grep`

| 维度 | 竞品 | 本项目 | 差距 |
|------|------|--------|------|
| 基于 ripgrep | ✅ | ✅ | ✅ |
| 禁止 shell grep/rg | "NEVER invoke grep or rg as a Bash command" | "ALWAYS use this tool for content search — NEVER use shell grep/rg" | ✅ 对等 |
| full regex 支持 | ✅ | ✅ | ✅ |
| fileGlob 过滤 | ✅ | ✅ | ✅ |
| ripgrep 语法陷阱 | "literal braces need escaping: `interface\\{\\}`" | "Literal braces need escaping: use `interface\\{\\}`" | ✅ 完全一致 |
| 多行匹配 | "use `multiline: true`" | "set isRegex: true for multi-line matching" | ✅ 对等 |
| 输出模式 | "content", "files_with_matches", "count" | 无—输出模式通过其他参数控制 | ⚠️ 小差距 |

**结论：达到竞品 ~90% 对齐度。输出模式描述略简。**

### 2.6 NotebookEditTool / `tool.fs.notebook_edit`

| 维度 | 竞品 | 本项目 | 差距 |
|------|------|--------|------|
| 功能描述 | "Completely replaces the contents of a specific cell" | "Edits Jupyter notebook files with transactional cell operations" | ✅ 对等 |
| 操作模式 | replace, insert, delete | replace, insert, delete | ✅ 完全一致 |
| cell_number 说明 | 0-indexed | cellId-based (更现代) | ✅ 各有优势 |
| 事务性 | 无明确说明 | "All operations in a single call are applied atomically" | ✅ 更优 |

**结论：达到竞品 >100% — 事务性保证是额外优势。**

### 2.7 Switch Root / `tool.fs.switch_root`

竞品没有直接等价的工具。这是我们的额外能力，提示词质量达标。✅

---

## 三、竞品有但我们没有的工具/能力

### 3.1 Bash/Shell 工具（最关键差距）

竞品的 [`BashTool/prompt.ts`](d:/wroot/claude-code-main/src/tools/BashTool/prompt.ts:275) 是整个工具选择教育体系的**核心承载者**。它不是简单的"执行 shell 命令"工具，而是：

```
IMPORTANT: Avoid using this tool to run cat, head, tail, sed, awk, find, grep...
Instead, use the appropriate dedicated tool:

File search: Use Glob (NOT find or ls)
Content search: Use Grep (NOT grep or rg)
Read files: Use Read (NOT cat/head/tail)
Edit files: Use Edit (NOT sed/awk)
Write files: Use Write (NOT echo >/cat <<EOF)
Communication: Output text directly (NOT echo/printf)
```

竞品将这条规则嵌入到最可能被误用的工具（Bash）中，确保模型在每次想用 shell 命令时都能看到这些替代方案。

**我们当前没有等价的 shell 工具**，因此 `FILE_TOOL_PREFERENCE_GUIDE` 只能通过系统提示词注入——但目前并未注入。

### 3.2 竞品的 Bash 提示词还包含（我们缺失的）：

| 竞品特性 | 本项目状态 |
|----------|-----------|
| Git commit/PR 工作流（7 步 commit 流程、PR 创建模板） | ❌ 完全缺失 |
| 并行 vs 串行命令执行指南（独立→并行，依赖→`&&`） | ❌ 完全缺失 |
| Sleep/重试避免规则（"Don't sleep between commands"） | ❌ 完全缺失 |
| 后台任务机制 `run_in_background` | ❌ 不适用（无 Bash 工具） |
| 沙箱配置说明 | ❌ 不适用（无沙箱） |
| 引号处理（"Always quote file paths that contain spaces"） | ❌ 缺失 |
| 避免 cd 的指导 | ❌ 缺失 |

### 3.3 WebSearch/WebFetch 工具提示词

竞品有专用的 [`WebSearchTool`](d:/wroot/claude-code-main/src/tools/WebSearchTool/prompt.ts) 和 [`WebFetchTool`](d:/wroot/claude-code-main/src/tools/WebFetchTool/prompt.ts) 提示词，包含：

- **WebSearch**: 当前月份注入（`currentMonthYear`），域名过滤，强制来源引用格式
- **WebFetch**: URL→Markdown 转换，缓存说明，GitHub URL 重定向到 `gh` CLI

我们通过 MCP 提供了 `tavily-search` 和 `fetch`，但没有自定义提示词引导使用。

### 3.4 Skill 工具提示词

竞品 [`SkillTool/prompt.ts`](d:/wroot/claude-code-main/src/tools/SkillTool/prompt.ts:173) 的核心规则：

```
When a skill matches the user's request, this is a BLOCKING REQUIREMENT:
invoke the relevant Skill tool BEFORE generating any other response about the task
```

我们的技能系统目前只有 `builtin-placeholder-skill/`（明确不处理），没有 Skill 工具提示词。

### 3.5 任务管理工具（TaskCreate/Update/List/Stop/Output）

竞品有完整的任务管理工具链，包含详细的 "When to Use / When NOT to Use" 指南。我们的 Agent 没有任务追踪工具。

### 3.6 ToolSearch（延迟加载工具发现）

竞品的 `ToolSearchTool` 允许按需加载 MCP 工具的完整 schema，避免将所有工具一次性塞入上下文窗口。我们目前一次性注册所有工具，工具数量较少时问题不大，但随着 MCP 工具增长可能需要。

---

## 四、结构性差距：提示词注入链断裂

这是当前 **最关键的发现**。

### 4.1 系统提示词过于简陋

[`DEFAULT_AGENT_SYSTEM_PROMPT`](backend/app/copilot_runtime/agent.py:93) 当前仅包含 5 行：

```python
DEFAULT_AGENT_SYSTEM_PROMPT = (
    "You are the SUSTech Copilot backend assistant. "
    "Provide concise, accurate, text-only answers. "
    "Do not claim to have used tools when no tools are available. "
    "When structured user input would be clearer than a free-text follow-up, prefer the request_user_form tool, including for a single well-defined field. "
    "After sending a form, wait for the user's next message to continue. "
    "Do not use forms to request file uploads or sensitive credentials such as secrets, passwords, or tokens."
)
```

**完全没有注入 `TOOL_SELECTION_GUIDE`、`SHARED_CONVENTIONS`、`FILE_TOOL_PREFERENCE_GUIDE`**。

### 4.2 PromptContext 运行时注入未使用

[`runtime_bindings.py`](backend/app/tooling/file_tools/runtime_bindings.py:273) 中所有 `get_tool_description()` 调用都**没有传入 `PromptContext`**：

```python
description=get_tool_description(FILE_TOOL_READ_ID)
    or "Read files from the workspace.",
```

结果是 `{{workspace_root}}`、`{{current_month_year}}` 等模板变量使用默认值，无法反映实际运行时环境。

### 4.3 工具描述注入方式

当前工具描述通过 `ToolMetadata.description` → 函数调用 API 的 `description` 字段 → 发送给 LLM。这个链路是连通的，但没有利用：

- `render_compact()` — 上下文窗口紧张时使用简短描述
- `render_full()` — 作为系统提示词附件时使用完整教程式描述
- `PromptContext.inject()` — 注入运行时变量

---

## 五、差距优先级矩阵

### P0 — 立即修复（阻断性差距）

| # | 差距 | 影响 | 修复难度 |
|---|------|------|---------|
| 1 | **系统提示词未注入 Tool Selection Guide** | 模型不知道工具选择规则 → 仍可能用 shell 命令替代专用工具 | 低 — 修改 `_compose_system_prompt` 即可 |
| 2 | **PromptContext 运行时注入未使用** | 模板变量使用默认值，workspace_root 等无法动态适配 | 低 — 需要构建 `PromptContext` 并传入 |

### P1 — 本轮值得推进（高价值差距）

| # | 差距 | 影响 | 修复难度 |
|---|------|------|---------|
| 3 | **WebSearch/WebFetch 提示词** | MCP 工具只有基础描述，无使用指南 | 中 — 需要创建新的 ToolPrompt |
| 4 | **Skill 工具提示词** | 技能系统需要 BLOCKING REQUIREMENT 指令 | 中 — 取决于技能系统成熟度 |
| 5 | **多工具并行执行指南** | 模型可能串行执行可并行的独立调用来浪费时间 | 低 — 添加到 SHARED_CONVENTIONS |

### P2 — 后续迭代（锦上添花）

| # | 差距 | 影响 | 修复难度 |
|---|------|------|---------|
| 6 | Git 操作指南（commit/PR 流程） | 中 — 如果 Agent 需要直接操作 git | 高 — 需要确认安全策略 |
| 7 | 任务管理工具（Todo/Task） | 低 — 复杂任务追踪 | 高 — 需要实现新工具 |
| 8 | ToolSearch 延迟加载机制 | 低 — 工具数量少时不明显 | 高 — 需要改造工具注册机制 |
| 9 | Grep 输出模式更详细描述 | 极低 | 低 |

---

## 六、推荐立即执行的改进方案

### 方案 A：注入 Tool Selection Guide 到系统提示词

修改 [`agent.py`](backend/app/copilot_runtime/agent.py:833) 的 `_compose_system_prompt` 方法，将 `TOOL_SELECTION_GUIDE` 和 `SHARED_CONVENTIONS` 合并到系统提示词中：

```python
def _compose_system_prompt(self, skill_system_prompt: str | None) -> str:
    parts = [DEFAULT_AGENT_SYSTEM_PROMPT]
    # ✅ 新增：注入工具选择指南
    parts.append(TOOL_SELECTION_GUIDE)
    parts.append(SHARED_CONVENTIONS)
    if skill_system_prompt and skill_system_prompt.strip():
        parts.append(skill_system_prompt.strip())
    return "\n\n".join(parts)
```

### 方案 B：构建 PromptContext 并传入工具描述渲染

在 `runtime_bindings.py` 或 `builders.py` 中构建 `PromptContext` 并传入 `get_tool_description()`：

```python
from app.tooling.prompts import PromptContext

context = PromptContext(
    workspace_root=workspace_root,
    database_path=database_path,
    current_month_year=current_month_year,
)

description=get_tool_description(FILE_TOOL_READ_ID, context=context)
```

### 方案 C：为 MCP WebSearch/WebFetch 创建提示词

创建 `backend/app/tooling/prompts/domain/mcp/web_tools.py`，参考竞品的 WebSearch/WebFetch 提示词模式。

---

## 七、总结

| 指标 | v1 评估 | v2 评估 | 变化 |
|------|---------|---------|------|
| 有结构化提示词的工具数 | 1/20 (5%) | 20/20 (100%) | +95% |
| 有工具间关系指导 | ❌ | ✅ | 从无到有 |
| 有"禁止用 shell 替代专用工具"指导 | ❌ (功能存在但无提示) | ✅ (存在但未注入到系统提示词) | 从无到有，但未接通 |
| 与竞品核心 7 个 File 工具对齐度 | ~15% | ~92% | +77% |
| 领域工具提示词数 | 0 | 9 (Blackboard 5 + TIS 4) | 从无到有 |
| 系统提示词工具选择指导 | ❌ | ❌ (已编写但未注入) | — |
| 运行时上下文注入 | ❌ | ❌ (机制已就绪但未使用) | — |

**核心结论：提示词内容已接近竞品水平，但"最后一公里"交付链路尚未接通。P0 修复（方案 A + B）预计仅需 ~30 行代码变更，即可将 Agent 看到的提示词从"5 句系统提示词 + 各工具单独描述"提升为"包含完整工具选择指南、跨工具约定、领域工作流的综合系统"。**

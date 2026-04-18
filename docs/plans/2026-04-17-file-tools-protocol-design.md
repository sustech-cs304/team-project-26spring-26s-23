---
title: 文件系统工具协议设计草案
description: 面向本地桌面 Agent 的文件系统工具协议草案，覆盖统一协议、工具边界、错误模型、实现建议与分阶段落地路线。
---

# 2026-04-17 文件系统工具协议设计草案

## 背景与目标

当前项目正在为本地桌面 Agent 设计一组新的文件系统工具。使用场景以本机文件系统访问为主，默认假设 Agent 运行在用户明确授权的桌面宿主环境中，具备访问本地文件、目录与部分富媒体内容的能力。现阶段已经明确的工具集合包括 `Read`、`Write`、`Edit`、`Glob`、`Grep` 与 `NotebookEdit` 六类能力。

本轮设计的目标不是直接实现工具，而是先形成一份可落盘、可扩展、可作为后续 implementation plan 输入的正式协议草案。文档需要同时解决两类问题：一是把工具边界、输入输出、错误模型和安全约束定义清楚；二是给出实现建议与分阶段落地路线，避免协议设计与工程实现脱节。

本轮还需要吸收一个已经确认的产品行为约束：模型侧遵循“先读后改”的行为规范和提示策略，但这一约束不作为工具层硬拦截规则固化。换句话说，协议层应鼓励模型先通过 `Read` 获取上下文，再调用 `Write`、`Edit` 或 `NotebookEdit` 执行修改；但如果工具层一律阻断未读先改，会削弱协议的通用性，也会妨碍受控场景中的自动化流程。

## 设计原则

### 一、工具边界稳定

本方案固定六个工具角色，不在本轮继续合并或拆分：

- `Read` 负责读取和解析文件内容，是统一读取入口。
- `Write` 负责创建或整体覆写文件内容。
- `Edit` 负责对文本文件执行精确字符串替换。
- `Glob` 负责按路径模式发现文件。
- `Grep` 负责按内容模式定位命中位置。
- `NotebookEdit` 负责对 notebook 执行语义化 cell 编辑。

边界稳定比短期参数简化更重要。只要职责划分清楚，客户端和服务端都更容易建立一致的心智模型。

### 二、统一外层协议，保留专用语义

推荐方案是保留六个独立工具，但统一外层协议与错误模型。这样可以在工具目录、鉴权、审计、错误处理和调用链路上形成一致体验，同时保留各自最适合的语义。`NotebookEdit` 不直接并入 `Edit`，原因在于 notebook 编辑对象不是单一线性文本，合并后会把 cell 边界、元数据与输出结构的特殊语义挤压进普通文本编辑协议，既不利于实现，也会降低调用清晰度。

### 三、读取优先，修改受约束但不硬拦截

工具层不强制“未读不可改”，但协议设计应明显支持“先读后改”的上层行为规范。实现上可以通过返回 `hash`、版本信息、审计字段和乐观并发控制参数，帮助客户端在读取后再修改时获得更高安全性。

### 四、统一错误模型与安全边界

所有工具必须共享同一套错误码体系、路径策略、大小限制与审计字段。用户看到的能力虽然分散在六个工具中，但系统内部对错误、越界、权限、截断、二进制探测和符号链接的处理规则应当一致。

### 五、协议先求稳，再逐步增强

首版协议优先定义稳定的最小闭环，先把工具职责、核心参数、返回信封与错误模型做扎实。复杂优化，例如批量事务、跨工具流水线提示、差异补丁格式或更丰富的多媒体抽取能力，可以在后续阶段增量引入。

## 推荐方案与备选方案

### 推荐方案：六工具并存，统一协议外壳

推荐方案保留 `Read`、`Write`、`Edit`、`Glob`、`Grep`、`NotebookEdit` 六个工具，并在以下方面统一：

- 统一请求中的路径模型、边界字段和可选审计字段。
- 统一响应中的成功信封、错误信封和元数据结构。
- 统一错误码与错误信息格式。
- 统一大小限制、符号链接策略、隐藏文件策略与越界判定规则。
- 统一服务端可观测性字段，例如 `request_id`、`duration_ms`、`resolver_policy` 和审计上下文。

这一方案兼顾清晰分工与工程一致性，适合本地桌面 Agent 的演进节奏。

### 备选方案一：将 `NotebookEdit` 合并进 `Edit`

这一方案可以减少工具数量，但不建议采用。主要问题有三点：

- notebook 的编辑对象天然是结构化文档，而不是单一文本缓冲区。
- notebook 往往需要按 cell、metadata、outputs 等维度操作，直接复用文本替换模型会很别扭。
- 后续若要支持批量 cell 操作、保留执行输出或结构校验，普通文本编辑协议会迅速膨胀。

因此，本轮明确不把 `NotebookEdit` 并入 `Edit`。

### 备选方案二：把 `Glob` 与 `Grep` 合并为统一搜索工具

这一方案表面上能减少 API 数量，但职责会变得含混。文件发现和内容定位虽然都属于“搜索”，却面向完全不同的索引对象、性能路径和结果结构。将二者分开，能够让调用方更清楚地表达意图，也更利于服务端独立优化缓存和限制策略。

### 备选方案三：为“先读后改”增加工具层硬校验

这一方案安全感更强，但并不适合作为当前协议的默认规则。工具层若要求“修改前必须存在成功读取记录”，会引入额外状态耦合，也会阻碍一些明确知道目标内容的自动修复流程。更稳妥的做法，是让上层提示与模型行为规范承担默认约束，让工具协议通过 `expected_hash`、审计字段和错误模型提供安全抓手。

## 统一协议模型

### 路径模型

所有工具统一接受字符串路径参数 `path`，并按照以下规则解释：

- `path` 可以是相对路径或绝对路径。
- 服务端必须解析为 `resolved_path`，并在响应中返回。
- 服务端必须在执行前完成规范化处理，包括路径分隔符标准化、点段消解与越界校验。
- 如果存在工作区根目录或授权根目录限制，服务端应在解析后判定是否越界，并在越界时返回 `path_out_of_bounds`。
- 默认应禁止通过符号链接绕过授权边界；如果允许跟随符号链接，必须在策略字段中显式声明，并保留审计记录。

建议所有工具共享如下路径相关元数据：

```json
{
  "path": "notes/todo.md",
  "resolved_path": "C:/Users/example/project/notes/todo.md",
  "path_kind": "relative",
  "root_policy": "workspace_or_user_fs",
  "symlink_policy": "deny_escape"
}
```

### 统一成功响应信封

建议全部工具在成功时返回统一外层信封：

```json
{
  "ok": true,
  "tool": "Read",
  "request_id": "req_123",
  "data": {},
  "metadata": {
    "duration_ms": 12,
    "audit": {
      "actor": "agent",
      "intent": "inspect_file"
    }
  }
}
```

其中 `data` 承载各工具自己的结果负载，`metadata` 承载统一审计和执行信息。`metadata` 建议允许扩展，但要保证核心字段命名稳定。

### 统一错误响应信封

建议全部工具在失败时返回统一错误信封：

```json
{
  "ok": false,
  "tool": "Edit",
  "request_id": "req_124",
  "error": {
    "code": "file_not_found",
    "message": "Target file does not exist.",
    "retryable": false,
    "details": {
      "path": "notes/todo.md",
      "resolved_path": "C:/Users/example/project/notes/todo.md"
    }
  },
  "metadata": {
    "duration_ms": 4
  }
}
```

错误模型中的 `code` 必须稳定，`message` 允许面向人类阅读，`details` 负责承载定位所需的结构化信息。

### 审计字段

所有工具建议支持可选审计字段，以便桌面宿主、日志系统或安全策略在不改变业务语义的情况下记录调用上下文。建议字段包括：

- `actor`：调用主体，例如 `agent`、`user`、`system`。
- `intent`：调用意图，例如 `read_context`、`refactor_file`、`find_matches`。
- `session_id`：会话标识。
- `trace_id`：链路标识。
- `reason`：简短的人类可读原因。

这些字段不应影响核心执行语义，但应进入日志与审计事件。

### 大小限制与二进制探测

所有工具应共享大小限制策略。建议至少定义三层：

- 单文件读取软上限，用于触发截断或分页。
- 单次请求硬上限，用于直接拒绝过大的输入或输出。
- 特定解析器上限，例如 PDF 页数上限、图片尺寸上限、notebook cell 数量上限。

二进制探测也应统一。服务端应先判断文件类型，再决定交给文本、图片、PDF、notebook 或 binary 适配器。无法安全读取或不支持当前读取方式时，应返回 `binary_unsupported`、`too_large` 或其他明确错误，而不是含混地返回空内容。

### 隐藏文件与符号链接策略

建议默认允许访问隐藏文件，但必须通过配置开关控制，并在审计中留下标记。原因很简单：桌面 Agent 场景中，配置文件、点文件和一些工具缓存目录本来就可能是有效目标。另一方面，符号链接更容易造成授权边界绕过，因此默认策略应当更严格，至少要防止链接目标跳出授权根目录。

## 各工具协议草案

## `Read`

### 角色定位

`Read` 是统一读取入口。不同文件类型通过解析器或适配器处理，包括文本、图片、PDF、Notebook 和 binary。调用方不需要先选择“文本读取”还是“PDF 读取”，而是由服务端探测类型后分派到合适的解析路径。

### 请求草案

```json
{
  "path": "docs/spec.md",
  "offset": 1,
  "limit": 2000,
  "include_metadata": true,
  "audit": {
    "actor": "agent",
    "intent": "read_context"
  }
}
```

建议核心字段如下：

- `path`：目标路径。
- `offset`：1-based 起始行号，仅对文本类读取生效。
- `limit`：最大读取行数，默认 `2000`。
- `include_metadata`：是否返回附加元数据。
- `parser_hint`：可选。调用方可提示期望解析器，但服务端不应盲从。

### 返回草案

`Read` 必须提供统一返回信封，建议 `data` 载荷至少包含以下字段：

```json
{
  "kind": "text",
  "path": "docs/spec.md",
  "resolved_path": "C:/Users/example/project/docs/spec.md",
  "encoding": "utf-8",
  "truncated": false,
  "next_offset": null,
  "content": {
    "text": "line 1\nline 2"
  },
  "metadata": {
    "line_start": 1,
    "line_count": 2,
    "hash": "sha256:abcd",
    "mime_type": "text/markdown"
  }
}
```

统一字段含义如下：

- `kind`：文件内容种类，例如 `text`、`image`、`pdf`、`notebook`、`binary`。
- `path`：调用方传入路径。
- `resolved_path`：服务端解析后的绝对路径。
- `encoding`：文本或可解码内容的编码；非文本可为 `null`。
- `truncated`：本次返回是否被服务端截断。
- `next_offset`：若发生分页或截断，给出下一次读取起点；文本语义下为下一行的 1-based 行号。
- `content`：类型相关载荷。
- `metadata`：文件统计信息、哈希、解析器信息、页数、尺寸等扩展信息。

### 文本读取规则

文本读取规则必须固定下来：

- `offset` 表示 1-based 起始行号。
- `limit` 表示最大读取行数，默认值为 `2000`。
- 服务端可以因为大小限制、解析器限制或输出上限提前截断。
- 发生截断时，必须返回 `truncated: true` 与可继续读取的 `next_offset`。
- 如果 `offset` 超出文件末尾，建议返回空文本并给出一致的元数据，而不是直接报错。

这一规则适合桌面 Agent 按片段读取长文件，也能与“先读后改”的上层策略自然衔接。

### 非文本适配建议

- 图片可返回结构化描述、尺寸、格式以及可选的 OCR 或视觉摘要字段。
- PDF 可返回分页文本、总页数、页范围元数据；页参数非法时返回 `invalid_pages`。
- Notebook 可返回 notebook 级元数据和 cell 列表摘要，必要时支持按 cell 分页。
- Binary 可只返回二进制类型、大小、哈希与是否可安全预览；不支持直接解码时返回 `binary_unsupported` 或给出受限摘要。

## `Write`

### 角色定位

`Write` 用于创建新文件或整体覆写已有文件。它不负责局部补丁，不承担模糊合并逻辑，也不试图替代 `Edit` 的精确替换场景。

### 请求草案

```json
{
  "path": "docs/spec.md",
  "content": "new file content",
  "encoding": "utf-8",
  "overwrite": true,
  "expected_hash": "sha256:abcd",
  "atomic": true,
  "audit": {
    "actor": "agent",
    "intent": "rewrite_file"
  }
}
```

建议核心字段如下：

- `path`：目标路径。
- `content`：完整内容。
- `encoding`：默认 `utf-8`。
- `overwrite`：是否允许覆写现有文件。
- `expected_hash`：可选。用于乐观并发控制，只有当现存内容哈希匹配时才允许写入。
- `atomic`：是否启用原子写，建议默认开启。
- `create_directories`：是否允许创建缺失目录，建议作为可选增强字段。

### 语义要求

`Write` 应支持安全覆写语义：

- 当目标文件存在且 `overwrite` 为 `false` 时，应返回明确错误。
- 当提供 `expected_hash` 且与当前文件不匹配时，应返回冲突类错误，而不是静默覆写。
- 当 `atomic` 为 `true` 时，服务端应使用临时文件加替换的方式尽量保证写入原子性。
- 成功写入后，建议返回新的内容哈希、文件大小和时间戳，供后续链路继续使用。

### 返回草案

```json
{
  "path": "docs/spec.md",
  "resolved_path": "C:/Users/example/project/docs/spec.md",
  "created": false,
  "bytes_written": 1234,
  "hash": "sha256:efgh",
  "atomic": true
}
```

## `Edit`

### 角色定位

`Edit` 保持“精确字符串替换”为主，不提供模糊 patch 语义，不默认做语法级重写。它适合高可预测性、低歧义的文本修改，尤其适合模型在已读上下文基础上执行局部编辑。

### 请求草案

```json
{
  "path": "docs/spec.md",
  "edits": [
    {
      "search": "old text",
      "replace": "new text",
      "replace_all": false,
      "expected_occurrences": 1
    }
  ],
  "expected_hash": "sha256:abcd",
  "encoding": "utf-8",
  "audit": {
    "actor": "agent",
    "intent": "apply_precise_edit"
  }
}
```

建议核心字段如下：

- `path`：目标文本文件。
- `edits[]`：一个或多个编辑操作。
- `search`：精确匹配字符串。
- `replace`：替换字符串。
- `replace_all`：是否替换全部命中。
- `expected_occurrences`：可选增强字段，用于声明预期命中数，帮助服务端在异常命中数时快速失败。
- `expected_hash`：可选。用于保证编辑基于已知版本执行。

### 语义要求

`Edit` 需要具备清晰的错误分类。至少要区分以下情况：

- 文件不存在。
- 文件不是可编辑文本。
- `search` 未命中。
- 命中次数与调用方预期不一致。
- 文件在编辑前已发生变化。
- 编辑后内容超出大小上限或编码失败。

如果一次请求包含多条编辑操作，建议采用顺序执行并在响应中返回逐项结果；是否提供“全部成功才提交”的事务模式，可作为后续增强项。

### 返回草案

```json
{
  "path": "docs/spec.md",
  "resolved_path": "C:/Users/example/project/docs/spec.md",
  "applied": true,
  "edit_results": [
    {
      "index": 0,
      "occurrences": 1,
      "replaced": 1
    }
  ],
  "hash": "sha256:wxyz"
}
```

## `Glob`

### 角色定位

`Glob` 只做文件发现，不做内容读取，不承担命中文本返回，也不隐式代替目录遍历 API。它的职责就是根据路径模式列出候选文件。

### 请求草案

```json
{
  "pattern": "docs/**/*.md",
  "base_path": ".",
  "include_hidden": false,
  "follow_symlinks": false,
  "max_results": 500,
  "audit": {
    "actor": "agent",
    "intent": "discover_files"
  }
}
```

建议核心字段如下：

- `pattern`：glob 模式。
- `base_path`：搜索起点。
- `include_hidden`：是否包含隐藏文件。
- `follow_symlinks`：是否跟随符号链接。
- `max_results`：最大返回条目数。
- `file_types`：可选。用于限制只看文件、目录或特定扩展名。

### 返回草案

```json
{
  "base_path": ".",
  "resolved_base_path": "C:/Users/example/project",
  "pattern": "docs/**/*.md",
  "matches": [
    {
      "path": "docs/spec.md",
      "resolved_path": "C:/Users/example/project/docs/spec.md",
      "kind": "file",
      "size": 1234
    }
  ],
  "truncated": false
}
```

### 边界要求

`Glob` 的协议文档必须明确写出职责边界：

- `Glob` 只回答“哪些路径匹配”。
- `Grep` 只回答“哪些内容命中”。
- 任何需要先找文件再找内容的流程，都应由上层组合调用，不应在单工具内混做。

## `Grep`

### 角色定位

`Grep` 只做内容定位。它负责在指定路径范围内用文本模式、字面量或正则表达式查找命中位置，但不负责文件内容全文返回。

### 请求草案

```json
{
  "pattern": "expected_hash",
  "base_path": "docs",
  "file_glob": "**/*.md",
  "is_regex": false,
  "case_sensitive": false,
  "context_lines": 2,
  "max_results": 200,
  "audit": {
    "actor": "agent",
    "intent": "locate_content"
  }
}
```

建议核心字段如下：

- `pattern`：待搜索模式。
- `base_path`：搜索根路径。
- `file_glob`：待搜索文件集合约束。
- `is_regex`：是否按正则解释。
- `case_sensitive`：是否区分大小写。
- `context_lines`：返回上下文行数。
- `max_results`：最大命中数。

### 返回草案

```json
{
  "base_path": "docs",
  "pattern": "expected_hash",
  "matches": [
    {
      "path": "docs/spec.md",
      "resolved_path": "C:/Users/example/project/docs/spec.md",
      "line": 42,
      "column": 9,
      "match_text": "expected_hash",
      "before": ["line 40", "line 41"],
      "after": ["line 43", "line 44"]
    }
  ],
  "truncated": false
}
```

### 边界要求

`Grep` 不应返回整文件内容，也不应默认承担目录发现。如果调用方未指定范围，服务端应使用明确的默认根路径和结果上限，避免在桌面宿主环境中无边界扫描整个磁盘。

## `NotebookEdit`

### 角色定位

`NotebookEdit` 面向 notebook 的语义化编辑，不使用普通文本替换来模拟 cell 操作。其核心价值在于按结构对象编辑，并在执行前后维持 notebook 的基本格式一致性。

### 请求草案

```json
{
  "path": "analysis/demo.ipynb",
  "operations": [
    {
      "op": "replace_cell_source",
      "cell_id": "cell-2",
      "source": "print('hello')\n"
    },
    {
      "op": "insert_cell",
      "index": 3,
      "cell_type": "markdown",
      "source": "## Notes\n"
    }
  ],
  "expected_hash": "sha256:abcd",
  "preserve_outputs": true,
  "audit": {
    "actor": "agent",
    "intent": "update_notebook"
  }
}
```

### 语义要求

`NotebookEdit` 建议支持 `operations[]` 批量操作，并至少覆盖以下基础能力：

- 按 `cell_id` 或索引替换 cell 内容。
- 插入 cell。
- 删除 cell。
- 移动 cell。
- 更新 notebook 或 cell 级 metadata。
- 选择是否保留 outputs 与 execution count。

服务端在执行前应先验证 notebook 结构。若 `operations[]` 中存在非法 cell 引用、越界索引或不兼容操作，应返回结构化错误，并尽量指出失败操作的位置。

### 返回草案

```json
{
  "path": "analysis/demo.ipynb",
  "resolved_path": "C:/Users/example/project/analysis/demo.ipynb",
  "applied": true,
  "operation_results": [
    {
      "index": 0,
      "op": "replace_cell_source",
      "status": "applied"
    },
    {
      "index": 1,
      "op": "insert_cell",
      "status": "applied"
    }
  ],
  "cell_count": 8,
  "hash": "sha256:zzzz"
}
```

## 错误模型与安全边界

### 统一错误码体系

所有工具共用一套错误码。首版建议至少覆盖以下错误：

- `file_not_found`：目标文件不存在。
- `permission_denied`：当前权限不足。
- `path_out_of_bounds`：解析后路径越出授权边界。
- `too_large`：文件、结果集或解析目标超出限制。
- `binary_unsupported`：二进制内容当前无法按请求方式处理。
- `invalid_pages`：PDF 页范围非法。
- `invalid_path`：路径语法无效。
- `invalid_pattern`：glob 或 grep 模式非法。
- `decode_failed`：文本解码失败。
- `encoding_unsupported`：指定编码不受支持。
- `hash_mismatch`：`expected_hash` 与当前文件不匹配。
- `search_text_not_found`：`Edit` 中的 `search` 未命中。
- `occurrence_mismatch`：命中次数与预期不一致。
- `notebook_invalid`：notebook 结构无效。
- `operation_conflict`：批量编辑内部存在冲突。
- `rate_limited`：请求频率受限。
- `internal_error`：服务端未分类异常。

错误码命名应尽量稳定、可复用、可被客户端程序分支处理。即便后续增加更多错误，也不应轻易重命名既有错误码。

### 路径与授权边界

服务端必须在真正访问文件前完成以下校验：

- 路径是否可解析。
- 解析结果是否位于授权根目录内。
- 是否命中隐藏文件、受限目录或系统关键路径策略。
- 符号链接目标是否越出边界。
- 请求动作是否与当前能力开关和权限级别相符。

本地桌面 Agent 虽然默认可访问本机文件系统，但这不代表协议可以忽略安全边界。协议层至少要让宿主具备配置空间，以便在不同部署模式下裁剪能力范围。

### 大小限制与资源保护

为避免桌面宿主被大文件、超深目录或高代价解析拖垮，建议加入以下资源保护机制：

- 对 `Read`、`Glob`、`Grep` 的返回总量设上限。
- 对 PDF 页数、图片像素、notebook cell 数量设解析上限。
- 对 `Grep` 和 `Glob` 设最大结果数、最大扫描文件数和最大执行时长。
- 对 `Write`、`Edit`、`NotebookEdit` 设写入大小与临时文件大小上限。

### 审计与状态记录

所有写操作工具和高成本读操作都应产生日志或审计事件，至少记录：

- 调用时间。
- 工具名。
- 解析后路径。
- 调用意图。
- 是否命中隐藏文件或符号链接。
- 文件类型与大小。
- 执行结果与错误码。

这些记录对桌面产品的可追溯性、问题定位和未来权限收紧都很关键。

## 实现建议

### 服务边界

建议把文件系统工具实现成“统一入口层 + 解析器层 + 执行器层 + 审计层”的结构：

- 统一入口层负责参数校验、路径解析、能力开关与错误信封封装。
- 解析器层负责类型探测以及文本、图片、PDF、notebook、binary 的读取适配。
- 执行器层负责 `Write`、`Edit`、`NotebookEdit` 等实际变更语义。
- 审计层负责日志、指标、风险标记与调用关联。

这种分层可以避免每个工具重复实现路径校验、错误转换和审计逻辑，也便于在桌面宿主与未来其他宿主之间复用核心能力。

### 解析器分层

`Read` 的设计已经决定它会成为统一入口，因此实现上应尽量把文件类型识别和解析逻辑做成独立适配器：

- 文本适配器负责编码探测、分页和行号语义。
- 图片适配器负责格式识别、基础元数据提取和可选视觉摘要。
- PDF 适配器负责页范围解析、文本抽取和页级元数据。
- Notebook 适配器负责 notebook 结构读取、cell 归一化和格式校验。
- Binary 适配器负责探测、摘要和受限返回。

这样做既符合统一 `Read` 入口的协议思路，也能让每类文件的限制和错误更清楚地落在自己的适配器上。

### 状态与并发控制

“先读后改”虽然不做工具层硬拦截，但实现上仍建议围绕哈希和版本建立安全闭环：

- `Read` 返回哈希。
- `Write`、`Edit`、`NotebookEdit` 可带 `expected_hash`。
- 文件已变更时返回 `hash_mismatch`。
- 审计层记录修改前后的哈希与调用来源。

这套机制足以支撑大多数乐观并发场景，也能为上层 Agent 提示提供可靠信号。

### 平台适配与兼容性

由于主要场景是本地桌面 Agent，路径处理要优先考虑跨平台兼容：

- Windows、macOS、Linux 的路径分隔符和大小写语义不同，规范化逻辑应统一收口。
- 隐藏文件判定在不同平台上存在差异，策略层应抽象，不要写死在单一平台判断中。
- 原子写的实现方式也可能依赖平台文件系统特性，接口要统一，底层实现允许分平台。

## 分阶段落地路线

### 第一阶段：统一协议骨架

第一阶段先建立统一的外层成功信封、错误信封、错误码体系、路径解析逻辑和审计字段约定。此阶段的核心产出不是完整功能，而是稳定的协议地基。建议优先打通 `Read` 文本模式、`Write` 基础写入、`Edit` 单次精确替换、`Glob` 基础发现和 `Grep` 基础文本搜索。

### 第二阶段：补齐 `Read` 多类型适配

第二阶段扩展 `Read` 的适配器体系，把图片、PDF、Notebook 和 binary 纳入统一入口，并为不同类型补齐元数据结构、分页或截断语义、大小限制与专用错误码。此阶段完成后，`Read` 才算真正成为统一读取入口。

### 第三阶段：增强写操作安全性与 notebook 语义编辑

第三阶段重点完善 `Write`、`Edit` 和 `NotebookEdit` 的安全写入语义，包括 `expected_hash`、原子写、批量操作结果、结构校验和更清楚的冲突错误。与此同时，`NotebookEdit` 正式支持 `operations[]`，形成与文本编辑并列的专用修改能力。

### 第四阶段：收紧安全策略与可观测性

第四阶段围绕产品化能力收口，包括隐藏文件策略、符号链接策略、宿主授权边界配置、审计报表、性能指标和高成本操作熔断。到这一阶段，协议本身基本稳定，重点转向工程治理与运行保障。

## 测试建议

### 协议一致性测试

需要为六个工具建立统一协议测试，覆盖成功信封、错误信封、`request_id`、`metadata`、错误码稳定性和路径解析结果。任何新工具行为都不应绕开统一错误模型。

### 路径与安全测试

需要重点覆盖以下场景：

- 相对路径、绝对路径、点段路径和非法路径。
- 越界访问。
- 隐藏文件访问。
- 符号链接跳转与越界。
- 权限不足和受限目录访问。

### 大文件与截断测试

需要验证：

- 文本 `offset` 为 1-based 行号时的读取行为。
- 默认 `limit=2000` 的表现。
- 截断时 `truncated` 与 `next_offset` 是否正确。
- `Glob`、`Grep` 和 `Read` 在超大结果集下能否稳定返回受限结果或明确错误。

### 写操作正确性测试

需要验证：

- `Write` 在 `overwrite` 开关下的创建与覆写语义。
- `expected_hash` 成功与失败路径。
- `Edit` 的单命中、多命中、零命中和 `replace_all` 语义。
- `expected_occurrences` 对错误分类的影响。
- 原子写失败时是否能保持目标文件不被部分破坏。

### Notebook 专项测试

需要验证：

- notebook 结构读取与结构错误识别。
- `operations[]` 顺序执行与结果返回。
- cell 索引越界、`cell_id` 不存在和 metadata 更新冲突。
- 保留 outputs 与清理 outputs 两种路径的行为差异。

## 未决问题

1. `Read` 对图片和 binary 的 `content` 形态是否需要强制统一为结构化对象，而不是允许解析器自由扩展，仍需进一步收敛。
2. `Read` 是否需要在首版就支持按 PDF 页范围读取，还是先只返回全文摘取结果，仍需结合实际调用场景判断。
3. `Edit` 的多操作请求是否要提供“全部成功才提交”的事务语义，当前建议延后，但后续实现计划中需要单独评估。
4. `Glob` 与 `Grep` 是否需要共享底层遍历缓存以降低重复扫描成本，属于实现优化问题，协议层暂不固化。
5. `NotebookEdit` 是否需要在首版就支持输出清理、执行计数重排和 cell id 自动生成策略，仍需结合目标 notebook 生态确认。
6. 宿主是否需要暴露更细粒度的授权根目录配置，例如按工作区、按用户目录或按临时授权目录划分，当前协议已经预留边界，但产品策略尚未最终定稿。

## 结论

本草案明确采用“六工具并存、统一协议外壳”的方案：`Read` 作为统一读取入口，通过解析器或适配器覆盖文本、图片、PDF、Notebook 和 binary；`Write`、`Edit` 和 `NotebookEdit` 各自保留清晰的修改语义；`Glob` 与 `Grep` 明确分工，分别承担文件发现与内容定位。协议层不把“先读后改”做成硬拦截，但通过统一返回信封、`expected_hash`、原子写、统一错误码、路径模型和审计字段，把这项行为规范转化为更稳妥的工程约束。该草案已经具备进入后续 implementation plan 的基础。
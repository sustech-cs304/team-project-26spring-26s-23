# campus_info 输出契约（可观测）

本页定义 campus_info（校园官方文档检索）在 runtime 事件流中的结构化输出字段约定。

## 工具目录（tools[]）

当工具目录可用时，catalog 里会出现以下工具条目：

- `toolId`: `tool.campus-info.search`
- `kind`: `builtin`
- `displayName`: `Campus Info Search`
- `description`: Search indexed campus official documents and return cited snippets.

## tool_event.payload.data（结构化结果）

当启用 `tool.campus-info.search` 且工具执行完成后，`tool_event` 的 `phase=completed` 事件会在 `payload.data` 中携带结构化结果。

### data 总结构

```json
{
  "kind": "campus_info.search_result",
  "query": "请假",
  "topK": 15,
  "maxPerDoc": 5,
  "contextChars": 80,
  "includeContent": false,
  "cacheDir": "E:/.../backend/data/campus_docs",
  "dbPath": "E:/.../backend/data/campus_docs/index.sqlite",
  "hitCount": 3,
  "hits": []
}
```

### hits[] 字段

```json
{
  "score": -2.3,
  "sourceId": "osa_doc_xxx",
  "title": "南方科技大学本科生请假制度 更新时间: 2023-11-06",
  "url": "https://...",
  "chunkIndexStart": 12,
  "chunkIndexEnd": 15,
  "pages": [1, 2],
  "sectionPath": ["第一章 总则", "第二条 ..."],
  "snippet": "…围绕命中词截取的预览…",
  "content": null
}
```

- `sectionPath`：若该文档已生成章节树且可匹配，则为字符串数组；否则为 `null`。
- `snippet`：默认返回“命中上下文预览”，用于 UI/LLM 最小证据输入。
- `content`：默认 `null`；仅当 `includeContent=true` 时返回完整（合并后的）文本内容。

## 错误返回（工具结果内）

当工具执行无法得到结果时，仍可能返回 `phase=completed`，但 `payload.data` 会是一个仅包含 `error` 的对象：

```json
{
  "error": {
    "code": "index_not_found",
    "message": "SQLite index not found. Run build_index first.",
    "dbPath": "E:/.../index.sqlite"
  }
}
```

目前稳定错误码：
- `invalid_query`
- `index_not_found`

## run_completed（最终回答 + 引用）

当本轮 run 调用了 `tool.campus-info.search` 并成功返回结构化结果后，终态事件 `run_completed.payload` 会额外携带：

- `answer`: string（当前与 `assistantText` 一致）
- `citations`: Citation[]（引用列表，字段与 hits 对齐但只包含最小证据）

Citation 字段：

```json
{
  "sourceId": "osa_doc_xxx",
  "title": "…",
  "url": "https://…",
  "pages": [1, 2],
  "sectionPath": ["第一章 总则", "第二条 …"],
  "snippet": "…",
  "chunkIndexStart": 12,
  "chunkIndexEnd": 15
}
```

"""Prompt for tool.fs.grep — content search across workspace files."""

from __future__ import annotations

from .._base import DEFAULT_MAX_GREP_RESULTS, ToolPrompt

FILE_TOOL_GREP_PROMPT = ToolPrompt(
    tool_id="tool.fs.grep",
    description=(
        "Searches file contents across the workspace using literal text or regex "
        "patterns. Built on ripgrep for fast, accurate results. Supports full regex "
        "syntax, file filtering, and multiple output modes."
    ),
    usage_guide=(
        "Use this tool when you need to:\n"
        "- Find where a function, class, or variable is defined or used\n"
        "- Search for TODO comments, error messages, or specific patterns\n"
        "- Locate all instances of a pattern across the codebase\n"
        "- Discover which files reference a particular module or import\n"
        "\n"
        "Do NOT use this tool when:\n"
        "- Finding files by name — use tool.fs.glob instead\n"
        "- Reading full file contents — use tool.fs.read instead\n"
        "- You can find the answer faster by reading a known file directly"
    ),
    parameter_guide=(
        "pattern (required): The search pattern — literal text or regex (see isRegex).\n"
        "basePath (optional): Starting directory. Default: '.' (workspace root).\n"
        "fileGlob (optional): Filter which files to search, e.g., '*.py', '**/*.ts'. "
        "Default: '**/*' (all files).\n"
        "isRegex (optional): Treat pattern as regex. Default: false (literal search). "
        "When true, supports full regex syntax like 'function\\s+\\w+', 'log.*Error'.\n"
        "caseSensitive (optional): Case-sensitive search. Default: false.\n"
        "contextLines (optional): Number of surrounding lines to include. Default: 0.\n"
        "includeHidden (optional): Search hidden files. Default: false.\n"
        f"maxResults (optional): Maximum results. Default: {DEFAULT_MAX_GREP_RESULTS}.\n"
        "\n"
        "Pattern syntax notes:\n"
        "- Uses ripgrep syntax, not GNU grep\n"
        "- Literal braces need escaping: use 'interface\\{\\}' to find 'interface{}' in Go code\n"
        "- By default, patterns match within single lines only\n"
        "- For cross-line patterns like 'struct \\{[\\s\\S]*?field', set isRegex: true for "
        "multi-line matching"
    ),
    constraints=(
        f"- Maximum {DEFAULT_MAX_GREP_RESULTS} results per call; narrow search if truncated\n"
        "- By default, searches are case-insensitive and literal (not regex)\n"
        "- Hidden files and directories are excluded by default\n"
        "- Use fileGlob to limit search scope and get faster, more focused results"
    ),
    relationships=(
        "Tool preference hierarchy:\n"
        "- ALWAYS use this tool for content search — NEVER use shell grep/rg\n"
        "- Use tool.fs.glob first to discover file patterns, then use this tool "
        "with fileGlob to search within those patterns\n"
        "- After finding matches, use tool.fs.read to read the full files\n"
        "\n"
        "Typical workflow:\n"
        "1. tool.fs.glob → discover relevant file paths\n"
        "2. tool.fs.grep → search within discovered files\n"
        "3. tool.fs.read → read the most relevant files in full"
    ),
    examples=(
        "Search for a function definition (literal):\n"
        '  {"pattern": "def calculate_total", "fileGlob": "*.py"}\n'
        "\n"
        "Regex search for function handlers:\n"
        '  {"pattern": "function\\\\s+handle\\\\w+", "isRegex": true, "fileGlob": "*.ts"}\n'
        "\n"
        "Search with context lines:\n"
        '  {"pattern": "TODO", "fileGlob": "*.py", "contextLines": 2}\n'
        "\n"
        "Case-sensitive search in specific directory:\n"
        '  {"pattern": "API_KEY", "caseSensitive": true, "basePath": "src", '
        '"fileGlob": "*.ts"}'
    ),
    annotations={
        "stage": "phase1-grep",
        "idempotent": True,
        "descriptionZh": (
            "基于 ripgrep 在工作区文件中搜索文本内容。支持字面量和正则表达式搜索，"
            "可通过 fileGlob 过滤文件范围。默认大小写不敏感、字面量匹配。"
            "找到匹配后使用 tool.fs.read 读取完整文件。"
        ),
    },
)

__all__ = ["FILE_TOOL_GREP_PROMPT"]

"""Prompt for tool.fs.glob — file pattern matching and discovery."""

from __future__ import annotations

from .._base import DEFAULT_MAX_GLOB_RESULTS, ToolPrompt

FILE_TOOL_GLOB_PROMPT = ToolPrompt(
    tool_id="tool.fs.glob",
    description=(
        "Finds files and directories in the workspace by glob pattern matching. "
        "Returns matching file paths sorted by modification time. Works with any "
        "codebase size."
    ),
    usage_guide=(
        "Use this tool when you need to:\n"
        "- Discover what files exist in a project or directory\n"
        "- Find files matching a name pattern (e.g., '*.py', 'test_*.ts', '**/*.css')\n"
        "- Explore project structure before reading specific files\n"
        "- Locate configuration files, test files, or specific file types\n"
        "\n"
        "Do NOT use this tool when:\n"
        "- Searching file contents — use tool.fs.grep instead\n"
        "- You already know the exact file path — read it directly with tool.fs.read\n"
        "- Reading file contents — this tool only returns paths, not content"
    ),
    parameter_guide=(
        "pattern (required): Glob pattern to match. Supports standard glob syntax:\n"
        "  - '**/*.py' — all Python files recursively\n"
        "  - 'src/**/*.ts' — all TypeScript files under src/\n"
        "  - '*.json' — JSON files in root only\n"
        "  - 'test/**/test_*.py' — test files in test/ subdirectories\n"
        "basePath (optional): Starting directory. Default: '.' (workspace root).\n"
        "includeHidden (optional): Include hidden files (starting with .). Default: false.\n"
        f"maxResults (optional): Maximum results. Default: {DEFAULT_MAX_GLOB_RESULTS}."
    ),
    constraints=(
        "- Returns file paths only — no file contents\n"
        "- Results are sorted by modification time (most recent first)\n"
        "- Hidden files (starting with .) are excluded by default\n"
        f"- Maximum {DEFAULT_MAX_GLOB_RESULTS} results per call; narrow your pattern if you need more"
    ),
    relationships=(
        "Tool workflow:\n"
        "- Use this tool FIRST to discover files, then use tool.fs.read to read them\n"
        "- Use this tool for filename searches; use tool.fs.grep for content searches\n"
        "- Use tool.fs.glob (NOT shell find / ls) for file discovery\n"
        "\n"
        "Typical workflow:\n"
        "1. tool.fs.glob → discover relevant files\n"
        "2. tool.fs.grep → search within discovered files for specific patterns\n"
        "3. tool.fs.read → read the most relevant files"
    ),
    examples=(
        "Find all Python files:\n"
        '  {"pattern": "**/*.py"}\n'
        "\n"
        "Find test files in a specific directory:\n"
        '  {"pattern": "**/test_*.py", "basePath": "tests"}\n'
        "\n"
        "Find TypeScript source files:\n"
        '  {"pattern": "src/**/*.ts"}\n'
        "\n"
        "Find configuration files in root:\n"
        '  {"pattern": "*.{json,yaml,toml,cfg}"}'
    ),
    annotations={
        "stage": "phase1-glob",
        "idempotent": True,
        "descriptionZh": (
            "通过 glob 模式在工作区中查找匹配的文件和目录。返回按修改时间排序的文件路径列表。"
            "用于发现项目结构和定位特定类型的文件。不返回文件内容——找到文件后请使用 "
            "tool.fs.read 读取。"
        ),
    },
)

__all__ = ["FILE_TOOL_GLOB_PROMPT"]

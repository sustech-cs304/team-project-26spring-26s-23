"""Prompt for tool.fs.read — workspace file reading with multi-format support."""

from __future__ import annotations

from .._base import DEFAULT_MAX_READ_LINES, ToolPrompt

FILE_TOOL_READ_PROMPT = ToolPrompt(
    tool_id="tool.fs.read",
    description=(
        "Reads a file from the workspace. Supports UTF-8 text files, images "
        "(PNG, JPG, GIF, WebP), PDF documents, and Jupyter notebooks (.ipynb). "
        "You can access any workspace file directly by using this tool."
    ),
    usage_guide=(
        "Use this tool when you need to:\n"
        "- Inspect file contents before editing or writing\n"
        "- Understand existing code, configuration, or documentation\n"
        "- Read screenshots or images provided by the user (ALWAYS use this tool for image paths)\n"
        "- Read PDF documents (with page range parameter for large PDFs)\n"
        "- Read Jupyter notebook cells with their outputs\n"
        "\n"
        "Do NOT use this tool to:\n"
        "- List directory contents — use tool.fs.glob instead\n"
        "- Search file contents for patterns — use tool.fs.grep instead\n"
        "- Read files outside the workspace — this tool only accesses workspace files"
    ),
    parameter_guide=(
        "path (required): Absolute path within the workspace to the file.\n"
        f"offset (optional): 1-based line number to start reading from. Default: 1.\n"
        f"limit (optional): Maximum lines to return. Default: {DEFAULT_MAX_READ_LINES}. "
        "Use for large files.\n"
        "includeMetadata (optional): Include file metadata in results. Default: true.\n"
        "parserHint (optional): Hint for file type parsing (e.g., 'pdf', 'notebook').\n"
        "pages (optional): For PDF files — array of [startPage, endPage] (1-based). "
        "REQUIRED for PDFs with more than 10 pages; maximum 20 pages per request."
    ),
    constraints=(
        "- Only reads files, not directories. To list a directory, use tool.fs.glob.\n"
        f"- By default, reads up to {DEFAULT_MAX_READ_LINES} lines starting from the beginning.\n"
        "- Results are returned with line numbers (1-based).\n"
        "- Reading a file that doesn't exist returns an error — this is safe to attempt.\n"
        "- Reading an empty file returns a system reminder warning instead of file contents.\n"
        "- PDF files over 10 pages REQUIRE the 'pages' parameter; reading without it will fail.\n"
        "- Maximum 20 PDF pages per request."
    ),
    relationships=(
        "Prefer this tool over shell commands:\n"
        "- Use tool.fs.read (NOT cat/head/tail) for reading file contents\n"
        "\n"
        "Workflow guidance:\n"
        "- Use tool.fs.glob first to discover file paths, then use this tool to read them\n"
        "- Use tool.fs.grep first to locate relevant code, then use this tool to read the full files\n"
        "- Before editing a file (tool.fs.edit) or overwriting it (tool.fs.write), you MUST "
        "read it first with this tool"
    ),
    examples=(
        "Read entire file:\n"
        '  {"path": "src/main.py"}\n'
        "\n"
        "Read with offset and limit:\n"
        '  {"path": "src/large_file.py", "offset": 100, "limit": 50}\n'
        "\n"
        "Read PDF pages:\n"
        '  {"path": "docs/report.pdf", "pages": [1, 5]}\n'
        "\n"
        "Read a user-provided screenshot:\n"
        '  {"path": "/tmp/screenshot.png"}'
    ),
    annotations={
        "stage": "phase1-read",
        "idempotent": True,
        "descriptionZh": (
            "读取工作区内的文件内容。支持 UTF-8 文本、常见图片格式(PNG/JPG等)、"
            "PDF 文档和 Jupyter 笔记本(.ipynb)。默认最多读取 2000 行，大文件请使用 "
            "offset/limit 参数分页读取。PDF 超过 10 页时必须指定 pages 参数。"
        ),
    },
)

__all__ = ["FILE_TOOL_READ_PROMPT"]

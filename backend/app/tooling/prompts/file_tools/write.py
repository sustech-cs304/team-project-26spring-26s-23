"""Prompt for tool.fs.write — create or overwrite workspace files."""

from __future__ import annotations

from .read import FILE_TOOL_READ_PROMPT
from .._base import ToolPrompt

_READ_TOOL_NAME = FILE_TOOL_READ_PROMPT.tool_id

FILE_TOOL_WRITE_PROMPT = ToolPrompt(
    tool_id="tool.fs.write",
    description=(
        "Creates a new file or completely overwrites an existing file in the workspace. "
        "For partial modifications to existing files, prefer tool.fs.edit instead."
    ),
    usage_guide=(
        "Use this tool when:\n"
        "- Creating a brand new file from scratch\n"
        "- The user explicitly asks you to write a new file\n"
        "- Generating output files, configuration files, or new source modules\n"
        "- You need to replace the ENTIRE contents of a file (rare)\n"
        "\n"
        "Do NOT use this tool when:\n"
        "- Making partial updates to an existing file — use tool.fs.edit instead\n"
        "- The file already exists and you haven't read it first\n"
        "- Creating README or .md documentation files unless explicitly requested by the user"
    ),
    parameter_guide=(
        "path (required): Absolute path to the file within the workspace.\n"
        "content (required): The complete file contents as a string.\n"
        "encoding (optional): File encoding. Default: 'utf-8'. Only 'utf-8' is supported.\n"
        "overwrite (optional): Whether to overwrite if file exists. Default: true.\n"
        "expectedHash (optional): Hash of expected current file content for safe overwrites.\n"
        "atomic (optional): Use atomic write semantics. Default: true."
    ),
    constraints=(
        f"- CRITICAL: If the file already exists, you MUST use {_READ_TOOL_NAME} first to read "
        "its contents. This tool will fail if you attempt to overwrite without reading first.\n"
        "- This tool replaces the ENTIRE file. For partial modifications, use tool.fs.edit.\n"
        "- NEVER create documentation files (*.md) or README files unless explicitly requested.\n"
        "- Only use emojis in file content if the user explicitly requests it.\n"
        "- The file path must be within the workspace."
    ),
    relationships=(
        "Tool preference hierarchy:\n"
        f"- For partial modifications: prefer tool.fs.edit (NOT this tool)\n"
        f"- For new files: use this tool\n"
        f"- Before overwriting: ALWAYS use {_READ_TOOL_NAME} first to verify contents\n"
        "\n"
        "Do NOT use shell commands:\n"
        "- Use this tool (NOT echo/cat with redirect) for writing files"
    ),
    examples=(
        "Create a new file:\n"
        '  {"path": "src/new_module.py", "content": "def hello():\\n    return \'world\'\\n"}\n'
        "\n"
        "Overwrite an existing file (after reading it first):\n"
        '  {"path": "config.json", "content": "{\\"version\\": \\"2.0\\"}", '
        '"expectedHash": "abc123..."}'
    ),
    annotations={
        "stage": "phase2-write",
        "idempotent": False,
        "descriptionZh": (
            "创建新文件或完整覆盖已有文件。仅用于创建全新文件或完全替换文件内容；"
            "对已有文件的部分修改请使用 tool.fs.edit。覆盖已有文件前必须先使用 "
            "tool.fs.read 读取文件内容。"
        ),
    },
)

__all__ = ["FILE_TOOL_WRITE_PROMPT"]

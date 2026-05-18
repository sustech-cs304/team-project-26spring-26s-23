"""Prompt for tool.fs.switch_root — change the default workspace root for file tools."""

from __future__ import annotations

from .._base import ToolPrompt

FILE_TOOL_SWITCH_ROOT_PROMPT = ToolPrompt(
    tool_id="tool.fs.switch_root",
    description=(
        "Validates and switches the default root directory for subsequent file tool "
        "operations (read, write, edit, glob, grep). All relative paths in later tool "
        "calls will be resolved against the new root."
    ),
    usage_guide=(
        "Use this tool when:\n"
        "- You need to operate on files in a different project directory\n"
        "- The user asks you to work in a specific subdirectory\n"
        "- You need to switch context between multiple projects\n"
        "\n"
        "Do NOT use this tool:\n"
        "- For one-off file reads — just use absolute paths instead\n"
        "- If you're unsure the path exists (validation will fail)"
    ),
    parameter_guide=(
        "path (required): Path to the new root directory. Must exist and be a directory.\n"
        "Can be absolute or relative to the current workspace root."
    ),
    constraints=(
        "- The target path must exist and be a directory\n"
        "- Switching root only affects subsequent tool calls\n"
        "- Previous root is returned in the result for reference"
    ),
    relationships=(
        "This tool is a configuration operation — it doesn't read or write files itself.\n"
        "After switching root, all file tools (read/write/edit/glob/grep) will use "
        "the new root for resolving relative paths."
    ),
    examples=(
        "Switch to a different project:\n"
        '  {"path": "../other-project"}\n'
        "\n"
        "Switch to a subdirectory:\n"
        '  {"path": "src/frontend"}'
    ),
    annotations={
        "stage": "phase1-switch-root",
        "idempotent": True,
        "descriptionZh": (
            "切换后续文件工具操作的默认根目录。切换后，read/write/edit/glob/grep 等工具"
            "将以新根目录为基准解析相对路径。目标路径必须存在且为目录。"
        ),
    },
)

__all__ = ["FILE_TOOL_SWITCH_ROOT_PROMPT"]

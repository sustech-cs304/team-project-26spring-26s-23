"""Prompt for tool.fs.edit — exact string replacement in workspace files."""

from __future__ import annotations

from .read import FILE_TOOL_READ_PROMPT
from .._base import ToolPrompt

_READ_TOOL_NAME = FILE_TOOL_READ_PROMPT.tool_id

FILE_TOOL_EDIT_PROMPT = ToolPrompt(
    tool_id="tool.fs.edit",
    description=(
        "Performs exact string replacements in an existing file. Only the changed "
        "parts are sent — not the entire file. This is the preferred tool for "
        "modifying existing files."
    ),
    usage_guide=(
        "Use this tool when:\n"
        "- Adding, removing, or modifying code in an existing file\n"
        "- Renaming a variable, function, or string across a file (use replaceAll)\n"
        "- Applying targeted patches or fixes\n"
        "- Inserting new code blocks into an existing file\n"
        "\n"
        "Do NOT use this tool when:\n"
        "- Creating a brand new file — use tool.fs.write instead\n"
        "- The file doesn't exist yet\n"
        "- You haven't read the file first"
    ),
    parameter_guide=(
        "path (required): Absolute path to the file within the workspace.\n"
        "oldString (required): The exact text to find and replace. Must be unique in the file "
        "unless using replaceAll. Use the smallest clearly-unique string (2-4 adjacent lines "
        "is usually sufficient).\n"
        "newString (required): The replacement text. Use empty string to delete.\n"
        "replaceAll (optional): Replace ALL occurrences. Use for variable/function renaming. "
        "Default: false.\n"
        "expectedOccurrences (optional): Expected number of matches for validation.\n"
        "expectedHash (optional): Hash of expected file state before edit."
    ),
    constraints=(
        f"- CRITICAL: You MUST use {_READ_TOOL_NAME} at least once in the conversation before "
        "editing. This tool will error if you attempt an edit without reading the file first.\n"
        "- When copying text from Read tool output, preserve EXACT indentation (tabs/spaces) "
        "as it appears AFTER the line number prefix. The line number prefix format is "
        "spaces + line number + arrow — everything after that is the actual file content.\n"
        "- Never include any part of the line number prefix in oldString or newString.\n"
        "- The edit will FAIL if oldString is not unique in the file. Either provide a larger "
        "string with more surrounding context, or use replaceAll to change every instance.\n"
        "- Use the smallest oldString that's clearly unique — 2-4 adjacent lines is usually "
        "sufficient. Avoid including 10+ lines of context when less uniquely identifies the target.\n"
        "- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless "
        "explicitly required.\n"
        "- Only use emojis in edits if the user explicitly requests it."
    ),
    relationships=(
        "Tool preference hierarchy:\n"
        f"- ALWAYS use this tool (NOT tool.fs.write) for modifying existing files\n"
        f"- Before editing: ALWAYS use {_READ_TOOL_NAME} first to read the file\n"
        "- This tool is preferred over tool.fs.write for any partial file modification\n"
        "- Use replaceAll for renaming variables or strings across the entire file\n"
        "\n"
        "Do NOT use shell commands:\n"
        "- Use tool.fs.edit (NOT sed/awk) for editing files"
    ),
    examples=(
        "Replace a function definition:\n"
        '  {"path": "src/main.py", "oldString": "def old_name():", '
        '"newString": "def new_name():"}\n'
        "\n"
        "Rename a variable across the file:\n"
        '  {"path": "src/module.py", "oldString": "oldVar", '
        '"newString": "newVar", "replaceAll": true}\n'
        "\n"
        "Delete a code block:\n"
        '  {"path": "src/main.py", "oldString": "# TODO: remove this block\\n'
        'deprecated_function()\\n# end remove", "newString": ""}'
    ),
    annotations={
        "stage": "phase2-edit",
        "idempotent": False,
        "descriptionZh": (
            "对已有文件执行精确的字符串替换编辑。仅传输变更部分而非整个文件，"
            "是修改已有文件的首选工具。oldString 必须在文件中唯一（除非使用 "
            "replaceAll），建议使用 2-4 行即可唯一定位目标。编辑前必须先使用 "
            "tool.fs.read 读取文件。"
        ),
    },
)

__all__ = ["FILE_TOOL_EDIT_PROMPT"]

"""File tool prompt registry with inter-tool relationship matrix.

Mirrors Claude Code's tool preference pattern: for each file operation,
explicitly tells the model which dedicated tool to use instead of shell
commands.
"""

from __future__ import annotations

from .edit import FILE_TOOL_EDIT_PROMPT
from .glob import FILE_TOOL_GLOB_PROMPT
from .grep import FILE_TOOL_GREP_PROMPT
from .notebook_edit import FILE_TOOL_NOTEBOOK_EDIT_PROMPT
from .read import FILE_TOOL_READ_PROMPT
from .switch_root import FILE_TOOL_SWITCH_ROOT_PROMPT
from .write import FILE_TOOL_WRITE_PROMPT

FILE_TOOL_PROMPTS: tuple = (
    FILE_TOOL_READ_PROMPT,
    FILE_TOOL_WRITE_PROMPT,
    FILE_TOOL_EDIT_PROMPT,
    FILE_TOOL_GLOB_PROMPT,
    FILE_TOOL_GREP_PROMPT,
    FILE_TOOL_NOTEBOOK_EDIT_PROMPT,
    FILE_TOOL_SWITCH_ROOT_PROMPT,
)

# ---------------------------------------------------------------------------
# Inter-tool relationship matrix — injected into system prompt
# ---------------------------------------------------------------------------

FILE_TOOL_PREFERENCE_GUIDE = """\
## File Operation Tool Selection

For every file operation, use the dedicated tool — NOT shell commands. The
dedicated tools provide a much better experience: proper permissions, correct
access, and easier review of tool calls.

| Operation | Use This Tool | NOT These Shell Commands |
|-----------|--------------|--------------------------|
| File name search | {glob} | find, ls, dir |
| Content search | {grep} | grep, rg, ag |
| Read files | {read} | cat, head, tail, less |
| Edit files | {edit} | sed, awk, perl |
| Write files | {write} | echo >, cat <<EOF, tee |
| Notebook edit | {notebook_edit} | jq, sed on .ipynb |

## File Tool Workflow

1. **Discover**: Use `{glob}` to find relevant files by name
2. **Search**: Use `{grep}` to locate specific content within files
3. **Read**: Use `{read}` to inspect file contents — ALWAYS read before editing
4. **Edit**: Use `{edit}` for partial modifications (NOT `{write}`)
5. **Write**: Use `{write}` only for creating NEW files or complete rewrites

## Critical Rules

- **Read before Edit/Write**: ALWAYS use `{read}` first when modifying existing files
- **Edit for partial changes**: Use `{edit}` for any modification to existing files
- **Write for new files only**: Use `{write}` for creating files from scratch
- **oldString uniqueness**: In `{edit}`, oldString must be unique in the file;
  use the smallest clearly-unique string (2-4 lines)
- **replaceAll for renames**: Use replaceAll in `{edit}` for variable/function renames
- **Never create .md files**: Don't create README or documentation files unless
  explicitly requested
""".format(
    glob=FILE_TOOL_GLOB_PROMPT.tool_id,
    grep=FILE_TOOL_GREP_PROMPT.tool_id,
    read=FILE_TOOL_READ_PROMPT.tool_id,
    edit=FILE_TOOL_EDIT_PROMPT.tool_id,
    write=FILE_TOOL_WRITE_PROMPT.tool_id,
    notebook_edit=FILE_TOOL_NOTEBOOK_EDIT_PROMPT.tool_id,
)


__all__ = [
    "FILE_TOOL_EDIT_PROMPT",
    "FILE_TOOL_GLOB_PROMPT",
    "FILE_TOOL_GREP_PROMPT",
    "FILE_TOOL_NOTEBOOK_EDIT_PROMPT",
    "FILE_TOOL_PREFERENCE_GUIDE",
    "FILE_TOOL_PROMPTS",
    "FILE_TOOL_READ_PROMPT",
    "FILE_TOOL_SWITCH_ROOT_PROMPT",
    "FILE_TOOL_WRITE_PROMPT",
]

"""Prompt for tool.fs.notebook_edit — transactional Jupyter notebook cell editing."""

from __future__ import annotations

from .._base import ToolPrompt

FILE_TOOL_NOTEBOOK_EDIT_PROMPT = ToolPrompt(
    tool_id="tool.fs.notebook_edit",
    description=(
        "Edits Jupyter notebook (.ipynb) files with transactional cell operations. "
        "Supports replacing, inserting, and deleting cells using cell IDs."
    ),
    usage_guide=(
        "Use this tool when you need to:\n"
        "- Modify code or markdown cells in an existing Jupyter notebook\n"
        "- Insert new cells at specific positions in a notebook\n"
        "- Delete cells from a notebook\n"
        "\n"
        "Do NOT use this tool when:\n"
        "- Reading notebook contents — use tool.fs.read (which supports .ipynb files)\n"
        "- Creating a new notebook from scratch — use tool.fs.write\n"
        "- The notebook hasn't been read yet"
    ),
    parameter_guide=(
        "path (required): Absolute path to the .ipynb file.\n"
        "operations (required): Array of cell operations, each with:\n"
        "  - kind: 'replace', 'insert', or 'delete'\n"
        "  - cellId: Target cell ID (required for 'replace' and 'delete')\n"
        "  - source: New cell source code (required for 'replace' and 'insert')\n"
        "  - afterCellId: Insert position reference (for 'insert')\n"
        "  - cellType: 'code', 'markdown', or 'raw' (for 'insert')\n"
        "expectedHash (optional): Hash of expected notebook state before edit."
    ),
    constraints=(
        "- All operations in a single call are applied atomically — either all succeed or none do\n"
        "- Cell IDs are obtained by reading the notebook first with tool.fs.read\n"
        "- The .ipynb file must exist and be a valid Jupyter notebook"
    ),
    relationships=(
        "Workflow:\n"
        "- Use tool.fs.read to read the notebook and identify cell IDs\n"
        "- Use this tool to make changes\n"
        "- For plain text/code files, use tool.fs.edit instead"
    ),
    examples=(
        "Replace a code cell:\n"
        '  {"path": "notebooks/analysis.ipynb", "operations": ['
        '{"kind": "replace", "cellId": "cell-0", "source": "import pandas as pd\\\\n'
        'import numpy as np"}]}\n'
        "\n"
        "Insert a new markdown cell:\n"
        '  {"path": "notebooks/analysis.ipynb", "operations": ['
        '{"kind": "insert", "afterCellId": "cell-2", "cellType": "markdown", '
        '"source": "## New Section"}]}'
    ),
    annotations={
        "stage": "phase3-notebook-edit",
        "idempotent": False,
        "descriptionZh": (
            "以事务方式编辑 Jupyter 笔记本(.ipynb)的单元格。支持替换、插入和删除操作。"
            "所有操作在同一调用中原子执行。操作前需先使用 tool.fs.read 读取笔记本"
            "以获取 cellId。"
        ),
    },
)

__all__ = ["FILE_TOOL_NOTEBOOK_EDIT_PROMPT"]

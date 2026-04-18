from __future__ import annotations

import asyncio
import random
from pathlib import Path

import pytest

from app.copilot_runtime import (
    ToolDescriptor,
    ToolRegistry,
    ToolsetDescriptor,
    build_default_tool_registry,
)
from app.copilot_runtime.tool_registry import (
    DEFAULT_WEATHER_LOCATION,
    FILE_CONVERT_TOOL_DESCRIPTION,
    FILE_CONVERT_TOOL_DISPLAY_NAME,
    FILE_CONVERT_TOOL_ID,
    FILE_TOOL_GLOB_DESCRIPTION,
    FILE_TOOL_GLOB_DISPLAY_NAME,
    FILE_TOOL_GLOB_ID,
    FILE_TOOL_GREP_DESCRIPTION,
    FILE_TOOL_GREP_DISPLAY_NAME,
    FILE_TOOL_GREP_ID,
    FILE_TOOL_READ_DESCRIPTION,
    FILE_TOOL_READ_DISPLAY_NAME,
    FILE_TOOL_WRITE_DESCRIPTION,
    FILE_TOOL_WRITE_DISPLAY_NAME,
    WEATHER_CURRENT_TOOL_DESCRIPTION,
    WEATHER_CURRENT_TOOL_DISPLAY_NAME,
    WEATHER_CURRENT_TOOL_ID,
    execute_weather_current_tool,
    normalize_tool_catalog_language,
    summarize_tool_arguments,
    summarize_tool_result,
)
from app.tooling.file_tools import (
    FILE_TOOL_GLOB_FUNCTION_NAME,
    FILE_TOOL_GLOB_ID,
    FILE_TOOL_GREP_FUNCTION_NAME,
    FILE_TOOL_GREP_ID,
    FILE_TOOL_READ_FUNCTION_NAME,
    FILE_TOOL_READ_ID,
    FILE_TOOL_SWITCH_ROOT_FUNCTION_NAME,
    FILE_TOOL_SWITCH_ROOT_ID,
    FILE_TOOL_WRITE_FUNCTION_NAME,
    FILE_TOOL_WRITE_ID,
)
from app.integrations.sustech.blackboard import get_blackboard_tool_contracts
from app.integrations.sustech.teaching_information_system import get_tis_tool_contracts

CONTRACT_TOOL_IDS = tuple(
    contract.metadata.tool_id
    for contract in (*get_blackboard_tool_contracts(), *get_tis_tool_contracts())
)


def test_tool_registry_returns_registered_default_toolset() -> None:
    registry = ToolRegistry(
        [
            ToolsetDescriptor(
                name="default",
                label="Default",
                description="Default toolset.",
                default=True,
                tools=(),
            )
        ]
    )

    default_toolset = registry.get_default()

    assert default_toolset.name == "default"
    assert default_toolset.default is True
    assert registry.supports("default") is True


def test_default_tool_registry_builds_view_catalog_and_diagnostics_summary() -> None:
    registry = build_default_tool_registry()
    expected_tool_ids = (
        FILE_TOOL_READ_ID,
        FILE_TOOL_WRITE_ID,
        "tool.fs.edit",
        FILE_TOOL_GLOB_ID,
        FILE_TOOL_GREP_ID,
        "tool.fs.notebook_edit",
        FILE_TOOL_SWITCH_ROOT_ID,
        FILE_CONVERT_TOOL_ID,
        WEATHER_CURRENT_TOOL_ID,
        *CONTRACT_TOOL_IDS,
    )
    catalog = registry.build_tool_catalog()
    catalog_by_id = {entry["toolId"]: entry for entry in catalog}

    assert registry.build_view() == {
        "default": {
            "name": "default",
            "description": "Builtin Copilot runtime tools exposed as the default toolset directory.",
            "toolCount": len(expected_tool_ids),
        }
    }
    assert catalog_by_id[FILE_TOOL_READ_ID] == {
        "toolId": FILE_TOOL_READ_ID,
        "kind": "builtin",
        "availability": "available",
        "displayName": "文件读取",
        "description": "按行分页读取工作区内 UTF-8 文本文件。",
        "prompt": "使用此工具先读取工作区文本文件，再继续分析或修改。",
        "displayNameZh": "文件读取",
        "displayNameEn": FILE_TOOL_READ_DISPLAY_NAME,
        "descriptionZh": "按行分页读取工作区内 UTF-8 文本文件。",
        "descriptionEn": FILE_TOOL_READ_DESCRIPTION,
        "group": {
            "id": "builtin-core",
            "label": "内置基础工具",
            "labelZh": "内置基础工具",
            "labelEn": "Built-in Core Tools",
            "order": 0,
            "sourceKind": "builtin",
        },
    }
    assert catalog_by_id[FILE_TOOL_WRITE_ID] == {
        "toolId": FILE_TOOL_WRITE_ID,
        "kind": "builtin",
        "availability": "available",
        "displayName": "文件写入",
        "description": "在工作区内创建或覆写 UTF-8 文本文件，并带有保护性覆写语义。",
        "prompt": "使用此工具在已知完整目标内容时创建或整体覆写工作区文本文件。",
        "displayNameZh": "文件写入",
        "displayNameEn": FILE_TOOL_WRITE_DISPLAY_NAME,
        "descriptionZh": "在工作区内创建或覆写 UTF-8 文本文件，并带有保护性覆写语义。",
        "descriptionEn": FILE_TOOL_WRITE_DESCRIPTION,
        "group": {
            "id": "builtin-core",
            "label": "内置基础工具",
            "labelZh": "内置基础工具",
            "labelEn": "Built-in Core Tools",
            "order": 0,
            "sourceKind": "builtin",
        },
    }
    assert catalog_by_id[FILE_TOOL_GLOB_ID] == {
        "toolId": FILE_TOOL_GLOB_ID,
        "kind": "builtin",
        "availability": "available",
        "displayName": "文件发现",
        "description": "按 glob 模式发现工作区内文件与目录，不读取内容。",
        "prompt": "使用此工具先发现匹配路径，再决定是否进一步读取。",
        "displayNameZh": "文件发现",
        "displayNameEn": FILE_TOOL_GLOB_DISPLAY_NAME,
        "descriptionZh": "按 glob 模式发现工作区内文件与目录，不读取内容。",
        "descriptionEn": FILE_TOOL_GLOB_DESCRIPTION,
        "group": {
            "id": "builtin-core",
            "label": "内置基础工具",
            "labelZh": "内置基础工具",
            "labelEn": "Built-in Core Tools",
            "order": 0,
            "sourceKind": "builtin",
        },
    }
    assert catalog_by_id[FILE_TOOL_GREP_ID] == {
        "toolId": FILE_TOOL_GREP_ID,
        "kind": "builtin",
        "availability": "available",
        "displayName": "文件搜索",
        "description": "按字面量或正则搜索工作区文本文件，并返回有限行上下文。",
        "prompt": "使用此工具在读取前先搜索工作区文本内容，并查看匹配附近的上下文。",
        "displayNameZh": "文件搜索",
        "displayNameEn": FILE_TOOL_GREP_DISPLAY_NAME,
        "descriptionZh": "按字面量或正则搜索工作区文本文件，并返回有限行上下文。",
        "descriptionEn": FILE_TOOL_GREP_DESCRIPTION,
        "group": {
            "id": "builtin-core",
            "label": "内置基础工具",
            "labelZh": "内置基础工具",
            "labelEn": "Built-in Core Tools",
            "order": 0,
            "sourceKind": "builtin",
        },
    }
    assert catalog_by_id[FILE_CONVERT_TOOL_ID] == {
        "toolId": FILE_CONVERT_TOOL_ID,
        "kind": "builtin",
        "availability": "available",
        "displayName": "文件转换",
        "description": "将 DOCX、PDF 和 PPTX 文件转换为纯文本。",
        "prompt": "在分析前使用此工具将 DOCX、PDF 或 PPTX 文件转换为纯文本。",
        "displayNameZh": "文件转换",
        "displayNameEn": FILE_CONVERT_TOOL_DISPLAY_NAME,
        "descriptionZh": "将 DOCX、PDF 和 PPTX 文件转换为纯文本。",
        "descriptionEn": FILE_CONVERT_TOOL_DESCRIPTION,
        "group": {
            "id": "builtin-core",
            "label": "内置基础工具",
            "labelZh": "内置基础工具",
            "labelEn": "Built-in Core Tools",
            "order": 0,
            "sourceKind": "builtin",
        },
    }
    assert catalog_by_id[WEATHER_CURRENT_TOOL_ID] == {
        "toolId": WEATHER_CURRENT_TOOL_ID,
        "kind": "builtin",
        "availability": "available",
        "displayName": "当前天气",
        "description": "返回指定地点的占位当前天气结果。",
        "prompt": "使用此工具获取某个地点的简要当前天气摘要。",
        "displayNameZh": "当前天气",
        "displayNameEn": WEATHER_CURRENT_TOOL_DISPLAY_NAME,
        "descriptionZh": "返回指定地点的占位当前天气结果。",
        "descriptionEn": WEATHER_CURRENT_TOOL_DESCRIPTION,
        "group": {
            "id": "builtin-core",
            "label": "内置基础工具",
            "labelZh": "内置基础工具",
            "labelEn": "Built-in Core Tools",
            "order": 0,
            "sourceKind": "builtin",
        },
    }
    for tool_id in CONTRACT_TOOL_IDS:
        assert catalog_by_id[tool_id]["toolId"] == tool_id
        assert catalog_by_id[tool_id]["kind"] == "contract"
        assert catalog_by_id[tool_id]["availability"] == "available"
        assert catalog_by_id[tool_id]["displayName"]
        assert catalog_by_id[tool_id]["description"]

    assert registry.list_tool_ids() == expected_tool_ids

    diagnostics = registry.build_diagnostics_summary()
    assert diagnostics["available_toolsets"] == ["default"]
    assert diagnostics["default_toolset"] == "default"
    assert diagnostics["tool_directory_version"] == "tools-v1"
    assert diagnostics["toolset_summaries"][0]["name"] == "default"
    assert diagnostics["toolset_summaries"][0]["label"] == "Default"
    assert diagnostics["toolset_summaries"][0]["description"] == (
        "Builtin Copilot runtime tools exposed as the default toolset directory."
    )
    assert diagnostics["toolset_summaries"][0]["default"] is True
    assert diagnostics["toolset_summaries"][0]["toolCount"] == len(expected_tool_ids)
    assert tuple(
        tool["toolId"] for tool in diagnostics["toolset_summaries"][0]["tools"]
    ) == expected_tool_ids


def test_default_tool_registry_localizes_builtin_tools_and_keeps_contract_metadata_stable() -> None:
    registry = build_default_tool_registry()

    zh_catalog = {entry["toolId"]: entry for entry in registry.build_tool_catalog(language="zh-CN")}
    en_catalog = {entry["toolId"]: entry for entry in registry.build_tool_catalog(language="en-US")}

    assert zh_catalog[FILE_TOOL_READ_ID]["displayName"] == "文件读取"
    assert en_catalog[FILE_TOOL_READ_ID]["displayName"] == FILE_TOOL_READ_DISPLAY_NAME
    assert zh_catalog[FILE_TOOL_WRITE_ID]["displayName"] == "文件写入"
    assert en_catalog[FILE_TOOL_WRITE_ID]["displayName"] == FILE_TOOL_WRITE_DISPLAY_NAME
    assert zh_catalog[FILE_TOOL_GLOB_ID]["displayName"] == "文件发现"
    assert en_catalog[FILE_TOOL_GLOB_ID]["displayName"] == FILE_TOOL_GLOB_DISPLAY_NAME
    assert zh_catalog[FILE_TOOL_GREP_ID]["displayName"] == "文件搜索"
    assert en_catalog[FILE_TOOL_GREP_ID]["displayName"] == FILE_TOOL_GREP_DISPLAY_NAME
    assert zh_catalog[FILE_CONVERT_TOOL_ID]["displayName"] == "文件转换"
    assert en_catalog[FILE_CONVERT_TOOL_ID]["displayName"] == FILE_CONVERT_TOOL_DISPLAY_NAME
    assert zh_catalog[FILE_CONVERT_TOOL_ID]["prompt"] != en_catalog[FILE_CONVERT_TOOL_ID]["prompt"]
    contract_tool_id = CONTRACT_TOOL_IDS[0]
    assert zh_catalog[contract_tool_id]["displayName"] != en_catalog[contract_tool_id]["displayName"]
    assert zh_catalog[contract_tool_id]["displayNameZh"] == zh_catalog[contract_tool_id]["displayName"]
    assert en_catalog[contract_tool_id]["displayNameEn"] == en_catalog[contract_tool_id]["displayName"]
    assert zh_catalog[contract_tool_id]["group"]["label"] == "Blackboard 工具"
    assert en_catalog[contract_tool_id]["group"]["label"] == "Blackboard Tools"
    assert normalize_tool_catalog_language("en-GB") == "en-US"
    assert normalize_tool_catalog_language("zh-TW") == "zh-CN"


def test_default_tool_registry_exposes_contract_tool_runtime_binding_metadata() -> None:
    registry = build_default_tool_registry()

    resolved_tool = registry.resolve_tool("blackboard.course_catalog.search")

    assert resolved_tool.descriptor.kind == "contract"
    assert resolved_tool.function_name == "blackboard_course_catalog_search"
    assert resolved_tool.parameters_json_schema == {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "keyword": {"type": "string", "minLength": 1},
            "field": {"type": "string"},
            "operator": {"type": "string"},
            "fetchMode": {
                "type": "string",
                "enum": ["quick", "full"],
                "default": "full",
                "description": (
                    "quick searches only the initial result pages without following show-all; "
                    "full also follows show-all pagination for more complete results."
                ),
            },
            "maxPages": {
                "type": "integer",
                "minimum": 1,
                "default": 30,
                "description": "Maximum number of result pages to continue fetching before stopping.",
            },
            "limit": {"type": "integer"},
            "username": {"type": "string"},
            "password": {"type": "string"},
            "usernameSecretName": {"type": "string"},
            "passwordSecretName": {"type": "string"},
        },
        "required": ["keyword"],
    }


def test_default_tool_registry_exposes_file_read_runtime_binding_metadata_and_executes(tmp_path: Path) -> None:
    registry = build_default_tool_registry(workspace_root=tmp_path)
    target = tmp_path / "readme.txt"
    target.write_text("first\nsecond\n", encoding="utf-8")

    resolved_tool = registry.resolve_tool(FILE_TOOL_READ_ID)
    result = asyncio.run(resolved_tool.execute({"path": "readme.txt", "offset": 2, "limit": 1}))

    assert resolved_tool.descriptor.kind == "builtin"
    assert resolved_tool.function_name == FILE_TOOL_READ_FUNCTION_NAME
    assert resolved_tool.parameters_json_schema is not None
    assert result["status"] == "success"
    assert result["output"]["ok"] is True
    assert result["output"]["data"]["content"] == {"text": "second"}


def test_default_tool_registry_exposes_file_write_runtime_binding_metadata_and_executes(tmp_path: Path) -> None:
    registry = build_default_tool_registry(workspace_root=tmp_path)

    resolved_tool = registry.resolve_tool(FILE_TOOL_WRITE_ID)
    result = asyncio.run(resolved_tool.execute({"path": "readme.txt", "content": "second"}))

    assert resolved_tool.descriptor.kind == "builtin"
    assert resolved_tool.function_name == FILE_TOOL_WRITE_FUNCTION_NAME
    assert resolved_tool.parameters_json_schema is not None
    assert result["status"] == "success"
    assert result["output"]["ok"] is True
    assert result["output"]["data"]["created"] is True


def test_default_tool_registry_exposes_file_glob_runtime_binding_metadata_and_executes(tmp_path: Path) -> None:
    registry = build_default_tool_registry(workspace_root=tmp_path)
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "readme.md").write_text("alpha", encoding="utf-8")

    resolved_tool = registry.resolve_tool(FILE_TOOL_GLOB_ID)
    result = asyncio.run(resolved_tool.execute({"basePath": "docs", "pattern": "*.md"}))

    assert resolved_tool.descriptor.kind == "builtin"
    assert resolved_tool.function_name == FILE_TOOL_GLOB_FUNCTION_NAME
    assert resolved_tool.parameters_json_schema is not None
    assert result["status"] == "success"
    assert result["output"]["ok"] is True
    assert [match["path"] for match in result["output"]["data"]["matches"]] == ["docs/readme.md"]


def test_default_tool_registry_exposes_file_grep_runtime_binding_metadata_and_executes(tmp_path: Path) -> None:
    registry = build_default_tool_registry(workspace_root=tmp_path)
    target = tmp_path / "readme.txt"
    target.write_text("alpha\nTODO item\nomega\n", encoding="utf-8")

    resolved_tool = registry.resolve_tool(FILE_TOOL_GREP_ID)
    result = asyncio.run(
        resolved_tool.execute({
            "basePath": ".",
            "pattern": "TODO",
            "fileGlob": "*.txt",
            "contextLines": 1,
        })
    )

    assert resolved_tool.descriptor.kind == "builtin"
    assert resolved_tool.function_name == FILE_TOOL_GREP_FUNCTION_NAME
    assert resolved_tool.parameters_json_schema is not None
    assert result["status"] == "success"
    assert result["output"]["ok"] is True
    assert result["output"]["data"]["matches"][0]["matchText"] == "TODO"



def test_default_tool_registry_exposes_file_switch_root_runtime_binding_metadata_and_executes(tmp_path: Path) -> None:
    registry = build_default_tool_registry(workspace_root=tmp_path)
    target_root = tmp_path / "docs"
    target_root.mkdir()

    resolved_tool = registry.resolve_tool(FILE_TOOL_SWITCH_ROOT_ID)
    result = asyncio.run(resolved_tool.execute({"path": str(target_root)}))

    assert resolved_tool.descriptor.kind == "builtin"
    assert resolved_tool.function_name == FILE_TOOL_SWITCH_ROOT_FUNCTION_NAME
    assert resolved_tool.parameters_json_schema is not None
    assert result["status"] == "success"
    assert result["output"]["ok"] is True
    assert result["output"]["data"]["currentRoot"] == target_root.resolve(strict=False).as_posix()


def test_weather_tool_execution_uses_default_location_and_random_sample() -> None:
    result = asyncio.run(execute_weather_current_tool(None, rng=random.Random(0)))

    assert result["location"] == DEFAULT_WEATHER_LOCATION
    assert result["condition"] in {"晴", "多云", "小雨"}
    assert isinstance(result["temperatureC"], int)
    assert isinstance(result["humidity"], int)
    assert isinstance(result["summary"], str)
    assert result["summary"] != ""


def test_tool_registry_rejects_duplicate_names_and_multiple_defaults() -> None:
    registry = ToolRegistry()
    registry.register(
        ToolsetDescriptor(
            name="default",
            label="Default",
            description="Default toolset.",
            default=True,
            tools=(),
        )
    )

    with pytest.raises(ValueError, match="already registered"):
        registry.register(
            ToolsetDescriptor(
                name="default",
                label="Duplicate",
                description="Duplicate toolset.",
                tools=(),
            )
        )

    with pytest.raises(ValueError, match="Only one toolset can be marked as default"):
        registry.register(
            ToolsetDescriptor(
                name="secondary",
                label="Secondary",
                description="Secondary toolset.",
                default=True,
                tools=(),
            )
        )


def test_summarize_tool_arguments_redacts_sensitive_keys_and_truncates_values() -> None:
    summary = summarize_tool_arguments(
        {
            "path": "docs/spec.md",
            "apiKey": "top-secret-token",
            "nested": {"session_token": "abc123", "note": "x" * 200},
        }
    )

    assert summary is not None
    assert "top-secret-token" not in summary
    assert "abc123" not in summary
    assert "***" in summary
    assert '"path": "docs/spec.md"' in summary


def test_summarize_tool_result_returns_json_string() -> None:
    summary = summarize_tool_result({"ok": True, "items": [1, 2, 3]})

    assert summary == '{"items": [1, 2, 3], "ok": true}'

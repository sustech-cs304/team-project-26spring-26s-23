from __future__ import annotations

import asyncio
import random
import sys
from collections.abc import Awaitable
from pathlib import Path
from typing import TypeVar

import pytest

from app.copilot_runtime import (
    ToolRegistry,
    ToolsetDescriptor,
    build_default_tool_registry,
)
from app.copilot_runtime.tool_registry import (
    COMMAND_RUN_TOOL_DESCRIPTION,
    COMMAND_RUN_TOOL_DISPLAY_NAME,
    COMMAND_RUN_TOOL_ID,
    DEFAULT_WEATHER_LOCATION,
    FILE_CONVERT_TOOL_DESCRIPTION,
    FILE_CONVERT_TOOL_DISPLAY_NAME,
    FILE_CONVERT_TOOL_ID,
    REQUEST_USER_FORM_TOOL_DESCRIPTION,
    REQUEST_USER_FORM_TOOL_DISPLAY_NAME,
    REQUEST_USER_FORM_TOOL_ID,
    REQUEST_USER_FORM_TOOL_PROMPT,
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
    SKILL_ACTIVATE_TOOL_ID,
    SKILL_READ_RESOURCE_TOOL_ID,
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
    FILE_TOOL_GREP_FUNCTION_NAME,
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

_T = TypeVar("_T")


async def _await_value(awaitable: Awaitable[_T]) -> _T:
    return await awaitable


def _run_awaitable(awaitable: Awaitable[_T]) -> _T:
    return asyncio.run(_await_value(awaitable))


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
        COMMAND_RUN_TOOL_ID,
        REQUEST_USER_FORM_TOOL_ID,
        SKILL_ACTIVATE_TOOL_ID,
        SKILL_READ_RESOURCE_TOOL_ID,
        *CONTRACT_TOOL_IDS,
    )
    catalog = registry.build_tool_catalog(language="zh-CN")
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
    assert catalog_by_id[COMMAND_RUN_TOOL_ID] == {
        "toolId": COMMAND_RUN_TOOL_ID,
        "kind": "builtin",
        "availability": "available",
        "displayName": "命令执行",
        "description": "在后端运行一条命令并返回 stdout/stderr 以及退出码。",
        "prompt": "使用此工具在后端运行一条命令。请提供 program 和 args 数组；不要把 |、>、&& 等 shell 操作符塞进 args。尽量优先使用只读/查询类命令；涉及删除、覆盖、安装、网络访问等高风险操作必须先征求用户明确批准。",
        "displayNameZh": "命令执行",
        "displayNameEn": COMMAND_RUN_TOOL_DISPLAY_NAME,
        "descriptionZh": "在后端运行一条命令并返回 stdout/stderr 以及退出码。",
        "descriptionEn": COMMAND_RUN_TOOL_DESCRIPTION,
        "group": {
            "id": "builtin-core",
            "label": "内置基础工具",
            "labelZh": "内置基础工具",
            "labelEn": "Built-in Core Tools",
            "order": 0,
            "sourceKind": "builtin",
        },
    }
    assert catalog_by_id[REQUEST_USER_FORM_TOOL_ID] == {
        "toolId": REQUEST_USER_FORM_TOOL_ID,
        "kind": "builtin",
        "availability": "available",
        "displayName": "请求用户表单",
        "description": "在聊天中请求用户填写受控内联表单，以收集继续任务所需的结构化信息；当结构化字段、选项、偏好、约束、确认或参数比自由文本追问更清晰时，应优先考虑使用，即使只有一个字段也可以。",
        "prompt": "当下一步依赖用户补充结构化信息，且表单比自然语言追问更清晰时，主动使用此工具。单字段表单也可以；多个相关字段更应合并为一个表单。表单提交后会作为用户下一条消息继续对话。标题和描述应面向用户并解释为何需要这些信息；字段标签使用自然语言，placeholder 给出具体示例，只把真正阻塞继续执行的字段标为必填；固定列表选项使用 select，checkbox 只用于单个布尔确认且不得携带 options，开放说明用 text 或 textarea。不要请求文件上传，也不要请求 secret、password、token 等敏感凭据；不要向用户暴露 form id、字段数量、JSON 或协议细节。",
        "displayNameZh": "请求用户表单",
        "displayNameEn": REQUEST_USER_FORM_TOOL_DISPLAY_NAME,
        "descriptionZh": "在聊天中请求用户填写受控内联表单，以收集继续任务所需的结构化信息；当结构化字段、选项、偏好、约束、确认或参数比自由文本追问更清晰时，应优先考虑使用，即使只有一个字段也可以。",
        "descriptionEn": REQUEST_USER_FORM_TOOL_DESCRIPTION,
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

    assert catalog_by_id[SKILL_ACTIVATE_TOOL_ID] == {
        "toolId": SKILL_ACTIVATE_TOOL_ID,
        "kind": "builtin",
        "availability": "available",
        "displayName": "Skill 激活",
        "description": "读取已启用 Skill 的 SKILL.md 入口说明和资源摘要。",
        "prompt": "先查看 Available Skills 清单；当某个 Skill 适合任务时，用此工具传入清单中的 skill id 或显示名称。",
        "displayNameZh": "Skill 激活",
        "displayNameEn": "Skill Activate",
        "descriptionZh": "读取已启用 Skill 的 SKILL.md 入口说明和资源摘要。",
        "descriptionEn": "Read the SKILL.md entry instructions and resource summaries for an enabled Skill.",
        "group": {
            "id": "runtime-skill",
            "label": "Skill 工具",
            "labelZh": "Skill 工具",
            "labelEn": "Skill Tools",
            "order": 5,
            "sourceKind": "runtime-skill",
        },
    }
    assert catalog_by_id[SKILL_READ_RESOURCE_TOOL_ID] == {
        "toolId": SKILL_READ_RESOURCE_TOOL_ID,
        "kind": "builtin",
        "availability": "available",
        "displayName": "Skill 资源读取",
        "description": "读取已启用 Skill 资源索引中的 UTF-8 文本资源，不要求先激活。",
        "prompt": "需要 Skill 资源摘要中列出的相对路径时，用此工具传入 skill id 或显示名称以及该资源路径。",
        "displayNameZh": "Skill 资源读取",
        "displayNameEn": "Skill Read Resource",
        "descriptionZh": "读取已启用 Skill 资源索引中的 UTF-8 文本资源，不要求先激活。",
        "descriptionEn": "Read a UTF-8 text resource listed by an enabled Skill without requiring prior activation.",
        "group": {
            "id": "runtime-skill",
            "label": "Skill 工具",
            "labelZh": "Skill 工具",
            "labelEn": "Skill Tools",
            "order": 5,
            "sourceKind": "runtime-skill",
        },
    }


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
            "keyword": {
                "type": "string",
                "minLength": 1,
                "description": "Search keyword sent to the Blackboard course catalog.",
            },
            "field": {
                "type": "string",
                "description": "Catalog field to search against. Defaults to `CourseName`.",
            },
            "operator": {
                "type": "string",
                "description": "Catalog comparison operator. Defaults to `Contains`.",
            },
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
            "limit": {
                "type": "integer",
                "description": "Optional cap on the number of catalog results returned after fetching.",
            },
            "username": {
                "type": "string",
                "description": "Blackboard/CAS username. Usually omit it to use the host's default secret; provide it only when secret lookup is unavailable or credentials are requested explicitly.",
            },
            "password": {
                "type": "string",
                "description": "Blackboard/CAS password. Usually omit it to use the host's default secret; provide it only when secret lookup is unavailable or credentials are requested explicitly.",
            },
            "usernameSecretName": {
                "type": "string",
                "description": "Host secret name that stores the Blackboard/CAS username. Usually omit it to use the default secret `sustech.username`.",
            },
            "passwordSecretName": {
                "type": "string",
                "description": "Host secret name that stores the Blackboard/CAS password. Usually omit it to use the default secret `sustech.casPassword`.",
            },
        },
        "required": ["keyword"],
    }


def test_request_user_form_tool_metadata_encourages_user_friendly_structured_collection() -> None:
    registry = build_default_tool_registry()

    zh_catalog = {entry["toolId"]: entry for entry in registry.build_tool_catalog(language="zh-CN")}
    en_catalog = {entry["toolId"]: entry for entry in registry.build_tool_catalog(language="en-US")}
    resolved_tool = registry.resolve_tool(REQUEST_USER_FORM_TOOL_ID)
    schema = resolved_tool.parameters_json_schema

    assert schema is not None
    assert resolved_tool.function_name == "request_user_form"
    assert "single-field" in REQUEST_USER_FORM_TOOL_PROMPT
    assert "file uploads" in REQUEST_USER_FORM_TOOL_PROMPT
    assert "passwords, or tokens" in REQUEST_USER_FORM_TOOL_PROMPT
    assert "single boolean confirmation without options" in REQUEST_USER_FORM_TOOL_PROMPT
    assert "even for a single field" in REQUEST_USER_FORM_TOOL_DESCRIPTION
    assert "一个字段也可以" in zh_catalog[REQUEST_USER_FORM_TOOL_ID]["description"]
    assert "不要请求文件上传" in zh_catalog[REQUEST_USER_FORM_TOOL_ID]["prompt"]
    assert "不要请求 secret、password、token" in zh_catalog[REQUEST_USER_FORM_TOOL_ID]["prompt"]
    assert "checkbox 只用于单个布尔确认且不得携带 options" in zh_catalog[REQUEST_USER_FORM_TOOL_ID]["prompt"]
    assert "structured user input" in en_catalog[REQUEST_USER_FORM_TOOL_ID]["description"]
    assert "The submitted form will arrive as the user's next message" in en_catalog[
        REQUEST_USER_FORM_TOOL_ID
    ]["prompt"]
    assert "user-facing" in schema["properties"]["title"]["description"]
    assert "do not mention or display it to the user" in schema["properties"]["form_id"]["description"]
    assert "A single-field form is valid" in schema["properties"]["fields"]["description"]
    field_properties = schema["properties"]["fields"]["items"]["properties"]
    assert "Natural-language field label" in field_properties["label"]["description"]
    assert "single boolean confirmation" in field_properties["type"]["description"]
    assert "Do not use options with checkbox fields" in field_properties["options"]["description"]
    assert "concrete example input" in field_properties["placeholder"]["description"]
    assert "necessary to continue safely or correctly" in field_properties["required"]["description"]
    assert "protocol mechanics" in field_properties["description"]["description"]
    field_schema = schema["properties"]["fields"]["items"]
    assert field_schema["allOf"][0]["then"]["required"] == ["options"]
    assert field_schema["allOf"][0]["then"]["properties"]["options"]["minItems"] == 1
    assert field_schema["allOf"][1]["then"]["not"]["required"] == ["options"]


def test_request_user_form_tool_rejects_checkbox_options_and_accepts_boolean_checkbox() -> None:
    registry = build_default_tool_registry()

    resolved_tool = registry.resolve_tool(REQUEST_USER_FORM_TOOL_ID)

    with pytest.raises(ValueError, match="checkbox fields do not support options"):
        _run_awaitable(
            resolved_tool.execute({
                "form_id": "confirm-form",
                "title": "确认继续",
                "fields": [{
                    "name": "confirm",
                    "label": "我已确认",
                    "type": "checkbox",
                    "options": [{"value": "yes", "label": "是"}],
                }],
            })
        )

    result = _run_awaitable(
        resolved_tool.execute({
            "form_id": "confirm-form",
            "title": "确认继续",
            "fields": [{
                "name": "confirm",
                "label": "我已确认",
                "type": "checkbox",
                "required": True,
            }],
        })
    )

    assert result["formRequest"]["fields"] == [{
        "name": "confirm",
        "label": "我已确认",
        "type": "checkbox",
        "required": True,
    }]


def test_default_tool_registry_exposes_file_read_runtime_binding_metadata_and_executes(tmp_path: Path) -> None:
    registry = build_default_tool_registry(workspace_root=tmp_path)
    target = tmp_path / "readme.txt"
    target.write_text("first\nsecond\n", encoding="utf-8")

    resolved_tool = registry.resolve_tool(FILE_TOOL_READ_ID)
    result = _run_awaitable(
        resolved_tool.execute({"path": "readme.txt", "offset": 2, "limit": 1})
    )

    assert resolved_tool.descriptor.kind == "builtin"
    assert resolved_tool.function_name == FILE_TOOL_READ_FUNCTION_NAME
    assert resolved_tool.parameters_json_schema is not None
    assert result["status"] == "success"
    assert result["output"]["ok"] is True
    assert result["output"]["data"]["content"] == {"text": "second"}


def test_default_tool_registry_exposes_file_write_runtime_binding_metadata_and_executes(tmp_path: Path) -> None:
    registry = build_default_tool_registry(workspace_root=tmp_path)

    resolved_tool = registry.resolve_tool(FILE_TOOL_WRITE_ID)
    result = _run_awaitable(resolved_tool.execute({"path": "readme.txt", "content": "second"}))

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
    result = _run_awaitable(
        resolved_tool.execute({"basePath": "docs", "pattern": "*.md"})
    )

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
    result = _run_awaitable(
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
    result = _run_awaitable(resolved_tool.execute({"path": str(target_root)}))

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


def test_command_run_tool_executes_python_inline() -> None:
    registry = build_default_tool_registry()
    resolved_tool = registry.resolve_tool(COMMAND_RUN_TOOL_ID)
    result = _run_awaitable(
        resolved_tool.execute(
            {
                "program": sys.executable,
                "args": ["-c", "print('ok')"],
                "timeoutSeconds": 10,
                "maxOutputChars": 2000,
            }
        )
    )

    assert resolved_tool.descriptor.kind == "builtin"
    assert resolved_tool.function_name == "command_run"
    assert resolved_tool.parameters_json_schema is not None
    assert result["timedOut"] is False
    assert result["exitCode"] == 0
    assert "ok" in result["stdout"]


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

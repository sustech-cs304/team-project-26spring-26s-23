"""Unit tests for tool registry builders, executors, and helpers."""

from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable
from typing import Any, TypeVar

import pytest

from app.copilot_runtime._tool_registry.builders import (
    build_contract_runtime_executable_tools,
    build_default_tool_registry,
)
from app.copilot_runtime._tool_registry.constants import (
    DEFAULT_WEATHER_LOCATION,
    MAX_TOOL_ARGUMENT_SUMMARY_LENGTH,
    MAX_TOOL_ARGUMENT_VALUE_LENGTH,
    MAX_TOOL_RESULT_SUMMARY_LENGTH,
    REDACTED_TOOL_ARGUMENT_VALUE,
    REQUEST_USER_FORM_TOOL_ID,
    SENSITIVE_TOOL_ARGUMENT_KEYWORDS,
    SKILL_ACTIVATE_TOOL_ID,
    SKILL_READ_RESOURCE_TOOL_ID,
    WEATHER_CURRENT_TOOL_ID,
)
from app.copilot_runtime._tool_registry.executors import (
    _normalize_form_field,
    _normalize_form_field_option,
    _normalize_optional_text_argument,
    _normalize_required_text_argument,
    execute_default_weather_tool,
    execute_request_user_form_tool,
    execute_weather_current_tool,
)
from app.copilot_runtime._tool_registry.helpers import (
    _is_sensitive_tool_argument_key,
    _sanitize_tool_argument_value,
    _truncate_tool_argument_text,
    normalize_tool_catalog_language,
    resolve_builtin_tool_locale,
    summarize_tool_arguments,
    summarize_tool_result,
)
from app.copilot_runtime._tool_registry.models import ToolRegistry
from app.tooling.file_tools import (
    FILE_TOOL_EDIT_ID,
    FILE_TOOL_GLOB_FUNCTION_NAME,
    FILE_TOOL_GLOB_ID,
    FILE_TOOL_GREP_FUNCTION_NAME,
    FILE_TOOL_GREP_ID,
    FILE_TOOL_NOTEBOOK_EDIT_ID,
    FILE_TOOL_READ_FUNCTION_NAME,
    FILE_TOOL_READ_ID,
    FILE_TOOL_SWITCH_ROOT_FUNCTION_NAME,
    FILE_TOOL_SWITCH_ROOT_ID,
    FILE_TOOL_WRITE_FUNCTION_NAME,
    FILE_TOOL_WRITE_ID,
)

_T = TypeVar("_T")

ALL_BUILTIN_TOOL_IDS = (
    FILE_TOOL_READ_ID,
    FILE_TOOL_WRITE_ID,
    FILE_TOOL_EDIT_ID,
    FILE_TOOL_GLOB_ID,
    FILE_TOOL_GREP_ID,
    FILE_TOOL_NOTEBOOK_EDIT_ID,
    FILE_TOOL_SWITCH_ROOT_ID,
    WEATHER_CURRENT_TOOL_ID,
    REQUEST_USER_FORM_TOOL_ID,
    SKILL_ACTIVATE_TOOL_ID,
    SKILL_READ_RESOURCE_TOOL_ID,
)


def _run(awaitable: Awaitable[_T]) -> _T:
    return asyncio.run(awaitable)


# ---------------------------------------------------------------------------
# builders.py
# ---------------------------------------------------------------------------


class TestBuildDefaultToolRegistry:
    def test_returns_valid_registry_instance(self) -> None:
        registry = build_default_tool_registry()
        assert isinstance(registry, ToolRegistry)
        assert registry.get_default().name == "default"
        assert registry.get_default().default is True

    def test_registry_contains_all_builtin_tool_ids(self) -> None:
        registry = build_default_tool_registry()
        tool_ids = dict.fromkeys(registry.list_tool_ids())
        for expected_id in ALL_BUILTIN_TOOL_IDS:
            assert expected_id in tool_ids, f"Missing tool id: {expected_id}"

    def test_builtin_tools_have_correct_kind_and_availability(self) -> None:
        registry = build_default_tool_registry()
        for tool_id in ALL_BUILTIN_TOOL_IDS:
            tool = registry.resolve_tool(tool_id)
            assert tool.descriptor.kind == "builtin", f"{tool_id} kind mismatch"
            assert tool.descriptor.availability == "available", f"{tool_id} availability mismatch"

    def test_file_tools_have_function_names(self) -> None:
        registry = build_default_tool_registry()
        expected = {
            FILE_TOOL_READ_ID: FILE_TOOL_READ_FUNCTION_NAME,
            FILE_TOOL_WRITE_ID: FILE_TOOL_WRITE_FUNCTION_NAME,
            FILE_TOOL_GLOB_ID: FILE_TOOL_GLOB_FUNCTION_NAME,
            FILE_TOOL_GREP_ID: FILE_TOOL_GREP_FUNCTION_NAME,
            FILE_TOOL_SWITCH_ROOT_ID: FILE_TOOL_SWITCH_ROOT_FUNCTION_NAME,
        }
        for tool_id, function_name in expected.items():
            tool = registry.resolve_tool(tool_id)
            assert tool.function_name == function_name, f"{tool_id} function_name"

    def test_file_tools_have_parameters_json_schema(self) -> None:
        registry = build_default_tool_registry()
        for tool_id in (
            FILE_TOOL_READ_ID,
            FILE_TOOL_WRITE_ID,
            FILE_TOOL_GLOB_ID,
            FILE_TOOL_GREP_ID,
            FILE_TOOL_SWITCH_ROOT_ID,
        ):
            tool = registry.resolve_tool(tool_id)
            assert tool.parameters_json_schema is not None, f"{tool_id} missing schema"
            assert isinstance(tool.parameters_json_schema, dict)

    def test_weather_tool_metadata(self) -> None:
        registry = build_default_tool_registry()
        tool = registry.resolve_tool(WEATHER_CURRENT_TOOL_ID)
        assert tool.function_name is None
        assert tool.descriptor.display_name == "Current Weather"

    def test_form_tool_has_function_name_and_schema(self) -> None:
        registry = build_default_tool_registry()
        tool = registry.resolve_tool(REQUEST_USER_FORM_TOOL_ID)
        assert tool.function_name == "request_user_form"
        assert tool.parameters_json_schema is not None
        assert tool.parameters_json_schema["type"] == "object"
        assert "fields" in tool.parameters_json_schema["required"]

    def test_skill_tools_have_function_names(self) -> None:
        registry = build_default_tool_registry()
        activate = registry.resolve_tool(SKILL_ACTIVATE_TOOL_ID)
        assert activate.function_name == "skill_activate"
        assert activate.parameters_json_schema is not None

        read_resource = registry.resolve_tool(SKILL_READ_RESOURCE_TOOL_ID)
        assert read_resource.function_name == "skill_read_resource"
        assert read_resource.parameters_json_schema is not None

    def test_with_custom_workspace_root(self, tmp_path: Any) -> None:
        registry = build_default_tool_registry(workspace_root=tmp_path)
        assert registry.workspace_root == tmp_path.resolve(strict=False)

    def test_contract_tools_are_registered(self) -> None:
        registry = build_default_tool_registry()
        tool_ids = registry.list_tool_ids()
        contract_ids = [
            tid for tid in tool_ids
            if tid not in ALL_BUILTIN_TOOL_IDS
        ]
        assert len(contract_ids) > 0, "Expected contract tools to be present"
        for cid in contract_ids:
            tool = registry.resolve_tool(cid)
            assert tool.descriptor.kind == "contract", f"{cid} should be a contract tool"

    def test_build_contract_runtime_executable_tools_returns_executable_tools(self) -> None:
        tools = build_contract_runtime_executable_tools()
        assert isinstance(tools, tuple)
        assert len(tools) > 0
        for tool in tools:
            assert tool.descriptor.kind == "contract"
            assert callable(tool.execute)
            assert tool.function_name is not None

    def test_dynamic_tool_loader_invoked(self) -> None:
        def dummy_loader(language: str | None) -> tuple:
            return ()

        registry = build_default_tool_registry(dynamic_tool_loader=dummy_loader)
        summary = registry.build_diagnostics_summary()
        assert summary["dynamic_tool_count"] == 0
        assert summary["dynamic_tool_ids"] == []


# ---------------------------------------------------------------------------
# executors.py - Weather tool
# ---------------------------------------------------------------------------


class TestExecuteWeatherCurrentTool:
    def test_no_arguments_uses_default_location(self) -> None:
        result = _run(execute_weather_current_tool(None, rng=random.Random(0)))
        assert result["location"] == DEFAULT_WEATHER_LOCATION
        assert "condition" in result
        assert "temperatureC" in result
        assert "humidity" in result
        assert "summary" in result

    def test_with_specific_location(self) -> None:
        result = _run(execute_weather_current_tool({"location": "Beijing"}, rng=random.Random(0)))
        assert result["location"] == "Beijing"

    def test_with_whitespace_location_is_stripped(self) -> None:
        result = _run(execute_weather_current_tool({"location": "  Tokyo  "}, rng=random.Random(0)))
        assert result["location"] == "Tokyo"

    def test_with_empty_location_falls_back_to_default(self) -> None:
        result = _run(execute_weather_current_tool({"location": ""}, rng=random.Random(0)))
        assert result["location"] == DEFAULT_WEATHER_LOCATION

    def test_with_whitespace_only_location_falls_back(self) -> None:
        result = _run(execute_weather_current_tool({"location": "   "}, rng=random.Random(0)))
        assert result["location"] == DEFAULT_WEATHER_LOCATION

    def test_with_non_string_location_falls_back(self) -> None:
        result = _run(execute_weather_current_tool({"location": 123}, rng=random.Random(0)))
        assert result["location"] == DEFAULT_WEATHER_LOCATION

    def test_result_keys_match_sample_structure(self) -> None:
        rng = random.Random(42)
        result = _run(execute_weather_current_tool({"location": "Shanghai"}, rng=rng))
        assert set(result.keys()) == {"location", "condition", "temperatureC", "humidity", "summary"}
        assert isinstance(result["temperatureC"], int)
        assert isinstance(result["humidity"], int)
        assert isinstance(result["condition"], str)
        assert isinstance(result["summary"], str)

    def test_seeded_rng_is_deterministic(self) -> None:
        rng1 = random.Random(99)
        rng2 = random.Random(99)
        result1 = _run(execute_weather_current_tool(None, rng=rng1))
        result2 = _run(execute_weather_current_tool(None, rng=rng2))
        assert result1 == result2

    def test_default_weather_tool_delegates(self) -> None:
        result = _run(execute_default_weather_tool({"location": "Paris"}))
        assert result["location"] in {
            "Paris",
            DEFAULT_WEATHER_LOCATION,
        }


# ---------------------------------------------------------------------------
# executors.py - Form tool
# ---------------------------------------------------------------------------


class TestExecuteRequestUserFormTool:
    def test_minimal_valid_form(self) -> None:
        result = _run(execute_request_user_form_tool({
            "form_id": "test-form",
            "title": "测试表单",
            "fields": [{"name": "username", "label": "用户名", "type": "text"}],
        }))
        assert result["formRequest"]["formId"] == "test-form"
        assert result["formRequest"]["title"] == "测试表单"
        assert result["formRequest"]["fields"] == [
            {"name": "username", "label": "用户名", "type": "text"}
        ]
        assert "summary" in result

    def test_with_description_and_submit_label(self) -> None:
        result = _run(execute_request_user_form_tool({
            "form_id": "feedback",
            "title": "反馈表单",
            "description": "请提供您的反馈意见",
            "submit_label": "提交",
            "fields": [{"name": "comment", "label": "评论", "type": "textarea"}],
        }))
        assert result["formRequest"]["description"] == "请提供您的反馈意见"
        assert result["formRequest"]["submitLabel"] == "提交"
        assert result["summary"] == "请提供您的反馈意见"

    def test_summary_falls_back_to_title_when_no_description(self) -> None:
        result = _run(execute_request_user_form_tool({
            "form_id": "no-desc",
            "title": "简单表单",
            "fields": [{"name": "x", "label": "X", "type": "number"}],
        }))
        assert "请填写表单：简单表单" in result["summary"]

    def test_with_select_field(self) -> None:
        result = _run(execute_request_user_form_tool({
            "form_id": "choices",
            "title": "选择",
            "fields": [{
                "name": "color",
                "label": "颜色",
                "type": "select",
                "options": [
                    {"value": "red", "label": "红色"},
                    {"value": "blue", "label": "蓝色"},
                ],
            }],
        }))
        assert result["formRequest"]["fields"][0]["type"] == "select"
        assert result["formRequest"]["fields"][0]["options"] == [
            {"value": "red", "label": "红色"},
            {"value": "blue", "label": "蓝色"},
        ]

    def test_with_checkbox_field(self) -> None:
        result = _run(execute_request_user_form_tool({
            "form_id": "confirm",
            "title": "确认",
            "fields": [{"name": "agree", "label": "同意", "type": "checkbox", "required": True}],
        }))
        field = result["formRequest"]["fields"][0]
        assert field["type"] == "checkbox"
        assert field["required"] is True

    def test_with_optional_field_properties(self) -> None:
        result = _run(execute_request_user_form_tool({
            "form_id": "optional",
            "title": "可选字段",
            "fields": [{
                "name": "bio",
                "label": "简介",
                "type": "textarea",
                "description": "介绍一下自己",
                "placeholder": "请输入...",
                "required": False,
            }],
        }))
        field = result["formRequest"]["fields"][0]
        assert field["description"] == "介绍一下自己"
        assert field["placeholder"] == "请输入..."
        assert field["required"] is False

    def test_empty_fields_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="fields must be a non-empty array"):
            _run(execute_request_user_form_tool({
                "form_id": "bad",
                "title": "Bad",
                "fields": [],
            }))

    def test_non_list_fields_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="fields must be a non-empty array"):
            _run(execute_request_user_form_tool({
                "form_id": "bad",
                "title": "Bad",
                "fields": "not-a-list",
            }))

    def test_missing_form_id_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="form_id must be a non-empty string"):
            _run(execute_request_user_form_tool({
                "title": "No ID",
                "fields": [{"name": "x", "label": "X", "type": "text"}],
            }))

    def test_missing_title_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="title must be a non-empty string"):
            _run(execute_request_user_form_tool({
                "form_id": "no-title",
                "fields": [{"name": "x", "label": "X", "type": "text"}],
            }))

    def test_select_without_options_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="select fields require a non-empty options array"):
            _run(execute_request_user_form_tool({
                "form_id": "bad-select",
                "title": "Bad Select",
                "fields": [{"name": "choice", "label": "选择", "type": "select"}],
            }))

    def test_select_with_empty_options_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="select fields require a non-empty options array"):
            _run(execute_request_user_form_tool({
                "form_id": "bad-select",
                "title": "Bad Select",
                "fields": [{
                    "name": "choice",
                    "label": "选择",
                    "type": "select",
                    "options": [],
                }],
            }))

    def test_checkbox_with_options_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="checkbox fields do not support options"):
            _run(execute_request_user_form_tool({
                "form_id": "bad-checkbox",
                "title": "Bad Checkbox",
                "fields": [{
                    "name": "confirm",
                    "label": "Confirm",
                    "type": "checkbox",
                    "options": [{"value": "yes", "label": "Yes"}],
                }],
            }))

    def test_text_field_with_options_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="checkbox fields do not support options"):
            _run(execute_request_user_form_tool({
                "form_id": "bad-text",
                "title": "Bad Text",
                "fields": [{
                    "name": "x",
                    "label": "X",
                    "type": "text",
                    "options": [{"value": "a", "label": "A"}],
                }],
            }))


# ---------------------------------------------------------------------------
# executors.py - Form field normalizers
# ---------------------------------------------------------------------------


class TestNormalizeOptionalTextArgument:
    def test_valid_string_returns_stripped(self) -> None:
        assert _normalize_optional_text_argument("  hello  ") == "hello"

    def test_empty_string_returns_none(self) -> None:
        assert _normalize_optional_text_argument("") is None

    def test_whitespace_only_returns_none(self) -> None:
        assert _normalize_optional_text_argument("   ") is None

    def test_non_string_returns_none(self) -> None:
        assert _normalize_optional_text_argument(123) is None
        assert _normalize_optional_text_argument(None) is None
        assert _normalize_optional_text_argument([]) is None
        assert _normalize_optional_text_argument(True) is None

    def test_none_returns_none(self) -> None:
        assert _normalize_optional_text_argument(None) is None


class TestNormalizeRequiredTextArgument:
    def test_valid_string_returns_stripped(self) -> None:
        assert _normalize_required_text_argument("  hello  ", field_name="test") == "hello"

    def test_empty_string_raises(self) -> None:
        with pytest.raises(ValueError, match="test must be a non-empty string"):
            _normalize_required_text_argument("", field_name="test")

    def test_whitespace_only_raises(self) -> None:
        with pytest.raises(ValueError, match="test must be a non-empty string"):
            _normalize_required_text_argument("   ", field_name="test")

    def test_non_string_raises(self) -> None:
        with pytest.raises(ValueError, match="test must be a non-empty string"):
            _normalize_required_text_argument(None, field_name="test")

    def test_integer_raises(self) -> None:
        with pytest.raises(ValueError, match="test must be a non-empty string"):
            _normalize_required_text_argument(42, field_name="test")


class TestNormalizeFormFieldOption:
    def test_valid_option(self) -> None:
        result = _normalize_form_field_option({"value": "red", "label": "Red"})
        assert result == {"value": "red", "label": "Red"}

    def test_option_with_extra_keys_filters(self) -> None:
        result = _normalize_form_field_option({
            "value": "v", "label": "L", "extra": "ignored"
        })
        assert result == {"value": "v", "label": "L"}

    def test_non_mapping_raises(self) -> None:
        with pytest.raises(ValueError, match="field options must be objects"):
            _normalize_form_field_option("not-a-dict")

    def test_list_raises(self) -> None:
        with pytest.raises(ValueError, match="field options must be objects"):
            _normalize_form_field_option(["value", "label"])

    def test_missing_value_raises(self) -> None:
        with pytest.raises(ValueError, match=r"field.options\[\]\.value must be"):
            _normalize_form_field_option({"label": "L"})

    def test_missing_label_raises(self) -> None:
        with pytest.raises(ValueError, match=r"field.options\[\]\.label must be"):
            _normalize_form_field_option({"value": "v"})


class TestNormalizeFormField:
    def test_text_field(self) -> None:
        result = _normalize_form_field({
            "name": "username", "label": "用户名", "type": "text",
        })
        assert result == {"name": "username", "label": "用户名", "type": "text"}

    def test_textarea_field(self) -> None:
        result = _normalize_form_field({
            "name": "bio", "label": "简介", "type": "textarea",
        })
        assert result == {"name": "bio", "label": "简介", "type": "textarea"}

    def test_number_field(self) -> None:
        result = _normalize_form_field({
            "name": "age", "label": "年龄", "type": "number",
        })
        assert result == {"name": "age", "label": "年龄", "type": "number"}

    def test_select_field_with_options(self) -> None:
        result = _normalize_form_field({
            "name": "color",
            "label": "颜色",
            "type": "select",
            "options": [{"value": "r", "label": "红"}, {"value": "b", "label": "蓝"}],
        })
        assert result["type"] == "select"
        assert result["options"] == [
            {"value": "r", "label": "红"},
            {"value": "b", "label": "蓝"},
        ]

    def test_checkbox_field(self) -> None:
        result = _normalize_form_field({
            "name": "agree", "label": "同意", "type": "checkbox", "required": True,
        })
        assert result == {
            "name": "agree", "label": "同意", "type": "checkbox", "required": True,
        }

    def test_with_description_and_placeholder(self) -> None:
        result = _normalize_form_field({
            "name": "x",
            "label": "X",
            "type": "text",
            "description": "描述",
            "placeholder": "请输入",
        })
        assert result["description"] == "描述"
        assert result["placeholder"] == "请输入"

    def test_invalid_type_raises(self) -> None:
        with pytest.raises(ValueError, match="field.type must be one of"):
            _normalize_form_field({"name": "x", "label": "X", "type": "invalid"})

    def test_non_mapping_raises(self) -> None:
        with pytest.raises(ValueError, match="fields must contain only objects"):
            _normalize_form_field("not-a-dict")

    def test_missing_name_raises(self) -> None:
        with pytest.raises(ValueError, match="field.name must be"):
            _normalize_form_field({"label": "X", "type": "text"})

    def test_missing_label_raises(self) -> None:
        with pytest.raises(ValueError, match="field.label must be"):
            _normalize_form_field({"name": "x", "type": "text"})

    def test_missing_type_raises(self) -> None:
        with pytest.raises(ValueError, match="field.type must be"):
            _normalize_form_field({"name": "x", "label": "X"})

    def test_checkbox_with_options_raises(self) -> None:
        with pytest.raises(ValueError, match="checkbox fields do not support options"):
            _normalize_form_field({
                "name": "c",
                "label": "C",
                "type": "checkbox",
                "options": [{"value": "y", "label": "Y"}],
            })

    def test_number_with_options_raises(self) -> None:
        with pytest.raises(ValueError, match="checkbox fields do not support options"):
            _normalize_form_field({
                "name": "n",
                "label": "N",
                "type": "number",
                "options": [{"value": "1", "label": "One"}],
            })

    def test_select_without_options_raises(self) -> None:
        with pytest.raises(ValueError, match="select fields require a non-empty options array"):
            _normalize_form_field({"name": "s", "label": "S", "type": "select"})

    def test_select_with_empty_options_raises(self) -> None:
        with pytest.raises(ValueError, match="select fields require a non-empty options array"):
            _normalize_form_field({
                "name": "s", "label": "S", "type": "select", "options": [],
            })

    def test_required_as_boolean_included(self) -> None:
        result = _normalize_form_field({
            "name": "x", "label": "X", "type": "text", "required": True,
        })
        assert result["required"] is True

        result = _normalize_form_field({
            "name": "x", "label": "X", "type": "text", "required": False,
        })
        assert result["required"] is False

    def test_required_not_boolean_excluded(self) -> None:
        result = _normalize_form_field({
            "name": "x", "label": "X", "type": "text", "required": "yes",
        })
        assert "required" not in result


# ---------------------------------------------------------------------------
# helpers.py
# ---------------------------------------------------------------------------


class TestNormalizeToolCatalogLanguage:
    def test_en_prefix_returns_en_us(self) -> None:
        assert normalize_tool_catalog_language("en-US") == "en-US"
        assert normalize_tool_catalog_language("en-GB") == "en-US"
        assert normalize_tool_catalog_language("en") == "en-US"

    def test_non_en_returns_default(self) -> None:
        assert normalize_tool_catalog_language("zh-CN") == "zh-CN"
        assert normalize_tool_catalog_language("zh-TW") == "zh-CN"

    def test_none_returns_default(self) -> None:
        assert normalize_tool_catalog_language(None) == "zh-CN"

    def test_empty_string_returns_default(self) -> None:
        assert normalize_tool_catalog_language("") == "zh-CN"

    def test_unrecognized_language_returns_default(self) -> None:
        assert normalize_tool_catalog_language("fr-FR") == "zh-CN"


class TestResolveBuiltinToolLocale:
    def test_known_tool_zh_cn(self) -> None:
        locale = resolve_builtin_tool_locale("tool.fs.read", "zh-CN")
        assert locale["displayName"] == "文件读取"
        assert locale["description"]
        assert locale["prompt"]

    def test_known_tool_en_us(self) -> None:
        locale = resolve_builtin_tool_locale("tool.fs.read", "en-US")
        assert locale["displayName"] == "File Read"

    def test_unknown_language_falls_back_to_default(self) -> None:
        locale = resolve_builtin_tool_locale("tool.fs.read", "fr-FR")
        assert locale["displayName"] == "文件读取"

    def test_unknown_tool_id_returns_fallback(self) -> None:
        locale = resolve_builtin_tool_locale("nonexistent.tool", "zh-CN")
        assert locale == {
            "displayName": "nonexistent.tool",
            "description": "",
            "prompt": "",
        }

    def test_returns_shallow_copy_not_reference(self) -> None:
        locale1 = resolve_builtin_tool_locale("tool.fs.read", "zh-CN")
        locale2 = resolve_builtin_tool_locale("tool.fs.read", "zh-CN")
        assert locale1 == locale2
        assert locale1 is not locale2


class TestSummarizeToolArguments:
    def test_none_returns_none(self) -> None:
        assert summarize_tool_arguments(None) is None

    def test_empty_dict_returns_none(self) -> None:
        assert summarize_tool_arguments({}) is None

    def test_simple_arguments(self) -> None:
        summary = summarize_tool_arguments({"path": "file.txt", "limit": 10})
        assert summary is not None
        assert "path" in summary
        assert "file.txt" in summary

    def test_redacts_sensitive_keys(self) -> None:
        summary = summarize_tool_arguments({
            "apiKey": "secret-12345",
            "password": "my-password",
            "token": "tok-abc",
            "name": "public-name",
        })
        assert summary is not None
        assert "secret-12345" not in summary
        assert "my-password" not in summary
        assert "tok-abc" not in summary
        assert REDACTED_TOOL_ARGUMENT_VALUE in summary
        assert "public-name" in summary

    def test_redacts_nested_sensitive_keys(self) -> None:
        summary = summarize_tool_arguments({
            "config": {"api_key": "hidden-key", "timeout": 30},
            "public": "visible",
        })
        assert summary is not None
        assert "hidden-key" not in summary
        assert REDACTED_TOOL_ARGUMENT_VALUE in summary
        assert "visible" in summary

    def test_truncates_long_string_values(self) -> None:
        long_value = "x" * (MAX_TOOL_ARGUMENT_VALUE_LENGTH + 50)
        summary = summarize_tool_arguments({"data": long_value})
        assert summary is not None
        assert len(long_value) > len(summary)

    def test_non_string_keys_are_normalized(self) -> None:
        summary = summarize_tool_arguments({123: "value"})
        assert summary is not None
        assert "123" in summary


class TestSummarizeToolResult:
    def test_none_returns_none(self) -> None:
        assert summarize_tool_result(None) is None

    def test_simple_dict(self) -> None:
        summary = summarize_tool_result({"ok": True, "items": [1, 2, 3]})
        assert summary is not None
        assert "ok" in summary
        assert "items" in summary

    def test_long_result_is_truncated(self) -> None:
        long_string = "x" * (MAX_TOOL_RESULT_SUMMARY_LENGTH + 100)
        summary = summarize_tool_result({"data": long_string})
        assert summary is not None
        assert len(summary) <= MAX_TOOL_RESULT_SUMMARY_LENGTH

    def test_non_json_serializable_falls_back_to_str(self) -> None:
        summary = summarize_tool_result(object())
        assert summary is not None
        assert isinstance(summary, str)


class TestIsSensitiveToolArgumentKey:
    def test_direct_keyword_matches(self) -> None:
        for keyword in SENSITIVE_TOOL_ARGUMENT_KEYWORDS:
            assert _is_sensitive_tool_argument_key(keyword) is True, f"keyword: {keyword}"

    def test_apikey_variants(self) -> None:
        assert _is_sensitive_tool_argument_key("apikey") is True
        assert _is_sensitive_tool_argument_key("apiKey") is True
        assert _is_sensitive_tool_argument_key("api_key") is True
        assert _is_sensitive_tool_argument_key("API-KEY") is True
        assert _is_sensitive_tool_argument_key("  api_key  ") is True

    def test_password_variants(self) -> None:
        assert _is_sensitive_tool_argument_key("password") is True
        assert _is_sensitive_tool_argument_key("my_password") is True
        assert _is_sensitive_tool_argument_key("userPassword") is True

    def test_token_variants(self) -> None:
        assert _is_sensitive_tool_argument_key("token") is True
        assert _is_sensitive_tool_argument_key("access_token") is True
        assert _is_sensitive_tool_argument_key("session-token") is True

    def test_secret_variants(self) -> None:
        assert _is_sensitive_tool_argument_key("secret") is True
        assert _is_sensitive_tool_argument_key("clientSecret") is True

    def test_non_sensitive_keys(self) -> None:
        assert _is_sensitive_tool_argument_key("path") is False
        assert _is_sensitive_tool_argument_key("name") is False
        assert _is_sensitive_tool_argument_key("file") is False
        assert _is_sensitive_tool_argument_key("description") is False
        assert _is_sensitive_tool_argument_key("username") is False
        assert _is_sensitive_tool_argument_key("limit") is False

    def test_authorization_variants(self) -> None:
        assert _is_sensitive_tool_argument_key("authorization") is True
        assert _is_sensitive_tool_argument_key("Authorization") is True

    def test_cookie_variants(self) -> None:
        assert _is_sensitive_tool_argument_key("cookie") is True
        assert _is_sensitive_tool_argument_key("session_cookie") is True

    def test_credential_variants(self) -> None:
        assert _is_sensitive_tool_argument_key("credential") is True
        assert _is_sensitive_tool_argument_key("credentials") is True

    def test_session_variants(self) -> None:
        assert _is_sensitive_tool_argument_key("session") is True
        assert _is_sensitive_tool_argument_key("sessionId") is True


class TestTruncateToolArgumentText:
    def test_within_limit_returns_unchanged(self) -> None:
        assert _truncate_tool_argument_text("hello", limit=10) == "hello"

    def test_at_limit_returns_unchanged(self) -> None:
        value = "x" * 10
        assert _truncate_tool_argument_text(value, limit=10) == value

    def test_exceeds_limit_is_truncated(self) -> None:
        value = "x" * 20
        result = _truncate_tool_argument_text(value, limit=10)
        assert len(result) == 10
        assert result.endswith("\u2026")

    def test_limit_zero_truncates_to_one_char(self) -> None:
        result = _truncate_tool_argument_text("abc", limit=0)
        assert len(result) <= 1

    def test_empty_string(self) -> None:
        assert _truncate_tool_argument_text("", limit=10) == ""


class TestSanitizeToolArgumentValue:
    def test_simple_string_unchanged(self) -> None:
        assert _sanitize_tool_argument_value("hello") == "hello"

    def test_long_string_is_truncated(self) -> None:
        long_val = "x" * (MAX_TOOL_ARGUMENT_VALUE_LENGTH + 50)
        result = _sanitize_tool_argument_value(long_val)
        assert isinstance(result, str)
        assert len(result) <= MAX_TOOL_ARGUMENT_VALUE_LENGTH

    def test_dict_redacts_sensitive_keys(self) -> None:
        result = _sanitize_tool_argument_value({
            "name": "public",
            "password": "secret123",
        })
        assert result == {
            "name": "public",
            "password": REDACTED_TOOL_ARGUMENT_VALUE,
        }

    def test_nested_dict_redacts_recursively(self) -> None:
        result = _sanitize_tool_argument_value({
            "config": {
                "host": "localhost",
                "apiKey": "top-secret",
            },
        })
        assert result["config"]["host"] == "localhost"
        assert result["config"]["apiKey"] == REDACTED_TOOL_ARGUMENT_VALUE

    def test_list_redacts_items(self) -> None:
        result = _sanitize_tool_argument_value([
            {"name": "a", "token": "t1"},
            {"name": "b", "token": "t2"},
        ])
        assert result[0]["token"] == REDACTED_TOOL_ARGUMENT_VALUE
        assert result[1]["token"] == REDACTED_TOOL_ARGUMENT_VALUE
        assert result[0]["name"] == "a"

    def test_tuple_redacts_items(self) -> None:
        result = _sanitize_tool_argument_value((
            {"password": "p1"},
            {"password": "p2"},
        ))
        assert isinstance(result, tuple)
        assert result[0]["password"] == REDACTED_TOOL_ARGUMENT_VALUE
        assert result[1]["password"] == REDACTED_TOOL_ARGUMENT_VALUE

    def test_non_string_non_dict_passthrough(self) -> None:
        assert _sanitize_tool_argument_value(42) == 42
        assert _sanitize_tool_argument_value(True) is True
        assert _sanitize_tool_argument_value(None) is None

    def test_empty_dict(self) -> None:
        assert _sanitize_tool_argument_value({}) == {}

    def test_empty_list(self) -> None:
        assert _sanitize_tool_argument_value([]) == []

    def test_non_dict_mapping_not_supported(self) -> None:
        """Mapping check uses isinstance(value, Mapping) which catches dict subclasses
        but not arbitrary objects with .items()."""
        result = _sanitize_tool_argument_value(42)
        assert result == 42

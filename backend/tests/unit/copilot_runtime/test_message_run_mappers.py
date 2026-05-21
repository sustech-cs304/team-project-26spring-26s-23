from __future__ import annotations

from app.copilot_runtime.contracts import RuntimeThinkingSelection, RuntimeThinkingValue
from app.copilot_runtime.runs.message_run_mappers import (
    build_thinking_fail_fast_message,
    resolve_applied_thinking_selection,
    to_runtime_thinking_selection,
)


class _AttrsObject:
    def __init__(self, **kwargs: object) -> None:
        for key, value in kwargs.items():
            setattr(self, key, value)


def _make_code_selection(code: str, *, series: str = "unified-4-level-v1") -> RuntimeThinkingSelection:
    return RuntimeThinkingSelection(
        series=series,
        value=RuntimeThinkingValue(valueType="code", code=code, labelZh=code),
    )


def _make_budget_selection(tokens: int, *, series: str = "anthropic-budget-v1") -> RuntimeThinkingSelection:
    return RuntimeThinkingSelection(
        series=series,
        value=RuntimeThinkingValue(
            valueType="budget",
            mode="budget",
            budgetTokens=tokens,
            labelZh=f"{tokens} Tokens",
        ),
    )


class TestResolveAppliedThinkingSelection:
    def test_returns_none_when_applied_is_none(self) -> None:
        result = resolve_applied_thinking_selection(
            requested_selection=_make_code_selection("medium"),
            requested_canonical_selection=_make_code_selection("medium"),
            applied_canonical_selection=None,
            capability_series="unified-4-level-v1",
        )
        assert result is None

    def test_returns_requested_when_canonical_selections_match(self) -> None:
        requested = _make_code_selection("high")
        result = resolve_applied_thinking_selection(
            requested_selection=requested,
            requested_canonical_selection=_make_code_selection("high"),
            applied_canonical_selection=_make_code_selection("high"),
            capability_series="unified-4-level-v1",
        )
        assert result is requested

    def test_returns_requested_when_match_with_none_requested(self) -> None:
        result = resolve_applied_thinking_selection(
            requested_selection=None,
            requested_canonical_selection=None,
            applied_canonical_selection=_make_code_selection("medium"),
            capability_series="unified-4-level-v1",
        )
        assert result is not None
        assert result.series == "unified-4-level-v1"
        assert result.value.valueType == "code"
        assert result.value.code == "medium"

    def test_converts_applied_when_no_requested_selection(self) -> None:
        result = resolve_applied_thinking_selection(
            requested_selection=None,
            requested_canonical_selection=_make_code_selection("low"),
            applied_canonical_selection=_make_code_selection("high"),
            capability_series="unified-4-level-v1",
        )
        assert result is not None
        assert result.value.code == "high"

    def test_converts_applied_when_mismatch(self) -> None:
        result = resolve_applied_thinking_selection(
            requested_selection=_make_code_selection("medium"),
            requested_canonical_selection=_make_code_selection("medium"),
            applied_canonical_selection=_make_code_selection("low"),
            capability_series="unified-4-level-v1",
        )
        assert result is not None
        assert result.value.code == "low"

    def test_converts_from_dict_applied(self) -> None:
        applied_dict = {"kind": "preset", "value": "high"}
        result = resolve_applied_thinking_selection(
            requested_selection=_make_code_selection("medium"),
            requested_canonical_selection=_make_code_selection("medium"),
            applied_canonical_selection=applied_dict,
            capability_series="unified-4-level-v1",
        )
        assert result is not None
        assert result.series == "unified-4-level-v1"
        assert result.value.valueType == "code"
        assert result.value.code == "high"


class TestToRuntimeThinkingSelection:
    def test_passthrough_when_already_selection(self) -> None:
        original = _make_code_selection("high", series="my-series")
        result = to_runtime_thinking_selection(selection=original, series="ignored")
        assert result is original

    def test_from_dict_budget_with_budget_tokens(self) -> None:
        result = to_runtime_thinking_selection(
            selection={"kind": "budget", "budget_tokens": 4096},
            series="anthropic-budget-v1",
        )
        assert result is not None
        assert result.series == "anthropic-budget-v1"
        assert result.value.valueType == "budget"
        assert result.value.mode == "budget"
        assert result.value.budgetTokens == 4096

    def test_from_dict_budget_with_budget_tokens_camel_case(self) -> None:
        result = to_runtime_thinking_selection(
            selection={"kind": "budget", "budgetTokens": 8192},
            series="anthropic-budget-v1",
        )
        assert result is not None
        assert result.value.budgetTokens == 8192

    def test_from_dict_preset(self) -> None:
        result = to_runtime_thinking_selection(
            selection={"kind": "preset", "value": "low"},
            series="unified-4-level-v1",
        )
        assert result is not None
        assert result.series == "unified-4-level-v1"
        assert result.value.valueType == "code"
        assert result.value.code == "low"

    def test_from_dict_preset_strips_value(self) -> None:
        result = to_runtime_thinking_selection(
            selection={"kind": "preset", "value": "  medium  "},
            series="unified-4-level-v1",
        )
        assert result is not None
        assert result.value.code == "medium"

    def test_from_dict_preset_empty_value_returns_none(self) -> None:
        result = to_runtime_thinking_selection(
            selection={"kind": "preset", "value": "   "},
            series="unified-4-level-v1",
        )
        assert result is None

    def test_from_dict_preset_missing_value_returns_none(self) -> None:
        result = to_runtime_thinking_selection(
            selection={"kind": "preset"},
            series="unified-4-level-v1",
        )
        assert result is None

    def test_from_dict_budget_negative_tokens_returns_none(self) -> None:
        result = to_runtime_thinking_selection(
            selection={"kind": "budget", "budget_tokens": -1},
            series="anthropic-budget-v1",
        )
        assert result is None

    def test_from_dict_budget_bool_tokens_returns_none(self) -> None:
        result = to_runtime_thinking_selection(
            selection={"kind": "budget", "budget_tokens": True},
            series="anthropic-budget-v1",
        )
        assert result is None

    def test_from_dict_budget_string_tokens_returns_none(self) -> None:
        result = to_runtime_thinking_selection(
            selection={"kind": "budget", "budget_tokens": "4096"},
            series="anthropic-budget-v1",
        )
        assert result is None

    def test_from_dict_no_kind_returns_none(self) -> None:
        result = to_runtime_thinking_selection(
            selection={"value": "high"},
            series="unified-4-level-v1",
        )
        assert result is None

    def test_from_dict_unknown_kind_returns_none(self) -> None:
        result = to_runtime_thinking_selection(
            selection={"kind": "unknown_type", "value": "high"},
            series="unified-4-level-v1",
        )
        assert result is None

    def test_from_object_budget(self) -> None:
        obj = _AttrsObject(kind="budget", budget_tokens=2048)
        result = to_runtime_thinking_selection(selection=obj, series="gemini-2.5-budget-v1")
        assert result is not None
        assert result.series == "gemini-2.5-budget-v1"
        assert result.value.valueType == "budget"
        assert result.value.budgetTokens == 2048

    def test_from_object_preset(self) -> None:
        obj = _AttrsObject(kind="preset", value="high")
        result = to_runtime_thinking_selection(selection=obj, series="unified-4-level-v1")
        assert result is not None
        assert result.value.valueType == "code"
        assert result.value.code == "high"

    def test_from_object_budget_camel_case_attr(self) -> None:
        obj = _AttrsObject(kind="budget", budgetTokens=16384)
        result = to_runtime_thinking_selection(selection=obj, series="anthropic-budget-v1")
        assert result is not None
        assert result.value.budgetTokens == 16384

    def test_from_object_no_kind_returns_none(self) -> None:
        obj = _AttrsObject(value="high")
        result = to_runtime_thinking_selection(selection=obj, series="unified-4-level-v1")
        assert result is None


class TestBuildThinkingFailFastMessage:
    def test_mapping_failed_code(self) -> None:
        selection = _make_code_selection("high", series="my-series")
        message = build_thinking_fail_fast_message(
            code="thinking_series_mapping_failed",
            requested_selection=selection,
        )
        assert "无法映射为当前模型路由的 provider 参数" in message
        assert "my-series" in message

    def test_value_not_allowed_code(self) -> None:
        selection = _make_code_selection("xhigh", series="openai-6-level-superset-v1")
        message = build_thinking_fail_fast_message(
            code="thinking_series_value_not_allowed",
            requested_selection=selection,
        )
        assert "不在当前模型路由允许集合中" in message
        assert "openai-6-level-superset-v1" in message

    def test_builder_missing_code(self) -> None:
        selection = _make_code_selection("medium", series="my-custom-series")
        message = build_thinking_fail_fast_message(
            code="thinking_series_builder_missing",
            requested_selection=selection,
        )
        assert "缺少 Thinking 系列" in message
        assert "my-custom-series" in message

    def test_unknown_without_override_code(self) -> None:
        selection = _make_code_selection("low", series="unified-4-level-v1")
        message = build_thinking_fail_fast_message(
            code="thinking_series_unknown_without_override",
            requested_selection=selection,
        )
        assert "未解析出 Thinking 系列" in message
        assert "未提供 override 系列模板" in message

    def test_fallback_for_unknown_code(self) -> None:
        selection = _make_code_selection("high", series="any-series")
        message = build_thinking_fail_fast_message(
            code="some_other_error",
            requested_selection=selection,
        )
        assert "不适用于当前模型路由" in message
        assert "any-series" in message
        assert "请求已终止" in message

    def test_includes_requested_value_in_message(self) -> None:
        selection = _make_budget_selection(4096)
        message = build_thinking_fail_fast_message(
            code="thinking_series_mapping_failed",
            requested_selection=selection,
        )
        assert "4096" in message

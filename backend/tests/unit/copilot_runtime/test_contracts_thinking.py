from __future__ import annotations

import pytest

from app.copilot_runtime._contracts.thinking import (
    _build_reasoning_suppression_basis,
    _build_runtime_thinking_value_from_legacy,
    _coerce_mapping_dict,
    _coerce_runtime_code_thinking_value,
    _coerce_runtime_budget_thinking_value,
    _coerce_runtime_fixed_thinking_value,
    _coerce_runtime_thinking_selection,
    _coerce_runtime_thinking_value,
    _resolve_policy_thinking_selection,
    _resolve_policy_thinking_level_intent,
)
from app.copilot_runtime.contracts import (
    RuntimeThinkingSelection,
    RuntimeThinkingValue,
)


# ---------------------------------------------------------------------------
# _coerce_runtime_thinking_selection
# ---------------------------------------------------------------------------


def test_coerce_selection_returns_same_instance_if_already_typed() -> None:
    value = RuntimeThinkingValue(valueType="code", code="medium", labelZh="中")
    selection = RuntimeThinkingSelection(
        series="unified-4-level-v1", value=value
    )
    result = _coerce_runtime_thinking_selection(selection)
    assert result is selection


def test_coerce_selection_returns_none_for_none() -> None:
    assert _coerce_runtime_thinking_selection(None) is None


def test_coerce_selection_from_dict_with_code_value() -> None:
    result = _coerce_runtime_thinking_selection(
        {
            "series": "unified-4-level-v1",
            "value": {"valueType": "code", "code": "medium", "labelZh": "中"},
        }
    )
    assert result is not None
    assert result.series == "unified-4-level-v1"
    assert result.value.valueType == "code"
    assert result.value.code == "medium"


def test_coerce_selection_from_dict_with_budget_value() -> None:
    result = _coerce_runtime_thinking_selection(
        {
            "series": "anthropic-budget-v1",
            "value": {"valueType": "budget", "mode": "budget", "budgetTokens": 4096},
        }
    )
    assert result is not None
    assert result.series == "anthropic-budget-v1"
    assert result.value.valueType == "budget"
    assert result.value.budgetTokens == 4096


def test_coerce_selection_from_object_with_attrs() -> None:
    class FakeObj:
        series = "unified-4-level-v1"
        value = RuntimeThinkingValue(valueType="code", code="low", labelZh="低")

    result = _coerce_runtime_thinking_selection(FakeObj())
    assert result is not None
    assert result.series == "unified-4-level-v1"
    assert result.value.code == "low"


def test_coerce_selection_from_dict_with_legacy_mode_level_fields() -> None:
    result = _coerce_runtime_thinking_selection(
        {
            "series": "legacy-series-v1",
            "mode": "preset",
            "level": "medium",
        }
    )
    assert result is not None
    assert result.series == "legacy-series-v1"
    assert result.value.valueType == "code"
    assert result.value.code == "medium"


def test_coerce_selection_from_dict_with_legacy_budget_mode() -> None:
    result = _coerce_runtime_thinking_selection(
        {
            "series": "budget-series-v1",
            "mode": "budget",
            "budgetTokens": 2048,
        }
    )
    assert result is not None
    assert result.series == "budget-series-v1"
    assert result.value.valueType == "budget"
    assert result.value.mode == "budget"
    assert result.value.budgetTokens == 2048


def test_coerce_selection_returns_none_when_series_missing() -> None:
    assert _coerce_runtime_thinking_selection({}) is None


def test_coerce_selection_returns_none_when_series_empty_string() -> None:
    assert _coerce_runtime_thinking_selection({"series": ""}) is None


def test_coerce_selection_returns_none_when_series_whitespace_only() -> None:
    assert _coerce_runtime_thinking_selection({"series": "   "}) is None


def test_coerce_selection_returns_none_for_unrecognized_value_shape() -> None:
    result = _coerce_runtime_thinking_selection(
        {"series": "some-series", "value": {"unrecognized": 42}}
    )
    assert result is None


def test_coerce_selection_from_object_with_snake_case_attrs() -> None:
    class FakeObj:
        series = "test-series"
        value = None
        mode = "preset"
        level = "high"
        budget_tokens = None

    result = _coerce_runtime_thinking_selection(FakeObj())
    assert result is not None
    assert result.series == "test-series"
    assert result.value.valueType == "code"
    assert result.value.code == "high"


def test_coerce_selection_from_object_with_empty_level_but_budget() -> None:
    class FakeObj:
        series = "test-series"
        value = None
        mode = "budget"
        level = None
        budget_tokens = 1024

    result = _coerce_runtime_thinking_selection(FakeObj())
    assert result is not None
    assert result.series == "test-series"
    assert result.value.valueType == "budget"
    assert result.value.budgetTokens == 1024


def test_coerce_selection_budget_mode_without_budget_tokens_returns_none() -> None:
    result = _coerce_runtime_thinking_selection(
        {
            "series": "test-series",
            "mode": "budget",
        }
    )
    assert result is None


def test_coerce_selection_negative_budget_tokens_treated_as_invalid() -> None:
    result = _coerce_runtime_thinking_selection(
        {
            "series": "test-series",
            "mode": "budget",
            "budgetTokens": -1,
        }
    )
    assert result is None


def test_coerce_selection_budget_tokens_boolean_rejected() -> None:
    result = _coerce_runtime_thinking_selection(
        {
            "series": "test-series",
            "mode": "budget",
            "budgetTokens": True,
        }
    )
    assert result is None


def test_coerce_selection_auto_value_type_detection_from_dict() -> None:
    result = _coerce_runtime_thinking_selection(
        {
            "series": "unified-4-level-v1",
            "value": {"valueType": "fixed", "code": "fixed", "labelZh": "固定"},
        }
    )
    assert result is not None
    assert result.value.valueType == "fixed"
    assert result.value.code == "fixed"


def test_coerce_selection_handles_series_with_leading_trailing_whitespace() -> None:
    result = _coerce_runtime_thinking_selection(
        {"series": "  my-series  ", "level": "off"}
    )
    assert result is not None
    assert result.series == "my-series"


# ---------------------------------------------------------------------------
# _coerce_runtime_thinking_value
# ---------------------------------------------------------------------------


def test_coerce_value_returns_same_typed_instance() -> None:
    value = RuntimeThinkingValue(valueType="code", code="medium", labelZh="中")
    result = _coerce_runtime_thinking_value(value)
    assert result is value


def test_coerce_value_from_dict_code() -> None:
    result = _coerce_runtime_thinking_value(
        {"valueType": "code", "code": "high", "labelZh": "高"}
    )
    assert result is not None
    assert result.valueType == "code"
    assert result.code == "high"
    assert result.labelZh == "高"


def test_coerce_value_from_dict_budget() -> None:
    result = _coerce_runtime_thinking_value(
        {"valueType": "budget", "mode": "dynamic", "labelZh": "动态"}
    )
    assert result is not None
    assert result.valueType == "budget"
    assert result.mode == "dynamic"


def test_coerce_value_from_dict_fixed() -> None:
    result = _coerce_runtime_thinking_value(
        {"valueType": "fixed", "code": "fixed", "labelZh": "固定推理"}
    )
    assert result is not None
    assert result.valueType == "fixed"
    assert result.code == "fixed"


def test_coerce_value_from_dict_unknown_type_returns_none() -> None:
    assert _coerce_runtime_thinking_value({"valueType": "unknown"}) is None


def test_coerce_value_from_object_with_snake_case_fields() -> None:
    class FakeValue:
        value_type = "code"
        code = "low"
        label_zh = "低"

    result = _coerce_runtime_thinking_value(FakeValue())
    assert result is not None
    assert result.valueType == "code"
    assert result.code == "low"
    assert result.labelZh == "低"


def test_coerce_value_budget_mode_off() -> None:
    result = _coerce_runtime_thinking_value(
        {"valueType": "budget", "mode": "off", "labelZh": "关闭"}
    )
    assert result is not None
    assert result.valueType == "budget"
    assert result.mode == "off"


def test_coerce_value_budget_mode_budget_with_tokens() -> None:
    result = _coerce_runtime_thinking_value(
        {"valueType": "budget", "mode": "budget", "budgetTokens": 8192}
    )
    assert result is not None
    assert result.valueType == "budget"
    assert result.mode == "budget"
    assert result.budgetTokens == 8192


def test_coerce_value_budget_mode_dynamic_from_object() -> None:
    class FakeValue:
        value_type = "budget"
        mode = "dynamic"
        label_zh = "动态"

    result = _coerce_runtime_thinking_value(FakeValue())
    assert result is not None
    assert result.valueType == "budget"
    assert result.mode == "dynamic"


def test_coerce_value_from_none_like_input() -> None:
    assert _coerce_runtime_thinking_value(None) is None
    assert _coerce_runtime_thinking_value(42) is None
    assert _coerce_runtime_thinking_value("not-a-dict") is None


# ---------------------------------------------------------------------------
# _coerce_runtime_code_thinking_value
# ---------------------------------------------------------------------------


def test_coerce_code_value_normal() -> None:
    result = _coerce_runtime_code_thinking_value("medium", label_zh="中")
    assert result is not None
    assert result.valueType == "code"
    assert result.code == "medium"


def test_coerce_code_value_empty_string() -> None:
    assert _coerce_runtime_code_thinking_value("", label_zh="") is None


def test_coerce_code_value_none() -> None:
    assert _coerce_runtime_code_thinking_value(None, label_zh=None) is None


# ---------------------------------------------------------------------------
# _coerce_runtime_budget_thinking_value
# ---------------------------------------------------------------------------


def test_coerce_budget_value_normal() -> None:
    result = _coerce_runtime_budget_thinking_value(
        "budget", 4096, label_zh=None
    )
    assert result is not None
    assert result.valueType == "budget"
    assert result.mode == "budget"
    assert result.budgetTokens == 4096


def test_coerce_budget_value_off() -> None:
    result = _coerce_runtime_budget_thinking_value("off", None, label_zh=None)
    assert result is not None
    assert result.valueType == "budget"
    assert result.mode == "off"
    assert result.budgetTokens is None


def test_coerce_budget_value_unknown_mode_returns_none() -> None:
    assert (
        _coerce_runtime_budget_thinking_value("unknown", None, label_zh=None)
        is None
    )


def test_coerce_budget_value_mode_budget_without_tokens_returns_none() -> None:
    assert (
        _coerce_runtime_budget_thinking_value("budget", None, label_zh=None)
        is None
    )


# ---------------------------------------------------------------------------
# _coerce_runtime_fixed_thinking_value
# ---------------------------------------------------------------------------


def test_coerce_fixed_value_normal() -> None:
    result = _coerce_runtime_fixed_thinking_value("fixed", label_zh="固定推理")
    assert result is not None
    assert result.valueType == "fixed"
    assert result.code == "fixed"


def test_coerce_fixed_value_empty_code_becomes_fixed() -> None:
    result = _coerce_runtime_fixed_thinking_value("", label_zh=None)
    assert result is not None
    assert result.valueType == "fixed"
    assert result.code == "fixed"


def test_coerce_fixed_value_non_fixed_code_returns_none() -> None:
    assert (
        _coerce_runtime_fixed_thinking_value("other", label_zh=None) is None
    )


# ---------------------------------------------------------------------------
# _build_runtime_thinking_value_from_legacy
# ---------------------------------------------------------------------------


def test_build_legacy_value_code() -> None:
    result = _build_runtime_thinking_value_from_legacy(
        mode=None,
        level="medium",
        budget_tokens=None,
        label_zh=None,
    )
    assert result is not None
    assert result.valueType == "code"
    assert result.code == "medium"


def test_build_legacy_value_budget() -> None:
    result = _build_runtime_thinking_value_from_legacy(
        mode="budget",
        level=None,
        budget_tokens=2048,
        label_zh=None,
    )
    assert result is not None
    assert result.valueType == "budget"
    assert result.mode == "budget"
    assert result.budgetTokens == 2048
    assert result.labelZh == "2048"


def test_build_legacy_value_budget_with_label() -> None:
    result = _build_runtime_thinking_value_from_legacy(
        mode="budget",
        level=None,
        budget_tokens=4096,
        label_zh="4k Tokens",
    )
    assert result is not None
    assert result.labelZh == "4k Tokens"


def test_build_legacy_value_budget_without_tokens_returns_none() -> None:
    assert (
        _build_runtime_thinking_value_from_legacy(
            mode="budget", level=None, budget_tokens=None, label_zh=None
        )
        is None
    )


def test_build_legacy_value_budget_with_negative_tokens_returns_none() -> None:
    assert (
        _build_runtime_thinking_value_from_legacy(
            mode="budget", level=None, budget_tokens=-1, label_zh=None
        )
        is None
    )


def test_build_legacy_value_no_mode_no_level_returns_none() -> None:
    assert (
        _build_runtime_thinking_value_from_legacy(
            mode=None, level=None, budget_tokens=None, label_zh=None
        )
        is None
    )


def test_build_legacy_value_level_with_label() -> None:
    result = _build_runtime_thinking_value_from_legacy(
        mode=None,
        level="high",
        budget_tokens=None,
        label_zh="高",
    )
    assert result is not None
    assert result.valueType == "code"
    assert result.code == "high"
    assert result.labelZh == "高"


def test_build_legacy_value_non_budget_mode_falls_through_to_level() -> None:
    result = _build_runtime_thinking_value_from_legacy(
        mode="preset",
        level="low",
        budget_tokens=None,
        label_zh=None,
    )
    assert result is not None
    assert result.valueType == "code"
    assert result.code == "low"


# ---------------------------------------------------------------------------
# _coerce_mapping_dict
# ---------------------------------------------------------------------------


def test_coerce_mapping_dict_returns_dict_for_dict() -> None:
    assert _coerce_mapping_dict({"a": 1}) == {"a": 1}


def test_coerce_mapping_dict_returns_none_for_non_dict() -> None:
    assert _coerce_mapping_dict([1, 2, 3]) is None
    assert _coerce_mapping_dict("string") is None
    assert _coerce_mapping_dict(None) is None


# ---------------------------------------------------------------------------
# _resolve_policy_thinking_selection
# ---------------------------------------------------------------------------


def test_resolve_policy_uses_resolve_method() -> None:
    class Policy:
        def resolve_thinking_selection(self):
            return RuntimeThinkingSelection(
                series="unified-4-level-v1", level="medium"
            )

    result = _resolve_policy_thinking_selection(Policy())
    assert result is not None
    assert result.series == "unified-4-level-v1"
    assert result.value.code == "medium"


def test_resolve_policy_falls_back_to_thinking_selection_attr() -> None:
    class Policy:
        thinkingSelection = RuntimeThinkingSelection(
            series="unified-4-level-v1", level="low"
        )
        thinking_selection = None

    result = _resolve_policy_thinking_selection(Policy())
    assert result is not None
    assert result.value.code == "low"


def test_resolve_policy_falls_back_to_snake_case_attr() -> None:
    value = RuntimeThinkingValue(valueType="code", code="high", labelZh="高")

    class Policy:
        thinkingSelection = None
        thinking_selection = RuntimeThinkingSelection(
            series="test-series", value=value
        )

    result = _resolve_policy_thinking_selection(Policy())
    assert result is not None
    assert result.value.code == "high"


def test_resolve_policy_returns_none_when_no_selection() -> None:
    class Policy:
        thinkingSelection = None
        thinking_selection = None

    assert _resolve_policy_thinking_selection(Policy()) is None


def test_resolve_policy_returns_none_when_resolve_returns_none() -> None:
    class Policy:
        def resolve_thinking_selection(self):
            return None

    assert _resolve_policy_thinking_selection(Policy()) is None


# ---------------------------------------------------------------------------
# _resolve_policy_thinking_level_intent
# ---------------------------------------------------------------------------


def test_resolve_policy_level_intent_returns_level() -> None:
    class Policy:
        def resolve_thinking_selection(self):
            return RuntimeThinkingSelection(
                series="unified-4-level-v1", level="medium"
            )

    assert _resolve_policy_thinking_level_intent(Policy()) == "medium"


def test_resolve_policy_level_intent_returns_none_when_no_selection() -> None:
    class Policy:
        thinkingSelection = None
        thinking_selection = None

    assert _resolve_policy_thinking_level_intent(Policy()) is None


def test_resolve_policy_level_intent_budget_selection_returns_none() -> None:
    class Policy:
        def resolve_thinking_selection(self):
            return RuntimeThinkingSelection(
                series="anthropic-budget-v1",
                mode="budget",
                budgetTokens=4096,
            )

    assert _resolve_policy_thinking_level_intent(Policy()) is None


# ---------------------------------------------------------------------------
# _build_reasoning_suppression_basis
# ---------------------------------------------------------------------------


def test_suppression_basis_returns_none_when_all_inputs_none() -> None:
    assert (
        _build_reasoning_suppression_basis(
            capability=None, applied_selection=None, applied_thinking_level=None
        )
        is None
    )


def test_suppression_basis_from_capability_with_default_visibility() -> None:
    capability = {
        "status": "verified-supported",
        "source": "verified",
        "series": "unified-4-level-v1",
    }
    result = _build_reasoning_suppression_basis(
        capability=capability,
        applied_selection=None,
        applied_thinking_level=None,
    )
    assert result is not None
    assert result["shouldSuppress"] is False
    assert result["reasoningVisibility"] == "visible"
    assert result["reasonCode"] is None
    assert result["source"] == "none"
    assert result["capabilitySource"] == "verified"
    assert result["capabilitySeries"] == "unified-4-level-v1"


def test_suppression_basis_capability_visibility_suppressed() -> None:
    capability = {
        "visibility": {
            "reasoning": "suppressed",
            "supportsSuppression": True,
        },
        "source": "override",
    }
    result = _build_reasoning_suppression_basis(
        capability=capability,
        applied_selection=None,
        applied_thinking_level=None,
    )
    assert result is not None
    assert result["shouldSuppress"] is True
    assert result["source"] == "capability-visibility"
    assert result["reasonCode"] == "capability_visibility_suppressed"
    assert result["capabilitySource"] == "override"


def test_suppression_basis_capability_visibility_hidden() -> None:
    capability = {
        "visibility": {
            "reasoning": "hidden",
            "supportsSuppression": False,
        },
    }
    result = _build_reasoning_suppression_basis(
        capability=capability,
    )
    assert result is not None
    assert result["shouldSuppress"] is True
    assert result["reasonCode"] == "capability_visibility_hidden"
    assert result["supportsSuppression"] is False


def test_suppression_basis_capability_visibility_fixed_no_visible_trace() -> None:
    capability = {
        "visibility": {
            "reasoning": "fixed-no-visible-trace",
            "supportsSuppression": True,
        },
    }
    result = _build_reasoning_suppression_basis(
        capability=capability,
    )
    assert result is not None
    assert result["shouldSuppress"] is True
    assert result["reasonCode"] == "capability_visibility_fixed_no_visible_trace"


def test_suppression_basis_applied_selection_off() -> None:
    capability = {
        "status": "verified-supported",
        "source": "verified",
        "series": "unified-4-level-v1",
    }
    applied = RuntimeThinkingSelection(
        series="unified-4-level-v1", level="off"
    )
    result = _build_reasoning_suppression_basis(
        capability=capability,
        applied_selection=applied,
    )
    assert result is not None
    assert result["shouldSuppress"] is True
    assert result["source"] == "applied-selection"
    assert result["reasonCode"] == "applied_selection_suppressed"
    assert result["appliedThinkingSelection"] is not None
    assert result["appliedThinkingSelection"]["series"] == "unified-4-level-v1"
    assert result["appliedThinkingSelection"]["value"]["code"] == "off"


def test_suppression_basis_applied_selection_none_suppression() -> None:
    capability = {
        "status": "verified-supported",
        "source": "verified",
        "series": "unified-4-level-v1",
    }
    applied = RuntimeThinkingSelection(
        series="unified-4-level-v1", level="none"
    )
    result = _build_reasoning_suppression_basis(
        capability=capability,
        applied_selection=applied,
    )
    assert result is not None
    assert result["shouldSuppress"] is True
    assert result["reasonCode"] == "applied_selection_suppressed"


def test_suppression_basis_applied_selection_budget_mode_not_suppressed() -> None:
    capability = {
        "status": "verified-supported",
        "series": "unified-4-level-v1",
    }
    applied = RuntimeThinkingSelection(
        series="unified-4-level-v1",
        mode="budget",
        budgetTokens=0,
    )
    result = _build_reasoning_suppression_basis(
        capability=capability,
        applied_selection=applied,
    )
    assert result is not None
    assert result["shouldSuppress"] is False


def test_suppression_basis_applied_selection_not_suppressed() -> None:
    capability = {
        "status": "verified-supported",
        "series": "unified-4-level-v1",
    }
    applied = RuntimeThinkingSelection(
        series="unified-4-level-v1", level="medium"
    )
    result = _build_reasoning_suppression_basis(
        capability=capability,
        applied_selection=applied,
    )
    assert result is not None
    assert result["shouldSuppress"] is False
    assert result["reasonCode"] is None


def test_suppression_basis_from_applied_thinking_level() -> None:
    capability = {
        "status": "verified-supported",
        "series": "unified-4-level-v1",
    }
    result = _build_reasoning_suppression_basis(
        capability=capability,
        applied_thinking_level="off",
    )
    assert result is not None
    assert result["shouldSuppress"] is True
    assert result["source"] == "applied-selection"
    assert result["reasonCode"] == "applied_selection_suppressed"


def test_suppression_basis_capability_visibility_overrides_applied_selection() -> None:
    capability = {
        "visibility": {
            "reasoning": "hidden",
            "supportsSuppression": True,
        },
    }
    applied = RuntimeThinkingSelection(
        series="unified-4-level-v1", level="medium"
    )
    result = _build_reasoning_suppression_basis(
        capability=capability,
        applied_selection=applied,
    )
    assert result is not None
    assert result["shouldSuppress"] is True
    assert result["source"] == "capability-visibility"
    assert result["reasonCode"] == "capability_visibility_hidden"


def test_suppression_basis_capability_visible_with_non_suppressive_selection() -> None:
    capability = {
        "visibility": {
            "reasoning": "visible",
            "supportsSuppression": True,
        },
    }
    applied = RuntimeThinkingSelection(
        series="unified-4-level-v1", level="medium"
    )
    result = _build_reasoning_suppression_basis(
        capability=capability,
        applied_selection=applied,
    )
    assert result is not None
    assert result["shouldSuppress"] is False
    assert result["source"] == "none"


def test_suppression_basis_capability_not_a_dict_handled_gracefully() -> None:
    result = _build_reasoning_suppression_basis(
        capability=None,
        applied_selection=None,
        applied_thinking_level="off",
    )
    assert result is not None
    assert result["shouldSuppress"] is True
    assert result["source"] == "applied-selection"
    assert result["capabilitySource"] is None


def test_suppression_basis_budget_value_off_suppresses() -> None:
    applied = RuntimeThinkingSelection(
        series="anthropic-budget-v1",
        mode="budget",
        budgetTokens=4096,
    )
    result = _build_reasoning_suppression_basis(
        capability=None,
        applied_selection=applied,
    )
    assert result is not None
    assert result["shouldSuppress"] is False


def test_suppression_basis_fixed_value_not_in_suppression_list() -> None:
    value = RuntimeThinkingValue(valueType="fixed", code="fixed", labelZh="固定推理")
    applied = RuntimeThinkingSelection(
        series="deepseek-fixed-reasoning-v1", value=value
    )
    result = _build_reasoning_suppression_basis(
        capability=None,
        applied_selection=applied,
    )
    assert result is not None
    assert result["shouldSuppress"] is False

"""Thinking-selection coercion, normalization, and reasoning-suppression helpers.

These pure functions are extracted from contracts.py to keep the main
contract module focused on model definitions and scaffold orchestration.
"""

from __future__ import annotations

from typing import Any, cast

from ..contracts import (
    RuntimeThinkingSelection,
    RuntimeThinkingValue,
    ThinkingLevelIntent,
    _BUDGET_VALUE_MODES,
    _THINKING_LEVEL_VALUES,
)


# ---------------------------------------------------------------------------
# Policy / selection resolution helpers
# ---------------------------------------------------------------------------


def _resolve_policy_thinking_selection(policy: Any) -> RuntimeThinkingSelection | None:
    resolver = getattr(policy, "resolve_thinking_selection", None)
    if callable(resolver):
        return _coerce_runtime_thinking_selection(resolver())
    return _coerce_runtime_thinking_selection(
        getattr(policy, "thinkingSelection", None)
    ) or _coerce_runtime_thinking_selection(getattr(policy, "thinking_selection", None))


def _resolve_policy_thinking_level_intent(policy: Any) -> ThinkingLevelIntent | None:
    selection = _resolve_policy_thinking_selection(policy)
    return None if selection is None else selection.to_legacy_level_intent()


# ---------------------------------------------------------------------------
# RuntimeThinkingSelection coercion
# ---------------------------------------------------------------------------


def _coerce_runtime_thinking_selection(value: Any) -> RuntimeThinkingSelection | None:
    if isinstance(value, RuntimeThinkingSelection):
        return value
    if value is None:
        return None

    if isinstance(value, dict):
        series = value.get("series")
        raw_selection_value = value.get("value")
    else:
        series = getattr(value, "series", None)
        raw_selection_value = getattr(value, "value", None)

    if not isinstance(series, str) or series.strip() == "":
        return None

    selection_value = _coerce_runtime_thinking_value(raw_selection_value)
    if selection_value is not None:
        return RuntimeThinkingSelection(series=series.strip(), value=selection_value)

    if isinstance(value, dict):
        mode = value.get("mode")
        level = value.get("level")
        budget_tokens = value.get("budgetTokens")
    else:
        mode = getattr(value, "mode", None)
        level = getattr(value, "level", None)
        budget_tokens = getattr(
            value, "budgetTokens", getattr(value, "budget_tokens", None)
        )

    normalized_mode = (
        mode.strip() if isinstance(mode, str) and mode.strip() != "" else None
    )
    normalized_level = (
        cast(ThinkingLevelIntent, level)
        if isinstance(level, str) and level in _THINKING_LEVEL_VALUES
        else None
    )
    normalized_budget_tokens = (
        budget_tokens
        if isinstance(budget_tokens, int)
        and not isinstance(budget_tokens, bool)
        and budget_tokens >= 0
        else None
    )
    if normalized_mode == "budget" and normalized_budget_tokens is not None:
        return RuntimeThinkingSelection(
            series=series.strip(),
            value=RuntimeThinkingValue(
                valueType="budget",
                mode="budget",
                budgetTokens=normalized_budget_tokens,
            ),
        )
    if normalized_level is not None:
        return RuntimeThinkingSelection(
            series=series.strip(),
            value=RuntimeThinkingValue(
                valueType="code",
                code=normalized_level,
                labelZh=normalized_level,
            ),
        )
    return None


# ---------------------------------------------------------------------------
# RuntimeThinkingValue field extraction & coercion
# ---------------------------------------------------------------------------


def _extract_runtime_thinking_value_fields(
    value: Any,
) -> tuple[Any, Any, Any, Any, Any]:
    if isinstance(value, dict):
        return (
            value.get("valueType"),
            value.get("code"),
            value.get("mode"),
            value.get("budgetTokens"),
            value.get("labelZh"),
        )
    return (
        getattr(value, "valueType", getattr(value, "value_type", None)),
        getattr(value, "code", None),
        getattr(value, "mode", None),
        getattr(value, "budgetTokens", getattr(value, "budget_tokens", None)),
        getattr(value, "labelZh", getattr(value, "label_zh", None)),
    )


def _normalize_optional_runtime_thinking_label(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() != "" else None


def _coerce_runtime_code_thinking_value(
    code: Any,
    *,
    label_zh: str | None,
) -> RuntimeThinkingValue | None:
    if not isinstance(code, str) or code.strip() == "":
        return None
    return RuntimeThinkingValue(
        valueType="code",
        code=code.strip(),
        labelZh=label_zh,
    )


def _coerce_runtime_budget_thinking_value(
    mode: Any,
    budget_tokens: Any,
    *,
    label_zh: str | None,
) -> RuntimeThinkingValue | None:
    normalized_mode = (
        mode.strip()
        if isinstance(mode, str) and mode.strip() in _BUDGET_VALUE_MODES
        else None
    )
    normalized_budget_tokens = (
        budget_tokens
        if isinstance(budget_tokens, int)
        and not isinstance(budget_tokens, bool)
        and budget_tokens >= 0
        else None
    )
    if normalized_mode is None:
        return None
    if normalized_mode == "budget" and normalized_budget_tokens is None:
        return None
    return RuntimeThinkingValue(
        valueType="budget",
        mode=normalized_mode,
        budgetTokens=normalized_budget_tokens,
        labelZh=label_zh,
    )


def _coerce_runtime_fixed_thinking_value(
    code: Any,
    *,
    label_zh: str | None,
) -> RuntimeThinkingValue | None:
    normalized_code = (
        code.strip() if isinstance(code, str) and code.strip() != "" else "fixed"
    )
    if normalized_code != "fixed":
        return None
    return RuntimeThinkingValue(
        valueType="fixed",
        code="fixed",
        labelZh=label_zh,
    )


def _coerce_runtime_thinking_value(value: Any) -> RuntimeThinkingValue | None:
    if isinstance(value, RuntimeThinkingValue):
        return value
    value_type, code, mode, budget_tokens, label_zh = (
        _extract_runtime_thinking_value_fields(value)
    )
    normalized_label = _normalize_optional_runtime_thinking_label(label_zh)
    if value_type == "code":
        return _coerce_runtime_code_thinking_value(code, label_zh=normalized_label)
    if value_type == "budget":
        return _coerce_runtime_budget_thinking_value(
            mode,
            budget_tokens,
            label_zh=normalized_label,
        )
    if value_type == "fixed":
        return _coerce_runtime_fixed_thinking_value(
            code,
            label_zh=normalized_label,
        )
    return None


# ---------------------------------------------------------------------------
# Legacy → canonical thinking-value construction
# ---------------------------------------------------------------------------


def _build_runtime_thinking_value_from_legacy(
    *,
    mode: str | None,
    level: ThinkingLevelIntent | None,
    budget_tokens: int | None,
    label_zh: str | None,
) -> RuntimeThinkingValue | None:
    normalized_label = (
        label_zh.strip()
        if isinstance(label_zh, str) and label_zh.strip() != ""
        else None
    )
    normalized_mode = (
        mode.strip() if isinstance(mode, str) and mode.strip() != "" else None
    )
    if normalized_mode == "budget":
        if budget_tokens is None or budget_tokens < 0:
            return None
        return RuntimeThinkingValue(
            valueType="budget",
            mode="budget",
            budgetTokens=budget_tokens,
            labelZh=normalized_label or str(budget_tokens),
        )
    if level is not None:
        return RuntimeThinkingValue(
            valueType="code",
            code=level,
            labelZh=normalized_label or level,
        )
    return None


# ---------------------------------------------------------------------------
# Misc helpers shared by scaffold builders
# ---------------------------------------------------------------------------


def _coerce_mapping_dict(value: Any) -> dict[str, Any] | None:
    return dict(value) if isinstance(value, dict) else None


def _build_reasoning_suppression_basis(
    *,
    capability: dict[str, Any] | None,
    applied_selection: RuntimeThinkingSelection | None = None,
    applied_thinking_level: ThinkingLevelIntent | None = None,
) -> dict[str, Any] | None:
    if (
        capability is None
        and applied_selection is None
        and applied_thinking_level is None
    ):
        return None

    capability_visibility = (
        capability.get("visibility") if isinstance(capability, dict) else None
    )
    reasoning_visibility = (
        capability_visibility.get("reasoning")
        if isinstance(capability_visibility, dict)
        and isinstance(capability_visibility.get("reasoning"), str)
        else "visible"
    )
    supports_suppression = (
        capability_visibility.get("supportsSuppression")
        if isinstance(capability_visibility, dict)
        and isinstance(capability_visibility.get("supportsSuppression"), bool)
        else True
    )
    resolved_applied_selection = applied_selection
    if resolved_applied_selection is None and applied_thinking_level is not None:
        resolved_applied_selection = RuntimeThinkingSelection.from_legacy_level_intent(
            applied_thinking_level
        )
    suppression_marker = (
        None
        if resolved_applied_selection is None
        else resolved_applied_selection.value.suppression_marker()
    )
    should_suppress = False
    source = "none"
    reason_code: str | None = None
    visibility_reason_codes = {
        "suppressed": "capability_visibility_suppressed",
        "hidden": "capability_visibility_hidden",
        "fixed-no-visible-trace": "capability_visibility_fixed_no_visible_trace",
    }
    if reasoning_visibility in visibility_reason_codes:
        should_suppress = True
        source = "capability-visibility"
        reason_code = visibility_reason_codes[reasoning_visibility]
    elif suppression_marker in {"off", "none", "disabled", "false"}:
        should_suppress = True
        source = "applied-selection"
        reason_code = "applied_selection_suppressed"

    return {
        "shouldSuppress": should_suppress,
        "source": source,
        "reasonCode": reason_code,
        "appliedThinkingSelection": (
            None
            if resolved_applied_selection is None
            else resolved_applied_selection.to_dict()
        ),
        "reasoningVisibility": reasoning_visibility,
        "supportsSuppression": supports_suppression,
        "capabilitySource": capability.get("source")
        if isinstance(capability, dict)
        else None,
        "capabilitySeries": capability.get("series")
        if isinstance(capability, dict)
        else None,
    }

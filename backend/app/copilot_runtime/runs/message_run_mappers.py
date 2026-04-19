"""Mapping helpers for runtime message run thinking payloads."""

from __future__ import annotations

from typing import Any

from ..contracts import RuntimeThinkingSelection, RuntimeThinkingValue


def resolve_applied_thinking_selection(
    *,
    requested_selection: RuntimeThinkingSelection | None,
    requested_canonical_selection: Any,
    applied_canonical_selection: Any,
    capability_series: str,
) -> RuntimeThinkingSelection | None:
    if applied_canonical_selection is None:
        return None
    if (
        requested_selection is not None
        and requested_canonical_selection is not None
        and requested_canonical_selection == applied_canonical_selection
    ):
        return requested_selection
    return to_runtime_thinking_selection(
        selection=applied_canonical_selection,
        series=capability_series,
    )


def to_runtime_thinking_selection(
    *,
    selection: Any,
    series: str,
) -> RuntimeThinkingSelection | None:
    if isinstance(selection, RuntimeThinkingSelection):
        return selection

    if isinstance(selection, dict):
        kind = selection.get("kind")
        budget_tokens = selection.get("budget_tokens", selection.get("budgetTokens"))
        preset_value = selection.get("value")
    else:
        kind = getattr(selection, "kind", None)
        budget_tokens = getattr(
            selection, "budget_tokens", getattr(selection, "budgetTokens", None)
        )
        preset_value = getattr(selection, "value", None)

    if kind == "budget":
        if (
            not isinstance(budget_tokens, int)
            or isinstance(budget_tokens, bool)
            or budget_tokens < 0
        ):
            return None
        return RuntimeThinkingSelection(
            series=series,
            value=RuntimeThinkingValue(
                valueType="budget",
                mode="budget",
                budgetTokens=budget_tokens,
            ),
        )

    if kind != "preset":
        return None

    normalized_value = preset_value.strip() if isinstance(preset_value, str) else None
    if not normalized_value:
        return None
    return RuntimeThinkingSelection(
        series=series,
        value=RuntimeThinkingValue(
            valueType="code",
            code=normalized_value,
        ),
    )


def build_thinking_fail_fast_message(
    *,
    code: str,
    requested_selection: RuntimeThinkingSelection,
) -> str:
    requested_value = requested_selection.value.to_dict()
    if code == "thinking_series_mapping_failed":
        return (
            f"Thinking 系列 '{requested_selection.series}' 的请求值 {requested_value} 无法映射为当前模型路由的 provider 参数，"
            "请求已在执行前终止。"
        )
    if code == "thinking_series_value_not_allowed":
        return f"Thinking 系列 '{requested_selection.series}' 的请求值 {requested_value} 不在当前模型路由允许集合中。"
    if code == "thinking_series_builder_missing":
        return f"当前模型路由缺少 Thinking 系列 '{requested_selection.series}' 的 provider builder。"
    if code == "thinking_series_unknown_without_override":
        return "当前模型路由未解析出 Thinking 系列，且未提供 override 系列模板，无法发送 Thinking 请求。"
    return f"Thinking 系列 '{requested_selection.series}' 不适用于当前模型路由，请求已终止。"


__all__ = [
    "build_thinking_fail_fast_message",
    "resolve_applied_thinking_selection",
    "to_runtime_thinking_selection",
]

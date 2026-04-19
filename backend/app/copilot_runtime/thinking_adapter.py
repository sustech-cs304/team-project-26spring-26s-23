from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from .contracts import RuntimeThinkingSelection, RuntimeThinkingValue
from .model_routes import ResolvedRuntimeModelRoute
from .provider_adapter_registry import (
    RuntimeProviderAdapterRegistry,
)

ThinkingCapabilityStatus = Literal[
    "verified-supported",
    "verified-unsupported",
    "unknown-without-override",
    "unknown-with-override",
]
ThinkingCapabilitySource = Literal["verified", "override", "unknown"]
ThinkingSeriesEditorType = Literal["discrete", "budget", "fixed"]

_DEFAULT_OVERRIDE_SOURCE = "settings-model-declaration"
_UNIFIED_4_LEVEL_SERIES_ID = "unified-4-level-v1"
_UNIFIED_4_LEVEL_SERIES_LABEL_ZH = "统一 4 档系列"
_THINKING_BUDGET_DEFAULT_MIN_TOKENS = 0
_THINKING_BUDGET_DEFAULT_MAX_TOKENS = 1048576
_THINKING_BUDGET_DEFAULT_STEP_TOKENS = 1024
_THINKING_BUDGET_FIXED_ANCHOR_TOKENS = (0, 4096, 32768, 131072, 1048576)
_UNIFIED_4_LEVEL_CODE_LABELS: dict[str, str] = {
    "none": "无",
    "low": "低",
    "medium": "中",
    "high": "高",
}
_SERIES_ID_ALIASES: dict[str, str] = {
    "openai-4-level-none-v1": _UNIFIED_4_LEVEL_SERIES_ID,
    "anthropic-adaptive-4-v1": _UNIFIED_4_LEVEL_SERIES_ID,
}


@dataclass(frozen=True, slots=True)
class ThinkingSeriesBudgetConfig:
    min_tokens: int
    max_tokens: int
    step_tokens: int
    anchor_tokens: tuple[int, ...] = ()

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "minTokens": self.min_tokens,
            "maxTokens": self.max_tokens,
            "stepTokens": self.step_tokens,
            "anchorTokens": list(self.anchor_tokens),
        }


@dataclass(frozen=True, slots=True)
class ThinkingCapabilityOverrideInput:
    supported: bool
    series: str | None = None
    source: str = _DEFAULT_OVERRIDE_SOURCE
    editor_type: ThinkingSeriesEditorType | None = None
    allowed_values: tuple[RuntimeThinkingValue, ...] = ()
    default_value: RuntimeThinkingValue | None = None
    budget: ThinkingSeriesBudgetConfig | None = None
    visibility: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class CanonicalThinkingCapability:
    status: ThinkingCapabilityStatus
    source: ThinkingCapabilitySource
    series: str | None
    series_label_zh: str | None
    editor_type: ThinkingSeriesEditorType | None
    allowed_values: tuple[RuntimeThinkingValue, ...] = ()
    default_value: RuntimeThinkingValue | None = None
    provider_builder_key: str | None = None
    reason_code: str = "unknown"
    route_fingerprint: dict[str, str] = field(default_factory=dict)
    visibility: dict[str, Any] | None = None

    def to_public_dict(self) -> dict[str, Any]:
        payload = {
            "status": self.status,
            "source": self.source,
            "series": self.series,
            "seriesLabelZh": self.series_label_zh,
            "editorType": self.editor_type,
            "allowedValues": [value.to_dict() for value in self.allowed_values],
            "defaultValue": None
            if self.default_value is None
            else self.default_value.to_dict(),
            "providerBuilderKey": self.provider_builder_key,
            "reasonCode": self.reason_code,
            "routeFingerprint": dict(self.route_fingerprint),
        }
        if self.visibility is not None:
            payload["visibility"] = dict(self.visibility)
        return payload

    def to_diagnostics(self) -> dict[str, Any]:
        payload = {
            **dict(self.route_fingerprint),
            "status": self.status,
            "source": self.source,
            "series": self.series,
            "seriesLabelZh": self.series_label_zh,
            "editorType": self.editor_type,
            "allowedValues": [value.to_dict() for value in self.allowed_values],
            "defaultValue": None
            if self.default_value is None
            else self.default_value.to_dict(),
            "providerBuilderKey": self.provider_builder_key,
            "reasonCode": self.reason_code,
        }
        if self.visibility is not None:
            payload["visibility"] = dict(self.visibility)
        return payload


@dataclass(frozen=True, slots=True)
class ThinkingAdaptationResult:
    requested_selection: RuntimeThinkingSelection | None
    applied_selection: RuntimeThinkingSelection | None
    applied: bool
    reason: str
    capability: CanonicalThinkingCapability
    error_code: str | None = None
    provider_builder_key: str | None = None
    model_settings: dict[str, Any] | None = None
    mapping_reason_code: str | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_public_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "requestedSelection": (
                None
                if self.requested_selection is None
                else self.requested_selection.to_dict()
            ),
            "appliedSelection": (
                None
                if self.applied_selection is None
                else self.applied_selection.to_dict()
            ),
            "applied": self.applied,
            "reasonCode": self.reason,
            "errorCode": self.error_code,
            "providerBuilderKey": self.provider_builder_key,
            "mappingReasonCode": self.mapping_reason_code,
            "capabilityStatus": self.capability.status,
            "capabilitySource": self.capability.source,
            "capabilitySeries": self.capability.series,
            "capabilitySeriesLabelZh": self.capability.series_label_zh,
            "capabilityReasonCode": self.capability.reason_code,
        }
        if self.model_settings is not None:
            payload["modelSettings"] = self.model_settings
        return payload


@dataclass(frozen=True, slots=True)
class _SeriesSpec:
    series_id: str
    label_zh: str
    editor_type: ThinkingSeriesEditorType
    allowed_values: tuple[RuntimeThinkingValue, ...]
    default_value: RuntimeThinkingValue
    provider_builder_key: str | None
    budget: ThinkingSeriesBudgetConfig | None = None
    visibility: dict[str, Any] | None = None

    def build_capability(
        self,
        *,
        status: ThinkingCapabilityStatus,
        source: ThinkingCapabilitySource,
        route_fingerprint: Mapping[str, str],
        reason_code: str,
        provider_builder_key: str | None = None,
    ) -> CanonicalThinkingCapability:
        return CanonicalThinkingCapability(
            status=status,
            source=source,
            series=self.series_id,
            series_label_zh=self.label_zh,
            editor_type=self.editor_type,
            allowed_values=self.allowed_values,
            default_value=self.default_value,
            provider_builder_key=(
                self.provider_builder_key
                if provider_builder_key is None
                else provider_builder_key
            ),
            reason_code=reason_code,
            route_fingerprint=dict(route_fingerprint),
            visibility=None if self.visibility is None else dict(self.visibility),
        )


def _code_value(code: str, label_zh: str) -> RuntimeThinkingValue:
    return RuntimeThinkingValue(valueType="code", code=code, labelZh=label_zh)


def _budget_value(
    mode: Literal["off", "dynamic", "budget"],
    label_zh: str,
    budget_tokens: int | None = None,
) -> RuntimeThinkingValue:
    return RuntimeThinkingValue(
        valueType="budget",
        mode=mode,
        budgetTokens=budget_tokens,
        labelZh=label_zh,
    )


def _fixed_value(label_zh: str) -> RuntimeThinkingValue:
    return RuntimeThinkingValue(valueType="fixed", code="fixed", labelZh=label_zh)


def _budget_config(
    min_tokens: int = _THINKING_BUDGET_DEFAULT_MIN_TOKENS,
    max_tokens: int = _THINKING_BUDGET_DEFAULT_MAX_TOKENS,
    step_tokens: int = _THINKING_BUDGET_DEFAULT_STEP_TOKENS,
    anchor_tokens: tuple[int, ...] = _THINKING_BUDGET_FIXED_ANCHOR_TOKENS,
) -> ThinkingSeriesBudgetConfig:
    return ThinkingSeriesBudgetConfig(
        min_tokens=min_tokens,
        max_tokens=max(max_tokens, min_tokens),
        step_tokens=max(1, step_tokens),
        anchor_tokens=anchor_tokens,
    )


def _normalize_series_id(series_id: str | None) -> str | None:
    if series_id is None:
        return None
    return _SERIES_ID_ALIASES.get(series_id, series_id)


def _normalize_series_code(series_id: str | None, code: str | None) -> str | None:
    normalized_series = _normalize_series_id(series_id)
    normalized_code = _normalize_optional_string(code)
    if normalized_code is None:
        return None
    if normalized_series == _UNIFIED_4_LEVEL_SERIES_ID and normalized_code in {
        "disabled",
        "off",
    }:
        return "none"
    return normalized_code


def _normalize_series_value(
    series_id: str | None,
    value: RuntimeThinkingValue,
) -> RuntimeThinkingValue:
    normalized_series = _normalize_series_id(series_id)
    if normalized_series != _UNIFIED_4_LEVEL_SERIES_ID or value.valueType != "code":
        return value
    normalized_code = _normalize_series_code(normalized_series, value.code)
    if normalized_code is None:
        return value
    return _code_value(
        normalized_code,
        _UNIFIED_4_LEVEL_CODE_LABELS.get(
            normalized_code, value.labelZh or normalized_code
        ),
    )


def _normalize_series_allowed_values(
    series_id: str | None,
    values: tuple[RuntimeThinkingValue, ...],
) -> tuple[RuntimeThinkingValue, ...]:
    normalized_values = tuple(
        _normalize_series_value(series_id, value) for value in values
    )
    normalized_series = _normalize_series_id(series_id)
    if normalized_series != _UNIFIED_4_LEVEL_SERIES_ID:
        return normalized_values

    deduped_values: list[RuntimeThinkingValue] = []
    seen_codes: set[str] = set()
    for value in normalized_values:
        if value.valueType != "code":
            deduped_values.append(value)
            continue
        code = value.code
        if code is None:
            deduped_values.append(value)
            continue
        if code in seen_codes:
            continue
        seen_codes.add(code)
        deduped_values.append(value)
    return tuple(deduped_values)


_SERIES_REGISTRY: dict[str, _SeriesSpec] = {
    "openai-6-level-superset-v1": _SeriesSpec(
        series_id="openai-6-level-superset-v1",
        label_zh="OpenAI 6 档总超集",
        editor_type="discrete",
        allowed_values=(
            _code_value("none", "无"),
            _code_value("minimal", "极简"),
            _code_value("low", "低"),
            _code_value("medium", "中"),
            _code_value("high", "高"),
            _code_value("xhigh", "超高"),
        ),
        default_value=_code_value("medium", "中"),
        provider_builder_key="openai_reasoning_effort_v1",
    ),
    "openai-4-level-minimal-v1": _SeriesSpec(
        series_id="openai-4-level-minimal-v1",
        label_zh="OpenAI 4 档 Minimal 系",
        editor_type="discrete",
        allowed_values=(
            _code_value("minimal", "极简"),
            _code_value("low", "低"),
            _code_value("medium", "中"),
            _code_value("high", "高"),
        ),
        default_value=_code_value("medium", "中"),
        provider_builder_key="openai_reasoning_effort_v1",
    ),
    _UNIFIED_4_LEVEL_SERIES_ID: _SeriesSpec(
        series_id=_UNIFIED_4_LEVEL_SERIES_ID,
        label_zh=_UNIFIED_4_LEVEL_SERIES_LABEL_ZH,
        editor_type="discrete",
        allowed_values=(
            _code_value("none", "无"),
            _code_value("low", "低"),
            _code_value("medium", "中"),
            _code_value("high", "高"),
        ),
        default_value=_code_value("medium", "中"),
        provider_builder_key=None,
    ),
    "anthropic-budget-v1": _SeriesSpec(
        series_id="anthropic-budget-v1",
        label_zh="Anthropic Budget",
        editor_type="budget",
        allowed_values=(_budget_value("off", "关闭"),),
        default_value=_budget_value("off", "关闭"),
        provider_builder_key="anthropic_budget_v1",
        budget=_budget_config(),
    ),
    "gemini-2.5-budget-v1": _SeriesSpec(
        series_id="gemini-2.5-budget-v1",
        label_zh="Gemini 2.5 Budget",
        editor_type="budget",
        allowed_values=(
            _budget_value("off", "关闭"),
            _budget_value("dynamic", "动态"),
        ),
        default_value=_budget_value("dynamic", "动态"),
        provider_builder_key="gemini_budget_v1",
        budget=_budget_config(),
    ),
    "qwen-thinking-switch-v1": _SeriesSpec(
        series_id="qwen-thinking-switch-v1",
        label_zh="Qwen Thinking 开关",
        editor_type="discrete",
        allowed_values=(
            _code_value("false", "关闭"),
            _code_value("true", "开启"),
        ),
        default_value=_code_value("true", "开启"),
        provider_builder_key="qwen_switch_v1",
    ),
    "deepseek-fixed-reasoning-v1": _SeriesSpec(
        series_id="deepseek-fixed-reasoning-v1",
        label_zh="DeepSeek 固定推理",
        editor_type="fixed",
        allowed_values=(_fixed_value("固定推理"),),
        default_value=_fixed_value("固定推理"),
        provider_builder_key="fixed_reasoning_v1",
        visibility={
            "reasoning": "fixed-no-visible-trace",
            "supportsSuppression": True,
        },
    ),
}


ProviderBuilder = Callable[[RuntimeThinkingValue], tuple[dict[str, Any], str] | None]


def _build_openai_reasoning_effort(
    value: RuntimeThinkingValue,
) -> tuple[dict[str, Any], str] | None:
    if value.valueType != "code" or value.code is None:
        return None
    if value.code not in {"none", "minimal", "low", "medium", "high", "xhigh"}:
        return None
    return ({"reasoning_effort": value.code}, f"openai_reasoning_effort_{value.code}")


def _build_gemini_budget(
    value: RuntimeThinkingValue,
) -> tuple[dict[str, Any], str] | None:
    if value.valueType != "budget" or value.mode is None:
        return None
    if value.mode == "off":
        return ({"extra_body": {"thinking": {"type": "off"}}}, "gemini_budget_off")
    if value.mode == "dynamic":
        return (
            {"extra_body": {"thinking": {"type": "dynamic"}}},
            "gemini_budget_dynamic",
        )
    if value.mode == "budget" and value.budgetTokens is not None:
        return (
            {
                "extra_body": {
                    "thinking": {
                        "type": "budget_tokens",
                        "budget_tokens": value.budgetTokens,
                    }
                }
            },
            "gemini_budget_tokens",
        )
    return None


def _build_anthropic_budget(
    value: RuntimeThinkingValue,
) -> tuple[dict[str, Any], str] | None:
    if value.valueType != "budget" or value.mode is None:
        return None
    if value.mode == "off":
        return ({"thinking": {"type": "off"}}, "anthropic_budget_off")
    if value.mode == "budget" and value.budgetTokens is not None:
        return (
            {"thinking": {"budget_tokens": value.budgetTokens}},
            "anthropic_budget_tokens",
        )
    return None


def _build_anthropic_adaptive_reasoning(
    value: RuntimeThinkingValue,
) -> tuple[dict[str, Any], str] | None:
    if value.valueType != "code" or value.code is None:
        return None
    if value.code == "none":
        return ({"thinking": {"type": "disabled"}}, "anthropic_adaptive_disabled")
    if value.code in {"low", "medium", "high"}:
        return (
            {"thinking": {"type": "adaptive", "effort": value.code}},
            f"anthropic_adaptive_{value.code}",
        )
    return None


def _build_qwen_switch(
    value: RuntimeThinkingValue,
) -> tuple[dict[str, Any], str] | None:
    if value.valueType != "code" or value.code not in {"true", "false"}:
        return None
    return (
        {"extra_body": {"enable_thinking": value.code == "true"}},
        f"qwen_switch_{value.code}",
    )


def _build_fixed_reasoning(
    _value: RuntimeThinkingValue,
) -> tuple[dict[str, Any], str] | None:
    return ({}, "fixed_reasoning_locked")


_PROVIDER_BUILDERS: dict[str, ProviderBuilder] = {
    "openai_reasoning_effort_v1": _build_openai_reasoning_effort,
    "gemini_budget_v1": _build_gemini_budget,
    "anthropic_budget_v1": _build_anthropic_budget,
    "anthropic_adaptive_reasoning_v1": _build_anthropic_adaptive_reasoning,
    "qwen_switch_v1": _build_qwen_switch,
    "fixed_reasoning_v1": _build_fixed_reasoning,
}


def _resolve_provider_builder_key(
    series_spec: _SeriesSpec,
    model_route: ResolvedRuntimeModelRoute,
) -> str | None:
    provider = _normalize_identifier(model_route.provider)
    normalized_series_id = _normalize_series_id(series_spec.series_id)
    if normalized_series_id == _UNIFIED_4_LEVEL_SERIES_ID:
        if provider == "openai":
            return "openai_reasoning_effort_v1"
        if provider == "anthropic":
            return "anthropic_adaptive_reasoning_v1"
        return None
    return series_spec.provider_builder_key


def parse_thinking_capability_override(
    raw_override: Mapping[str, Any] | None,
) -> ThinkingCapabilityOverrideInput | None:
    if not isinstance(raw_override, Mapping):
        return None
    supported = raw_override.get("supported")
    if supported not in {True, False}:
        return None
    source = (
        _normalize_optional_string(raw_override.get("source"))
        or _DEFAULT_OVERRIDE_SOURCE
    )
    visibility_record = (
        raw_override.get("visibility")
        if isinstance(raw_override.get("visibility"), Mapping)
        else None
    )
    visibility: dict[str, Any] | None = None
    if visibility_record is not None:
        normalized_visibility: dict[str, Any] = {}
        reasoning = _normalize_optional_string(visibility_record.get("reasoning"))
        if reasoning is not None:
            normalized_visibility["reasoning"] = reasoning
        supports_suppression = visibility_record.get("supportsSuppression")
        if isinstance(supports_suppression, bool):
            normalized_visibility["supportsSuppression"] = supports_suppression
        visibility = normalized_visibility or None
    if supported is False:
        return ThinkingCapabilityOverrideInput(
            supported=False, source=source, visibility=visibility
        )

    series = _normalize_series_id(
        _normalize_optional_string(raw_override.get("series"))
    )
    template_record = raw_override.get("template")
    base_spec = None if series is None else _SERIES_REGISTRY.get(series)
    editor_type = _parse_editor_type(
        template_record.get("editorType")
        if isinstance(template_record, Mapping)
        else None,
        fallback=None if base_spec is None else base_spec.editor_type,
    )
    allowed_values = _parse_allowed_values(
        template_record.get("allowedValues")
        if isinstance(template_record, Mapping)
        else None,
        fallback=() if base_spec is None else base_spec.allowed_values,
        editor_type=editor_type,
    )
    default_value = _parse_default_value(
        template_record.get("defaultValue")
        if isinstance(template_record, Mapping)
        else None,
        fallback=None if base_spec is None else base_spec.default_value,
        editor_type=editor_type,
        allowed_values=allowed_values,
    )
    budget = _parse_budget_config(
        template_record.get("budget") if isinstance(template_record, Mapping) else None,
        fallback=None if base_spec is None else base_spec.budget,
    )
    return ThinkingCapabilityOverrideInput(
        supported=True,
        series=series,
        source=source,
        editor_type=editor_type,
        allowed_values=allowed_values,
        default_value=default_value,
        budget=budget,
        visibility=visibility,
    )


def resolve_canonical_thinking_capability(
    *,
    model_route: ResolvedRuntimeModelRoute,
    thinking_capability_override: Mapping[str, Any] | None = None,
    provider_adapter_registry: RuntimeProviderAdapterRegistry | None = None,
) -> CanonicalThinkingCapability:
    route_fingerprint = _build_route_fingerprint(model_route)
    verified = _resolve_verified_series_spec(model_route)
    if verified is not None:
        return verified.build_capability(
            status="verified-supported",
            source="verified",
            route_fingerprint=route_fingerprint,
            reason_code="verified_series_resolved",
            provider_builder_key=_resolve_provider_builder_key(verified, model_route),
        )

    override_input = parse_thinking_capability_override(thinking_capability_override)
    if override_input is not None and override_input.supported:
        override_spec = _resolve_override_series_spec(override_input)
        if override_spec is not None:
            return override_spec.build_capability(
                status="unknown-with-override",
                source="override",
                route_fingerprint=route_fingerprint,
                reason_code="override_series_template_applied",
                provider_builder_key=_resolve_provider_builder_key(
                    override_spec, model_route
                ),
            )
        return CanonicalThinkingCapability(
            status="unknown-without-override",
            source="unknown",
            series=None,
            series_label_zh=None,
            editor_type=None,
            allowed_values=(),
            default_value=None,
            provider_builder_key=None,
            reason_code="override_template_invalid",
            route_fingerprint=route_fingerprint,
        )

    if override_input is not None and not override_input.supported:
        return CanonicalThinkingCapability(
            status="unknown-without-override",
            source="unknown",
            series=None,
            series_label_zh=None,
            editor_type=None,
            allowed_values=(),
            default_value=None,
            provider_builder_key=None,
            reason_code="override_declares_unsupported",
            route_fingerprint=route_fingerprint,
        )

    return CanonicalThinkingCapability(
        status="unknown-without-override",
        source="unknown",
        series=None,
        series_label_zh=None,
        editor_type=None,
        allowed_values=(),
        default_value=None,
        provider_builder_key=None,
        reason_code="route_not_verified",
        route_fingerprint=route_fingerprint,
    )


def adapt_thinking_selection(
    *,
    selection: RuntimeThinkingSelection | None,
    model_route: ResolvedRuntimeModelRoute,
    thinking_capability_override: Mapping[str, Any] | None = None,
    provider_adapter_registry: RuntimeProviderAdapterRegistry | None = None,
) -> ThinkingAdaptationResult:
    capability = resolve_canonical_thinking_capability(
        model_route=model_route,
        thinking_capability_override=thinking_capability_override,
        provider_adapter_registry=provider_adapter_registry,
    )
    if selection is None:
        return _build_adaptation_result(
            requested_selection=None,
            applied_selection=None,
            applied=False,
            reason="selection_missing",
            capability=capability,
            error_code=None,
            provider_builder_key=None,
            model_settings=None,
            mapping_reason_code="selection_missing",
        )

    normalized_requested_selection = _normalize_runtime_selection(selection)
    if normalized_requested_selection is None:
        return _build_adaptation_result(
            requested_selection=None,
            applied_selection=None,
            applied=False,
            reason="requested_selection_invalid",
            capability=capability,
            error_code="thinking_series_value_not_allowed",
            provider_builder_key=None,
            model_settings=None,
            mapping_reason_code="requested_selection_invalid",
        )

    if capability.series is None:
        return _build_adaptation_result(
            requested_selection=normalized_requested_selection,
            applied_selection=None,
            applied=False,
            reason="thinking_series_unknown_without_override",
            capability=capability,
            error_code="thinking_series_unknown_without_override",
            provider_builder_key=None,
            model_settings=None,
            mapping_reason_code="series_unresolved",
        )

    if normalized_requested_selection.series != capability.series:
        return _build_adaptation_result(
            requested_selection=normalized_requested_selection,
            applied_selection=None,
            applied=False,
            reason="requested_series_mismatch",
            capability=capability,
            error_code="thinking_series_not_supported_for_route",
            provider_builder_key=capability.provider_builder_key,
            model_settings=None,
            mapping_reason_code="requested_series_mismatch",
        )

    if not _selection_value_allowed(
        normalized_requested_selection.value, capability.allowed_values
    ):
        return _build_adaptation_result(
            requested_selection=normalized_requested_selection,
            applied_selection=None,
            applied=False,
            reason="requested_series_value_not_allowed",
            capability=capability,
            error_code="thinking_series_value_not_allowed",
            provider_builder_key=capability.provider_builder_key,
            model_settings=None,
            mapping_reason_code="requested_value_not_allowed",
        )

    if capability.provider_builder_key is None:
        return _build_adaptation_result(
            requested_selection=normalized_requested_selection,
            applied_selection=None,
            applied=False,
            reason="provider_builder_missing",
            capability=capability,
            error_code="thinking_series_builder_missing",
            provider_builder_key=None,
            model_settings=None,
            mapping_reason_code="provider_builder_missing",
        )

    builder = _PROVIDER_BUILDERS.get(capability.provider_builder_key)
    if builder is None:
        return _build_adaptation_result(
            requested_selection=normalized_requested_selection,
            applied_selection=None,
            applied=False,
            reason="provider_builder_missing",
            capability=capability,
            error_code="thinking_series_builder_missing",
            provider_builder_key=capability.provider_builder_key,
            model_settings=None,
            mapping_reason_code="provider_builder_missing",
        )

    built = builder(normalized_requested_selection.value)
    if built is None:
        return _build_adaptation_result(
            requested_selection=normalized_requested_selection,
            applied_selection=None,
            applied=False,
            reason="thinking_series_mapping_failed",
            capability=capability,
            error_code="thinking_series_mapping_failed",
            provider_builder_key=capability.provider_builder_key,
            model_settings=None,
            mapping_reason_code="provider_builder_rejected_value",
        )

    model_settings, mapping_reason_code = built
    return _build_adaptation_result(
        requested_selection=normalized_requested_selection,
        applied_selection=normalized_requested_selection,
        applied=True,
        reason=(
            "verified_series_builder_applied"
            if capability.source == "verified"
            else "override_series_builder_applied"
        ),
        capability=capability,
        error_code=None,
        provider_builder_key=capability.provider_builder_key,
        model_settings=model_settings,
        mapping_reason_code=mapping_reason_code,
    )


def _build_adaptation_result(
    *,
    requested_selection: RuntimeThinkingSelection | None,
    applied_selection: RuntimeThinkingSelection | None,
    applied: bool,
    reason: str,
    capability: CanonicalThinkingCapability,
    error_code: str | None,
    provider_builder_key: str | None,
    model_settings: dict[str, Any] | None,
    mapping_reason_code: str | None,
) -> ThinkingAdaptationResult:
    diagnostics = {
        **capability.to_diagnostics(),
        "requestedSelection": (
            None if requested_selection is None else requested_selection.to_dict()
        ),
        "appliedSelection": (
            None if applied_selection is None else applied_selection.to_dict()
        ),
        "providerBuilderKey": provider_builder_key,
        "mappingReasonCode": mapping_reason_code,
    }
    if error_code is not None:
        diagnostics["errorCode"] = error_code
    if model_settings is not None:
        diagnostics["modelSettings"] = model_settings
    return ThinkingAdaptationResult(
        requested_selection=requested_selection,
        applied_selection=applied_selection,
        applied=applied,
        reason=reason,
        capability=capability,
        error_code=error_code,
        provider_builder_key=provider_builder_key,
        model_settings=model_settings,
        mapping_reason_code=mapping_reason_code,
        diagnostics=diagnostics,
    )


def _resolve_verified_series_spec(
    model_route: ResolvedRuntimeModelRoute,
) -> _SeriesSpec | None:
    provider = _normalize_identifier(model_route.provider)
    endpoint_type = _normalize_identifier(model_route.endpoint_type)
    model_id = _normalize_identifier(model_route.model_id)
    if provider != "openai" or endpoint_type != "openai-compatible":
        return None
    if (
        model_id == "gpt-5"
        or model_id.startswith("gpt-5-")
        or model_id.endswith("/gpt-5")
    ):
        return _SERIES_REGISTRY["openai-6-level-superset-v1"]
    if (
        model_id == "gpt-4.1"
        or model_id.startswith("gpt-4.1-")
        or model_id.endswith("/gpt-4.1")
    ):
        return _SERIES_REGISTRY["openai-4-level-minimal-v1"]
    if (
        model_id == "gpt-4o"
        or model_id.startswith("gpt-4o-")
        or model_id.endswith("/gpt-4o")
    ):
        return _SERIES_REGISTRY[_UNIFIED_4_LEVEL_SERIES_ID]
    return None


def _resolve_override_series_spec(
    override_input: ThinkingCapabilityOverrideInput,
) -> _SeriesSpec | None:
    normalized_series, base_spec = _resolve_override_base_spec(override_input)
    series_id = _resolve_override_series_id(normalized_series, base_spec)
    editor_type = _resolve_override_editor_type(override_input, base_spec)
    if series_id is None or editor_type is None:
        return None

    label_zh = _resolve_override_label(series_id, base_spec)
    provider_builder_key = _resolve_override_provider_builder_key(base_spec)
    allowed_values = _resolve_override_allowed_values(override_input, base_spec)
    default_value = _resolve_override_default_value(override_input, base_spec)
    budget = _resolve_override_budget(override_input, base_spec)
    visibility = override_input.visibility

    normalized_allowed_values = _normalize_allowed_values(
        editor_type=editor_type,
        allowed_values=allowed_values,
        fallback=() if base_spec is None else base_spec.allowed_values,
    )
    normalized_allowed_values = _normalize_series_allowed_values(
        series_id, normalized_allowed_values
    )
    normalized_default_value = _normalize_default_value(
        editor_type=editor_type,
        default_value=default_value,
        allowed_values=normalized_allowed_values,
        fallback=None if base_spec is None else base_spec.default_value,
        budget=budget,
    )
    if normalized_default_value is not None:
        normalized_default_value = _normalize_series_value(
            series_id, normalized_default_value
        )
    if normalized_default_value is None:
        return None

    if editor_type == "budget":
        budget = budget or (None if base_spec is None else base_spec.budget)
        if budget is None:
            return None

    return _SeriesSpec(
        series_id=series_id,
        label_zh=label_zh,
        editor_type=editor_type,
        allowed_values=normalized_allowed_values,
        default_value=normalized_default_value,
        provider_builder_key=provider_builder_key,
        budget=budget,
        visibility=None if visibility is None else dict(visibility),
    )


def _resolve_override_base_spec(
    override_input: ThinkingCapabilityOverrideInput,
) -> tuple[str | None, _SeriesSpec | None]:
    normalized_series = _normalize_series_id(override_input.series)
    base_spec = (
        None if normalized_series is None else _SERIES_REGISTRY.get(normalized_series)
    )
    return normalized_series, base_spec


def _resolve_override_series_id(
    normalized_series: str | None,
    base_spec: _SeriesSpec | None,
) -> str | None:
    if normalized_series is not None:
        return normalized_series
    if base_spec is None:
        return None
    return base_spec.series_id


def _resolve_override_editor_type(
    override_input: ThinkingCapabilityOverrideInput,
    base_spec: _SeriesSpec | None,
) -> ThinkingSeriesEditorType | None:
    if override_input.editor_type is not None:
        return override_input.editor_type
    if base_spec is None:
        return None
    return base_spec.editor_type


def _resolve_override_label(series_id: str, base_spec: _SeriesSpec | None) -> str:
    if base_spec is None:
        return series_id
    return base_spec.label_zh


def _resolve_override_provider_builder_key(base_spec: _SeriesSpec | None) -> str | None:
    if base_spec is None:
        return None
    return base_spec.provider_builder_key


def _resolve_override_allowed_values(
    override_input: ThinkingCapabilityOverrideInput,
    base_spec: _SeriesSpec | None,
) -> tuple[RuntimeThinkingValue, ...]:
    if len(override_input.allowed_values) > 0:
        return override_input.allowed_values
    if base_spec is None:
        return ()
    return base_spec.allowed_values


def _resolve_override_default_value(
    override_input: ThinkingCapabilityOverrideInput,
    base_spec: _SeriesSpec | None,
) -> RuntimeThinkingValue | None:
    if override_input.default_value is not None:
        return override_input.default_value
    if base_spec is None:
        return None
    return base_spec.default_value


def _resolve_override_budget(
    override_input: ThinkingCapabilityOverrideInput,
    base_spec: _SeriesSpec | None,
) -> ThinkingSeriesBudgetConfig | None:
    if override_input.budget is not None:
        return override_input.budget
    if base_spec is None:
        return None
    return base_spec.budget


def _normalize_allowed_values(
    *,
    editor_type: ThinkingSeriesEditorType,
    allowed_values: tuple[RuntimeThinkingValue, ...],
    fallback: tuple[RuntimeThinkingValue, ...],
) -> tuple[RuntimeThinkingValue, ...]:
    candidate_values = allowed_values if len(allowed_values) > 0 else fallback
    if editor_type == "fixed":
        fixed_values = tuple(
            value for value in candidate_values if value.valueType == "fixed"
        )
        return fixed_values or (_fixed_value("固定推理"),)
    if editor_type == "budget":
        budget_values = tuple(
            value
            for value in candidate_values
            if value.valueType == "budget" and value.mode in {"off", "dynamic"}
        )
        return budget_values or (_budget_value("off", "关闭"),)
    code_values = tuple(
        value for value in candidate_values if value.valueType == "code"
    )
    return code_values


def _normalize_default_value(
    *,
    editor_type: ThinkingSeriesEditorType,
    default_value: RuntimeThinkingValue | None,
    allowed_values: tuple[RuntimeThinkingValue, ...],
    fallback: RuntimeThinkingValue | None,
    budget: ThinkingSeriesBudgetConfig | None,
) -> RuntimeThinkingValue | None:
    candidate = default_value or fallback
    if editor_type == "fixed":
        return _normalize_fixed_default_value(candidate)
    if editor_type == "budget":
        return _normalize_budget_default_value(
            candidate=candidate,
            allowed_values=allowed_values,
            budget=budget,
        )
    return _normalize_discrete_default_value(candidate, allowed_values)


def _normalize_fixed_default_value(
    candidate: RuntimeThinkingValue | None,
) -> RuntimeThinkingValue:
    if candidate is not None and candidate.valueType == "fixed":
        return candidate
    return _fixed_value("固定推理")


def _normalize_budget_default_value(
    *,
    candidate: RuntimeThinkingValue | None,
    allowed_values: tuple[RuntimeThinkingValue, ...],
    budget: ThinkingSeriesBudgetConfig | None,
) -> RuntimeThinkingValue | None:
    normalized_candidate = _normalize_budget_candidate(candidate, budget)
    if normalized_candidate is not None:
        return normalized_candidate
    return _find_budget_off_value(allowed_values)


def _normalize_budget_candidate(
    candidate: RuntimeThinkingValue | None,
    budget: ThinkingSeriesBudgetConfig | None,
) -> RuntimeThinkingValue | None:
    if candidate is None or candidate.valueType != "budget":
        return None
    return _normalize_non_token_budget_candidate(
        candidate
    ) or _normalize_budget_token_value(candidate, budget)


def _normalize_non_token_budget_candidate(
    candidate: RuntimeThinkingValue,
) -> RuntimeThinkingValue | None:
    if candidate.mode == "off":
        return _budget_value("off", candidate.labelZh or "关闭")
    if candidate.mode == "dynamic":
        return _budget_value("dynamic", candidate.labelZh or "动态")
    if candidate.mode != "budget":
        return None
    return None


def _normalize_budget_token_value(
    candidate: RuntimeThinkingValue,
    budget: ThinkingSeriesBudgetConfig | None,
) -> RuntimeThinkingValue | None:
    if candidate.budgetTokens is None or budget is None:
        return None
    snapped = _clamp_budget_tokens(candidate.budgetTokens, budget)
    return _budget_value("budget", candidate.labelZh or f"{snapped} Tokens", snapped)


def _find_budget_off_value(
    allowed_values: tuple[RuntimeThinkingValue, ...],
) -> RuntimeThinkingValue | None:
    return next(
        (
            value
            for value in allowed_values
            if value.valueType == "budget" and value.mode == "off"
        ),
        None,
    )


def _normalize_discrete_default_value(
    candidate: RuntimeThinkingValue | None,
    allowed_values: tuple[RuntimeThinkingValue, ...],
) -> RuntimeThinkingValue | None:
    if candidate is not None and candidate.valueType == "code":
        if any(_runtime_values_equal(candidate, allowed) for allowed in allowed_values):
            return candidate
    return next((value for value in allowed_values if value.valueType == "code"), None)


def _selection_value_allowed(
    requested_value: RuntimeThinkingValue,
    allowed_values: tuple[RuntimeThinkingValue, ...],
) -> bool:
    if (
        requested_value.valueType == "budget"
        and requested_value.mode == "budget"
        and requested_value.budgetTokens is not None
    ):
        return True
    return any(
        _runtime_values_equal(requested_value, allowed) for allowed in allowed_values
    )


def _runtime_values_equal(
    left: RuntimeThinkingValue, right: RuntimeThinkingValue
) -> bool:
    if left.valueType != right.valueType:
        return False
    if left.valueType == "code":
        return left.code == right.code
    if left.valueType == "fixed":
        return True
    return left.mode == right.mode and left.budgetTokens == right.budgetTokens


def _normalize_runtime_selection(
    selection: RuntimeThinkingSelection,
) -> RuntimeThinkingSelection | None:
    normalized_series = _normalize_series_id(selection.series.strip())
    if normalized_series is None or normalized_series == "":
        return None
    value = selection.value
    if value.valueType == "code":
        if not isinstance(value.code, str) or value.code.strip() == "":
            return None
        return RuntimeThinkingSelection(
            series=normalized_series,
            value=_normalize_series_value(
                normalized_series,
                RuntimeThinkingValue(
                    valueType="code",
                    code=value.code.strip(),
                    labelZh=value.labelZh,
                ),
            ),
        )
    if value.valueType == "fixed":
        return RuntimeThinkingSelection(
            series=normalized_series, value=_fixed_value(value.labelZh or "固定推理")
        )
    if value.mode not in {"off", "dynamic", "budget"}:
        return None
    if value.mode == "budget" and value.budgetTokens is None:
        return None
    return RuntimeThinkingSelection(
        series=normalized_series,
        value=RuntimeThinkingValue(
            valueType="budget",
            mode=value.mode,
            budgetTokens=value.budgetTokens,
            labelZh=value.labelZh,
        ),
    )


def _parse_editor_type(
    value: Any, *, fallback: ThinkingSeriesEditorType | None
) -> ThinkingSeriesEditorType | None:
    if value == "discrete":
        return "discrete"
    if value == "budget":
        return "budget"
    if value == "fixed":
        return "fixed"
    return fallback


def _parse_allowed_values(
    value: Any,
    *,
    fallback: tuple[RuntimeThinkingValue, ...],
    editor_type: ThinkingSeriesEditorType | None,
) -> tuple[RuntimeThinkingValue, ...]:
    if not isinstance(value, list):
        return fallback
    parsed: list[RuntimeThinkingValue] = []
    for item in value:
        parsed_value = _parse_runtime_thinking_value(item)
        if parsed_value is None:
            continue
        if editor_type == "discrete" and parsed_value.valueType != "code":
            continue
        if editor_type == "budget" and parsed_value.valueType != "budget":
            continue
        if editor_type == "fixed" and parsed_value.valueType != "fixed":
            continue
        parsed.append(parsed_value)
    return tuple(parsed) if len(parsed) > 0 else fallback


def _parse_default_value(
    value: Any,
    *,
    fallback: RuntimeThinkingValue | None,
    editor_type: ThinkingSeriesEditorType | None,
    allowed_values: tuple[RuntimeThinkingValue, ...],
) -> RuntimeThinkingValue | None:
    parsed = _parse_runtime_thinking_value(value)
    if parsed is None:
        return fallback
    if editor_type == "discrete" and parsed.valueType != "code":
        return fallback
    if editor_type == "budget" and parsed.valueType != "budget":
        return fallback
    if editor_type == "fixed" and parsed.valueType != "fixed":
        return fallback
    if editor_type == "discrete" and not any(
        _runtime_values_equal(parsed, allowed) for allowed in allowed_values
    ):
        return fallback
    return parsed


def _parse_budget_config(
    value: Any,
    *,
    fallback: ThinkingSeriesBudgetConfig | None,
) -> ThinkingSeriesBudgetConfig | None:
    if not isinstance(value, Mapping):
        return fallback
    min_tokens = _normalize_non_negative_int(value.get("minTokens"))
    max_tokens = _normalize_non_negative_int(value.get("maxTokens"))
    step_tokens = _normalize_positive_int(value.get("stepTokens"))
    anchor_tokens_raw = value.get("anchorTokens")
    if (
        min_tokens is None
        and max_tokens is None
        and step_tokens is None
        and not isinstance(anchor_tokens_raw, list)
    ):
        return fallback
    normalized_fallback = fallback or _budget_config()
    min_value = normalized_fallback.min_tokens if min_tokens is None else min_tokens
    max_value = normalized_fallback.max_tokens if max_tokens is None else max_tokens
    step_value = normalized_fallback.step_tokens if step_tokens is None else step_tokens
    return ThinkingSeriesBudgetConfig(
        min_tokens=min_value,
        max_tokens=max(min_value, max_value),
        step_tokens=max(1, step_value),
        anchor_tokens=_THINKING_BUDGET_FIXED_ANCHOR_TOKENS,
    )


def _parse_runtime_thinking_value(value: Any) -> RuntimeThinkingValue | None:
    if not isinstance(value, Mapping):
        return None
    value_type = _normalize_optional_string(value.get("valueType"))
    label_zh = _normalize_optional_string(value.get("labelZh"))
    if value_type == "code":
        code = _normalize_optional_string(value.get("code"))
        if code is None:
            return None
        return _code_value(code, label_zh or code)
    if value_type == "budget":
        mode = _normalize_optional_string(value.get("mode"))
        if mode not in {"off", "dynamic", "budget"}:
            return None
        budget_tokens = _normalize_non_negative_int(value.get("budgetTokens"))
        if mode == "budget" and budget_tokens is None:
            return None
        if mode == "budget":
            return _budget_value(
                "budget", label_zh or f"{budget_tokens} Tokens", budget_tokens
            )
        if mode == "dynamic":
            return _budget_value("dynamic", label_zh or "动态")
        return _budget_value("off", label_zh or "关闭")
    if value_type == "fixed":
        code = _normalize_optional_string(value.get("code"))
        if code is None or code != "fixed":
            return None
        return _fixed_value(label_zh or "固定推理")
    return None


def _build_route_fingerprint(model_route: ResolvedRuntimeModelRoute) -> dict[str, str]:
    return {
        "providerProfileId": model_route.provider_profile_id,
        "provider": _normalize_identifier(
            model_route.provider_id or model_route.provider
        ),
        "endpointType": model_route.endpoint_type,
        "baseUrl": model_route.base_url,
        "modelId": model_route.model_id,
    }


def _clamp_budget_tokens(value: int, config: ThinkingSeriesBudgetConfig) -> int:
    lower_bounded = max(config.min_tokens, value)
    upper_bounded = min(config.max_tokens, lower_bounded)
    step = max(1, config.step_tokens)
    snapped = (
        config.min_tokens + round((upper_bounded - config.min_tokens) / step) * step
    )
    return min(config.max_tokens, max(config.min_tokens, snapped))


def _normalize_optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized if normalized != "" else None


def _normalize_identifier(value: str) -> str:
    return value.strip().lower()


def _normalize_non_negative_int(value: Any) -> int | None:
    if not isinstance(value, int) or isinstance(value, bool):
        return None
    return value if value >= 0 else None


def _normalize_positive_int(value: Any) -> int | None:
    if not isinstance(value, int) or isinstance(value, bool):
        return None
    return value if value > 0 else None


__all__ = [
    "CanonicalThinkingCapability",
    "ThinkingAdaptationResult",
    "ThinkingCapabilityOverrideInput",
    "parse_thinking_capability_override",
    "resolve_canonical_thinking_capability",
    "adapt_thinking_selection",
]

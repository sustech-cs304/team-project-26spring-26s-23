from __future__ import annotations

from app.copilot_runtime.contracts import RuntimeThinkingSelection, RuntimeThinkingValue
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute
from app.copilot_runtime.thinking_adapter import (
    adapt_thinking_selection,
    parse_thinking_capability_override,
    resolve_canonical_thinking_capability,
)


def test_resolve_verified_openai_6_level_series_for_gpt5_route() -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_route(model_id="gpt-5")
    ).to_public_dict()

    assert capability == {
        "status": "verified-supported",
        "source": "verified",
        "series": "openai-6-level-superset-v1",
        "seriesLabelZh": "OpenAI 6 档总超集",
        "editorType": "discrete",
        "allowedValues": [
            {
                "valueType": "code",
                "code": "none",
                "labelZh": "无",
                "mode": None,
                "budgetTokens": None,
            },
            {
                "valueType": "code",
                "code": "minimal",
                "labelZh": "极简",
                "mode": None,
                "budgetTokens": None,
            },
            {
                "valueType": "code",
                "code": "low",
                "labelZh": "低",
                "mode": None,
                "budgetTokens": None,
            },
            {
                "valueType": "code",
                "code": "medium",
                "labelZh": "中",
                "mode": None,
                "budgetTokens": None,
            },
            {
                "valueType": "code",
                "code": "high",
                "labelZh": "高",
                "mode": None,
                "budgetTokens": None,
            },
            {
                "valueType": "code",
                "code": "xhigh",
                "labelZh": "超高",
                "mode": None,
                "budgetTokens": None,
            },
        ],
        "defaultValue": {
            "valueType": "code",
            "code": "medium",
            "labelZh": "中",
            "mode": None,
            "budgetTokens": None,
        },
        "providerBuilderKey": "openai_reasoning_effort_v1",
        "reasonCode": "verified_series_resolved",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-5",
        },
    }


def test_resolve_verified_openai_4_level_series_for_gpt41_route() -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_route(model_id="gpt-4.1")
    ).to_public_dict()

    assert capability["series"] == "openai-4-level-minimal-v1"
    assert capability["seriesLabelZh"] == "OpenAI 4 档 Minimal 系"
    assert capability["editorType"] == "discrete"
    assert [value["code"] for value in capability["allowedValues"]] == [
        "minimal",
        "low",
        "medium",
        "high",
    ]
    assert capability["defaultValue"]["code"] == "medium"


def test_openai_6_level_and_4_level_are_different_series() -> None:
    gpt5_capability = resolve_canonical_thinking_capability(
        model_route=_route(model_id="gpt-5")
    )
    gpt41_capability = resolve_canonical_thinking_capability(
        model_route=_route(model_id="gpt-4.1")
    )

    assert gpt5_capability.series == "openai-6-level-superset-v1"
    assert gpt41_capability.series == "openai-4-level-minimal-v1"
    assert gpt5_capability.series != gpt41_capability.series


def test_resolve_unknown_route_without_override_returns_empty_series_snapshot() -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_route(model_id="unknown-model")
    ).to_public_dict()

    assert capability == {
        "status": "unknown-without-override",
        "source": "unknown",
        "series": None,
        "seriesLabelZh": None,
        "editorType": None,
        "allowedValues": [],
        "defaultValue": None,
        "providerBuilderKey": None,
        "reasonCode": "route_not_verified",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "unknown-model",
        },
    }


def test_parse_thinking_capability_override_accepts_series_template_shape() -> None:
    override = parse_thinking_capability_override(
        {
            "supported": True,
            "series": "gemini-2.5-budget-v1",
            "source": "settings-page",
            "template": {
                "editorType": "budget",
                "allowedValues": [
                    {"valueType": "budget", "mode": "off", "labelZh": "关闭"},
                    {"valueType": "budget", "mode": "dynamic", "labelZh": "动态"},
                ],
                "defaultValue": {
                    "valueType": "budget",
                    "mode": "budget",
                    "budgetTokens": 4096,
                    "labelZh": "4096 Tokens",
                },
                "budget": {
                    "minTokens": 0,
                    "maxTokens": 32768,
                    "stepTokens": 1024,
                    "anchorTokens": [0, 4096, 8192],
                },
            },
        }
    )

    assert override is not None
    assert override.supported is True
    assert override.series == "gemini-2.5-budget-v1"
    assert override.source == "settings-page"
    assert override.editor_type == "budget"
    assert [value.to_dict() for value in override.allowed_values] == [
        {
            "valueType": "budget",
            "code": None,
            "mode": "off",
            "budgetTokens": None,
            "labelZh": "关闭",
        },
        {
            "valueType": "budget",
            "code": None,
            "mode": "dynamic",
            "budgetTokens": None,
            "labelZh": "动态",
        },
    ]
    assert override.default_value is not None
    assert override.default_value.to_dict() == {
        "valueType": "budget",
        "code": None,
        "mode": "budget",
        "budgetTokens": 4096,
        "labelZh": "4096 Tokens",
    }
    assert override.budget is not None
    assert override.budget.to_public_dict() == {
        "minTokens": 0,
        "maxTokens": 32768,
        "stepTokens": 1024,
        "anchorTokens": [0, 4096, 32768, 131072, 1048576],
    }


def test_resolve_unknown_route_with_override_uses_override_series_template() -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_route(model_id="unknown-model"),
        thinking_capability_override={
            "supported": True,
            "series": "qwen-thinking-switch-v1",
            "template": {
                "editorType": "discrete",
                "allowedValues": [
                    {"valueType": "code", "code": "false", "labelZh": "关闭"},
                    {"valueType": "code", "code": "true", "labelZh": "开启"},
                ],
                "defaultValue": {
                    "valueType": "code",
                    "code": "true",
                    "labelZh": "开启",
                },
            },
        },
    ).to_public_dict()

    assert capability["status"] == "unknown-with-override"
    assert capability["source"] == "override"
    assert capability["series"] == "qwen-thinking-switch-v1"
    assert capability["seriesLabelZh"] == "Qwen Thinking 开关"
    assert capability["editorType"] == "discrete"
    assert capability["providerBuilderKey"] == "qwen_switch_v1"
    assert [value["code"] for value in capability["allowedValues"]] == ["false", "true"]
    assert capability["defaultValue"]["code"] == "true"


def test_adapt_thinking_selection_applies_verified_series_builder() -> None:
    result = adapt_thinking_selection(
        selection=RuntimeThinkingSelection(
            series="openai-6-level-superset-v1",
            value=RuntimeThinkingValue(valueType="code", code="high", labelZh="高"),
        ),
        model_route=_route(model_id="gpt-5"),
    )

    assert result.applied is True
    assert result.reason == "verified_series_builder_applied"
    assert result.error_code is None
    assert result.provider_builder_key == "openai_reasoning_effort_v1"
    assert result.mapping_reason_code == "openai_reasoning_effort_high"
    assert result.model_settings == {"reasoning_effort": "high"}
    assert result.requested_selection is not None
    assert result.applied_selection is not None
    assert result.requested_selection.to_dict() == result.applied_selection.to_dict()


def test_adapt_thinking_selection_rejects_requested_series_mismatch() -> None:
    result = adapt_thinking_selection(
        selection=RuntimeThinkingSelection(
            series="openai-4-level-minimal-v1",
            value=RuntimeThinkingValue(valueType="code", code="medium", labelZh="中"),
        ),
        model_route=_route(model_id="gpt-5"),
    )

    assert result.applied is False
    assert result.reason == "requested_series_mismatch"
    assert result.error_code == "thinking_series_not_supported_for_route"
    assert result.mapping_reason_code == "requested_series_mismatch"
    assert result.provider_builder_key == "openai_reasoning_effort_v1"
    assert result.applied_selection is None


def test_adapt_thinking_selection_rejects_unknown_route_without_override() -> None:
    result = adapt_thinking_selection(
        selection=RuntimeThinkingSelection(
            series="openai-6-level-superset-v1",
            value=RuntimeThinkingValue(valueType="code", code="high", labelZh="高"),
        ),
        model_route=_route(model_id="unknown-model"),
    )

    assert result.applied is False
    assert result.reason == "thinking_series_unknown_without_override"
    assert result.error_code == "thinking_series_unknown_without_override"
    assert result.mapping_reason_code == "series_unresolved"
    assert result.provider_builder_key is None


def test_adapt_thinking_selection_uses_override_budget_builder() -> None:
    result = adapt_thinking_selection(
        selection=RuntimeThinkingSelection(
            series="gemini-2.5-budget-v1",
            value=RuntimeThinkingValue(
                valueType="budget",
                mode="budget",
                budgetTokens=8192,
                labelZh="8192 Tokens",
            ),
        ),
        model_route=_route(model_id="unknown-model"),
        thinking_capability_override={
            "supported": True,
            "series": "gemini-2.5-budget-v1",
            "details": {"owner": "unit-test"},
            "template": {
                "editorType": "budget",
                "allowedValues": [
                    {"valueType": "budget", "mode": "off", "labelZh": "关闭"},
                    {"valueType": "budget", "mode": "dynamic", "labelZh": "动态"},
                ],
                "defaultValue": {
                    "valueType": "budget",
                    "mode": "dynamic",
                    "budgetTokens": None,
                    "labelZh": "动态",
                },
                "budget": {
                    "minTokens": 0,
                    "maxTokens": 32768,
                    "stepTokens": 1024,
                    "anchorTokens": [0, 4096, 8192],
                    "details": {"source": "settings"},
                },
            },
        },
    )

    assert result.applied is True
    assert result.reason == "override_series_builder_applied"
    assert result.error_code is None
    assert result.provider_builder_key == "gemini_budget_v1"
    assert result.mapping_reason_code == "gemini_budget_tokens"
    assert result.model_settings == {
        "google_thinking_config": {
            "include_thoughts": True,
            "thinking_budget": 8192,
        }
    }
    assert result.capability.details == {"owner": "unit-test"}
    assert result.diagnostics["details"] == {"owner": "unit-test"}



def test_resolve_override_unified_4_level_for_gemini_route_exposes_provider_builder() -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_route(
            provider="gemini",
            endpoint_type="gemini-native",
            model_id="gemini-3-flash-preview",
        ),
        thinking_capability_override={
            "supported": True,
            "series": "unified-4-level-v1",
        },
    )

    assert capability.series == "unified-4-level-v1"
    assert capability.provider_builder_key == "gemini_unified_4_level_v1"



def test_adapt_thinking_selection_maps_unified_4_level_for_gemini_route() -> None:
    result = adapt_thinking_selection(
        selection=RuntimeThinkingSelection(
            series="unified-4-level-v1",
            value=RuntimeThinkingValue(valueType="code", code="medium", labelZh="中"),
        ),
        model_route=_route(
            provider="gemini",
            endpoint_type="gemini-native",
            model_id="gemini-3-flash-preview",
        ),
        thinking_capability_override={
            "supported": True,
            "series": "unified-4-level-v1",
        },
    )

    assert result.applied is True
    assert result.reason == "override_series_builder_applied"
    assert result.error_code is None
    assert result.provider_builder_key == "gemini_unified_4_level_v1"
    assert result.mapping_reason_code == "gemini_unified_4_level_medium"
    assert result.model_settings == {
        "google_thinking_config": {
            "include_thoughts": True,
            "thinking_level": "medium",
        }
    }



def test_adapt_thinking_selection_maps_unified_4_level_for_gemini_25_route() -> None:
    result = adapt_thinking_selection(
        selection=RuntimeThinkingSelection(
            series="unified-4-level-v1",
            value=RuntimeThinkingValue(valueType="code", code="medium", labelZh="中"),
        ),
        model_route=_route(
            provider="gemini",
            endpoint_type="gemini-native",
            model_id="gemini-2.5-flash",
        ),
        thinking_capability_override={
            "supported": True,
            "series": "unified-4-level-v1",
        },
    )

    assert result.applied is True
    assert result.reason == "override_series_builder_applied"
    assert result.error_code is None
    assert result.provider_builder_key == "gemini_unified_4_level_v1"
    assert result.mapping_reason_code == "gemini_unified_4_level_medium"
    assert result.model_settings == {
        "google_thinking_config": {
            "include_thoughts": True,
            "thinking_budget": 32768,
        }
    }



def _route(
    *,
    model_id: str,
    provider: str = "openai",
    endpoint_type: str = "openai-compatible",
    base_url: str = "https://example.com/v1",
) -> ResolvedRuntimeModelRoute:
    return ResolvedRuntimeModelRoute(
        provider_profile_id="provider-1",
        provider=provider,
        endpoint_type=endpoint_type,
        base_url=base_url,
        model_id=model_id,
        api_key="test-api-key",
    )
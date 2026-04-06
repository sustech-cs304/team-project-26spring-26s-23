from __future__ import annotations

from app.copilot_runtime.contracts import RuntimeThinkingSelection
from app.copilot_runtime.debug_logging import summarize_runtime_thinking_capability
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute
from app.copilot_runtime.thinking_adapter import (
    adapt_thinking_intent,
    adapt_thinking_selection,
    parse_thinking_capability_override,
    resolve_canonical_thinking_capability,
)


def test_resolve_canonical_thinking_capability_verified_supported_shape_and_legacy_fields() -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_route(model_id="glm-5-turbo", base_url="https://api.z.ai/api/paas/v4")
    ).to_public_dict()

    assert capability == {
        "status": "verified-supported",
        "source": "verified",
        "supported": True,
        "series": "zai-glm-thinking-v1",
        "controlSpec": {
            "kind": "off-auto",
            "selectionKind": "preset",
            "presetOptions": [
                {"kind": "preset", "value": "off"},
                {"kind": "preset", "value": "auto"},
            ],
        },
        "defaultSelection": {"kind": "preset", "value": "auto"},
        "reasonCode": "zai_glm_verified_supported",
        "providerHint": "zai-glm-openai-compatible",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://api.z.ai/api/paas/v4",
            "modelId": "glm-5-turbo",
        },
        "provenance": {
            "routeStatus": "verified",
            "override": {
                "present": False,
                "applied": False,
                "source": None,
                "format": None,
            },
        },
        "visibility": {
            "reasoning": "visible",
            "supportsSuppression": True,
        },
        "supportedLevels": ["off", "auto"],
        "defaultLevel": "auto",
        "overrideLevels": [],
    }


def test_resolve_canonical_thinking_capability_verified_unsupported_shape_and_legacy_fields() -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_route(model_id="glm-4", base_url="https://open.bigmodel.cn/api/paas/v4")
    ).to_public_dict()

    assert capability == {
        "status": "verified-unsupported",
        "source": "verified",
        "supported": False,
        "series": "zai-glm-fixed-off-v1",
        "controlSpec": {
            "kind": "fixed",
            "selectionKind": "preset",
            "presetOptions": [{"kind": "preset", "value": "off"}],
            "fixedSelection": {"kind": "preset", "value": "off"},
        },
        "defaultSelection": {"kind": "preset", "value": "off"},
        "reasonCode": "zai_glm_verified_unsupported",
        "providerHint": "zai-glm-openai-compatible",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
            "modelId": "glm-4",
        },
        "provenance": {
            "routeStatus": "verified",
            "override": {
                "present": False,
                "applied": False,
                "source": None,
                "format": None,
            },
        },
        "visibility": {
            "reasoning": "visible",
            "supportsSuppression": True,
        },
        "supportedLevels": [],
        "defaultLevel": None,
        "overrideLevels": [],
    }


def test_resolve_canonical_thinking_capability_unknown_without_override_shape_and_legacy_fields() -> None:
    capability = resolve_canonical_thinking_capability(model_route=_route(model_id="gpt-4.1")).to_public_dict()

    assert capability == {
        "status": "unknown-without-override",
        "source": "unknown",
        "supported": False,
        "series": "fixed-off-v1",
        "controlSpec": {
            "kind": "fixed",
            "selectionKind": "preset",
            "presetOptions": [{"kind": "preset", "value": "off"}],
            "fixedSelection": {"kind": "preset", "value": "off"},
        },
        "defaultSelection": {"kind": "preset", "value": "off"},
        "reasonCode": "route_not_verified",
        "providerHint": "unknown-route",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
        "provenance": {
            "routeStatus": "unknown",
            "override": {
                "present": False,
                "applied": False,
                "source": None,
                "format": None,
            },
        },
        "visibility": {
            "reasoning": "visible",
            "supportsSuppression": True,
        },
        "supportedLevels": [],
        "defaultLevel": None,
        "overrideLevels": [],
    }


def test_resolve_canonical_thinking_capability_unknown_with_legacy_override_shape_and_legacy_fields() -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_route(model_id="gpt-4.1"),
        thinking_capability_override={
            "supported": True,
            "levels": ["low", "high"],
            "defaultLevel": "high",
            "source": "settings-page",
        },
    ).to_public_dict()

    assert capability == {
        "status": "unknown-with-override",
        "source": "override",
        "supported": True,
        "series": "compat-override-discrete-v1",
        "controlSpec": {
            "kind": "discrete",
            "selectionKind": "preset",
            "presetOptions": [
                {"kind": "preset", "value": "off"},
                {"kind": "preset", "value": "low"},
                {"kind": "preset", "value": "high"},
            ],
        },
        "defaultSelection": {"kind": "preset", "value": "high"},
        "reasonCode": "override_candidate_control_applied",
        "providerHint": "unknown-route-override",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
        "provenance": {
            "routeStatus": "unknown",
            "override": {
                "present": True,
                "applied": True,
                "source": "settings-page",
                "format": "legacy-levels",
            },
        },
        "visibility": {
            "reasoning": "visible",
            "supportsSuppression": True,
        },
        "supportedLevels": ["off", "low", "high"],
        "defaultLevel": "high",
        "overrideLevels": ["off", "low", "high"],
    }


def test_parse_thinking_capability_override_accepts_series_input_shape() -> None:
    override = parse_thinking_capability_override(
        {
            "supported": True,
            "series": "gemini-2.5-budget-v1",
            "input": {
                "kind": "budget",
                "minTokens": 0,
                "maxTokens": 32768,
                "stepTokens": 1024,
            },
            "defaultSelection": {"mode": "budget", "budgetTokens": 4096},
            "source": "settings-page",
        }
    )

    assert override is not None
    assert override.series == "gemini-2.5-budget-v1"
    assert override.format == "series-input"
    assert override.control_spec is not None
    assert override.control_spec.to_public_dict() == {
        "kind": "budget",
        "selectionKind": "budget",
        "presetOptions": [{"kind": "preset", "value": "off"}],
        "budget": {
            "minTokens": 0,
            "maxTokens": 32768,
            "stepTokens": 1024,
        },
    }
    assert override.default_selection is not None
    assert override.default_selection.to_public_dict() == {"kind": "budget", "budgetTokens": 4096}


def test_resolve_canonical_thinking_capability_unknown_with_series_input_override() -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_route(model_id="gpt-4.1"),
        thinking_capability_override={
            "supported": True,
            "series": "compat-discrete-levels-v1",
            "input": {
                "kind": "discrete",
                "levels": ["low", "medium", "high"],
            },
            "defaultSelection": {"mode": "preset", "level": "medium"},
            "source": "settings-page",
        },
    ).to_public_dict()

    assert capability == {
        "status": "unknown-with-override",
        "source": "override",
        "supported": True,
        "series": "compat-discrete-levels-v1",
        "controlSpec": {
            "kind": "discrete",
            "selectionKind": "preset",
            "presetOptions": [
                {"kind": "preset", "value": "off"},
                {"kind": "preset", "value": "low"},
                {"kind": "preset", "value": "medium"},
                {"kind": "preset", "value": "high"},
            ],
        },
        "defaultSelection": {"kind": "preset", "value": "medium"},
        "reasonCode": "override_candidate_control_applied",
        "providerHint": "unknown-route-override",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
        "provenance": {
            "routeStatus": "unknown",
            "override": {
                "present": True,
                "applied": True,
                "source": "settings-page",
                "format": "series-input",
            },
        },
        "visibility": {
            "reasoning": "visible",
            "supportsSuppression": True,
        },
        "supportedLevels": ["off", "low", "medium", "high"],
        "defaultLevel": "medium",
        "overrideLevels": ["off", "low", "medium", "high"],
    }


def test_resolve_canonical_thinking_capability_verified_route_does_not_expand_from_series_input_override() -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_route(model_id="glm-5-turbo", base_url="https://api.z.ai/api/paas/v4"),
        thinking_capability_override={
            "supported": True,
            "series": "compat-discrete-levels-v1",
            "input": {
                "kind": "discrete",
                "levels": ["low", "high"],
            },
            "defaultSelection": {"mode": "preset", "level": "high"},
            "source": "settings-page",
        },
    ).to_public_dict()

    assert capability["status"] == "verified-supported"
    assert capability["source"] == "verified"
    assert capability["series"] == "zai-glm-thinking-v1"
    assert capability["supportedLevels"] == ["off", "auto"]
    assert capability["defaultLevel"] == "auto"
    assert capability["provenance"] == {
        "routeStatus": "verified",
        "override": {
            "present": True,
            "applied": False,
            "source": "settings-page",
            "format": "series-input",
        },
    }


def test_resolve_canonical_thinking_capability_unknown_with_budget_override_uses_structured_selection() -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_route(model_id="gpt-4.1"),
        thinking_capability_override={
            "supported": True,
            "series": "gemini-2.5-budget-v1",
            "source": "settings-page",
            "controlSpec": {
                "kind": "budget",
                "presetOptions": [{"kind": "preset", "value": "off"}],
                "budget": {
                    "minTokens": 0,
                    "maxTokens": 32768,
                    "stepTokens": 1024,
                },
            },
            "defaultSelection": {"kind": "budget", "budgetTokens": 8192},
            "visibility": {
                "reasoning": "suppressed",
                "supportsSuppression": True,
            },
        },
    ).to_public_dict()

    assert capability == {
        "status": "unknown-with-override",
        "source": "override",
        "supported": True,
        "series": "gemini-2.5-budget-v1",
        "controlSpec": {
            "kind": "budget",
            "selectionKind": "budget",
            "presetOptions": [{"kind": "preset", "value": "off"}],
            "budget": {
                "minTokens": 0,
                "maxTokens": 32768,
                "stepTokens": 1024,
            },
        },
        "defaultSelection": {"kind": "budget", "budgetTokens": 8192},
        "reasonCode": "override_candidate_control_applied",
        "providerHint": "unknown-route-override",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
        "provenance": {
            "routeStatus": "unknown",
            "override": {
                "present": True,
                "applied": True,
                "source": "settings-page",
                "format": "canonical-control",
            },
        },
        "visibility": {
            "reasoning": "suppressed",
            "supportsSuppression": True,
        },
        "supportedLevels": ["off"],
        "defaultLevel": None,
        "overrideLevels": ["off"],
    }


def test_summarize_runtime_thinking_capability_returns_loggable_schema_summary() -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_route(model_id="gpt-4.1"),
        thinking_capability_override={
            "supported": True,
            "series": "gemini-2.5-budget-v1",
            "source": "settings-page",
            "controlSpec": {
                "kind": "budget",
                "presetOptions": [{"kind": "preset", "value": "off"}],
                "budget": {
                    "minTokens": 0,
                    "maxTokens": 32768,
                    "stepTokens": 1024,
                },
            },
            "defaultSelection": {"kind": "budget", "budgetTokens": 8192},
            "visibility": {
                "reasoning": "suppressed",
                "supportsSuppression": True,
            },
        },
    )

    assert summarize_runtime_thinking_capability(capability) == capability.to_public_dict()



def test_adapt_thinking_selection_verified_supported_route_applies_provider_mapping() -> None:
    result = adapt_thinking_selection(
        selection=RuntimeThinkingSelection(
            series="zai-glm-thinking-v1",
            mode="preset",
            level="auto",
        ),
        model_route=_route(model_id="glm-5-turbo", base_url="https://api.z.ai/api/paas/v4"),
    )

    assert result.applied is True
    assert result.requested_selection is not None
    assert result.requested_selection.to_public_dict() == {"kind": "preset", "value": "auto"}
    assert result.applied_selection is not None
    assert result.applied_selection.to_public_dict() == {"kind": "preset", "value": "auto"}
    assert result.requested_intent == "auto"
    assert result.applied_intent == "auto"
    assert result.reason == "verified_provider_mapping_applied"
    assert result.error_code is None
    assert result.provider_mapping == "zai_glm_openai_compatible"
    assert result.mapping_reason_code == "zai_glm_series_auto"
    assert result.model_settings == {
        "extra_body": {
            "thinking": {
                "type": "enabled",
            }
        }
    }



def test_adapt_thinking_selection_verified_unsupported_route_cannot_be_expanded_by_override() -> None:
    result = adapt_thinking_selection(
        selection=RuntimeThinkingSelection(
            series="compat-discrete-levels-v1",
            mode="preset",
            level="high",
        ),
        model_route=_route(model_id="glm-4", base_url="https://open.bigmodel.cn/api/paas/v4"),
        thinking_capability_override={
            "supported": True,
            "series": "compat-discrete-levels-v1",
            "input": {
                "kind": "discrete",
                "levels": ["high"],
            },
            "defaultSelection": {"mode": "preset", "level": "high"},
            "source": "settings-page",
        },
    )

    assert result.capability.status == "verified-unsupported"
    assert result.capability.source == "verified"
    assert result.applied is False
    assert result.applied_selection is None
    assert result.reason == "requested_level_not_in_capability"
    assert result.error_code == "thinking_not_supported_for_route"
    assert result.mapping_reason_code == "selection_not_allowed_by_capability"



def test_adapt_thinking_selection_unknown_with_override_applies_when_provider_mapping_exists() -> None:
    result = adapt_thinking_selection(
        selection=RuntimeThinkingSelection(
            series="zai-glm-thinking-v1",
            mode="preset",
            level="auto",
        ),
        model_route=_route(model_id="glm-5-experimental", base_url="https://api.z.ai/api/paas/v4"),
        thinking_capability_override={
            "supported": True,
            "series": "zai-glm-thinking-v1",
            "input": {
                "kind": "discrete",
                "levels": ["auto"],
            },
            "defaultSelection": {"mode": "preset", "level": "auto"},
            "source": "settings-page",
        },
    )

    assert result.capability.status == "unknown-with-override"
    assert result.capability.source == "override"
    assert result.applied is True
    assert result.reason == "override_provider_mapping_applied"
    assert result.error_code is None
    assert result.provider_mapping == "zai_glm_openai_compatible"
    assert result.mapping_reason_code == "zai_glm_series_auto"
    assert result.model_settings == {
        "extra_body": {
            "thinking": {
                "type": "enabled",
            }
        }
    }



def test_adapt_thinking_selection_unknown_with_override_fails_when_provider_mapping_missing() -> None:
    result = adapt_thinking_selection(
        selection=RuntimeThinkingSelection(
            series="compat-discrete-levels-v1",
            mode="preset",
            level="high",
        ),
        model_route=_route(model_id="gpt-4.1"),
        thinking_capability_override={
            "supported": True,
            "series": "compat-discrete-levels-v1",
            "input": {
                "kind": "discrete",
                "levels": ["high"],
            },
            "defaultSelection": {"mode": "preset", "level": "high"},
            "source": "settings-page",
        },
    )

    assert result.capability.status == "unknown-with-override"
    assert result.capability.source == "override"
    assert result.applied is False
    assert result.applied_selection is None
    assert result.reason == "requested_selection_not_mappable_for_provider"
    assert result.error_code == "thinking_not_supported_for_route"
    assert result.mapping_reason_code == "provider_mapping_missing_for_selection"



def test_adapt_thinking_intent_legacy_entry_uses_structured_selection_mapping_path() -> None:
    result = adapt_thinking_intent(
        intent="auto",
        model_route=_route(model_id="glm-5-turbo", base_url="https://api.z.ai/api/paas/v4"),
    )

    assert result.requested_selection is not None
    assert result.requested_selection.to_public_dict() == {"kind": "preset", "value": "auto"}
    assert result.applied_selection is not None
    assert result.applied_selection.to_public_dict() == {"kind": "preset", "value": "auto"}
    assert result.reason == "verified_provider_mapping_applied"
    assert result.mapping_reason_code == "zai_glm_series_auto"



def _route(*, model_id: str, base_url: str = "https://example.com/v1") -> ResolvedRuntimeModelRoute:
    return ResolvedRuntimeModelRoute(
        provider_profile_id="provider-1",
        provider="openai",
        endpoint_type="openai-compatible",
        base_url=base_url,
        model_id=model_id,
        api_key="test-api-key",
    )

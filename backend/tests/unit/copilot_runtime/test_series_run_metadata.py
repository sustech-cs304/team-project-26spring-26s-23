from __future__ import annotations

from app.copilot_runtime import build_runtime_scaffold
from app.copilot_runtime.contracts import RuntimeThinkingSelection, RuntimeThinkingValue
from app.copilot_runtime.session_store import (
    RuntimeRunRecord,
    RuntimeStoredModelRoute,
    RuntimeStoredModelRouteSnapshot,
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
)


def test_build_run_view_exposes_series_metadata_without_legacy_level_fields() -> None:
    scaffold = build_runtime_scaffold(model_configured=True)
    run = RuntimeRunRecord(
        run_id="run-1",
        thread_id="thread-1",
        request=RuntimeStoredRunInput(
            message_role="user",
            message_content="hello",
            policy=RuntimeStoredRunPolicy(
                model_route=RuntimeStoredModelRoute(
                    provider_profile_id="provider-1",
                    snapshot=RuntimeStoredModelRouteSnapshot(
                        provider="openai",
                        endpoint_type="openai-compatible",
                        base_url="https://example.com/v1",
                        model_id="gpt-5",
                    ),
                ),
                thinking_selection=None,
                thinking_capability_override=None,
                enabled_tools=(),
                request_options={},
            ),
        ),
        metadata={
            "requestedThinkingSelection": RuntimeThinkingSelection(
                series="openai-6-level-superset-v1",
                value=RuntimeThinkingValue(valueType="code", code="high", labelZh="高"),
            ).to_dict(),
            "appliedThinkingSelection": RuntimeThinkingSelection(
                series="openai-6-level-superset-v1",
                value=RuntimeThinkingValue(valueType="code", code="high", labelZh="高"),
            ).to_dict(),
            "thinkingCapabilitySnapshot": {
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
                        "code": "high",
                        "labelZh": "高",
                        "mode": None,
                        "budgetTokens": None,
                    },
                ],
                "defaultValue": {
                    "valueType": "code",
                    "code": "high",
                    "labelZh": "高",
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
            },
            "thinkingSeriesDecision": {
                "requestedSelection": {
                    "series": "openai-6-level-superset-v1",
                    "value": {
                        "valueType": "code",
                        "code": "high",
                        "labelZh": "高",
                        "mode": None,
                        "budgetTokens": None,
                    },
                },
                "appliedSelection": {
                    "series": "openai-6-level-superset-v1",
                    "value": {
                        "valueType": "code",
                        "code": "high",
                        "labelZh": "高",
                        "mode": None,
                        "budgetTokens": None,
                    },
                },
                "applied": True,
                "reasonCode": "verified_series_builder_applied",
                "errorCode": None,
                "providerBuilderKey": "openai_reasoning_effort_v1",
                "mappingReasonCode": "openai_reasoning_effort_high",
                "capabilityStatus": "verified-supported",
                "capabilitySource": "verified",
                "capabilitySeries": "openai-6-level-superset-v1",
                "capabilitySeriesLabelZh": "OpenAI 6 档总超集",
                "capabilityReasonCode": "verified_series_resolved",
                "modelSettings": {"reasoning_effort": "high"},
            },
            "reasoningSuppressionBasis": {
                "shouldSuppress": False,
                "source": "none",
                "reasonCode": None,
                "appliedThinkingSelection": {
                    "series": "openai-6-level-superset-v1",
                    "value": {
                        "valueType": "code",
                        "code": "high",
                        "labelZh": "高",
                        "mode": None,
                        "budgetTokens": None,
                    },
                },
                "reasoningVisibility": "visible",
                "supportsSuppression": True,
                "capabilitySource": "verified",
                "capabilitySeries": "openai-6-level-superset-v1",
            },
        },
    )

    payload = scaffold.build_run_view(run=run).to_dict()

    assert payload["requestedThinkingSelection"]["series"] == "openai-6-level-superset-v1"
    assert payload["appliedThinkingSelection"]["value"]["code"] == "high"
    assert payload["thinkingCapabilitySnapshot"]["series"] == "openai-6-level-superset-v1"
    assert payload["thinkingCapabilitySnapshot"]["providerBuilderKey"] == "openai_reasoning_effort_v1"
    assert payload["thinkingSeriesDecision"]["capabilitySeries"] == "openai-6-level-superset-v1"
    assert payload["reasoningSuppressionBasis"]["appliedThinkingSelection"]["series"] == "openai-6-level-superset-v1"
    assert "requestedThinkingLevel" not in payload
    assert "appliedThinkingLevel" not in payload
    assert "thinkingSelectionResult" not in payload

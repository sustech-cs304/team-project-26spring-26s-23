from __future__ import annotations

import pytest

from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute
from app.copilot_runtime.provider_adapter_registry import (
    RuntimeProviderAdapterError,
    RuntimeProviderAdapterRegistry,
)
from app.copilot_runtime.thinking_adapter import (
    adapt_thinking_intent,
    resolve_canonical_thinking_capability,
)


@pytest.mark.parametrize(
    (
        "provider_id",
        "adapter_id",
        "endpoint_type",
        "base_url",
        "model_id",
        "expected_status",
        "expected_reason_code",
        "expected_provider_hint",
    ),
    [
        (
            "openai",
            "openai",
            "openai-compatible",
            "https://api.z.ai/api/paas/v4",
            "glm-5-turbo",
            "verified-unsupported",
            "openai_thinking_not_supported_for_model",
            "openai",
        ),
        (
            "anthropic",
            "anthropic",
            "anthropic-native",
            "https://api.anthropic.com",
            "claude-3-7-sonnet",
            "verified-unsupported",
            "anthropic_thinking_not_supported_for_model",
            "anthropic",
        ),
        (
            "gemini",
            "gemini",
            "gemini-native",
            "https://generativelanguage.googleapis.com",
            "gemini-2.5-pro",
            "verified-unsupported",
            "gemini_thinking_not_supported_for_model",
            "gemini",
        ),
        (
            "ollama",
            "ollama",
            "ollama-native",
            "http://127.0.0.1:11434/v1",
            "llama3.2",
            "verified-unsupported",
            "ollama_thinking_not_supported_for_model",
            "ollama",
        ),
        (
            "groq",
            "groq",
            "openai-compatible",
            "https://api.groq.com/openai/v1",
            "llama-3.3-70b-versatile",
            "verified-unsupported",
            "groq_thinking_not_supported_for_model",
            "groq",
        ),
        (
            "mistral",
            "mistral",
            "openai-compatible",
            "https://api.mistral.ai/v1",
            "mistral-large-latest",
            "verified-unsupported",
            "mistral_thinking_not_supported_for_model",
            "mistral",
        ),
    ],
)
def test_resolve_canonical_thinking_capability_returns_stable_results_for_first_batch_providers(
    provider_id: str,
    adapter_id: str,
    endpoint_type: str,
    base_url: str,
    model_id: str,
    expected_status: str,
    expected_reason_code: str,
    expected_provider_hint: str,
) -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_build_route(
            provider_id=provider_id,
            adapter_id=adapter_id,
            endpoint_type=endpoint_type,
            base_url=base_url,
            model_id=model_id,
            auth_kind="none" if provider_id == "ollama" else "api-key",
            api_key="" if provider_id == "ollama" else "test-api-key",
        )
    )

    assert capability.status == expected_status
    assert capability.source == "verified"
    assert capability.reason_code == expected_reason_code
    assert capability.provider_hint == expected_provider_hint
    if expected_status == "verified-supported":
        assert capability.supported is True
        assert capability.supported_levels == ("off", "auto")
        assert capability.default_level == "auto"
    else:
        assert capability.supported is False
        assert capability.supported_levels == ()
        assert capability.default_level is None


@pytest.mark.parametrize(
    ("provider_id", "adapter_id", "runtime_status", "endpoint_type", "expected_reason_code"),
    [
        (
            "openrouter",
            "openrouter",
            "catalog-only",
            "openai-compatible",
            "provider_catalog_only",
        ),
        (
            "openai-response",
            "openai-response",
            "legacy-unsupported",
            "openai-response",
            "provider_legacy_unsupported",
        ),
    ],
)
def test_resolve_canonical_thinking_capability_marks_catalog_only_and_legacy_routes_as_verified_unsupported(
    provider_id: str,
    adapter_id: str,
    runtime_status: str,
    endpoint_type: str,
    expected_reason_code: str,
) -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_build_route(
            provider_id=provider_id,
            adapter_id=adapter_id,
            runtime_status=runtime_status,
            endpoint_type=endpoint_type,
            base_url="https://example.com/v1",
            model_id="test-model",
        )
    )

    assert capability.status == "verified-unsupported"
    assert capability.source == "verified"
    assert capability.supported is False
    assert capability.reason_code == expected_reason_code
    assert capability.provider_hint == provider_id


def test_resolve_canonical_thinking_capability_propagates_adapter_and_auth_failures_for_query_error_normalization() -> None:
    with pytest.raises(RuntimeProviderAdapterError) as adapter_missing_info:
        resolve_canonical_thinking_capability(
            model_route=_build_route(
                provider_id="openai",
                adapter_id="openai",
                endpoint_type="openai-compatible",
                base_url="https://api.openai.com/v1",
                model_id="gpt-4.1",
            ),
            provider_adapter_registry=RuntimeProviderAdapterRegistry(),
        )

    with pytest.raises(RuntimeProviderAdapterError) as auth_missing_info:
        resolve_canonical_thinking_capability(
            model_route=_build_route(
                provider_id="openai",
                adapter_id="openai",
                endpoint_type="openai-compatible",
                base_url="https://api.openai.com/v1",
                model_id="gpt-4.1",
                api_key="",
                auth_kind="api-key",
            )
        )

    assert adapter_missing_info.value.code == "adapter_missing"
    assert adapter_missing_info.value.details["providerId"] == "openai"

    assert auth_missing_info.value.code == "provider_auth_missing"
    assert auth_missing_info.value.details["providerId"] == "openai"


def test_resolve_canonical_thinking_capability_falls_back_to_unknown_for_catalog_unknown_routes() -> None:
    capability = resolve_canonical_thinking_capability(
        model_route=_build_route(
            provider_id="missing-provider",
            adapter_id="missing-provider",
            endpoint_type="openai-compatible",
            base_url="https://example.com/v1",
            model_id="mystery-model",
        )
    )

    assert capability.status == "unknown-without-override"
    assert capability.source == "unknown"
    assert capability.supported is False
    assert capability.reason_code == "route_not_verified"
    assert capability.provider_hint == "unknown-route"


def test_adapt_thinking_intent_does_not_apply_legacy_openai_compatible_mapping_for_glm_route() -> None:
    adaptation = adapt_thinking_intent(
        intent="auto",
        model_route=_build_route(
            provider_id="openai",
            adapter_id="openai",
            endpoint_type="openai-compatible",
            base_url="https://api.z.ai/api/paas/v4",
            model_id="glm-5-turbo",
        ),
    )

    assert adaptation.applied is False
    assert adaptation.applied_intent is None
    assert adaptation.reason == "requested_level_not_in_capability"
    assert adaptation.provider_mapping is None
    assert adaptation.model_settings is None
    assert adaptation.capability.status == "verified-unsupported"
    assert adaptation.capability.reason_code == "openai_thinking_not_supported_for_model"


def test_adapt_thinking_intent_fails_fast_for_verified_unsupported_model() -> None:
    adaptation = adapt_thinking_intent(
        intent="medium",
        model_route=_build_route(
            provider_id="mistral",
            adapter_id="mistral",
            endpoint_type="openai-compatible",
            base_url="https://api.mistral.ai/v1",
            model_id="mistral-large-latest",
        ),
    )

    assert adaptation.applied is False
    assert adaptation.applied_intent is None
    assert adaptation.reason == "requested_level_not_in_capability"
    assert adaptation.capability.status == "verified-unsupported"
    assert adaptation.capability.reason_code == "mistral_thinking_not_supported_for_model"


def _build_route(
    *,
    provider_id: str,
    adapter_id: str,
    endpoint_type: str,
    base_url: str,
    model_id: str,
    runtime_status: str = "enabled",
    auth_kind: str = "api-key",
    api_key: str = "test-api-key",
) -> ResolvedRuntimeModelRoute:
    return ResolvedRuntimeModelRoute(
        provider_profile_id=f"profile-{provider_id}",
        provider=provider_id,
        provider_id=provider_id,
        adapter_id=adapter_id,
        runtime_status=runtime_status,
        endpoint_type=endpoint_type,
        base_url=base_url,
        model_id=model_id,
        auth_kind=auth_kind,
        api_key=api_key,
    )

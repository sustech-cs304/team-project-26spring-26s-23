from __future__ import annotations

import pytest
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.groq import GroqModel
from pydantic_ai.models.mistral import MistralModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.providers.groq import GroqProvider
from pydantic_ai.providers.mistral import MistralProvider
from pydantic_ai.providers.ollama import OllamaProvider
from pydantic_ai.providers.openai import OpenAIProvider

from app.copilot_runtime.agent import (
    PydanticAIAgentExecutor,
    ProviderAdapterExecutionError,
)
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute


@pytest.mark.parametrize(
    (
        "provider_id",
        "endpoint_type",
        "adapter_id",
        "base_url",
        "auth_kind",
        "api_key",
        "expected_model_type",
        "expected_provider_type",
    ),
    [
        (
            "openai",
            "openai-compatible",
            "openai",
            "https://api.openai.com/v1",
            "api-key",
            "test-openai-key",
            OpenAIChatModel,
            OpenAIProvider,
        ),
        (
            "anthropic",
            "anthropic-native",
            "anthropic",
            "https://api.anthropic.com",
            "api-key",
            "test-anthropic-key",
            AnthropicModel,
            AnthropicProvider,
        ),
        (
            "gemini",
            "gemini-native",
            "gemini",
            "https://generativelanguage.googleapis.com",
            "api-key",
            "test-gemini-key",
            GoogleModel,
            GoogleProvider,
        ),
        (
            "ollama",
            "ollama-native",
            "ollama",
            "http://127.0.0.1:11434/v1",
            "none",
            "",
            OpenAIChatModel,
            OllamaProvider,
        ),
        (
            "groq",
            "openai-compatible",
            "groq",
            "https://api.groq.com/openai/v1",
            "api-key",
            "test-groq-key",
            GroqModel,
            GroqProvider,
        ),
        (
            "mistral",
            "openai-compatible",
            "mistral",
            "https://api.mistral.ai/v1",
            "api-key",
            "test-mistral-key",
            MistralModel,
            MistralProvider,
        ),
    ],
)
def test_pydantic_ai_agent_executor_build_stream_model_dispatches_first_batch_providers(
    provider_id: str,
    endpoint_type: str,
    adapter_id: str,
    base_url: str,
    auth_kind: str,
    api_key: str,
    expected_model_type: type[object],
    expected_provider_type: type[object],
) -> None:
    executor = PydanticAIAgentExecutor(env={})

    model = executor._build_stream_model(
        _build_resolved_route(
            provider_id=provider_id,
            endpoint_type=endpoint_type,
            adapter_id=adapter_id,
            base_url=base_url,
            auth_kind=auth_kind,
            api_key=api_key,
        )
    )

    assert isinstance(model, expected_model_type)
    assert isinstance(getattr(model, "_provider"), expected_provider_type)


@pytest.mark.parametrize(
    ("provider_id", "endpoint_type", "adapter_id", "runtime_status", "expected_code"),
    [
        (
            "openrouter",
            "openai-compatible",
            "openrouter",
            "catalog-only",
            "provider_catalog_only",
        ),
        (
            "openai-response",
            "openai-response",
            "openai-response",
            "legacy-unsupported",
            "provider_legacy_unsupported",
        ),
    ],
)
def test_pydantic_ai_agent_executor_build_stream_model_rejects_non_enabled_catalog_entries(
    provider_id: str,
    endpoint_type: str,
    adapter_id: str,
    runtime_status: str,
    expected_code: str,
) -> None:
    executor = PydanticAIAgentExecutor(env={})

    with pytest.raises(ProviderAdapterExecutionError) as exc_info:
        executor._build_stream_model(
            _build_resolved_route(
                provider_id=provider_id,
                endpoint_type=endpoint_type,
                adapter_id=adapter_id,
                runtime_status=runtime_status,
                base_url="https://example.com/v1",
                api_key="test-api-key",
            )
        )

    assert exc_info.value.code == expected_code


def test_pydantic_ai_agent_executor_build_stream_model_rejects_unknown_provider() -> (
    None
):
    executor = PydanticAIAgentExecutor(env={})

    with pytest.raises(ProviderAdapterExecutionError) as exc_info:
        executor._build_stream_model(
            _build_resolved_route(
                provider_id="unknown-provider",
                endpoint_type="openai-compatible",
                adapter_id="unknown-provider",
                base_url="https://example.com/v1",
                api_key="test-api-key",
            )
        )

    assert exc_info.value.code == "provider_unknown"


def test_pydantic_ai_agent_executor_build_stream_model_rejects_missing_openai_api_key() -> (
    None
):
    executor = PydanticAIAgentExecutor(env={})

    with pytest.raises(ProviderAdapterExecutionError) as exc_info:
        executor._build_stream_model(
            _build_resolved_route(
                provider_id="openai",
                endpoint_type="openai-compatible",
                adapter_id="openai",
                base_url="https://api.openai.com/v1",
                api_key="",
                auth_kind="api-key",
            )
        )

    assert exc_info.value.code == "provider_auth_missing"


def test_pydantic_ai_agent_executor_build_stream_model_rejects_mismatched_adapter_id() -> (
    None
):
    executor = PydanticAIAgentExecutor(env={})

    with pytest.raises(ProviderAdapterExecutionError) as exc_info:
        executor._build_stream_model(
            _build_resolved_route(
                provider_id="openai",
                endpoint_type="openai-compatible",
                adapter_id="not-openai",
                base_url="https://api.openai.com/v1",
                api_key="test-api-key",
            )
        )

    assert exc_info.value.code == "provider_adapter_mismatch"


def _build_resolved_route(
    *,
    provider_id: str,
    endpoint_type: str,
    adapter_id: str,
    base_url: str,
    api_key: str,
    auth_kind: str = "api-key",
    runtime_status: str = "enabled",
    model_id: str = "test-model",
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
        api_key=api_key,
        auth_kind=auth_kind,
    )

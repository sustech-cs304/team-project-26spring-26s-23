from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast

from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.groq import GroqModel
from pydantic_ai.models.mistral import MistralModel
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.providers.groq import GroqProvider
from pydantic_ai.providers.mistral import MistralProvider
from pydantic_ai.providers.ollama import OllamaProvider
from pydantic_ai.providers.openai import OpenAIProvider

from .model_routes import ResolvedRuntimeModelRoute
from .provider_catalog import ProviderCatalogEntry, get_provider_catalog_entry

RuntimeThinkingLevelIntent = Literal["off", "auto", "low", "medium", "high", "xhigh"]


class RuntimeProviderAdapterError(RuntimeError):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.details = dict(details or {})
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class RuntimeProviderThinkingCapability:
    supported: bool
    supported_levels: tuple[RuntimeThinkingLevelIntent, ...] = ()
    default_level: RuntimeThinkingLevelIntent | None = None
    reason_code: str = "provider_thinking_not_supported"
    provider_hint: str | None = None


@dataclass(frozen=True, slots=True)
class RuntimeProviderThinkingMapping:
    mapping: str
    model_settings: dict[str, Any] | None = None


class RuntimeProviderAdapter(Protocol):
    @property
    def adapter_id(self) -> str: ...

    @property
    def provider_family(self) -> str: ...

    def supports_streaming_execution(
        self,
        *,
        model_route: ResolvedRuntimeModelRoute,
        catalog_entry: ProviderCatalogEntry,
    ) -> bool: ...

    def build_model(
        self,
        *,
        model_route: ResolvedRuntimeModelRoute,
        catalog_entry: ProviderCatalogEntry,
    ) -> Any: ...

    def resolve_thinking_capability(
        self,
        *,
        model_route: ResolvedRuntimeModelRoute,
        catalog_entry: ProviderCatalogEntry,
    ) -> RuntimeProviderThinkingCapability: ...

    def build_thinking_mapping(
        self,
        *,
        intent: RuntimeThinkingLevelIntent,
        model_route: ResolvedRuntimeModelRoute,
        catalog_entry: ProviderCatalogEntry,
    ) -> RuntimeProviderThinkingMapping | None: ...


@dataclass(frozen=True, slots=True)
class _StaticRuntimeProviderAdapter:
    adapter_id: str
    provider_family: str
    build_model_impl: Callable[[ResolvedRuntimeModelRoute, ProviderCatalogEntry], Any]
    thinking_capability_impl: Callable[
        [ResolvedRuntimeModelRoute, ProviderCatalogEntry],
        RuntimeProviderThinkingCapability,
    ] | None = None
    thinking_mapping_impl: Callable[
        [RuntimeThinkingLevelIntent, ResolvedRuntimeModelRoute, ProviderCatalogEntry],
        RuntimeProviderThinkingMapping | None,
    ] | None = None

    def supports_streaming_execution(
        self,
        *,
        model_route: ResolvedRuntimeModelRoute,
        catalog_entry: ProviderCatalogEntry,
    ) -> bool:
        _ = (model_route, catalog_entry)
        return True

    def build_model(
        self,
        *,
        model_route: ResolvedRuntimeModelRoute,
        catalog_entry: ProviderCatalogEntry,
    ) -> Any:
        return self.build_model_impl(model_route, catalog_entry)

    def resolve_thinking_capability(
        self,
        *,
        model_route: ResolvedRuntimeModelRoute,
        catalog_entry: ProviderCatalogEntry,
    ) -> RuntimeProviderThinkingCapability:
        if self.thinking_capability_impl is None:
            return _build_verified_unsupported_thinking_capability(
                catalog_entry.provider_id
            )
        return self.thinking_capability_impl(model_route, catalog_entry)

    def build_thinking_mapping(
        self,
        *,
        intent: RuntimeThinkingLevelIntent,
        model_route: ResolvedRuntimeModelRoute,
        catalog_entry: ProviderCatalogEntry,
    ) -> RuntimeProviderThinkingMapping | None:
        if self.thinking_mapping_impl is None:
            return None
        return self.thinking_mapping_impl(intent, model_route, catalog_entry)


class RuntimeProviderAdapterRegistry:
    def __init__(self, adapters: Iterable[RuntimeProviderAdapter] = ()) -> None:
        self._adapters_by_id: dict[str, RuntimeProviderAdapter] = {}
        for adapter in adapters:
            self.register(adapter)

    def register(self, adapter: RuntimeProviderAdapter) -> RuntimeProviderAdapter:
        adapter_id = _normalize_optional_text(adapter.adapter_id)
        if adapter_id is None:
            raise ValueError("Runtime provider adapter must declare a non-empty adapter id.")
        if adapter_id in self._adapters_by_id:
            raise ValueError(f"Runtime provider adapter '{adapter_id}' is already registered.")
        self._adapters_by_id[adapter_id] = adapter
        return adapter

    def get(self, adapter_id: str) -> RuntimeProviderAdapter | None:
        normalized_adapter_id = _normalize_optional_text(adapter_id)
        if normalized_adapter_id is None:
            return None
        return self._adapters_by_id.get(normalized_adapter_id)

    def list_registered_adapter_ids(self) -> tuple[str, ...]:
        return tuple(sorted(self._adapters_by_id))

    def build_stream_model(self, *, model_route: ResolvedRuntimeModelRoute) -> Any:
        catalog_entry = self._resolve_catalog_entry(model_route)
        self._assert_runtime_enabled(model_route=model_route, catalog_entry=catalog_entry)
        self._validate_auth(model_route=model_route, catalog_entry=catalog_entry)
        adapter = self._resolve_adapter(model_route=model_route, catalog_entry=catalog_entry)
        if not adapter.supports_streaming_execution(
            model_route=model_route,
            catalog_entry=catalog_entry,
        ):
            raise RuntimeProviderAdapterError(
                code="streaming_not_supported_for_provider",
                message=(
                    f"Provider '{catalog_entry.provider_id}' does not support streamed chat execution in the Python runtime."
                ),
                details=_build_route_details(
                    model_route=model_route,
                    catalog_entry=catalog_entry,
                    adapter_id=adapter.adapter_id,
                ),
            )
        try:
            return adapter.build_model(
                model_route=model_route,
                catalog_entry=catalog_entry,
            )
        except RuntimeProviderAdapterError:
            raise
        except Exception as exc:  # pragma: no cover - defensive boundary for provider SDK failures
            raise RuntimeProviderAdapterError(
                code="provider_model_build_failed",
                message=(
                    f"Failed to build runtime model for provider '{catalog_entry.provider_id}' via adapter '{adapter.adapter_id}': {exc}"
                ),
                details=_build_route_details(
                    model_route=model_route,
                    catalog_entry=catalog_entry,
                    adapter_id=adapter.adapter_id,
                ),
            ) from exc

    def resolve_thinking_capability(
        self,
        *,
        model_route: ResolvedRuntimeModelRoute,
    ) -> RuntimeProviderThinkingCapability:
        catalog_entry = self._resolve_catalog_entry(model_route)
        self._assert_runtime_enabled(model_route=model_route, catalog_entry=catalog_entry)
        self._validate_auth(model_route=model_route, catalog_entry=catalog_entry)
        adapter = self._resolve_adapter(model_route=model_route, catalog_entry=catalog_entry)
        try:
            return adapter.resolve_thinking_capability(
                model_route=model_route,
                catalog_entry=catalog_entry,
            )
        except RuntimeProviderAdapterError:
            raise
        except Exception as exc:  # pragma: no cover - defensive boundary for provider-specific failures
            raise RuntimeProviderAdapterError(
                code="provider_thinking_capability_resolve_failed",
                message=(
                    f"Failed to resolve thinking capability for provider '{catalog_entry.provider_id}' via adapter '{adapter.adapter_id}': {exc}"
                ),
                details=_build_route_details(
                    model_route=model_route,
                    catalog_entry=catalog_entry,
                    adapter_id=adapter.adapter_id,
                ),
            ) from exc

    def build_thinking_mapping(
        self,
        *,
        intent: RuntimeThinkingLevelIntent,
        model_route: ResolvedRuntimeModelRoute,
    ) -> RuntimeProviderThinkingMapping | None:
        catalog_entry = self._resolve_catalog_entry(model_route)
        self._assert_runtime_enabled(model_route=model_route, catalog_entry=catalog_entry)
        self._validate_auth(model_route=model_route, catalog_entry=catalog_entry)
        adapter = self._resolve_adapter(model_route=model_route, catalog_entry=catalog_entry)
        try:
            return adapter.build_thinking_mapping(
                intent=intent,
                model_route=model_route,
                catalog_entry=catalog_entry,
            )
        except RuntimeProviderAdapterError:
            raise
        except Exception as exc:  # pragma: no cover - defensive boundary for provider-specific failures
            raise RuntimeProviderAdapterError(
                code="provider_thinking_mapping_failed",
                message=(
                    f"Failed to build thinking mapping for provider '{catalog_entry.provider_id}' via adapter '{adapter.adapter_id}': {exc}"
                ),
                details=_build_route_details(
                    model_route=model_route,
                    catalog_entry=catalog_entry,
                    adapter_id=adapter.adapter_id,
                ),
            ) from exc

    def _resolve_catalog_entry(self, model_route: ResolvedRuntimeModelRoute) -> ProviderCatalogEntry:
        provider_id = _normalize_optional_text(model_route.provider_id) or _normalize_optional_text(model_route.provider)
        if provider_id is None:
            raise RuntimeProviderAdapterError(
                code="provider_unknown",
                message="Resolved runtime route is missing provider identity.",
                details=_build_route_details(model_route=model_route),
            )
        catalog_entry = get_provider_catalog_entry(provider_id)
        if catalog_entry is None:
            raise RuntimeProviderAdapterError(
                code="provider_unknown",
                message=f"Provider '{provider_id}' is not present in the shared provider catalog.",
                details=_build_route_details(model_route=model_route, provider_id=provider_id),
            )
        return catalog_entry

    def _assert_runtime_enabled(
        self,
        *,
        model_route: ResolvedRuntimeModelRoute,
        catalog_entry: ProviderCatalogEntry,
    ) -> None:
        catalog_runtime_status = catalog_entry.runtime_status
        resolved_runtime_status = _normalize_optional_text(model_route.runtime_status) or catalog_runtime_status
        effective_runtime_status = (
            catalog_runtime_status if catalog_runtime_status != "enabled" else resolved_runtime_status
        )
        if effective_runtime_status == "enabled":
            return

        details = _build_route_details(
            model_route=model_route,
            catalog_entry=catalog_entry,
        )
        details["catalogRuntimeStatus"] = catalog_runtime_status
        details["resolvedRuntimeStatus"] = resolved_runtime_status
        if effective_runtime_status == "catalog-only":
            raise RuntimeProviderAdapterError(
                code="provider_catalog_only",
                message=(
                    f"Provider '{catalog_entry.provider_id}' is catalog-only and is not enabled for Python runtime execution."
                ),
                details=details,
            )
        if effective_runtime_status == "legacy-unsupported":
            raise RuntimeProviderAdapterError(
                code="provider_legacy_unsupported",
                message=(
                    f"Provider '{catalog_entry.provider_id}' is marked legacy / unsupported and cannot be executed by the Python runtime."
                ),
                details=details,
            )
        raise RuntimeProviderAdapterError(
            code="provider_runtime_not_enabled",
            message=(
                f"Provider '{catalog_entry.provider_id}' is not enabled for Python runtime execution (runtimeStatus='{effective_runtime_status}')."
            ),
            details=details,
        )

    def _resolve_adapter(
        self,
        *,
        model_route: ResolvedRuntimeModelRoute,
        catalog_entry: ProviderCatalogEntry,
    ) -> RuntimeProviderAdapter:
        requested_adapter_id = _normalize_optional_text(model_route.adapter_id)
        expected_adapter_id = catalog_entry.adapter_id
        if requested_adapter_id is not None and requested_adapter_id != expected_adapter_id:
            raise RuntimeProviderAdapterError(
                code="provider_adapter_mismatch",
                message=(
                    f"Resolved route adapter '{requested_adapter_id}' does not match catalog adapter '{expected_adapter_id}' for provider '{catalog_entry.provider_id}'."
                ),
                details=_build_route_details(
                    model_route=model_route,
                    catalog_entry=catalog_entry,
                    adapter_id=requested_adapter_id,
                    expected_adapter_id=expected_adapter_id,
                ),
            )
        adapter_id = requested_adapter_id or expected_adapter_id
        adapter = self._adapters_by_id.get(adapter_id)
        if adapter is not None:
            return adapter
        raise RuntimeProviderAdapterError(
            code="adapter_missing",
            message=(
                f"Provider '{catalog_entry.provider_id}' resolved to adapter '{adapter_id}', but that adapter is not registered in the Python runtime."
            ),
            details=_build_route_details(
                model_route=model_route,
                catalog_entry=catalog_entry,
                adapter_id=adapter_id,
            ),
        )

    def _validate_auth(
        self,
        *,
        model_route: ResolvedRuntimeModelRoute,
        catalog_entry: ProviderCatalogEntry,
    ) -> None:
        auth_kind = _normalize_optional_text(model_route.auth_kind) or catalog_entry.auth_schema.default_kind
        api_key = _normalize_optional_text(model_route.api_key)
        if auth_kind not in catalog_entry.auth_schema.supported_kinds:
            raise RuntimeProviderAdapterError(
                code="provider_auth_kind_unsupported",
                message=(
                    f"Provider '{catalog_entry.provider_id}' does not support auth kind '{auth_kind}'."
                ),
                details=_build_route_details(
                    model_route=model_route,
                    catalog_entry=catalog_entry,
                ),
            )
        if auth_kind == "api-key" and api_key is None:
            raise RuntimeProviderAdapterError(
                code="provider_auth_missing",
                message=(
                    f"Provider '{catalog_entry.provider_id}' requires an API key for streamed execution."
                ),
                details=_build_route_details(
                    model_route=model_route,
                    catalog_entry=catalog_entry,
                ),
            )


def build_default_provider_adapter_registry() -> RuntimeProviderAdapterRegistry:
    registry = RuntimeProviderAdapterRegistry()
    registry.register(
        _StaticRuntimeProviderAdapter(
            adapter_id="openai",
            provider_family="openai-compatible",
            build_model_impl=_build_openai_model,
            thinking_capability_impl=lambda model_route, catalog_entry: _build_verified_unsupported_thinking_capability(
                catalog_entry.provider_id
            ),
        )
    )
    registry.register(
        _StaticRuntimeProviderAdapter(
            adapter_id="anthropic",
            provider_family="anthropic-native",
            build_model_impl=_build_anthropic_model,
            thinking_capability_impl=lambda model_route, catalog_entry: _build_verified_unsupported_thinking_capability(
                catalog_entry.provider_id
            ),
        )
    )
    registry.register(
        _StaticRuntimeProviderAdapter(
            adapter_id="gemini",
            provider_family="gemini-native",
            build_model_impl=_build_gemini_model,
            thinking_capability_impl=lambda model_route, catalog_entry: _build_verified_unsupported_thinking_capability(
                catalog_entry.provider_id
            ),
        )
    )
    registry.register(
        _StaticRuntimeProviderAdapter(
            adapter_id="ollama",
            provider_family="ollama-native",
            build_model_impl=_build_ollama_model,
            thinking_capability_impl=lambda model_route, catalog_entry: _build_verified_unsupported_thinking_capability(
                catalog_entry.provider_id
            ),
        )
    )
    registry.register(
        _StaticRuntimeProviderAdapter(
            adapter_id="groq",
            provider_family="openai-compatible",
            build_model_impl=_build_groq_model,
            thinking_capability_impl=lambda model_route, catalog_entry: _build_verified_unsupported_thinking_capability(
                catalog_entry.provider_id
            ),
        )
    )
    registry.register(
        _StaticRuntimeProviderAdapter(
            adapter_id="mistral",
            provider_family="openai-compatible",
            build_model_impl=_build_mistral_model,
            thinking_capability_impl=lambda model_route, catalog_entry: _build_verified_unsupported_thinking_capability(
                catalog_entry.provider_id
            ),
        )
    )
    return registry


def _build_openai_model(
    model_route: ResolvedRuntimeModelRoute,
    _catalog_entry: ProviderCatalogEntry,
) -> OpenAIModel:
    provider = OpenAIProvider(
        base_url=model_route.base_url,
        api_key=_normalize_optional_text(model_route.api_key),
    )
    return OpenAIModel(model_route.model_id, provider=provider)


def _build_anthropic_model(
    model_route: ResolvedRuntimeModelRoute,
    _catalog_entry: ProviderCatalogEntry,
) -> AnthropicModel:
    provider = AnthropicProvider(
        api_key=_normalize_optional_text(model_route.api_key),
        base_url=model_route.base_url,
    )
    return AnthropicModel(model_route.model_id, provider=provider)


def _build_gemini_model(
    model_route: ResolvedRuntimeModelRoute,
    _catalog_entry: ProviderCatalogEntry,
) -> GoogleModel:
    provider = GoogleProvider(
        api_key=_normalize_optional_text(model_route.api_key),
        vertexai=False,
        base_url=model_route.base_url,
    )
    return GoogleModel(model_route.model_id, provider=provider)


def _build_ollama_model(
    model_route: ResolvedRuntimeModelRoute,
    _catalog_entry: ProviderCatalogEntry,
) -> OpenAIModel:
    provider = OllamaProvider(
        base_url=model_route.base_url,
        api_key=_normalize_optional_text(model_route.api_key),
    )
    return OpenAIModel(model_route.model_id, provider=provider)


def _build_groq_model(
    model_route: ResolvedRuntimeModelRoute,
    _catalog_entry: ProviderCatalogEntry,
) -> GroqModel:
    provider = GroqProvider(
        api_key=_normalize_optional_text(model_route.api_key),
        base_url=model_route.base_url,
    )
    return GroqModel(model_route.model_id, provider=provider)


def _build_mistral_model(
    model_route: ResolvedRuntimeModelRoute,
    _catalog_entry: ProviderCatalogEntry,
) -> MistralModel:
    provider = cast(Any, MistralProvider)(
        api_key=_normalize_optional_text(model_route.api_key),
        base_url=model_route.base_url,
    )
    return MistralModel(model_route.model_id, provider=provider)


def _build_verified_unsupported_thinking_capability(
    provider_id: str,
    *,
    reason_code: str | None = None,
    provider_hint: str | None = None,
) -> RuntimeProviderThinkingCapability:
    normalized_provider_id = _normalize_optional_text(provider_id) or "unknown-provider"
    return RuntimeProviderThinkingCapability(
        supported=False,
        supported_levels=(),
        default_level=None,
        reason_code=reason_code or f"{normalized_provider_id}_thinking_not_supported_for_model",
        provider_hint=provider_hint or normalized_provider_id,
    )


def _build_route_details(
    *,
    model_route: ResolvedRuntimeModelRoute,
    catalog_entry: ProviderCatalogEntry | None = None,
    provider_id: str | None = None,
    adapter_id: str | None = None,
    expected_adapter_id: str | None = None,
) -> dict[str, Any]:
    details: dict[str, Any] = {
        "providerProfileId": model_route.provider_profile_id,
        "provider": model_route.provider,
        "providerId": provider_id
        or _normalize_optional_text(model_route.provider_id)
        or (None if catalog_entry is None else catalog_entry.provider_id),
        "adapterId": adapter_id
        or _normalize_optional_text(model_route.adapter_id)
        or (None if catalog_entry is None else catalog_entry.adapter_id),
        "runtimeStatus": _normalize_optional_text(model_route.runtime_status),
        "endpointType": model_route.endpoint_type,
        "baseUrl": model_route.base_url,
        "modelId": model_route.model_id,
        "authKind": _normalize_optional_text(model_route.auth_kind),
    }
    if expected_adapter_id is not None:
        details["expectedAdapterId"] = expected_adapter_id
    return {key: value for key, value in details.items() if value is not None}


def _normalize_optional_text(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


__all__ = [
    "RuntimeProviderAdapter",
    "RuntimeProviderAdapterError",
    "RuntimeProviderAdapterRegistry",
    "RuntimeProviderThinkingCapability",
    "RuntimeProviderThinkingMapping",
    "RuntimeThinkingLevelIntent",
    "build_default_provider_adapter_registry",
]

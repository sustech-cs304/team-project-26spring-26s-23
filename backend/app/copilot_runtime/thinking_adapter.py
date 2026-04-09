from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from .model_routes import ResolvedRuntimeModelRoute
from .provider_adapter_registry import (
    RuntimeProviderAdapterError,
    RuntimeProviderAdapterRegistry,
    RuntimeProviderThinkingCapability,
    RuntimeProviderThinkingMapping,
    build_default_provider_adapter_registry,
)

ThinkingLevelIntent = Literal['off', 'auto', 'low', 'medium', 'high', 'xhigh']
ThinkingCapabilityStatus = Literal[
    'verified-supported',
    'verified-unsupported',
    'unknown-without-override',
]
ThinkingCapabilitySource = Literal['verified', 'unknown']

_POSITIVE_THINKING_LEVEL_ORDER: tuple[ThinkingLevelIntent, ...] = (
    'auto',
    'low',
    'medium',
    'high',
    'xhigh',
)
_POSITIVE_THINKING_LEVEL_SET = frozenset(_POSITIVE_THINKING_LEVEL_ORDER)
_DEFAULT_PROVIDER_ADAPTER_REGISTRY = build_default_provider_adapter_registry()
_VERIFIED_UNSUPPORTED_ADAPTER_ERROR_CODES = frozenset({
    'provider_catalog_only',
    'provider_legacy_unsupported',
    'provider_runtime_not_enabled',
})


@dataclass(frozen=True, slots=True)
class CanonicalThinkingCapability:
    status: ThinkingCapabilityStatus
    source: ThinkingCapabilitySource
    supported: bool
    supported_levels: tuple[ThinkingLevelIntent, ...]
    default_level: ThinkingLevelIntent | None
    reason_code: str
    provider_hint: str | None = None
    route_fingerprint: dict[str, str] = field(default_factory=dict)
    override_levels: tuple[ThinkingLevelIntent, ...] = ()

    def to_public_dict(self) -> dict[str, Any]:
        return {
            'status': self.status,
            'source': self.source,
            'supported': self.supported,
            'supportedLevels': list(self.supported_levels),
            'defaultLevel': self.default_level,
            'reasonCode': self.reason_code,
            'providerHint': self.provider_hint,
            'routeFingerprint': dict(self.route_fingerprint),
            'overrideLevels': list(self.override_levels),
        }

    def to_diagnostics(self) -> dict[str, Any]:
        diagnostics = {
            **dict(self.route_fingerprint),
            'status': self.status,
            'source': self.source,
            'supported': self.supported,
            'supportedLevels': list(self.supported_levels),
            'defaultLevel': self.default_level,
            'reasonCode': self.reason_code,
            'providerHint': self.provider_hint,
        }
        if len(self.override_levels) > 0:
            diagnostics['overrideLevels'] = list(self.override_levels)
        return diagnostics


@dataclass(frozen=True, slots=True)
class ThinkingAdaptationResult:
    requested_intent: ThinkingLevelIntent | None
    applied_intent: ThinkingLevelIntent | None
    applied: bool
    reason: str
    capability: CanonicalThinkingCapability
    model_settings: dict[str, Any] | None = None
    provider_mapping: str | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)


def resolve_canonical_thinking_capability(
    *,
    model_route: ResolvedRuntimeModelRoute,
    thinking_capability_override: Mapping[str, Any] | None = None,
    provider_adapter_registry: RuntimeProviderAdapterRegistry | None = None,
) -> CanonicalThinkingCapability:
    _ = thinking_capability_override
    route_fingerprint = _build_route_diagnostics(model_route)
    verified_capability = _resolve_verified_capability(
        model_route=model_route,
        route_fingerprint=route_fingerprint,
        provider_adapter_registry=provider_adapter_registry,
    )
    if verified_capability is not None:
        return verified_capability

    return CanonicalThinkingCapability(
        status='unknown-without-override',
        source='unknown',
        supported=False,
        supported_levels=(),
        default_level=None,
        reason_code='route_not_verified',
        provider_hint='unknown-route',
        route_fingerprint=route_fingerprint,
    )


def adapt_thinking_intent(
    *,
    intent: ThinkingLevelIntent | None,
    model_route: ResolvedRuntimeModelRoute,
    thinking_capability_override: Mapping[str, Any] | None = None,
    provider_adapter_registry: RuntimeProviderAdapterRegistry | None = None,
) -> ThinkingAdaptationResult:
    capability = resolve_canonical_thinking_capability(
        model_route=model_route,
        thinking_capability_override=thinking_capability_override,
        provider_adapter_registry=provider_adapter_registry,
    )

    if intent is None:
        return _build_adaptation_result(
            requested_intent=None,
            applied_intent=None,
            applied=False,
            reason='intent_missing',
            capability=capability,
            provider_mapping=None,
            model_settings=None,
        )

    if intent == 'off':
        provider_mapping = None
        if capability.source == 'verified' and capability.supported:
            provider_mapping = _resolve_provider_mapping(
                intent=intent,
                model_route=model_route,
                provider_adapter_registry=provider_adapter_registry,
            )
        return _build_adaptation_result(
            requested_intent=intent,
            applied_intent='off',
            applied=True,
            reason='thinking_disabled',
            capability=capability,
            provider_mapping=None if provider_mapping is None else provider_mapping.mapping,
            model_settings=None if provider_mapping is None else provider_mapping.model_settings,
        )

    if intent not in capability.supported_levels:
        return _build_adaptation_result(
            requested_intent=intent,
            applied_intent=None,
            applied=False,
            reason='requested_level_not_in_capability',
            capability=capability,
            provider_mapping=None,
            model_settings=None,
        )

    provider_mapping = _resolve_provider_mapping(
        intent=intent,
        model_route=model_route,
        provider_adapter_registry=provider_adapter_registry,
    )
    if provider_mapping is None:
        return _build_adaptation_result(
            requested_intent=intent,
            applied_intent=None,
            applied=False,
            reason='verified_level_not_mapped',
            capability=capability,
            provider_mapping=None,
            model_settings=None,
        )

    return _build_adaptation_result(
        requested_intent=intent,
        applied_intent=intent,
        applied=True,
        reason='verified_provider_mapping_applied',
        capability=capability,
        provider_mapping=provider_mapping.mapping,
        model_settings=provider_mapping.model_settings,
    )


def _build_adaptation_result(
    *,
    requested_intent: ThinkingLevelIntent | None,
    applied_intent: ThinkingLevelIntent | None,
    applied: bool,
    reason: str,
    capability: CanonicalThinkingCapability,
    provider_mapping: str | None,
    model_settings: dict[str, Any] | None,
) -> ThinkingAdaptationResult:
    diagnostics = {
        **capability.to_diagnostics(),
        'requestedThinkingLevel': requested_intent,
        'appliedThinkingLevel': applied_intent,
        'providerMapping': provider_mapping,
    }
    if model_settings is not None:
        diagnostics['modelSettings'] = model_settings
    return ThinkingAdaptationResult(
        requested_intent=requested_intent,
        applied_intent=applied_intent,
        applied=applied,
        reason=reason,
        capability=capability,
        model_settings=model_settings,
        provider_mapping=provider_mapping,
        diagnostics=diagnostics,
    )


def _resolve_verified_capability(
    *,
    model_route: ResolvedRuntimeModelRoute,
    route_fingerprint: dict[str, str],
    provider_adapter_registry: RuntimeProviderAdapterRegistry | None,
) -> CanonicalThinkingCapability | None:
    if _normalize_identifier(model_route.adapter_id) == '':
        return None

    try:
        resolved_capability = _resolve_provider_adapter_registry(
            provider_adapter_registry
        ).resolve_thinking_capability(model_route=model_route)
    except RuntimeProviderAdapterError as exc:
        if exc.code == 'provider_unknown':
            return None
        if exc.code in _VERIFIED_UNSUPPORTED_ADAPTER_ERROR_CODES:
            return _build_adapter_error_capability(
                error=exc,
                route_fingerprint=route_fingerprint,
                model_route=model_route,
            )
        raise

    if resolved_capability.supported:
        supported_levels = _normalize_supported_thinking_levels(
            resolved_capability.supported_levels
        )
        return CanonicalThinkingCapability(
            status='verified-supported',
            source='verified',
            supported=True,
            supported_levels=supported_levels,
            default_level=_resolve_verified_default_level(
                supported_levels=supported_levels,
                capability=resolved_capability,
            ),
            reason_code=resolved_capability.reason_code,
            provider_hint=resolved_capability.provider_hint,
            route_fingerprint=route_fingerprint,
        )
    return CanonicalThinkingCapability(
        status='verified-unsupported',
        source='verified',
        supported=False,
        supported_levels=(),
        default_level=None,
        reason_code=resolved_capability.reason_code,
        provider_hint=resolved_capability.provider_hint,
        route_fingerprint=route_fingerprint,
    )


def _build_adapter_error_capability(
    *,
    error: RuntimeProviderAdapterError,
    route_fingerprint: dict[str, str],
    model_route: ResolvedRuntimeModelRoute,
) -> CanonicalThinkingCapability:
    provider_hint = _normalize_identifier(
        str(
            error.details.get('providerId')
            or model_route.provider_id
            or model_route.provider
        )
    )
    return CanonicalThinkingCapability(
        status='verified-unsupported',
        source='verified',
        supported=False,
        supported_levels=(),
        default_level=None,
        reason_code=error.code,
        provider_hint=provider_hint or None,
        route_fingerprint=route_fingerprint,
    )


def _resolve_provider_mapping(
    *,
    intent: ThinkingLevelIntent,
    model_route: ResolvedRuntimeModelRoute,
    provider_adapter_registry: RuntimeProviderAdapterRegistry | None,
) -> RuntimeProviderThinkingMapping | None:
    return _resolve_provider_adapter_registry(
        provider_adapter_registry
    ).build_thinking_mapping(
        intent=intent,
        model_route=model_route,
    )


def _resolve_provider_adapter_registry(
    provider_adapter_registry: RuntimeProviderAdapterRegistry | None,
) -> RuntimeProviderAdapterRegistry:
    return provider_adapter_registry or _DEFAULT_PROVIDER_ADAPTER_REGISTRY


def _normalize_supported_thinking_levels(
    levels: tuple[ThinkingLevelIntent, ...],
) -> tuple[ThinkingLevelIntent, ...]:
    normalized_positive_levels = [
        level
        for level in levels
        if level != 'off' and level in _POSITIVE_THINKING_LEVEL_SET
    ]
    if len(normalized_positive_levels) == 0:
        return ('off',)
    return ('off', *tuple(
        level for level in _POSITIVE_THINKING_LEVEL_ORDER if level in normalized_positive_levels
    ))


def _resolve_verified_default_level(
    *,
    supported_levels: tuple[ThinkingLevelIntent, ...],
    capability: RuntimeProviderThinkingCapability,
) -> ThinkingLevelIntent:
    default_level = capability.default_level
    if default_level == 'off':
        return 'off'
    if default_level is not None and default_level in supported_levels:
        return default_level
    if 'auto' in supported_levels:
        return 'auto'
    return supported_levels[0]


def _build_route_diagnostics(model_route: ResolvedRuntimeModelRoute) -> dict[str, str]:
    return {
        'providerProfileId': model_route.provider_profile_id,
        'provider': _normalize_identifier(model_route.provider_id or model_route.provider),
        'endpointType': model_route.endpoint_type,
        'baseUrl': model_route.base_url,
        'modelId': model_route.model_id,
    }


def _normalize_identifier(value: str) -> str:
    return value.strip().lower()


__all__ = [
    'CanonicalThinkingCapability',
    'ThinkingAdaptationResult',
    'ThinkingCapabilitySource',
    'ThinkingCapabilityStatus',
    'ThinkingLevelIntent',
    'adapt_thinking_intent',
    'resolve_canonical_thinking_capability',
]

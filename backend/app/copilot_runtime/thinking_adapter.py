from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from .model_routes import ResolvedRuntimeModelRoute

ThinkingLevelIntent = Literal['off', 'auto', 'low', 'medium', 'high', 'xhigh']
PositiveThinkingLevelIntent = Literal['auto', 'low', 'medium', 'high', 'xhigh']
ThinkingCapabilityStatus = Literal[
    'verified-supported',
    'verified-unsupported',
    'unknown-without-override',
    'unknown-with-override',
]
ThinkingCapabilitySource = Literal['verified', 'override', 'unknown']

_POSITIVE_THINKING_LEVEL_ORDER: tuple[PositiveThinkingLevelIntent, ...] = (
    'auto',
    'low',
    'medium',
    'high',
    'xhigh',
)
_POSITIVE_THINKING_LEVEL_SET = frozenset(_POSITIVE_THINKING_LEVEL_ORDER)
_GLM_5_TURBO_SUPPORTED_LEVELS: tuple[ThinkingLevelIntent, ...] = ('off', 'auto')
_GLM_5_TURBO_HOST_HINTS = ('z.ai', 'bigmodel.cn')
_GLM_5_TURBO_PROVIDER_HINT = 'zai-glm-openai-compatible'


@dataclass(frozen=True, slots=True)
class ThinkingCapabilityOverrideInput:
    supported: bool
    levels: tuple[PositiveThinkingLevelIntent, ...] = ()
    default_level: ThinkingLevelIntent | None = None


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


@dataclass(frozen=True, slots=True)
class _ProviderThinkingMapping:
    mapping: str
    model_settings: dict[str, Any] | None


def parse_thinking_capability_override(
    raw_override: Mapping[str, Any] | None,
) -> ThinkingCapabilityOverrideInput | None:
    if not isinstance(raw_override, Mapping):
        return None

    supported = raw_override.get('supported')
    if supported is False:
        return ThinkingCapabilityOverrideInput(supported=False)
    if supported is not True:
        return None

    levels = _normalize_positive_thinking_levels(raw_override.get('levels'))
    default_level = _normalize_thinking_level_intent(raw_override.get('defaultLevel'))
    return ThinkingCapabilityOverrideInput(
        supported=True,
        levels=levels,
        default_level=default_level,
    )


def resolve_canonical_thinking_capability(
    *,
    model_route: ResolvedRuntimeModelRoute,
    thinking_capability_override: Mapping[str, Any] | None = None,
) -> CanonicalThinkingCapability:
    route_fingerprint = _build_route_diagnostics(model_route)
    verified_capability = _resolve_verified_capability(
        model_route=model_route,
        route_fingerprint=route_fingerprint,
    )
    if verified_capability is not None:
        return verified_capability

    override_input = parse_thinking_capability_override(thinking_capability_override)
    if override_input is not None and override_input.supported and len(override_input.levels) > 0:
        supported_levels: tuple[ThinkingLevelIntent, ...] = ('off', *override_input.levels)
        return CanonicalThinkingCapability(
            status='unknown-with-override',
            source='override',
            supported=True,
            supported_levels=supported_levels,
            default_level=_resolve_default_level(
                levels=override_input.levels,
                default_level=override_input.default_level,
            ),
            reason_code='override_candidate_levels_applied',
            provider_hint='unknown-route-override',
            route_fingerprint=route_fingerprint,
            override_levels=supported_levels,
        )

    if override_input is not None and override_input.supported is False:
        return CanonicalThinkingCapability(
            status='unknown-without-override',
            source='unknown',
            supported=False,
            supported_levels=(),
            default_level=None,
            reason_code='override_declares_unsupported_for_unknown_route',
            provider_hint='unknown-route',
            route_fingerprint=route_fingerprint,
        )

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
) -> ThinkingAdaptationResult:
    capability = resolve_canonical_thinking_capability(
        model_route=model_route,
        thinking_capability_override=thinking_capability_override,
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
        provider_mapping = _resolve_provider_mapping(intent=intent, model_route=model_route)
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

    if capability.source != 'verified':
        return _build_adaptation_result(
            requested_intent=intent,
            applied_intent=None,
            applied=False,
            reason='requested_level_requires_verified_mapping',
            capability=capability,
            provider_mapping=None,
            model_settings=None,
        )

    provider_mapping = _resolve_provider_mapping(intent=intent, model_route=model_route)
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
) -> CanonicalThinkingCapability | None:
    if _is_zai_glm_openai_compatible_route(model_route):
        return CanonicalThinkingCapability(
            status='verified-supported',
            source='verified',
            supported=True,
            supported_levels=_GLM_5_TURBO_SUPPORTED_LEVELS,
            default_level='auto',
            reason_code='zai_glm_verified_supported',
            provider_hint=_GLM_5_TURBO_PROVIDER_HINT,
            route_fingerprint=route_fingerprint,
        )
    return None


def _resolve_provider_mapping(
    *,
    intent: ThinkingLevelIntent,
    model_route: ResolvedRuntimeModelRoute,
) -> _ProviderThinkingMapping | None:
    if _is_zai_glm_openai_compatible_route(model_route):
        if intent == 'off':
            return _ProviderThinkingMapping(
                mapping='zai_glm_openai_compatible',
                model_settings={
                    'extra_body': {
                        'thinking': {
                            'type': 'disabled',
                        },
                    },
                },
            )
        if intent == 'auto':
            return _ProviderThinkingMapping(
                mapping='zai_glm_openai_compatible',
                model_settings={
                    'extra_body': {
                        'thinking': {
                            'type': 'enabled',
                        },
                    },
                },
            )
    return None


def _is_zai_glm_openai_compatible_route(model_route: ResolvedRuntimeModelRoute) -> bool:
    provider = _normalize_identifier(model_route.provider)
    endpoint_type = _normalize_identifier(model_route.endpoint_type)
    model_id = _normalize_identifier(model_route.model_id)
    base_url = _normalize_identifier(model_route.base_url)

    return (
        provider == 'openai'
        and endpoint_type == 'openai-compatible'
        and _matches_zai_glm_model_id(model_id)
        and any(host_hint in base_url for host_hint in _GLM_5_TURBO_HOST_HINTS)
    )


def _matches_zai_glm_model_id(model_id: str) -> bool:
    return (
        model_id == 'glm-5'
        or model_id == 'glm-5-turbo'
        or model_id.endswith('/glm-5')
        or model_id.endswith('/glm-5-turbo')
    )


def _build_route_diagnostics(model_route: ResolvedRuntimeModelRoute) -> dict[str, str]:
    return {
        'providerProfileId': model_route.provider_profile_id,
        'provider': model_route.provider,
        'endpointType': model_route.endpoint_type,
        'baseUrl': model_route.base_url,
        'modelId': model_route.model_id,
    }


def _resolve_default_level(
    *,
    levels: tuple[PositiveThinkingLevelIntent, ...],
    default_level: ThinkingLevelIntent | None,
) -> ThinkingLevelIntent:
    if len(levels) == 0:
        return 'off'
    if default_level == 'off':
        return 'off'
    if default_level in levels:
        return default_level
    if 'auto' in levels:
        return 'auto'
    return levels[0]


def _normalize_thinking_level_intent(value: Any) -> ThinkingLevelIntent | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized in {'off', 'auto', 'low', 'medium', 'high', 'xhigh'}:
        return normalized
    return None


def _normalize_positive_thinking_levels(value: Any) -> tuple[PositiveThinkingLevelIntent, ...]:
    if not isinstance(value, list):
        return ()
    normalized = {
        level
        for item in value
        for level in [_normalize_thinking_level_intent(item)]
        if level is not None and level != 'off' and level in _POSITIVE_THINKING_LEVEL_SET
    }
    return tuple(level for level in _POSITIVE_THINKING_LEVEL_ORDER if level in normalized)


def _normalize_identifier(value: str) -> str:
    return value.strip().lower()


__all__ = [
    'CanonicalThinkingCapability',
    'ThinkingAdaptationResult',
    'ThinkingCapabilityOverrideInput',
    'ThinkingCapabilitySource',
    'ThinkingCapabilityStatus',
    'ThinkingLevelIntent',
    'adapt_thinking_intent',
    'parse_thinking_capability_override',
    'resolve_canonical_thinking_capability',
]

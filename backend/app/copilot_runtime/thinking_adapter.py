from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .model_routes import ResolvedRuntimeModelRoute

ThinkingLevelIntent = Literal['off', 'auto', 'low', 'medium', 'high', 'max']
_GLM_5_TURBO_SUPPORTED_LEVELS = ('off', 'auto')
_GLM_5_TURBO_HOST_HINTS = ('z.ai', 'bigmodel.cn')


@dataclass(frozen=True, slots=True)
class ThinkingAdaptationResult:
    intent: ThinkingLevelIntent | None
    applied: bool
    reason: str
    model_settings: dict[str, Any] | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)


def adapt_thinking_intent(
    *,
    intent: ThinkingLevelIntent | None,
    model_route: ResolvedRuntimeModelRoute,
) -> ThinkingAdaptationResult:
    if intent is None:
        return ThinkingAdaptationResult(
            intent=None,
            applied=False,
            reason='intent_missing',
            diagnostics=_build_route_diagnostics(model_route),
        )

    if _is_zai_glm_openai_compatible_route(model_route):
        if intent == 'off':
            return ThinkingAdaptationResult(
                intent=intent,
                applied=True,
                reason='zai_glm_disabled',
                model_settings={
                    'extra_body': {
                        'thinking': {
                            'type': 'disabled',
                        },
                    },
                },
                diagnostics={
                    **_build_route_diagnostics(model_route),
                    'mapping': 'zai_glm_openai_compatible',
                    'supportedLevels': list(_GLM_5_TURBO_SUPPORTED_LEVELS),
                },
            )

        if intent == 'auto':
            return ThinkingAdaptationResult(
                intent=intent,
                applied=True,
                reason='zai_glm_enabled',
                model_settings={
                    'extra_body': {
                        'thinking': {
                            'type': 'enabled',
                        },
                    },
                },
                diagnostics={
                    **_build_route_diagnostics(model_route),
                    'mapping': 'zai_glm_openai_compatible',
                    'supportedLevels': list(_GLM_5_TURBO_SUPPORTED_LEVELS),
                },
            )

        return ThinkingAdaptationResult(
            intent=intent,
            applied=False,
            reason='level_not_mapped_for_zai_glm',
            diagnostics={
                **_build_route_diagnostics(model_route),
                'mapping': 'zai_glm_openai_compatible',
                'supportedLevels': list(_GLM_5_TURBO_SUPPORTED_LEVELS),
            },
        )

    return ThinkingAdaptationResult(
        intent=intent,
        applied=False,
        reason='route_not_mapped',
        diagnostics=_build_route_diagnostics(model_route),
    )


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


def _build_route_diagnostics(model_route: ResolvedRuntimeModelRoute) -> dict[str, Any]:
    return {
        'providerProfileId': model_route.provider_profile_id,
        'provider': model_route.provider,
        'endpointType': model_route.endpoint_type,
        'baseUrl': model_route.base_url,
        'modelId': model_route.model_id,
    }


def _normalize_identifier(value: str) -> str:
    return value.strip().lower()


__all__ = [
    'ThinkingAdaptationResult',
    'ThinkingLevelIntent',
    'adapt_thinking_intent',
]

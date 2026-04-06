from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, cast

from .contracts import RuntimeThinkingSelection
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
ThinkingControlKind = Literal['fixed', 'binary', 'off-auto', 'discrete', 'budget']
ThinkingSelectionKind = Literal['preset', 'budget']
ThinkingRouteStatus = Literal['verified', 'unknown']
ThinkingVisibilityMode = Literal['visible', 'suppressed']
ThinkingOverrideFormat = Literal['legacy-levels', 'series-input', 'canonical-control']

_THINKING_LEVEL_ORDER: tuple[ThinkingLevelIntent, ...] = ('off', 'auto', 'low', 'medium', 'high', 'xhigh')
_THINKING_LEVEL_SET = frozenset(_THINKING_LEVEL_ORDER)
_POSITIVE_THINKING_LEVEL_ORDER: tuple[PositiveThinkingLevelIntent, ...] = (
    'auto',
    'low',
    'medium',
    'high',
    'xhigh',
)
_POSITIVE_THINKING_LEVEL_SET = frozenset(_POSITIVE_THINKING_LEVEL_ORDER)
_GLM_5_TURBO_HOST_HINTS = ('z.ai', 'bigmodel.cn')
_GLM_5_TURBO_PROVIDER_HINT = 'zai-glm-openai-compatible'
_GLM_5_SERIES = 'zai-glm-thinking-v1'
_GLM_FIXED_OFF_SERIES = 'zai-glm-fixed-off-v1'
_FIXED_OFF_SERIES = 'fixed-off-v1'
_OVERRIDE_OFF_AUTO_SERIES = 'compat-override-off-auto-v1'
_OVERRIDE_BINARY_SERIES = 'compat-override-binary-v1'
_OVERRIDE_DISCRETE_SERIES = 'compat-override-discrete-v1'
_OVERRIDE_BUDGET_SERIES = 'compat-override-budget-v1'
_DEFAULT_OVERRIDE_SOURCE = 'settings-model-declaration'
_DEFAULT_UNKNOWN_PROVIDER_HINT = 'unknown-route'
_DEFAULT_UNKNOWN_OVERRIDE_PROVIDER_HINT = 'unknown-route-override'
_GLM_4_UNSUPPORTED_MODEL_IDS = (
    'glm-4',
    'glm-4-plus',
    'glm-4-air',
    'glm-4-airx',
)


@dataclass(frozen=True, slots=True)
class CanonicalThinkingSelection:
    kind: ThinkingSelectionKind
    value: ThinkingLevelIntent | None = None
    budget_tokens: int | None = None

    def to_public_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {'kind': self.kind}
        if self.value is not None:
            payload['value'] = self.value
        if self.budget_tokens is not None:
            payload['budgetTokens'] = self.budget_tokens
        return payload

    def to_legacy_level(self) -> ThinkingLevelIntent | None:
        if self.kind != 'preset' or self.value not in _THINKING_LEVEL_SET:
            return None
        return self.value


@dataclass(frozen=True, slots=True)
class ThinkingControlSpec:
    kind: ThinkingControlKind
    preset_options: tuple[CanonicalThinkingSelection, ...] = ()
    budget_min_tokens: int | None = None
    budget_max_tokens: int | None = None
    budget_step_tokens: int | None = None

    def to_public_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            'kind': self.kind,
            'selectionKind': 'budget' if self.kind == 'budget' else 'preset',
        }
        if len(self.preset_options) > 0:
            payload['presetOptions'] = [option.to_public_dict() for option in self.preset_options]
        if self.kind == 'fixed' and len(self.preset_options) > 0:
            payload['fixedSelection'] = self.preset_options[0].to_public_dict()
        if self.kind == 'budget':
            budget: dict[str, Any] = {}
            if self.budget_min_tokens is not None:
                budget['minTokens'] = self.budget_min_tokens
            if self.budget_max_tokens is not None:
                budget['maxTokens'] = self.budget_max_tokens
            if self.budget_step_tokens is not None:
                budget['stepTokens'] = self.budget_step_tokens
            if len(budget) > 0:
                payload['budget'] = budget
        return payload


@dataclass(frozen=True, slots=True)
class ThinkingCapabilityProvenance:
    route_status: ThinkingRouteStatus
    override_present: bool = False
    override_applied: bool = False
    override_source: str | None = None
    override_format: ThinkingOverrideFormat | None = None

    def to_public_dict(self) -> dict[str, Any]:
        return {
            'routeStatus': self.route_status,
            'override': {
                'present': self.override_present,
                'applied': self.override_applied,
                'source': self.override_source,
                'format': self.override_format,
            },
        }


@dataclass(frozen=True, slots=True)
class ThinkingCapabilityVisibility:
    reasoning: ThinkingVisibilityMode = 'visible'
    supports_suppression: bool = True

    def to_public_dict(self) -> dict[str, Any]:
        return {
            'reasoning': self.reasoning,
            'supportsSuppression': self.supports_suppression,
        }


@dataclass(frozen=True, slots=True)
class ThinkingCapabilityOverrideInput:
    supported: bool
    levels: tuple[PositiveThinkingLevelIntent, ...] = ()
    default_level: ThinkingLevelIntent | None = None
    series: str | None = None
    control_spec: ThinkingControlSpec | None = None
    default_selection: CanonicalThinkingSelection | None = None
    override_source: str = _DEFAULT_OVERRIDE_SOURCE
    visibility: ThinkingCapabilityVisibility | None = None
    format: ThinkingOverrideFormat = 'legacy-levels'

    def has_usable_control(self) -> bool:
        return self.control_spec is not None or len(self.levels) > 0


@dataclass(frozen=True, slots=True)
class CanonicalThinkingCapability:
    status: ThinkingCapabilityStatus
    source: ThinkingCapabilitySource
    supported: bool
    series: str
    control_spec: ThinkingControlSpec
    default_selection: CanonicalThinkingSelection
    reason_code: str
    provider_hint: str | None = None
    route_fingerprint: dict[str, str] = field(default_factory=dict)
    provenance: ThinkingCapabilityProvenance = field(
        default_factory=ThinkingCapabilityProvenance,
    )
    visibility: ThinkingCapabilityVisibility = field(
        default_factory=ThinkingCapabilityVisibility,
    )
    supported_levels: tuple[ThinkingLevelIntent, ...] = ()
    default_level: ThinkingLevelIntent | None = None
    override_levels: tuple[ThinkingLevelIntent, ...] = ()

    def to_public_dict(self) -> dict[str, Any]:
        return {
            'status': self.status,
            'source': self.source,
            'supported': self.supported,
            'series': self.series,
            'controlSpec': self.control_spec.to_public_dict(),
            'defaultSelection': self.default_selection.to_public_dict(),
            'reasonCode': self.reason_code,
            'providerHint': self.provider_hint,
            'routeFingerprint': dict(self.route_fingerprint),
            'provenance': self.provenance.to_public_dict(),
            'visibility': self.visibility.to_public_dict(),
            'supportedLevels': list(self.supported_levels),
            'defaultLevel': self.default_level,
            'overrideLevels': list(self.override_levels),
        }

    def to_diagnostics(self) -> dict[str, Any]:
        diagnostics = {
            **dict(self.route_fingerprint),
            'status': self.status,
            'source': self.source,
            'supported': self.supported,
            'series': self.series,
            'controlSpec': self.control_spec.to_public_dict(),
            'defaultSelection': self.default_selection.to_public_dict(),
            'reasonCode': self.reason_code,
            'providerHint': self.provider_hint,
            'provenance': self.provenance.to_public_dict(),
            'visibility': self.visibility.to_public_dict(),
            'supportedLevels': list(self.supported_levels),
            'defaultLevel': self.default_level,
        }
        if len(self.override_levels) > 0:
            diagnostics['overrideLevels'] = list(self.override_levels)
        return diagnostics


@dataclass(frozen=True, slots=True)
class ThinkingAdaptationResult:
    requested_selection: CanonicalThinkingSelection | None
    applied_selection: CanonicalThinkingSelection | None
    requested_intent: ThinkingLevelIntent | None
    applied_intent: ThinkingLevelIntent | None
    applied: bool
    reason: str
    capability: CanonicalThinkingCapability
    error_code: str | None = None
    model_settings: dict[str, Any] | None = None
    provider_mapping: str | None = None
    mapping_reason_code: str | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_public_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            'requestedSelection': (
                None if self.requested_selection is None else self.requested_selection.to_public_dict()
            ),
            'appliedSelection': (
                None if self.applied_selection is None else self.applied_selection.to_public_dict()
            ),
            'requestedThinkingLevel': self.requested_intent,
            'appliedThinkingLevel': self.applied_intent,
            'applied': self.applied,
            'reasonCode': self.reason,
            'errorCode': self.error_code,
            'mappingReasonCode': self.mapping_reason_code,
            'providerMapping': self.provider_mapping,
            'capabilityStatus': self.capability.status,
            'capabilitySource': self.capability.source,
            'capabilitySeries': self.capability.series,
            'capabilityReasonCode': self.capability.reason_code,
            'overridePresent': self.capability.provenance.override_present,
            'overrideApplied': self.capability.provenance.override_applied,
            'overrideSource': self.capability.provenance.override_source,
            'reasoningVisibility': self.capability.visibility.reasoning,
            'supportsSuppression': self.capability.visibility.supports_suppression,
        }
        if self.model_settings is not None:
            payload['modelSettings'] = self.model_settings
        return payload


@dataclass(frozen=True, slots=True)
class _ProviderThinkingMapping:
    mapping: str
    model_settings: dict[str, Any] | None
    reason_code: str


def parse_thinking_capability_override(
    raw_override: Mapping[str, Any] | None,
) -> ThinkingCapabilityOverrideInput | None:
    if not isinstance(raw_override, Mapping):
        return None

    supported = raw_override.get('supported')
    if supported is not False and supported is not True:
        return None

    levels = _normalize_positive_thinking_levels(raw_override.get('levels'))
    default_level = _normalize_thinking_level_intent(raw_override.get('defaultLevel'))
    series = _normalize_optional_string(raw_override.get('series'))
    default_selection = _parse_thinking_selection(raw_override.get('defaultSelection'))
    control_spec = _parse_thinking_control_spec(raw_override.get('controlSpec'))
    series_input_control_spec = _parse_series_input_control_spec(raw_override.get('input'))
    visibility = _parse_thinking_visibility(raw_override.get('visibility'))
    override_source = _normalize_optional_string(raw_override.get('source')) or _DEFAULT_OVERRIDE_SOURCE

    format: ThinkingOverrideFormat = 'legacy-levels'
    if raw_override.get('input') is not None:
        format = 'series-input'
        control_spec = series_input_control_spec
        if control_spec is not None:
            levels = tuple(
                level
                for level in _extract_legacy_levels_from_control_spec(control_spec)
                if level != 'off'
            )
            default_level = None if default_selection is None else default_selection.to_legacy_level()
    elif control_spec is not None or default_selection is not None:
        format = 'canonical-control'

    return ThinkingCapabilityOverrideInput(
        supported=cast(bool, supported),
        levels=levels,
        default_level=default_level,
        series=series,
        control_spec=control_spec,
        default_selection=default_selection,
        override_source=override_source,
        visibility=visibility,
        format=format,
    )


def resolve_canonical_thinking_capability(
    *,
    model_route: ResolvedRuntimeModelRoute,
    thinking_capability_override: Mapping[str, Any] | None = None,
) -> CanonicalThinkingCapability:
    route_fingerprint = _build_route_diagnostics(model_route)
    override_input = parse_thinking_capability_override(thinking_capability_override)
    verified_capability = _resolve_verified_capability(
        model_route=model_route,
        route_fingerprint=route_fingerprint,
        override_input=override_input,
    )
    if verified_capability is not None:
        return verified_capability

    if override_input is not None and override_input.supported and override_input.has_usable_control():
        control_spec = _resolve_override_control_spec(override_input)
        if control_spec is not None:
            default_selection = _resolve_default_selection(
                control_spec=control_spec,
                default_selection=override_input.default_selection,
                default_level=override_input.default_level,
            )
            return _build_canonical_capability(
                status='unknown-with-override',
                source='override',
                supported=True,
                series=_resolve_override_series(override_input=override_input, control_spec=control_spec),
                control_spec=control_spec,
                default_selection=default_selection,
                reason_code='override_candidate_control_applied',
                provider_hint=_DEFAULT_UNKNOWN_OVERRIDE_PROVIDER_HINT,
                route_fingerprint=route_fingerprint,
                provenance=_build_provenance(
                    route_status='unknown',
                    override_input=override_input,
                    override_applied=True,
                ),
                visibility=_resolve_visibility(override_input),
            )

    if override_input is not None and override_input.supported is False:
        return _build_fixed_off_capability(
            status='unknown-without-override',
            source='unknown',
            series=_FIXED_OFF_SERIES,
            reason_code='override_declares_unsupported_for_unknown_route',
            provider_hint=_DEFAULT_UNKNOWN_PROVIDER_HINT,
            route_fingerprint=route_fingerprint,
            provenance=_build_provenance(
                route_status='unknown',
                override_input=override_input,
                override_applied=False,
            ),
            visibility=_resolve_visibility(override_input),
        )

    if override_input is not None and override_input.supported and not override_input.has_usable_control():
        return _build_fixed_off_capability(
            status='unknown-without-override',
            source='unknown',
            series=_FIXED_OFF_SERIES,
            reason_code='override_missing_usable_control_for_unknown_route',
            provider_hint=_DEFAULT_UNKNOWN_PROVIDER_HINT,
            route_fingerprint=route_fingerprint,
            provenance=_build_provenance(
                route_status='unknown',
                override_input=override_input,
                override_applied=False,
            ),
            visibility=_resolve_visibility(override_input),
        )

    return _build_fixed_off_capability(
        status='unknown-without-override',
        source='unknown',
        series=_FIXED_OFF_SERIES,
        reason_code='route_not_verified',
        provider_hint=_DEFAULT_UNKNOWN_PROVIDER_HINT,
        route_fingerprint=route_fingerprint,
        provenance=_build_provenance(
            route_status='unknown',
            override_input=override_input,
            override_applied=False,
        ),
        visibility=_resolve_visibility(override_input),
    )


def adapt_thinking_selection(
    *,
    selection: RuntimeThinkingSelection | None,
    model_route: ResolvedRuntimeModelRoute,
    thinking_capability_override: Mapping[str, Any] | None = None,
) -> ThinkingAdaptationResult:
    capability = resolve_canonical_thinking_capability(
        model_route=model_route,
        thinking_capability_override=thinking_capability_override,
    )
    requested_selection = _to_canonical_requested_selection(selection)
    requested_intent = None if requested_selection is None else requested_selection.to_legacy_level()

    if selection is None:
        return _build_adaptation_result(
            requested_selection=None,
            applied_selection=None,
            requested_intent=None,
            applied_intent=None,
            applied=False,
            reason='intent_missing',
            capability=capability,
            error_code=None,
            provider_mapping=None,
            model_settings=None,
            mapping_reason_code='selection_missing',
        )

    if requested_selection is None:
        return _build_adaptation_result(
            requested_selection=None,
            applied_selection=None,
            requested_intent=None,
            applied_intent=None,
            applied=False,
            reason='requested_selection_invalid',
            capability=capability,
            error_code='thinking_level_not_allowed',
            provider_mapping=None,
            model_settings=None,
            mapping_reason_code='requested_selection_invalid',
        )

    if not _selection_allowed(requested_selection, capability.control_spec):
        return _build_adaptation_result(
            requested_selection=requested_selection,
            applied_selection=None,
            requested_intent=requested_intent,
            applied_intent=None,
            applied=False,
            reason=(
                'requested_level_not_in_capability'
                if requested_intent is not None
                else 'requested_selection_not_in_capability'
            ),
            capability=capability,
            error_code='thinking_not_supported_for_route' if not capability.supported else 'thinking_level_not_allowed',
            provider_mapping=None,
            model_settings=None,
            mapping_reason_code='selection_not_allowed_by_capability',
        )

    provider_mapping = _resolve_provider_mapping(capability=capability, selection=requested_selection)
    if requested_selection.kind == 'preset' and requested_selection.value == 'off':
        return _build_adaptation_result(
            requested_selection=requested_selection,
            applied_selection=requested_selection,
            requested_intent='off',
            applied_intent='off',
            applied=True,
            reason='thinking_disabled',
            capability=capability,
            error_code=None,
            provider_mapping=None if provider_mapping is None else provider_mapping.mapping,
            model_settings=None if provider_mapping is None else provider_mapping.model_settings,
            mapping_reason_code=(
                'off_without_provider_mapping' if provider_mapping is None else provider_mapping.reason_code
            ),
        )

    if provider_mapping is None:
        return _build_adaptation_result(
            requested_selection=requested_selection,
            applied_selection=None,
            requested_intent=requested_intent,
            applied_intent=None,
            applied=False,
            reason=(
                'verified_selection_not_mapped'
                if capability.source == 'verified'
                else 'requested_selection_not_mappable_for_provider'
            ),
            capability=capability,
            error_code=(
                'thinking_capability_resolution_failed'
                if capability.source == 'verified'
                else 'thinking_not_supported_for_route'
            ),
            provider_mapping=None,
            model_settings=None,
            mapping_reason_code='provider_mapping_missing_for_selection',
        )

    return _build_adaptation_result(
        requested_selection=requested_selection,
        applied_selection=requested_selection,
        requested_intent=requested_intent,
        applied_intent=requested_intent,
        applied=True,
        reason=(
            'verified_provider_mapping_applied'
            if capability.source == 'verified'
            else 'override_provider_mapping_applied'
        ),
        capability=capability,
        error_code=None,
        provider_mapping=provider_mapping.mapping,
        model_settings=provider_mapping.model_settings,
        mapping_reason_code=provider_mapping.reason_code,
    )


def adapt_thinking_intent(
    *,
    intent: ThinkingLevelIntent | None,
    model_route: ResolvedRuntimeModelRoute,
    thinking_capability_override: Mapping[str, Any] | None = None,
) -> ThinkingAdaptationResult:
    return adapt_thinking_selection(
        selection=RuntimeThinkingSelection.from_legacy_level_intent(intent),
        model_route=model_route,
        thinking_capability_override=thinking_capability_override,
    )


def _build_adaptation_result(
    *,
    requested_selection: CanonicalThinkingSelection | None,
    applied_selection: CanonicalThinkingSelection | None,
    requested_intent: ThinkingLevelIntent | None,
    applied_intent: ThinkingLevelIntent | None,
    applied: bool,
    reason: str,
    capability: CanonicalThinkingCapability,
    error_code: str | None,
    provider_mapping: str | None,
    model_settings: dict[str, Any] | None,
    mapping_reason_code: str | None,
) -> ThinkingAdaptationResult:
    diagnostics = {
        **capability.to_diagnostics(),
        'requestedSelection': (
            None if requested_selection is None else requested_selection.to_public_dict()
        ),
        'appliedSelection': (
            None if applied_selection is None else applied_selection.to_public_dict()
        ),
        'requestedThinkingLevel': requested_intent,
        'appliedThinkingLevel': applied_intent,
        'providerMapping': provider_mapping,
        'mappingReasonCode': mapping_reason_code,
    }
    if error_code is not None:
        diagnostics['errorCode'] = error_code
    if model_settings is not None:
        diagnostics['modelSettings'] = model_settings
    return ThinkingAdaptationResult(
        requested_selection=requested_selection,
        applied_selection=applied_selection,
        requested_intent=requested_intent,
        applied_intent=applied_intent,
        applied=applied,
        reason=reason,
        capability=capability,
        error_code=error_code,
        model_settings=model_settings,
        provider_mapping=provider_mapping,
        mapping_reason_code=mapping_reason_code,
        diagnostics=diagnostics,
    )


def _to_canonical_requested_selection(
    selection: RuntimeThinkingSelection | None,
) -> CanonicalThinkingSelection | None:
    if selection is None:
        return None
    normalized_mode = _normalize_optional_string(selection.mode)
    if normalized_mode == 'budget':
        budget_tokens = _normalize_positive_int(selection.budgetTokens)
        if budget_tokens is None:
            return None
        return CanonicalThinkingSelection(kind='budget', budget_tokens=budget_tokens)
    level = _normalize_thinking_level_intent(selection.level)
    if level is None:
        return None
    return CanonicalThinkingSelection(kind='preset', value=level)


def _resolve_verified_capability(
    *,
    model_route: ResolvedRuntimeModelRoute,
    route_fingerprint: dict[str, str],
    override_input: ThinkingCapabilityOverrideInput | None,
) -> CanonicalThinkingCapability | None:
    if _is_zai_glm_openai_compatible_route(model_route):
        if _matches_zai_glm_reasoning_model_id(model_route.model_id):
            return _build_canonical_capability(
                status='verified-supported',
                source='verified',
                supported=True,
                series=_GLM_5_SERIES,
                control_spec=_build_preset_control_spec(('off', 'auto')),
                default_selection=CanonicalThinkingSelection(kind='preset', value='auto'),
                reason_code='zai_glm_verified_supported',
                provider_hint=_GLM_5_TURBO_PROVIDER_HINT,
                route_fingerprint=route_fingerprint,
                provenance=_build_provenance(
                    route_status='verified',
                    override_input=override_input,
                    override_applied=False,
                ),
                visibility=_resolve_visibility(override_input),
            )
        if _matches_zai_glm_verified_unsupported_model_id(model_route.model_id):
            return _build_fixed_off_capability(
                status='verified-unsupported',
                source='verified',
                series=_GLM_FIXED_OFF_SERIES,
                reason_code='zai_glm_verified_unsupported',
                provider_hint=_GLM_5_TURBO_PROVIDER_HINT,
                route_fingerprint=route_fingerprint,
                provenance=_build_provenance(
                    route_status='verified',
                    override_input=override_input,
                    override_applied=False,
                ),
                visibility=_resolve_visibility(override_input),
            )
    return None


def _resolve_provider_mapping(
    *,
    capability: CanonicalThinkingCapability,
    selection: CanonicalThinkingSelection,
) -> _ProviderThinkingMapping | None:
    if (
        capability.series == _GLM_5_SERIES
        and _matches_zai_glm_provider_fingerprint(capability.route_fingerprint)
        and selection.kind == 'preset'
    ):
        if selection.value == 'off':
            return _ProviderThinkingMapping(
                mapping='zai_glm_openai_compatible',
                model_settings={
                    'extra_body': {
                        'thinking': {
                            'type': 'disabled',
                        },
                    },
                },
                reason_code='zai_glm_series_off',
            )
        if selection.value == 'auto':
            return _ProviderThinkingMapping(
                mapping='zai_glm_openai_compatible',
                model_settings={
                    'extra_body': {
                        'thinking': {
                            'type': 'enabled',
                        },
                    },
                },
                reason_code='zai_glm_series_auto',
            )
    return None


def _build_canonical_capability(
    *,
    status: ThinkingCapabilityStatus,
    source: ThinkingCapabilitySource,
    supported: bool,
    series: str,
    control_spec: ThinkingControlSpec,
    default_selection: CanonicalThinkingSelection,
    reason_code: str,
    provider_hint: str | None,
    route_fingerprint: dict[str, str],
    provenance: ThinkingCapabilityProvenance,
    visibility: ThinkingCapabilityVisibility,
) -> CanonicalThinkingCapability:
    supported_levels = _derive_supported_levels(supported=supported, control_spec=control_spec)
    default_level = _derive_default_level(
        supported=supported,
        default_selection=default_selection,
        supported_levels=supported_levels,
    )
    override_levels = supported_levels if source == 'override' and supported else ()
    return CanonicalThinkingCapability(
        status=status,
        source=source,
        supported=supported,
        series=series,
        control_spec=control_spec,
        default_selection=default_selection,
        reason_code=reason_code,
        provider_hint=provider_hint,
        route_fingerprint=dict(route_fingerprint),
        provenance=provenance,
        visibility=visibility,
        supported_levels=supported_levels,
        default_level=default_level,
        override_levels=override_levels,
    )


def _build_fixed_off_capability(
    *,
    status: ThinkingCapabilityStatus,
    source: ThinkingCapabilitySource,
    series: str,
    reason_code: str,
    provider_hint: str | None,
    route_fingerprint: dict[str, str],
    provenance: ThinkingCapabilityProvenance,
    visibility: ThinkingCapabilityVisibility,
) -> CanonicalThinkingCapability:
    return _build_canonical_capability(
        status=status,
        source=source,
        supported=False,
        series=series,
        control_spec=_build_preset_control_spec(('off',)),
        default_selection=CanonicalThinkingSelection(kind='preset', value='off'),
        reason_code=reason_code,
        provider_hint=provider_hint,
        route_fingerprint=route_fingerprint,
        provenance=provenance,
        visibility=visibility,
    )


def _resolve_override_control_spec(
    override_input: ThinkingCapabilityOverrideInput,
) -> ThinkingControlSpec | None:
    if override_input.control_spec is not None:
        return _ensure_off_preset_option(override_input.control_spec)
    if len(override_input.levels) == 0:
        return None
    return _build_preset_control_spec(('off', *override_input.levels))


def _resolve_override_series(
    *,
    override_input: ThinkingCapabilityOverrideInput,
    control_spec: ThinkingControlSpec,
) -> str:
    if override_input.series is not None:
        return override_input.series
    if control_spec.kind == 'off-auto':
        return _OVERRIDE_OFF_AUTO_SERIES
    if control_spec.kind == 'binary':
        return _OVERRIDE_BINARY_SERIES
    if control_spec.kind == 'budget':
        return _OVERRIDE_BUDGET_SERIES
    return _OVERRIDE_DISCRETE_SERIES


def _resolve_default_selection(
    *,
    control_spec: ThinkingControlSpec,
    default_selection: CanonicalThinkingSelection | None,
    default_level: ThinkingLevelIntent | None,
) -> CanonicalThinkingSelection:
    if default_selection is not None and _selection_allowed(default_selection, control_spec):
        return default_selection
    if default_level is not None:
        legacy_selection = CanonicalThinkingSelection(kind='preset', value=default_level)
        if _selection_allowed(legacy_selection, control_spec):
            return legacy_selection

    legacy_levels = _extract_legacy_levels_from_control_spec(control_spec)
    positive_levels = tuple(level for level in legacy_levels if level != 'off')
    if 'auto' in positive_levels:
        return CanonicalThinkingSelection(kind='preset', value='auto')
    if len(positive_levels) > 0:
        return CanonicalThinkingSelection(kind='preset', value=positive_levels[0])

    if control_spec.kind == 'budget':
        budget_tokens = control_spec.budget_min_tokens
        if budget_tokens is not None:
            return CanonicalThinkingSelection(kind='budget', budget_tokens=budget_tokens)

    if len(control_spec.preset_options) > 0:
        return control_spec.preset_options[0]
    return CanonicalThinkingSelection(kind='preset', value='off')


def _selection_allowed(
    selection: CanonicalThinkingSelection,
    control_spec: ThinkingControlSpec,
) -> bool:
    if selection.kind == 'preset':
        legacy_level = selection.to_legacy_level()
        if legacy_level is None:
            return False
        return legacy_level in _extract_legacy_levels_from_control_spec(control_spec)
    if selection.kind == 'budget' and control_spec.kind == 'budget' and selection.budget_tokens is not None:
        minimum = control_spec.budget_min_tokens
        maximum = control_spec.budget_max_tokens
        if minimum is not None and selection.budget_tokens < minimum:
            return False
        if maximum is not None and selection.budget_tokens > maximum:
            return False
        return True
    return False


def _derive_supported_levels(
    *,
    supported: bool,
    control_spec: ThinkingControlSpec,
) -> tuple[ThinkingLevelIntent, ...]:
    if not supported:
        return ()
    return _normalize_supported_levels(_extract_legacy_levels_from_control_spec(control_spec))


def _derive_default_level(
    *,
    supported: bool,
    default_selection: CanonicalThinkingSelection,
    supported_levels: Sequence[ThinkingLevelIntent],
) -> ThinkingLevelIntent | None:
    if not supported:
        return None
    legacy_level = default_selection.to_legacy_level()
    if legacy_level is not None and legacy_level in supported_levels:
        return legacy_level
    return None


def _extract_legacy_levels_from_control_spec(
    control_spec: ThinkingControlSpec,
) -> tuple[ThinkingLevelIntent, ...]:
    return _normalize_supported_levels(
        selection.to_legacy_level()
        for selection in control_spec.preset_options
        if selection.to_legacy_level() is not None
    )


def _build_provenance(
    *,
    route_status: ThinkingRouteStatus,
    override_input: ThinkingCapabilityOverrideInput | None,
    override_applied: bool,
) -> ThinkingCapabilityProvenance:
    if override_input is None:
        return ThinkingCapabilityProvenance(route_status=route_status)
    return ThinkingCapabilityProvenance(
        route_status=route_status,
        override_present=True,
        override_applied=override_applied,
        override_source=override_input.override_source,
        override_format=override_input.format,
    )


def _resolve_visibility(
    override_input: ThinkingCapabilityOverrideInput | None,
) -> ThinkingCapabilityVisibility:
    if override_input is not None and override_input.visibility is not None:
        return override_input.visibility
    return ThinkingCapabilityVisibility()


def _build_preset_control_spec(levels: Sequence[ThinkingLevelIntent]) -> ThinkingControlSpec:
    normalized = _normalize_supported_levels(levels)
    kind: ThinkingControlKind
    if len(normalized) == 1:
        kind = 'fixed'
    elif normalized == ('off', 'auto'):
        kind = 'off-auto'
    elif len(normalized) == 2 and normalized[0] == 'off':
        kind = 'binary'
    else:
        kind = 'discrete'
    return ThinkingControlSpec(
        kind=kind,
        preset_options=tuple(
            CanonicalThinkingSelection(kind='preset', value=level) for level in normalized
        ),
    )


def _ensure_off_preset_option(control_spec: ThinkingControlSpec) -> ThinkingControlSpec:
    legacy_levels = _extract_legacy_levels_from_control_spec(control_spec)
    if control_spec.kind == 'fixed':
        return _build_preset_control_spec(legacy_levels) if len(legacy_levels) > 0 else control_spec
    if control_spec.kind == 'budget':
        preset_options = list(control_spec.preset_options)
        if 'off' not in legacy_levels:
            preset_options.insert(0, CanonicalThinkingSelection(kind='preset', value='off'))
        return ThinkingControlSpec(
            kind='budget',
            preset_options=tuple(preset_options),
            budget_min_tokens=control_spec.budget_min_tokens,
            budget_max_tokens=control_spec.budget_max_tokens,
            budget_step_tokens=control_spec.budget_step_tokens,
        )
    if 'off' in legacy_levels:
        return _build_preset_control_spec(legacy_levels)
    return _build_preset_control_spec(('off', *legacy_levels))


def _parse_thinking_control_spec(value: Any) -> ThinkingControlSpec | None:
    if not isinstance(value, Mapping):
        return None
    raw_kind = _normalize_optional_string(value.get('kind'))
    if raw_kind not in {'fixed', 'binary', 'off-auto', 'discrete', 'budget'}:
        return None

    preset_options = _parse_preset_options(value.get('presetOptions'))
    fixed_selection = _parse_thinking_selection(value.get('fixedSelection'))
    if fixed_selection is not None and fixed_selection.kind == 'preset':
        preset_options = _dedupe_preset_options((fixed_selection, *preset_options))

    if raw_kind == 'budget':
        budget_value = value.get('budget')
        budget = budget_value if isinstance(budget_value, Mapping) else {}
        return ThinkingControlSpec(
            kind='budget',
            preset_options=tuple(preset_options),
            budget_min_tokens=_normalize_positive_int(budget.get('minTokens')),
            budget_max_tokens=_normalize_positive_int(budget.get('maxTokens')),
            budget_step_tokens=_normalize_positive_int(budget.get('stepTokens')),
        )

    if len(preset_options) == 0:
        return None
    return ThinkingControlSpec(kind=cast(ThinkingControlKind, raw_kind), preset_options=tuple(preset_options))


def _parse_series_input_control_spec(value: Any) -> ThinkingControlSpec | None:
    if not isinstance(value, Mapping):
        return None
    raw_kind = _normalize_optional_string(value.get('kind'))
    if raw_kind == 'fixed':
        level = _normalize_positive_thinking_level_intent(value.get('level'))
        if level is None:
            return None
        return ThinkingControlSpec(
            kind='fixed',
            preset_options=(CanonicalThinkingSelection(kind='preset', value=level),),
        )
    if raw_kind == 'binary':
        enabled_level = _normalize_positive_thinking_level_intent(value.get('enabledLevel'))
        if enabled_level is None:
            return None
        return _build_preset_control_spec(('off', enabled_level))
    if raw_kind == 'off-auto':
        return _build_preset_control_spec(('off', 'auto'))
    if raw_kind == 'discrete':
        levels = _normalize_positive_thinking_levels(value.get('levels'))
        if len(levels) == 0:
            return None
        return _build_preset_control_spec(('off', *levels))
    if raw_kind == 'budget':
        minimum = _normalize_positive_int(value.get('minTokens'))
        maximum = _normalize_positive_int(value.get('maxTokens'))
        step = _normalize_positive_int(value.get('stepTokens'))
        if minimum is not None and maximum is not None and maximum < minimum:
            maximum = minimum
        if step is not None and step <= 0:
            step = None
        return ThinkingControlSpec(
            kind='budget',
            preset_options=(CanonicalThinkingSelection(kind='preset', value='off'),),
            budget_min_tokens=minimum,
            budget_max_tokens=maximum,
            budget_step_tokens=step,
        )
    return None


def _parse_preset_options(value: Any) -> tuple[CanonicalThinkingSelection, ...]:
    if not isinstance(value, list):
        return ()
    parsed = [
        selection
        for item in value
        for selection in [_parse_thinking_selection(item)]
        if selection is not None and selection.kind == 'preset'
    ]
    return _dedupe_preset_options(parsed)


def _dedupe_preset_options(
    values: Sequence[CanonicalThinkingSelection],
) -> tuple[CanonicalThinkingSelection, ...]:
    seen: set[ThinkingLevelIntent] = set()
    normalized: list[CanonicalThinkingSelection] = []
    for selection in values:
        legacy_level = selection.to_legacy_level()
        if legacy_level is None or legacy_level in seen:
            continue
        seen.add(legacy_level)
        normalized.append(selection)
    return tuple(normalized)


def _parse_thinking_selection(value: Any) -> CanonicalThinkingSelection | None:
    if not isinstance(value, Mapping):
        return None
    kind = _normalize_optional_string(value.get('kind'))
    mode = _normalize_optional_string(value.get('mode'))
    normalized_kind = kind or mode
    if normalized_kind == 'budget':
        budget_tokens = _normalize_positive_int(value.get('budgetTokens'))
        if budget_tokens is None:
            return None
        return CanonicalThinkingSelection(kind='budget', budget_tokens=budget_tokens)
    if normalized_kind not in {'preset', 'off'}:
        return None
    legacy_value = _normalize_thinking_level_intent(value.get('value', value.get('level')))
    if legacy_value is None:
        return None
    return CanonicalThinkingSelection(kind='preset', value=legacy_value)


def _parse_thinking_visibility(value: Any) -> ThinkingCapabilityVisibility | None:
    if not isinstance(value, Mapping):
        return None
    reasoning = _normalize_optional_string(value.get('reasoning'))
    normalized_reasoning: ThinkingVisibilityMode = 'visible'
    if reasoning in {'visible', 'suppressed'}:
        normalized_reasoning = cast(ThinkingVisibilityMode, reasoning)
    supports_suppression = value.get('supportsSuppression')
    return ThinkingCapabilityVisibility(
        reasoning=normalized_reasoning,
        supports_suppression=True if not isinstance(supports_suppression, bool) else supports_suppression,
    )


def _is_zai_glm_openai_compatible_route(model_route: ResolvedRuntimeModelRoute) -> bool:
    provider = _normalize_identifier(model_route.provider)
    endpoint_type = _normalize_identifier(model_route.endpoint_type)
    base_url = _normalize_identifier(model_route.base_url)

    return (
        provider == 'openai'
        and endpoint_type == 'openai-compatible'
        and any(host_hint in base_url for host_hint in _GLM_5_TURBO_HOST_HINTS)
    )



def _matches_zai_glm_provider_fingerprint(route_fingerprint: Mapping[str, Any]) -> bool:
    provider = _normalize_optional_string(route_fingerprint.get('provider'))
    endpoint_type = _normalize_optional_string(route_fingerprint.get('endpointType'))
    base_url = _normalize_optional_string(route_fingerprint.get('baseUrl'))
    if provider is None or endpoint_type is None or base_url is None:
        return False
    normalized_provider = _normalize_identifier(provider)
    normalized_endpoint_type = _normalize_identifier(endpoint_type)
    normalized_base_url = _normalize_identifier(base_url)
    return (
        normalized_provider == 'openai'
        and normalized_endpoint_type == 'openai-compatible'
        and any(host_hint in normalized_base_url for host_hint in _GLM_5_TURBO_HOST_HINTS)
    )


def _matches_zai_glm_reasoning_model_id(model_id: str) -> bool:
    normalized = _normalize_identifier(model_id)
    return (
        normalized == 'glm-5'
        or normalized == 'glm-5-turbo'
        or normalized.endswith('/glm-5')
        or normalized.endswith('/glm-5-turbo')
    )


def _matches_zai_glm_verified_unsupported_model_id(model_id: str) -> bool:
    normalized = _normalize_identifier(model_id)
    return normalized in _GLM_4_UNSUPPORTED_MODEL_IDS or any(
        normalized.endswith(f'/{candidate}') for candidate in _GLM_4_UNSUPPORTED_MODEL_IDS
    )


def _build_route_diagnostics(model_route: ResolvedRuntimeModelRoute) -> dict[str, str]:
    return {
        'providerProfileId': model_route.provider_profile_id,
        'provider': model_route.provider,
        'endpointType': model_route.endpoint_type,
        'baseUrl': model_route.base_url,
        'modelId': model_route.model_id,
    }


def _normalize_thinking_level_intent(value: Any) -> ThinkingLevelIntent | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized in _THINKING_LEVEL_SET:
        return cast(ThinkingLevelIntent, normalized)
    return None


def _normalize_supported_levels(
    levels: Sequence[ThinkingLevelIntent | None] | Sequence[ThinkingLevelIntent],
) -> tuple[ThinkingLevelIntent, ...]:
    normalized = {
        level
        for level in levels
        if level is not None and level in _THINKING_LEVEL_SET
    }
    return tuple(level for level in _THINKING_LEVEL_ORDER if level in normalized)


def _normalize_positive_thinking_levels(value: Any) -> tuple[PositiveThinkingLevelIntent, ...]:
    if not isinstance(value, list):
        return ()
    normalized = {
        level
        for item in value
        for level in [_normalize_positive_thinking_level_intent(item)]
        if level is not None and level in _POSITIVE_THINKING_LEVEL_SET
    }
    return tuple(level for level in _POSITIVE_THINKING_LEVEL_ORDER if level in normalized)


def _normalize_positive_thinking_level_intent(value: Any) -> PositiveThinkingLevelIntent | None:
    level = _normalize_thinking_level_intent(value)
    if level is None or level == 'off' or level not in _POSITIVE_THINKING_LEVEL_SET:
        return None
    return cast(PositiveThinkingLevelIntent, level)


def _normalize_positive_int(value: Any) -> int | None:
    if not isinstance(value, int) or isinstance(value, bool):
        return None
    return value if value >= 0 else None


def _normalize_optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized if normalized != '' else None


def _normalize_identifier(value: str) -> str:
    return value.strip().lower()


__all__ = [
    'CanonicalThinkingCapability',
    'CanonicalThinkingSelection',
    'ThinkingAdaptationResult',
    'ThinkingCapabilityOverrideInput',
    'ThinkingCapabilityProvenance',
    'ThinkingCapabilitySource',
    'ThinkingCapabilityStatus',
    'ThinkingCapabilityVisibility',
    'ThinkingControlKind',
    'ThinkingControlSpec',
    'ThinkingLevelIntent',
    'adapt_thinking_intent',
    'adapt_thinking_selection',
    'parse_thinking_capability_override',
    'resolve_canonical_thinking_capability',
]

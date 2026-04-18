"""Backend evaluation for persisted history availability drift."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any, cast

import anyio

from ..agent_registry import AgentRegistry
from ..model_routes import (
    ResolvedRuntimeModelRoute,
    RuntimeModelRoute,
    RuntimeModelRouteRef,
    RuntimeModelRouteResolutionError,
    RuntimeModelRouteResolver,
)
from ..provider_adapter_registry import (
    RuntimeProviderAdapterError,
    RuntimeProviderAdapterRegistry,
)
from ..thinking_adapter import (
    CanonicalThinkingCapability,
    resolve_canonical_thinking_capability,
)
from ..tool_registry import ToolRegistry
from .models.chat import RunModel

_NOT_EVALUATED_STATUS = "not_evaluated"
_NO_DRIFT_STATUS = "no_drift"
_MULTIPLE_ISSUES_STATUS = "multiple_issues"
_PROVIDER_REMOVED_CODE = "historical_provider_removed"
_MODEL_UNAVAILABLE_CODE = "historical_valid_currently_missing"
_TOOL_UNREGISTERED_CODE = "historical_tool_unregistered"
_THINKING_UNSUPPORTED_CODE = "historical_thinking_no_longer_supported"


class PersistedHistoryDriftEvaluator:
    def __init__(
        self,
        *,
        agent_registry: AgentRegistry | None = None,
        tool_registry: ToolRegistry | None = None,
        model_route_resolver: RuntimeModelRouteResolver | None = None,
        provider_adapter_registry: RuntimeProviderAdapterRegistry | None = None,
    ) -> None:
        self._agent_registry = agent_registry
        self._tool_registry = tool_registry
        self._model_route_resolver = model_route_resolver
        self._provider_adapter_registry = provider_adapter_registry

    def evaluate(
        self,
        *,
        run: RunModel,
        bound_agent_id: str,
    ) -> dict[str, Any]:
        historical_model_id = _normalize_optional_string(run.resolved_model_id)
        historical_tool_ids = list(
            run.resolved_tool_ids_json or run.enabled_tools_json or []
        )
        historical_thinking_selection = _copy_mapping(
            run.applied_thinking_json or run.requested_thinking_json
        )
        historical_thinking_override = _copy_mapping(
            run.thinking_capability_override_json
        )
        historical_thinking_summary = _format_historical_thinking_summary(
            historical_thinking_selection
        )
        warnings: list[dict[str, str]] = []
        evaluated_dimensions = 0
        unresolved_dimensions = 0

        resolved_model_route: ResolvedRuntimeModelRoute | None = None
        selected_model_route = _deserialize_runtime_model_route(
            run.selected_model_route_json
        )
        if selected_model_route is not None:
            if self._model_route_resolver is None:
                unresolved_dimensions += 1
            else:
                try:
                    resolved_model_route = _resolve_runtime_model_route(
                        model_route_resolver=self._model_route_resolver,
                        model_route=selected_model_route,
                    )
                except RuntimeModelRouteResolutionError as exc:
                    mapped_warning = _map_route_resolution_warning(
                        error=exc,
                        historical_model_id=historical_model_id,
                    )
                    if mapped_warning is not None:
                        warnings.append(mapped_warning)
                        evaluated_dimensions += 1
                    else:
                        unresolved_dimensions += 1
                except Exception:
                    unresolved_dimensions += 1
                else:
                    evaluated_dimensions += 1
        elif historical_model_id is not None:
            unresolved_dimensions += 1

        if historical_tool_ids:
            available_tool_ids = _build_available_tool_id_set(
                bound_agent_id=bound_agent_id,
                agent_registry=self._agent_registry,
                tool_registry=self._tool_registry,
            )
            if available_tool_ids is None:
                unresolved_dimensions += 1
            else:
                evaluated_dimensions += 1
                missing_tool_ids = [
                    tool_id
                    for tool_id in historical_tool_ids
                    if tool_id not in available_tool_ids
                ]
                if missing_tool_ids:
                    warnings.append(
                        _build_warning(
                            _TOOL_UNREGISTERED_CODE,
                            f"历史线程使用的工具当前不可用：{'、'.join(missing_tool_ids)}",
                        )
                    )

        if historical_thinking_selection is not None:
            if resolved_model_route is None or self._provider_adapter_registry is None:
                unresolved_dimensions += 1
            else:
                evaluated_dimensions += 1
                warning = _evaluate_thinking_warning(
                    resolved_model_route=resolved_model_route,
                    historical_thinking_selection=historical_thinking_selection,
                    thinking_capability_override=historical_thinking_override,
                    provider_adapter_registry=self._provider_adapter_registry,
                )
                if warning is not None:
                    warnings.append(warning)

        status = _resolve_status(
            warnings=warnings,
            evaluated_dimensions=evaluated_dimensions,
            unresolved_dimensions=unresolved_dimensions,
        )
        return {
            "status": status,
            "historicalModelId": historical_model_id,
            "historicalToolIds": historical_tool_ids,
            "historicalThinkingSelection": historical_thinking_selection,
            "historicalThinkingSummary": historical_thinking_summary,
            "warnings": warnings,
            "requiresExplicitRebind": len(warnings) > 0,
        }


def _deserialize_runtime_model_route(payload: Any) -> RuntimeModelRoute | None:
    record = payload if isinstance(payload, Mapping) else None
    if record is None:
        return None

    route_ref_payload = record.get("routeRef")
    route_ref_record = (
        route_ref_payload if isinstance(route_ref_payload, Mapping) else None
    )
    if route_ref_record is None:
        return None

    provider_profile_id = _normalize_optional_string(record.get("providerProfileId"))
    route_profile_id = _normalize_optional_string(route_ref_record.get("profileId"))
    model_id = _normalize_optional_string(route_ref_record.get("modelId"))
    route_kind = (
        _normalize_optional_string(route_ref_record.get("routeKind"))
        or "provider-model"
    )
    catalog_revision = _normalize_optional_string(record.get("catalogRevision"))

    resolved_profile_id = provider_profile_id or route_profile_id
    if resolved_profile_id is None or route_profile_id is None or model_id is None:
        return None
    if resolved_profile_id != route_profile_id:
        return None

    return RuntimeModelRoute(
        provider_profile_id=resolved_profile_id,
        route_ref=RuntimeModelRouteRef(
            route_kind=route_kind,
            profile_id=route_profile_id,
            model_id=model_id,
        ),
        catalog_revision=catalog_revision,
    )


def _resolve_runtime_model_route(
    *,
    model_route_resolver: RuntimeModelRouteResolver,
    model_route: RuntimeModelRoute,
) -> ResolvedRuntimeModelRoute:
    run_from_thread = getattr(anyio.from_thread, "run", None)
    if callable(run_from_thread):
        try:
            return cast(
                ResolvedRuntimeModelRoute,
                run_from_thread(model_route_resolver.resolve, model_route),
            )
        except RuntimeError:
            pass
    return asyncio.run(model_route_resolver.resolve(model_route))


def _map_route_resolution_warning(
    *,
    error: RuntimeModelRouteResolutionError,
    historical_model_id: str | None,
) -> dict[str, str] | None:
    code = _normalize_optional_string(getattr(error, "code", None))
    if code == "provider_profile_not_found":
        return _build_warning(
            _PROVIDER_REMOVED_CODE,
            "历史线程绑定的模型服务商当前已不可用，继续对话前需重新绑定模型。",
        )

    if code in {
        "provider_model_not_found",
        "provider_secret_missing",
        "provider_base_url_missing",
        "provider_catalog_entry_not_found",
        "provider_profile_legacy",
        "provider_profile_unsupported",
        "provider_runtime_catalog_only",
        "provider_runtime_legacy_unsupported",
        "provider_catalog_revision_mismatch",
    }:
        return _build_warning(
            _MODEL_UNAVAILABLE_CODE,
            f"历史线程使用的模型当前不可用：{historical_model_id or 'unknown-model'}",
        )

    return None


def _build_available_tool_id_set(
    *,
    bound_agent_id: str,
    agent_registry: AgentRegistry | None,
    tool_registry: ToolRegistry | None,
) -> set[str] | None:
    if agent_registry is None or tool_registry is None:
        return None

    toolset_name = (
        agent_registry.build_agent_toolset_map().get(bound_agent_id)
        or tool_registry.get_default().name
    )
    try:
        catalog = tool_registry.build_tool_catalog(toolset_name)
    except LookupError:
        catalog = tool_registry.build_tool_catalog()

    available_tool_ids: set[str] = set()
    for entry in catalog:
        if entry.get("availability") == "available":
            tool_id = _normalize_optional_string(entry.get("toolId"))
            if tool_id is not None:
                available_tool_ids.add(tool_id)
    return available_tool_ids


def _evaluate_thinking_warning(
    *,
    resolved_model_route: ResolvedRuntimeModelRoute,
    historical_thinking_selection: Mapping[str, Any],
    thinking_capability_override: Mapping[str, Any] | None,
    provider_adapter_registry: RuntimeProviderAdapterRegistry,
) -> dict[str, str] | None:
    _ = historical_thinking_selection
    try:
        capability = resolve_canonical_thinking_capability(
            model_route=resolved_model_route,
            thinking_capability_override=thinking_capability_override,
            provider_adapter_registry=provider_adapter_registry,
        )
    except RuntimeProviderAdapterError:
        return _build_warning(
            _THINKING_UNSUPPORTED_CODE,
            "历史线程的思考能力当前已无法校验，请重新绑定模型后继续。",
        )

    if _thinking_capability_supported(capability):
        return None

    if capability.status == "verified-unsupported":
        return _build_warning(
            _THINKING_UNSUPPORTED_CODE,
            "历史线程使用的思考能力当前已不再受支持。",
        )

    return _build_warning(
        _THINKING_UNSUPPORTED_CODE,
        "历史线程的思考能力当前已无法校验，请重新绑定模型后继续。",
    )


def _thinking_capability_supported(capability: CanonicalThinkingCapability) -> bool:
    return capability.series is not None


def _resolve_status(
    *,
    warnings: list[dict[str, str]],
    evaluated_dimensions: int,
    unresolved_dimensions: int,
) -> str:
    if len(warnings) == 0 and unresolved_dimensions > 0:
        return _NOT_EVALUATED_STATUS
    if len(warnings) == 0 and evaluated_dimensions == 0:
        return _NO_DRIFT_STATUS
    if len(warnings) == 0:
        return _NO_DRIFT_STATUS
    if len(warnings) == 1:
        warning_code = _normalize_optional_string(warnings[0].get("code"))
        return warning_code or _MULTIPLE_ISSUES_STATUS
    return _MULTIPLE_ISSUES_STATUS


def _build_warning(code: str, message: str) -> dict[str, str]:
    return {
        "code": code,
        "message": message,
    }


def _format_historical_thinking_summary(value: Any) -> str | None:
    record = value if isinstance(value, Mapping) else None
    if record is None:
        return None

    value_payload = record.get("value")
    value_record = value_payload if isinstance(value_payload, Mapping) else None
    series = _normalize_optional_string(record.get("series"))
    mode = _normalize_optional_string(record.get("mode"))
    level = _normalize_optional_string(record.get("level"))
    value_label = _normalize_optional_string(
        None if value_record is None else value_record.get("labelZh")
    )
    if value_label is None and value_record is not None:
        value_label = _normalize_optional_string(value_record.get("code"))
    budget_tokens_value = (
        None if value_record is None else value_record.get("budgetTokens")
    )
    budget_tokens = (
        f"{budget_tokens_value} tokens"
        if isinstance(budget_tokens_value, int)
        else None
    )

    parts = [series, value_label, level, mode, budget_tokens]
    normalized_parts = [part for part in parts if part is not None]
    return " / ".join(normalized_parts) or None


def _copy_mapping(value: Any) -> dict[str, Any] | None:
    return dict(value) if isinstance(value, Mapping) else None


def _normalize_optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


__all__ = ["PersistedHistoryDriftEvaluator"]

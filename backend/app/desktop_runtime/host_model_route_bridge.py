"""Private host bridge client for resolving request-scoped provider routes."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.copilot_runtime.model_routes import (
    HostModelRouteAccessDeniedError,
    HostModelRouteUnavailableError,
    ProviderProfileNotFoundError,
    ProviderSecretMissingError,
    ResolvedRuntimeModelRoute,
    RuntimeModelRoute,
    RuntimeModelRouteRef,
    RuntimeModelRouteResolutionError,
    RuntimeModelRouteResolver,
)

_HOST_MODEL_ROUTE_BRIDGE_AUTH_HEADER_NAME = "X-Host-Model-Route-Token"
HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME = _HOST_MODEL_ROUTE_BRIDGE_AUTH_HEADER_NAME
_HOST_MODEL_ROUTE_BRIDGE_ACCESS_DENIED_ERROR_CODE = (
    "invalid_host_model_route_bridge_token"
)
_PROVIDER_NOT_FOUND_ERROR_CODE = "provider_profile_not_found"
_PROVIDER_CREDENTIAL_MISSING_ERROR_CODE = "provider_secret_missing"
_PROVIDER_MODEL_ROUTE_KIND = "provider-model"


class _HostModelRouteBridgeModel(BaseModel):
    """Shared Pydantic base for private host model-route bridge payloads."""

    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )


class _HostModelRouteBridgeRouteRef(_HostModelRouteBridgeModel):
    route_kind: str | None = Field(default=None, alias="routeKind")
    profile_id: str | None = Field(default=None, alias="profileId")
    model_id: str | None = Field(default=None, alias="modelId")

    @field_validator("route_kind", "profile_id", "model_id", mode="before")
    @classmethod
    def _normalize_optional_route_text(cls, value: Any) -> str | None:
        return _normalize_optional_text(value)


class _HostModelRouteBridgeResolvedRoute(_HostModelRouteBridgeModel):
    route_ref: _HostModelRouteBridgeRouteRef | None = Field(
        default=None,
        alias="routeRef",
    )
    provider_profile_id: str | None = Field(default=None, alias="providerProfileId")
    provider: str | None = None
    provider_id: str | None = Field(default=None, alias="providerId")
    adapter_id: str | None = Field(default=None, alias="adapterId")
    runtime_status: str | None = Field(default=None, alias="runtimeStatus")
    catalog_revision: str | None = Field(default=None, alias="catalogRevision")
    endpoint_family: str | None = Field(default=None, alias="endpointFamily")
    endpoint_type: str | None = Field(default=None, alias="endpointType")
    base_url: str | None = Field(default=None, alias="baseUrl")
    model_id: str | None = Field(default=None, alias="modelId")
    auth_kind: str | None = Field(default=None, alias="authKind")
    capability_hints: dict[str, Any] = Field(
        default_factory=dict,
        alias="capabilityHints",
    )

    @field_validator("route_ref", mode="before")
    @classmethod
    def _ignore_non_object_route_ref(cls, value: Any) -> Any:
        if isinstance(value, Mapping):
            return value
        return None

    @field_validator(
        "provider_profile_id",
        "provider",
        "provider_id",
        "adapter_id",
        "runtime_status",
        "catalog_revision",
        "endpoint_family",
        "endpoint_type",
        "base_url",
        "model_id",
        "auth_kind",
        mode="before",
    )
    @classmethod
    def _normalize_optional_route_text(cls, value: Any) -> str | None:
        return _normalize_optional_text(value)

    @field_validator("capability_hints", mode="before")
    @classmethod
    def _normalize_capability_hints(cls, value: Any) -> dict[str, Any]:
        if isinstance(value, Mapping):
            return {str(key): item for key, item in value.items()}
        return {}


class _HostModelRouteBridgeAuthPayload(_HostModelRouteBridgeModel):
    api_key: str | None = Field(default=None, alias="apiKey")

    @field_validator("api_key", mode="before")
    @classmethod
    def _normalize_api_key(cls, value: Any) -> str | None:
        return _normalize_optional_text(value)


class _HostModelRouteBridgePrivateAuth(_HostModelRouteBridgeModel):
    auth_kind: str | None = Field(default=None, alias="authKind")
    auth_payload: _HostModelRouteBridgeAuthPayload | None = Field(
        default=None,
        alias="authPayload",
    )
    api_key: str | None = Field(default=None, alias="apiKey")

    @field_validator("auth_kind", "api_key", mode="before")
    @classmethod
    def _normalize_optional_auth_text(cls, value: Any) -> str | None:
        return _normalize_optional_text(value)

    @field_validator("auth_payload", mode="before")
    @classmethod
    def _ignore_non_object_auth_payload(cls, value: Any) -> Any:
        if isinstance(value, Mapping):
            return value
        return None


class _HostModelRouteBridgeSuccessResponse(_HostModelRouteBridgeModel):
    ok: Literal[True]
    resolved_route: _HostModelRouteBridgeResolvedRoute = Field(alias="resolvedRoute")
    private_auth: _HostModelRouteBridgePrivateAuth = Field(alias="privateAuth")


class _HostModelRouteBridgeError(_HostModelRouteBridgeModel):
    code: str | None = None
    message: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)

    @field_validator("code", "message", mode="before")
    @classmethod
    def _normalize_optional_error_text(cls, value: Any) -> str | None:
        return _normalize_optional_text(value)

    @field_validator("details", mode="before")
    @classmethod
    def _normalize_details(cls, value: Any) -> dict[str, Any]:
        if isinstance(value, Mapping):
            return dict(value)
        return {}


class HostModelRouteBridgeClient(RuntimeModelRouteResolver):
    def __init__(
        self,
        *,
        bridge_url: str | None,
        bridge_token: str | None,
        header_name: str = HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 5.0,
    ) -> None:
        self._bridge_url = _normalize_optional_text(bridge_url)
        self._bridge_token = _normalize_optional_text(bridge_token)
        self._header_name = (
            _normalize_optional_text(header_name)
            or HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME
        )
        self._transport = transport
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def aclose(self) -> None:
        client = self._client
        if client is None:
            return
        self._client = None
        await client.aclose()

    async def resolve(
        self, model_route: RuntimeModelRoute
    ) -> ResolvedRuntimeModelRoute:
        if self._bridge_url is None or self._bridge_token is None:
            raise HostModelRouteUnavailableError(
                detail="Host model route bridge bootstrap is not configured."
            )

        try:
            response = await self._get_client().post(
                self._bridge_url,
                json=model_route.to_dict(),
                headers={self._header_name: self._bridge_token},
            )
        except httpx.HTTPError as exc:
            raise HostModelRouteUnavailableError(detail=str(exc)) from exc

        if response.status_code == 401:
            raise HostModelRouteAccessDeniedError(header_name=self._header_name)

        try:
            payload = response.json()
        except ValueError as exc:
            raise HostModelRouteUnavailableError(
                detail="Host model route bridge returned a non-JSON response."
            ) from exc

        if not isinstance(payload, dict):
            raise HostModelRouteUnavailableError(
                detail="Host model route bridge returned an invalid response payload."
            )

        if payload.get("ok") is True:
            return _parse_resolved_route_payload(payload)

        if payload.get("ok") is False:
            raise _build_resolution_error(
                payload.get("error"),
                fallback_provider_profile_id=model_route.provider_profile_id,
                header_name=self._header_name,
            )

        raise HostModelRouteUnavailableError(
            detail="Host model route bridge returned an unrecognized response shape."
        )

    def _get_client(self) -> httpx.AsyncClient:
        client = self._client
        if client is None:
            client = httpx.AsyncClient(
                transport=self._transport,
                timeout=self._timeout,
            )
            self._client = client
        return client


def _parse_resolved_route_payload(
    payload: Mapping[str, Any],
) -> ResolvedRuntimeModelRoute:
    route = payload.get("resolvedRoute")
    if not isinstance(route, Mapping):
        raise HostModelRouteUnavailableError(
            detail="Host model route bridge success payload is missing 'resolvedRoute'."
        )

    private_auth = payload.get("privateAuth")
    if not isinstance(private_auth, Mapping):
        raise HostModelRouteUnavailableError(
            detail="Host model route bridge success payload is missing 'privateAuth'."
        )

    try:
        response = _HostModelRouteBridgeSuccessResponse.model_validate(payload)
    except ValidationError as exc:
        raise HostModelRouteUnavailableError(
            detail=_validation_error_to_detail(exc)
        ) from exc

    return _build_resolved_route(response)


def _build_resolved_route(
    response: _HostModelRouteBridgeSuccessResponse,
) -> ResolvedRuntimeModelRoute:
    route = response.resolved_route
    private_auth = response.private_auth
    provider_profile_id = _require_non_empty_text_value(
        route.provider_profile_id,
        "providerProfileId",
    )
    model_id = _require_non_empty_text_value(route.model_id, "modelId")
    provider = _normalize_optional_text(
        route.provider
    ) or _require_non_empty_text_value(
        route.provider_id,
        "providerId",
    )
    route_ref = _parse_route_ref(
        route.route_ref,
        provider_profile_id=provider_profile_id,
        model_id=model_id,
    )

    auth_kind = (
        _normalize_optional_text(private_auth.auth_kind)
        or _normalize_optional_text(route.auth_kind)
        or "none"
    )
    api_key = ""
    if private_auth.auth_payload is not None:
        api_key = _normalize_optional_text(private_auth.auth_payload.api_key) or ""

    if auth_kind == "none":
        api_key = ""
    elif auth_kind == "api-key" and api_key == "":
        raise HostModelRouteUnavailableError(
            detail="Host model route bridge success payload requires a non-empty apiKey for 'api-key' auth."
        )

    return ResolvedRuntimeModelRoute(
        provider_profile_id=provider_profile_id,
        provider=provider,
        provider_id=_normalize_optional_text(route.provider_id) or provider,
        adapter_id=_normalize_optional_text(route.adapter_id) or "",
        runtime_status=_normalize_optional_text(route.runtime_status) or "enabled",
        catalog_revision=_normalize_optional_text(route.catalog_revision) or "",
        endpoint_family=_normalize_optional_text(route.endpoint_family) or "",
        endpoint_type=_require_non_empty_text_value(
            route.endpoint_type, "endpointType"
        ),
        base_url=_require_non_empty_text_value(route.base_url, "baseUrl"),
        model_id=model_id,
        auth_kind=auth_kind,
        api_key=api_key,
        route_ref=route_ref,
        capability_hints=route.capability_hints,
    )


def _parse_route_ref(
    value: _HostModelRouteBridgeRouteRef | None,
    *,
    provider_profile_id: str,
    model_id: str,
) -> RuntimeModelRouteRef:
    if value is not None:
        route_kind = _parse_route_kind(value.route_kind)
        profile_id = _normalize_optional_text(value.profile_id) or provider_profile_id
        resolved_model_id = _normalize_optional_text(value.model_id) or model_id
        return RuntimeModelRouteRef(
            route_kind=route_kind,
            profile_id=profile_id,
            model_id=resolved_model_id,
        )

    return RuntimeModelRouteRef(
        route_kind=_PROVIDER_MODEL_ROUTE_KIND,
        profile_id=provider_profile_id,
        model_id=model_id,
    )


def _parse_route_kind(value: Any) -> str:
    route_kind = _normalize_optional_text(value) or _PROVIDER_MODEL_ROUTE_KIND
    if route_kind != _PROVIDER_MODEL_ROUTE_KIND:
        raise HostModelRouteUnavailableError(
            detail=(
                "Host model route bridge payload field 'routeRef.routeKind' "
                f"must be '{_PROVIDER_MODEL_ROUTE_KIND}'."
            )
        )
    return route_kind


def _build_resolution_error(
    error_payload: Any,
    *,
    fallback_provider_profile_id: str,
    header_name: str,
) -> Exception:
    if not isinstance(error_payload, Mapping):
        return HostModelRouteUnavailableError(
            detail="Host model route bridge returned an invalid error payload."
        )

    try:
        error = _HostModelRouteBridgeError.model_validate(error_payload)
    except ValidationError as exc:
        return HostModelRouteUnavailableError(detail=_validation_error_to_detail(exc))

    code = error.code
    details = dict(error.details)
    provider_profile_id = (
        _normalize_optional_text(details.get("providerProfileId"))
        or fallback_provider_profile_id
    )

    if code == _HOST_MODEL_ROUTE_BRIDGE_ACCESS_DENIED_ERROR_CODE:
        return HostModelRouteAccessDeniedError(header_name=header_name)
    if code == _PROVIDER_NOT_FOUND_ERROR_CODE:
        return ProviderProfileNotFoundError(provider_profile_id=provider_profile_id)
    if code == _PROVIDER_CREDENTIAL_MISSING_ERROR_CODE:
        return ProviderSecretMissingError(provider_profile_id=provider_profile_id)

    message = error.message or "Host model route bridge request failed."
    return RuntimeModelRouteResolutionError(
        code=code or "host_model_route_request_failed",
        message=message,
        details=details,
    )


def _require_non_empty_text_value(value: Any, field_name: str) -> str:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        raise HostModelRouteUnavailableError(
            detail=f"Host model route bridge payload field '{field_name}' is missing."
        )
    return normalized


def _normalize_optional_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _validation_error_to_detail(exc: ValidationError) -> str:
    errors = exc.errors()
    if errors:
        message = errors[0].get("msg")
        if isinstance(message, str):
            return f"Host model route bridge returned an invalid response payload: {message}"
    return "Host model route bridge returned an invalid response payload."


__all__ = [
    "HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME",
    "HostModelRouteBridgeClient",
]

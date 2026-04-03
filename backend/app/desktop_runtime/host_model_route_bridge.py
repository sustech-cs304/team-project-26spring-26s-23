"""Private host bridge client for resolving request-scoped provider routes."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx

from app.copilot_runtime.model_routes import (
    HostModelRouteAccessDeniedError,
    HostModelRouteUnavailableError,
    ModelRouteSnapshotMismatchError,
    ProviderProfileNotFoundError,
    ProviderSecretMissingError,
    ResolvedRuntimeModelRoute,
    RuntimeModelRoute,
    RuntimeModelRouteResolver,
)

HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME = "X-Host-Model-Route-Token"
_INVALID_TOKEN_ERROR_CODE = "invalid_host_model_route_bridge_token"
_PROVIDER_NOT_FOUND_ERROR_CODE = "provider_profile_not_found"
_SNAPSHOT_MISMATCH_ERROR_CODE = "route_snapshot_mismatch"
_SECRET_MISSING_ERROR_CODE = "provider_secret_missing"


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
        self._header_name = _normalize_optional_text(header_name) or HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME
        self._transport = transport
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def aclose(self) -> None:
        client = self._client
        if client is None:
            return
        self._client = None
        await client.aclose()

    async def resolve(self, model_route: RuntimeModelRoute) -> ResolvedRuntimeModelRoute:
        if self._bridge_url is None or self._bridge_token is None:
            raise HostModelRouteUnavailableError(
                detail="Host model route bridge bootstrap is not configured."
            )

        try:
            response = await self._get_client().post(
                self._bridge_url,
                json={
                    "providerProfileId": model_route.provider_profile_id,
                    "snapshot": {
                        "provider": model_route.snapshot.provider,
                        "endpointType": model_route.snapshot.endpoint_type,
                        "baseUrl": model_route.snapshot.base_url,
                        "modelId": model_route.snapshot.model_id,
                    },
                },
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


def _parse_resolved_route_payload(payload: Mapping[str, Any]) -> ResolvedRuntimeModelRoute:
    route = payload.get("route")
    if not isinstance(route, Mapping):
        raise HostModelRouteUnavailableError(
            detail="Host model route bridge success payload is missing the resolved route."
        )

    auth = route.get("auth")
    if not isinstance(auth, Mapping):
        raise HostModelRouteUnavailableError(
            detail="Host model route bridge success payload is missing auth fields."
        )

    return ResolvedRuntimeModelRoute(
        provider_profile_id=_require_non_empty_text(route, "providerProfileId"),
        provider=_require_non_empty_text(route, "provider"),
        endpoint_type=_require_non_empty_text(route, "endpointType"),
        base_url=_require_non_empty_text(route, "baseUrl"),
        model_id=_require_non_empty_text(route, "modelId"),
        api_key=_require_non_empty_text(auth, "apiKey"),
    )


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

    code = _normalize_optional_text(error_payload.get("code"))
    details_value = error_payload.get("details")
    details = details_value if isinstance(details_value, Mapping) else {}
    provider_profile_id = _normalize_optional_text(details.get("providerProfileId")) or fallback_provider_profile_id

    if code == _INVALID_TOKEN_ERROR_CODE:
        return HostModelRouteAccessDeniedError(header_name=header_name)
    if code == _PROVIDER_NOT_FOUND_ERROR_CODE:
        return ProviderProfileNotFoundError(provider_profile_id=provider_profile_id)
    if code == _SNAPSHOT_MISMATCH_ERROR_CODE:
        mismatches_value = details.get("mismatches")
        mismatches = mismatches_value if isinstance(mismatches_value, list) else []
        normalized_mismatches = [
            item for item in mismatches if isinstance(item, dict)
        ]
        return ModelRouteSnapshotMismatchError(
            provider_profile_id=provider_profile_id,
            mismatches=normalized_mismatches,
        )
    if code == _SECRET_MISSING_ERROR_CODE:
        return ProviderSecretMissingError(provider_profile_id=provider_profile_id)

    message = _normalize_optional_text(error_payload.get("message")) or "Host model route bridge request failed."
    return HostModelRouteUnavailableError(detail=message)


def _require_non_empty_text(mapping: Mapping[str, Any], field_name: str) -> str:
    value = _normalize_optional_text(mapping.get(field_name))
    if value is None:
        raise HostModelRouteUnavailableError(
            detail=f"Host model route bridge payload field '{field_name}' is missing."
        )
    return value


def _normalize_optional_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


__all__ = [
    "HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME",
    "HostModelRouteBridgeClient",
]

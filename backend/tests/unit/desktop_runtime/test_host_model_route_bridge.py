from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.copilot_runtime.model_routes import (
    HostModelRouteAccessDeniedError,
    HostModelRouteUnavailableError,
    ProviderProfileNotFoundError,
    ProviderSecretMissingError,
    RuntimeModelRoute,
    RuntimeModelRouteRef,
    RuntimeModelRouteResolutionError,
)
from app.desktop_runtime.host_model_route_bridge import (
    HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME,
    HostModelRouteBridgeClient,
)


def _build_runtime_model_route(
    *,
    provider_profile_id: str = "provider-1",
    model_id: str = "gpt-4.1",
    catalog_revision: str | None = None,
) -> RuntimeModelRoute:
    return RuntimeModelRoute(
        provider_profile_id=provider_profile_id,
        route_ref=RuntimeModelRouteRef(
            route_kind="provider-model",
            profile_id=provider_profile_id,
            model_id=model_id,
        ),
        catalog_revision=catalog_revision,
    )


def test_host_model_route_bridge_client_resolves_provider_route_successfully() -> None:
    captured_headers: list[str | None] = []
    captured_bodies: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_headers.append(request.headers.get(HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME))
        captured_bodies.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "ok": True,
                "resolvedRoute": {
                    "routeRef": {
                        "routeKind": "provider-model",
                        "profileId": "provider-1",
                        "modelId": "gpt-4.1",
                    },
                    "providerProfileId": "provider-1",
                    "provider": "openai",
                    "providerId": "openai",
                    "adapterId": "openai",
                    "runtimeStatus": "enabled",
                    "catalogRevision": "2026-04-06-provider-catalog-v1",
                    "endpointFamily": "openai",
                    "endpointType": "openai-compatible",
                    "baseUrl": "https://api.example.com/v1",
                    "modelId": "gpt-4.1",
                    "authKind": "api-key",
                },
                "privateAuth": {
                    "authKind": "api-key",
                    "authPayload": {
                        "apiKey": "resolved-secret",
                    },
                    "apiKey": "resolved-secret",
                },
            },
            request=request,
        )

    client = HostModelRouteBridgeClient(
        bridge_url="http://127.0.0.1:45678/host/private/provider-routes/resolve",
        bridge_token="bridge-token-123",
        transport=httpx.MockTransport(handler),
    )

    resolved = asyncio.run(
        client.resolve(
            _build_runtime_model_route(
                catalog_revision="2026-04-06-provider-catalog-v1",
            )
        )
    )

    assert resolved.provider_profile_id == "provider-1"
    assert resolved.provider == "openai"
    assert resolved.provider_id == "openai"
    assert resolved.adapter_id == "openai"
    assert resolved.runtime_status == "enabled"
    assert resolved.catalog_revision == "2026-04-06-provider-catalog-v1"
    assert resolved.endpoint_family == "openai"
    assert resolved.endpoint_type == "openai-compatible"
    assert resolved.base_url == "https://api.example.com/v1"
    assert resolved.model_id == "gpt-4.1"
    assert resolved.auth_kind == "api-key"
    assert resolved.api_key == "resolved-secret"
    assert resolved.route_ref is not None
    assert resolved.route_ref.profile_id == "provider-1"
    assert resolved.route_ref.model_id == "gpt-4.1"
    assert captured_headers == ["bridge-token-123"]
    assert captured_bodies == [
        {
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "provider-1",
                "modelId": "gpt-4.1",
            },
            "catalogRevision": "2026-04-06-provider-catalog-v1",
        }
    ]


def test_host_model_route_bridge_client_rejects_legacy_success_payload() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "ok": True,
                "route": {
                    "providerProfileId": "provider-1",
                    "provider": "openai",
                    "providerId": "openai",
                    "endpointType": "openai-compatible",
                    "baseUrl": "https://api.example.com/v1",
                    "modelId": "gpt-4.1",
                    "authKind": "api-key",
                    "auth": {
                        "apiKey": "resolved-secret",
                    },
                },
            },
            request=request,
        )

    client = HostModelRouteBridgeClient(
        bridge_url="http://127.0.0.1:45678/host/private/provider-routes/resolve",
        bridge_token="bridge-token-123",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(HostModelRouteUnavailableError) as exc_info:
        asyncio.run(client.resolve(_build_runtime_model_route()))

    assert exc_info.value.details == {
        "detail": "Host model route bridge success payload is missing 'resolvedRoute'."
    }


def test_host_model_route_bridge_client_reuses_client_until_closed() -> None:
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(
            200,
            json={
                "ok": True,
                "resolvedRoute": {
                    "routeRef": {
                        "routeKind": "provider-model",
                        "profileId": "provider-1",
                        "modelId": "gpt-4.1",
                    },
                    "providerProfileId": "provider-1",
                    "provider": "openai",
                    "providerId": "openai",
                    "adapterId": "openai",
                    "runtimeStatus": "enabled",
                    "catalogRevision": "2026-04-06-provider-catalog-v1",
                    "endpointFamily": "openai",
                    "endpointType": "openai-compatible",
                    "baseUrl": "https://api.example.com/v1",
                    "modelId": "gpt-4.1",
                    "authKind": "api-key",
                },
                "privateAuth": {
                    "authKind": "api-key",
                    "authPayload": {
                        "apiKey": "resolved-secret",
                    },
                    "apiKey": "resolved-secret",
                },
            },
            request=request,
        )

    client = HostModelRouteBridgeClient(
        bridge_url="http://127.0.0.1:45678/host/private/provider-routes/resolve",
        bridge_token="bridge-token-123",
        transport=httpx.MockTransport(handler),
    )
    route = _build_runtime_model_route()

    async def exercise() -> None:
        await client.resolve(route)
        first_http_client = client._get_client()
        await client.resolve(route)
        assert client._get_client() is first_http_client
        await client.aclose()
        await client.resolve(route)
        assert client._get_client() is not first_http_client
        await client.aclose()

    asyncio.run(exercise())

    assert request_count == 3


def test_host_model_route_bridge_client_requires_bootstrap_configuration() -> None:
    client = HostModelRouteBridgeClient(
        bridge_url=None,
        bridge_token=None,
    )

    with pytest.raises(HostModelRouteUnavailableError) as exc_info:
        asyncio.run(client.resolve(_build_runtime_model_route()))

    assert exc_info.value.details == {
        "detail": "Host model route bridge bootstrap is not configured."
    }


@pytest.mark.parametrize(
    ("payload", "expected_exception", "expected_match"),
    [
        (
            {
                "ok": False,
                "error": {
                    "code": "provider_profile_not_found",
                    "message": "missing",
                    "details": {"providerProfileId": "provider-missing"},
                },
            },
            ProviderProfileNotFoundError,
            "provider-missing",
        ),
        (
            {
                "ok": False,
                "error": {
                    "code": "provider_model_not_found",
                    "message": "Provider profile 'provider-1' does not define model 'gpt-4.1'.",
                    "details": {
                        "providerProfileId": "provider-1",
                        "routeRef": {
                            "routeKind": "provider-model",
                            "profileId": "provider-1",
                            "modelId": "gpt-4.1",
                        },
                        "modelId": "gpt-4.1",
                    },
                },
            },
            RuntimeModelRouteResolutionError,
            "gpt-4.1",
        ),
        (
            {
                "ok": False,
                "error": {
                    "code": "provider_secret_missing",
                    "message": "missing secret",
                    "details": {"providerProfileId": "provider-1"},
                },
            },
            ProviderSecretMissingError,
            "provider-1",
        ),
    ],
)
def test_host_model_route_bridge_client_maps_host_resolution_errors(
    payload: dict[str, object],
    expected_exception: type[Exception],
    expected_match: str,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload, request=request)

    client = HostModelRouteBridgeClient(
        bridge_url="http://127.0.0.1:45678/host/private/provider-routes/resolve",
        bridge_token="bridge-token-123",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(expected_exception, match=expected_match):
        asyncio.run(client.resolve(_build_runtime_model_route()))


def test_host_model_route_bridge_client_rejects_invalid_bridge_token() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={
                "ok": False,
                "error": {
                    "code": "invalid_host_model_route_bridge_token",
                    "message": "Missing or invalid host model route bridge token.",
                    "details": {
                        "headerName": HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME,
                    },
                },
            },
            request=request,
        )

    client = HostModelRouteBridgeClient(
        bridge_url="http://127.0.0.1:45678/host/private/provider-routes/resolve",
        bridge_token="bridge-token-123",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(HostModelRouteAccessDeniedError) as exc_info:
        asyncio.run(client.resolve(_build_runtime_model_route()))

    assert exc_info.value.details == {
        "headerName": HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME
    }

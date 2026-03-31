from __future__ import annotations

import asyncio

import httpx
import pytest

from app.copilot_runtime.model_routes import (
    HostModelRouteAccessDeniedError,
    HostModelRouteUnavailableError,
    ModelRouteSnapshotMismatchError,
    ProviderProfileNotFoundError,
    ProviderSecretMissingError,
    RuntimeModelRoute,
    RuntimeModelRouteSnapshot,
)
from app.desktop_runtime.host_model_route_bridge import (
    HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME,
    HostModelRouteBridgeClient,
)


def test_host_model_route_bridge_client_resolves_provider_route_successfully() -> None:
    captured_headers: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_headers.append(request.headers.get(HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME))
        return httpx.Response(
            200,
            json={
                "ok": True,
                "route": {
                    "providerProfileId": "provider-1",
                    "provider": "openai",
                    "endpointType": "openai-compatible",
                    "baseUrl": "https://api.example.com/v1",
                    "modelId": "gpt-4.1",
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

    resolved = asyncio.run(
        client.resolve(
            RuntimeModelRoute(
                provider_profile_id="provider-1",
                snapshot=RuntimeModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://api.example.com/v1",
                    model_id="gpt-4.1",
                ),
            )
        )
    )

    assert resolved.provider_profile_id == "provider-1"
    assert resolved.provider == "openai"
    assert resolved.endpoint_type == "openai-compatible"
    assert resolved.base_url == "https://api.example.com/v1"
    assert resolved.model_id == "gpt-4.1"
    assert resolved.api_key == "resolved-secret"
    assert captured_headers == ["bridge-token-123"]


def test_host_model_route_bridge_client_requires_bootstrap_configuration() -> None:
    client = HostModelRouteBridgeClient(
        bridge_url=None,
        bridge_token=None,
    )

    with pytest.raises(HostModelRouteUnavailableError) as exc_info:
        asyncio.run(
            client.resolve(
                RuntimeModelRoute(
                    provider_profile_id="provider-1",
                    snapshot=RuntimeModelRouteSnapshot(
                        provider="openai",
                        endpoint_type="openai-compatible",
                        base_url="https://api.example.com/v1",
                        model_id="gpt-4.1",
                    ),
                )
            )
        )

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
                    "code": "route_snapshot_mismatch",
                    "message": "mismatch",
                    "details": {
                        "providerProfileId": "provider-1",
                        "mismatches": [
                            {
                                "field": "baseUrl",
                                "expected": "https://api.example.com/v1",
                                "actual": "https://drifted.example.com/v1",
                            }
                        ],
                    },
                },
            },
            ModelRouteSnapshotMismatchError,
            "provider-1",
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
        asyncio.run(
            client.resolve(
                RuntimeModelRoute(
                    provider_profile_id="provider-1",
                    snapshot=RuntimeModelRouteSnapshot(
                        provider="openai",
                        endpoint_type="openai-compatible",
                        base_url="https://api.example.com/v1",
                        model_id="gpt-4.1",
                    ),
                )
            )
        )


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
        asyncio.run(
            client.resolve(
                RuntimeModelRoute(
                    provider_profile_id="provider-1",
                    snapshot=RuntimeModelRouteSnapshot(
                        provider="openai",
                        endpoint_type="openai-compatible",
                        base_url="https://api.example.com/v1",
                        model_id="gpt-4.1",
                    ),
                )
            )
        )

    assert exc_info.value.details == {
        "headerName": HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER_NAME
    }

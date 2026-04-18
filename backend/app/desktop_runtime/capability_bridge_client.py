"""Desktop capability bridge client for backend-side host capability delivery."""

from __future__ import annotations

import base64
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx

from app.desktop_runtime.capability_bridge_protocol import (
    DESKTOP_CAPABILITY_BRIDGE_ERROR_CODES,
    DESKTOP_CAPABILITY_BRIDGE_RETRYABLE_ERROR_CODES,
    DesktopCapabilityArtifactDescriptor,
    DesktopCapabilityBridgeRequest,
    DesktopCapabilityName,
    DesktopCapabilityOperation,
    validate_desktop_capability_bridge_result,
)
from app.tooling import ToolInvocationContext
from app.tooling.host_capabilities import HostCapabilityOperationError

HOST_CAPABILITY_BRIDGE_TOKEN_HEADER_NAME = "X-Host-Capability-Bridge-Token"
_DEFAULT_TIMEOUT = 5.0


def _normalize_optional_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_mapping(value: Mapping[str, Any] | None) -> dict[str, Any]:
    if value is None:
        return {}
    return dict(value)


def _build_invalid_response_error(
    *,
    capability: DesktopCapabilityName,
    operation: DesktopCapabilityOperation,
    detail: str,
) -> HostCapabilityOperationError:
    return HostCapabilityOperationError(
        capability=capability,
        code="internal_error",
        message="Desktop capability bridge returned an invalid response payload.",
        details={
            "detail": detail,
            "operation": operation,
        },
    )


def _build_unavailable_error(
    *,
    capability: DesktopCapabilityName,
    operation: DesktopCapabilityOperation,
    detail: str,
) -> HostCapabilityOperationError:
    return HostCapabilityOperationError(
        capability=capability,
        code="temporarily_unavailable",
        message=detail,
        retryable=True,
        details={"operation": operation},
    )


class DesktopCapabilityBridgeClient:
    """Typed client for the white-listed desktop capability bridge protocol."""

    def __init__(
        self,
        *,
        bridge_url: str | None,
        bridge_token: str | None,
        header_name: str = HOST_CAPABILITY_BRIDGE_TOKEN_HEADER_NAME,
        transport: httpx.BaseTransport | httpx.AsyncBaseTransport | None = None,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._bridge_url = _normalize_optional_text(bridge_url)
        self._bridge_token = _normalize_optional_text(bridge_token)
        self._header_name = (
            _normalize_optional_text(header_name)
            or HOST_CAPABILITY_BRIDGE_TOKEN_HEADER_NAME
        )
        self._transport = transport
        self._timeout = timeout
        self._sync_client: httpx.Client | None = None
        self._async_client: httpx.AsyncClient | None = None

    async def aclose(self) -> None:
        sync_client = self._sync_client
        async_client = self._async_client
        self._sync_client = None
        self._async_client = None
        if sync_client is not None:
            sync_client.close()
        if async_client is not None:
            await async_client.aclose()

    async def get_secret(
        self,
        *,
        context: ToolInvocationContext,
        name: str,
    ) -> str | None:
        result = await self._call_async(
            capability="secret",
            operation="get_secret",
            context=context,
            payload={"secretName": name},
        )
        value = result.get("value")
        return value if isinstance(value, str) or value is None else None

    async def has_secret(
        self,
        *,
        context: ToolInvocationContext,
        name: str,
    ) -> bool:
        result = await self._call_async(
            capability="secret",
            operation="has_secret",
            context=context,
            payload={"secretName": name},
        )
        return bool(result["present"])

    def resolve_workspace_path(
        self,
        *,
        context: ToolInvocationContext,
        relative_path: str | None = None,
    ) -> Path:
        payload: dict[str, Any] = {}
        if relative_path is not None:
            payload["relativePath"] = relative_path
        result = self._call_sync(
            capability="workspace",
            operation="resolve_path",
            context=context,
            payload=payload,
        )
        return Path(result["path"])

    def resolve_database_path(
        self,
        *,
        context: ToolInvocationContext,
        relative_path: str | None = None,
    ) -> Path:
        payload: dict[str, Any] = {}
        if relative_path is not None:
            payload["relativePath"] = relative_path
        result = self._call_sync(
            capability="database",
            operation="resolve_path",
            context=context,
            payload=payload,
        )
        return Path(result["path"])

    def ensure_workspace_directory(
        self,
        *,
        context: ToolInvocationContext,
        relative_path: str,
    ) -> Path:
        result = self._call_sync(
            capability="workspace",
            operation="ensure_directory",
            context=context,
            payload={"relativePath": relative_path},
        )
        return Path(result["path"])

    async def save_text(
        self,
        *,
        context: ToolInvocationContext,
        name: str,
        text: str,
        content_type: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> DesktopCapabilityArtifactDescriptor:
        payload: dict[str, Any] = {
            "name": name,
            "text": text,
        }
        if content_type is not None:
            payload["contentType"] = content_type
        if metadata is not None:
            payload["metadata"] = dict(metadata)
        result = await self._call_async(
            capability="artifact",
            operation="save_text",
            context=context,
            payload=payload,
        )
        return _build_artifact_descriptor(result)

    async def save_bytes(
        self,
        *,
        context: ToolInvocationContext,
        name: str,
        content: bytes,
        content_type: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> DesktopCapabilityArtifactDescriptor:
        payload: dict[str, Any] = {
            "name": name,
            "contentBase64": base64.b64encode(content).decode("ascii"),
        }
        if content_type is not None:
            payload["contentType"] = content_type
        if metadata is not None:
            payload["metadata"] = dict(metadata)
        result = await self._call_async(
            capability="artifact",
            operation="save_bytes",
            context=context,
            payload=payload,
        )
        return _build_artifact_descriptor(result)

    async def describe_artifact(
        self,
        *,
        context: ToolInvocationContext,
        artifact_id: str,
    ) -> DesktopCapabilityArtifactDescriptor:
        result = await self._call_async(
            capability="artifact",
            operation="describe_artifact",
            context=context,
            payload={"artifactId": artifact_id},
        )
        return _build_artifact_descriptor(result)

    async def get_state_value(
        self,
        *,
        context: ToolInvocationContext,
        scope: str,
        key: str,
    ) -> dict[str, Any] | None:
        result = await self._call_async(
            capability="state",
            operation="get_value",
            context=context,
            payload={"scope": scope, "key": key},
        )
        if result["found"]:
            return dict(result["value"])
        return None

    async def put_state_value(
        self,
        *,
        context: ToolInvocationContext,
        scope: str,
        key: str,
        value: Mapping[str, Any],
    ) -> None:
        await self._call_async(
            capability="state",
            operation="put_value",
            context=context,
            payload={"scope": scope, "key": key, "value": dict(value)},
        )

    async def delete_state_value(
        self,
        *,
        context: ToolInvocationContext,
        scope: str,
        key: str,
    ) -> None:
        await self._call_async(
            capability="state",
            operation="delete_value",
            context=context,
            payload={"scope": scope, "key": key},
        )

    def emit_event(
        self,
        *,
        context: ToolInvocationContext,
        event_type: str,
        message: str | None = None,
        data: Mapping[str, Any] | None = None,
    ) -> None:
        payload: dict[str, Any] = {"eventType": event_type}
        if message is not None:
            payload["message"] = message
        if data is not None:
            payload["data"] = dict(data)
        self._call_sync(
            capability="event",
            operation="emit_event",
            context=context,
            payload=payload,
        )

    async def _call_async(
        self,
        *,
        capability: DesktopCapabilityName,
        operation: DesktopCapabilityOperation,
        context: ToolInvocationContext,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        request = self._build_request(
            capability=capability,
            operation=operation,
            context=context,
            payload=payload,
        )
        bridge_url = self._require_bridge_url(
            capability=capability, operation=operation
        )
        try:
            response = await self._get_async_client().post(
                bridge_url,
                json=request.to_dict(),
                headers=self._build_headers(),
            )
        except httpx.HTTPError as exc:
            raise _build_unavailable_error(
                capability=capability,
                operation=operation,
                detail=f"Desktop capability bridge request failed: {exc}",
            ) from exc
        return self._parse_response(
            capability=capability,
            operation=operation,
            request=request,
            response=response,
        )

    def _call_sync(
        self,
        *,
        capability: DesktopCapabilityName,
        operation: DesktopCapabilityOperation,
        context: ToolInvocationContext,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        request = self._build_request(
            capability=capability,
            operation=operation,
            context=context,
            payload=payload,
        )
        bridge_url = self._require_bridge_url(
            capability=capability, operation=operation
        )
        try:
            response = self._get_sync_client().post(
                bridge_url,
                json=request.to_dict(),
                headers=self._build_headers(),
            )
        except httpx.HTTPError as exc:
            raise _build_unavailable_error(
                capability=capability,
                operation=operation,
                detail=f"Desktop capability bridge request failed: {exc}",
            ) from exc
        return self._parse_response(
            capability=capability,
            operation=operation,
            request=request,
            response=response,
        )

    def _build_request(
        self,
        *,
        capability: DesktopCapabilityName,
        operation: DesktopCapabilityOperation,
        context: ToolInvocationContext,
        payload: Mapping[str, Any],
    ) -> DesktopCapabilityBridgeRequest:
        return DesktopCapabilityBridgeRequest(
            request_id=f"{context.tool_id}:{operation}:{uuid4().hex}",
            capability=capability,
            operation=operation,
            tool_id=context.tool_id,
            run_id=context.run_id or f"{context.tool_id}:direct-run",
            tool_call_id=context.invocation_id,
            payload=dict(payload),
        )

    def _require_bridge_url(
        self,
        *,
        capability: DesktopCapabilityName,
        operation: DesktopCapabilityOperation,
    ) -> str:
        bridge_url = self._bridge_url
        bridge_token = self._bridge_token
        if bridge_url is None or bridge_token is None:
            raise _build_unavailable_error(
                capability=capability,
                operation=operation,
                detail="Desktop capability bridge bootstrap is not configured.",
            )
        return bridge_url

    def _build_headers(self) -> dict[str, str]:
        bridge_token = self._bridge_token
        if bridge_token is None:
            return {}
        return {self._header_name: bridge_token}

    def _get_sync_client(self) -> httpx.Client:
        client = self._sync_client
        if client is None:
            client = httpx.Client(
                transport=self._get_sync_transport(),
                timeout=self._timeout,
            )
            self._sync_client = client
        return client

    def _get_sync_transport(self) -> httpx.BaseTransport | None:
        transport = self._transport
        if transport is None:
            return None
        if isinstance(transport, httpx.BaseTransport):
            return transport
        raise TypeError(
            "Configured desktop capability bridge transport does not support sync requests."
        )

    def _get_async_client(self) -> httpx.AsyncClient:
        client = self._async_client
        if client is None:
            client = httpx.AsyncClient(
                transport=self._get_async_transport(),
                timeout=self._timeout,
            )
            self._async_client = client
        return client

    def _get_async_transport(self) -> httpx.AsyncBaseTransport | None:
        transport = self._transport
        if transport is None:
            return None
        if isinstance(transport, httpx.AsyncBaseTransport):
            return transport
        raise TypeError(
            "Configured desktop capability bridge transport does not support async requests."
        )

    def _parse_response(
        self,
        *,
        capability: DesktopCapabilityName,
        operation: DesktopCapabilityOperation,
        request: DesktopCapabilityBridgeRequest,
        response: httpx.Response,
    ) -> dict[str, Any]:
        if response.status_code == 401:
            raise HostCapabilityOperationError(
                capability=capability,
                code="permission_denied",
                message="Desktop capability bridge access was denied.",
                details={
                    "headerName": self._header_name,
                    "operation": operation,
                },
            )

        try:
            payload = response.json()
        except ValueError as exc:
            raise _build_unavailable_error(
                capability=capability,
                operation=operation,
                detail="Desktop capability bridge returned a non-JSON response.",
            ) from exc

        if not isinstance(payload, Mapping):
            raise _build_invalid_response_error(
                capability=capability,
                operation=operation,
                detail="Response payload must be an object.",
            )

        response_request_id = _normalize_optional_text(payload.get("requestId"))
        if response_request_id != request.request_id:
            raise _build_invalid_response_error(
                capability=capability,
                operation=operation,
                detail="Response requestId did not match the request envelope.",
            )

        ok = payload.get("ok")
        if ok is True:
            raw_result = payload.get("result")
            if raw_result is None:
                raw_result = {}
            if not isinstance(raw_result, Mapping):
                raise _build_invalid_response_error(
                    capability=capability,
                    operation=operation,
                    detail="Success result must be an object when provided.",
                )
            try:
                return validate_desktop_capability_bridge_result(
                    capability=capability,
                    operation=operation,
                    result=raw_result,
                )
            except ValueError as exc:
                raise _build_invalid_response_error(
                    capability=capability,
                    operation=operation,
                    detail=str(exc),
                ) from exc

        if ok is False:
            raw_code = _normalize_optional_text(payload.get("errorCode"))
            code = (
                raw_code
                if raw_code in DESKTOP_CAPABILITY_BRIDGE_ERROR_CODES
                else "internal_error"
            )
            message = _normalize_optional_text(payload.get("errorMessage")) or (
                "Desktop capability bridge request failed."
            )
            raw_retryable = payload.get("errorRetryable")
            retryable = (
                raw_retryable
                if isinstance(raw_retryable, bool)
                else code in DESKTOP_CAPABILITY_BRIDGE_RETRYABLE_ERROR_CODES
            )
            details_value = payload.get("details")
            details = _normalize_mapping(
                details_value if isinstance(details_value, Mapping) else None
            )
            details.setdefault("operation", operation)
            if raw_code is not None and raw_code != code:
                details["bridgeErrorCode"] = raw_code
            raise HostCapabilityOperationError(
                capability=capability,
                code=code,
                message=message,
                retryable=retryable,
                details=details,
            )

        raise _build_invalid_response_error(
            capability=capability,
            operation=operation,
            detail="Response payload must include a boolean 'ok' field.",
        )


def _build_artifact_descriptor(
    payload: Mapping[str, Any],
) -> DesktopCapabilityArtifactDescriptor:
    return DesktopCapabilityArtifactDescriptor(
        artifact_id=str(payload["artifactId"]),
        uri=_normalize_optional_text(payload.get("uri")),
        name=_normalize_optional_text(payload.get("name")),
        content_type=_normalize_optional_text(payload.get("contentType")),
        metadata=_normalize_mapping(
            payload.get("metadata")
            if isinstance(payload.get("metadata"), Mapping)
            else None
        ),
    )


__all__ = [
    "HOST_CAPABILITY_BRIDGE_TOKEN_HEADER_NAME",
    "DesktopCapabilityBridgeClient",
]

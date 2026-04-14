"""Bridge-backed host capability factory for desktop runtime tool invocations."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from app.desktop_runtime.capability_bridge_client import DesktopCapabilityBridgeClient
from app.tooling import HostArtifact, HostEvent, ToolContract, ToolHostCapabilities, ToolInvocationContext
from app.tooling.host_capabilities import ArtifactStore, EventSink, SecretProvider, StateStore, WorkspaceResolver
from app.tooling.runtime_adapter.copilot_runtime import RuntimeToolExecutionContext, ToolHostCapabilitiesFactory

_STATE_SCOPE_RUN_PREFIX = "run:"
_STATE_SCOPE_TOOL = "tool"
_STATE_SCOPE_RUN = "run"


class _BridgeBackedSecretProvider(SecretProvider):
    def __init__(
        self,
        *,
        bridge_client: DesktopCapabilityBridgeClient,
        invocation_context: ToolInvocationContext,
    ) -> None:
        self._bridge_client = bridge_client
        self._invocation_context = invocation_context

    async def get_secret(self, *, name: str) -> str | None:
        return await self._bridge_client.get_secret(
            context=self._invocation_context,
            name=name,
        )

    async def has_secret(self, *, name: str) -> bool:
        return await self._bridge_client.has_secret(
            context=self._invocation_context,
            name=name,
        )


class _BridgeBackedWorkspaceResolver(WorkspaceResolver):
    def __init__(
        self,
        *,
        bridge_client: DesktopCapabilityBridgeClient,
        invocation_context: ToolInvocationContext,
    ) -> None:
        self._bridge_client = bridge_client
        self._invocation_context = invocation_context

    def resolve_workspace_path(self, *, relative_path: str | None = None) -> Path:
        return self._bridge_client.resolve_workspace_path(
            context=self._invocation_context,
            relative_path=relative_path,
        )

    def ensure_workspace_directory(self, *, relative_path: str) -> Path:
        return self._bridge_client.ensure_workspace_directory(
            context=self._invocation_context,
            relative_path=relative_path,
        )


class _BridgeBackedArtifactStore(ArtifactStore):
    def __init__(
        self,
        *,
        bridge_client: DesktopCapabilityBridgeClient,
        invocation_context: ToolInvocationContext,
    ) -> None:
        self._bridge_client = bridge_client
        self._invocation_context = invocation_context

    async def save_text(
        self,
        *,
        name: str,
        text: str,
        content_type: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> HostArtifact:
        descriptor = await self._bridge_client.save_text(
            context=self._invocation_context,
            name=name,
            text=text,
            content_type=content_type,
            metadata=metadata,
        )
        return _to_host_artifact(descriptor)

    async def save_bytes(
        self,
        *,
        name: str,
        content: bytes,
        content_type: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> HostArtifact:
        descriptor = await self._bridge_client.save_bytes(
            context=self._invocation_context,
            name=name,
            content=content,
            content_type=content_type,
            metadata=metadata,
        )
        return _to_host_artifact(descriptor)

    async def describe_artifact(self, *, artifact_id: str) -> HostArtifact:
        descriptor = await self._bridge_client.describe_artifact(
            context=self._invocation_context,
            artifact_id=artifact_id,
        )
        return _to_host_artifact(descriptor)


class _BridgeBackedStateStore(StateStore):
    def __init__(
        self,
        *,
        bridge_client: DesktopCapabilityBridgeClient,
        invocation_context: ToolInvocationContext,
    ) -> None:
        self._bridge_client = bridge_client
        self._invocation_context = invocation_context

    async def get(self, *, namespace: str, key: str) -> dict[str, Any] | None:
        scope, bridge_key = _build_state_address(
            invocation_context=self._invocation_context,
            namespace=namespace,
            key=key,
        )
        return await self._bridge_client.get_state_value(
            context=self._invocation_context,
            scope=scope,
            key=bridge_key,
        )

    async def put(self, *, namespace: str, key: str, value: Mapping[str, Any]) -> None:
        scope, bridge_key = _build_state_address(
            invocation_context=self._invocation_context,
            namespace=namespace,
            key=key,
        )
        await self._bridge_client.put_state_value(
            context=self._invocation_context,
            scope=scope,
            key=bridge_key,
            value=value,
        )

    async def delete(self, *, namespace: str, key: str) -> None:
        scope, bridge_key = _build_state_address(
            invocation_context=self._invocation_context,
            namespace=namespace,
            key=key,
        )
        await self._bridge_client.delete_state_value(
            context=self._invocation_context,
            scope=scope,
            key=bridge_key,
        )


class _BridgeBackedEventSink(EventSink):
    def __init__(
        self,
        *,
        bridge_client: DesktopCapabilityBridgeClient,
        invocation_context: ToolInvocationContext,
    ) -> None:
        self._bridge_client = bridge_client
        self._invocation_context = invocation_context

    def emit(self, event: HostEvent) -> None:
        self._bridge_client.emit_event(
            context=self._invocation_context,
            event_type=event.event_type,
            message=event.message,
            data=event.data,
        )


def build_desktop_bridge_host_capabilities_factory(
    *,
    bridge_client: DesktopCapabilityBridgeClient,
) -> ToolHostCapabilitiesFactory:
    """Build an invocation-scoped host capability factory backed by the desktop bridge client."""

    def factory(
        contract_tool: ToolContract,
        invocation_context: ToolInvocationContext,
        runtime_context: RuntimeToolExecutionContext | None,
    ) -> ToolHostCapabilities:
        _ = contract_tool, runtime_context
        return ToolHostCapabilities(
            workspace_resolver=_BridgeBackedWorkspaceResolver(
                bridge_client=bridge_client,
                invocation_context=invocation_context,
            ),
            artifact_store=_BridgeBackedArtifactStore(
                bridge_client=bridge_client,
                invocation_context=invocation_context,
            ),
            state_store=_BridgeBackedStateStore(
                bridge_client=bridge_client,
                invocation_context=invocation_context,
            ),
            secret_provider=_BridgeBackedSecretProvider(
                bridge_client=bridge_client,
                invocation_context=invocation_context,
            ),
            event_sink=_BridgeBackedEventSink(
                bridge_client=bridge_client,
                invocation_context=invocation_context,
            ),
        )

    return factory


def _build_state_address(
    *,
    invocation_context: ToolInvocationContext,
    namespace: str,
    key: str,
) -> tuple[str, str]:
    normalized_namespace = namespace.strip() or "default"
    normalized_key = key.strip()
    if normalized_key == "":
        raise ValueError("State store key must be a non-empty string.")

    scope = _STATE_SCOPE_TOOL
    namespace_for_key = normalized_namespace
    if normalized_namespace.startswith(_STATE_SCOPE_RUN_PREFIX):
        scope = _STATE_SCOPE_RUN
        namespace_for_key = normalized_namespace[len(_STATE_SCOPE_RUN_PREFIX) :].strip() or "default"

    return scope, f"{invocation_context.tool_id}:{namespace_for_key}:{normalized_key}"


def _to_host_artifact(value: Any) -> HostArtifact:
    return HostArtifact(
        artifact_id=value.artifact_id,
        uri=value.uri,
        name=value.name,
        content_type=value.content_type,
        metadata=value.metadata,
    )


__all__ = ["build_desktop_bridge_host_capabilities_factory"]

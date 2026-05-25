"""Protocol contracts for the Desktop Capability Bridge."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from typing import Any, ClassVar, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from app.tooling.contract.results import ToolArtifactReference

from ._capability_bridge.constants import (
    DESKTOP_CAPABILITY_BRIDGE_ERROR_CODES,
    DESKTOP_CAPABILITY_BRIDGE_REQUEST_ENVELOPE_SCHEMA,
    DESKTOP_CAPABILITY_BRIDGE_REQUEST_PAYLOAD_SCHEMAS,
    DESKTOP_CAPABILITY_BRIDGE_RESPONSE_ENVELOPE_SCHEMA,
    DESKTOP_CAPABILITY_BRIDGE_RESULT_SCHEMAS,
    DESKTOP_CAPABILITY_BRIDGE_RETRYABLE_ERROR_CODES,
    DESKTOP_CAPABILITY_NAMES,
    DESKTOP_CAPABILITY_OPERATIONS,
    DESKTOP_CAPABILITY_OPERATIONS_BY_CAPABILITY,
    DESKTOP_CAPABILITY_STATE_SCOPES,
    DesktopCapabilityBridgeErrorCode,
    DesktopCapabilityBridgeOperationKey,
    DesktopCapabilityName,
    DesktopCapabilityOperation,
    DesktopCapabilityStateScope,
    _normalize_mapping,
)

from ._capability_bridge.validators import (
    _artifact_descriptor_to_dict,
    _assert_allowed_fields,
    _normalize_bridge_model_dict,
    _normalize_capability_name,
    _normalize_error_code,
    _normalize_operation_key,
    _normalize_operation_name,
    _normalize_optional_mapping_field_value,
    _normalize_optional_text,
    _normalize_optional_text_field_value,
    _normalize_state_scope,
    _require_boolean_field_value,
    _require_mapping,
    _require_mapping_field_value,
    _require_non_empty_text,
    _require_text_field_value,
    _validation_error_to_message,
)


class _DesktopCapabilityBridgeModel(BaseModel):
    """Shared Pydantic base for desktop bridge boundary contracts."""

    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )

    _bridge_allowed_fields: ClassVar[set[str] | None] = None
    _bridge_field_name: ClassVar[str] = "payload"

    @model_validator(mode="before")
    @classmethod
    def _normalize_model_input(cls, value: Any) -> Any:
        if isinstance(value, cls):
            return value
        mapping = _require_mapping(value, field_name=cls._bridge_field_name)
        if cls._bridge_allowed_fields is not None:
            _assert_allowed_fields(
                mapping,
                allowed_fields=cls._bridge_allowed_fields,
                field_name=cls._bridge_field_name,
            )
        return dict(mapping)


class _BridgePayloadModel(_DesktopCapabilityBridgeModel):
    _bridge_field_name: ClassVar[str] = "payload"

    def to_bridge_payload(self) -> dict[str, Any]:
        return _normalize_bridge_model_dict(self, exclude_none=True)


class _BridgeResultModel(_DesktopCapabilityBridgeModel):
    _bridge_field_name: ClassVar[str] = "result"

    def to_bridge_result(self) -> dict[str, Any]:
        return _normalize_bridge_model_dict(self, exclude_none=True)


class _SecretNamePayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"secretName"}

    secret_name: str = Field(
        validation_alias="secretName",
        serialization_alias="secretName",
        min_length=1,
    )

    @field_validator("secret_name", mode="before")
    @classmethod
    def _validate_secret_name(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="secretName",
            field_context="payload",
        )


class _ResolvePathPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"relativePath"}

    relative_path: str | None = Field(
        default=None,
        validation_alias="relativePath",
        serialization_alias="relativePath",
        min_length=1,
    )

    @field_validator("relative_path", mode="before")
    @classmethod
    def _validate_relative_path(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="relativePath",
            field_context="payload",
        )


class _EnsureDirectoryPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"relativePath"}

    relative_path: str = Field(
        validation_alias="relativePath",
        serialization_alias="relativePath",
        min_length=1,
    )

    @field_validator("relative_path", mode="before")
    @classmethod
    def _validate_relative_path(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="relativePath",
            field_context="payload",
        )


class _SaveTextPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "name",
        "text",
        "contentType",
        "metadata",
    }

    name: str = Field(min_length=1)
    text: str
    content_type: str | None = Field(
        default=None,
        validation_alias="contentType",
        serialization_alias="contentType",
        min_length=1,
    )
    metadata: dict[str, Any] | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="name",
            field_context="payload",
        )

    @field_validator("text", mode="before")
    @classmethod
    def _validate_text(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="text",
            field_context="payload",
            allow_empty=True,
        )

    @field_validator("content_type", mode="before")
    @classmethod
    def _validate_content_type(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="contentType",
            field_context="payload",
        )

    @field_validator("metadata", mode="before")
    @classmethod
    def _validate_metadata(cls, value: Any) -> dict[str, Any] | None:
        return _normalize_optional_mapping_field_value(
            value,
            field_name="metadata",
            field_context="payload",
        )


class _SaveBytesPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "name",
        "contentBase64",
        "contentType",
        "metadata",
    }

    name: str = Field(min_length=1)
    content_base64: str = Field(
        validation_alias="contentBase64",
        serialization_alias="contentBase64",
        min_length=1,
    )
    content_type: str | None = Field(
        default=None,
        validation_alias="contentType",
        serialization_alias="contentType",
        min_length=1,
    )
    metadata: dict[str, Any] | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="name",
            field_context="payload",
        )

    @field_validator("content_base64", mode="before")
    @classmethod
    def _validate_content_base64(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="contentBase64",
            field_context="payload",
        )

    @field_validator("content_type", mode="before")
    @classmethod
    def _validate_content_type(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="contentType",
            field_context="payload",
        )

    @field_validator("metadata", mode="before")
    @classmethod
    def _validate_metadata(cls, value: Any) -> dict[str, Any] | None:
        return _normalize_optional_mapping_field_value(
            value,
            field_name="metadata",
            field_context="payload",
        )


class _DescribeArtifactPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"artifactId"}

    artifact_id: str = Field(
        validation_alias="artifactId",
        serialization_alias="artifactId",
        min_length=1,
    )

    @field_validator("artifact_id", mode="before")
    @classmethod
    def _validate_artifact_id(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="artifactId",
            field_context="payload",
        )


class _StateAddressPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"scope", "key"}

    scope: DesktopCapabilityStateScope
    key: str = Field(min_length=1)

    @field_validator("scope", mode="before")
    @classmethod
    def _validate_scope(cls, value: Any) -> DesktopCapabilityStateScope:
        if not isinstance(value, str):
            raise ValueError(
                "payload field 'scope' must be one of "
                f"{', '.join(DESKTOP_CAPABILITY_STATE_SCOPES)}."
            )
        return _normalize_state_scope(value)

    @field_validator("key", mode="before")
    @classmethod
    def _validate_key(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="key",
            field_context="payload",
        )


class _StatePutValuePayload(_StateAddressPayload):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"scope", "key", "value"}

    value: dict[str, Any]

    @field_validator("value", mode="before")
    @classmethod
    def _validate_value(cls, value: Any) -> dict[str, Any]:
        return _require_mapping_field_value(
            value,
            field_name="value",
            field_context="payload",
        )


class _EmitEventPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "eventType",
        "message",
        "data",
    }

    event_type: str = Field(
        validation_alias="eventType",
        serialization_alias="eventType",
        min_length=1,
    )
    message: str | None = Field(default=None, min_length=1)
    data: dict[str, Any] | None = None

    @field_validator("event_type", mode="before")
    @classmethod
    def _validate_event_type(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="eventType",
            field_context="payload",
        )

    @field_validator("message", mode="before")
    @classmethod
    def _validate_message(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="message",
            field_context="payload",
        )

    @field_validator("data", mode="before")
    @classmethod
    def _validate_data(cls, value: Any) -> dict[str, Any] | None:
        return _normalize_optional_mapping_field_value(
            value,
            field_name="data",
            field_context="payload",
        )


class _McpToolCallPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "serverId",
        "remoteToolName",
        "arguments",
        "snapshotRevision",
    }

    server_id: str = Field(
        validation_alias="serverId",
        serialization_alias="serverId",
        min_length=1,
    )
    remote_tool_name: str = Field(
        validation_alias="remoteToolName",
        serialization_alias="remoteToolName",
        min_length=1,
    )
    arguments: dict[str, Any] = Field(default_factory=dict)
    snapshot_revision: int | None = Field(
        default=None,
        validation_alias="snapshotRevision",
        serialization_alias="snapshotRevision",
        ge=0,
    )

    @field_validator("server_id", mode="before")
    @classmethod
    def _validate_server_id(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="serverId",
            field_context="payload",
        )

    @field_validator("remote_tool_name", mode="before")
    @classmethod
    def _validate_remote_tool_name(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="remoteToolName",
            field_context="payload",
        )

    @field_validator("arguments", mode="before")
    @classmethod
    def _validate_arguments(cls, value: Any) -> dict[str, Any]:
        return _require_mapping_field_value(
            value,
            field_name="arguments",
            field_context="payload",
        )

    @field_validator("snapshot_revision", mode="before")
    @classmethod
    def _validate_snapshot_revision(cls, value: Any) -> int | None:
        if value is None:
            return None
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError(
                "payload field 'snapshotRevision' must be a non-negative integer when provided."
            )
        return value


class _McpToolCallError(_DesktopCapabilityBridgeModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "code",
        "message",
        "retryable",
        "observedAt",
        "details",
    }
    _bridge_field_name: ClassVar[str] = "mcp tool error"

    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    retryable: bool
    observed_at: str | None = Field(
        default=None,
        validation_alias="observedAt",
        serialization_alias="observedAt",
        min_length=1,
    )
    details: dict[str, Any] | None = None

    @field_validator("code", mode="before")
    @classmethod
    def _validate_code(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="code",
            field_context="mcp tool error",
        )

    @field_validator("message", mode="before")
    @classmethod
    def _validate_message(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="message",
            field_context="mcp tool error",
        )

    @field_validator("retryable", mode="before")
    @classmethod
    def _validate_retryable(cls, value: Any) -> bool:
        return _require_boolean_field_value(
            value,
            field_name="retryable",
            field_context="mcp tool error",
        )

    @field_validator("observed_at", mode="before")
    @classmethod
    def _validate_observed_at(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="observedAt",
            field_context="mcp tool error",
        )

    @field_validator("details", mode="before")
    @classmethod
    def _validate_details(cls, value: Any) -> dict[str, Any] | None:
        return _normalize_optional_mapping_field_value(
            value,
            field_name="details",
            field_context="mcp tool error",
        )

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.observed_at is not None:
            payload["observedAt"] = self.observed_at
        if self.details is not None:
            payload["details"] = _normalize_mapping(self.details)
        return payload


class _McpToolCallResult(_BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "ok",
        "toolId",
        "serverId",
        "remoteToolName",
        "content",
        "structuredContent",
        "snapshotRevision",
        "isError",
        "error",
    }

    ok: bool
    tool_id: str = Field(
        validation_alias="toolId",
        serialization_alias="toolId",
        min_length=1,
    )
    server_id: str = Field(
        validation_alias="serverId",
        serialization_alias="serverId",
        min_length=1,
    )
    remote_tool_name: str = Field(
        validation_alias="remoteToolName",
        serialization_alias="remoteToolName",
        min_length=1,
    )
    content: list[Any] = Field(default_factory=list)
    structured_content: Any = Field(
        default=None,
        validation_alias="structuredContent",
        serialization_alias="structuredContent",
    )
    snapshot_revision: int | None = Field(
        default=None,
        validation_alias="snapshotRevision",
        serialization_alias="snapshotRevision",
        ge=0,
    )
    is_error: bool | None = Field(
        default=None,
        validation_alias="isError",
        serialization_alias="isError",
    )
    error: _McpToolCallError | None = None

    @field_validator("ok", mode="before")
    @classmethod
    def _validate_ok(cls, value: Any) -> bool:
        return _require_boolean_field_value(
            value,
            field_name="ok",
            field_context="result",
        )

    @field_validator("tool_id", mode="before")
    @classmethod
    def _validate_tool_id(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="toolId",
            field_context="result",
        )

    @field_validator("server_id", mode="before")
    @classmethod
    def _validate_server_id(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="serverId",
            field_context="result",
        )

    @field_validator("remote_tool_name", mode="before")
    @classmethod
    def _validate_remote_tool_name(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="remoteToolName",
            field_context="result",
        )

    @field_validator("content", mode="before")
    @classmethod
    def _validate_content(cls, value: Any) -> list[Any]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("result field 'content' must be an array when provided.")
        return list(value)

    @field_validator("snapshot_revision", mode="before")
    @classmethod
    def _validate_snapshot_revision(cls, value: Any) -> int | None:
        if value is None:
            return None
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError(
                "result field 'snapshotRevision' must be a non-negative integer when provided."
            )
        return value

    @field_validator("is_error", mode="before")
    @classmethod
    def _validate_is_error(cls, value: Any) -> bool | None:
        if value is None:
            return None
        return _require_boolean_field_value(
            value,
            field_name="isError",
            field_context="result",
        )

    @model_validator(mode="after")
    def _validate_mcp_tool_call_result(self) -> Self:
        if self.ok:
            if self.error is not None:
                raise ValueError(
                    "Successful MCP tool call results cannot include an error payload."
                )
            if self.is_error is None:
                object.__setattr__(self, "is_error", False)
            elif self.is_error:
                raise ValueError(
                    "Successful MCP tool call results cannot mark isError=true."
                )
            return self

        if self.error is None:
            raise ValueError(
                "Failed MCP tool call results must include an error payload."
            )
        if len(self.content) > 0:
            raise ValueError("Failed MCP tool call results cannot include content.")
        if self.structured_content is not None:
            raise ValueError(
                "Failed MCP tool call results cannot include structuredContent."
            )
        if self.is_error is not None:
            raise ValueError(
                "Failed MCP tool call results cannot include an isError flag."
            )
        return self

    def to_bridge_result(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ok": self.ok,
            "toolId": self.tool_id,
            "serverId": self.server_id,
            "remoteToolName": self.remote_tool_name,
        }
        if self.snapshot_revision is not None:
            payload["snapshotRevision"] = self.snapshot_revision
        if self.ok:
            payload["content"] = list(self.content)
            if self.structured_content is not None:
                payload["structuredContent"] = self.structured_content
            payload["isError"] = False
            return payload

        if self.error is not None:
            payload["error"] = self.error.to_dict()
        return payload


class _GetSecretResult(_BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"value"}

    value: str | None = None

    @field_validator("value", mode="before")
    @classmethod
    def _validate_value(cls, value: Any) -> str | None:
        if value is not None and not isinstance(value, str):
            raise ValueError("result field 'value' must be a string or null.")
        return value

    def to_bridge_result(self) -> dict[str, Any]:
        return {"value": self.value}


class _HasSecretResult(_BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"present"}

    present: bool

    @field_validator("present", mode="before")
    @classmethod
    def _validate_present(cls, value: Any) -> bool:
        return _require_boolean_field_value(
            value,
            field_name="present",
            field_context="result",
        )


class _PathResult(_BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"path"}

    path: str = Field(min_length=1)

    @field_validator("path", mode="before")
    @classmethod
    def _validate_path(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="path",
            field_context="result",
        )


class _ArtifactDescriptorFields(_DesktopCapabilityBridgeModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "artifactId",
        "artifact_id",
        "uri",
        "name",
        "contentType",
        "content_type",
        "metadata",
    }

    artifact_id: str = Field(
        validation_alias="artifactId",
        serialization_alias="artifactId",
        min_length=1,
    )
    uri: str | None = Field(default=None, min_length=1)
    name: str | None = Field(default=None, min_length=1)
    content_type: str | None = Field(
        default=None,
        validation_alias="contentType",
        serialization_alias="contentType",
        min_length=1,
    )
    metadata: dict[str, Any]

    @field_validator("artifact_id", mode="before")
    @classmethod
    def _validate_artifact_id(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="artifactId",
            field_context=cls._bridge_field_name,
        )

    @field_validator("uri", mode="before")
    @classmethod
    def _validate_uri(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="uri",
            field_context=cls._bridge_field_name,
        )

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="name",
            field_context=cls._bridge_field_name,
        )

    @field_validator("content_type", mode="before")
    @classmethod
    def _validate_content_type(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="contentType",
            field_context=cls._bridge_field_name,
        )

    @field_validator("metadata", mode="before")
    @classmethod
    def _validate_metadata(cls, value: Any) -> dict[str, Any]:
        return _require_mapping_field_value(
            value,
            field_name="metadata",
            field_context=cls._bridge_field_name,
        )

    def to_dict(self) -> dict[str, Any]:
        return _artifact_descriptor_to_dict(
            artifact_id=self.artifact_id,
            uri=self.uri,
            name=self.name,
            content_type=self.content_type,
            metadata=self.metadata,
        )


class DesktopCapabilityArtifactDescriptor(_ArtifactDescriptorFields):
    """Stable artifact descriptor shared by bridge responses and tool results."""

    _bridge_field_name: ClassVar[str] = "artifact descriptor"

    metadata: dict[str, Any] = Field(default_factory=dict)

    def to_tool_artifact_reference(self) -> ToolArtifactReference:
        return ToolArtifactReference(
            artifact_id=self.artifact_id,
            name=self.name,
            content_type=self.content_type,
            uri=self.uri,
            metadata=_normalize_mapping(self.metadata),
        )

    @classmethod
    def from_tool_artifact_reference(
        cls,
        value: ToolArtifactReference,
    ) -> "DesktopCapabilityArtifactDescriptor":
        return cls(
            artifact_id=value.artifact_id,
            name=value.name,
            content_type=value.content_type,
            uri=value.uri,
            metadata=_normalize_mapping(value.metadata),
        )


class _ArtifactDescriptorResult(_ArtifactDescriptorFields, _BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "artifactId",
        "uri",
        "name",
        "contentType",
        "metadata",
    }
    _bridge_field_name: ClassVar[str] = "result"

    def to_bridge_result(self) -> dict[str, Any]:
        return self.to_dict()


class _StateGetValueResult(_BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"found", "value"}

    found: bool
    value: dict[str, Any] | None = None

    @field_validator("found", mode="before")
    @classmethod
    def _validate_found(cls, value: Any) -> bool:
        return _require_boolean_field_value(
            value,
            field_name="found",
            field_context="result",
        )

    @field_validator("value", mode="before")
    @classmethod
    def _validate_value(cls, value: Any) -> dict[str, Any] | None:
        if value is None:
            return None
        if not isinstance(value, Mapping):
            raise ValueError(
                "result field 'value' must be an object when 'found' is true."
            )
        return _normalize_mapping(value)

    @model_validator(mode="after")
    def _validate_found_value_pair(self) -> Self:
        if self.found and self.value is None:
            raise ValueError(
                "result field 'value' must be an object when 'found' is true."
            )
        if not self.found and self.value is not None:
            raise ValueError("result field 'value' must be null when 'found' is false.")
        return self

    def to_bridge_result(self) -> dict[str, Any]:
        if self.found:
            return {"found": True, "value": _normalize_mapping(self.value or {})}
        return {"found": False, "value": None}


class _EmptyResult(_BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = set()


class _BrowserPagePayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"url", "showWindow", "newTab", "selector", "format"}

    url: str = Field(min_length=1)
    show_window: bool | None = Field(
        default=None,
        validation_alias="showWindow",
        serialization_alias="showWindow",
    )
    new_tab: bool | None = Field(
        default=None,
        validation_alias="newTab",
        serialization_alias="newTab",
    )
    selector: str | None = Field(default=None, min_length=1)
    format: str | None = Field(default=None, min_length=1)

    @field_validator("url", mode="before")
    @classmethod
    def _validate_url(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="url",
            field_context="payload",
        )

    @field_validator("show_window", mode="before")
    @classmethod
    def _validate_show_window(cls, value: Any) -> bool | None:
        if value is None:
            return None
        return _require_boolean_field_value(
            value,
            field_name="showWindow",
            field_context="payload",
        )

    @field_validator("new_tab", mode="before")
    @classmethod
    def _validate_new_tab(cls, value: Any) -> bool | None:
        if value is None:
            return None
        return _require_boolean_field_value(
            value,
            field_name="newTab",
            field_context="payload",
        )

    @field_validator("selector", mode="before")
    @classmethod
    def _validate_selector(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="selector",
            field_context="payload",
        )

    @field_validator("format", mode="before")
    @classmethod
    def _validate_format(cls, value: Any) -> str | None:
        normalized = _normalize_optional_text_field_value(
            value,
            field_name="format",
            field_context="payload",
        )
        if normalized is not None and normalized not in {"text", "html", "markdown"}:
            raise ValueError("format must be one of: text, html, markdown")
        return normalized

    def to_bridge_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"url": self.url}
        if self.show_window is not None:
            payload["showWindow"] = self.show_window
        if self.new_tab is not None:
            payload["newTab"] = self.new_tab
        if self.selector is not None:
            payload["selector"] = self.selector
        if self.format is not None:
            payload["format"] = self.format
        return payload


class _BrowserScreenshotPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"name"}

    name: str | None = Field(default=None, min_length=1)

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="name",
            field_context="payload",
        )


class _BrowserListTabsPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = set()


class _BrowserCloseTabPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"tabId"}

    tab_id: str | None = Field(
        default=None,
        validation_alias="tabId",
        serialization_alias="tabId",
        min_length=1,
    )

    @field_validator("tab_id", mode="before")
    @classmethod
    def _validate_tab_id(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="tabId",
            field_context="payload",
        )

    def to_bridge_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if self.tab_id is not None:
            payload["tabId"] = self.tab_id
        return payload


class _BrowserSwitchTabPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"tabId"}

    tab_id: str = Field(
        validation_alias="tabId",
        serialization_alias="tabId",
        min_length=1,
    )

    @field_validator("tab_id", mode="before")
    @classmethod
    def _validate_tab_id(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="tabId",
            field_context="payload",
        )


class _BrowserExecutePayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"script", "tabId"}

    script: str = Field(min_length=1)
    tab_id: str | None = Field(
        default=None,
        validation_alias="tabId",
        serialization_alias="tabId",
        min_length=1,
    )

    @field_validator("script", mode="before")
    @classmethod
    def _validate_script(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="script",
            field_context="payload",
        )

    @field_validator("tab_id", mode="before")
    @classmethod
    def _validate_tab_id(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="tabId",
            field_context="payload",
        )

    def to_bridge_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"script": self.script}
        if self.tab_id is not None:
            payload["tabId"] = self.tab_id
        return payload


class _BrowserCookiesPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"tabId", "url"}

    tab_id: str | None = Field(
        default=None,
        validation_alias="tabId",
        serialization_alias="tabId",
        min_length=1,
    )
    url: str | None = Field(default=None, min_length=1)

    @field_validator("tab_id", mode="before")
    @classmethod
    def _validate_tab_id(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="tabId",
            field_context="payload",
        )

    @field_validator("url", mode="before")
    @classmethod
    def _validate_url(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="url",
            field_context="payload",
        )

    def to_bridge_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if self.tab_id is not None:
            payload["tabId"] = self.tab_id
        if self.url is not None:
            payload["url"] = self.url
        return payload


class _BrowserResetPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = set()


class _BrowserSnapshotPayload(_BridgePayloadModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"selector", "tabId"}

    selector: str | None = Field(default=None, min_length=1)
    tab_id: str | None = Field(
        default=None,
        validation_alias="tabId",
        serialization_alias="tabId",
        min_length=1,
    )

    @field_validator("selector", mode="before")
    @classmethod
    def _validate_selector(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="selector",
            field_context="payload",
        )

    @field_validator("tab_id", mode="before")
    @classmethod
    def _validate_tab_id(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="tabId",
            field_context="payload",
        )

    def to_bridge_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if self.selector is not None:
            payload["selector"] = self.selector
        if self.tab_id is not None:
            payload["tabId"] = self.tab_id
        return payload


class _BrowserPageResult(_BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "tabId",
        "currentUrl",
        "title",
        "windowVisible",
        "content",
    }

    tab_id: str = Field(validation_alias="tabId", serialization_alias="tabId", min_length=1)
    current_url: str = Field(validation_alias="currentUrl", serialization_alias="currentUrl")
    title: str | None = Field(default=None, min_length=1)
    window_visible: bool | None = Field(
        default=None,
        validation_alias="windowVisible",
        serialization_alias="windowVisible",
    )
    content: str | None = Field(default=None, min_length=0)

    @field_validator("tab_id", mode="before")
    @classmethod
    def _validate_tab_id(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="tabId",
            field_context="result",
        )

    @field_validator("current_url", mode="before")
    @classmethod
    def _validate_current_url(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="currentUrl",
            field_context="result",
        )

    @field_validator("title", mode="before")
    @classmethod
    def _validate_title(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="title",
            field_context="result",
        )

    @field_validator("window_visible", mode="before")
    @classmethod
    def _validate_window_visible(cls, value: Any) -> bool | None:
        if value is None:
            return None
        return _require_boolean_field_value(
            value,
            field_name="windowVisible",
            field_context="result",
        )

    def to_bridge_result(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "tabId": self.tab_id,
            "currentUrl": self.current_url,
        }
        if self.title is not None:
            payload["title"] = self.title
        if self.window_visible is not None:
            payload["windowVisible"] = self.window_visible
        if self.content is not None:
            payload["content"] = self.content
        return payload


class _BrowserScreenshotResult(_BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "tabId",
        "currentUrl",
        "title",
        "windowVisible",
        "artifactId",
        "uri",
        "name",
        "contentType",
        "metadata",
    }

    tab_id: str = Field(validation_alias="tabId", serialization_alias="tabId", min_length=1)
    current_url: str = Field(validation_alias="currentUrl", serialization_alias="currentUrl")
    title: str | None = Field(default=None, min_length=1)
    window_visible: bool | None = Field(
        default=None,
        validation_alias="windowVisible",
        serialization_alias="windowVisible",
    )
    artifact_id: str = Field(validation_alias="artifactId", serialization_alias="artifactId", min_length=1)
    uri: str | None = Field(default=None, min_length=1)
    name: str | None = Field(default=None, min_length=1)
    content_type: str | None = Field(
        default=None,
        validation_alias="contentType",
        serialization_alias="contentType",
        min_length=1,
    )
    metadata: dict[str, Any]

    @field_validator("tab_id", mode="before")
    @classmethod
    def _validate_tab_id(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="tabId",
            field_context="result",
        )

    @field_validator("current_url", mode="before")
    @classmethod
    def _validate_current_url(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="currentUrl",
            field_context="result",
        )

    @field_validator("title", mode="before")
    @classmethod
    def _validate_title(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="title",
            field_context="result",
        )

    @field_validator("window_visible", mode="before")
    @classmethod
    def _validate_window_visible(cls, value: Any) -> bool | None:
        if value is None:
            return None
        return _require_boolean_field_value(
            value,
            field_name="windowVisible",
            field_context="result",
        )

    @field_validator("artifact_id", mode="before")
    @classmethod
    def _validate_artifact_id(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="artifactId",
            field_context="result",
        )

    @field_validator("uri", mode="before")
    @classmethod
    def _validate_uri(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="uri",
            field_context="result",
        )

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="name",
            field_context="result",
        )

    @field_validator("content_type", mode="before")
    @classmethod
    def _validate_content_type(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="contentType",
            field_context="result",
        )

    @field_validator("metadata", mode="before")
    @classmethod
    def _validate_metadata(cls, value: Any) -> dict[str, Any]:
        return _require_mapping_field_value(
            value,
            field_name="metadata",
            field_context="result",
        )

    def to_bridge_result(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "tabId": self.tab_id,
            "currentUrl": self.current_url,
            "artifactId": self.artifact_id,
            "metadata": _normalize_mapping(self.metadata),
        }
        if self.title is not None:
            payload["title"] = self.title
        if self.window_visible is not None:
            payload["windowVisible"] = self.window_visible
        if self.uri is not None:
            payload["uri"] = self.uri
        if self.name is not None:
            payload["name"] = self.name
        if self.content_type is not None:
            payload["contentType"] = self.content_type
        return payload


class _BrowserListTabsResult(_BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"tabs"}

    tabs: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("tabs", mode="before")
    @classmethod
    def _validate_tabs(cls, value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            raise ValueError("tabs must be a list")
        validated: list[dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                validated.append({})
                continue
            if not isinstance(item.get("tabId"), str) or item["tabId"].strip() == "":
                raise ValueError("each tab must have a non-empty tabId")
            if not isinstance(item.get("currentUrl"), str):
                raise ValueError("each tab must have a currentUrl string")
            validated.append(item)
        return validated

    def to_bridge_result(self) -> dict[str, Any]:
        return {"tabs": self.tabs}


class _BrowserExecuteResult(_BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"result", "tabId"}

    result: Any = None
    tab_id: str | None = Field(
        default=None,
        validation_alias="tabId",
        serialization_alias="tabId",
        min_length=1,
    )

    @field_validator("tab_id", mode="before")
    @classmethod
    def _validate_tab_id(cls, value: Any) -> str | None:
        return _normalize_optional_text_field_value(
            value,
            field_name="tabId",
            field_context="result",
        )

    def to_bridge_result(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"result": self.result}
        if self.tab_id is not None:
            payload["tabId"] = self.tab_id
        return payload


class _BrowserCookiesResult(_BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "tabId",
        "currentUrl",
        "cookies",
    }

    tab_id: str = Field(validation_alias="tabId", serialization_alias="tabId", min_length=1)
    current_url: str = Field(validation_alias="currentUrl", serialization_alias="currentUrl")
    cookies: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("tab_id", mode="before")
    @classmethod
    def _validate_tab_id(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="tabId",
            field_context="result",
        )

    @field_validator("current_url", mode="before")
    @classmethod
    def _validate_current_url(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="currentUrl",
            field_context="result",
        )

    @field_validator("cookies", mode="before")
    @classmethod
    def _validate_cookies(cls, value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            raise ValueError("cookies must be a list")
        validated: list[dict[str, Any]] = []
        for item in value:
            if not isinstance(item, Mapping):
                raise ValueError("each cookie must be an object")
            name = _require_text_field_value(
                item.get("name"),
                field_name="name",
                field_context="cookie",
            )
            cookie_value = item.get("value")
            if not isinstance(cookie_value, str):
                raise ValueError("cookie field 'value' must be a string")
            cookie: dict[str, Any] = {"name": name, "value": cookie_value}
            for field_name in ("domain", "path", "sameSite"):
                field_value = item.get(field_name)
                if isinstance(field_value, str):
                    cookie[field_name] = field_value
            for field_name in ("secure", "httpOnly"):
                field_value = item.get(field_name)
                if isinstance(field_value, bool):
                    cookie[field_name] = field_value
            expiration_date = item.get("expirationDate")
            if expiration_date is None or (
                isinstance(expiration_date, (int, float))
                and not isinstance(expiration_date, bool)
            ):
                cookie["expirationDate"] = expiration_date
            validated.append(cookie)
        return validated

    def to_bridge_result(self) -> dict[str, Any]:
        return {
            "tabId": self.tab_id,
            "currentUrl": self.current_url,
            "cookies": [dict(item) for item in self.cookies],
        }


class _BrowserResetResult(_BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {"closedCount"}

    closed_count: int = Field(
        default=0,
        validation_alias="closedCount",
        serialization_alias="closedCount",
        ge=0,
    )

    @field_validator("closed_count", mode="before")
    @classmethod
    def _validate_closed_count(cls, value: Any) -> int:
        if isinstance(value, int):
            return max(0, value)
        raise ValueError("closedCount must be an integer")

    def to_bridge_result(self) -> dict[str, Any]:
        return {"closedCount": self.closed_count}


class _BrowserSnapshotResult(_BridgeResultModel):
    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "snapshot",
        "tabId",
        "elementCount",
        "interactiveCount",
    }

    snapshot: str = Field(default="", min_length=0)
    tab_id: str = Field(
        default="",
        validation_alias="tabId",
        serialization_alias="tabId",
        min_length=1,
    )
    element_count: int = Field(
        default=0,
        validation_alias="elementCount",
        serialization_alias="elementCount",
        ge=0,
    )
    interactive_count: int = Field(
        default=0,
        validation_alias="interactiveCount",
        serialization_alias="interactiveCount",
        ge=0,
    )

    @field_validator("snapshot", mode="before")
    @classmethod
    def _validate_snapshot(cls, value: Any) -> str:
        if isinstance(value, str):
            return value
        return str(value) if value is not None else ""

    @field_validator("tab_id", mode="before")
    @classmethod
    def _validate_tab_id(cls, value: Any) -> str:
        return _require_text_field_value(
            value,
            field_name="tabId",
            field_context="result",
        )

    @field_validator("element_count", mode="before")
    @classmethod
    def _validate_element_count(cls, value: Any) -> int:
        if isinstance(value, (int, float)):
            return max(0, int(value))
        raise ValueError("elementCount must be an integer")

    @field_validator("interactive_count", mode="before")
    @classmethod
    def _validate_interactive_count(cls, value: Any) -> int:
        if isinstance(value, (int, float)):
            return max(0, int(value))
        raise ValueError("interactiveCount must be an integer")

    def to_bridge_result(self) -> dict[str, Any]:
        return {
            "snapshot": self.snapshot,
            "tabId": self.tab_id,
            "elementCount": self.element_count,
            "interactiveCount": self.interactive_count,
        }


class DesktopCapabilityBridgeError(_DesktopCapabilityBridgeModel):
    """Stable error model returned by desktop capability bridge failures."""

    _bridge_field_name: ClassVar[str] = "error"

    code: DesktopCapabilityBridgeErrorCode
    message: str = Field(min_length=1)
    retryable: bool | None = None
    details: dict[str, Any] = Field(default_factory=dict)

    @field_validator("code", mode="before")
    @classmethod
    def _validate_code(cls, value: Any) -> DesktopCapabilityBridgeErrorCode:
        return _normalize_error_code(value)

    @field_validator("message", mode="before")
    @classmethod
    def _validate_message(cls, value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("message must be a string.")
        return _require_non_empty_text(value, field_name="message")

    @field_validator("retryable", mode="before")
    @classmethod
    def _validate_retryable(cls, value: Any) -> bool | None:
        if value is None:
            return None
        if not isinstance(value, bool):
            raise ValueError("retryable must be a boolean when provided.")
        return value

    @field_validator("details", mode="before")
    @classmethod
    def _validate_details(cls, value: Any) -> dict[str, Any]:
        if value is None:
            return {}
        return _require_mapping_field_value(
            value,
            field_name="details",
            field_context="error",
        )

    @model_validator(mode="after")
    def _default_retryable(self) -> Self:
        if self.retryable is None:
            object.__setattr__(
                self,
                "retryable",
                self.code in DESKTOP_CAPABILITY_BRIDGE_RETRYABLE_ERROR_CODES,
            )
        return self

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.details:
            payload["details"] = _normalize_mapping(self.details)
        return payload


class DesktopCapabilityBridgeRequest(_DesktopCapabilityBridgeModel):
    """Request envelope for explicit, white-listed desktop capability calls."""

    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "requestId",
        "request_id",
        "capability",
        "operation",
        "toolId",
        "tool_id",
        "runId",
        "run_id",
        "toolCallId",
        "tool_call_id",
        "payload",
    }
    _bridge_field_name: ClassVar[str] = "request"

    request_id: str = Field(validation_alias="requestId", min_length=1)
    capability: DesktopCapabilityName
    operation: DesktopCapabilityOperation
    tool_id: str = Field(validation_alias="toolId", min_length=1)
    run_id: str = Field(validation_alias="runId", min_length=1)
    tool_call_id: str = Field(validation_alias="toolCallId", min_length=1)
    payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("request_id", mode="before")
    @classmethod
    def _validate_request_id(cls, value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("request_id must be a string.")
        return _require_non_empty_text(value, field_name="request_id")

    @field_validator("capability", mode="before")
    @classmethod
    def _validate_capability(cls, value: Any) -> DesktopCapabilityName:
        return _normalize_capability_name(value)

    @field_validator("operation", mode="before")
    @classmethod
    def _validate_operation(cls, value: Any) -> DesktopCapabilityOperation:
        return _normalize_operation_name(value)

    @field_validator("tool_id", mode="before")
    @classmethod
    def _validate_tool_id(cls, value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("tool_id must be a string.")
        return _require_non_empty_text(value, field_name="tool_id")

    @field_validator("run_id", mode="before")
    @classmethod
    def _validate_run_id(cls, value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("run_id must be a string.")
        return _require_non_empty_text(value, field_name="run_id")

    @field_validator("tool_call_id", mode="before")
    @classmethod
    def _validate_tool_call_id(cls, value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("tool_call_id must be a string.")
        return _require_non_empty_text(value, field_name="tool_call_id")

    @field_validator("payload", mode="before")
    @classmethod
    def _validate_payload_mapping(cls, value: Any) -> dict[str, Any]:
        return _require_mapping_field_value(
            value,
            field_name="payload",
            field_context="request",
        )

    @model_validator(mode="after")
    def _validate_operation_payload(self) -> Self:
        normalized_capability, normalized_operation = _normalize_operation_key(
            self.capability,
            self.operation,
        )
        normalized_payload = validate_desktop_capability_bridge_payload(
            capability=normalized_capability,
            operation=normalized_operation,
            payload=self.payload,
        )
        object.__setattr__(self, "capability", normalized_capability)
        object.__setattr__(self, "operation", normalized_operation)
        object.__setattr__(self, "payload", normalized_payload)
        return self

    def to_dict(self) -> dict[str, Any]:
        return {
            "requestId": self.request_id,
            "capability": self.capability,
            "operation": self.operation,
            "toolId": self.tool_id,
            "runId": self.run_id,
            "toolCallId": self.tool_call_id,
            "payload": _normalize_mapping(self.payload),
        }


class DesktopCapabilityBridgeResponse(_DesktopCapabilityBridgeModel):
    """Response envelope for desktop capability bridge calls."""

    _bridge_allowed_fields: ClassVar[set[str] | None] = {
        "requestId",
        "request_id",
        "ok",
        "result",
        "error",
        "errorCode",
        "error_code",
        "errorMessage",
        "error_message",
        "errorRetryable",
        "error_retryable",
        "details",
        "error_details",
    }
    _bridge_field_name: ClassVar[str] = "response"

    request_id: str = Field(validation_alias="requestId", min_length=1)
    ok: bool
    result: dict[str, Any] | None = None
    error: DesktopCapabilityBridgeError | None = None
    error_code: DesktopCapabilityBridgeErrorCode | None = Field(
        default=None,
        validation_alias="errorCode",
        exclude=True,
    )
    error_message: str | None = Field(
        default=None,
        validation_alias="errorMessage",
        exclude=True,
    )
    error_retryable: bool | None = Field(
        default=None,
        validation_alias="errorRetryable",
        exclude=True,
    )
    error_details: dict[str, Any] | None = Field(
        default=None,
        validation_alias="details",
        exclude=True,
    )

    @field_validator("request_id", mode="before")
    @classmethod
    def _validate_request_id(cls, value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("request_id must be a string.")
        return _require_non_empty_text(value, field_name="request_id")

    @field_validator("ok", mode="before")
    @classmethod
    def _validate_ok(cls, value: Any) -> bool:
        if not isinstance(value, bool):
            raise ValueError("ok must be a boolean.")
        return value

    @field_validator("result", mode="before")
    @classmethod
    def _validate_result(cls, value: Any) -> dict[str, Any] | None:
        if value is None:
            return None
        return _require_mapping_field_value(
            value,
            field_name="result",
            field_context="response",
        )

    @field_validator("error_code", mode="before")
    @classmethod
    def _validate_error_code(
        cls, value: Any
    ) -> DesktopCapabilityBridgeErrorCode | None:
        if value is None:
            return None
        return _normalize_error_code(value)

    @field_validator("error_message", mode="before")
    @classmethod
    def _validate_error_message(cls, value: Any) -> str | None:
        return _normalize_optional_text(
            value,
            field_name="response field 'errorMessage'",
        )

    @field_validator("error_retryable", mode="before")
    @classmethod
    def _validate_error_retryable(cls, value: Any) -> bool | None:
        if value is None:
            return None
        if not isinstance(value, bool):
            raise ValueError("response field 'errorRetryable' must be a boolean.")
        return value

    @field_validator("error_details", mode="before")
    @classmethod
    def _validate_error_details(cls, value: Any) -> dict[str, Any] | None:
        if value is None:
            return None
        return _require_mapping_field_value(
            value,
            field_name="details",
            field_context="response",
        )

    @model_validator(mode="after")
    def _validate_response_invariants(self) -> Self:
        if self.error is None and (
            self.error_code is not None
            or self.error_message is not None
            or self.error_retryable is not None
            or self.error_details is not None
        ):
            if self.error_code is None or self.error_message is None:
                raise ValueError(
                    "Failed bridge responses must include an error payload."
                )
            object.__setattr__(
                self,
                "error",
                DesktopCapabilityBridgeError(
                    code=self.error_code,
                    message=self.error_message,
                    retryable=self.error_retryable,
                    details=self.error_details or {},
                ),
            )
        if self.ok and self.error is not None:
            raise ValueError(
                "Successful bridge responses cannot include an error payload."
            )
        if not self.ok and self.error is None:
            raise ValueError("Failed bridge responses must include an error payload.")
        if not self.ok and self.result is not None:
            raise ValueError("Failed bridge responses cannot include a result payload.")
        return self

    @classmethod
    def success(
        cls,
        *,
        request_id: str,
        result: Mapping[str, Any] | None = None,
    ) -> "DesktopCapabilityBridgeResponse":
        return cls(
            request_id=request_id,
            ok=True,
            result=None if result is None else _normalize_mapping(result),
        )

    @classmethod
    def failure(
        cls,
        *,
        request_id: str,
        error: DesktopCapabilityBridgeError,
    ) -> "DesktopCapabilityBridgeResponse":
        return cls(request_id=request_id, ok=False, error=error)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "requestId": self.request_id,
            "ok": self.ok,
        }
        if self.result is not None:
            payload["result"] = _normalize_mapping(self.result)
        if self.error is not None:
            payload["errorCode"] = self.error.code
            payload["errorMessage"] = self.error.message
            payload["errorRetryable"] = self.error.retryable
            payload["details"] = _normalize_mapping(self.error.details)
        return payload


_PAYLOAD_MODELS: dict[
    DesktopCapabilityBridgeOperationKey,
    type[_BridgePayloadModel],
] = {
    ("secret", "get_secret"): _SecretNamePayload,
    ("secret", "has_secret"): _SecretNamePayload,
    ("workspace", "resolve_path"): _ResolvePathPayload,
    ("database", "resolve_path"): _ResolvePathPayload,
    ("workspace", "ensure_directory"): _EnsureDirectoryPayload,
    ("artifact", "save_text"): _SaveTextPayload,
    ("artifact", "save_bytes"): _SaveBytesPayload,
    ("artifact", "describe_artifact"): _DescribeArtifactPayload,
    ("state", "get_value"): _StateAddressPayload,
    ("state", "put_value"): _StatePutValuePayload,
    ("state", "delete_value"): _StateAddressPayload,
    ("event", "emit_event"): _EmitEventPayload,
    ("mcp", "call_tool"): _McpToolCallPayload,
    ("browser", "open"): _BrowserPagePayload,
    ("browser", "screenshot"): _BrowserScreenshotPayload,
    ("browser", "list_tabs"): _BrowserListTabsPayload,
    ("browser", "close_tab"): _BrowserCloseTabPayload,
    ("browser", "switch_tab"): _BrowserSwitchTabPayload,
    ("browser", "execute"): _BrowserExecutePayload,
    ("browser", "cookies"): _BrowserCookiesPayload,
    ("browser", "reset"): _BrowserResetPayload,
    ("browser", "snapshot"): _BrowserSnapshotPayload,
}

_RESULT_MODELS: dict[
    DesktopCapabilityBridgeOperationKey,
    type[_BridgeResultModel],
] = {
    ("secret", "get_secret"): _GetSecretResult,
    ("secret", "has_secret"): _HasSecretResult,
    ("workspace", "resolve_path"): _PathResult,
    ("database", "resolve_path"): _PathResult,
    ("workspace", "ensure_directory"): _PathResult,
    ("artifact", "save_text"): _ArtifactDescriptorResult,
    ("artifact", "save_bytes"): _ArtifactDescriptorResult,
    ("artifact", "describe_artifact"): _ArtifactDescriptorResult,
    ("state", "get_value"): _StateGetValueResult,
    ("state", "put_value"): _EmptyResult,
    ("state", "delete_value"): _EmptyResult,
    ("event", "emit_event"): _EmptyResult,
    ("mcp", "call_tool"): _McpToolCallResult,
    ("browser", "open"): _BrowserPageResult,
    ("browser", "screenshot"): _BrowserScreenshotResult,
    ("browser", "list_tabs"): _BrowserListTabsResult,
    ("browser", "close_tab"): _BrowserPageResult,
    ("browser", "switch_tab"): _BrowserPageResult,
    ("browser", "execute"): _BrowserExecuteResult,
    ("browser", "cookies"): _BrowserCookiesResult,
    ("browser", "reset"): _BrowserResetResult,
    ("browser", "snapshot"): _BrowserSnapshotResult,
}


def get_desktop_capability_operations(
    capability: DesktopCapabilityName,
) -> tuple[DesktopCapabilityOperation, ...]:
    normalized_capability = _normalize_capability_name(capability)
    return DESKTOP_CAPABILITY_OPERATIONS_BY_CAPABILITY[normalized_capability]


def is_supported_desktop_capability_operation(
    *,
    capability: str,
    operation: str,
) -> bool:
    try:
        _normalize_operation_key(capability, operation)
    except ValueError:
        return False
    return True


def get_desktop_capability_bridge_request_payload_schema(
    *,
    capability: str,
    operation: str,
) -> dict[str, Any]:
    operation_key = _normalize_operation_key(capability, operation)
    return deepcopy(DESKTOP_CAPABILITY_BRIDGE_REQUEST_PAYLOAD_SCHEMAS[operation_key])


def get_desktop_capability_bridge_result_schema(
    *,
    capability: str,
    operation: str,
) -> dict[str, Any]:
    operation_key = _normalize_operation_key(capability, operation)
    return deepcopy(DESKTOP_CAPABILITY_BRIDGE_RESULT_SCHEMAS[operation_key])


def validate_desktop_capability_bridge_payload(
    *,
    capability: str,
    operation: str,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    operation_key = _normalize_operation_key(capability, operation)
    normalized_payload = _require_mapping(payload, field_name="payload")
    model_class = _PAYLOAD_MODELS[operation_key]
    try:
        payload_model = model_class.model_validate(normalized_payload)
    except ValidationError as exc:
        raise ValueError(_validation_error_to_message(exc)) from exc
    return payload_model.to_bridge_payload()


def validate_desktop_capability_bridge_result(
    *,
    capability: str,
    operation: str,
    result: Mapping[str, Any],
) -> dict[str, Any]:
    operation_key = _normalize_operation_key(capability, operation)
    normalized_result = _require_mapping(result, field_name="result")
    model_class = _RESULT_MODELS[operation_key]
    try:
        result_model = model_class.model_validate(normalized_result)
    except ValidationError as exc:
        raise ValueError(_validation_error_to_message(exc)) from exc
    return result_model.to_bridge_result()


__all__ = [
    "DESKTOP_CAPABILITY_BRIDGE_ERROR_CODES",
    "DESKTOP_CAPABILITY_BRIDGE_REQUEST_ENVELOPE_SCHEMA",
    "DESKTOP_CAPABILITY_BRIDGE_REQUEST_PAYLOAD_SCHEMAS",
    "DESKTOP_CAPABILITY_BRIDGE_RESPONSE_ENVELOPE_SCHEMA",
    "DESKTOP_CAPABILITY_BRIDGE_RESULT_SCHEMAS",
    "DESKTOP_CAPABILITY_BRIDGE_RETRYABLE_ERROR_CODES",
    "DESKTOP_CAPABILITY_NAMES",
    "DESKTOP_CAPABILITY_OPERATIONS",
    "DESKTOP_CAPABILITY_OPERATIONS_BY_CAPABILITY",
    "DESKTOP_CAPABILITY_STATE_SCOPES",
    "DesktopCapabilityArtifactDescriptor",
    "DesktopCapabilityBridgeError",
    "DesktopCapabilityBridgeErrorCode",
    "DesktopCapabilityBridgeOperationKey",
    "DesktopCapabilityBridgeRequest",
    "DesktopCapabilityBridgeResponse",
    "DesktopCapabilityName",
    "DesktopCapabilityOperation",
    "DesktopCapabilityStateScope",
    "get_desktop_capability_bridge_request_payload_schema",
    "get_desktop_capability_bridge_result_schema",
    "get_desktop_capability_operations",
    "is_supported_desktop_capability_operation",
    "validate_desktop_capability_bridge_payload",
    "validate_desktop_capability_bridge_result",
]

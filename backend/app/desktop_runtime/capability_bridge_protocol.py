"""Protocol contracts for the Desktop Capability Bridge."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Literal, cast

from app.tooling.contract.results import ToolArtifactReference

DesktopCapabilityName = Literal[
    "secret",
    "workspace",
    "artifact",
    "state",
    "event",
]

DESKTOP_CAPABILITY_NAMES: tuple[DesktopCapabilityName, ...] = (
    "secret",
    "workspace",
    "artifact",
    "state",
    "event",
)

DesktopCapabilityOperation = Literal[
    "get_secret",
    "has_secret",
    "resolve_path",
    "ensure_directory",
    "save_text",
    "save_bytes",
    "describe_artifact",
    "get_value",
    "put_value",
    "delete_value",
    "emit_event",
]

DESKTOP_CAPABILITY_OPERATIONS: tuple[DesktopCapabilityOperation, ...] = (
    "get_secret",
    "has_secret",
    "resolve_path",
    "ensure_directory",
    "save_text",
    "save_bytes",
    "describe_artifact",
    "get_value",
    "put_value",
    "delete_value",
    "emit_event",
)

DesktopCapabilityStateScope = Literal["tool", "run"]
DESKTOP_CAPABILITY_STATE_SCOPES: tuple[DesktopCapabilityStateScope, ...] = (
    "tool",
    "run",
)

DESKTOP_CAPABILITY_OPERATIONS_BY_CAPABILITY: dict[
    DesktopCapabilityName,
    tuple[DesktopCapabilityOperation, ...],
] = {
    "secret": ("get_secret", "has_secret"),
    "workspace": ("resolve_path", "ensure_directory"),
    "artifact": ("save_text", "save_bytes", "describe_artifact"),
    "state": ("get_value", "put_value", "delete_value"),
    "event": ("emit_event",),
}

DesktopCapabilityBridgeErrorCode = Literal[
    "invalid_request",
    "unsupported_capability",
    "unsupported_operation",
    "permission_denied",
    "not_found",
    "conflict",
    "payload_too_large",
    "temporarily_unavailable",
    "timeout",
    "internal_error",
]

DESKTOP_CAPABILITY_BRIDGE_ERROR_CODES: tuple[DesktopCapabilityBridgeErrorCode, ...] = (
    "invalid_request",
    "unsupported_capability",
    "unsupported_operation",
    "permission_denied",
    "not_found",
    "conflict",
    "payload_too_large",
    "temporarily_unavailable",
    "timeout",
    "internal_error",
)

DESKTOP_CAPABILITY_BRIDGE_RETRYABLE_ERROR_CODES = frozenset(
    {"temporarily_unavailable", "timeout"}
)

DesktopCapabilityBridgeOperationKey = tuple[
    DesktopCapabilityName,
    DesktopCapabilityOperation,
]

_ARTIFACT_DESCRIPTOR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["artifactId", "metadata"],
    "properties": {
        "artifactId": {"type": "string", "minLength": 1},
        "uri": {"type": "string", "minLength": 1},
        "name": {"type": "string", "minLength": 1},
        "contentType": {"type": "string", "minLength": 1},
        "metadata": {"type": "object"},
    },
}

DESKTOP_CAPABILITY_BRIDGE_REQUEST_ENVELOPE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "requestId",
        "capability",
        "operation",
        "toolId",
        "runId",
        "toolCallId",
        "payload",
    ],
    "properties": {
        "requestId": {"type": "string", "minLength": 1},
        "capability": {"enum": list(DESKTOP_CAPABILITY_NAMES)},
        "operation": {"enum": list(DESKTOP_CAPABILITY_OPERATIONS)},
        "toolId": {"type": "string", "minLength": 1},
        "runId": {"type": "string", "minLength": 1},
        "toolCallId": {"type": "string", "minLength": 1},
        "payload": {"type": "object"},
    },
}

DESKTOP_CAPABILITY_BRIDGE_RESPONSE_ENVELOPE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["requestId", "ok"],
    "properties": {
        "requestId": {"type": "string", "minLength": 1},
        "ok": {"type": "boolean"},
        "result": {"type": "object"},
        "errorCode": {"enum": list(DESKTOP_CAPABILITY_BRIDGE_ERROR_CODES)},
        "errorMessage": {"type": "string", "minLength": 1},
        "errorRetryable": {"type": "boolean"},
        "details": {"type": "object"},
    },
    "anyOf": [
        {
            "required": ["requestId", "ok"],
            "properties": {
                "ok": {"const": True},
            },
        },
        {
            "required": [
                "requestId",
                "ok",
                "errorCode",
                "errorMessage",
                "errorRetryable",
                "details",
            ],
            "properties": {
                "ok": {"const": False},
            },
        },
    ],
}

DESKTOP_CAPABILITY_BRIDGE_REQUEST_PAYLOAD_SCHEMAS: dict[
    DesktopCapabilityBridgeOperationKey,
    dict[str, Any],
] = {
    ("secret", "get_secret"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["secretName"],
        "properties": {
            "secretName": {"type": "string", "minLength": 1},
        },
    },
    ("secret", "has_secret"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["secretName"],
        "properties": {
            "secretName": {"type": "string", "minLength": 1},
        },
    },
    ("workspace", "resolve_path"): {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "relativePath": {"type": "string", "minLength": 1},
        },
    },
    ("workspace", "ensure_directory"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["relativePath"],
        "properties": {
            "relativePath": {"type": "string", "minLength": 1},
        },
    },
    ("artifact", "save_text"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["name", "text"],
        "properties": {
            "name": {"type": "string", "minLength": 1},
            "text": {"type": "string"},
            "contentType": {"type": "string", "minLength": 1},
            "metadata": {"type": "object"},
        },
    },
    ("artifact", "save_bytes"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["name", "contentBase64"],
        "properties": {
            "name": {"type": "string", "minLength": 1},
            "contentBase64": {"type": "string", "minLength": 1},
            "contentType": {"type": "string", "minLength": 1},
            "metadata": {"type": "object"},
        },
    },
    ("artifact", "describe_artifact"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["artifactId"],
        "properties": {
            "artifactId": {"type": "string", "minLength": 1},
        },
    },
    ("state", "get_value"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["scope", "key"],
        "properties": {
            "scope": {"enum": list(DESKTOP_CAPABILITY_STATE_SCOPES)},
            "key": {"type": "string", "minLength": 1},
        },
    },
    ("state", "put_value"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["scope", "key", "value"],
        "properties": {
            "scope": {"enum": list(DESKTOP_CAPABILITY_STATE_SCOPES)},
            "key": {"type": "string", "minLength": 1},
            "value": {"type": "object"},
        },
    },
    ("state", "delete_value"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["scope", "key"],
        "properties": {
            "scope": {"enum": list(DESKTOP_CAPABILITY_STATE_SCOPES)},
            "key": {"type": "string", "minLength": 1},
        },
    },
    ("event", "emit_event"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["eventType"],
        "properties": {
            "eventType": {"type": "string", "minLength": 1},
            "message": {"type": "string", "minLength": 1},
            "data": {"type": "object"},
        },
    },
}

DESKTOP_CAPABILITY_BRIDGE_RESULT_SCHEMAS: dict[
    DesktopCapabilityBridgeOperationKey,
    dict[str, Any],
] = {
    ("secret", "get_secret"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["value"],
        "properties": {
            "value": {"type": ["string", "null"]},
        },
    },
    ("secret", "has_secret"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["present"],
        "properties": {
            "present": {"type": "boolean"},
        },
    },
    ("workspace", "resolve_path"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["path"],
        "properties": {
            "path": {"type": "string", "minLength": 1},
        },
    },
    ("workspace", "ensure_directory"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["path"],
        "properties": {
            "path": {"type": "string", "minLength": 1},
        },
    },
    ("artifact", "save_text"): deepcopy(_ARTIFACT_DESCRIPTOR_SCHEMA),
    ("artifact", "save_bytes"): deepcopy(_ARTIFACT_DESCRIPTOR_SCHEMA),
    ("artifact", "describe_artifact"): deepcopy(_ARTIFACT_DESCRIPTOR_SCHEMA),
    ("state", "get_value"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["found", "value"],
        "properties": {
            "found": {"type": "boolean"},
            "value": {"type": ["object", "null"]},
        },
    },
    ("state", "put_value"): {
        "type": "object",
        "additionalProperties": False,
        "properties": {},
    },
    ("state", "delete_value"): {
        "type": "object",
        "additionalProperties": False,
        "properties": {},
    },
    ("event", "emit_event"): {
        "type": "object",
        "additionalProperties": False,
        "properties": {},
    },
}


def _normalize_mapping(value: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(value))



def _require_non_empty_text(value: str, *, field_name: str) -> str:
    normalized = value.strip()
    if normalized == "":
        raise ValueError(f"{field_name} must be a non-empty string.")
    return normalized



def _normalize_optional_text(value: Any, *, field_name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string when provided.")
    normalized = value.strip()
    return normalized or None



def _normalize_capability_name(value: str) -> DesktopCapabilityName:
    normalized = value.strip()
    if normalized not in DESKTOP_CAPABILITY_NAMES:
        raise ValueError(
            "Unknown desktop capability "
            f"'{value}'. Expected one of {', '.join(DESKTOP_CAPABILITY_NAMES)}."
        )
    return cast(DesktopCapabilityName, normalized)



def _normalize_operation_name(value: str) -> DesktopCapabilityOperation:
    normalized = value.strip()
    if normalized not in DESKTOP_CAPABILITY_OPERATIONS:
        raise ValueError(
            "Unknown desktop capability operation "
            f"'{value}'. Expected one of {', '.join(DESKTOP_CAPABILITY_OPERATIONS)}."
        )
    return cast(DesktopCapabilityOperation, normalized)



def _normalize_state_scope(value: str) -> DesktopCapabilityStateScope:
    normalized = value.strip()
    if normalized not in DESKTOP_CAPABILITY_STATE_SCOPES:
        raise ValueError(
            "Unknown desktop capability state scope "
            f"'{value}'. Expected one of {', '.join(DESKTOP_CAPABILITY_STATE_SCOPES)}."
        )
    return cast(DesktopCapabilityStateScope, normalized)



def _normalize_error_code(value: str) -> DesktopCapabilityBridgeErrorCode:
    normalized = value.strip()
    if normalized not in DESKTOP_CAPABILITY_BRIDGE_ERROR_CODES:
        raise ValueError(
            "Unknown desktop capability bridge error code "
            f"'{value}'. Expected one of "
            f"{', '.join(DESKTOP_CAPABILITY_BRIDGE_ERROR_CODES)}."
        )
    return cast(DesktopCapabilityBridgeErrorCode, normalized)



def _normalize_operation_key(
    capability: str,
    operation: str,
) -> DesktopCapabilityBridgeOperationKey:
    normalized_capability = _normalize_capability_name(capability)
    normalized_operation = _normalize_operation_name(operation)
    if normalized_operation not in DESKTOP_CAPABILITY_OPERATIONS_BY_CAPABILITY[
        normalized_capability
    ]:
        raise ValueError(
            f"Operation '{normalized_operation}' is not supported for capability "
            f"'{normalized_capability}'."
        )
    return normalized_capability, normalized_operation



def _require_mapping(value: Any, *, field_name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{field_name} must be an object mapping.")
    return value



def _assert_allowed_fields(
    value: Mapping[str, Any],
    *,
    allowed_fields: set[str],
    field_name: str,
) -> None:
    unexpected_fields = sorted(str(key) for key in value if key not in allowed_fields)
    if unexpected_fields:
        formatted = ", ".join(unexpected_fields)
        raise ValueError(f"{field_name} contains unsupported field(s): {formatted}.")



def _require_string_field(
    value: Mapping[str, Any],
    field_name: str,
    *,
    allow_empty: bool = False,
) -> str:
    raw_value = value.get(field_name)
    if not isinstance(raw_value, str):
        raise ValueError(f"payload field '{field_name}' must be a string.")
    if allow_empty:
        return raw_value
    return _require_non_empty_text(
        raw_value,
        field_name=f"payload field '{field_name}'",
    )



def _normalize_optional_text_field(
    value: Mapping[str, Any],
    field_name: str,
) -> str | None:
    return _normalize_optional_text(
        value.get(field_name),
        field_name=f"payload field '{field_name}'",
    )



def _normalize_optional_mapping_field(
    value: Mapping[str, Any],
    field_name: str,
) -> dict[str, Any] | None:
    raw_value = value.get(field_name)
    if raw_value is None:
        return None
    if not isinstance(raw_value, Mapping):
        raise ValueError(f"payload field '{field_name}' must be an object when provided.")
    return _normalize_mapping(raw_value)



def _require_mapping_field(value: Mapping[str, Any], field_name: str) -> dict[str, Any]:
    raw_value = value.get(field_name)
    if not isinstance(raw_value, Mapping):
        raise ValueError(f"payload field '{field_name}' must be an object mapping.")
    return _normalize_mapping(raw_value)



def _require_boolean_field(value: Mapping[str, Any], field_name: str) -> bool:
    raw_value = value.get(field_name)
    if not isinstance(raw_value, bool):
        raise ValueError(f"result field '{field_name}' must be a boolean.")
    return raw_value



def _require_state_scope_field(
    value: Mapping[str, Any],
    field_name: str,
) -> DesktopCapabilityStateScope:
    raw_value = value.get(field_name)
    if not isinstance(raw_value, str):
        raise ValueError(
            f"payload field '{field_name}' must be one of "
            f"{', '.join(DESKTOP_CAPABILITY_STATE_SCOPES)}."
        )
    return _normalize_state_scope(raw_value)



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

    if operation_key in {
        ("secret", "get_secret"),
        ("secret", "has_secret"),
    }:
        _assert_allowed_fields(
            normalized_payload,
            allowed_fields={"secretName"},
            field_name="payload",
        )
        return {
            "secretName": _require_string_field(normalized_payload, "secretName"),
        }

    if operation_key == ("workspace", "resolve_path"):
        _assert_allowed_fields(
            normalized_payload,
            allowed_fields={"relativePath"},
            field_name="payload",
        )
        relative_path = _normalize_optional_text_field(normalized_payload, "relativePath")
        return {} if relative_path is None else {"relativePath": relative_path}

    if operation_key == ("workspace", "ensure_directory"):
        _assert_allowed_fields(
            normalized_payload,
            allowed_fields={"relativePath"},
            field_name="payload",
        )
        return {
            "relativePath": _require_string_field(normalized_payload, "relativePath"),
        }

    if operation_key == ("artifact", "save_text"):
        _assert_allowed_fields(
            normalized_payload,
            allowed_fields={"name", "text", "contentType", "metadata"},
            field_name="payload",
        )
        result: dict[str, Any] = {
            "name": _require_string_field(normalized_payload, "name"),
            "text": _require_string_field(
                normalized_payload,
                "text",
                allow_empty=True,
            ),
        }
        content_type = _normalize_optional_text_field(normalized_payload, "contentType")
        metadata = _normalize_optional_mapping_field(normalized_payload, "metadata")
        if content_type is not None:
            result["contentType"] = content_type
        if metadata is not None:
            result["metadata"] = metadata
        return result

    if operation_key == ("artifact", "save_bytes"):
        _assert_allowed_fields(
            normalized_payload,
            allowed_fields={"name", "contentBase64", "contentType", "metadata"},
            field_name="payload",
        )
        result = {
            "name": _require_string_field(normalized_payload, "name"),
            "contentBase64": _require_string_field(
                normalized_payload,
                "contentBase64",
            ),
        }
        content_type = _normalize_optional_text_field(normalized_payload, "contentType")
        metadata = _normalize_optional_mapping_field(normalized_payload, "metadata")
        if content_type is not None:
            result["contentType"] = content_type
        if metadata is not None:
            result["metadata"] = metadata
        return result

    if operation_key == ("artifact", "describe_artifact"):
        _assert_allowed_fields(
            normalized_payload,
            allowed_fields={"artifactId"},
            field_name="payload",
        )
        return {
            "artifactId": _require_string_field(normalized_payload, "artifactId"),
        }

    if operation_key == ("state", "get_value"):
        _assert_allowed_fields(
            normalized_payload,
            allowed_fields={"scope", "key"},
            field_name="payload",
        )
        return {
            "scope": _require_state_scope_field(normalized_payload, "scope"),
            "key": _require_string_field(normalized_payload, "key"),
        }

    if operation_key == ("state", "put_value"):
        _assert_allowed_fields(
            normalized_payload,
            allowed_fields={"scope", "key", "value"},
            field_name="payload",
        )
        return {
            "scope": _require_state_scope_field(normalized_payload, "scope"),
            "key": _require_string_field(normalized_payload, "key"),
            "value": _require_mapping_field(normalized_payload, "value"),
        }

    if operation_key == ("state", "delete_value"):
        _assert_allowed_fields(
            normalized_payload,
            allowed_fields={"scope", "key"},
            field_name="payload",
        )
        return {
            "scope": _require_state_scope_field(normalized_payload, "scope"),
            "key": _require_string_field(normalized_payload, "key"),
        }

    if operation_key == ("event", "emit_event"):
        _assert_allowed_fields(
            normalized_payload,
            allowed_fields={"eventType", "message", "data"},
            field_name="payload",
        )
        result = {
            "eventType": _require_string_field(normalized_payload, "eventType"),
        }
        message = _normalize_optional_text_field(normalized_payload, "message")
        data = _normalize_optional_mapping_field(normalized_payload, "data")
        if message is not None:
            result["message"] = message
        if data is not None:
            result["data"] = data
        return result

    raise AssertionError(f"Unhandled desktop capability bridge operation {operation_key!r}.")



def validate_desktop_capability_bridge_result(
    *,
    capability: str,
    operation: str,
    result: Mapping[str, Any],
) -> dict[str, Any]:
    operation_key = _normalize_operation_key(capability, operation)
    normalized_result = _require_mapping(result, field_name="result")

    if operation_key == ("secret", "get_secret"):
        _assert_allowed_fields(
            normalized_result,
            allowed_fields={"value"},
            field_name="result",
        )
        value = normalized_result.get("value")
        if value is not None and not isinstance(value, str):
            raise ValueError("result field 'value' must be a string or null.")
        return {"value": value}

    if operation_key == ("secret", "has_secret"):
        _assert_allowed_fields(
            normalized_result,
            allowed_fields={"present"},
            field_name="result",
        )
        return {"present": _require_boolean_field(normalized_result, "present")}

    if operation_key in {
        ("workspace", "resolve_path"),
        ("workspace", "ensure_directory"),
    }:
        _assert_allowed_fields(
            normalized_result,
            allowed_fields={"path"},
            field_name="result",
        )
        return {"path": _require_string_field(normalized_result, "path")}

    if operation_key in {
        ("artifact", "save_text"),
        ("artifact", "save_bytes"),
        ("artifact", "describe_artifact"),
    }:
        descriptor = DesktopCapabilityArtifactDescriptor(
            artifact_id=_require_string_field(normalized_result, "artifactId"),
            uri=_normalize_optional_text_field(normalized_result, "uri"),
            name=_normalize_optional_text_field(normalized_result, "name"),
            content_type=_normalize_optional_text_field(normalized_result, "contentType"),
            metadata=_require_mapping_field(normalized_result, "metadata"),
        )
        _assert_allowed_fields(
            normalized_result,
            allowed_fields={"artifactId", "uri", "name", "contentType", "metadata"},
            field_name="result",
        )
        return descriptor.to_dict()

    if operation_key == ("state", "get_value"):
        _assert_allowed_fields(
            normalized_result,
            allowed_fields={"found", "value"},
            field_name="result",
        )
        found = _require_boolean_field(normalized_result, "found")
        value = normalized_result.get("value")
        if found:
            if not isinstance(value, Mapping):
                raise ValueError(
                    "result field 'value' must be an object when 'found' is true."
                )
            return {
                "found": True,
                "value": _normalize_mapping(value),
            }
        if value is not None:
            raise ValueError(
                "result field 'value' must be null when 'found' is false."
            )
        return {"found": False, "value": None}

    if operation_key in {
        ("state", "put_value"),
        ("state", "delete_value"),
        ("event", "emit_event"),
    }:
        _assert_allowed_fields(
            normalized_result,
            allowed_fields=set(),
            field_name="result",
        )
        return {}

    raise AssertionError(f"Unhandled desktop capability bridge operation {operation_key!r}.")


@dataclass(frozen=True, slots=True)
class DesktopCapabilityArtifactDescriptor:
    """Stable artifact descriptor shared by bridge responses and tool results."""

    artifact_id: str
    uri: str | None = None
    name: str | None = None
    content_type: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "artifact_id",
            _require_non_empty_text(self.artifact_id, field_name="artifact_id"),
        )
        object.__setattr__(
            self,
            "uri",
            _normalize_optional_text(self.uri, field_name="uri"),
        )
        object.__setattr__(
            self,
            "name",
            _normalize_optional_text(self.name, field_name="name"),
        )
        object.__setattr__(
            self,
            "content_type",
            _normalize_optional_text(self.content_type, field_name="content_type"),
        )
        object.__setattr__(self, "metadata", _normalize_mapping(self.metadata))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "artifactId": self.artifact_id,
            "metadata": _normalize_mapping(self.metadata),
        }
        if self.uri is not None:
            payload["uri"] = self.uri
        if self.name is not None:
            payload["name"] = self.name
        if self.content_type is not None:
            payload["contentType"] = self.content_type
        return payload

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


@dataclass(frozen=True, slots=True)
class DesktopCapabilityBridgeError:
    """Stable error model returned by desktop capability bridge failures."""

    code: DesktopCapabilityBridgeErrorCode
    message: str
    retryable: bool | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "code", _normalize_error_code(self.code))
        object.__setattr__(
            self,
            "message",
            _require_non_empty_text(self.message, field_name="message"),
        )
        resolved_retryable = self.retryable
        if resolved_retryable is None:
            resolved_retryable = (
                self.code in DESKTOP_CAPABILITY_BRIDGE_RETRYABLE_ERROR_CODES
            )
        object.__setattr__(self, "retryable", resolved_retryable)
        object.__setattr__(self, "details", _normalize_mapping(self.details))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.details:
            payload["details"] = _normalize_mapping(self.details)
        return payload


@dataclass(frozen=True, slots=True)
class DesktopCapabilityBridgeRequest:
    """Request envelope for explicit, white-listed desktop capability calls."""

    request_id: str
    capability: DesktopCapabilityName
    operation: DesktopCapabilityOperation
    tool_id: str
    run_id: str
    tool_call_id: str
    payload: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        normalized_capability, normalized_operation = _normalize_operation_key(
            self.capability,
            self.operation,
        )
        object.__setattr__(
            self,
            "request_id",
            _require_non_empty_text(self.request_id, field_name="request_id"),
        )
        object.__setattr__(self, "capability", normalized_capability)
        object.__setattr__(self, "operation", normalized_operation)
        object.__setattr__(
            self,
            "tool_id",
            _require_non_empty_text(self.tool_id, field_name="tool_id"),
        )
        object.__setattr__(
            self,
            "run_id",
            _require_non_empty_text(self.run_id, field_name="run_id"),
        )
        object.__setattr__(
            self,
            "tool_call_id",
            _require_non_empty_text(self.tool_call_id, field_name="tool_call_id"),
        )
        object.__setattr__(
            self,
            "payload",
            validate_desktop_capability_bridge_payload(
                capability=normalized_capability,
                operation=normalized_operation,
                payload=self.payload,
            ),
        )

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


@dataclass(frozen=True, slots=True)
class DesktopCapabilityBridgeResponse:
    """Response envelope for desktop capability bridge calls."""

    request_id: str
    ok: bool
    result: dict[str, Any] | None = None
    error: DesktopCapabilityBridgeError | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "request_id",
            _require_non_empty_text(self.request_id, field_name="request_id"),
        )
        if self.ok and self.error is not None:
            raise ValueError(
                "Successful bridge responses cannot include an error payload."
            )
        if not self.ok and self.error is None:
            raise ValueError(
                "Failed bridge responses must include an error payload."
            )
        if not self.ok and self.result is not None:
            raise ValueError(
                "Failed bridge responses cannot include a result payload."
            )
        if self.result is not None:
            object.__setattr__(self, "result", _normalize_mapping(self.result))

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

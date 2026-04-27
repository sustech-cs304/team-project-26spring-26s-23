"""Type aliases, constants, lookup tables, and JSON schemas for the Desktop Capability Bridge.

These are extracted from capability_bridge_protocol.py to keep the main module
focused on Pydantic model definitions and public API functions.
"""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from typing import Any, Literal

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

DesktopCapabilityName = Literal[
    "secret",
    "workspace",
    "database",
    "artifact",
    "state",
    "event",
    "mcp",
]

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
    "call_tool",
]

DesktopCapabilityStateScope = Literal["tool", "run"]

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

DesktopCapabilityBridgeOperationKey = tuple[
    DesktopCapabilityName,
    DesktopCapabilityOperation,
]

# ---------------------------------------------------------------------------
# Constant tuples
# ---------------------------------------------------------------------------

DESKTOP_CAPABILITY_NAMES: tuple[DesktopCapabilityName, ...] = (
    "secret",
    "workspace",
    "database",
    "artifact",
    "state",
    "event",
    "mcp",
)

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
    "call_tool",
)

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
    "database": ("resolve_path",),
    "artifact": ("save_text", "save_bytes", "describe_artifact"),
    "state": ("get_value", "put_value", "delete_value"),
    "event": ("emit_event",),
    "mcp": ("call_tool",),
}

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

# ---------------------------------------------------------------------------
# JSON schemas
# ---------------------------------------------------------------------------

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
    ("database", "resolve_path"): {
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
    ("mcp", "call_tool"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["serverId", "remoteToolName", "arguments"],
        "properties": {
            "serverId": {"type": "string", "minLength": 1},
            "remoteToolName": {"type": "string", "minLength": 1},
            "arguments": {"type": "object"},
            "snapshotRevision": {"type": "integer", "minimum": 0},
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
    ("database", "resolve_path"): {
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
    ("mcp", "call_tool"): {
        "type": "object",
        "additionalProperties": False,
        "required": ["ok", "toolId", "serverId", "remoteToolName"],
        "properties": {
            "ok": {"type": "boolean"},
            "toolId": {"type": "string", "minLength": 1},
            "serverId": {"type": "string", "minLength": 1},
            "remoteToolName": {"type": "string", "minLength": 1},
            "content": {"type": "array"},
            "structuredContent": {},
            "snapshotRevision": {"type": ["integer", "null"], "minimum": 0},
            "isError": {"const": False},
            "error": {
                "type": "object",
                "additionalProperties": False,
                "required": ["code", "message", "retryable"],
                "properties": {
                    "code": {"type": "string", "minLength": 1},
                    "message": {"type": "string", "minLength": 1},
                    "retryable": {"type": "boolean"},
                    "observedAt": {"type": "string", "minLength": 1},
                    "details": {"type": "object"},
                },
            },
        },
        "anyOf": [
            {
                "required": ["ok", "toolId", "serverId", "remoteToolName", "content"],
                "properties": {"ok": {"const": True}},
            },
            {
                "required": ["ok", "toolId", "serverId", "remoteToolName", "error"],
                "properties": {"ok": {"const": False}},
            },
        ],
    },
}


def _normalize_mapping(value: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(value))

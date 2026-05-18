"""Validation and normalization helpers for Desktop Capability Bridge payloads.

These pure functions are extracted from capability_bridge_protocol.py to keep
the main module focused on Pydantic model definitions.
"""

from __future__ import annotations

from typing import Any, Mapping, cast

from pydantic import BaseModel, ValidationError

from .constants import (
    DESKTOP_CAPABILITY_BRIDGE_ERROR_CODES,
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


def _require_non_empty_text(value: Any, *, field_name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string.")
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
    if not isinstance(value, str):
        raise ValueError("Desktop capability must be a string.")
    normalized = value.strip()
    if normalized not in DESKTOP_CAPABILITY_NAMES:
        raise ValueError(
            "Unknown desktop capability "
            f"'{value}'. Expected one of {', '.join(DESKTOP_CAPABILITY_NAMES)}."
        )
    return cast(DesktopCapabilityName, normalized)


def _normalize_operation_name(value: str) -> DesktopCapabilityOperation:
    if not isinstance(value, str):
        raise ValueError("Desktop capability operation must be a string.")
    normalized = value.strip()
    if normalized not in DESKTOP_CAPABILITY_OPERATIONS:
        raise ValueError(
            "Unknown desktop capability operation "
            f"'{value}'. Expected one of {', '.join(DESKTOP_CAPABILITY_OPERATIONS)}."
        )
    return cast(DesktopCapabilityOperation, normalized)


def _normalize_state_scope(value: str) -> DesktopCapabilityStateScope:
    if not isinstance(value, str):
        raise ValueError("Desktop capability state scope must be a string.")
    normalized = value.strip()
    if normalized not in DESKTOP_CAPABILITY_STATE_SCOPES:
        raise ValueError(
            "Unknown desktop capability state scope "
            f"'{value}'. Expected one of {', '.join(DESKTOP_CAPABILITY_STATE_SCOPES)}."
        )
    return cast(DesktopCapabilityStateScope, normalized)


def _normalize_error_code(value: str) -> DesktopCapabilityBridgeErrorCode:
    if not isinstance(value, str):
        raise ValueError("Desktop capability bridge error code must be a string.")
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
    if (
        normalized_operation
        not in DESKTOP_CAPABILITY_OPERATIONS_BY_CAPABILITY[normalized_capability]
    ):
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
    unexpected_fields = sorted(set(value.keys()) - allowed_fields)
    if unexpected_fields:
        raise ValueError(
            f"{field_name} has unexpected fields: {', '.join(unexpected_fields)}"
        )


def _validation_error_to_message(exc: ValidationError) -> str:
    errors = exc.errors()
    if errors:
        first_error = errors[0]
        context = first_error.get("ctx")
        if isinstance(context, dict):
            error = context.get("error")
            if error is not None:
                return str(error)
        message = first_error.get("msg")
        if isinstance(message, str):
            return message
    return str(exc)


def _require_text_field_value(
    value: Any,
    *,
    field_name: str,
    field_context: str,
    allow_empty: bool = False,
) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field_context} field '{field_name}' must be a string.")
    if allow_empty:
        return value
    return _require_non_empty_text(
        value,
        field_name=f"{field_context} field '{field_name}'",
    )


def _normalize_optional_text_field_value(
    value: Any,
    *,
    field_name: str,
    field_context: str,
) -> str | None:
    if value is None:
        return None
    return _normalize_optional_text(value, field_name=f"{field_context} field '{field_name}'")


def _normalize_optional_mapping_field_value(
    value: Any,
    *,
    field_name: str,
    field_context: str,
) -> dict[str, Any] | None:
    if value is None:
        return None
    return _normalize_mapping(
        _require_mapping(value, field_name=f"{field_context} field '{field_name}'")
    )


def _require_mapping_field_value(
    value: Any,
    *,
    field_name: str,
    field_context: str,
) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(
            f"{field_context} field '{field_name}' must be an object mapping."
        )
    return _normalize_mapping(value)


def _require_boolean_field_value(
    value: Any,
    *,
    field_name: str,
    field_context: str,
) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{field_context} field '{field_name}' must be a boolean.")
    return value


def _normalize_optional_boolean_field_value(
    value: Any,
    *,
    field_name: str,
    field_context: str,
) -> bool | None:
    if value is None:
        return None
    return _require_boolean_field_value(
        value,
        field_name=field_name,
        field_context=field_context,
    )


def _normalize_bridge_model_dict(
    value: BaseModel,
    *,
    exclude_none: bool = True,
) -> dict[str, Any]:
    return value.model_dump(by_alias=True, exclude_none=exclude_none)


def _artifact_descriptor_to_dict(
    *,
    artifact_id: str,
    uri: str | None,
    name: str | None,
    content_type: str | None,
    metadata: Mapping[str, Any],
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "artifactId": artifact_id,
        "metadata": _normalize_mapping(metadata),
    }
    if uri is not None:
        payload["uri"] = uri
    if name is not None:
        payload["name"] = name
    if content_type is not None:
        payload["contentType"] = content_type
    return payload

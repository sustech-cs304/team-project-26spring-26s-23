"""Executable builtin tool implementations for the Copilot runtime tool registry."""

from __future__ import annotations

import random
from collections.abc import Mapping
from pathlib import Path
from typing import Any, TypedDict

from .constants import DEFAULT_WEATHER_LOCATION, WEATHER_SAMPLE_RESULTS


async def execute_weather_current_tool(
    arguments: Mapping[str, Any] | None,
    *,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    raw_location = payload.get("location")
    location = (
        raw_location.strip()
        if isinstance(raw_location, str) and raw_location.strip() != ""
        else DEFAULT_WEATHER_LOCATION
    )
    selected_rng = rng or random.Random()  # nosec B311
    sample = selected_rng.choice(WEATHER_SAMPLE_RESULTS)
    return {
        "location": location,
        "condition": sample["condition"],
        "temperatureC": sample["temperatureC"],
        "humidity": sample["humidity"],
        "summary": sample["summary"],
    }


async def execute_default_weather_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    return await execute_weather_current_tool(arguments)


async def execute_request_user_form_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    raw_fields = payload.get("fields")
    if not isinstance(raw_fields, list) or len(raw_fields) == 0:
        raise ValueError("fields must be a non-empty array")

    form_request: dict[str, Any] = {
        "formId": _normalize_required_text_argument(
            payload.get("form_id"), field_name="form_id"
        ),
        "title": _normalize_required_text_argument(
            payload.get("title"), field_name="title"
        ),
        "fields": [_normalize_form_field(field) for field in raw_fields],
    }
    description = _normalize_optional_text_argument(payload.get("description"))
    submit_label = _normalize_optional_text_argument(payload.get("submit_label"))
    if description is not None:
        form_request["description"] = description
    if submit_label is not None:
        form_request["submitLabel"] = submit_label

    return {
        "summary": description or f"请填写表单：{form_request['title']}",
        "formRequest": form_request,
    }


def _normalize_optional_text_argument(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_required_text_argument(value: Any, *, field_name: str) -> str:
    normalized = _normalize_optional_text_argument(value)
    if normalized is None:
        raise ValueError(f"{field_name} must be a non-empty string")
    return normalized


def _normalize_form_field_option(value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise ValueError("field options must be objects")
    return {
        "value": _normalize_required_text_argument(
            value.get("value"), field_name="field.options[].value"
        ),
        "label": _normalize_required_text_argument(
            value.get("label"), field_name="field.options[].label"
        ),
    }


def _normalize_form_field(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("fields must contain only objects")
    field_type = _normalize_required_text_argument(
        value.get("type"), field_name="field.type"
    )
    if field_type not in {"text", "textarea", "number", "select", "checkbox"}:
        raise ValueError(
            "field.type must be one of text, textarea, number, select, checkbox"
        )

    normalized: dict[str, Any] = {
        "name": _normalize_required_text_argument(
            value.get("name"), field_name="field.name"
        ),
        "label": _normalize_required_text_argument(
            value.get("label"), field_name="field.label"
        ),
        "type": field_type,
    }
    description = _normalize_optional_text_argument(value.get("description"))
    placeholder = _normalize_optional_text_argument(value.get("placeholder"))
    if description is not None:
        normalized["description"] = description
    if placeholder is not None:
        normalized["placeholder"] = placeholder
    if isinstance(value.get("required"), bool):
        normalized["required"] = value.get("required")
    if field_type == "select":
        options = value.get("options")
        if not isinstance(options, list) or len(options) == 0:
            raise ValueError("select fields require a non-empty options array")
        normalized["options"] = [
            _normalize_form_field_option(option) for option in options
        ]
    elif "options" in value:
        raise ValueError("checkbox fields do not support options")
    return normalized

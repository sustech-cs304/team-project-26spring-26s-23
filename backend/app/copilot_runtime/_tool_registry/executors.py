"""Executable builtin tool implementations for the Copilot runtime tool registry."""

from __future__ import annotations

import asyncio
import locale
import random
from collections.abc import Mapping
from pathlib import Path
from typing import Any, TypedDict

from app.tools.file_convert import convert_file_to_str

from .constants import DEFAULT_WEATHER_LOCATION, WEATHER_SAMPLE_RESULTS


class FileConvertToolResult(TypedDict, total=False):
    path: str
    suffix: str
    content: str
    notice: str


async def execute_default_file_convert_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    file_path = payload.get("path")
    if not isinstance(file_path, str) or file_path.strip() == "":
        raise ValueError("path must be a non-empty string")
    normalized: FileConvertToolResult = {
        "path": file_path,
        "suffix": Path(file_path).suffix.lower(),
        "content": convert_file_to_str(file_path),
    }
    return dict(normalized)


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


async def execute_command_run_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    raw_program = payload.get("program")
    if not isinstance(raw_program, str) or raw_program.strip() == "":
        raise ValueError("program must be a non-empty string")
    program = raw_program.strip()

    raw_args = payload.get("args", [])
    if raw_args is None:
        raw_args = []
    if not isinstance(raw_args, list):
        raise ValueError("args must be an array of strings")
    args: list[str] = []
    for value in raw_args:
        if not isinstance(value, str):
            raise ValueError("args must be an array of strings")
        args.append(value)

    raw_cwd = payload.get("cwd")
    cwd = raw_cwd.strip() if isinstance(raw_cwd, str) and raw_cwd.strip() != "" else None
    resolved_cwd: str | None = None
    if cwd is not None:
        cwd_path = Path(cwd)
        if cwd_path.is_absolute():
            raise ValueError("cwd must be a relative path")
        base_dir = Path.cwd().resolve(strict=False)
        resolved_path = (base_dir / cwd_path).resolve(strict=False)
        if base_dir != resolved_path and base_dir not in resolved_path.parents:
            raise ValueError("cwd must be within the backend working directory")
        resolved_cwd = str(resolved_path)

    timeout_seconds = payload.get("timeoutSeconds")
    if timeout_seconds is None:
        resolved_timeout_seconds = 30
    elif isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, (int, float)):
        raise ValueError("timeoutSeconds must be a positive integer")
    else:
        resolved_timeout_seconds = int(timeout_seconds)
    if resolved_timeout_seconds <= 0:
        raise ValueError("timeoutSeconds must be a positive integer")
    if resolved_timeout_seconds > 300:
        resolved_timeout_seconds = 300

    max_output_chars = payload.get("maxOutputChars")
    if max_output_chars is None:
        resolved_max_output_chars = 20000
    elif isinstance(max_output_chars, bool) or not isinstance(max_output_chars, (int, float)):
        raise ValueError("maxOutputChars must be a positive integer")
    else:
        resolved_max_output_chars = int(max_output_chars)
    if resolved_max_output_chars <= 0:
        raise ValueError("maxOutputChars must be a positive integer")
    if resolved_max_output_chars > 200000:
        resolved_max_output_chars = 200000

    max_output_bytes = resolved_max_output_chars * 4
    proc = await asyncio.create_subprocess_exec(
        program,
        *args,
        cwd=resolved_cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    async def read_stream_limited(
        stream: asyncio.StreamReader | None,
        *,
        limit_bytes: int,
    ) -> tuple[bytes, bool]:
        if stream is None:
            return b"", False
        buffer = bytearray()
        truncated = False
        while True:
            chunk = await stream.read(4096)
            if not chunk:
                break
            remaining = limit_bytes - len(buffer)
            if remaining > 0:
                buffer.extend(chunk[:remaining])
                if len(chunk) > remaining:
                    truncated = True
            else:
                truncated = True
        return bytes(buffer), truncated

    stdout_task = asyncio.create_task(
        read_stream_limited(proc.stdout, limit_bytes=max_output_bytes)
    )
    stderr_task = asyncio.create_task(
        read_stream_limited(proc.stderr, limit_bytes=max_output_bytes)
    )

    timed_out = False
    try:
        await asyncio.wait_for(proc.wait(), timeout=resolved_timeout_seconds)
    except asyncio.TimeoutError:
        timed_out = True
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=2)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()

    stdout_bytes, stdout_truncated = await stdout_task
    stderr_bytes, stderr_truncated = await stderr_task

    def decode_output(data: bytes) -> str:
        if not data:
            return ""
        try:
            return data.decode("utf-8", errors="replace")
        except Exception:
            encoding = locale.getpreferredencoding(False) or "utf-8"
            return data.decode(encoding, errors="replace")

    return {
        "program": program,
        "args": args,
        "cwd": resolved_cwd,
        "timeoutSeconds": resolved_timeout_seconds,
        "timedOut": timed_out,
        "exitCode": proc.returncode,
        "stdout": decode_output(stdout_bytes),
        "stderr": decode_output(stderr_bytes),
        "truncated": bool(stdout_truncated or stderr_truncated),
        "maxOutputChars": resolved_max_output_chars,
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

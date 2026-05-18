"""Executable builtin tool implementations for the Copilot runtime tool registry."""

from __future__ import annotations

import asyncio
import locale
import random
import shutil
import sys
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
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


async def execute_shell_run_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    raw_command = payload.get("command")
    if not isinstance(raw_command, str) or raw_command.strip() == "":
        raise ValueError("command must be a non-empty string")
    command = raw_command.strip()

    raw_shell = payload.get("shell")
    shell = raw_shell.strip().lower() if isinstance(raw_shell, str) else "auto"
    if shell == "":
        shell = "auto"
    if shell not in {"auto", "pwsh", "cmd", "bash", "sh"}:
        raise ValueError("shell must be one of auto, pwsh, cmd, bash, sh")

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

    resolved_shell = shell
    if resolved_shell == "auto":
        if sys.platform.startswith("win"):
            resolved_shell = "pwsh" if shutil.which("pwsh") else "cmd"
        else:
            resolved_shell = "bash" if shutil.which("bash") else "sh"

    if resolved_shell == "pwsh":
        program = shutil.which("pwsh") or "pwsh"
        argv = [program, "-NoProfile", "-NonInteractive", "-Command", command]
    elif resolved_shell == "cmd":
        program = shutil.which("cmd") or "cmd"
        argv = [program, "/d", "/s", "/c", command]
    elif resolved_shell == "bash":
        program = shutil.which("bash") or "bash"
        argv = [program, "-lc", command]
    else:
        program = shutil.which("sh") or "sh"
        argv = [program, "-lc", command]

    max_output_bytes = resolved_max_output_chars * 4
    proc = await asyncio.create_subprocess_exec(
        *argv,
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
        "shell": resolved_shell,
        "command": command,
        "cwd": resolved_cwd,
        "timeoutSeconds": resolved_timeout_seconds,
        "timedOut": timed_out,
        "exitCode": proc.returncode,
        "stdout": decode_output(stdout_bytes),
        "stderr": decode_output(stderr_bytes),
        "truncated": bool(stdout_truncated or stderr_truncated),
        "maxOutputChars": resolved_max_output_chars,
    }


@dataclass(slots=True)
class _ShellSession:
    session_id: str
    shell: str
    proc: asyncio.subprocess.Process
    created_at: datetime
    last_used_at: datetime
    lock: asyncio.Lock


_SHELL_SESSIONS: dict[str, _ShellSession] = {}
_SHELL_SESSIONS_MAX_COUNT = 16
_SHELL_SESSIONS_IDLE_TIMEOUT = timedelta(minutes=10)


def _cleanup_shell_sessions(now: datetime) -> None:
    expired: list[str] = []
    for session_id, session in _SHELL_SESSIONS.items():
        if session.proc.returncode is not None:
            expired.append(session_id)
            continue
        if now - session.last_used_at > _SHELL_SESSIONS_IDLE_TIMEOUT:
            expired.append(session_id)
    for session_id in expired:
        session = _SHELL_SESSIONS.pop(session_id, None)
        if session is None:
            continue
        try:
            session.proc.terminate()
        except ProcessLookupError:
            pass


def _resolve_shell_for_session(shell: str) -> str:
    if shell == "auto":
        if sys.platform.startswith("win"):
            return "pwsh" if shutil.which("pwsh") else "cmd"
        return "bash" if shutil.which("bash") else "sh"
    return shell


def _build_session_argv(resolved_shell: str) -> list[str]:
    if resolved_shell == "pwsh":
        program = shutil.which("pwsh") or "pwsh"
        return [program, "-NoLogo", "-NoProfile"]
    if resolved_shell == "cmd":
        program = shutil.which("cmd") or "cmd"
        return [program, "/Q"]
    if resolved_shell == "bash":
        program = shutil.which("bash") or "bash"
        return [program, "--noprofile", "--norc"]
    program = shutil.which("sh") or "sh"
    return [program]


async def _read_available_output(
    stream: asyncio.StreamReader | None,
    *,
    limit_bytes: int,
    max_wait_seconds: float,
) -> tuple[bytes, bool]:
    if stream is None:
        return b"", False
    buffer = bytearray()
    truncated = False
    deadline = asyncio.get_running_loop().time() + max_wait_seconds
    while True:
        remaining_wait = deadline - asyncio.get_running_loop().time()
        if remaining_wait <= 0:
            break
        try:
            chunk = await asyncio.wait_for(stream.read(4096), timeout=min(0.2, remaining_wait))
        except asyncio.TimeoutError:
            break
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


def _decode_output(data: bytes) -> str:
    if not data:
        return ""
    try:
        return data.decode("utf-8", errors="replace")
    except Exception:
        encoding = locale.getpreferredencoding(False) or "utf-8"
        return data.decode(encoding, errors="replace")


async def execute_shell_session_start_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    raw_shell = payload.get("shell")
    shell = raw_shell.strip().lower() if isinstance(raw_shell, str) else "auto"
    if shell == "":
        shell = "auto"
    if shell not in {"auto", "pwsh", "cmd", "bash", "sh"}:
        raise ValueError("shell must be one of auto, pwsh, cmd, bash, sh")

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

    now = datetime.now(UTC)
    _cleanup_shell_sessions(now)
    if len(_SHELL_SESSIONS) >= _SHELL_SESSIONS_MAX_COUNT:
        raise RuntimeError("Too many active shell sessions")

    resolved_shell = _resolve_shell_for_session(shell)
    argv = _build_session_argv(resolved_shell)
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=resolved_cwd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    session_id = str(uuid.uuid4())
    session = _ShellSession(
        session_id=session_id,
        shell=resolved_shell,
        proc=proc,
        created_at=now,
        last_used_at=now,
        lock=asyncio.Lock(),
    )
    _SHELL_SESSIONS[session_id] = session
    stdout_bytes, stdout_truncated = await _read_available_output(
        proc.stdout, limit_bytes=4000, max_wait_seconds=0.2
    )
    stderr_bytes, stderr_truncated = await _read_available_output(
        proc.stderr, limit_bytes=4000, max_wait_seconds=0.2
    )
    return {
        "sessionId": session_id,
        "shell": resolved_shell,
        "cwd": resolved_cwd,
        "started": True,
        "stdout": _decode_output(stdout_bytes),
        "stderr": _decode_output(stderr_bytes),
        "truncated": bool(stdout_truncated or stderr_truncated),
    }


async def execute_shell_session_exec_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    raw_session_id = payload.get("sessionId")
    if not isinstance(raw_session_id, str) or raw_session_id.strip() == "":
        raise ValueError("sessionId must be a non-empty string")
    session_id = raw_session_id.strip()
    session = _SHELL_SESSIONS.get(session_id)
    if session is None:
        raise LookupError("shell session not found")

    raw_input = payload.get("input")
    if not isinstance(raw_input, str):
        raise ValueError("input must be a string")
    input_text = raw_input
    if input_text == "":
        raise ValueError("input must be a non-empty string")
    if not input_text.endswith("\n"):
        input_text += "\n"

    timeout_seconds = payload.get("timeoutSeconds")
    if timeout_seconds is None:
        resolved_timeout_seconds = 5
    elif isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, (int, float)):
        raise ValueError("timeoutSeconds must be a positive integer")
    else:
        resolved_timeout_seconds = int(timeout_seconds)
    if resolved_timeout_seconds <= 0:
        raise ValueError("timeoutSeconds must be a positive integer")
    if resolved_timeout_seconds > 60:
        resolved_timeout_seconds = 60

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
    now = datetime.now(UTC)
    _cleanup_shell_sessions(now)
    session.last_used_at = now

    async with session.lock:
        proc = session.proc
        if proc.returncode is not None:
            return {
                "sessionId": session_id,
                "shell": session.shell,
                "closed": True,
                "exitCode": proc.returncode,
                "stdout": "",
                "stderr": "",
                "truncated": False,
            }
        if proc.stdin is None:
            raise RuntimeError("shell session stdin is not available")
        proc.stdin.write(input_text.encode("utf-8", errors="replace"))
        await proc.stdin.drain()

        stdout_bytes, stdout_truncated = await _read_available_output(
            proc.stdout,
            limit_bytes=max_output_bytes,
            max_wait_seconds=float(resolved_timeout_seconds),
        )
        stderr_bytes, stderr_truncated = await _read_available_output(
            proc.stderr,
            limit_bytes=max_output_bytes,
            max_wait_seconds=0.2,
        )
        closed = proc.returncode is not None
        return {
            "sessionId": session_id,
            "shell": session.shell,
            "closed": closed,
            "exitCode": proc.returncode,
            "stdout": _decode_output(stdout_bytes),
            "stderr": _decode_output(stderr_bytes),
            "truncated": bool(stdout_truncated or stderr_truncated),
            "timeoutSeconds": resolved_timeout_seconds,
            "maxOutputChars": resolved_max_output_chars,
        }


async def execute_shell_session_close_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    raw_session_id = payload.get("sessionId")
    if not isinstance(raw_session_id, str) or raw_session_id.strip() == "":
        raise ValueError("sessionId must be a non-empty string")
    session_id = raw_session_id.strip()
    session = _SHELL_SESSIONS.pop(session_id, None)
    if session is None:
        return {"sessionId": session_id, "closed": True, "alreadyClosed": True}
    proc = session.proc
    if proc.returncode is None:
        try:
            proc.terminate()
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(proc.wait(), timeout=2)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
    return {
        "sessionId": session_id,
        "closed": True,
        "alreadyClosed": False,
        "exitCode": proc.returncode,
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

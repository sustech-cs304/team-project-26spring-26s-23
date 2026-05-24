"""Executable builtin tool implementations for the Copilot runtime tool registry."""

from __future__ import annotations

import asyncio
import locale
import os
import random
import shutil
import signal
import subprocess
import sys
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

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
        resolved_timeout_seconds = 300
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

    stdout_bytes, stderr_bytes, timed_out, stdout_truncated, stderr_truncated = (
        await _collect_process_output_until_exit_or_inactivity(
            proc,
            inactivity_timeout_seconds=float(resolved_timeout_seconds),
            limit_bytes=max_output_bytes,
        )
    )

    return {
        "shell": resolved_shell,
        "command": command,
        "cwd": resolved_cwd,
        "timeoutSeconds": resolved_timeout_seconds,
        "timedOut": timed_out,
        "exitCode": proc.returncode,
        "stdout": _decode_output(stdout_bytes),
        "stderr": _decode_output(stderr_bytes),
        "truncated": bool(stdout_truncated or stderr_truncated),
        "maxOutputChars": resolved_max_output_chars,
    }


@dataclass(slots=True)
class _ShellSession:
    session_id: str
    shell: str
    proc: asyncio.subprocess.Process
    created_at: datetime
    recycle_at: datetime
    recycle_timeout_seconds: int
    lock: asyncio.Lock
    stdout_buffer: bytearray
    stderr_buffer: bytearray
    output_event: asyncio.Event
    stdout_task: asyncio.Task[None] | None
    stderr_task: asyncio.Task[None] | None


_SHELL_SESSIONS: dict[str, _ShellSession] = {}
_SHELL_SESSIONS_MAX_COUNT = 16


def _cleanup_shell_sessions(now: datetime) -> None:
    expired: list[str] = []
    for session_id, session in _SHELL_SESSIONS.items():
        if session.proc.returncode is not None:
            expired.append(session_id)
            continue
        if now >= session.recycle_at:
            expired.append(session_id)
    for session_id in expired:
        session = _SHELL_SESSIONS.pop(session_id, None)
        if session is None:
            continue
        _request_shell_session_termination(session.proc)
        _cancel_shell_session_output_tasks(session)


async def _pump_shell_session_output(
    stream: asyncio.StreamReader | None,
    buffer: bytearray,
    output_event: asyncio.Event,
) -> None:
    if stream is None:
        output_event.set()
        return
    try:
        while True:
            chunk = await stream.read(4096)
            if not chunk:
                break
            buffer.extend(chunk)
            output_event.set()
    finally:
        output_event.set()


def _cancel_shell_session_output_tasks(session: _ShellSession) -> None:
    for task in (session.stdout_task, session.stderr_task):
        if task is not None and not task.done():
            task.cancel()


async def _finish_shell_session_output_tasks(session: _ShellSession) -> None:
    tasks = [
        task
        for task in (session.stdout_task, session.stderr_task)
        if task is not None and not task.done()
    ]
    if not tasks:
        return
    try:
        await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout=1)
    except asyncio.TimeoutError:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def _drain_shell_session_output(session: _ShellSession) -> tuple[bytes, bytes]:
    stdout = bytes(session.stdout_buffer)
    stderr = bytes(session.stderr_buffer)
    session.stdout_buffer.clear()
    session.stderr_buffer.clear()
    if not session.stdout_buffer and not session.stderr_buffer:
        session.output_event.clear()
    return stdout, stderr


def _append_limited_output(target: bytearray, chunk: bytes, *, limit_bytes: int) -> bool:
    remaining = limit_bytes - len(target)
    if remaining > 0:
        target.extend(chunk[:remaining])
        return len(chunk) > remaining
    return bool(chunk)


def _build_shell_session_subprocess_kwargs() -> dict[str, Any]:
    if sys.platform.startswith("win"):
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def _send_shell_session_signal(proc: asyncio.subprocess.Process, sig: int) -> None:
    if proc.returncode is not None:
        return
    try:
        if sys.platform.startswith("win"):
            proc.send_signal(sig)
            return
        killpg = getattr(os, "killpg", None)
        if callable(killpg) and proc.pid is not None:
            killpg(proc.pid, sig)
    except (ProcessLookupError, ValueError, OSError):
        pass


def _request_shell_session_interrupt(proc: asyncio.subprocess.Process) -> None:
    if sys.platform.startswith("win"):
        break_signal = getattr(signal, "CTRL_BREAK_EVENT", None)
        if isinstance(break_signal, int):
            _send_shell_session_signal(proc, break_signal)
            return
    _send_shell_session_signal(proc, signal.SIGINT)


def _request_shell_session_termination(proc: asyncio.subprocess.Process) -> None:
    if sys.platform.startswith("win"):
        try:
            proc.terminate()
        except ProcessLookupError:
            pass
        return
    _send_shell_session_signal(proc, signal.SIGTERM)


async def _terminate_shell_session_process(
    proc: asyncio.subprocess.Process,
    *,
    interrupt_first: bool,
) -> None:
    if proc.returncode is not None:
        return
    if interrupt_first:
        _request_shell_session_interrupt(proc)
        try:
            await asyncio.wait_for(proc.wait(), timeout=1)
        except asyncio.TimeoutError:
            pass
    if proc.returncode is not None:
        return
    _request_shell_session_termination(proc)
    try:
        await asyncio.wait_for(proc.wait(), timeout=2)
    except asyncio.TimeoutError:
        if sys.platform.startswith("win"):
            proc.kill()
        else:
            kill_signal = cast(int, getattr(signal, "SIGKILL", signal.SIGTERM))
            _send_shell_session_signal(proc, kill_signal)
        await proc.wait()


async def _terminate_shell_session(
    session_id: str,
    session: _ShellSession,
    *,
    interrupt_first: bool,
) -> None:
    if _SHELL_SESSIONS.get(session_id) is session:
        _SHELL_SESSIONS.pop(session_id, None)
    await _terminate_shell_session_process(
        session.proc,
        interrupt_first=interrupt_first,
    )
    await _finish_shell_session_output_tasks(session)


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



async def _read_shell_session_output_until_marker(
    session: _ShellSession,
    *,
    marker: bytes,
    limit_bytes: int,
    timeout_seconds: float,
) -> tuple[bytes, bytes, bool, bool, bool, bool]:
    stdout_buffer = bytearray()
    stderr_buffer = bytearray()
    pending_stdout = bytearray()
    stdout_truncated = False
    stderr_truncated = False
    marker_found = False
    timed_out = False
    marker_keep_bytes = max(0, len(marker) - 1)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds

    while True:
        stdout_chunk, stderr_chunk = _drain_shell_session_output(session)
        if stdout_chunk:
            if marker:
                pending_stdout.extend(stdout_chunk)
                marker_index = pending_stdout.find(marker)
                if marker_index >= 0:
                    stdout_truncated = _append_limited_output(
                        stdout_buffer,
                        bytes(pending_stdout[:marker_index]),
                        limit_bytes=limit_bytes,
                    ) or stdout_truncated
                    pending_stdout.clear()
                    marker_found = True
                else:
                    commit_length = max(0, len(pending_stdout) - marker_keep_bytes)
                    if commit_length > 0:
                        stdout_truncated = _append_limited_output(
                            stdout_buffer,
                            bytes(pending_stdout[:commit_length]),
                            limit_bytes=limit_bytes,
                        ) or stdout_truncated
                        del pending_stdout[:commit_length]
            else:
                stdout_truncated = _append_limited_output(
                    stdout_buffer,
                    stdout_chunk,
                    limit_bytes=limit_bytes,
                ) or stdout_truncated
        if stderr_chunk:
            stderr_truncated = _append_limited_output(
                stderr_buffer,
                stderr_chunk,
                limit_bytes=limit_bytes,
            ) or stderr_truncated

        if marker_found:
            break
        if marker == b"" and session.proc.returncode is not None:
            stdout_tail, stderr_tail = _drain_shell_session_output(session)
            if stdout_tail:
                stdout_truncated = _append_limited_output(
                    stdout_buffer,
                    stdout_tail,
                    limit_bytes=limit_bytes,
                ) or stdout_truncated
            if stderr_tail:
                stderr_truncated = _append_limited_output(
                    stderr_buffer,
                    stderr_tail,
                    limit_bytes=limit_bytes,
                ) or stderr_truncated
            break

        remaining_wait = deadline - loop.time()
        if remaining_wait <= 0:
            timed_out = True
            break
        try:
            await asyncio.wait_for(
                session.output_event.wait(),
                timeout=min(0.2, remaining_wait),
            )
        except asyncio.TimeoutError:
            if loop.time() >= deadline:
                timed_out = True
                break

    if not marker_found and pending_stdout:
        stdout_truncated = _append_limited_output(
            stdout_buffer,
            bytes(pending_stdout),
            limit_bytes=limit_bytes,
        ) or stdout_truncated

    return (
        bytes(stdout_buffer),
        bytes(stderr_buffer),
        stdout_truncated,
        stderr_truncated,
        marker_found,
        timed_out,
    )


def _build_shell_session_marker_command(shell: str, marker_text: str) -> str:
    midpoint = max(1, len(marker_text) // 2)
    prefix = marker_text[:midpoint]
    suffix = marker_text[midpoint:]
    if shell == "pwsh":
        return f"Write-Output ('{prefix}' + '{suffix}')"
    if shell == "cmd":
        gap_variable = f"__TRAE_MARKER_GAP_{uuid.uuid4().hex}__"
        return f"echo {prefix}%{gap_variable}%{suffix}"
    return f"printf '%s%s\\n' '{prefix}' '{suffix}'"


def _decode_output(data: bytes) -> str:
    if not data:
        return ""
    try:
        return data.decode("utf-8", errors="replace")
    except Exception:
        encoding = locale.getpreferredencoding(False) or "utf-8"
        return data.decode(encoding, errors="replace")


async def _collect_process_output_until_exit_or_inactivity(
    proc: asyncio.subprocess.Process,
    *,
    inactivity_timeout_seconds: float,
    limit_bytes: int,
) -> tuple[bytes, bytes, bool, bool, bool]:
    stdout_buffer = bytearray()
    stderr_buffer = bytearray()
    stdout_truncated = False
    stderr_truncated = False
    timed_out = False
    loop = asyncio.get_running_loop()
    stdout_stream = proc.stdout
    stderr_stream = proc.stderr
    stdout_task: asyncio.Task[bytes] | None = (
        asyncio.create_task(stdout_stream.read(4096))
        if stdout_stream is not None
        else None
    )
    stderr_task: asyncio.Task[bytes] | None = (
        asyncio.create_task(stderr_stream.read(4096))
        if stderr_stream is not None
        else None
    )
    wait_task: asyncio.Task[int] | None = asyncio.create_task(proc.wait())
    proc_exited = False
    terminating = False
    terminate_deadline: float | None = None
    last_activity = loop.time()

    try:
        while True:
            active_tasks: set[asyncio.Future[Any]] = {
                cast(asyncio.Future[Any], task)
                for task in (stdout_task, stderr_task, wait_task)
                if task is not None
            }
            if not active_tasks:
                break
            if proc_exited:
                timeout: float | None = None
            elif terminating:
                if terminate_deadline is None:
                    terminate_deadline = loop.time() + 2
                timeout = max(0.0, min(0.2, terminate_deadline - loop.time()))
            else:
                timeout = max(
                    0.0,
                    inactivity_timeout_seconds - (loop.time() - last_activity),
                )
            done, _ = await asyncio.wait(
                active_tasks,
                timeout=timeout,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if not done:
                if proc_exited:
                    continue
                if not terminating:
                    timed_out = True
                    terminating = True
                    proc.terminate()
                    terminate_deadline = loop.time() + 2
                    continue
                if proc.returncode is None:
                    proc.kill()
                    terminate_deadline = loop.time() + 2
                continue

            for task in done:
                if task is wait_task:
                    proc_exited = True
                    wait_task = None
                    continue
                if task is stdout_task:
                    chunk = task.result()
                    if chunk:
                        remaining = limit_bytes - len(stdout_buffer)
                        if remaining > 0:
                            stdout_buffer.extend(chunk[:remaining])
                            if len(chunk) > remaining:
                                stdout_truncated = True
                        else:
                            stdout_truncated = True
                        last_activity = loop.time()
                        if stdout_stream is not None:
                            stdout_task = asyncio.create_task(stdout_stream.read(4096))
                    else:
                        stdout_task = None
                    continue
                if task is stderr_task:
                    chunk = task.result()
                    if chunk:
                        remaining = limit_bytes - len(stderr_buffer)
                        if remaining > 0:
                            stderr_buffer.extend(chunk[:remaining])
                            if len(chunk) > remaining:
                                stderr_truncated = True
                        else:
                            stderr_truncated = True
                        last_activity = loop.time()
                        if stderr_stream is not None:
                            stderr_task = asyncio.create_task(stderr_stream.read(4096))
                    else:
                        stderr_task = None
                    continue

            if proc.returncode is not None:
                proc_exited = True

        return bytes(stdout_buffer), bytes(stderr_buffer), timed_out, stdout_truncated, stderr_truncated
    finally:
        pending_tasks: list[asyncio.Future[Any]] = []
        for task in (stdout_task, stderr_task, wait_task):
            if task is not None and not task.done():
                pending_tasks.append(cast(asyncio.Future[Any], task))
        for task in pending_tasks:
            task.cancel()
        if pending_tasks:
            await asyncio.gather(*pending_tasks, return_exceptions=True)


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
        resolved_cwd = str(Path(cwd).resolve(strict=False))

    recycle_timeout_seconds = payload.get("recycleTimeoutSeconds")
    if isinstance(recycle_timeout_seconds, bool) or not isinstance(
        recycle_timeout_seconds, (int, float)
    ):
        raise ValueError("recycleTimeoutSeconds must be a positive integer")
    resolved_recycle_timeout_seconds = int(recycle_timeout_seconds)
    if resolved_recycle_timeout_seconds <= 0:
        raise ValueError("recycleTimeoutSeconds must be a positive integer")

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
        **_build_shell_session_subprocess_kwargs(),
    )
    session_id = str(uuid.uuid4())
    recycle_at = now + timedelta(seconds=resolved_recycle_timeout_seconds)
    output_event = asyncio.Event()
    session = _ShellSession(
        session_id=session_id,
        shell=resolved_shell,
        proc=proc,
        created_at=now,
        recycle_at=recycle_at,
        recycle_timeout_seconds=resolved_recycle_timeout_seconds,
        lock=asyncio.Lock(),
        stdout_buffer=bytearray(),
        stderr_buffer=bytearray(),
        output_event=output_event,
        stdout_task=None,
        stderr_task=None,
    )
    session.stdout_task = asyncio.create_task(
        _pump_shell_session_output(proc.stdout, session.stdout_buffer, output_event)
    )
    session.stderr_task = asyncio.create_task(
        _pump_shell_session_output(proc.stderr, session.stderr_buffer, output_event)
    )
    _SHELL_SESSIONS[session_id] = session
    try:
        await asyncio.wait_for(output_event.wait(), timeout=0.2)
    except asyncio.TimeoutError:
        pass
    raw_stdout_bytes, raw_stderr_bytes = _drain_shell_session_output(session)
    stdout_buffer = bytearray()
    stderr_buffer = bytearray()
    stdout_truncated = _append_limited_output(
        stdout_buffer,
        raw_stdout_bytes,
        limit_bytes=4000,
    )
    stderr_truncated = _append_limited_output(
        stderr_buffer,
        raw_stderr_bytes,
        limit_bytes=4000,
    )
    stdout_bytes = bytes(stdout_buffer)
    stderr_bytes = bytes(stderr_buffer)
    return {
        "sessionId": session_id,
        "shell": resolved_shell,
        "cwd": resolved_cwd,
        "recycleTimeoutSeconds": resolved_recycle_timeout_seconds,
        "recycleAt": recycle_at.isoformat(),
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

    timeout_seconds = payload.get("timeoutSeconds")
    if timeout_seconds is None:
        resolved_timeout_seconds = 300
    elif isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, (int, float)):
        raise ValueError("timeoutSeconds must be a positive integer")
    else:
        resolved_timeout_seconds = int(timeout_seconds)
    if resolved_timeout_seconds <= 0:
        raise ValueError("timeoutSeconds must be a positive integer")
    if resolved_timeout_seconds > 300:
        resolved_timeout_seconds = 300

    max_output_bytes = resolved_max_output_chars * 4
    now = datetime.now(UTC)
    _cleanup_shell_sessions(now)
    session = _SHELL_SESSIONS.get(session_id)
    if session is None:
        raise LookupError("shell session not found")
    remaining_recycle_seconds = max(0.0, (session.recycle_at - now).total_seconds())
    if remaining_recycle_seconds <= 0:
        _cleanup_shell_sessions(now)
        raise LookupError("shell session not found")

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
                "timedOut": False,
                "timeoutSeconds": resolved_timeout_seconds,
                "recycleTimeoutSeconds": session.recycle_timeout_seconds,
                "recycleAt": session.recycle_at.isoformat(),
                "maxOutputChars": resolved_max_output_chars,
            }
        if proc.stdin is None:
            raise RuntimeError("shell session stdin is not available")
        raw_line = input_text.strip()
        is_exit = raw_line.lower() in {"exit", "logout"}
        marker_text = f"__TRAE_SHELL_DONE_{uuid.uuid4().hex}__"
        marker_bytes = marker_text.encode("utf-8")
        if is_exit:
            payload_line = raw_line
            marker_bytes = b""
        else:
            marker_command = _build_shell_session_marker_command(session.shell, marker_text)
            if session.shell == "cmd":
                payload_line = f"{raw_line} & {marker_command}"
            else:
                payload_line = f"{raw_line}; {marker_command}"

        _drain_shell_session_output(session)
        line_ending = "\r\n" if session.shell == "cmd" else "\n"
        proc.stdin.write((payload_line + line_ending).encode("utf-8", errors="replace"))
        await proc.stdin.drain()

        (
            stdout_bytes,
            stderr_bytes,
            stdout_truncated,
            stderr_truncated,
            marker_found,
            read_timed_out,
        ) = await _read_shell_session_output_until_marker(
            session,
            marker=marker_bytes,
            limit_bytes=max_output_bytes,
            timeout_seconds=min(float(resolved_timeout_seconds), remaining_recycle_seconds),
        )
        timed_out = read_timed_out and not marker_found and proc.returncode is None
        if timed_out:
            await _terminate_shell_session(
                session_id,
                session,
                interrupt_first=True,
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
            "timedOut": timed_out,
            "timeoutSeconds": resolved_timeout_seconds,
            "recycleTimeoutSeconds": session.recycle_timeout_seconds,
            "recycleAt": session.recycle_at.isoformat(),
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
    await _terminate_shell_session_process(proc, interrupt_first=False)
    await _finish_shell_session_output_tasks(session)
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

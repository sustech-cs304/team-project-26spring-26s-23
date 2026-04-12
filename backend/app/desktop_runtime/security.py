"""桌面运行时安全与本地回环访问控制。"""

from __future__ import annotations

from fastapi import HTTPException, Request, Response, status

from .config import LOCAL_TOKEN_HEADER_NAME, DesktopRuntimeConfig

_DESKTOP_NULL_ORIGIN = "null"
_ELECTRON_USER_AGENT_MARKER = "electron/"
_CORS_ALLOW_METHODS = "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT"


def require_local_token(request: Request, runtime_config: DesktopRuntimeConfig) -> None:
    if not runtime_config.local_token:
        return

    received_token = request.headers.get(LOCAL_TOKEN_HEADER_NAME)
    if received_token == runtime_config.local_token:
        return

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={
            "code": "invalid_local_token",
            "message": "Missing or invalid local runtime token.",
            "header_name": LOCAL_TOKEN_HEADER_NAME,
        },
    )


def is_cors_preflight_request(request: Request) -> bool:
    return (
        request.method == "OPTIONS"
        and request.headers.get("origin") is not None
        and request.headers.get("access-control-request-method") is not None
    )


def is_packaged_electron_request(request: Request) -> bool:
    user_agent = request.headers.get("user-agent", "")
    return _ELECTRON_USER_AGENT_MARKER in user_agent.lower()


def apply_cors_headers(
    response: Response,
    *,
    origin: str,
    requested_headers: str | None,
    is_preflight_request: bool,
) -> None:
    response.headers["Access-Control-Allow-Origin"] = origin
    _append_vary_header(response, "Origin")

    if not is_preflight_request:
        return

    response.headers["Access-Control-Allow-Methods"] = _CORS_ALLOW_METHODS
    response.headers["Access-Control-Allow-Headers"] = requested_headers or "*"
    response.headers["Access-Control-Max-Age"] = "600"
    _append_vary_header(response, "Access-Control-Request-Method")
    _append_vary_header(response, "Access-Control-Request-Headers")


def is_desktop_null_origin(origin: str | None) -> bool:
    return origin == _DESKTOP_NULL_ORIGIN


def _append_vary_header(response: Response, value: str) -> None:
    current_value = response.headers.get("Vary")
    if current_value is None:
        response.headers["Vary"] = value
        return

    vary_values = {item.strip() for item in current_value.split(",") if item.strip()}
    if value in vary_values:
        return

    response.headers["Vary"] = ", ".join([*vary_values, value])


__all__ = [
    "apply_cors_headers",
    "is_cors_preflight_request",
    "is_desktop_null_origin",
    "is_packaged_electron_request",
    "require_local_token",
]

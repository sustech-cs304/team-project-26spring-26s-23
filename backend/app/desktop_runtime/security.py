"""桌面运行时安全与本地回环访问控制。"""

from __future__ import annotations

from ipaddress import ip_address

from fastapi import HTTPException, Request, Response, status

from .config import LOCAL_TOKEN_HEADER_NAME, DesktopRuntimeConfig

_DESKTOP_NULL_ORIGIN = "null"
_ELECTRON_USER_AGENT_MARKER = "electron/"
_CORS_ALLOW_METHODS = "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT"


def require_local_token(request: Request, runtime_config: DesktopRuntimeConfig) -> None:
    if not runtime_config.local_token:
        return

    received_token = (
        request.headers.get(LOCAL_TOKEN_HEADER_NAME)
        or request.query_params.get(LOCAL_TOKEN_HEADER_NAME)
        or request.query_params.get("token")
    )
    if received_token == runtime_config.local_token:
        return

    if received_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "missing_local_token",
                "message": "Missing local runtime token.",
                "header_name": LOCAL_TOKEN_HEADER_NAME,
            },
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={
            "code": "invalid_local_token",
            "message": "Invalid local runtime token.",
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


def is_loopback_client_request(request: Request) -> bool:
    client = request.client
    if client is None:
        return False

    host = client.host.strip().lower()
    if host == "localhost":
        return True
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]

    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


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

    vary_values: list[str] = []
    seen_values: set[str] = set()
    for item in current_value.split(","):
        normalized_item = item.strip()
        if not normalized_item or normalized_item in seen_values:
            continue
        seen_values.add(normalized_item)
        vary_values.append(normalized_item)

    if value in seen_values:
        return

    vary_values.append(value)
    response.headers["Vary"] = ", ".join(vary_values)


__all__ = [
    "apply_cors_headers",
    "is_cors_preflight_request",
    "is_desktop_null_origin",
    "is_loopback_client_request",
    "is_packaged_electron_request",
    "require_local_token",
]

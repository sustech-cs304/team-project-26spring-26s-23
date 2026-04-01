"""Protocol parsing and normalization for the minimal Copilot runtime run bridge."""

from __future__ import annotations

from json import JSONDecodeError
from typing import Any

from fastapi import Request, status

from .contracts import (
    CAPABILITIES_GET_METHOD,
    MESSAGE_SEND_METHOD,
    SESSION_CREATE_METHOD,
    RuntimeCapabilitiesGetRequest,
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeMessageSendRequest,
    RuntimeScaffold,
    RuntimeSessionCreateRequest,
)
from .model_routes import RuntimeModelRoute, RuntimeModelRouteSnapshot
from .errors import (
    RuntimeErrorResponse,
    build_agent_not_found_error,
    build_invalid_request_error,
    build_unsupported_message_shape_error,
)

class RuntimeProtocolError(RuntimeError):
    """Structured protocol parsing failure that the HTTP router can render directly."""

    def __init__(self, *, status_code: int, error: RuntimeErrorResponse) -> None:
        super().__init__(error.error.message)
        self.status_code = status_code
        self.error = error


class RuntimeProtocolParser:
    """Normalize runtime payloads into internal protocol contracts."""

    def __init__(self, scaffold: RuntimeScaffold) -> None:
        self._scaffold = scaffold

    async def read_payload(self, request: Request) -> dict[str, Any] | None:
        raw_body = await request.body()
        if raw_body == b"":
            return None

        try:
            payload = await request.json()
        except JSONDecodeError:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime request body must be valid JSON.",
                    scaffold=self._scaffold,
                ),
            )

        if payload is None:
            return None

        if not isinstance(payload, dict):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime request body must be a JSON object.",
                    scaffold=self._scaffold,
                ),
            )

        return payload

    def extract_method(self, payload: dict[str, Any] | None) -> str:
        if payload is None:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=(
                        "Runtime request must provide a JSON object with an explicit 'method' field."
                    ),
                    scaffold=self._scaffold,
                ),
            )

        method = payload.get("method")
        if not isinstance(method, str):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime request field 'method' must be a non-empty string.",
                    scaffold=self._scaffold,
                ),
            )

        normalized_method = method.strip().lower()
        if normalized_method == "":
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime request field 'method' must be a non-empty string.",
                    scaffold=self._scaffold,
                ),
            )

        return normalized_method

    def extract_session_create_request(
        self,
        payload: dict[str, Any] | None,
    ) -> RuntimeSessionCreateRequest:
        if payload is None:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime method 'session/create' requires a JSON payload.",
                    scaffold=self._scaffold,
                    requested_method=SESSION_CREATE_METHOD,
                ),
            )

        request_body = self._extract_body(payload, requested_method=SESSION_CREATE_METHOD)
        agent_id = self._require_non_empty_string(
            request_body.get("agentId"),
            field_name="agentId",
            requested_method=SESSION_CREATE_METHOD,
        )
        if self._scaffold.supports_agent(agent_id):
            return RuntimeSessionCreateRequest(agent_id=agent_id)

        raise RuntimeProtocolError(
            status_code=status.HTTP_404_NOT_FOUND,
            error=build_agent_not_found_error(
                agent_name=agent_id,
                scaffold=self._scaffold,
                requested_method=SESSION_CREATE_METHOD,
            ),
        )

    def extract_capabilities_get_request(
        self,
        payload: dict[str, Any] | None,
    ) -> RuntimeCapabilitiesGetRequest:
        if payload is None:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime method 'capabilities/get' requires a JSON payload.",
                    scaffold=self._scaffold,
                    requested_method=CAPABILITIES_GET_METHOD,
                ),
            )

        request_body = self._extract_body(payload, requested_method=CAPABILITIES_GET_METHOD)
        session_id = self._require_non_empty_string(
            request_body.get("sessionId"),
            field_name="sessionId",
            requested_method=CAPABILITIES_GET_METHOD,
        )
        return RuntimeCapabilitiesGetRequest(session_id=session_id)

    def extract_message_send_request(
        self,
        payload: dict[str, Any] | None,
    ) -> RuntimeMessageSendRequest:
        if payload is None:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime method 'message/send' requires a JSON payload.",
                    scaffold=self._scaffold,
                    requested_method=MESSAGE_SEND_METHOD,
                ),
            )

        request_body = self._extract_body(payload, requested_method=MESSAGE_SEND_METHOD)
        session_id = self._require_non_empty_string(
            request_body.get("sessionId"),
            field_name="sessionId",
            requested_method=MESSAGE_SEND_METHOD,
        )

        raw_agent_id = request_body.get("agent")
        agent_id: str | None = None
        if raw_agent_id is not None:
            agent_id = self._require_non_empty_string(
                raw_agent_id,
                field_name="agent",
                requested_method=MESSAGE_SEND_METHOD,
            )

        message = self._extract_message_send_payload(request_body.get("message"))
        policy = self._extract_message_execution_policy(request_body)
        return RuntimeMessageSendRequest(
            session_id=session_id,
            message=message,
            policy=policy,
            agent_id=agent_id,
        )

    def _extract_body(self, payload: dict[str, Any], *, requested_method: str) -> dict[str, Any]:
        raw_body = payload.get("body")
        if not isinstance(raw_body, dict):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=f"Runtime request field 'body' must be an object for method '{requested_method}'.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": "body"},
                ),
            )
        return dict(raw_body)

    def _require_non_empty_string(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> str:
        if not isinstance(value, str) or value.strip() == "":
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=f"Runtime request field '{field_name}' must be a non-empty string.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": field_name},
                ),
            )
        return value.strip()

    def _optional_object(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> dict[str, Any]:
        if value is None:
            return {}
        return self._require_object(
            value,
            field_name=field_name,
            requested_method=requested_method,
        )

    def _require_object(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=f"Runtime request field '{field_name}' must be an object.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": field_name},
                ),
            )
        return dict(value)

    def _optional_list_of_strings(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> tuple[str, ...]:
        if value is None:
            return ()
        if not isinstance(value, list):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=f"Runtime request field '{field_name}' must be an array of strings.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": field_name},
                ),
            )

        normalized_items: list[str] = []
        for index, item in enumerate(value):
            if not isinstance(item, str) or item.strip() == "":
                raise RuntimeProtocolError(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    error=build_invalid_request_error(
                        message=(
                            f"Runtime request field '{field_name}' must contain only non-empty strings."
                        ),
                        scaffold=self._scaffold,
                        requested_method=requested_method,
                        details={"field": f"{field_name}[{index}]"},
                    ),
                )
            normalized_items.append(item.strip())
        return tuple(normalized_items)

    def _extract_message_send_payload(self, value: Any) -> RuntimeMessagePayload:
        if not isinstance(value, dict):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime request field 'message' must be an object.",
                    scaffold=self._scaffold,
                    requested_method=MESSAGE_SEND_METHOD,
                    details={"field": "message"},
                ),
            )

        role = self._require_non_empty_string(
            value.get("role"),
            field_name="message.role",
            requested_method=MESSAGE_SEND_METHOD,
        )
        normalized_role = role.lower()
        if normalized_role != "user":
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_unsupported_message_shape_error(
                    message="Runtime method 'message/send' currently requires a user text message.",
                    scaffold=self._scaffold,
                    requested_method=MESSAGE_SEND_METHOD,
                    details={"field": "message.role", "role": normalized_role},
                ),
            )

        content = self._require_non_empty_string(
            value.get("content"),
            field_name="message.content",
            requested_method=MESSAGE_SEND_METHOD,
        )
        return RuntimeMessagePayload(role=normalized_role, content=content)

    def _extract_message_execution_policy(
        self,
        request_body: dict[str, Any],
    ) -> RuntimeMessageExecutionPolicy:
        policy = self._require_object(
            request_body.get("policy"),
            field_name="policy",
            requested_method=MESSAGE_SEND_METHOD,
        )
        model_route = self._extract_model_route(
            policy.get("modelRoute"),
            field_name="policy.modelRoute",
        )
        enabled_tools = self._optional_list_of_strings(
            policy.get("enabledTools"),
            field_name="policy.enabledTools",
            requested_method=MESSAGE_SEND_METHOD,
        )
        request_options = self._optional_object(
            policy.get("requestOptions"),
            field_name="policy.requestOptions",
            requested_method=MESSAGE_SEND_METHOD,
        )
        return RuntimeMessageExecutionPolicy(
            modelRoute=model_route,
            enabledTools=enabled_tools,
            requestOptions=request_options,
        )

    def _extract_model_route(
        self,
        value: Any,
        *,
        field_name: str,
    ) -> RuntimeModelRoute:
        route = self._require_object(
            value,
            field_name=field_name,
            requested_method=MESSAGE_SEND_METHOD,
        )
        provider_profile_id = self._require_non_empty_string(
            route.get("providerProfileId"),
            field_name=f"{field_name}.providerProfileId",
            requested_method=MESSAGE_SEND_METHOD,
        )
        snapshot = self._require_object(
            route.get("snapshot"),
            field_name=f"{field_name}.snapshot",
            requested_method=MESSAGE_SEND_METHOD,
        )
        return RuntimeModelRoute(
            provider_profile_id=provider_profile_id,
            snapshot=RuntimeModelRouteSnapshot(
                provider=self._require_non_empty_string(
                    snapshot.get("provider"),
                    field_name=f"{field_name}.snapshot.provider",
                    requested_method=MESSAGE_SEND_METHOD,
                ),
                endpoint_type=self._require_non_empty_string(
                    snapshot.get("endpointType"),
                    field_name=f"{field_name}.snapshot.endpointType",
                    requested_method=MESSAGE_SEND_METHOD,
                ),
                base_url=self._require_non_empty_string(
                    snapshot.get("baseUrl"),
                    field_name=f"{field_name}.snapshot.baseUrl",
                    requested_method=MESSAGE_SEND_METHOD,
                ),
                model_id=self._require_non_empty_string(
                    snapshot.get("modelId"),
                    field_name=f"{field_name}.snapshot.modelId",
                    requested_method=MESSAGE_SEND_METHOD,
                ),
            ),
        )



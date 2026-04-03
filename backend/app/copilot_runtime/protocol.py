"""Protocol parsing and normalization for the Copilot runtime thread/run bridge."""

from __future__ import annotations

from json import JSONDecodeError
from typing import Any

from fastapi import Request, status

from .contracts import (
    CAPABILITIES_GET_METHOD,
    MESSAGE_SEND_METHOD,
    RUN_CANCEL_METHOD,
    RUN_START_METHOD,
    RUN_STREAM_METHOD,
    SESSION_CREATE_METHOD,
    THREAD_CREATE_METHOD,
    THREAD_GET_METHOD,
    RuntimeCapabilitiesGetRequest,
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeMessageSendRequest,
    RuntimeRunCancelRequest,
    RuntimeRunStartRequest,
    RuntimeRunStreamRequest,
    RuntimeScaffold,
    RuntimeSessionCreateRequest,
    RuntimeThreadCreateRequest,
    RuntimeThreadGetRequest,
)
from .errors import (
    RuntimeErrorResponse,
    build_agent_not_found_error,
    build_invalid_request_error,
    build_unsupported_message_shape_error,
)
from .model_routes import RuntimeModelRoute, RuntimeModelRouteSnapshot


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

    def extract_thread_create_request(
        self,
        payload: dict[str, Any] | None,
    ) -> RuntimeThreadCreateRequest:
        return RuntimeThreadCreateRequest(
            agent_id=self._extract_agent_id_request(
                payload=payload,
                requested_method=THREAD_CREATE_METHOD,
            )
        )

    def extract_session_create_request(
        self,
        payload: dict[str, Any] | None,
    ) -> RuntimeSessionCreateRequest:
        request = self._extract_agent_id_request(
            payload=payload,
            requested_method=SESSION_CREATE_METHOD,
        )
        return RuntimeSessionCreateRequest(agent_id=request)

    def extract_thread_get_request(
        self,
        payload: dict[str, Any] | None,
    ) -> RuntimeThreadGetRequest:
        thread_id = self._extract_identifier_request(
            payload=payload,
            requested_method=THREAD_GET_METHOD,
            field_name="threadId",
        )
        return RuntimeThreadGetRequest(thread_id=thread_id)

    def extract_capabilities_get_request(
        self,
        payload: dict[str, Any] | None,
    ) -> RuntimeCapabilitiesGetRequest:
        session_id = self._extract_identifier_request(
            payload=payload,
            requested_method=CAPABILITIES_GET_METHOD,
            field_name="sessionId",
        )
        return RuntimeCapabilitiesGetRequest(session_id=session_id)

    def extract_run_start_request(
        self,
        payload: dict[str, Any] | None,
    ) -> RuntimeRunStartRequest:
        return self._extract_chat_request(
            payload=payload,
            requested_method=RUN_START_METHOD,
            id_field_name="threadId",
            id_value_name="thread_id",
        )

    def extract_message_send_request(
        self,
        payload: dict[str, Any] | None,
    ) -> RuntimeMessageSendRequest:
        request = self._extract_chat_request(
            payload=payload,
            requested_method=MESSAGE_SEND_METHOD,
            id_field_name="sessionId",
            id_value_name="thread_id",
        )
        return RuntimeMessageSendRequest(
            session_id=request.thread_id,
            message=request.message,
            policy=request.policy,
            agent_id=request.agent_id,
        )

    def extract_run_stream_request(
        self,
        payload: dict[str, Any] | None,
    ) -> RuntimeRunStreamRequest:
        run_id = self._extract_identifier_request(
            payload=payload,
            requested_method=RUN_STREAM_METHOD,
            field_name="runId",
        )
        return RuntimeRunStreamRequest(run_id=run_id)

    def extract_run_cancel_request(
        self,
        payload: dict[str, Any] | None,
    ) -> RuntimeRunCancelRequest:
        run_id = self._extract_identifier_request(
            payload=payload,
            requested_method=RUN_CANCEL_METHOD,
            field_name="runId",
        )
        return RuntimeRunCancelRequest(run_id=run_id)

    def _extract_agent_id_request(
        self,
        *,
        payload: dict[str, Any] | None,
        requested_method: str,
    ) -> str:
        request_body = self._require_payload_body(payload, requested_method=requested_method)
        agent_id = self._require_non_empty_string(
            request_body.get("agentId"),
            field_name="agentId",
            requested_method=requested_method,
        )
        if self._scaffold.supports_agent(agent_id):
            return agent_id

        raise RuntimeProtocolError(
            status_code=status.HTTP_404_NOT_FOUND,
            error=build_agent_not_found_error(
                agent_name=agent_id,
                scaffold=self._scaffold,
                requested_method=requested_method,
            ),
        )

    def _extract_identifier_request(
        self,
        *,
        payload: dict[str, Any] | None,
        requested_method: str,
        field_name: str,
    ) -> str:
        request_body = self._require_payload_body(payload, requested_method=requested_method)
        return self._require_non_empty_string(
            request_body.get(field_name),
            field_name=field_name,
            requested_method=requested_method,
        )

    def _extract_chat_request(
        self,
        *,
        payload: dict[str, Any] | None,
        requested_method: str,
        id_field_name: str,
        id_value_name: str,
    ) -> RuntimeRunStartRequest:
        request_body = self._require_payload_body(payload, requested_method=requested_method)
        identifier = self._require_non_empty_string(
            request_body.get(id_field_name),
            field_name=id_field_name,
            requested_method=requested_method,
        )

        raw_agent_id = request_body.get("agent")
        agent_id: str | None = None
        if raw_agent_id is not None:
            agent_id = self._require_non_empty_string(
                raw_agent_id,
                field_name="agent",
                requested_method=requested_method,
            )

        message = self._extract_message_payload(
            request_body.get("message"),
            requested_method=requested_method,
        )
        policy = self._extract_message_execution_policy(
            request_body,
            requested_method=requested_method,
        )
        return RuntimeRunStartRequest(
            **{id_value_name: identifier},
            message=message,
            policy=policy,
            agent_id=agent_id,
        )

    def _require_payload_body(
        self,
        payload: dict[str, Any] | None,
        *,
        requested_method: str,
    ) -> dict[str, Any]:
        if payload is None:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=f"Runtime method '{requested_method}' requires a JSON payload.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                ),
            )

        return self._extract_body(payload, requested_method=requested_method)

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

    def _optional_boolean(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> bool:
        if value is None:
            return False
        if not isinstance(value, bool):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=f"Runtime request field '{field_name}' must be a boolean.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": field_name},
                ),
            )
        return value

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

    def _extract_message_payload(
        self,
        value: Any,
        *,
        requested_method: str,
    ) -> RuntimeMessagePayload:
        if not isinstance(value, dict):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime request field 'message' must be an object.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": "message"},
                ),
            )

        role = self._require_non_empty_string(
            value.get("role"),
            field_name="message.role",
            requested_method=requested_method,
        )
        normalized_role = role.lower()
        if normalized_role != "user":
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_unsupported_message_shape_error(
                    message=f"Runtime method '{requested_method}' currently requires a user text message.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": "message.role", "role": normalized_role},
                ),
            )

        content = self._require_non_empty_string(
            value.get("content"),
            field_name="message.content",
            requested_method=requested_method,
        )
        return RuntimeMessagePayload(role=normalized_role, content=content)

    def _extract_message_execution_policy(
        self,
        request_body: dict[str, Any],
        *,
        requested_method: str,
    ) -> RuntimeMessageExecutionPolicy:
        policy = self._require_object(
            request_body.get("policy"),
            field_name="policy",
            requested_method=requested_method,
        )
        model_route = self._extract_model_route(
            policy.get("modelRoute"),
            field_name="policy.modelRoute",
            requested_method=requested_method,
        )
        enabled_tools = self._optional_list_of_strings(
            policy.get("enabledTools"),
            field_name="policy.enabledTools",
            requested_method=requested_method,
        )
        debug_mode_enabled = self._optional_boolean(
            policy.get("debugModeEnabled"),
            field_name="policy.debugModeEnabled",
            requested_method=requested_method,
        )
        request_options = self._optional_object(
            policy.get("requestOptions"),
            field_name="policy.requestOptions",
            requested_method=requested_method,
        )
        return RuntimeMessageExecutionPolicy(
            modelRoute=model_route,
            enabledTools=enabled_tools,
            debugModeEnabled=debug_mode_enabled,
            requestOptions=request_options,
        )

    def _extract_model_route(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> RuntimeModelRoute:
        route = self._require_object(
            value,
            field_name=field_name,
            requested_method=requested_method,
        )
        provider_profile_id = self._require_non_empty_string(
            route.get("providerProfileId"),
            field_name=f"{field_name}.providerProfileId",
            requested_method=requested_method,
        )
        snapshot = self._require_object(
            route.get("snapshot"),
            field_name=f"{field_name}.snapshot",
            requested_method=requested_method,
        )
        return RuntimeModelRoute(
            provider_profile_id=provider_profile_id,
            snapshot=RuntimeModelRouteSnapshot(
                provider=self._require_non_empty_string(
                    snapshot.get("provider"),
                    field_name=f"{field_name}.snapshot.provider",
                    requested_method=requested_method,
                ),
                endpoint_type=self._require_non_empty_string(
                    snapshot.get("endpointType"),
                    field_name=f"{field_name}.snapshot.endpointType",
                    requested_method=requested_method,
                ),
                base_url=self._require_non_empty_string(
                    snapshot.get("baseUrl"),
                    field_name=f"{field_name}.snapshot.baseUrl",
                    requested_method=requested_method,
                ),
                model_id=self._require_non_empty_string(
                    snapshot.get("modelId"),
                    field_name=f"{field_name}.snapshot.modelId",
                    requested_method=requested_method,
                ),
            ),
        )

"""Protocol parsing and normalization for the minimal Copilot runtime run bridge."""

from __future__ import annotations

from json import JSONDecodeError
from typing import Any

from fastapi import Request, status

from .contracts import (
    AGENT_CONNECT_METHOD,
    AGENT_RUN_METHOD,
    INFO_METHOD,
    SESSION_CREATE_METHOD,
    RuntimeConnectRequest,
    RuntimeRunRequest,
    RuntimeScaffold,
    RuntimeSessionCreateRequest,
)
from .errors import (
    RuntimeErrorResponse,
    build_agent_not_found_error,
    build_invalid_request_error,
    build_unsupported_message_shape_error,
)

INFO_REQUEST_KEYS = frozenset({"properties", "frontendUrl", "method"})
RUN_LIKE_REQUEST_KEYS = frozenset(
    {
        "threadId",
        "runId",
        "messages",
        "state",
        "actions",
        "metaEvents",
        "nodeName",
        "agentName",
        "name",
    }
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
        if payload is None or payload == {}:
            return INFO_METHOD

        request_keys = set(payload)
        if request_keys.issubset(INFO_REQUEST_KEYS) and request_keys <= {"properties", "frontendUrl"}:
            return INFO_METHOD

        method = payload.get("method")
        if method is None:
            inferred_method = self._infer_implicit_method(payload)
            if inferred_method is not None:
                return inferred_method

            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=(
                        "Runtime request must provide a supported info shape or an explicit 'method' field."
                    ),
                    scaffold=self._scaffold,
                ),
            )

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

        if normalized_method == "run":
            return AGENT_RUN_METHOD

        return normalized_method

    def extract_connect_request(self, payload: dict[str, Any] | None) -> RuntimeConnectRequest:
        if payload is None:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime method 'agent/connect' requires a JSON payload.",
                    scaffold=self._scaffold,
                    requested_method=AGENT_CONNECT_METHOD,
                ),
            )

        params = self._extract_params(payload, requested_method=AGENT_CONNECT_METHOD)
        connect_body = self._extract_body(payload, requested_method=AGENT_CONNECT_METHOD)
        agent_name = self._resolve_agent_name(
            payload,
            params,
            connect_body,
            requested_method=AGENT_CONNECT_METHOD,
        )
        thread_id = self._require_non_empty_string(
            connect_body.get("threadId"),
            field_name="threadId",
            requested_method=AGENT_CONNECT_METHOD,
        )
        run_id = self._require_non_empty_string(
            connect_body.get("runId"),
            field_name="runId",
            requested_method=AGENT_CONNECT_METHOD,
        )
        messages = self._require_list_of_objects(
            connect_body.get("messages"),
            field_name="messages",
            requested_method=AGENT_CONNECT_METHOD,
        )
        tools = self._optional_list_of_objects(
            connect_body.get("tools"),
            field_name="tools",
            requested_method=AGENT_CONNECT_METHOD,
        )
        context = self._optional_list_of_objects(
            connect_body.get("context"),
            field_name="context",
            requested_method=AGENT_CONNECT_METHOD,
        )
        forwarded_props = self._optional_object(
            connect_body.get("forwardedProps"),
            field_name="forwardedProps",
            requested_method=AGENT_CONNECT_METHOD,
        )

        return RuntimeConnectRequest(
            agent_name=agent_name,
            thread_id=thread_id,
            run_id=run_id,
            state=connect_body.get("state", {}),
            messages=messages,
            tools=tools,
            context=context,
            forwarded_props=forwarded_props,
            metadata={},
        )

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

    def extract_run_request(self, payload: dict[str, Any] | None) -> RuntimeRunRequest:
        if payload is None:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime method 'agent/run' requires a JSON payload.",
                    scaffold=self._scaffold,
                    requested_method=AGENT_RUN_METHOD,
                ),
            )

        params = self._extract_params(payload, requested_method=AGENT_RUN_METHOD)
        run_body = self._extract_body(payload, requested_method=AGENT_RUN_METHOD)
        agent_name = self._resolve_agent_name(
            payload,
            params,
            run_body,
            requested_method=AGENT_RUN_METHOD,
        )
        thread_id = self._require_non_empty_string(
            run_body.get("threadId"),
            field_name="threadId",
            requested_method=AGENT_RUN_METHOD,
        )
        run_id = self._require_non_empty_string(
            run_body.get("runId"),
            field_name="runId",
            requested_method=AGENT_RUN_METHOD,
        )
        messages = self._require_list_of_objects(
            run_body.get("messages"),
            field_name="messages",
            requested_method=AGENT_RUN_METHOD,
        )
        actions = self._optional_list_of_objects(
            run_body.get("actions"),
            field_name="actions",
            requested_method=AGENT_RUN_METHOD,
        )
        meta_events = self._optional_list_of_objects(
            run_body.get("metaEvents"),
            field_name="metaEvents",
            requested_method=AGENT_RUN_METHOD,
        )
        forwarded_props = self._optional_object(
            run_body.get("forwardedProps"),
            field_name="forwardedProps",
            requested_method=AGENT_RUN_METHOD,
        )

        node_name = run_body.get("nodeName")
        if node_name is not None and (not isinstance(node_name, str) or node_name.strip() == ""):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime request field 'nodeName' must be a non-empty string when provided.",
                    scaffold=self._scaffold,
                    requested_method=AGENT_RUN_METHOD,
                    details={"field": "nodeName"},
                ),
            )

        user_message_text = self._extract_latest_user_message_text(messages)

        return RuntimeRunRequest(
            agent_name=agent_name,
            thread_id=thread_id,
            run_id=run_id,
            user_message_text=user_message_text,
            state=run_body.get("state", {}),
            messages=messages,
            actions=actions,
            meta_events=meta_events,
            node_name=node_name.strip() if isinstance(node_name, str) else None,
            forwarded_props=forwarded_props,
            metadata={},
        )

    def _extract_params(self, payload: dict[str, Any], *, requested_method: str) -> dict[str, Any]:
        params = payload.get("params")
        if params is None:
            return {}
        if not isinstance(params, dict):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime request field 'params' must be an object when provided.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": "params"},
                ),
            )
        return dict(params)

    def _extract_body(self, payload: dict[str, Any], *, requested_method: str) -> dict[str, Any]:
        raw_body = payload.get("body")
        request_body = payload if raw_body is None else raw_body
        if not isinstance(request_body, dict):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=f"Runtime request field 'body' must be an object for method '{requested_method}'.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": "body"},
                ),
            )
        return dict(request_body)

    def _resolve_agent_name(
        self,
        payload: dict[str, Any],
        params: dict[str, Any],
        request_body: dict[str, Any],
        *,
        requested_method: str,
    ) -> str:
        raw_agent_name = params.get(
            "agentId",
            request_body.get(
                "agentName",
                request_body.get(
                    "name",
                    payload.get("agentName", payload.get("name", self._scaffold.default_agent)),
                ),
            ),
        )
        if not isinstance(raw_agent_name, str) or raw_agent_name.strip() == "":
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime request must resolve a non-empty agent name.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": "agentId"},
                ),
            )

        agent_name = raw_agent_name.strip()
        if self._scaffold.supports_agent(agent_name):
            return agent_name

        raise RuntimeProtocolError(
            status_code=status.HTTP_404_NOT_FOUND,
            error=build_agent_not_found_error(
                agent_name=agent_name,
                scaffold=self._scaffold,
                requested_method=requested_method,
            ),
        )

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

    def _require_list_of_objects(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> tuple[dict[str, Any], ...]:
        if not isinstance(value, list):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=f"Runtime request field '{field_name}' must be an array of objects.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": field_name},
                ),
            )

        normalized_items: list[dict[str, Any]] = []
        for index, item in enumerate(value):
            if not isinstance(item, dict):
                raise RuntimeProtocolError(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    error=build_invalid_request_error(
                        message=(f"Runtime request field '{field_name}' must contain only JSON objects."),
                        scaffold=self._scaffold,
                        requested_method=requested_method,
                        details={"field": f"{field_name}[{index}]"},
                    ),
                )
            normalized_items.append(dict(item))

        return tuple(normalized_items)

    def _optional_list_of_objects(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> tuple[dict[str, Any], ...]:
        if value is None:
            return ()
        return self._require_list_of_objects(
            value,
            field_name=field_name,
            requested_method=requested_method,
        )

    def _optional_object(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> dict[str, Any]:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=f"Runtime request field '{field_name}' must be an object when provided.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": field_name},
                ),
            )
        return dict(value)

    def _extract_latest_user_message_text(self, messages: tuple[dict[str, Any], ...]) -> str:
        if not messages:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime method 'agent/run' requires at least one message.",
                    scaffold=self._scaffold,
                    requested_method=AGENT_RUN_METHOD,
                    details={"field": "messages"},
                ),
            )

        for index, message in enumerate(messages):
            self._validate_supported_message_shape(message, index=index)

        last_message = messages[-1]
        last_role = str(last_message["role"]).strip().lower()
        if last_role != "user":
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_unsupported_message_shape_error(
                    message="Runtime method 'agent/run' requires the last message to be a text user message.",
                    scaffold=self._scaffold,
                    requested_method=AGENT_RUN_METHOD,
                    details={"field": f"messages[{len(messages) - 1}]", "role": last_role},
                ),
            )

        return self._extract_user_text_content(
            last_message.get("content"),
            field_name=f"messages[{len(messages) - 1}].content",
        )

    def _validate_supported_message_shape(self, message: dict[str, Any], *, index: int) -> None:
        role = message.get("role")
        if not isinstance(role, str) or role.strip() == "":
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message="Runtime run message role must be a non-empty string.",
                    scaffold=self._scaffold,
                    requested_method=AGENT_RUN_METHOD,
                    details={"field": f"messages[{index}].role"},
                ),
            )

        normalized_role = role.strip().lower()
        if normalized_role not in {"user", "assistant", "system", "developer"}:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_unsupported_message_shape_error(
                    message=f"Runtime run message role '{normalized_role}' is not supported in the MVP text-only bridge.",
                    scaffold=self._scaffold,
                    requested_method=AGENT_RUN_METHOD,
                    details={"field": f"messages[{index}].role", "role": normalized_role},
                ),
            )

        tool_calls = message.get("toolCalls", message.get("tool_calls"))
        if tool_calls not in (None, [], ()):  # pragma: no branch - simple MVP guard
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_unsupported_message_shape_error(
                    message="Runtime run does not support assistant tool calls in request messages.",
                    scaffold=self._scaffold,
                    requested_method=AGENT_RUN_METHOD,
                    details={"field": f"messages[{index}].toolCalls"},
                ),
            )

        content = message.get("content")
        if normalized_role == "user":
            self._extract_user_text_content(content, field_name=f"messages[{index}].content")
            return

        if normalized_role in {"system", "developer"}:
            if not isinstance(content, str) or content.strip() == "":
                raise RuntimeProtocolError(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    error=build_unsupported_message_shape_error(
                        message=f"Runtime run message '{normalized_role}' must contain non-empty text content.",
                        scaffold=self._scaffold,
                        requested_method=AGENT_RUN_METHOD,
                        details={"field": f"messages[{index}].content", "role": normalized_role},
                    ),
                )
            return

        if content is None:
            return
        if not isinstance(content, str):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_unsupported_message_shape_error(
                    message="Runtime run assistant history must contain plain text content when provided.",
                    scaffold=self._scaffold,
                    requested_method=AGENT_RUN_METHOD,
                    details={"field": f"messages[{index}].content", "role": normalized_role},
                ),
            )

    def _extract_user_text_content(self, content: Any, *, field_name: str) -> str:
        if isinstance(content, str):
            normalized_text = content.strip()
            if normalized_text != "":
                return normalized_text

        if isinstance(content, list):
            text_parts: list[str] = []
            for index, item in enumerate(content):
                if not isinstance(item, dict) or item.get("type") != "text":
                    raise RuntimeProtocolError(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        error=build_unsupported_message_shape_error(
                            message="Runtime run supports only text user message parts in the MVP bridge.",
                            scaffold=self._scaffold,
                            requested_method=AGENT_RUN_METHOD,
                            details={"field": f"{field_name}[{index}]"},
                        ),
                    )
                text = item.get("text")
                if not isinstance(text, str) or text.strip() == "":
                    raise RuntimeProtocolError(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        error=build_unsupported_message_shape_error(
                            message="Runtime run text message parts must include a non-empty 'text' field.",
                            scaffold=self._scaffold,
                            requested_method=AGENT_RUN_METHOD,
                            details={"field": f"{field_name}[{index}].text"},
                        ),
                    )
                text_parts.append(text.strip())
            if text_parts:
                return "\n".join(text_parts)

        raise RuntimeProtocolError(
            status_code=status.HTTP_400_BAD_REQUEST,
            error=build_unsupported_message_shape_error(
                message="Runtime run currently supports only non-empty text user messages.",
                scaffold=self._scaffold,
                requested_method=AGENT_RUN_METHOD,
                details={"field": field_name},
            ),
        )

    def _infer_implicit_method(self, payload: dict[str, Any]) -> str | None:
        body = payload.get("body")
        if any(key in payload for key in RUN_LIKE_REQUEST_KEYS):
            return AGENT_RUN_METHOD
        if isinstance(body, dict) and any(key in body for key in RUN_LIKE_REQUEST_KEYS):
            return AGENT_RUN_METHOD
        return None

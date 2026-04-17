"""Protocol parsing and normalization for the Copilot runtime thread/run bridge."""

from __future__ import annotations

from json import JSONDecodeError
from typing import Any

from fastapi import Request, status

from .contracts import (
    CAPABILITIES_GET_METHOD,
    GLOBAL_TOOL_CATALOG_GET_METHOD,
    RUN_CANCEL_METHOD,
    RUN_START_METHOD,
    RUN_STREAM_METHOD,
    THINKING_CAPABILITY_GET_METHOD,
    TOOL_APPROVAL_RESOLVE_METHOD,
    THREAD_CREATE_METHOD,
    THREAD_GET_METHOD,
    THINKING_LEVEL_INTENTS,
    RuntimeCapabilitiesGetRequest,
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeToolPermissionPolicy,
    ThinkingLevelIntent,
    RuntimeRunCancelRequest,
    RuntimeRunStartRequest,
    RuntimeRunStreamRequest,
    RuntimeScaffold,
    RuntimeThinkingCapabilityGetRequest,
    RuntimeThinkingSelection,
    RuntimeThinkingValue,
    RuntimeToolApprovalResolveRequest,
    RuntimeThreadCreateRequest,
    RuntimeThreadGetRequest,
    normalize_thinking_level_intent,
)
from .errors import (
    RuntimeErrorResponse,
    build_agent_not_found_error,
    build_invalid_request_error,
    build_unsupported_message_shape_error,
)
from .model_routes import RuntimeModelRoute, RuntimeModelRouteRef


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

    def extract_global_tool_catalog_get_request(
        self,
        payload: dict[str, Any] | None,
    ) -> str | None:
        request_body = self._require_payload_body(
            payload,
            requested_method=GLOBAL_TOOL_CATALOG_GET_METHOD,
        )
        return self._optional_string(
            request_body.get("language"),
            field_name="language",
            requested_method=GLOBAL_TOOL_CATALOG_GET_METHOD,
        )

    def extract_thinking_capability_get_request(
        self,
        payload: dict[str, Any] | None,
    ) -> RuntimeThinkingCapabilityGetRequest:
        request_body = self._require_payload_body(
            payload,
            requested_method=THINKING_CAPABILITY_GET_METHOD,
        )
        session_id = self._require_non_empty_string(
            request_body.get("sessionId"),
            field_name="sessionId",
            requested_method=THINKING_CAPABILITY_GET_METHOD,
        )
        model_route = self._extract_model_route(
            request_body.get("modelRoute"),
            field_name="modelRoute",
            requested_method=THINKING_CAPABILITY_GET_METHOD,
        )
        thinking_capability_override = self._optional_object(
            request_body.get("thinkingCapabilityOverride"),
            field_name="thinkingCapabilityOverride",
            requested_method=THINKING_CAPABILITY_GET_METHOD,
        )
        return RuntimeThinkingCapabilityGetRequest(
            session_id=session_id,
            model_route=model_route,
            thinking_capability_override=thinking_capability_override,
        )

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

    def extract_tool_approval_resolve_request(
        self,
        payload: dict[str, Any] | None,
    ) -> RuntimeToolApprovalResolveRequest:
        request_body = self._require_payload_body(
            payload,
            requested_method=TOOL_APPROVAL_RESOLVE_METHOD,
        )
        run_id = self._require_non_empty_string(
            request_body.get("runId"),
            field_name="runId",
            requested_method=TOOL_APPROVAL_RESOLVE_METHOD,
        )
        tool_call_id = self._require_non_empty_string(
            request_body.get("toolCallId"),
            field_name="toolCallId",
            requested_method=TOOL_APPROVAL_RESOLVE_METHOD,
        )
        decision = self._require_non_empty_string(
            request_body.get("decision"),
            field_name="decision",
            requested_method=TOOL_APPROVAL_RESOLVE_METHOD,
        )
        if decision not in {"approved", "rejected"}:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=(
                        "Runtime request field 'decision' must be one of: approved, rejected."
                    ),
                    scaffold=self._scaffold,
                    requested_method=TOOL_APPROVAL_RESOLVE_METHOD,
                    details={"field": "decision"},
                ),
            )
        return RuntimeToolApprovalResolveRequest(
            run_id=run_id,
            tool_call_id=tool_call_id,
            decision=decision,
        )

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
    ) -> bool | None:
        if value is None:
            return None
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

    def _optional_string(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> str | None:
        if value is None:
            return None
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

    def _optional_non_negative_int(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> int | None:
        if value is None:
            return None
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=f"Runtime request field '{field_name}' must be a non-negative integer.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": field_name},
                ),
            )
        return value

    def _optional_non_empty_string(self, value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip()
        return normalized or None

    def _optional_thinking_level_intent(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> ThinkingLevelIntent | None:
        if value is None:
            return None
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
        normalized_value = normalize_thinking_level_intent(value)
        if normalized_value is None:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=(
                        f"Runtime request field '{field_name}' must be one of "
                        f"{', '.join(sorted(THINKING_LEVEL_INTENTS))}."
                    ),
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": field_name},
                ),
            )
        return normalized_value

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

    def _extract_required_model_route_ref(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> RuntimeModelRouteRef:
        route_ref = self._require_object(
            value,
            field_name=field_name,
            requested_method=requested_method,
        )
        route_kind = self._require_non_empty_string(
            route_ref.get("routeKind"),
            field_name=f"{field_name}.routeKind",
            requested_method=requested_method,
        )
        profile_id = self._require_non_empty_string(
            route_ref.get("profileId"),
            field_name=f"{field_name}.profileId",
            requested_method=requested_method,
        )
        model_id = self._require_non_empty_string(
            route_ref.get("modelId"),
            field_name=f"{field_name}.modelId",
            requested_method=requested_method,
        )
        if route_kind != "provider-model":
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=f"Runtime request field '{field_name}.routeKind' must be 'provider-model'.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": f"{field_name}.routeKind"},
                ),
            )
        return RuntimeModelRouteRef(
            route_kind=route_kind,
            profile_id=profile_id,
            model_id=model_id,
        )

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
        if policy.get("thinkingLevelIntent") is not None:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=(
                        "Runtime request field 'policy.thinkingLevelIntent' has been removed. "
                        "Use 'policy.thinkingSelection.value' with series-based selection payloads instead."
                    ),
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": "policy.thinkingLevelIntent"},
                ),
            )
        thinking_selection = self._optional_thinking_selection(
            policy.get("thinkingSelection"),
            field_name="policy.thinkingSelection",
            requested_method=requested_method,
        )
        thinking_capability_override = self._optional_object(
            policy.get("thinkingCapabilityOverride"),
            field_name="policy.thinkingCapabilityOverride",
            requested_method=requested_method,
        )
        enabled_tools = self._optional_list_of_strings(
            policy.get("enabledTools"),
            field_name="policy.enabledTools",
            requested_method=requested_method,
        )
        tool_permission_policy = self._optional_tool_permission_policy(
            policy.get("toolPermissionPolicy"),
            field_name="policy.toolPermissionPolicy",
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
            thinkingSelection=thinking_selection,
            thinkingCapabilityOverride=thinking_capability_override,
            enabledTools=enabled_tools,
            toolPermissionPolicy=tool_permission_policy,
            debugModeEnabled=debug_mode_enabled,
            requestOptions=request_options,
        )

    def _optional_tool_permission_policy(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> RuntimeToolPermissionPolicy | None:
        if value is None:
            return None
        policy = self._require_object(
            value,
            field_name=field_name,
            requested_method=requested_method,
        )
        schema_version = policy.get("schemaVersion")
        if not isinstance(schema_version, int) or isinstance(schema_version, bool):
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=f"Runtime request field '{field_name}.schemaVersion' must be an integer.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": f"{field_name}.schemaVersion"},
                ),
            )
        default_mode = self._require_tool_permission_mode(
            policy.get("defaultMode"),
            field_name=f"{field_name}.defaultMode",
            requested_method=requested_method,
        )
        raw_tool_modes = self._require_object(
            policy.get("toolModes") if policy.get("toolModes") is not None else {},
            field_name=f"{field_name}.toolModes",
            requested_method=requested_method,
        )
        tool_modes = {
            tool_id: self._require_tool_permission_mode(
                mode,
                field_name=f"{field_name}.toolModes.{tool_id}",
                requested_method=requested_method,
            )
            for tool_id, mode in raw_tool_modes.items()
            if isinstance(tool_id, str) and tool_id.strip() != ""
        }
        return RuntimeToolPermissionPolicy(
            schemaVersion=schema_version,
            defaultMode=default_mode,
            toolModes=tool_modes,
        )

    def _require_tool_permission_mode(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> str:
        normalized = self._require_non_empty_string(
            value,
            field_name=field_name,
            requested_method=requested_method,
        )
        if normalized not in {"allow", "ask", "deny"}:
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=f"Runtime request field '{field_name}' must be one of: allow, ask, deny.",
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": field_name},
                ),
            )
        return normalized

    def _optional_thinking_selection(
        self,
        value: Any,
        *,
        field_name: str,
        requested_method: str,
    ) -> RuntimeThinkingSelection | None:
        if value is None:
            return None
        selection = self._require_object(
            value,
            field_name=field_name,
            requested_method=requested_method,
        )
        value_payload = self._require_object(
            selection.get("value"),
            field_name=f"{field_name}.value",
            requested_method=requested_method,
        )
        return RuntimeThinkingSelection(
            series=self._require_non_empty_string(
                selection.get("series"),
                field_name=f"{field_name}.series",
                requested_method=requested_method,
            ),
            value=self._extract_thinking_value(
                value_payload,
                field_name=f"{field_name}.value",
                requested_method=requested_method,
            ),
        )

    def _extract_thinking_value(
        self,
        value: dict[str, Any],
        *,
        field_name: str,
        requested_method: str,
    ) -> RuntimeThinkingValue:
        value_type = self._require_non_empty_string(
            value.get("valueType"),
            field_name=f"{field_name}.valueType",
            requested_method=requested_method,
        )
        if value_type == "code":
            return RuntimeThinkingValue(
                valueType="code",
                code=self._require_non_empty_string(
                    value.get("code"),
                    field_name=f"{field_name}.code",
                    requested_method=requested_method,
                ),
                labelZh=self._optional_string(
                    value.get("labelZh"),
                    field_name=f"{field_name}.labelZh",
                    requested_method=requested_method,
                ),
            )
        if value_type == "budget":
            mode = self._require_non_empty_string(
                value.get("mode"),
                field_name=f"{field_name}.mode",
                requested_method=requested_method,
            )
            if mode not in {"off", "dynamic", "budget"}:
                raise RuntimeProtocolError(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    error=build_invalid_request_error(
                        message=(
                            f"Runtime request field '{field_name}.mode' must be one of off, dynamic, budget."
                        ),
                        scaffold=self._scaffold,
                        requested_method=requested_method,
                        details={"field": f"{field_name}.mode"},
                    ),
                )
            budget_tokens = self._optional_non_negative_int(
                value.get("budgetTokens"),
                field_name=f"{field_name}.budgetTokens",
                requested_method=requested_method,
            )
            if mode == "budget" and budget_tokens is None:
                raise RuntimeProtocolError(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    error=build_invalid_request_error(
                        message=(
                            f"Runtime request field '{field_name}.budgetTokens' is required when mode is budget."
                        ),
                        scaffold=self._scaffold,
                        requested_method=requested_method,
                        details={"field": f"{field_name}.budgetTokens"},
                    ),
                )
            return RuntimeThinkingValue(
                valueType="budget",
                mode=mode,
                budgetTokens=budget_tokens,
                labelZh=self._optional_string(
                    value.get("labelZh"),
                    field_name=f"{field_name}.labelZh",
                    requested_method=requested_method,
                ),
            )
        if value_type == "fixed":
            code = self._require_non_empty_string(
                value.get("code"),
                field_name=f"{field_name}.code",
                requested_method=requested_method,
            )
            if code != "fixed":
                raise RuntimeProtocolError(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    error=build_invalid_request_error(
                        message=f"Runtime request field '{field_name}.code' must be 'fixed'.",
                        scaffold=self._scaffold,
                        requested_method=requested_method,
                        details={"field": f"{field_name}.code"},
                    ),
                )
            return RuntimeThinkingValue(
                valueType="fixed",
                code="fixed",
                labelZh=self._optional_string(
                    value.get("labelZh"),
                    field_name=f"{field_name}.labelZh",
                    requested_method=requested_method,
                ),
            )
        raise RuntimeProtocolError(
            status_code=status.HTTP_400_BAD_REQUEST,
            error=build_invalid_request_error(
                message=(
                    f"Runtime request field '{field_name}.valueType' must be one of code, budget, fixed."
                ),
                scaffold=self._scaffold,
                requested_method=requested_method,
                details={"field": f"{field_name}.valueType"},
            ),
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
        route_ref = self._extract_required_model_route_ref(
            route.get("routeRef"),
            field_name=f"{field_name}.routeRef",
            requested_method=requested_method,
        )
        unsupported_fields = sorted(
            key for key in route.keys() if key not in {"routeRef", "catalogRevision"}
        )
        if unsupported_fields:
            unsupported_field = unsupported_fields[0]
            raise RuntimeProtocolError(
                status_code=status.HTTP_400_BAD_REQUEST,
                error=build_invalid_request_error(
                    message=(
                        f"Runtime request field '{field_name}.{unsupported_field}' is no longer supported. "
                        "Provide only 'routeRef' and optional 'catalogRevision'."
                    ),
                    scaffold=self._scaffold,
                    requested_method=requested_method,
                    details={"field": f"{field_name}.{unsupported_field}"},
                ),
            )
        catalog_revision = self._optional_non_empty_string(route.get("catalogRevision"))
        return RuntimeModelRoute(
            provider_profile_id=route_ref.profile_id,
            route_ref=route_ref,
            catalog_revision=catalog_revision,
        )

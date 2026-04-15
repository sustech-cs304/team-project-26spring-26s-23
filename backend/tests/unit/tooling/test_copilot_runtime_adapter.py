from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

import pytest

from app.tooling import (
    NormalizedToolError,
    ToolHostCapabilities,
    ToolInvocationContext,
    ToolMetadata,
    ToolResultEnvelope,
    ToolSchema,
)
from app.tooling.runtime_adapter.copilot_runtime import (
    CONTRACT_RUNTIME_TOOL_KIND,
    RuntimeToolExecutionContext,
    build_contract_runtime_binding,
    runtime_tool_execution_scope,
)


class _RecordingContractTool:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[dict[str, Any]] = []
        self._metadata = ToolMetadata(
            tool_id="campus.course-search",
            display_name="Campus Course Search",
            description="Search the campus course catalog.",
            input_schema=ToolSchema(
                schema={
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "keyword": {"type": "string", "minLength": 1},
                    },
                    "required": ["keyword"],
                }
            ),
            output_schema=ToolSchema(
                schema={
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "keyword": {"type": "string"},
                        "matches": {"type": "integer"},
                        "invocationId": {"type": "string"},
                    },
                    "required": ["keyword", "matches", "invocationId"],
                }
            ),
            idempotent=True,
        )

    @property
    def metadata(self) -> ToolMetadata:
        return self._metadata

    async def invoke(
        self,
        *,
        arguments: dict[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ToolResultEnvelope:
        self.calls.append(
            {
                "arguments": {} if arguments is None else dict(arguments),
                "context": context,
                "host": host,
            }
        )
        if self.fail:
            return ToolResultEnvelope.failure(
                error=NormalizedToolError(
                    code="invalid_input",
                    message="keyword is required.",
                    details={"field": "keyword"},
                ),
                metadata={"toolId": self.metadata.tool_id},
            )
        return ToolResultEnvelope.success(
            output={
                "keyword": None if arguments is None else arguments.get("keyword"),
                "matches": 1,
                "invocationId": context.invocation_id,
            },
            metadata={
                "toolId": self.metadata.tool_id,
                "source": "stub-contract-tool",
            },
        )


def test_build_contract_runtime_binding_maps_success_and_runtime_context() -> None:
    contract_tool = _RecordingContractTool()
    captured_runtime_contexts: list[RuntimeToolExecutionContext | None] = []
    captured_invocation_contexts: list[ToolInvocationContext] = []

    def host_factory(
        tool: _RecordingContractTool,
        invocation_context: ToolInvocationContext,
        runtime_context: RuntimeToolExecutionContext | None,
    ) -> ToolHostCapabilities:
        assert tool is contract_tool
        captured_invocation_contexts.append(invocation_context)
        captured_runtime_contexts.append(runtime_context)
        return ToolHostCapabilities()

    binding = build_contract_runtime_binding(
        contract_tool,
        host_capabilities_factory=host_factory,
    )
    runtime_context = RuntimeToolExecutionContext(
        tool_call_id="tool-call-1",
        run_id="run-1",
        actor="agent",
        requested_at=datetime(2026, 4, 13, 18, 0, tzinfo=UTC),
        trace={"source": "runtime"},
        metadata={"requestId": "request-1"},
    )

    with runtime_tool_execution_scope(runtime_context):
        result = asyncio.run(binding.execute({"keyword": "数据库"}))

    assert binding.tool_id == "campus.course-search"
    assert binding.kind == CONTRACT_RUNTIME_TOOL_KIND
    assert binding.display_name == "Campus Course Search"
    assert binding.description == "Search the campus course catalog."
    assert binding.function_name == "campus_course_search"
    assert binding.parameters_json_schema == {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "keyword": {"type": "string", "minLength": 1},
        },
        "required": ["keyword"],
    }
    assert result == {
        "status": "success",
        "output": {
            "keyword": "数据库",
            "matches": 1,
            "invocationId": "tool-call-1",
        },
        "artifacts": [],
        "metadata": {
            "toolId": "campus.course-search",
            "source": "stub-contract-tool",
        },
    }
    assert captured_runtime_contexts == [runtime_context]
    assert len(captured_invocation_contexts) == 1
    assert len(contract_tool.calls) == 1
    assert contract_tool.calls[0]["arguments"] == {"keyword": "数据库"}
    assert contract_tool.calls[0]["host"].available_capability_names() == ()
    invocation_context = contract_tool.calls[0]["context"]
    assert invocation_context.invocation_id == "tool-call-1"
    assert invocation_context.tool_id == "campus.course-search"
    assert invocation_context.run_id == "run-1"
    assert invocation_context.actor == "agent"
    assert invocation_context.requested_at == datetime(2026, 4, 13, 18, 0, tzinfo=UTC)
    assert invocation_context.trace == {"source": "runtime"}
    assert invocation_context.metadata == {"requestId": "request-1"}
    assert captured_invocation_contexts[0] == invocation_context


def test_build_contract_runtime_binding_returns_failure_envelope_for_contract_error() -> None:
    contract_tool = _RecordingContractTool(fail=True)
    binding = build_contract_runtime_binding(contract_tool)

    result = asyncio.run(binding.execute({"keyword": ""}))

    assert result == {
        "status": "error",
        "error": {
            "code": "invalid_input",
            "message": "keyword is required.",
            "retryable": False,
            "details": {"field": "keyword"},
        },
        "artifacts": [],
        "metadata": {"toolId": "campus.course-search"},
    }
    assert len(contract_tool.calls) == 1
    invocation_context = contract_tool.calls[0]["context"]
    assert invocation_context.invocation_id == "campus.course-search:direct"
    assert invocation_context.tool_id == "campus.course-search"
    assert invocation_context.run_id is None



def test_build_contract_runtime_binding_returns_failure_for_missing_error_payload() -> None:
    class _BrokenResult:
        status = "error"
        error = None

        def to_dict(self) -> dict[str, Any]:
            return {
                "status": "error",
                "artifacts": [],
                "metadata": {"toolId": "campus.course-search"},
            }

    class _BrokenContractTool(_RecordingContractTool):
        async def invoke(
            self,
            *,
            arguments: dict[str, Any] | None,
            context: ToolInvocationContext,
            host: ToolHostCapabilities,
        ) -> ToolResultEnvelope:
            self.calls.append(
                {
                    "arguments": {} if arguments is None else dict(arguments),
                    "context": context,
                    "host": host,
                }
            )
            return _BrokenResult()  # type: ignore[return-value]

    contract_tool = _BrokenContractTool()
    binding = build_contract_runtime_binding(contract_tool)

    result = asyncio.run(binding.execute({"keyword": "数据库"}))

    assert result == {
        "status": "error",
        "error": {
            "code": "execution_failed",
            "message": "Tool returned an error result without a normalized error payload.",
            "retryable": False,
            "details": {"integrity": "missing_error_payload"},
        },
        "artifacts": [],
        "metadata": {"toolId": "campus.course-search"},
    }
    assert len(contract_tool.calls) == 1

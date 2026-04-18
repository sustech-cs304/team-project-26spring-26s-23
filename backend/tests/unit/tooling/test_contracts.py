from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.tooling.contract import (
    HostCapabilityRequirement,
    NormalizedToolError,
    ToolArtifactReference,
    ToolInvocationContext,
    ToolMetadata,
    ToolResultEnvelope,
    ToolSchema,
)


def test_tool_schema_and_metadata_serialize_to_runtime_agnostic_shape() -> None:
    metadata = ToolMetadata(
        tool_id="tool.search-courses",
        display_name="Search Courses",
        description="Search normalized course data.",
        kind="query",
        version="2026-04-13",
        input_schema=ToolSchema(
            schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                },
                "required": ["query"],
            },
            schema_id="tool.search-courses.input.v1",
        ),
        output_schema=ToolSchema(
            schema={
                "type": "object",
                "properties": {
                    "items": {"type": "array"},
                },
            }
        ),
        capability_requirements=(
            HostCapabilityRequirement(
                capability="workspace_resolver",
                purpose="Resolve workspace-backed resources.",
            ),
            HostCapabilityRequirement(
                capability="event_sink",
                required=False,
                metadata={"channel": "diagnostic"},
            ),
        ),
        tags=("catalog", " search ", "catalog"),
        annotations={"owner": "tooling"},
        idempotent=True,
    )

    payload = metadata.to_dict()

    assert payload == {
        "toolId": "tool.search-courses",
        "displayName": "Search Courses",
        "description": "Search normalized course data.",
        "kind": "query",
        "version": "2026-04-13",
        "inputSchema": {
            "format": "json-schema",
            "schemaId": "tool.search-courses.input.v1",
            "schema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
        "outputSchema": {
            "format": "json-schema",
            "schema": {
                "type": "object",
                "properties": {"items": {"type": "array"}},
            },
        },
        "capabilityRequirements": [
            {
                "capability": "workspace_resolver",
                "required": True,
                "purpose": "Resolve workspace-backed resources.",
            },
            {
                "capability": "event_sink",
                "required": False,
                "metadata": {"channel": "diagnostic"},
            },
        ],
        "tags": ["catalog", "search"],
        "annotations": {"owner": "tooling"},
        "idempotent": True,
    }

    payload["annotations"]["owner"] = "changed"

    assert metadata.annotations == {"owner": "tooling"}



def test_tool_metadata_rejects_duplicate_capability_requirements() -> None:
    with pytest.raises(ValueError, match="Duplicate host capability requirement"):
        ToolMetadata(
            tool_id="tool.invalid",
            capability_requirements=(
                HostCapabilityRequirement(capability="workspace_resolver"),
                HostCapabilityRequirement(capability="workspace_resolver", required=False),
            ),
        )



def test_tool_invocation_context_requires_timezone_aware_requested_at() -> None:
    requested_at = datetime(2026, 4, 13, 23, 30, tzinfo=UTC)
    context = ToolInvocationContext(
        invocation_id="invoke-1",
        tool_id="tool.search-courses",
        actor="agent",
        run_id="run-1",
        thread_id="thread-1",
        request_id="request-1",
        requested_at=requested_at,
        trace={"traceparent": "00-abc-xyz-01"},
        metadata={"attempt": 1},
    )

    assert context.to_dict() == {
        "invocationId": "invoke-1",
        "toolId": "tool.search-courses",
        "actor": "agent",
        "runId": "run-1",
        "threadId": "thread-1",
        "requestId": "request-1",
        "requestedAt": requested_at.isoformat(),
        "trace": {"traceparent": "00-abc-xyz-01"},
        "metadata": {"attempt": 1},
    }

    with pytest.raises(ValueError, match="timezone-aware"):
        ToolInvocationContext(
            invocation_id="invoke-2",
            tool_id="tool.search-courses",
            requested_at=datetime(2026, 4, 13, 23, 30),
        )



def test_normalized_tool_error_and_result_envelope_lock_core_invariants() -> None:
    error = NormalizedToolError(
        code="timeout",
        message="Blackboard request timed out.",
        details={"timeoutSeconds": 30},
    )
    artifact = ToolArtifactReference(
        artifact_id="artifact-1",
        name="diagnostic.json",
        content_type="application/json",
        uri="artifact://diagnostic.json",
        metadata={"kind": "diagnostic"},
    )
    envelope = ToolResultEnvelope.failure(
        error=error,
        output={"stage": "fetch"},
        artifacts=(artifact,),
        metadata={"source": "unit-test"},
    )

    assert error.retryable is True
    assert envelope.to_dict() == {
        "status": "error",
        "output": {"stage": "fetch"},
        "error": {
            "code": "timeout",
            "message": "Blackboard request timed out.",
            "retryable": True,
            "details": {"timeoutSeconds": 30},
        },
        "artifacts": [
            {
                "artifactId": "artifact-1",
                "name": "diagnostic.json",
                "contentType": "application/json",
                "uri": "artifact://diagnostic.json",
                "metadata": {"kind": "diagnostic"},
            }
        ],
        "metadata": {"source": "unit-test"},
    }

    with pytest.raises(ValueError, match="Successful tool results cannot include an error payload"):
        ToolResultEnvelope(
            status="success",
            error=NormalizedToolError(code="invalid_input", message="bad input"),
        )

    with pytest.raises(ValueError, match="Error tool results must include an error payload"):
        ToolResultEnvelope(status="error")

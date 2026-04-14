from __future__ import annotations

from app.tooling import (
    MCP_HOST_CAPABILITY_BRIDGE_NOTES,
    MCP_SUPPORTED_INPUT_SCHEMA_FORMATS,
    HostCapabilityRequirement,
    ToolMetadata,
    ToolSchema,
    assess_default_contract_mcp_readiness,
    assess_mcp_tool_readiness,
    build_mcp_tool_descriptor,
)


def test_build_mcp_tool_descriptor_derives_future_exposure_shape() -> None:
    metadata = ToolMetadata(
        tool_id="Campus.Search Tool",
        display_name="Campus Search",
        description="Search campus data.",
        kind="query",
        input_schema=ToolSchema(
            schema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "keyword": {"type": "string"},
                },
                "required": ["keyword"],
            }
        ),
        tags=(" catalog ", "catalog", "search"),
        annotations={"domain": "campus"},
        idempotent=True,
    )

    descriptor = build_mcp_tool_descriptor(metadata)

    assert descriptor.to_dict() == {
        "toolId": "Campus.Search Tool",
        "name": "campus_search_tool",
        "description": "Search campus data.",
        "inputSchema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "keyword": {"type": "string"},
            },
            "required": ["keyword"],
        },
        "annotations": {
            "title": "Campus Search",
            "idempotentHint": True,
            "readOnlyHint": True,
        },
        "tags": ["catalog", "search"],
        "contractAnnotations": {"domain": "campus"},
    }



def test_assess_mcp_tool_readiness_flags_required_and_optional_host_capabilities() -> None:
    metadata = ToolMetadata(
        tool_id="campus.snapshot.sync",
        display_name="Campus Snapshot Sync",
        input_schema=ToolSchema(
            schema={
                "type": "object",
                "additionalProperties": False,
                "properties": {},
            }
        ),
        capability_requirements=(
            HostCapabilityRequirement(
                capability="event_sink",
                required=False,
                purpose="Emit progress.",
            ),
            HostCapabilityRequirement(
                capability="secret_provider",
                required=True,
                purpose="Resolve credentials.",
                metadata={"scope": "campus"},
            ),
        ),
        idempotent=False,
    )

    report = assess_mcp_tool_readiness(metadata)

    assert report.ready_for_exposure is False
    assert report.supported_input_schema is True
    assert report.requires_capability_bridge is True
    assert report.descriptor.to_dict() == {
        "toolId": "campus.snapshot.sync",
        "name": "campus_snapshot_sync",
        "inputSchema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {},
        },
        "annotations": {
            "title": "Campus Snapshot Sync",
            "idempotentHint": False,
            "destructiveHint": True,
        },
    }
    assert report.capability_readiness[0].to_dict() == {
        "capability": "event_sink",
        "required": False,
        "directlySupported": False,
        "purpose": "Emit progress.",
        "note": MCP_HOST_CAPABILITY_BRIDGE_NOTES["event_sink"],
    }
    assert report.capability_readiness[1].to_dict() == {
        "capability": "secret_provider",
        "required": True,
        "directlySupported": False,
        "purpose": "Resolve credentials.",
        "note": MCP_HOST_CAPABILITY_BRIDGE_NOTES["secret_provider"],
        "metadata": {"scope": "campus"},
    }
    assert report.blocking_reasons == (
        "Host capability 'secret_provider' is not directly satisfiable in bare MCP mode.",
    )
    assert report.warnings == (
        "Host capability 'event_sink' is not directly satisfiable in bare MCP mode.",
    )



def test_assess_mcp_tool_readiness_accepts_supported_capabilities_and_rejects_schema_mismatch() -> None:
    metadata = ToolMetadata(
        tool_id="campus.report.fetch",
        input_schema=ToolSchema(format="custom-schema"),
        capability_requirements=(
            HostCapabilityRequirement(capability="workspace_resolver"),
        ),
    )

    report = assess_mcp_tool_readiness(
        metadata,
        direct_host_capabilities=("workspace_resolver",),
    )

    assert report.ready_for_exposure is False
    assert report.supported_input_schema is False
    assert report.requires_capability_bridge is False
    assert report.capability_readiness[0].to_dict() == {
        "capability": "workspace_resolver",
        "required": True,
        "directlySupported": True,
    }
    assert report.blocking_reasons == (
        "MCP readiness currently requires json-schema input descriptors; tool uses 'custom-schema'.",
    )
    assert report.warnings == ()



def test_assess_default_contract_mcp_readiness_reports_current_facade_tools_as_bridge_ready() -> None:
    reports = assess_default_contract_mcp_readiness()

    assert MCP_SUPPORTED_INPUT_SCHEMA_FORMATS == ("json-schema",)
    assert len(reports) == 6
    by_tool_id = {report.tool_id: report for report in reports}
    assert set(by_tool_id) == {
        "blackboard.course_catalog.search",
        "blackboard.calendar.refresh",
        "blackboard.snapshot.sync",
        "tis.personal_grades.fetch",
        "tis.credit_gpa.fetch",
        "tis.selected_courses.fetch",
    }

    course_catalog_report = by_tool_id["blackboard.course_catalog.search"]
    assert course_catalog_report.ready_for_exposure is True
    assert course_catalog_report.supported_input_schema is True
    assert course_catalog_report.requires_capability_bridge is True
    assert course_catalog_report.blocking_reasons == ()
    assert course_catalog_report.warnings == (
        "Host capability 'secret_provider' is not directly satisfiable in bare MCP mode.",
        "Host capability 'event_sink' is not directly satisfiable in bare MCP mode.",
    )

    snapshot_report = by_tool_id["blackboard.snapshot.sync"]
    assert snapshot_report.ready_for_exposure is True
    assert snapshot_report.requires_capability_bridge is True
    assert [
        readiness.capability for readiness in snapshot_report.capability_readiness
    ] == [
        "secret_provider",
        "workspace_resolver",
        "state_store",
        "artifact_store",
        "event_sink",
    ]
    assert snapshot_report.blocking_reasons == ()
    assert snapshot_report.warnings == (
        "Host capability 'secret_provider' is not directly satisfiable in bare MCP mode.",
        "Host capability 'workspace_resolver' is not directly satisfiable in bare MCP mode.",
        "Host capability 'state_store' is not directly satisfiable in bare MCP mode.",
        "Host capability 'artifact_store' is not directly satisfiable in bare MCP mode.",
        "Host capability 'event_sink' is not directly satisfiable in bare MCP mode.",
    )

    selected_courses_report = by_tool_id["tis.selected_courses.fetch"]
    assert selected_courses_report.ready_for_exposure is True
    assert selected_courses_report.descriptor.to_dict()["annotations"] == {
        "title": "TIS Selected Courses Fetch",
        "idempotentHint": False,
        "destructiveHint": True,
    }

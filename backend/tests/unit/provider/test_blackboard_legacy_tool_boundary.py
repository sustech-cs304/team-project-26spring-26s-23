from __future__ import annotations

from app.integrations.sustech import blackboard
from app.integrations.sustech.blackboard.facade import get_blackboard_tool_contracts
from app.tooling import assess_default_contract_mcp_readiness
from app.tooling.runtime_adapter.copilot_runtime import build_default_contract_runtime_bindings

_EXPECTED_ROOT_EXPORTS = (
    "BLACKBOARD_FACADE_TOOLS",
    "BlackboardCalendarRefreshTool",
    "BlackboardCourseCatalogSearchTool",
    "BlackboardCourseResourcesSyncTool",
    "BlackboardSnapshotSyncTool",
    "get_blackboard_tool_contracts",
)

_EXPECTED_BLACKBOARD_TOOL_IDS = {
    "blackboard.snapshot.sync",
    "blackboard.sql.query",
}


def test_blackboard_root_package_exports_facade_surface_only() -> None:
    assert blackboard.__all__ == list(_EXPECTED_ROOT_EXPORTS)
    assert blackboard.get_blackboard_tool_contracts is get_blackboard_tool_contracts


def test_blackboard_runtime_and_mcp_default_surfaces_follow_facade_contracts() -> None:
    expected_tool_ids = {
        contract.metadata.tool_id for contract in get_blackboard_tool_contracts()
    }
    runtime_tool_ids = {
        binding.tool_id
        for binding in build_default_contract_runtime_bindings()
        if binding.tool_id.startswith("blackboard.")
    }
    readiness_tool_ids = {
        report.tool_id
        for report in assess_default_contract_mcp_readiness()
        if report.tool_id.startswith("blackboard.")
    }

    assert expected_tool_ids == _EXPECTED_BLACKBOARD_TOOL_IDS
    assert runtime_tool_ids == expected_tool_ids
    assert readiness_tool_ids == expected_tool_ids

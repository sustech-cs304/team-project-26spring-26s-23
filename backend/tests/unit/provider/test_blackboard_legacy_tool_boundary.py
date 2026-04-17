from __future__ import annotations

from app.integrations.sustech import blackboard
from app.integrations.sustech.blackboard.facade import get_blackboard_tool_contracts
from app.integrations.sustech.blackboard.provider import tools as legacy_tools_package
from app.integrations.sustech.blackboard.provider.tools import agent_tools as legacy_agent_tools
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

_LEGACY_ONLY_ROOT_EXPORTS = {
    "search_course_catalog",
    "refresh_calendar_ics",
    "sync_blackboard_snapshot",
}

_EXPECTED_BLACKBOARD_TOOL_IDS = {
    "blackboard.course_catalog.search",
    "blackboard.calendar.refresh",
    "blackboard.snapshot.sync",
    "blackboard.course_resources.sync",
    "blackboard.sql.query",
}


def test_blackboard_root_package_exports_facade_surface_only() -> None:
    assert blackboard.__all__ == list(_EXPECTED_ROOT_EXPORTS)
    assert blackboard.get_blackboard_tool_contracts is get_blackboard_tool_contracts

    for name in _LEGACY_ONLY_ROOT_EXPORTS:
        assert name not in blackboard.__all__
        assert not hasattr(blackboard, name), name


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


def test_blackboard_provider_tool_package_stays_legacy_compat_only() -> None:
    assert legacy_tools_package.__doc__ is not None
    assert "legacy compatibility" in legacy_tools_package.__doc__.lower()
    assert legacy_agent_tools.__doc__ is not None
    assert "legacy compatibility" in legacy_agent_tools.__doc__.lower()
    assert legacy_tools_package.search_course_catalog is legacy_agent_tools.search_course_catalog
    assert legacy_tools_package.refresh_calendar_ics is legacy_agent_tools.refresh_calendar_ics
    assert legacy_tools_package.sync_blackboard_snapshot is legacy_agent_tools.sync_blackboard_snapshot
    assert legacy_tools_package.sync_blackboard_course_resources is legacy_agent_tools.sync_blackboard_course_resources

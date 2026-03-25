from __future__ import annotations

from app.copilot_runtime import AgentDescriptor, AgentRegistry, build_default_agent_registry


def test_agent_registry_returns_registered_default_agent() -> None:
    registry = AgentRegistry(
        [
            AgentDescriptor(
                name="default",
                label="Default",
                description="Default runtime agent.",
                default=True,
                toolset_name="default",
            )
        ]
    )

    default_agent = registry.get_default()

    assert default_agent.name == "default"
    assert default_agent.default is True
    assert default_agent.toolset_name == "default"
    assert registry.supports("default") is True


def test_default_agent_registry_builds_info_view_and_diagnostics_summary() -> None:
    registry = build_default_agent_registry()

    assert registry.build_info_view() == {
        "default": {
            "name": "default",
            "description": "Minimal default agent exposed by the Copilot runtime run bridge.",
        }
    }
    assert registry.build_diagnostics_summary() == {
        "available_agents": ["default"],
        "default_agent": "default",
        "agent_summaries": [
            {
                "name": "default",
                "label": "Default",
                "description": "Minimal default agent exposed by the Copilot runtime run bridge.",
                "default": True,
                "toolsetName": "default",
                "hasExecutorFactory": False,
            }
        ],
    }

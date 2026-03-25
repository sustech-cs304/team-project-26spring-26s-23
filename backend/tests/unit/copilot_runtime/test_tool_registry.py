from __future__ import annotations

import pytest

from app.copilot_runtime import (
    ToolDescriptor,
    ToolRegistry,
    ToolsetDescriptor,
    build_default_tool_registry,
)


def test_tool_registry_returns_registered_default_toolset() -> None:
    registry = ToolRegistry(
        [
            ToolsetDescriptor(
                name="default",
                label="Default",
                description="Default empty toolset.",
                default=True,
                tools=(),
            )
        ]
    )

    default_toolset = registry.get_default()

    assert default_toolset.name == "default"
    assert default_toolset.default is True
    assert registry.supports("default") is True


def test_default_tool_registry_builds_view_and_diagnostics_summary() -> None:
    registry = build_default_tool_registry()

    assert registry.build_view() == {
        "default": {
            "name": "default",
            "description": "Placeholder empty toolset metadata reserved for the default Copilot agent.",
            "toolCount": 0,
        }
    }
    assert registry.build_diagnostics_summary() == {
        "available_toolsets": ["default"],
        "default_toolset": "default",
        "toolset_summaries": [
            {
                "name": "default",
                "label": "Default",
                "description": "Placeholder empty toolset metadata reserved for the default Copilot agent.",
                "default": True,
                "toolCount": 0,
                "tools": [],
            }
        ],
    }



def test_tool_registry_rejects_duplicate_names_and_multiple_defaults() -> None:
    registry = ToolRegistry()
    registry.register(
        ToolsetDescriptor(
            name="default",
            label="Default",
            description="Default empty toolset.",
            default=True,
            tools=(),
        )
    )

    with pytest.raises(ValueError, match="already registered"):
        registry.register(
            ToolsetDescriptor(
                name="default",
                label="Duplicate",
                description="Duplicate toolset.",
                default=False,
                tools=(),
            )
        )

    with pytest.raises(ValueError, match="Default toolset is already registered"):
        registry.register(
            ToolsetDescriptor(
                name="secondary",
                label="Secondary",
                description="Another default toolset.",
                default=True,
                tools=(),
            )
        )


def test_toolset_descriptor_preserves_tool_metadata_without_execution_semantics() -> None:
    registry = ToolRegistry(
        [
            ToolsetDescriptor(
                name="default",
                label="Default",
                description="Toolset with metadata only.",
                default=True,
                tools=(ToolDescriptor(name="lookup", description="Lookup metadata."),),
            )
        ]
    )

    descriptor = registry.get("default")

    assert descriptor is not None
    assert descriptor.tools == (ToolDescriptor(name="lookup", description="Lookup metadata."),)
    assert not hasattr(descriptor, "execute")
    assert not hasattr(registry, "execute")

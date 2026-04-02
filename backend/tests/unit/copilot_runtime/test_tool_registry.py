from __future__ import annotations

import asyncio
import random

import pytest

from app.copilot_runtime import (
    ToolDescriptor,
    ToolRegistry,
    ToolsetDescriptor,
    build_default_tool_registry,
)
from app.copilot_runtime.tool_registry import (
    DEFAULT_WEATHER_LOCATION,
    FILE_CONVERT_TOOL_DESCRIPTION,
    FILE_CONVERT_TOOL_DISPLAY_NAME,
    FILE_CONVERT_TOOL_ID,
    WEATHER_CURRENT_TOOL_DESCRIPTION,
    WEATHER_CURRENT_TOOL_DISPLAY_NAME,
    WEATHER_CURRENT_TOOL_ID,
    execute_weather_current_tool,
)


def test_tool_registry_returns_registered_default_toolset() -> None:
    registry = ToolRegistry(
        [
            ToolsetDescriptor(
                name="default",
                label="Default",
                description="Default toolset.",
                default=True,
                tools=(),
            )
        ]
    )

    default_toolset = registry.get_default()

    assert default_toolset.name == "default"
    assert default_toolset.default is True
    assert registry.supports("default") is True



def test_default_tool_registry_builds_view_catalog_and_diagnostics_summary() -> None:
    registry = build_default_tool_registry()

    assert registry.build_view() == {
        "default": {
            "name": "default",
            "description": "Builtin Copilot runtime tools exposed as the default toolset directory.",
            "toolCount": 2,
        }
    }
    assert registry.build_tool_catalog() == (
        {
            "toolId": FILE_CONVERT_TOOL_ID,
            "kind": "builtin",
            "availability": "available",
            "displayName": FILE_CONVERT_TOOL_DISPLAY_NAME,
            "description": FILE_CONVERT_TOOL_DESCRIPTION,
        },
        {
            "toolId": WEATHER_CURRENT_TOOL_ID,
            "kind": "builtin",
            "availability": "available",
            "displayName": WEATHER_CURRENT_TOOL_DISPLAY_NAME,
            "description": WEATHER_CURRENT_TOOL_DESCRIPTION,
        },
    )
    assert registry.list_tool_ids() == (FILE_CONVERT_TOOL_ID, WEATHER_CURRENT_TOOL_ID)
    assert registry.build_diagnostics_summary() == {
        "available_toolsets": ["default"],
        "default_toolset": "default",
        "tool_directory_version": "tools-v1",
        "toolset_summaries": [
            {
                "name": "default",
                "label": "Default",
                "description": "Builtin Copilot runtime tools exposed as the default toolset directory.",
                "default": True,
                "toolCount": 2,
                "tools": [
                    {
                        "toolId": FILE_CONVERT_TOOL_ID,
                        "kind": "builtin",
                        "availability": "available",
                        "displayName": FILE_CONVERT_TOOL_DISPLAY_NAME,
                        "description": FILE_CONVERT_TOOL_DESCRIPTION,
                    },
                    {
                        "toolId": WEATHER_CURRENT_TOOL_ID,
                        "kind": "builtin",
                        "availability": "available",
                        "displayName": WEATHER_CURRENT_TOOL_DISPLAY_NAME,
                        "description": WEATHER_CURRENT_TOOL_DESCRIPTION,
                    },
                ],
            }
        ],
    }



def test_weather_tool_execution_uses_default_location_and_random_sample() -> None:
    result = asyncio.run(execute_weather_current_tool(None, rng=random.Random(0)))

    assert result["location"] == DEFAULT_WEATHER_LOCATION
    assert result["condition"] in {"晴", "多云", "小雨"}
    assert isinstance(result["temperatureC"], int)
    assert isinstance(result["humidity"], int)
    assert isinstance(result["summary"], str)
    assert result["summary"] != ""



def test_tool_registry_rejects_duplicate_names_and_multiple_defaults() -> None:
    registry = ToolRegistry()
    registry.register(
        ToolsetDescriptor(
            name="default",
            label="Default",
            description="Default toolset.",
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



def test_tool_registry_rejects_duplicate_tool_ids_within_toolset() -> None:
    registry = ToolRegistry()

    with pytest.raises(ValueError, match="duplicate tool id 'tool.lookup'"):
        registry.register(
            ToolsetDescriptor(
                name="default",
                label="Default",
                description="Default toolset.",
                default=True,
                tools=(
                    ToolDescriptor(tool_id="tool.lookup", display_name="Lookup"),
                    ToolDescriptor(tool_id="tool.lookup", display_name="Lookup Duplicate"),
                ),
            )
        )



def test_toolset_descriptor_preserves_stable_tool_id_and_display_hints_without_execution_semantics() -> None:
    registry = ToolRegistry(
        [
            ToolsetDescriptor(
                name="default",
                label="Default",
                description="Toolset with metadata only.",
                default=True,
                tools=(
                    ToolDescriptor(
                        tool_id="tool.lookup",
                        kind="builtin",
                        display_name="Lookup",
                        description="Lookup metadata.",
                    ),
                ),
            )
        ]
    )

    descriptor = registry.get("default")

    assert descriptor is not None
    assert descriptor.tools == (
        ToolDescriptor(
            tool_id="tool.lookup",
            kind="builtin",
            display_name="Lookup",
            description="Lookup metadata.",
        ),
    )
    assert descriptor.tools[0].build_catalog_entry()["toolId"] == "tool.lookup"
    assert not hasattr(descriptor, "execute")
    assert not hasattr(registry, "execute")



def test_tool_registry_resolve_tool_upgrades_metadata_only_descriptor_to_executable_item() -> None:
    registry = ToolRegistry(
        [
            ToolsetDescriptor(
                name="default",
                label="Default",
                description="Toolset with metadata only.",
                default=True,
                tools=(
                    ToolDescriptor(
                        tool_id="tool.lookup",
                        kind="builtin",
                        display_name="Lookup",
                        description="Lookup metadata.",
                    ),
                ),
            )
        ]
    )

    resolved_tool = registry.resolve_tool("tool.lookup")

    assert resolved_tool.tool_id == "tool.lookup"
    with pytest.raises(RuntimeError, match="not implemented"):
        asyncio.run(resolved_tool.execute(None))

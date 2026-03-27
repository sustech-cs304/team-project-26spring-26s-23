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
            "toolCount": 1,
        }
    }
    assert registry.build_tool_catalog() == (
        {
            "toolId": "tool.file-convert",
            "kind": "builtin",
            "availability": "available",
            "displayName": "File Convert",
            "description": "Convert DOCX, PDF, and PPTX files into text.",
        },
    )
    assert registry.list_tool_ids() == ("tool.file-convert",)
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
                "toolCount": 1,
                "tools": [
                    {
                        "toolId": "tool.file-convert",
                        "kind": "builtin",
                        "availability": "available",
                        "displayName": "File Convert",
                        "description": "Convert DOCX, PDF, and PPTX files into text.",
                    }
                ],
            }
        ],
    }


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

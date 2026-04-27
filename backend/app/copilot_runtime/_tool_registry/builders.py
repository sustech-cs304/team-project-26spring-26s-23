"""Builders for default tool registry composition."""

from __future__ import annotations

from pathlib import Path

from app.tooling.file_tools import (
    build_file_tool_edit_runtime_binding,
    build_file_tool_glob_runtime_binding,
    build_file_tool_grep_runtime_binding,
    build_file_tool_notebook_edit_runtime_binding,
    build_file_tool_read_runtime_binding,
    build_file_tool_switch_root_runtime_binding,
    build_file_tool_write_runtime_binding,
)
from app.tooling.runtime_adapter.copilot_runtime import (
    ToolHostCapabilitiesFactory,
    build_default_contract_runtime_bindings,
)

from app.copilot_runtime.skill_snapshot_provider import (
    SKILL_ACTIVATE_FUNCTION_NAME,
    SKILL_READ_RESOURCE_FUNCTION_NAME,
    execute_skill_activate_tool,
    execute_skill_read_resource_tool,
)

from .constants import (
    DEFAULT_TOOLSET_DESCRIPTION,
    DEFAULT_TOOLSET_LABEL,
    DEFAULT_TOOLSET_NAME,
    DEFAULT_TOOL_AVAILABILITY,
    DEFAULT_TOOL_KIND,
    FILE_CONVERT_TOOL_DESCRIPTION,
    FILE_CONVERT_TOOL_DISPLAY_NAME,
    FILE_CONVERT_TOOL_ID,
    FILE_CONVERT_TOOL_PROMPT,
    FILE_TOOL_EDIT_DESCRIPTION,
    FILE_TOOL_EDIT_DISPLAY_NAME,
    FILE_TOOL_EDIT_ID,
    FILE_TOOL_EDIT_PROMPT,
    FILE_TOOL_GLOB_DESCRIPTION,
    FILE_TOOL_GLOB_DISPLAY_NAME,
    FILE_TOOL_GLOB_ID,
    FILE_TOOL_GLOB_PROMPT,
    FILE_TOOL_GREP_DESCRIPTION,
    FILE_TOOL_GREP_DISPLAY_NAME,
    FILE_TOOL_GREP_ID,
    FILE_TOOL_GREP_PROMPT,
    FILE_TOOL_NOTEBOOK_EDIT_DESCRIPTION,
    FILE_TOOL_NOTEBOOK_EDIT_DISPLAY_NAME,
    FILE_TOOL_NOTEBOOK_EDIT_ID,
    FILE_TOOL_NOTEBOOK_EDIT_PROMPT,
    FILE_TOOL_READ_DESCRIPTION,
    FILE_TOOL_READ_DISPLAY_NAME,
    FILE_TOOL_READ_ID,
    FILE_TOOL_READ_PROMPT,
    FILE_TOOL_SWITCH_ROOT_DESCRIPTION,
    FILE_TOOL_SWITCH_ROOT_DISPLAY_NAME,
    FILE_TOOL_SWITCH_ROOT_ID,
    FILE_TOOL_SWITCH_ROOT_PROMPT,
    FILE_TOOL_WRITE_DESCRIPTION,
    FILE_TOOL_WRITE_DISPLAY_NAME,
    FILE_TOOL_WRITE_ID,
    FILE_TOOL_WRITE_PROMPT,
    REQUEST_USER_FORM_PARAMETERS_JSON_SCHEMA,
    REQUEST_USER_FORM_TOOL_DESCRIPTION,
    REQUEST_USER_FORM_TOOL_DISPLAY_NAME,
    REQUEST_USER_FORM_TOOL_ID,
    REQUEST_USER_FORM_TOOL_PROMPT,
    SKILL_ACTIVATE_PARAMETERS_JSON_SCHEMA,
    SKILL_ACTIVATE_TOOL_DESCRIPTION,
    SKILL_ACTIVATE_TOOL_DISPLAY_NAME,
    SKILL_ACTIVATE_TOOL_ID,
    SKILL_ACTIVATE_TOOL_PROMPT,
    SKILL_READ_RESOURCE_PARAMETERS_JSON_SCHEMA,
    SKILL_READ_RESOURCE_TOOL_DESCRIPTION,
    SKILL_READ_RESOURCE_TOOL_DISPLAY_NAME,
    SKILL_READ_RESOURCE_TOOL_ID,
    SKILL_READ_RESOURCE_TOOL_PROMPT,
    WEATHER_CURRENT_TOOL_DESCRIPTION,
    WEATHER_CURRENT_TOOL_DISPLAY_NAME,
    WEATHER_CURRENT_TOOL_ID,
    WEATHER_CURRENT_TOOL_PROMPT,
)
from .executors import (
    execute_default_file_convert_tool,
    execute_default_weather_tool,
    execute_request_user_form_tool,
)
from .models import (
    DynamicToolLoader,
    ExecutableTool,
    ToolDescriptor,
    ToolRegistry,
    ToolsetDescriptor,
)
from .presentation import TOOL_PRESENTATION_BY_ID


def build_contract_runtime_executable_tools(
    *,
    host_capabilities_factory: ToolHostCapabilitiesFactory | None = None,
) -> tuple[ExecutableTool, ...]:
    return tuple(
        ExecutableTool(
            descriptor=ToolDescriptor(
                tool_id=binding.tool_id,
                kind=binding.kind,
                display_name=binding.display_name,
                description=binding.description,
                availability=binding.availability,
                presentation=TOOL_PRESENTATION_BY_ID.get(binding.tool_id),
            ),
            execute=binding.execute,
            function_name=binding.function_name,
            parameters_json_schema=binding.parameters_json_schema,
        )
        for binding in build_default_contract_runtime_bindings(
            host_capabilities_factory=host_capabilities_factory,
        )
    )


def build_default_tool_registry(
    *,
    host_capabilities_factory: ToolHostCapabilitiesFactory | None = None,
    workspace_root: Path | None = None,
    dynamic_tool_loader: DynamicToolLoader | None = None,
) -> ToolRegistry:
    resolved_workspace_root = (workspace_root or Path.cwd()).resolve(strict=False)
    file_read_binding = build_file_tool_read_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    file_write_binding = build_file_tool_write_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    file_edit_binding = build_file_tool_edit_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    file_glob_binding = build_file_tool_glob_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    file_grep_binding = build_file_tool_grep_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    file_notebook_edit_binding = build_file_tool_notebook_edit_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    file_switch_root_binding = build_file_tool_switch_root_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    registry = ToolRegistry(
        workspace_root=resolved_workspace_root,
        dynamic_tool_loader=dynamic_tool_loader,
    )
    registry.register(
        ToolsetDescriptor(
            name=DEFAULT_TOOLSET_NAME,
            label=DEFAULT_TOOLSET_LABEL,
            description=DEFAULT_TOOLSET_DESCRIPTION,
            default=True,
            tools=(
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_READ_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_READ_DISPLAY_NAME,
                        description=FILE_TOOL_READ_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_READ_PROMPT,
                        presentation=TOOL_PRESENTATION_BY_ID[FILE_TOOL_READ_ID],
                    ),
                    execute=file_read_binding.execute,
                    function_name=file_read_binding.function_name,
                    parameters_json_schema=file_read_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_WRITE_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_WRITE_DISPLAY_NAME,
                        description=FILE_TOOL_WRITE_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_WRITE_PROMPT,
                        presentation=TOOL_PRESENTATION_BY_ID[FILE_TOOL_WRITE_ID],
                    ),
                    execute=file_write_binding.execute,
                    function_name=file_write_binding.function_name,
                    parameters_json_schema=file_write_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_EDIT_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_EDIT_DISPLAY_NAME,
                        description=FILE_TOOL_EDIT_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_EDIT_PROMPT,
                        presentation=TOOL_PRESENTATION_BY_ID[FILE_TOOL_EDIT_ID],
                    ),
                    execute=file_edit_binding.execute,
                    function_name=file_edit_binding.function_name,
                    parameters_json_schema=file_edit_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_GLOB_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_GLOB_DISPLAY_NAME,
                        description=FILE_TOOL_GLOB_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_GLOB_PROMPT,
                        presentation=TOOL_PRESENTATION_BY_ID[FILE_TOOL_GLOB_ID],
                    ),
                    execute=file_glob_binding.execute,
                    function_name=file_glob_binding.function_name,
                    parameters_json_schema=file_glob_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_GREP_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_GREP_DISPLAY_NAME,
                        description=FILE_TOOL_GREP_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_GREP_PROMPT,
                        presentation=TOOL_PRESENTATION_BY_ID[FILE_TOOL_GREP_ID],
                    ),
                    execute=file_grep_binding.execute,
                    function_name=file_grep_binding.function_name,
                    parameters_json_schema=file_grep_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_NOTEBOOK_EDIT_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_NOTEBOOK_EDIT_DISPLAY_NAME,
                        description=FILE_TOOL_NOTEBOOK_EDIT_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_NOTEBOOK_EDIT_PROMPT,
                        presentation=TOOL_PRESENTATION_BY_ID[
                            FILE_TOOL_NOTEBOOK_EDIT_ID
                        ],
                    ),
                    execute=file_notebook_edit_binding.execute,
                    function_name=file_notebook_edit_binding.function_name,
                    parameters_json_schema=file_notebook_edit_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_SWITCH_ROOT_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_SWITCH_ROOT_DISPLAY_NAME,
                        description=FILE_TOOL_SWITCH_ROOT_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_SWITCH_ROOT_PROMPT,
                        presentation=TOOL_PRESENTATION_BY_ID[FILE_TOOL_SWITCH_ROOT_ID],
                    ),
                    execute=file_switch_root_binding.execute,
                    function_name=file_switch_root_binding.function_name,
                    parameters_json_schema=file_switch_root_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_CONVERT_TOOL_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_CONVERT_TOOL_DISPLAY_NAME,
                        description=FILE_CONVERT_TOOL_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_CONVERT_TOOL_PROMPT,
                        presentation=TOOL_PRESENTATION_BY_ID[FILE_CONVERT_TOOL_ID],
                    ),
                    execute=execute_default_file_convert_tool,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=WEATHER_CURRENT_TOOL_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=WEATHER_CURRENT_TOOL_DISPLAY_NAME,
                        description=WEATHER_CURRENT_TOOL_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=WEATHER_CURRENT_TOOL_PROMPT,
                        presentation=TOOL_PRESENTATION_BY_ID[WEATHER_CURRENT_TOOL_ID],
                    ),
                    execute=execute_default_weather_tool,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=REQUEST_USER_FORM_TOOL_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=REQUEST_USER_FORM_TOOL_DISPLAY_NAME,
                        description=REQUEST_USER_FORM_TOOL_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=REQUEST_USER_FORM_TOOL_PROMPT,
                        presentation=TOOL_PRESENTATION_BY_ID[REQUEST_USER_FORM_TOOL_ID],
                    ),
                    execute=execute_request_user_form_tool,
                    function_name="request_user_form",
                    parameters_json_schema=REQUEST_USER_FORM_PARAMETERS_JSON_SCHEMA,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=SKILL_ACTIVATE_TOOL_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=SKILL_ACTIVATE_TOOL_DISPLAY_NAME,
                        description=SKILL_ACTIVATE_TOOL_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=SKILL_ACTIVATE_TOOL_PROMPT,
                        presentation=TOOL_PRESENTATION_BY_ID[SKILL_ACTIVATE_TOOL_ID],
                    ),
                    execute=execute_skill_activate_tool,
                    function_name=SKILL_ACTIVATE_FUNCTION_NAME,
                    parameters_json_schema=SKILL_ACTIVATE_PARAMETERS_JSON_SCHEMA,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=SKILL_READ_RESOURCE_TOOL_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=SKILL_READ_RESOURCE_TOOL_DISPLAY_NAME,
                        description=SKILL_READ_RESOURCE_TOOL_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=SKILL_READ_RESOURCE_TOOL_PROMPT,
                        presentation=TOOL_PRESENTATION_BY_ID[
                            SKILL_READ_RESOURCE_TOOL_ID
                        ],
                    ),
                    execute=execute_skill_read_resource_tool,
                    function_name=SKILL_READ_RESOURCE_FUNCTION_NAME,
                    parameters_json_schema=SKILL_READ_RESOURCE_PARAMETERS_JSON_SCHEMA,
                ),
                *build_contract_runtime_executable_tools(
                    host_capabilities_factory=host_capabilities_factory,
                ),
            ),
        )
    )
    return registry

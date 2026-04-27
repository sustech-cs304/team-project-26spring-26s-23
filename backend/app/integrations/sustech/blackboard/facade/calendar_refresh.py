"""Blackboard calendar ICS refresh tool — calendar sub-domain of the Blackboard tool facade."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any, cast

from app.integrations.sustech.facade_contract_models import parse_tool_arguments
from app.integrations.sustech.blackboard.provider.results import CalendarICSSyncResult
from app.tooling import (
    HostCapabilityRequirement,
    ToolArtifactReference,
    ToolHostCapabilities,
    ToolInvocationContext,
    ToolMetadata,
)

from . import tools


class _BlackboardCalendarRefreshArguments(tools._BlackboardToolArguments):
    feedUrl: str = tools.Field(default="", validate_default=True)
    refreshMode: tools.BlackboardCalendarRefreshMode = "auto"
    resetSchema: bool = False

    @tools.field_validator("feedUrl", mode="before")
    @classmethod
    def _normalize_feed_url(cls, value: Any) -> str:
        return tools._normalize_required_text_value(value, "feedUrl")

    @tools.field_validator("refreshMode", mode="before")
    @classmethod
    def _normalize_refresh_mode(cls, value: Any) -> tools.BlackboardCalendarRefreshMode:
        return cast(
            tools.BlackboardCalendarRefreshMode,
            tools._normalize_choice_value(
                value, "refreshMode", choices=("auto", "force"), default="auto"
            ),
        )

    @tools.field_validator("resetSchema", mode="before")
    @classmethod
    def _normalize_reset_schema(cls, value: Any) -> bool:
        return tools._normalize_bool_value(value, "resetSchema", default=False)


class _BlackboardCalendarRefreshOutput(tools.SustechToolBoundaryModel):
    feedUrl: str
    refreshMode: tools.BlackboardCalendarRefreshMode
    dbPath: str
    stats: tools.JsonObject
    activeEventCount: int
    allEventCount: int
    activeEvents: tools.JsonArray
    logSummary: tools.JsonObject
    logs: tools.JsonArray


_CALENDAR_REFRESH_METADATA = ToolMetadata(
    tool_id="blackboard.calendar.refresh",
    display_name="Blackboard Calendar Refresh",
    description=(
        "Refresh a Blackboard ICS subscription into the existing SQLite store. "
        "Use refreshMode=auto for conditional requests with cached validators, "
        "or refreshMode=force to ignore cached validators and re-download the ICS payload."
    ),
    input_schema=tools._schema(
        properties={
            "feedUrl": {
                "type": "string",
                "minLength": 1,
                "description": "Blackboard ICS subscription URL to refresh and sync into the local calendar database.",
            },
            "refreshMode": {
                "type": "string",
                "enum": ["auto", "force"],
                "default": "auto",
                "description": (
                    "auto reuses saved ETag/Last-Modified headers for conditional refreshes; "
                    "force ignores cached validators and fetches the ICS payload again."
                ),
            },
            "dbRelativePath": {
                "type": "string",
                "description": "SQLite path relative to the host database directory. Omit it to use the default Blackboard database path.",
            },
            "resetSchema": {
                "type": "boolean",
                "description": "When true, recreate the target SQLite schema before refreshing the calendar feed.",
            },
            "stateKey": {
                "type": "string",
                "description": "If provided, save the refresh result under this key in the host state store.",
            },
        },
        required=("feedUrl",),
    ),
    output_schema=tools._schema(
        properties={
            "feedUrl": {"type": "string"},
            "refreshMode": {"type": "string", "enum": ["auto", "force"]},
            "dbPath": {"type": "string"},
            "stats": {"type": "object"},
            "activeEventCount": {"type": "integer"},
            "allEventCount": {"type": "integer"},
            "activeEvents": {"type": "array"},
            "logSummary": {"type": "object"},
            "logs": {"type": "array"},
        },
        required=(
            "feedUrl",
            "refreshMode",
            "dbPath",
            "stats",
            "activeEventCount",
            "allEventCount",
            "activeEvents",
            "logSummary",
            "logs",
        ),
    ),
    capability_requirements=(
        HostCapabilityRequirement(
            capability="database_resolver",
            required=False,
            purpose="Resolve a host database-relative SQLite path when dbRelativePath is used.",
        ),
        HostCapabilityRequirement(
            capability="state_store",
            required=False,
            purpose="Persist calendar refresh summaries into host-managed state.",
        ),
        HostCapabilityRequirement(
            capability="event_sink",
            required=False,
            purpose="Emit tool lifecycle events to the host.",
        ),
    ),
    tags=("blackboard", "calendar", "sync"),
    annotations={"domain": "blackboard", "facade": "tool-contract"},
    idempotent=False,
)


def _calendar_refresh_output(result: CalendarICSSyncResult) -> dict[str, Any]:
    return _BlackboardCalendarRefreshOutput(
        feedUrl=result.feed_url,
        refreshMode=cast(tools.BlackboardCalendarRefreshMode, result.refresh_mode),
        dbPath=result.db_path.as_posix(),
        stats=tools._jsonable(result.stats),
        activeEventCount=result.active_event_count,
        allEventCount=result.all_event_count,
        activeEvents=tools._jsonable(result.active_events),
        logSummary=tools._jsonable(result.log_summary),
        logs=tools._jsonable(result.logs),
    ).to_contract_dict()


class BlackboardCalendarRefreshTool(tools._BlackboardFacadeToolBase):
    _metadata = _CALENDAR_REFRESH_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        parsed_arguments = parse_tool_arguments(
            _BlackboardCalendarRefreshArguments,
            arguments,
        )
        normalized_arguments = parsed_arguments.to_contract_dict()
        db_path = tools._resolve_db_path(normalized_arguments, host)
        result = await asyncio.to_thread(
            tools.refresh_calendar_ics_subscription,
            parsed_arguments.feedUrl,
            db_path=db_path,
            reset_schema=parsed_arguments.resetSchema,
            refresh_mode=parsed_arguments.refreshMode,
        )
        output = _calendar_refresh_output(result)
        metadata = {
            "dbPathSource": tools._db_path_source(normalized_arguments),
        }
        metadata.update(
            await tools._persist_state_if_requested(
                namespace=tools._STATE_NAMESPACE_CALENDAR_REFRESH,
                arguments=normalized_arguments,
                context=context,
                host=host,
                output=output,
            )
        )
        return output, (), metadata

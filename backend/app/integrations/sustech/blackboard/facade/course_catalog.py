"""Blackboard course catalog search tool — course_catalog sub-domain of the Blackboard tool facade."""

from __future__ import annotations

import asyncio
from typing import Any, cast

from app.integrations.sustech.facade_contract_models import parse_tool_arguments
from app.integrations.sustech.blackboard.provider.results import (
    CourseCatalogSearchResult,
)
from app.tooling import (
    HostCapabilityRequirement,
    ToolArtifactReference,
    ToolHostCapabilities,
    ToolInvocationContext,
    ToolMetadata,
)

from . import tools


class _BlackboardCourseCatalogSearchArguments(tools._BlackboardToolArguments):
    keyword: str = tools.Field(default="", validate_default=True)
    field: str = "CourseName"
    operator: str = "Contains"
    fetchMode: tools.BlackboardFetchMode = "full"
    maxPages: int = 30
    limit: int | None = None

    @tools.field_validator("keyword", mode="before")
    @classmethod
    def _normalize_keyword(cls, value: Any) -> str:
        return tools._normalize_required_text_value(value, "keyword")

    @tools.field_validator("field", mode="before")
    @classmethod
    def _normalize_field(cls, value: Any) -> str:
        return tools._normalize_optional_text_value(value) or "CourseName"

    @tools.field_validator("operator", mode="before")
    @classmethod
    def _normalize_operator(cls, value: Any) -> str:
        return tools._normalize_optional_text_value(value) or "Contains"

    @tools.field_validator("fetchMode", mode="before")
    @classmethod
    def _normalize_fetch_mode(cls, value: Any) -> tools.BlackboardFetchMode:
        return cast(
            tools.BlackboardFetchMode,
            tools._normalize_choice_value(
                value, "fetchMode", choices=("quick", "full"), default="full"
            ),
        )

    @tools.field_validator("maxPages", mode="before")
    @classmethod
    def _normalize_max_pages(cls, value: Any) -> int:
        normalized = tools._normalize_optional_int_value(value, "maxPages")
        return 30 if normalized is None else normalized

    @tools.field_validator("maxPages")
    @classmethod
    def _validate_max_pages(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("maxPages must be a positive integer.")
        return value

    @tools.field_validator("limit", mode="before")
    @classmethod
    def _normalize_limit(cls, value: Any) -> int | None:
        normalized = tools._normalize_optional_int_value(value, "limit")
        return normalized if normalized is not None and normalized > 0 else None


class _BlackboardCourseCatalogOutput(tools.SustechToolBoundaryModel):
    keyword: str
    field: str
    operator: str
    fetchMode: tools.BlackboardFetchMode
    maxPages: int
    limit: int | None
    total: int
    results: tools.JsonArray
    logSummary: tools.JsonObject
    logs: tools.JsonArray


_COURSE_CATALOG_SEARCH_METADATA = ToolMetadata(
    tool_id="blackboard.course_catalog.search",
    display_name="Blackboard Course Catalog Search",
    description=(
        "Search Blackboard course catalog entries with Blackboard CAS credentials. "
        "Use fetchMode=quick for a lighter first-pass search that does not follow show-all, "
        "or fetchMode=full to keep the more complete behavior; maxPages caps pagination depth."
    ),
    input_schema=tools._schema(
        properties={
            "keyword": {
                "type": "string",
                "minLength": 1,
                "description": "Search keyword sent to the Blackboard course catalog.",
            },
            "field": {
                "type": "string",
                "description": "Catalog field to search against. Defaults to `CourseName`.",
            },
            "operator": {
                "type": "string",
                "description": "Catalog comparison operator. Defaults to `Contains`.",
            },
            "fetchMode": {
                "type": "string",
                "enum": ["quick", "full"],
                "default": "full",
                "description": (
                    "quick searches only the initial result pages without following show-all; "
                    "full also follows show-all pagination for more complete results."
                ),
            },
            "maxPages": {
                "type": "integer",
                "minimum": 1,
                "default": 30,
                "description": "Maximum number of result pages to continue fetching before stopping.",
            },
            "limit": {
                "type": "integer",
                "description": "Optional cap on the number of catalog results returned after fetching.",
            },
            "username": {
                "type": "string",
                "description": "Blackboard/CAS username. Usually omit it to use the host's default secret; provide it only when secret lookup is unavailable or credentials are requested explicitly.",
            },
            "password": {
                "type": "string",
                "description": "Blackboard/CAS password. Usually omit it to use the host's default secret; provide it only when secret lookup is unavailable or credentials are requested explicitly.",
            },
            "usernameSecretName": {
                "type": "string",
                "description": "Host secret name that stores the Blackboard/CAS username. Usually omit it to use the default secret `sustech.username`.",
            },
            "passwordSecretName": {
                "type": "string",
                "description": "Host secret name that stores the Blackboard/CAS password. Usually omit it to use the default secret `sustech.casPassword`.",
            },
        },
        required=("keyword",),
    ),
    output_schema=tools._schema(
        properties={
            "keyword": {"type": "string"},
            "field": {"type": "string"},
            "operator": {"type": "string"},
            "fetchMode": {"type": "string", "enum": ["quick", "full"]},
            "maxPages": {"type": "integer", "minimum": 1},
            "limit": {"type": ["integer", "null"]},
            "total": {"type": "integer"},
            "results": {"type": "array"},
            "logSummary": {"type": "object"},
            "logs": {"type": "array"},
        },
        required=(
            "keyword",
            "field",
            "operator",
            "fetchMode",
            "maxPages",
            "total",
            "results",
            "logSummary",
            "logs",
        ),
    ),
    capability_requirements=(
        HostCapabilityRequirement(
            capability="secret_provider",
            required=False,
            purpose="Resolve Blackboard CAS credentials from host-managed secrets.",
        ),
        HostCapabilityRequirement(
            capability="event_sink",
            required=False,
            purpose="Emit tool lifecycle events to the host.",
        ),
    ),
    tags=("blackboard", "catalog", "search"),
    annotations={"domain": "blackboard", "facade": "tool-contract"},
    idempotent=True,
)


def _course_catalog_output(
    result: CourseCatalogSearchResult,
) -> dict[str, Any]:
    return _BlackboardCourseCatalogOutput(
        keyword=result.keyword,
        field=result.field,
        operator=result.operator,
        fetchMode=cast(tools.BlackboardFetchMode, result.fetch_mode),
        maxPages=result.max_pages,
        limit=result.limit,
        total=result.total,
        results=tools._jsonable(result.results),
        logSummary=tools._jsonable(result.log_summary),
        logs=tools._jsonable(result.logs),
    ).to_contract_dict()


class BlackboardCourseCatalogSearchTool(tools._BlackboardFacadeToolBase):
    _metadata = _COURSE_CATALOG_SEARCH_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        _ = context
        parsed_arguments = parse_tool_arguments(
            _BlackboardCourseCatalogSearchArguments,
            arguments,
        )
        normalized_arguments = parsed_arguments.to_contract_dict()
        credentials = await tools._resolve_credentials(
            normalized_arguments,
            host,
            default_username_secret_name=tools._DEFAULT_SUSTECH_USERNAME_SECRET_NAME,
            default_password_secret_name=tools._DEFAULT_SUSTECH_PASSWORD_SECRET_NAME,
        )
        result = await asyncio.to_thread(
            tools.search_course_catalog_with_credentials,
            credentials.username,
            credentials.password,
            keyword=parsed_arguments.keyword,
            field=parsed_arguments.field,
            operator=parsed_arguments.operator,
            limit=parsed_arguments.limit,
            fetch_mode=parsed_arguments.fetchMode,
            max_pages=parsed_arguments.maxPages,
        )
        return (
            _course_catalog_output(result),
            (),
            {"credentialSource": credentials.source},
        )

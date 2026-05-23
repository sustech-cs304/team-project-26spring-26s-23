from __future__ import annotations

import asyncio
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from collections.abc import Mapping

import httpx

from app.integrations.sustech.blackboard import get_blackboard_tool_contracts
from app.integrations.sustech.blackboard.api.dto import (
    AnnouncementDTO,
    AssignmentDTO,
    CalendarEventDTO,
    CourseCatalogResultDTO,
    CourseDTO,
    GradeDTO,
)
from app.integrations.sustech.blackboard.facade import tools as facade_tools
from app.integrations.sustech.blackboard.facade.tools import (
    BlackboardCalendarRefreshTool,
    BlackboardCourseCatalogSearchTool,
    BlackboardCourseResourcesSyncTool,
    BlackboardSQLQueryTool,
    BlackboardSnapshotSyncTool,
)
from app.integrations.sustech.blackboard.provider.results import (
    BlackboardCourseResourcesSyncReport,
    BlackboardSnapshotFetchResult,
    BlackboardSnapshotSyncReport,
    BlackboardSyncPayloads,
    CalendarICSSyncResult,
    CourseCatalogSearchResult,
)
from app.integrations.sustech.blackboard.shared import BlackboardLogEvent
from app.tooling import HostArtifact, HostEvent, ToolHostCapabilities, ToolInvocationContext


class StubSecretProvider:
    def __init__(self, values: dict[str, str]) -> None:
        self.values = dict(values)
        self.requests: list[str] = []

    async def get_secret(self, *, name: str) -> str | None:
        self.requests.append(name)
        return self.values.get(name)

    async def has_secret(self, *, name: str) -> bool:
        self.requests.append(name)
        return name in self.values


class StubWorkspaceResolver:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.requests: list[str | None] = []

    def resolve_workspace_path(self, *, relative_path: str | None = None) -> Path:
        self.requests.append(relative_path)
        if relative_path is None:
            return self.root
        return self.root / relative_path


class StubDatabaseResolver:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.requests: list[str | None] = []

    def resolve_database_path(self, *, relative_path: str | None = None) -> Path:
        self.requests.append(relative_path)
        if relative_path is None:
            return self.root
        return self.root / relative_path


class StubStateStore:
    def __init__(self) -> None:
        self.values: dict[tuple[str, str], dict[str, Any]] = {}

    async def get(self, *, namespace: str, key: str) -> dict[str, Any] | None:
        return self.values.get((namespace, key))

    async def put(self, *, namespace: str, key: str, value: Mapping[str, Any]) -> None:
        self.values[(namespace, key)] = dict(value)

    async def delete(self, *, namespace: str, key: str) -> None:
        self.values.pop((namespace, key), None)


class StubArtifactStore:
    def __init__(self) -> None:
        self.saved_texts: list[dict[str, Any]] = []
        self.artifacts: dict[str, HostArtifact] = {}

    async def save_text(
        self,
        *,
        name: str,
        text: str,
        content_type: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> HostArtifact:
        self.saved_texts.append(
            {
                "name": name,
                "text": text,
                "content_type": content_type,
                "metadata": {} if metadata is None else dict(metadata),
            }
        )
        artifact = HostArtifact(
            artifact_id="artifact-1",
            uri="artifact://blackboard/snapshot.json",
            name=name,
            content_type=content_type,
            metadata={} if metadata is None else dict(metadata),
        )
        self.artifacts[artifact.artifact_id] = artifact
        return artifact

    async def save_bytes(
        self,
        *,
        name: str,
        content: bytes,
        content_type: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> HostArtifact:
        raise AssertionError(f"save_bytes should not be called in these tests: {name}, {len(content)}")

    async def describe_artifact(self, *, artifact_id: str) -> HostArtifact:
        return self.artifacts[artifact_id]


class StubEventSink:
    def __init__(self) -> None:
        self.events: list[HostEvent] = []

    def emit(self, event: HostEvent) -> None:
        self.events.append(event)


class _NoopDatabaseResolver:
    def resolve_database_path(self, *, relative_path: str | None = None) -> Path:
        return Path("database") if relative_path is None else Path("database") / relative_path


def _create_sqlite_db(path: Path, *, script: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(path)) as connection:
        connection.executescript(script)
    return path


def _invoke_tool(
    tool: (
        BlackboardCourseCatalogSearchTool
        | BlackboardCalendarRefreshTool
        | BlackboardSnapshotSyncTool
        | BlackboardCourseResourcesSyncTool
        | BlackboardSQLQueryTool
    ),
    *,
    arguments: dict[str, Any] | None,
    host: ToolHostCapabilities | None = None,
) -> Any:
    invocation_context = ToolInvocationContext(
        invocation_id="invoke-1",
        tool_id=tool.metadata.tool_id,
        actor="agent",
        requested_at=datetime(2026, 4, 13, 16, 0, tzinfo=UTC),
    )
    return asyncio.run(
        tool.invoke(
            arguments=arguments,
            context=invocation_context,
            host=ToolHostCapabilities() if host is None else host,
        )
    )


def _build_log_event(source: str) -> BlackboardLogEvent:
    return BlackboardLogEvent(
        timestamp="2026-04-13T16:00:00Z",
        level="info",
        layer="provider",
        source=source,
        message="ok",
    )


def test_get_blackboard_tool_contracts_exposes_stable_tools_and_requirements() -> None:
    tool_ids = [tool.metadata.tool_id for tool in get_blackboard_tool_contracts()]

    assert tool_ids == [
        "blackboard.snapshot.sync",
        "blackboard.sql.query",
    ]

    snapshot_tool = BlackboardSnapshotSyncTool()
    requirements = {
        requirement.capability: requirement for requirement in snapshot_tool.metadata.capability_requirements
    }
    snapshot_input_schema = snapshot_tool.metadata.input_schema.schema

    assert requirements["secret_provider"].required is False
    assert requirements["database_resolver"].required is False
    assert requirements["state_store"].required is False
    assert requirements["artifact_store"].required is False
    assert requirements["event_sink"].required is False
    assert snapshot_tool.metadata.idempotent is False
    assert "resourceCourseLimit" not in snapshot_input_schema["properties"]
    assert "resourceCourseLimit" not in snapshot_input_schema.get("required", [])


def test_blackboard_tool_input_schemas_describe_each_parameter() -> None:
    tools = (
        BlackboardCourseCatalogSearchTool(),
        BlackboardCalendarRefreshTool(),
        BlackboardSnapshotSyncTool(),
        BlackboardCourseResourcesSyncTool(),
        BlackboardSQLQueryTool(),
    )

    for tool in tools:
        properties = tool.metadata.input_schema.schema["properties"]
        assert properties
        for field_name, schema in properties.items():
            description = schema.get("description")
            assert isinstance(description, str), (
                f"{tool.metadata.tool_id}.{field_name} is missing a description"
            )
            assert description.strip() != "", (
                f"{tool.metadata.tool_id}.{field_name} has an empty description"
            )


def test_course_catalog_tool_invokes_use_case_and_shapes_output(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}
    event_sink = StubEventSink()

    def _fake_search(
        username: str,
        password: str,
        *,
        keyword: str,
        field: str = "CourseName",
        operator: str = "Contains",
        limit: int | None = None,
        fetch_mode: str = "full",
        max_pages: int = 30,
    ) -> CourseCatalogSearchResult:
        captured.update(
            {
                "username": username,
                "password": password,
                "keyword": keyword,
                "field": field,
                "operator": operator,
                "limit": limit,
                "fetch_mode": fetch_mode,
                "max_pages": max_pages,
            }
        )
        return CourseCatalogSearchResult(
            keyword=keyword,
            field=field,
            operator=operator,
            limit=limit,
            fetch_mode=fetch_mode,
            max_pages=max_pages,
            results=[
                CourseCatalogResultDTO(
                    course_id="_course_1",
                    course_identifier="CS305",
                    course_name="数据库系统",
                    instructor="张老师",
                )
            ],
            logs=[_build_log_event("test.catalog")],
        )

    monkeypatch.setattr(facade_tools, "search_course_catalog_with_credentials", _fake_search)

    result = _invoke_tool(
        BlackboardCourseCatalogSearchTool(),
        arguments={
            "username": " alice ",
            "password": " secret ",
            "keyword": " 数据库系统 ",
            "limit": "5",
        },
        host=ToolHostCapabilities(event_sink=event_sink),
    )

    assert result.status == "success"
    assert captured == {
        "username": "alice",
        "password": "secret",
        "keyword": "数据库系统",
        "field": "CourseName",
        "operator": "Contains",
        "limit": 5,
        "fetch_mode": "full",
        "max_pages": 30,
    }
    assert result.output == {
        "keyword": "数据库系统",
        "field": "CourseName",
        "operator": "Contains",
        "fetchMode": "full",
        "maxPages": 30,
        "limit": 5,
        "total": 1,
        "results": [
            {
                "course_id": "_course_1",
                "course_identifier": "CS305",
                "course_name": "数据库系统",
                "instructor": "张老师",
                "term": None,
                "url": None,
                "description": None,
            }
        ],
        "logSummary": {
            "total": 1,
            "by_level": {"info": 1},
            "by_layer": {"provider": 1},
            "by_source": {"test.catalog": 1},
        },
        "logs": [
            {
                "timestamp": "2026-04-13T16:00:00Z",
                "level": "info",
                "layer": "provider",
                "source": "test.catalog",
                "message": "ok",
                "context": {},
                "payload": None,
            }
        ],
    }
    assert result.metadata == {
        "toolId": "blackboard.course_catalog.search",
        "credentialSource": "arguments",
    }
    assert [event.event_type for event in event_sink.events] == [
        "blackboard.course_catalog.search.started",
        "blackboard.course_catalog.search.completed",
    ]


def test_course_catalog_tool_uses_secret_provider_and_maps_missing_credentials() -> None:
    secret_provider = StubSecretProvider(
        {
            "bb.username": "alice",
            "bb.password": "secret",
        }
    )

    original_use_case = facade_tools.search_course_catalog_with_credentials

    def _fake_search(
        username: str,
        password: str,
        *,
        keyword: str,
        field: str = "CourseName",
        operator: str = "Contains",
        limit: int | None = None,
        fetch_mode: str = "full",
        max_pages: int = 30,
    ) -> CourseCatalogSearchResult:
        assert username == "alice"
        assert password == "secret"
        assert keyword == "CS305"
        assert field == "CourseName"
        assert operator == "Contains"
        assert limit is None
        assert fetch_mode == "full"
        assert max_pages == 30
        return CourseCatalogSearchResult(
            keyword=keyword,
            field=field,
            operator=operator,
            limit=limit,
            fetch_mode=fetch_mode,
            max_pages=max_pages,
            results=[],
        )

    try:
        facade_tools.search_course_catalog_with_credentials = _fake_search
        result = _invoke_tool(
            BlackboardCourseCatalogSearchTool(),
            arguments={
                "keyword": "CS305",
                "usernameSecretName": "bb.username",
                "passwordSecretName": "bb.password",
            },
            host=ToolHostCapabilities(secret_provider=secret_provider),
        )
        error_result = _invoke_tool(
            BlackboardCourseCatalogSearchTool(),
            arguments={"keyword": "CS305"},
        )
    finally:
        facade_tools.search_course_catalog_with_credentials = original_use_case

    assert result.status == "success"
    assert result.metadata == {
        "toolId": "blackboard.course_catalog.search",
        "credentialSource": "host_secrets",
    }
    assert secret_provider.requests == ["bb.username", "bb.password"]

    assert error_result.status == "error"
    assert error_result.error is not None
    assert error_result.error.code == "host_capability_missing"
    assert error_result.error.details["capability"] == "secret_provider"
    assert error_result.error.details["exceptionType"] == "MissingHostCapabilityError"


def test_calendar_refresh_tool_resolves_database_db_path_and_persists_state(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}
    database = StubDatabaseResolver(Path("database-root"))
    state_store = StubStateStore()

    def _fake_refresh(
        feed_url: str,
        *,
        db_path: Path | None = None,
        reset_schema: bool = False,
        refresh_mode: str = "auto",
    ) -> CalendarICSSyncResult:
        captured.update(
            {
                "feed_url": feed_url,
                "db_path": db_path,
                "reset_schema": reset_schema,
                "refresh_mode": refresh_mode,
            }
        )
        event = CalendarEventDTO(
            uid="ics_1",
            raw_uid=None,
            title="Midterm",
            start_at=datetime(2026, 4, 20, 9, 0, tzinfo=UTC),
            end_at=datetime(2026, 4, 20, 11, 0, tzinfo=UTC),
            all_day=False,
        )
        return CalendarICSSyncResult(
            feed_url=feed_url,
            refresh_mode=refresh_mode,
            db_path=Path(db_path or "database-root/blackboard/sustech.db"),
            stats={
                "inserted": 1,
                "updated": 0,
                "deleted": 0,
                "parsed": 1,
                "refreshed_at": datetime(2026, 4, 13, 16, 5, 0, tzinfo=UTC),
            },
            active_events=[event],
            all_events=[event],
            logs=[_build_log_event("test.calendar")],
        )

    monkeypatch.setattr(facade_tools, "refresh_calendar_ics_subscription", _fake_refresh)

    result = _invoke_tool(
        BlackboardCalendarRefreshTool(),
        arguments={
            "feedUrl": "https://example.local/calendar.ics",
            "refreshMode": "force",
            "dbRelativePath": "blackboard/calendar.db",
            "resetSchema": "true",
            "stateKey": "calendar-latest",
        },
        host=ToolHostCapabilities(database_resolver=database, state_store=state_store),
    )

    assert result.status == "success"
    assert captured == {
        "feed_url": "https://example.local/calendar.ics",
        "db_path": Path("database-root/blackboard/calendar.db"),
        "reset_schema": True,
        "refresh_mode": "force",
    }
    assert result.output is not None
    assert result.output["feedUrl"] == "https://example.local/calendar.ics"
    assert result.output["refreshMode"] == "force"
    assert result.output["dbPath"] == "database-root/blackboard/calendar.db"
    assert result.output["stats"]["refreshed_at"] == "2026-04-13T16:05:00+00:00"
    assert result.output["activeEventCount"] == 1
    assert result.metadata == {
        "toolId": "blackboard.calendar.refresh",
        "dbPathSource": "database_relative",
        "stateNamespace": "blackboard.calendar_refresh",
        "stateKey": "calendar-latest",
    }
    assert database.requests == ["blackboard/calendar.db"]
    assert state_store.values[("blackboard.calendar_refresh", "calendar-latest")]["output"]["feedUrl"] == (
        "https://example.local/calendar.ics"
    )


def test_calendar_refresh_tool_maps_missing_database_capability() -> None:
    result = _invoke_tool(
        BlackboardCalendarRefreshTool(),
        arguments={
            "feedUrl": "https://example.local/calendar.ics",
            "dbRelativePath": "blackboard/calendar.db",
        },
    )

    assert result.status == "error"
    assert result.error is not None
    assert result.error.code == "host_capability_missing"
    assert result.error.details["capability"] == "database_resolver"
    assert result.error.details["exceptionType"] == "MissingHostCapabilityError"
    assert "traceback" in result.error.details


def test_snapshot_sync_tool_shapes_output_and_persists_artifact_and_state(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}
    database = StubDatabaseResolver(Path("database-root"))
    artifact_store = StubArtifactStore()
    state_store = StubStateStore()
    event_sink = StubEventSink()

    def _fake_sync(
        username: str,
        password: str,
        *,
        db_path: Path | None = None,
        reset_schema: bool = False,
        verify_second_sync: bool = True,
        parallel_workers: int = 1,
        progress: Any = None,
        enable_console_logging: bool = False,
    ) -> BlackboardSnapshotSyncReport:
        _ = enable_console_logging
        captured.update(
            {
                "username": username,
                "password": password,
                "db_path": db_path,
                "reset_schema": reset_schema,
                "verify_second_sync": verify_second_sync,
                "parallel_workers": parallel_workers,
            }
        )
        if progress is not None:
            progress("fetching courses")
            progress("syncing sqlite")
        snapshot = BlackboardSnapshotFetchResult(
            courses=[CourseDTO(course_id="_course_1", name="CS305 Database Systems")],
            assignments_by_course={
                "_course_1": [
                    AssignmentDTO(assignment_id="asg_1", course_id="_course_1", title="Homework 1")
                ]
            },
            resources_by_course={},
            grades_by_course={
                "_course_1": [
                    GradeDTO(
                        grade_id="grd_1",
                        course_id="_course_1",
                        assignment_id=None,
                        item_name="Homework 1",
                    )
                ]
            },
            announcements=[
                AnnouncementDTO(
                    announcement_id="ann_1",
                    course_id="_course_1",
                    course_name="CS305 Database Systems",
                    title="Welcome",
                )
            ],
            logs=[_build_log_event("test.snapshot.fetch")],
        )
        payloads = BlackboardSyncPayloads(
            course_payload=[{"course_id": "_course_1"}],
            assignment_payloads={"_course_1": [{"assignment_id": "asg_1"}]},
            resource_payloads={},
            grade_payloads={"_course_1": [{"grade_id": "grd_1"}]},
            announcements_payload=[{"announcement_id": "ann_1"}],
        )
        return BlackboardSnapshotSyncReport(
            db_path=Path(db_path or "database-root/blackboard/sustech.db"),
            snapshot=snapshot,
            payloads=payloads,
            first_sync_stats={
                "courses": {"inserted": 1, "updated": 0, "deleted": 0},
                "assignments": {"inserted": 1, "updated": 0, "deleted": 0},
                "resources": {"inserted": 0, "updated": 0, "deleted": 0},
                "grades": {"inserted": 1, "updated": 0, "deleted": 0},
                "announcements": {"inserted": 1, "updated": 0, "deleted": 0},
            },
            second_sync_stats={
                "courses": {"inserted": 0, "updated": 1, "deleted": 0},
                "assignments": {"inserted": 0, "updated": 1, "deleted": 0},
                "resources": {"inserted": 0, "updated": 0, "deleted": 0},
                "grades": {"inserted": 0, "updated": 1, "deleted": 0},
                "announcements": {"inserted": 0, "updated": 1, "deleted": 0},
            },
            table_counts={
                "courses": {"total": 1, "active": 1},
                "assignments": {"total": 1, "active": 1},
                "resources": {"total": 0, "active": 0},
                "grades": {"total": 1, "active": 1},
                "announcements": {"total": 1, "active": 1},
            },
            expected_active_counts={
                "courses": 1,
                "assignments": 1,
                "resources": 0,
                "grades": 1,
                "announcements": 1,
            },
            integrity_ok=True,
            logs=[_build_log_event("test.snapshot.sync")],
        )

    monkeypatch.setattr(facade_tools, "run_blackboard_snapshot_sync", _fake_sync)

    result = _invoke_tool(
        BlackboardSnapshotSyncTool(),
        arguments={
            "username": " alice ",
            "password": " secret ",
            "dbRelativePath": "blackboard/snapshot.db",
            "verifySecondSync": "false",
            "parallelWorkers": 4,
            "stateKey": "snapshot-latest",
            "artifactName": "snapshot.json",
        },
        host=ToolHostCapabilities(
            database_resolver=database,
            artifact_store=artifact_store,
            state_store=state_store,
            event_sink=event_sink,
        ),
    )

    assert result.status == "success"
    assert captured == {
        "username": "alice",
        "password": "secret",
        "db_path": Path("database-root/blackboard/snapshot.db"),
        "reset_schema": False,
        "verify_second_sync": False,
        "parallel_workers": 4,
    }
    assert result.output is not None
    assert set(result.output) == {
        "dbPath",
        "scrapedCounts",
        "firstSyncStats",
        "secondSyncStats",
        "tableCounts",
        "expectedActiveCounts",
        "integrityOk",
        "secondSyncHasNoNewRecords",
        "secondSyncHasNoDeletedRecords",
        "logSummary",
        "persistence",
    }
    assert "resourceCourseLimit" not in result.output
    assert result.output["dbPath"] == "database-root/blackboard/snapshot.db"
    assert result.output["scrapedCounts"] == {
        "courses": 1,
        "assignments": 1,
        "resources": 0,
        "grades": 1,
        "announcements": 1,
    }
    assert result.output["firstSyncStats"] == {
        "courses": {"inserted": 1, "updated": 0, "deleted": 0},
        "assignments": {"inserted": 1, "updated": 0, "deleted": 0},
        "resources": {"inserted": 0, "updated": 0, "deleted": 0},
        "grades": {"inserted": 1, "updated": 0, "deleted": 0},
        "announcements": {"inserted": 1, "updated": 0, "deleted": 0},
    }
    assert result.output["secondSyncStats"] == {
        "courses": {"inserted": 0, "updated": 1, "deleted": 0},
        "assignments": {"inserted": 0, "updated": 1, "deleted": 0},
        "resources": {"inserted": 0, "updated": 0, "deleted": 0},
        "grades": {"inserted": 0, "updated": 1, "deleted": 0},
        "announcements": {"inserted": 0, "updated": 1, "deleted": 0},
    }
    assert result.output["tableCounts"] == {
        "courses": {"total": 1, "active": 1},
        "assignments": {"total": 1, "active": 1},
        "resources": {"total": 0, "active": 0},
        "grades": {"total": 1, "active": 1},
        "announcements": {"total": 1, "active": 1},
    }
    assert result.output["expectedActiveCounts"] == {
        "courses": 1,
        "assignments": 1,
        "resources": 0,
        "grades": 1,
        "announcements": 1,
    }
    assert result.output["integrityOk"] is True
    assert result.output["secondSyncHasNoNewRecords"] is True
    assert result.output["secondSyncHasNoDeletedRecords"] is True
    assert result.metadata == {
        "toolId": "blackboard.snapshot.sync",
        "credentialSource": "arguments",
        "dbPathSource": "database_relative",
        "stateNamespace": "blackboard.snapshot_sync",
        "stateKey": "snapshot-latest",
    }
    assert len(result.artifacts) == 1
    assert result.artifacts[0].artifact_id == "artifact-1"
    assert result.output["persistence"] == {
        "state": {
            "namespace": "blackboard.snapshot_sync",
            "key": "snapshot-latest",
        },
        "artifacts": [result.artifacts[0].to_dict()],
    }
    assert "logs" not in result.output
    assert "progressMessages" not in result.output
    assert "courses" not in result.output
    assert "payloads" not in result.output
    assert database.requests == ["blackboard/snapshot.db"]
    persisted_artifact_output = json.loads(artifact_store.saved_texts[0]["text"])
    persisted_state_output = state_store.values[("blackboard.snapshot_sync", "snapshot-latest")]["output"]
    latest_status = state_store.values[
        (
            facade_tools._STATE_NAMESPACE_SNAPSHOT_SYNC,
            facade_tools._LATEST_STATUS_STATE_KEY,
        )
    ]
    assert persisted_state_output == persisted_artifact_output
    assert set(persisted_artifact_output) == {
        "dbPath",
        "scrapedCounts",
        "firstSyncStats",
        "secondSyncStats",
        "tableCounts",
        "expectedActiveCounts",
        "integrityOk",
        "secondSyncHasNoNewRecords",
        "secondSyncHasNoDeletedRecords",
        "logSummary",
        "logs",
        "progressMessages",
    }
    assert "resourceCourseLimit" not in persisted_artifact_output
    assert persisted_artifact_output["progressMessages"] == ["fetching courses", "syncing sqlite"]
    assert persisted_artifact_output["scrapedCounts"]["resources"] == 0
    assert persisted_artifact_output["tableCounts"]["resources"] == {"total": 0, "active": 0}
    assert "resourcePayloadsByCourse" not in persisted_artifact_output
    assert "courses" not in persisted_artifact_output
    assert "payloads" not in persisted_artifact_output
    assert latest_status["status"] == "completed"
    assert latest_status["lastSyncError"] is None
    assert latest_status["progressMessage"] is None
    assert latest_status["progressStage"] is None
    assert latest_status["progressLogs"] == ["fetching courses", "syncing sqlite"]
    assert [event.event_type for event in event_sink.events] == [
        "blackboard.snapshot.sync.started",
        "blackboard.snapshot.sync.completed",
    ]


def test_snapshot_sync_tool_persists_failed_latest_status(monkeypatch: Any) -> None:
    state_store = StubStateStore()

    def _boom_sync(*_args: Any, **_kwargs: Any) -> BlackboardSnapshotSyncReport:
        raise RuntimeError("snapshot boom")

    monkeypatch.setattr(facade_tools, "run_blackboard_snapshot_sync", _boom_sync)

    result = _invoke_tool(
        BlackboardSnapshotSyncTool(),
        arguments={
            "username": "alice",
            "password": "secret",
        },
        host=ToolHostCapabilities(
            database_resolver=StubDatabaseResolver(Path("database-root")),
            state_store=state_store,
        ),
    )

    assert result.status == "error"
    latest_status = state_store.values[
        (
            facade_tools._STATE_NAMESPACE_SNAPSHOT_SYNC,
            facade_tools._LATEST_STATUS_STATE_KEY,
        )
    ]
    assert latest_status["status"] == "failed"
    assert latest_status["lastSyncError"] == "snapshot boom"
    assert latest_status["progressMessage"] == "snapshot boom"
    assert latest_status["progressStage"] is None
    assert latest_status["progressLogs"] == ["snapshot boom"]


def test_course_resources_sync_tool_requires_course_ids_and_persists_artifact_and_state(
    monkeypatch: Any,
) -> None:
    error_result = _invoke_tool(
        BlackboardCourseResourcesSyncTool(),
        arguments={"username": "alice", "password": "secret"},
    )

    assert error_result.status == "error"
    assert error_result.error is not None
    assert error_result.error.code == "invalid_input"
    assert error_result.error.message == "courseIds must be an array of non-empty strings."

    captured: dict[str, Any] = {}
    database = StubDatabaseResolver(Path("database-root"))
    artifact_store = StubArtifactStore()
    state_store = StubStateStore()
    event_sink = StubEventSink()

    def _fake_sync(
        username: str,
        password: str,
        *,
        course_ids: list[str],
        db_path: Path | None = None,
        reset_schema: bool = False,
        progress: Any = None,
        enable_console_logging: bool = False,
    ) -> BlackboardCourseResourcesSyncReport:
        _ = enable_console_logging
        captured.update(
            {
                "username": username,
                "password": password,
                "course_ids": list(course_ids),
                "db_path": db_path,
                "reset_schema": reset_schema,
            }
        )
        if progress is not None:
            progress("fetching requested courses")
            progress("syncing resources")
        return BlackboardCourseResourcesSyncReport(
            db_path=Path(db_path or "database-root/blackboard/sustech.db"),
            requested_course_ids=list(course_ids),
            processed_course_ids=["_course_1", "_course_2"],
            missing_course_ids=["_course_missing"],
            failed_course_ids=["_course_failed"],
            resource_payloads_by_course={
                "_course_1": [{"resource_id": "res_1"}],
                "_course_2": [{"resource_id": "res_2"}, {"resource_id": "res_3"}],
            },
            sync_stats={
                "courses": {"inserted": 2, "updated": 0, "deleted": 0},
                "assignments": {"inserted": 2, "updated": 0, "deleted": 0},
                "resources": {"inserted": 3, "updated": 0, "deleted": 0},
                "grades": {"inserted": 0, "updated": 0, "deleted": 0},
                "announcements": {"inserted": 0, "updated": 0, "deleted": 0},
            },
            table_counts={
                "courses": {"total": 2, "active": 2},
                "assignments": {"total": 2, "active": 2},
                "resources": {"total": 3, "active": 3},
                "grades": {"total": 0, "active": 0},
                "announcements": {"total": 0, "active": 0},
            },
            logs=[_build_log_event("test.course_resources.sync")],
        )

    monkeypatch.setattr(facade_tools, "run_blackboard_course_resources_sync", _fake_sync)

    result = _invoke_tool(
        BlackboardCourseResourcesSyncTool(),
        arguments={
            "username": " alice ",
            "password": " secret ",
            "courseIds": [" _course_1 ", "_course_2", "_course_missing", "_course_failed", "_course_2"],
            "dbRelativePath": "blackboard/course-resources.db",
            "stateKey": "course-resources-latest",
            "artifactName": "course-resources.json",
        },
        host=ToolHostCapabilities(
            database_resolver=database,
            artifact_store=artifact_store,
            state_store=state_store,
            event_sink=event_sink,
        ),
    )

    assert result.status == "success"
    assert captured == {
        "username": "alice",
        "password": "secret",
        "course_ids": ["_course_1", "_course_2", "_course_missing", "_course_failed"],
        "db_path": Path("database-root/blackboard/course-resources.db"),
        "reset_schema": False,
    }
    assert result.output is not None
    assert set(result.output) == {
        "dbPath",
        "requestedCourseIds",
        "processedCourseIds",
        "missingCourseIds",
        "failedCourseIds",
        "scrapedCounts",
        "syncStats",
        "tableCounts",
        "logSummary",
        "persistence",
    }
    assert result.output == {
        "dbPath": "database-root/blackboard/course-resources.db",
        "requestedCourseIds": ["_course_1", "_course_2", "_course_missing", "_course_failed"],
        "processedCourseIds": ["_course_1", "_course_2"],
        "missingCourseIds": ["_course_missing"],
        "failedCourseIds": ["_course_failed"],
        "scrapedCounts": {"courses": 2, "resources": 3},
        "syncStats": {
            "courses": {"inserted": 2, "updated": 0, "deleted": 0},
            "assignments": {"inserted": 2, "updated": 0, "deleted": 0},
            "resources": {"inserted": 3, "updated": 0, "deleted": 0},
            "grades": {"inserted": 0, "updated": 0, "deleted": 0},
            "announcements": {"inserted": 0, "updated": 0, "deleted": 0},
        },
        "tableCounts": {
            "courses": {"total": 2, "active": 2},
            "assignments": {"total": 2, "active": 2},
            "resources": {"total": 3, "active": 3},
            "grades": {"total": 0, "active": 0},
            "announcements": {"total": 0, "active": 0},
        },
        "logSummary": {
            "total": 1,
            "by_level": {"info": 1},
            "by_layer": {"provider": 1},
            "by_source": {"test.course_resources.sync": 1},
        },
        "persistence": {
            "state": {
                "namespace": "blackboard.course_resources_sync",
                "key": "course-resources-latest",
            },
            "artifacts": [result.artifacts[0].to_dict()],
        },
    }
    assert result.metadata == {
        "toolId": "blackboard.course_resources.sync",
        "credentialSource": "arguments",
        "dbPathSource": "database_relative",
        "stateNamespace": "blackboard.course_resources_sync",
        "stateKey": "course-resources-latest",
    }
    assert len(result.artifacts) == 1
    assert result.artifacts[0].artifact_id == "artifact-1"
    assert "logs" not in result.output
    assert "progressMessages" not in result.output
    assert "resourcePayloadsByCourse" not in result.output
    assert database.requests == ["blackboard/course-resources.db"]
    persisted_artifact_output = json.loads(artifact_store.saved_texts[0]["text"])
    persisted_state_output = state_store.values[("blackboard.course_resources_sync", "course-resources-latest")]["output"]
    assert persisted_state_output == persisted_artifact_output
    assert set(persisted_artifact_output) == {
        "dbPath",
        "requestedCourseIds",
        "processedCourseIds",
        "missingCourseIds",
        "failedCourseIds",
        "scrapedCounts",
        "syncStats",
        "tableCounts",
        "resourcePayloadsByCourse",
        "logSummary",
        "logs",
        "progressMessages",
    }
    assert persisted_artifact_output["progressMessages"] == [
        "fetching requested courses",
        "syncing resources",
    ]
    assert persisted_artifact_output["resourcePayloadsByCourse"] == {
        "_course_1": [{"resource_id": "res_1"}],
        "_course_2": [{"resource_id": "res_2"}, {"resource_id": "res_3"}],
    }
    assert [event.event_type for event in event_sink.events] == [
        "blackboard.course_resources.sync.started",
        "blackboard.course_resources.sync.completed",
    ]


def test_snapshot_sync_tool_defaults_to_sustech_secret_names_when_secret_names_omitted(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    captured: dict[str, Any] = {}
    secret_provider = StubSecretProvider(
        {
            "sustech.username": "student@sustech.edu.cn",
            "sustech.casPassword": "cas-secret",
        }
    )

    def _fake_sync(
        username: str,
        password: str,
        *,
        db_path: Path | None = None,
        reset_schema: bool = False,
        verify_second_sync: bool = True,
        parallel_workers: int = 1,
        progress: Any = None,
        enable_console_logging: bool = False,
    ) -> BlackboardSnapshotSyncReport:
        _ = (progress, enable_console_logging)
        captured.update(
            {
                "username": username,
                "password": password,
                "db_path": db_path,
                "reset_schema": reset_schema,
                "verify_second_sync": verify_second_sync,
                "parallel_workers": parallel_workers,
            }
        )
        return BlackboardSnapshotSyncReport(
            db_path=Path(db_path or "database-root/blackboard/sustech.db"),
            snapshot=BlackboardSnapshotFetchResult(
                courses=[],
                assignments_by_course={},
                resources_by_course={},
                grades_by_course={},
                announcements=[],
                logs=[_build_log_event("test.snapshot.fetch.default-secrets")],
            ),
            payloads=BlackboardSyncPayloads(
                course_payload=[],
                assignment_payloads={},
                resource_payloads={},
                grade_payloads={},
                announcements_payload=[],
            ),
            first_sync_stats={
                "courses": {"inserted": 0, "updated": 0, "deleted": 0},
                "assignments": {"inserted": 0, "updated": 0, "deleted": 0},
                "resources": {"inserted": 0, "updated": 0, "deleted": 0},
                "grades": {"inserted": 0, "updated": 0, "deleted": 0},
                "announcements": {"inserted": 0, "updated": 0, "deleted": 0},
            },
            second_sync_stats=None,
            table_counts={
                "courses": {"total": 0, "active": 0},
                "assignments": {"total": 0, "active": 0},
                "resources": {"total": 0, "active": 0},
                "grades": {"total": 0, "active": 0},
                "announcements": {"total": 0, "active": 0},
            },
            expected_active_counts={
                "courses": 0,
                "assignments": 0,
                "resources": 0,
                "grades": 0,
                "announcements": 0,
            },
            integrity_ok=True,
            logs=[_build_log_event("test.snapshot.sync.default-secrets")],
        )

    monkeypatch.setattr(facade_tools, "run_blackboard_snapshot_sync", _fake_sync)

    database = StubDatabaseResolver(tmp_path / "database-root")

    result = _invoke_tool(
        BlackboardSnapshotSyncTool(),
        arguments={},
        host=ToolHostCapabilities(secret_provider=secret_provider, database_resolver=database),
    )

    assert result.status == "success"
    assert captured == {
        "username": "student@sustech.edu.cn",
        "password": "cas-secret",
        "db_path": tmp_path / "database-root" / "blackboard/sustech.db",
        "reset_schema": False,
        "verify_second_sync": True,
        "parallel_workers": 1,
    }
    assert result.metadata == {
        "toolId": "blackboard.snapshot.sync",
        "credentialSource": "host_secrets",
        "dbPathSource": "default",
    }
    assert secret_provider.requests == ["sustech.username", "sustech.casPassword"]
    assert database.requests == ["blackboard/sustech.db"]


def test_snapshot_sync_tool_rejects_explicit_db_path() -> None:
    result = _invoke_tool(
        BlackboardSnapshotSyncTool(),
        arguments={
            "username": "alice",
            "password": "secret",
            "dbPath": "C:/tmp/blackboard-explicit.db",
        },
    )

    assert result.status == "error"
    assert result.error is not None
    assert result.error.code == "invalid_input"
    assert result.error.message == (
        "dbPath is no longer supported. Use dbRelativePath anchored under the host database directory."
    )


def test_blackboard_sql_query_tool_queries_default_database(
    tmp_path: Path,
) -> None:
    database = StubDatabaseResolver(tmp_path / "database-root")
    db_path = _create_sqlite_db(
        database.root / "blackboard/sustech.db",
        script="""
        CREATE TABLE courses (id INTEGER PRIMARY KEY, name TEXT);
        INSERT INTO courses (id, name) VALUES (1, 'CS305'), (2, 'CS307');
        """,
    )
    event_sink = StubEventSink()

    result = _invoke_tool(
        BlackboardSQLQueryTool(),
        arguments={"sql": "SELECT id, name FROM courses ORDER BY id"},
        host=ToolHostCapabilities(database_resolver=database, event_sink=event_sink),
    )

    assert result.status == "success"
    assert result.output == {
        "sql": "SELECT id, name FROM courses ORDER BY id",
        "database": {"path": db_path.as_posix(), "source": "default"},
        "usedDefaultDatabase": True,
        "hasResultSet": True,
        "columns": ["id", "name"],
        "rowsPreview": [
            {"id": 1, "name": "CS305"},
            {"id": 2, "name": "CS307"},
        ],
        "truncated": False,
        "rowCount": 2,
        "executionSummary": {
            "statementType": "SELECT",
            "previewRowCount": 2,
            "rowCount": 2,
            "message": "SQL query returned 2 row(s).",
        },
        "artifact": None,
    }
    assert result.artifacts == ()
    assert result.metadata == {
        "toolId": "blackboard.sql.query",
        "dbPathSource": "default",
        "persistArtifactRequested": False,
    }
    assert database.requests == ["blackboard/sustech.db"]
    assert [event.event_type for event in event_sink.events] == [
        "blackboard.sql.query.started",
        "blackboard.sql.query.completed",
    ]


def test_blackboard_sql_query_tool_rejects_explicit_db_path() -> None:
    artifact_store = StubArtifactStore()

    result = _invoke_tool(
        BlackboardSQLQueryTool(),
        arguments={
            "sql": "SELECT id, title FROM announcements ORDER BY id",
            "dbPath": "C:/tmp/blackboard-explicit.db",
            "resultLimit": 1,
            "persistArtifact": True,
        },
        host=ToolHostCapabilities(artifact_store=artifact_store),
    )

    assert result.status == "error"
    assert result.error is not None
    assert result.error.code == "invalid_input"
    assert result.error.message == (
        "dbPath is no longer supported. Use dbRelativePath anchored under the host database directory."
    )
    assert result.artifacts == ()


def test_snapshot_sync_tool_maps_runtime_errors(monkeypatch: Any) -> None:
    event_sink = StubEventSink()

    def _timeout_sync(
        username: str,
        password: str,
        *,
        db_path: Path | None = None,
        reset_schema: bool = False,
        verify_second_sync: bool = True,
        parallel_workers: int = 1,
        progress: Any = None,
        enable_console_logging: bool = False,
    ) -> BlackboardSnapshotSyncReport:
        _ = (
            username,
            password,
            db_path,
            reset_schema,
            verify_second_sync,
            parallel_workers,
            progress,
            enable_console_logging,
        )
        raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr(facade_tools, "run_blackboard_snapshot_sync", _timeout_sync)

    result = _invoke_tool(
        BlackboardSnapshotSyncTool(),
        arguments={"username": "alice", "password": "secret"},
        host=ToolHostCapabilities(
            event_sink=event_sink,
            database_resolver=StubDatabaseResolver(Path("database-root")),
        ),
    )

    assert result.status == "error"
    assert result.error is not None
    assert result.error.code == "timeout"
    assert result.error.message == "timed out"
    assert [event.event_type for event in event_sink.events] == [
        "blackboard.snapshot.sync.started",
        "blackboard.snapshot.sync.failed",
    ]



def test_snapshot_sync_tool_maps_explicit_invalid_credentials_message(monkeypatch: Any) -> None:
    event_sink = StubEventSink()

    def _invalid_credentials_sync(
        username: str,
        password: str,
        *,
        db_path: Path | None = None,
        reset_schema: bool = False,
        verify_second_sync: bool = True,
        parallel_workers: int = 1,
        progress: Any = None,
        enable_console_logging: bool = False,
    ) -> BlackboardSnapshotSyncReport:
        _ = (
            username,
            password,
            db_path,
            reset_schema,
            verify_second_sync,
            parallel_workers,
            progress,
            enable_console_logging,
        )
        raise RuntimeError("CAS 登录失败：用户名或密码错误，请更新设置中的 CAS 密码。")

    monkeypatch.setattr(facade_tools, "run_blackboard_snapshot_sync", _invalid_credentials_sync)

    result = _invoke_tool(
        BlackboardSnapshotSyncTool(),
        arguments={"username": "alice", "password": "secret"},
        host=ToolHostCapabilities(
            event_sink=event_sink,
            database_resolver=StubDatabaseResolver(Path("database-root")),
        ),
    )

    assert result.status == "error"
    assert result.error is not None
    assert result.error.code == "authentication_required"
    assert result.error.message == "CAS 登录失败：用户名或密码错误，请更新设置中的 CAS 密码。"
    assert [event.event_type for event in event_sink.events] == [
        "blackboard.snapshot.sync.started",
        "blackboard.snapshot.sync.failed",
    ]


def test_snapshot_sync_tool_maps_secret_lookup_without_provider_to_missing_capability() -> None:
    result = _invoke_tool(
        BlackboardSnapshotSyncTool(),
        arguments={
            "usernameSecretName": "bb.username",
            "passwordSecretName": "bb.password",
        },
        host=ToolHostCapabilities(database_resolver=_NoopDatabaseResolver()),
    )

    assert result.status == "error"
    assert result.error is not None
    assert result.error.code == "host_capability_missing"
    assert result.error.details["capability"] == "secret_provider"
    assert result.error.details["exceptionType"] == "MissingHostCapabilityError"
    assert "traceback" in result.error.details



def test_course_catalog_tool_injects_traceback_details_for_unknown_errors(monkeypatch: Any) -> None:
    def _boom_search(
        username: str,
        password: str,
        *,
        keyword: str,
        field: str = "CourseName",
        operator: str = "Contains",
        limit: int | None = None,
        fetch_mode: str = "full",
        max_pages: int = 30,
    ) -> CourseCatalogSearchResult:
        _ = (username, password, keyword, field, operator, limit, fetch_mode, max_pages)
        raise RuntimeError("blackboard search exploded")

    monkeypatch.setattr(facade_tools, "search_course_catalog_with_credentials", _boom_search)

    result = _invoke_tool(
        BlackboardCourseCatalogSearchTool(),
        arguments={"keyword": "CS305", "username": "alice", "password": "secret"},
    )

    assert result.status == "error"
    assert result.error is not None
    assert result.error.code == "execution_failed"
    assert result.error.message == "blackboard search exploded"
    assert result.error.details["exceptionType"] == "RuntimeError"
    assert result.error.details["exceptionMessage"] == "blackboard search exploded"
    assert "RuntimeError: blackboard search exploded" in result.error.details["traceback"]
    assert result.error.details["diagnosticContext"] == {
        "integration": "blackboard",
        "toolId": "blackboard.course_catalog.search",
        "invocationId": "invoke-1",
        "argumentKeys": ["keyword", "password", "username"],
    }



def test_course_catalog_tool_redacts_sensitive_values_in_enriched_error_details(
    monkeypatch: Any,
) -> None:
    sensitive_message = (
        "payload={'password': 'hunter2', 'token': 'abc123'}\n"
        "Authorization: Bearer super-secret\n"
        "cookie: session=abc"
    )

    def _boom_search(
        username: str,
        password: str,
        *,
        keyword: str,
        field: str = "CourseName",
        operator: str = "Contains",
        limit: int | None = None,
        fetch_mode: str = "full",
        max_pages: int = 30,
    ) -> CourseCatalogSearchResult:
        _ = (username, password, keyword, field, operator, limit, fetch_mode, max_pages)
        raise RuntimeError(sensitive_message)

    monkeypatch.setattr(facade_tools, "search_course_catalog_with_credentials", _boom_search)

    result = _invoke_tool(
        BlackboardCourseCatalogSearchTool(),
        arguments={"keyword": "CS305", "username": "alice", "password": "secret"},
    )

    assert result.status == "error"
    assert result.error is not None
    details = result.error.details
    assert details["exceptionType"] == "RuntimeError"
    assert "[REDACTED]" in details["exceptionMessage"]
    assert "[REDACTED]" in details["traceback"]
    assert "hunter2" not in details["exceptionMessage"]
    assert "abc123" not in details["exceptionMessage"]
    assert "super-secret" not in details["exceptionMessage"]
    assert "session=abc" not in details["exceptionMessage"]
    assert "hunter2" not in details["traceback"]
    assert "abc123" not in details["traceback"]
    assert "super-secret" not in details["traceback"]
    assert "session=abc" not in details["traceback"]

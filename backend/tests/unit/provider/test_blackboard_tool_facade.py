from __future__ import annotations

import asyncio
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

import app.integrations.sustech.blackboard.facade.tools as facade_tools
from app.integrations.sustech.blackboard import get_blackboard_tool_contracts
from app.integrations.sustech.blackboard.api.dto import (
    AnnouncementDTO,
    AssignmentDTO,
    CalendarEventDTO,
    CourseCatalogResultDTO,
    CourseDTO,
    GradeDTO,
    ResourceDTO,
)
from app.integrations.sustech.blackboard.facade.tools import (
    BlackboardCalendarRefreshTool,
    BlackboardCourseCatalogSearchTool,
    BlackboardSQLQueryTool,
    BlackboardSnapshotSyncTool,
)
from app.integrations.sustech.blackboard.provider.results import (
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


class StubWorkspaceResolver:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.requests: list[str | None] = []

    def resolve_workspace_path(self, *, relative_path: str | None = None) -> Path:
        self.requests.append(relative_path)
        if relative_path is None:
            return self.root
        return self.root / relative_path


class StubStateStore:
    def __init__(self) -> None:
        self.values: dict[tuple[str, str], dict[str, Any]] = {}

    async def get(self, *, namespace: str, key: str) -> dict[str, Any] | None:
        return self.values.get((namespace, key))

    async def put(self, *, namespace: str, key: str, value: dict[str, Any]) -> None:
        self.values[(namespace, key)] = dict(value)

    async def delete(self, *, namespace: str, key: str) -> None:
        self.values.pop((namespace, key), None)


class StubArtifactStore:
    def __init__(self) -> None:
        self.saved_texts: list[dict[str, Any]] = []

    async def save_text(
        self,
        *,
        name: str,
        text: str,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> HostArtifact:
        self.saved_texts.append(
            {
                "name": name,
                "text": text,
                "content_type": content_type,
                "metadata": {} if metadata is None else dict(metadata),
            }
        )
        return HostArtifact(
            artifact_id="artifact-1",
            uri="artifact://blackboard/snapshot.json",
            name=name,
            content_type=content_type,
            metadata={} if metadata is None else dict(metadata),
        )

    async def save_bytes(
        self,
        *,
        name: str,
        content: bytes,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> HostArtifact:
        raise AssertionError(f"save_bytes should not be called in these tests: {name}, {len(content)}")


class StubEventSink:
    def __init__(self) -> None:
        self.events: list[HostEvent] = []

    def emit(self, event: HostEvent) -> None:
        self.events.append(event)


class _NoopWorkspaceResolver:
    def resolve_workspace_path(self, *, relative_path: str | None = None) -> Path:
        return Path("workspace") if relative_path is None else Path("workspace") / relative_path


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
        "blackboard.course_catalog.search",
        "blackboard.calendar.refresh",
        "blackboard.snapshot.sync",
        "blackboard.sql.query",
    ]

    snapshot_tool = BlackboardSnapshotSyncTool()
    requirements = {
        requirement.capability: requirement for requirement in snapshot_tool.metadata.capability_requirements
    }

    assert requirements["secret_provider"].required is False
    assert requirements["workspace_resolver"].required is False
    assert requirements["state_store"].required is False
    assert requirements["artifact_store"].required is False
    assert requirements["event_sink"].required is False
    assert snapshot_tool.metadata.idempotent is False


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
    ) -> CourseCatalogSearchResult:
        captured.update(
            {
                "username": username,
                "password": password,
                "keyword": keyword,
                "field": field,
                "operator": operator,
                "limit": limit,
            }
        )
        return CourseCatalogSearchResult(
            keyword=keyword,
            field=field,
            operator=operator,
            limit=limit,
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
    }
    assert result.output == {
        "keyword": "数据库系统",
        "field": "CourseName",
        "operator": "Contains",
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
    ) -> CourseCatalogSearchResult:
        assert username == "alice"
        assert password == "secret"
        assert keyword == "CS305"
        assert field == "CourseName"
        assert operator == "Contains"
        assert limit is None
        return CourseCatalogSearchResult(keyword=keyword, field=field, operator=operator, limit=limit, results=[])

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
    assert error_result.error.code == "authentication_required"
    assert error_result.error.message == "Blackboard CAS credentials are required."


def test_calendar_refresh_tool_resolves_workspace_db_path_and_persists_state(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}
    workspace = StubWorkspaceResolver(Path("workspace-root"))
    state_store = StubStateStore()

    def _fake_refresh(
        feed_url: str,
        *,
        db_path: Path | None = None,
        reset_schema: bool = False,
    ) -> CalendarICSSyncResult:
        captured.update(
            {
                "feed_url": feed_url,
                "db_path": db_path,
                "reset_schema": reset_schema,
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
            db_path=Path(db_path or "workspace-root/backend/data/default.db"),
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
            "dbRelativePath": "backend/data/calendar.db",
            "resetSchema": "true",
            "stateKey": "calendar-latest",
        },
        host=ToolHostCapabilities(workspace_resolver=workspace, state_store=state_store),
    )

    assert result.status == "success"
    assert captured == {
        "feed_url": "https://example.local/calendar.ics",
        "db_path": Path("workspace-root/backend/data/calendar.db"),
        "reset_schema": True,
    }
    assert result.output is not None
    assert result.output["dbPath"] == "workspace-root/backend/data/calendar.db"
    assert result.output["stats"]["refreshed_at"] == "2026-04-13T16:05:00+00:00"
    assert result.output["activeEventCount"] == 1
    assert result.metadata == {
        "toolId": "blackboard.calendar.refresh",
        "dbPathSource": "workspace",
        "stateNamespace": "blackboard.calendar_refresh",
        "stateKey": "calendar-latest",
    }
    assert workspace.requests == ["backend/data/calendar.db"]
    assert state_store.values[("blackboard.calendar_refresh", "calendar-latest")]["output"]["feedUrl"] == (
        "https://example.local/calendar.ics"
    )


def test_calendar_refresh_tool_maps_missing_workspace_capability() -> None:
    result = _invoke_tool(
        BlackboardCalendarRefreshTool(),
        arguments={
            "feedUrl": "https://example.local/calendar.ics",
            "dbRelativePath": "backend/data/calendar.db",
        },
    )

    assert result.status == "error"
    assert result.error is not None
    assert result.error.code == "host_capability_missing"
    assert result.error.details["capability"] == "workspace_resolver"
    assert result.error.details["exceptionType"] == "MissingHostCapabilityError"
    assert "traceback" in result.error.details


def test_snapshot_sync_tool_shapes_output_and_persists_artifact_and_state(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}
    workspace = StubWorkspaceResolver(Path("workspace-root"))
    artifact_store = StubArtifactStore()
    state_store = StubStateStore()
    event_sink = StubEventSink()

    def _fake_sync(
        username: str,
        password: str,
        *,
        db_path: Path | None = None,
        reset_schema: bool = False,
        resource_course_limit: int = 3,
        verify_second_sync: bool = True,
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
                "resource_course_limit": resource_course_limit,
                "verify_second_sync": verify_second_sync,
            }
        )
        if progress is not None:
            progress("fetching courses")
            progress("syncing sqlite")
        snapshot = BlackboardSnapshotFetchResult(
            courses=[CourseDTO(course_id="_course_1", name="CS305 Database Systems")],
            assignments_by_course={
                "_course_1": [AssignmentDTO(assignment_id="asg_1", course_id="_course_1", title="Homework 1")]
            },
            resources_by_course={
                "_course_1": [ResourceDTO(resource_id="res_1", course_id="_course_1", title="Lecture 1")]
            },
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
            resource_course_limit=resource_course_limit,
            logs=[_build_log_event("test.snapshot.fetch")],
        )
        payloads = BlackboardSyncPayloads(
            course_payload=[{"course_id": "_course_1"}],
            assignment_payloads={"_course_1": [{"assignment_id": "asg_1"}]},
            resource_payloads={"_course_1": [{"resource_id": "res_1"}]},
            grade_payloads={"_course_1": [{"grade_id": "grd_1"}]},
            announcements_payload=[{"announcement_id": "ann_1"}],
        )
        return BlackboardSnapshotSyncReport(
            db_path=Path(db_path or "workspace-root/backend/data/default.db"),
            snapshot=snapshot,
            payloads=payloads,
            first_sync_stats={
                "courses": {"inserted": 1, "updated": 0, "deleted": 0},
                "assignments": {"inserted": 1, "updated": 0, "deleted": 0},
                "resources": {"inserted": 1, "updated": 0, "deleted": 0},
                "grades": {"inserted": 1, "updated": 0, "deleted": 0},
                "announcements": {"inserted": 1, "updated": 0, "deleted": 0},
            },
            second_sync_stats={
                "courses": {"inserted": 0, "updated": 1, "deleted": 0},
                "assignments": {"inserted": 0, "updated": 1, "deleted": 0},
                "resources": {"inserted": 0, "updated": 1, "deleted": 0},
                "grades": {"inserted": 0, "updated": 1, "deleted": 0},
                "announcements": {"inserted": 0, "updated": 1, "deleted": 0},
            },
            table_counts={
                "courses": {"total": 1, "active": 1},
                "assignments": {"total": 1, "active": 1},
                "resources": {"total": 1, "active": 1},
                "grades": {"total": 1, "active": 1},
                "announcements": {"total": 1, "active": 1},
            },
            expected_active_counts={
                "courses": 1,
                "assignments": 1,
                "resources": 1,
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
            "dbRelativePath": "backend/data/snapshot.db",
            "resourceCourseLimit": "2",
            "verifySecondSync": "false",
            "stateKey": "snapshot-latest",
            "artifactName": "snapshot.json",
        },
        host=ToolHostCapabilities(
            workspace_resolver=workspace,
            artifact_store=artifact_store,
            state_store=state_store,
            event_sink=event_sink,
        ),
    )

    assert result.status == "success"
    assert captured == {
        "username": "alice",
        "password": "secret",
        "db_path": Path("workspace-root/backend/data/snapshot.db"),
        "reset_schema": False,
        "resource_course_limit": 2,
        "verify_second_sync": False,
    }
    assert result.output is not None
    assert result.output["dbPath"] == "workspace-root/backend/data/snapshot.db"
    assert result.output["resourceCourseLimit"] == 2
    assert result.output["progressMessages"] == ["fetching courses", "syncing sqlite"]
    assert result.output["secondSyncHasNoNewRecords"] is True
    assert result.output["secondSyncHasNoDeletedRecords"] is True
    assert result.metadata == {
        "toolId": "blackboard.snapshot.sync",
        "credentialSource": "arguments",
        "dbPathSource": "workspace",
        "stateNamespace": "blackboard.snapshot_sync",
        "stateKey": "snapshot-latest",
    }
    assert len(result.artifacts) == 1
    assert result.artifacts[0].artifact_id == "artifact-1"
    assert workspace.requests == ["backend/data/snapshot.db"]
    assert json.loads(artifact_store.saved_texts[0]["text"])["dbPath"] == "workspace-root/backend/data/snapshot.db"
    assert state_store.values[("blackboard.snapshot_sync", "snapshot-latest")]["output"]["integrityOk"] is True
    assert [event.event_type for event in event_sink.events] == [
        "blackboard.snapshot.sync.started",
        "blackboard.snapshot.sync.completed",
    ]


def test_snapshot_sync_tool_defaults_to_sustech_secret_names_when_secret_names_omitted(
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
        resource_course_limit: int = 3,
        verify_second_sync: bool = True,
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
                "resource_course_limit": resource_course_limit,
                "verify_second_sync": verify_second_sync,
            }
        )
        return BlackboardSnapshotSyncReport(
            db_path=Path("workspace-root/backend/data/default.db"),
            snapshot=BlackboardSnapshotFetchResult(
                courses=[],
                assignments_by_course={},
                resources_by_course={},
                grades_by_course={},
                announcements=[],
                resource_course_limit=resource_course_limit,
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

    result = _invoke_tool(
        BlackboardSnapshotSyncTool(),
        arguments={},
        host=ToolHostCapabilities(secret_provider=secret_provider),
    )

    assert result.status == "success"
    assert captured == {
        "username": "student@sustech.edu.cn",
        "password": "cas-secret",
        "db_path": None,
        "reset_schema": False,
        "resource_course_limit": 3,
        "verify_second_sync": True,
    }
    assert result.metadata == {
        "toolId": "blackboard.snapshot.sync",
        "credentialSource": "host_secrets",
        "dbPathSource": "default",
    }
    assert secret_provider.requests == ["sustech.username", "sustech.casPassword"]


def test_blackboard_sql_query_tool_queries_default_database(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    db_path = _create_sqlite_db(
        tmp_path / "blackboard-default.db",
        script="""
        CREATE TABLE courses (id INTEGER PRIMARY KEY, name TEXT);
        INSERT INTO courses (id, name) VALUES (1, 'CS305'), (2, 'CS307');
        """,
    )
    event_sink = StubEventSink()
    monkeypatch.setattr(facade_tools, "_default_blackboard_sql_query_db_path", lambda: db_path)

    result = _invoke_tool(
        BlackboardSQLQueryTool(),
        arguments={"sql": "SELECT id, name FROM courses ORDER BY id"},
        host=ToolHostCapabilities(event_sink=event_sink),
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
    assert [event.event_type for event in event_sink.events] == [
        "blackboard.sql.query.started",
        "blackboard.sql.query.completed",
    ]


def test_blackboard_sql_query_tool_uses_explicit_db_path_and_persists_artifact_when_truncated(
    tmp_path: Path,
) -> None:
    db_path = _create_sqlite_db(
        tmp_path / "blackboard-explicit.db",
        script="""
        CREATE TABLE announcements (id INTEGER PRIMARY KEY, title TEXT);
        INSERT INTO announcements (id, title) VALUES
            (1, 'Welcome'),
            (2, 'Exam'),
            (3, 'Reminder');
        """,
    )
    artifact_store = StubArtifactStore()

    result = _invoke_tool(
        BlackboardSQLQueryTool(),
        arguments={
            "sql": "SELECT id, title FROM announcements ORDER BY id",
            "dbPath": db_path.as_posix(),
            "resultLimit": 1,
            "persistArtifact": True,
        },
        host=ToolHostCapabilities(artifact_store=artifact_store),
    )

    assert result.status == "success"
    assert result.output is not None
    assert result.output["database"] == {"path": db_path.as_posix(), "source": "argument"}
    assert result.output["usedDefaultDatabase"] is False
    assert result.output["rowsPreview"] == [{"id": 1, "title": "Welcome"}]
    assert result.output["truncated"] is True
    assert result.output["artifact"] is not None
    assert result.output["artifact"]["artifactId"] == "artifact-1"
    assert result.metadata == {
        "toolId": "blackboard.sql.query",
        "dbPathSource": "argument",
        "persistArtifactRequested": True,
    }
    assert len(result.artifacts) == 1
    assert result.artifacts[0].artifact_id == "artifact-1"
    artifact_payload = json.loads(artifact_store.saved_texts[0]["text"])
    assert artifact_payload["rowCount"] == 3
    assert artifact_payload["rows"][2] == {"id": 3, "title": "Reminder"}


def test_snapshot_sync_tool_maps_runtime_errors(monkeypatch: Any) -> None:
    event_sink = StubEventSink()

    def _timeout_sync(
        username: str,
        password: str,
        *,
        db_path: Path | None = None,
        reset_schema: bool = False,
        resource_course_limit: int = 3,
        verify_second_sync: bool = True,
        progress: Any = None,
        enable_console_logging: bool = False,
    ) -> BlackboardSnapshotSyncReport:
        _ = (
            username,
            password,
            db_path,
            reset_schema,
            resource_course_limit,
            verify_second_sync,
            progress,
            enable_console_logging,
        )
        raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr(facade_tools, "run_blackboard_snapshot_sync", _timeout_sync)

    result = _invoke_tool(
        BlackboardSnapshotSyncTool(),
        arguments={"username": "alice", "password": "secret"},
        host=ToolHostCapabilities(event_sink=event_sink),
    )

    assert result.status == "error"
    assert result.error is not None
    assert result.error.code == "timeout"
    assert result.error.message == "timed out"
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
        host=ToolHostCapabilities(workspace_resolver=_NoopWorkspaceResolver()),
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
    ) -> CourseCatalogSearchResult:
        _ = (username, password, keyword, field, operator, limit)
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
    ) -> CourseCatalogSearchResult:
        _ = (username, password, keyword, field, operator, limit)
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

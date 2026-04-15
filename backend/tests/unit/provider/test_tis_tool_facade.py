from __future__ import annotations

import asyncio
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import app.integrations.sustech.teaching_information_system.facade.tools as facade_tools
from app.integrations.sustech.teaching_information_system import get_tis_tool_contracts
from app.integrations.sustech.teaching_information_system.api.dto import (
    TISCreditGPAQueryResult,
    TISCreditGPASummary,
    TISCreditGPATermRecord,
    TISCreditGPAYearRecord,
    TISGradeQueryResult,
    TISGradeRecord,
    TISHomepageProfile,
    TISProbeResult,
    TISSelectedCourseRecord,
    TISSelectedCourseSemester,
    TISSelectedCourseSummary,
    TISSelectedCoursesQueryResult,
)
from app.integrations.sustech.teaching_information_system.data import TISDatabaseManager
from app.integrations.sustech.teaching_information_system.facade.tools import (
    TISCreditGPAFetchTool,
    TISPersonalGradesFetchTool,
    TISSQLQueryTool,
    TISSelectedCoursesFetchTool,
)
from app.integrations.sustech.teaching_information_system.shared import TISLogEvent
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
            uri="artifact://tis/result.json",
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


def _create_sqlite_db(path: Path, *, script: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(path)) as connection:
        connection.executescript(script)
    return path


def _invoke_tool(
    tool: (
        TISPersonalGradesFetchTool
        | TISCreditGPAFetchTool
        | TISSelectedCoursesFetchTool
        | TISSQLQueryTool
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


def _build_log_event(source: str) -> TISLogEvent:
    return TISLogEvent(
        timestamp="2026-04-13T16:00:00Z",
        level="info",
        layer="provider",
        source=source,
        message="ok",
    )


def _build_homepage() -> TISHomepageProfile:
    return TISHomepageProfile(
        page_url="https://tis.sustech.edu.cn/student_index",
        title="TIS",
        role_codes=["01"],
    )


def _build_grade_result(*, persistence: dict[str, Any] | None = None) -> TISGradeQueryResult:
    record = TISGradeRecord(
        course_name="数据库系统",
        score="95",
        course_code="CS305",
        term="2025-20261",
        credit="3.0",
    )
    return TISGradeQueryResult(
        success=True,
        source_url="https://tis.sustech.edu.cn/cjgl/grcjcx/grcjcx",
        homepage=_build_homepage(),
        grade_records=[record],
        probes=[
            TISProbeResult(
                url="https://tis.sustech.edu.cn/cjgl/grcjcx/grcjcx",
                method="POST",
                status_code=200,
                record_count=1,
                grade_records=[record],
                is_json=True,
                probe_label="grades-api",
            )
        ],
        logs=[_build_log_event("test.personal_grades")],
        resolved_role_code="01",
        persistence=persistence,
    )


def _build_credit_gpa_result(*, persistence: dict[str, Any] | None = None) -> TISCreditGPAQueryResult:
    return TISCreditGPAQueryResult(
        success=True,
        source_url="https://tis.sustech.edu.cn/cjgl/xscjgl/xsgrcjcx/queryXnAndXqXfj",
        page_url="https://tis.sustech.edu.cn/cjgl/xscjgl/xsgrcjcx/xspjxfjcx",
        api_url="https://tis.sustech.edu.cn/cjgl/xscjgl/xsgrcjcx/queryXnAndXqXfj",
        homepage=_build_homepage(),
        summary=TISCreditGPASummary(average_credit_gpa=3.82, rank="5/100", raw={"PJXFJ": 3.82}),
        term_records=[
            TISCreditGPATermRecord(
                academic_year_term="2025秋季",
                academic_year="2025-2026",
                term_code="1",
                term_credit_gpa=3.82,
                year_credit_gpa=3.82,
            )
        ],
        year_records=[
            TISCreditGPAYearRecord(
                academic_year="2025-2026",
                year_credit_gpa=3.82,
            )
        ],
        probes=[
            TISProbeResult(
                url="https://tis.sustech.edu.cn/cjgl/xscjgl/xsgrcjcx/queryXnAndXqXfj",
                method="POST",
                status_code=200,
                is_json=True,
                probe_label="credit-gpa-api",
            )
        ],
        logs=[_build_log_event("test.credit_gpa")],
        resolved_role_code="01",
        persistence=persistence,
    )


def _build_selected_courses_result(*, persistence: dict[str, Any] | None = None) -> TISSelectedCoursesQueryResult:
    semester = TISSelectedCourseSemester(
        semester_id="2025-20261",
        academic_year="2025-2026",
        term_code="1",
        label="2025秋季",
    )
    course = TISSelectedCourseRecord(
        course_code="CS305",
        course_name="数据库系统",
        course_sequence_number="001",
        credits=3.0,
        term="2025-20261",
    )
    return TISSelectedCoursesQueryResult(
        success=True,
        source_url="https://tis.sustech.edu.cn/Xsxk/queryYxkc",
        page_url="https://tis.sustech.edu.cn/Xsxk/query/1",
        api_url="https://tis.sustech.edu.cn/Xsxk/queryYxkc",
        homepage=_build_homepage(),
        semester=semester,
        current_semester=TISSelectedCourseSemester(
            semester_id="2025-20261",
            academic_year="2025-2026",
            term_code="1",
            label="2025秋季",
            is_current=True,
        ),
        courses=[course],
        summary=TISSelectedCourseSummary(
            course_count=1,
            total_credits=3.0,
            total_hours=48.0,
            effective_course_count=1,
            page_num=2,
            page_size=30,
            raw_keys=["yxkcList"],
        ),
        probes=[
            TISProbeResult(
                url="https://tis.sustech.edu.cn/Xsxk/queryYxkc",
                method="POST",
                status_code=200,
                is_json=True,
                probe_label="selected-courses-api",
            )
        ],
        logs=[_build_log_event("test.selected_courses")],
        resolved_role_code="01",
        resolved_pylx="1",
        semester_source="parameter",
        persistence=persistence,
    )


def test_get_tis_tool_contracts_exposes_stable_tools_and_requirements() -> None:
    tool_ids = [tool.metadata.tool_id for tool in get_tis_tool_contracts()]

    assert tool_ids == [
        "tis.personal_grades.fetch",
        "tis.credit_gpa.fetch",
        "tis.selected_courses.fetch",
        "tis.sql.query",
    ]

    personal_grades_tool = TISPersonalGradesFetchTool()
    requirements = {
        requirement.capability: requirement for requirement in personal_grades_tool.metadata.capability_requirements
    }

    assert requirements["secret_provider"].required is False
    assert requirements["workspace_resolver"].required is False
    assert requirements["state_store"].required is False
    assert requirements["artifact_store"].required is False
    assert requirements["event_sink"].required is False
    assert personal_grades_tool.metadata.idempotent is False


def test_personal_grades_tool_shapes_output_and_persists_host_state_and_artifact(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}
    state_store = StubStateStore()
    artifact_store = StubArtifactStore()
    event_sink = StubEventSink()

    def _fake_fetch(
        username: str,
        password: str,
        *,
        role_code: str | None = None,
        homepage_html: str | None = None,
        config: Any = None,
        enable_console_logging: bool = False,
        max_probe_count: int = 12,
        persist: bool = False,
        db_manager: TISDatabaseManager | None = None,
        owner_key: str | None = None,
    ) -> TISGradeQueryResult:
        _ = (homepage_html, config, enable_console_logging, max_probe_count)
        captured.update(
            {
                "username": username,
                "password": password,
                "role_code": role_code,
                "persist": persist,
                "db_manager": db_manager,
                "owner_key": owner_key,
            }
        )
        return _build_grade_result()

    monkeypatch.setattr(facade_tools, "fetch_personal_grades_with_credentials", _fake_fetch)

    result = _invoke_tool(
        TISPersonalGradesFetchTool(),
        arguments={
            "username": " alice ",
            "password": " secret ",
            "roleCode": " 01 ",
            "stateKey": "grades-latest",
            "artifactName": "grades.json",
        },
        host=ToolHostCapabilities(
            state_store=state_store,
            artifact_store=artifact_store,
            event_sink=event_sink,
        ),
    )

    assert result.status == "success"
    assert captured == {
        "username": "alice",
        "password": "secret",
        "role_code": "01",
        "persist": False,
        "db_manager": None,
        "owner_key": None,
    }
    assert result.output is not None
    assert result.output["sourceUrl"] == "https://tis.sustech.edu.cn/cjgl/grcjcx/grcjcx"
    assert result.output["totalRecords"] == 1
    assert result.output["gradeRecords"][0]["course_name"] == "数据库系统"
    assert result.output["logSummary"] == {
        "total": 1,
        "by_level": {"info": 1},
        "by_layer": {"provider": 1},
        "by_source": {"test.personal_grades": 1},
    }
    assert result.metadata == {
        "toolId": "tis.personal_grades.fetch",
        "credentialSource": "arguments",
        "persistenceRequested": False,
        "stateNamespace": "tis.personal_grades.fetch",
        "stateKey": "grades-latest",
    }
    assert len(result.artifacts) == 1
    assert result.artifacts[0].artifact_id == "artifact-1"
    assert json.loads(artifact_store.saved_texts[0]["text"])["sourceUrl"] == "https://tis.sustech.edu.cn/cjgl/grcjcx/grcjcx"
    assert state_store.values[("tis.personal_grades.fetch", "grades-latest")]["output"]["totalRecords"] == 1
    assert [event.event_type for event in event_sink.events] == [
        "tis.personal_grades.fetch.started",
        "tis.personal_grades.fetch.completed",
    ]


def test_credit_gpa_tool_uses_secret_provider_and_workspace_db_when_persisting(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    captured: dict[str, Any] = {}
    secret_provider = StubSecretProvider(
        {
            "tis.username": "alice",
            "tis.password": "secret",
        }
    )
    workspace = StubWorkspaceResolver(tmp_path / "workspace-root")

    def _fake_fetch(
        username: str,
        password: str,
        *,
        role_code: str | None = None,
        homepage_html: str | None = None,
        config: Any = None,
        enable_console_logging: bool = False,
        persist: bool = False,
        db_manager: TISDatabaseManager | None = None,
        owner_key: str | None = None,
    ) -> TISCreditGPAQueryResult:
        _ = (homepage_html, config, enable_console_logging)
        captured.update(
            {
                "username": username,
                "password": password,
                "role_code": role_code,
                "persist": persist,
                "owner_key": owner_key,
                "db_path": None if db_manager is None else db_manager.describe().db_path,
            }
        )
        return _build_credit_gpa_result(
            persistence={
                "enabled": True,
                "owner_key": owner_key,
                "db_path": None if db_manager is None else db_manager.describe().db_path,
            }
        )

    monkeypatch.setattr(facade_tools, "fetch_credit_gpa_with_credentials", _fake_fetch)

    result = _invoke_tool(
        TISCreditGPAFetchTool(),
        arguments={
            "usernameSecretName": "tis.username",
            "passwordSecretName": "tis.password",
            "roleCode": " 01 ",
            "persist": "true",
            "ownerKey": " student_a ",
            "dbRelativePath": "backend/data/tis-credit.db",
            "resetSchema": "true",
        },
        host=ToolHostCapabilities(
            secret_provider=secret_provider,
            workspace_resolver=workspace,
        ),
    )

    resolved_path = (tmp_path / "workspace-root" / "backend/data/tis-credit.db").as_posix()

    assert result.status == "success"
    assert captured == {
        "username": "alice",
        "password": "secret",
        "role_code": "01",
        "persist": True,
        "owner_key": "student_a",
        "db_path": resolved_path,
    }
    assert result.output is not None
    assert result.output["summary"]["average_credit_gpa"] == 3.82
    assert result.output["persistence"] == {
        "enabled": True,
        "owner_key": "student_a",
        "db_path": resolved_path,
    }
    assert result.metadata == {
        "toolId": "tis.credit_gpa.fetch",
        "credentialSource": "host_secrets",
        "persistenceRequested": True,
        "dbPathSource": "workspace",
    }
    assert secret_provider.requests == ["tis.username", "tis.password"]
    assert workspace.requests == ["backend/data/tis-credit.db"]


def test_credit_gpa_tool_defaults_to_sustech_secret_names_when_secret_names_omitted(
    monkeypatch: Any,
) -> None:
    captured: dict[str, Any] = {}
    secret_provider = StubSecretProvider(
        {
            "sustech.username": "20251234",
            "sustech.casPassword": "cas-secret",
        }
    )

    def _fake_fetch(
        username: str,
        password: str,
        *,
        role_code: str | None = None,
        homepage_html: str | None = None,
        config: Any = None,
        enable_console_logging: bool = False,
        persist: bool = False,
        db_manager: TISDatabaseManager | None = None,
        owner_key: str | None = None,
    ) -> TISCreditGPAQueryResult:
        _ = (homepage_html, config, enable_console_logging)
        captured.update(
            {
                "username": username,
                "password": password,
                "role_code": role_code,
                "persist": persist,
                "owner_key": owner_key,
                "db_path": None if db_manager is None else db_manager.describe().db_path,
            }
        )
        return _build_credit_gpa_result()

    monkeypatch.setattr(facade_tools, "fetch_credit_gpa_with_credentials", _fake_fetch)

    result = _invoke_tool(
        TISCreditGPAFetchTool(),
        arguments={},
        host=ToolHostCapabilities(secret_provider=secret_provider),
    )

    assert result.status == "success"
    assert captured == {
        "username": "20251234",
        "password": "cas-secret",
        "role_code": None,
        "persist": False,
        "owner_key": None,
        "db_path": None,
    }
    assert result.metadata == {
        "toolId": "tis.credit_gpa.fetch",
        "credentialSource": "host_secrets",
        "persistenceRequested": False,
    }
    assert secret_provider.requests == ["sustech.username", "sustech.casPassword"]


def test_credit_gpa_tool_maps_missing_workspace_capability() -> None:
    result = _invoke_tool(
        TISCreditGPAFetchTool(),
        arguments={
            "username": "alice",
            "password": "secret",
            "persist": True,
            "dbRelativePath": "backend/data/tis-credit.db",
        },
    )

    assert result.status == "error"
    assert result.error is not None
    assert result.error.code == "host_capability_missing"
    assert result.error.details["capability"] == "workspace_resolver"
    assert result.error.details["exceptionType"] == "MissingHostCapabilityError"
    assert "traceback" in result.error.details


def test_selected_courses_tool_normalizes_inputs_and_maps_invalid_input(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}
    event_sink = StubEventSink()

    def _fake_fetch(
        username: str,
        password: str,
        *,
        semester: str | None = None,
        role_code: str | None = None,
        homepage_html: str | None = None,
        config: Any = None,
        enable_console_logging: bool = False,
        page_num: int = 1,
        page_size: int = 19,
        persist: bool = False,
        db_manager: TISDatabaseManager | None = None,
        owner_key: str | None = None,
    ) -> TISSelectedCoursesQueryResult:
        _ = (homepage_html, config, enable_console_logging, db_manager, owner_key)
        captured.update(
            {
                "username": username,
                "password": password,
                "semester": semester,
                "role_code": role_code,
                "page_num": page_num,
                "page_size": page_size,
                "persist": persist,
            }
        )
        return _build_selected_courses_result()

    monkeypatch.setattr(facade_tools, "fetch_selected_courses_with_credentials", _fake_fetch)

    result = _invoke_tool(
        TISSelectedCoursesFetchTool(),
        arguments={
            "username": " alice ",
            "password": " secret ",
            "semester": " 2025-20261 ",
            "roleCode": " 01 ",
            "pageNum": "2",
            "pageSize": "30",
        },
        host=ToolHostCapabilities(event_sink=event_sink),
    )
    error_result = _invoke_tool(
        TISSelectedCoursesFetchTool(),
        arguments={
            "username": "alice",
            "password": "secret",
            "pageNum": 0,
        },
    )

    assert result.status == "success"
    assert captured == {
        "username": "alice",
        "password": "secret",
        "semester": "2025-20261",
        "role_code": "01",
        "page_num": 2,
        "page_size": 30,
        "persist": False,
    }
    assert result.output is not None
    assert result.output["courseCount"] == 1
    assert result.output["semesterSource"] == "parameter"
    assert result.output["courses"][0]["course_name"] == "数据库系统"
    assert result.metadata == {
        "toolId": "tis.selected_courses.fetch",
        "credentialSource": "arguments",
        "persistenceRequested": False,
    }
    assert [event.event_type for event in event_sink.events] == [
        "tis.selected_courses.fetch.started",
        "tis.selected_courses.fetch.completed",
    ]

    assert error_result.status == "error"
    assert error_result.error is not None
    assert error_result.error.code == "invalid_input"
    assert error_result.error.message == "pageNum must be a positive integer."


def test_tis_sql_query_tool_queries_default_database(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    db_path = _create_sqlite_db(
        tmp_path / "tis-default.db",
        script="""
        CREATE TABLE grades (id INTEGER PRIMARY KEY, course_name TEXT, score INTEGER);
        INSERT INTO grades (id, course_name, score) VALUES (1, '数据库系统', 95), (2, '机器学习', 98);
        """,
    )
    event_sink = StubEventSink()
    monkeypatch.setattr(facade_tools, "_default_tis_sql_query_db_path", lambda: db_path)

    result = _invoke_tool(
        TISSQLQueryTool(),
        arguments={"sql": "SELECT id, course_name, score FROM grades ORDER BY id"},
        host=ToolHostCapabilities(event_sink=event_sink),
    )

    assert result.status == "success"
    assert result.output == {
        "sql": "SELECT id, course_name, score FROM grades ORDER BY id",
        "database": {"path": db_path.as_posix(), "source": "default"},
        "usedDefaultDatabase": True,
        "hasResultSet": True,
        "columns": ["id", "course_name", "score"],
        "rowsPreview": [
            {"id": 1, "course_name": "数据库系统", "score": 95},
            {"id": 2, "course_name": "机器学习", "score": 98},
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
        "toolId": "tis.sql.query",
        "dbPathSource": "default",
        "persistArtifactRequested": False,
    }
    assert [event.event_type for event in event_sink.events] == [
        "tis.sql.query.started",
        "tis.sql.query.completed",
    ]


def test_tis_sql_query_tool_uses_workspace_override_and_reports_non_result_summary(
    tmp_path: Path,
) -> None:
    workspace = StubWorkspaceResolver(tmp_path / "workspace-root")
    db_path = _create_sqlite_db(
        workspace.root / "backend/data/tis-query.db",
        script="""
        CREATE TABLE grades (id INTEGER PRIMARY KEY, score INTEGER);
        INSERT INTO grades (id, score) VALUES (1, 95), (2, 88);
        """,
    )

    result = _invoke_tool(
        TISSQLQueryTool(),
        arguments={
            "sql": "UPDATE grades SET score = 96 WHERE id = 1",
            "dbRelativePath": "backend/data/tis-query.db",
        },
        host=ToolHostCapabilities(workspace_resolver=workspace),
    )

    assert result.status == "success"
    assert result.output == {
        "sql": "UPDATE grades SET score = 96 WHERE id = 1",
        "database": {"path": db_path.as_posix(), "source": "workspace"},
        "usedDefaultDatabase": False,
        "hasResultSet": False,
        "columns": [],
        "rowsPreview": [],
        "truncated": False,
        "rowCount": None,
        "executionSummary": {
            "statementType": "UPDATE",
            "affectedRowCount": 1,
            "message": "SQL statement executed without a result set.",
        },
        "artifact": None,
    }
    assert result.artifacts == ()
    assert result.metadata == {
        "toolId": "tis.sql.query",
        "dbPathSource": "workspace",
        "persistArtifactRequested": False,
    }
    assert workspace.requests == ["backend/data/tis-query.db"]
    with sqlite3.connect(str(db_path)) as connection:
        updated_score = connection.execute("SELECT score FROM grades WHERE id = 1").fetchone()
    assert updated_score == (96,)



def test_personal_grades_tool_injects_traceback_details_for_unknown_errors(monkeypatch: Any) -> None:
    def _boom_fetch(
        username: str,
        password: str,
        *,
        role_code: str | None = None,
        homepage_html: str | None = None,
        config: Any = None,
        enable_console_logging: bool = False,
        persist: bool = False,
        db_manager: TISDatabaseManager | None = None,
        owner_key: str | None = None,
    ) -> TISGradeQueryResult:
        _ = (
            username,
            password,
            role_code,
            homepage_html,
            config,
            enable_console_logging,
            persist,
            db_manager,
            owner_key,
        )
        raise RuntimeError("tis personal grades exploded")

    monkeypatch.setattr(facade_tools, "fetch_personal_grades_with_credentials", _boom_fetch)

    result = _invoke_tool(
        TISPersonalGradesFetchTool(),
        arguments={"username": "alice", "password": "secret"},
    )

    assert result.status == "error"
    assert result.error is not None
    assert result.error.code == "execution_failed"
    assert result.error.message == "tis personal grades exploded"
    assert result.error.details["exceptionType"] == "RuntimeError"
    assert result.error.details["exceptionMessage"] == "tis personal grades exploded"
    assert "RuntimeError: tis personal grades exploded" in result.error.details["traceback"]
    assert result.error.details["diagnosticContext"] == {
        "integration": "teaching_information_system",
        "toolId": "tis.personal_grades.fetch",
        "invocationId": "invoke-1",
        "argumentKeys": ["password", "username"],
    }



def test_personal_grades_tool_redacts_sensitive_values_in_enriched_error_details(
    monkeypatch: Any,
) -> None:
    sensitive_message = (
        "payload={'password': 'hunter2', 'token': 'abc123'}\n"
        "Authorization: Bearer super-secret\n"
        "cookie: session=abc"
    )

    def _boom_fetch(
        username: str,
        password: str,
        *,
        role_code: str | None = None,
        homepage_html: str | None = None,
        config: Any = None,
        enable_console_logging: bool = False,
        persist: bool = False,
        db_manager: TISDatabaseManager | None = None,
        owner_key: str | None = None,
    ) -> TISGradeQueryResult:
        _ = (
            username,
            password,
            role_code,
            homepage_html,
            config,
            enable_console_logging,
            persist,
            db_manager,
            owner_key,
        )
        raise RuntimeError(sensitive_message)

    monkeypatch.setattr(facade_tools, "fetch_personal_grades_with_credentials", _boom_fetch)

    result = _invoke_tool(
        TISPersonalGradesFetchTool(),
        arguments={"username": "alice", "password": "secret"},
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



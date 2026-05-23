"""Tests for the calendar SQL query tool."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.tooling import ToolHostCapabilities, ToolInvocationContext
from app.tooling.calendar_tools import CalendarSQLQueryTool, get_calendar_tool_contracts
from app.tooling.calendar_tools.sql_query import (
    _first_keyword,
    _validate_sql,
)
from app.tooling.runtime_adapter.copilot_runtime import (
    RuntimeToolExecutionContext,
    runtime_tool_execution_scope,
)
import app.tooling.calendar_tools.sql_query as _sql_query_mod


def _make_context() -> ToolInvocationContext:
    return ToolInvocationContext(invocation_id="t1", tool_id="calendar.sql.query")


def _setup_db(db_path: Path) -> Path:
    import sqlite3
    c = sqlite3.connect(str(db_path))
    c.execute("""CREATE TABLE IF NOT EXISTS timeline_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, source_id TEXT,
        title TEXT NOT NULL, description TEXT, start_time TEXT NOT NULL, end_time TEXT,
        is_all_day INTEGER DEFAULT 0, location TEXT, status TEXT DEFAULT 'not_started',
        metadata_payload TEXT, progress REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")
    for r in [
        ("BB A1", "2026-03-10T09:00", "2026-03-12T09:00", "bb", "bb_001", "not_started"),
        ("Custom", "2026-03-10T09:00", "2026-03-10T12:00", "custom", "cu_001", "in_progress"),
        ("WakeUp", "2026-03-10T09:00", "2026-03-10T10:30", "wakeup", "wk_001", "not_started"),
    ]:
        c.execute("INSERT INTO timeline_events (title,start_time,end_time,source,source_id,status) VALUES (?,?,?,?,?,?)", r)
    c.commit(); c.close()
    return db_path


def _patch(db_path: Path):
    orig = _sql_query_mod.resolve_timeline_db_path
    _sql_query_mod.resolve_timeline_db_path = lambda *a, **kw: db_path  # type: ignore[assignment]
    return orig

def _restore(orig): _sql_query_mod.resolve_timeline_db_path = orig  # type: ignore[assignment]


class TestFirstKeyword:
    def test_select(self): assert _first_keyword("SELECT * FROM t") == "SELECT"
    def test_insert(self): assert _first_keyword("INSERT INTO t VALUES(1)") == "INSERT"
    def test_create(self): assert _first_keyword("CREATE TABLE x") == "CREATE"
    def test_empty(self): assert _first_keyword("") == "UNKNOWN"


class TestValidateSql:
    def test_allows_select(self): assert _validate_sql("SELECT * FROM t") is None
    def test_allows_insert(self): assert _validate_sql("INSERT INTO t VALUES(1)") is None
    def test_allows_update(self): assert _validate_sql("UPDATE t SET x=1") is None
    def test_allows_delete(self): assert _validate_sql("DELETE FROM t") is None
    def test_allows_multi(self): assert _validate_sql("SELECT 1; UPDATE t SET x=2; INSERT INTO t VALUES(3)") is None
    def test_blocks_ddl(self):
        assert _validate_sql("CREATE TABLE x") is not None
        assert _validate_sql("DROP TABLE t") is not None
        assert _validate_sql("ALTER TABLE t ADD x") is not None
        assert _validate_sql("PRAGMA user_version") is not None


class TestMetadata:
    def test_tool_id(self): assert CalendarSQLQueryTool().metadata.tool_id == "calendar.sql.query"
    def test_desc_has_ddl(self): assert "CREATE TABLE" in (CalendarSQLQueryTool().metadata.description or "")
    def test_desc_has_custom_hint(self): assert "custom" in (CalendarSQLQueryTool().metadata.description or "").lower()
    def test_one_contract(self): assert len(get_calendar_tool_contracts()) == 1


class TestInvoke:
    @pytest.mark.asyncio
    async def test_select(self, tmp_path: Path):
        db = _setup_db(tmp_path / "t.db"); orig = _patch(db)
        try:
            r = await CalendarSQLQueryTool().invoke(
                arguments={"sql": "SELECT * FROM timeline_events ORDER BY id"},
                context=_make_context(), host=ToolHostCapabilities())
            assert r.status == "success"
            assert r.output["rowCount"] == 3
        finally: _restore(orig)

    @pytest.mark.asyncio
    async def test_multi_statement(self, tmp_path: Path):
        db = _setup_db(tmp_path / "t2.db"); orig = _patch(db)
        try:
            r = await CalendarSQLQueryTool().invoke(
                arguments={"sql": "UPDATE timeline_events SET status='done' WHERE source_id='bb_001'; SELECT status FROM timeline_events WHERE source_id='bb_001'"},
                context=_make_context(), host=ToolHostCapabilities())
            assert r.status == "success"
            assert r.output["rowsPreview"][0]["status"] == "done"
        finally: _restore(orig)

    @pytest.mark.asyncio
    async def test_update(self, tmp_path: Path):
        db = _setup_db(tmp_path / "t3.db"); orig = _patch(db)
        try:
            t = CalendarSQLQueryTool()
            await t.invoke(arguments={"sql": "UPDATE timeline_events SET status='completed' WHERE source_id='bb_001'"}, context=_make_context(), host=ToolHostCapabilities())
            r = await t.invoke(arguments={"sql": "SELECT status FROM timeline_events WHERE source_id='bb_001'"}, context=_make_context(), host=ToolHostCapabilities())
            assert r.output["rowsPreview"][0]["status"] == "completed"
        finally: _restore(orig)

    @pytest.mark.asyncio
    async def test_delete(self, tmp_path: Path):
        db = _setup_db(tmp_path / "t4.db"); orig = _patch(db)
        try:
            t = CalendarSQLQueryTool()
            await t.invoke(arguments={"sql": "DELETE FROM timeline_events WHERE source_id='wk_001'"}, context=_make_context(), host=ToolHostCapabilities())
            r = await t.invoke(arguments={"sql": "SELECT COUNT(*) as c FROM timeline_events"}, context=_make_context(), host=ToolHostCapabilities())
            assert r.output["rowsPreview"][0]["c"] == 2
        finally: _restore(orig)

    @pytest.mark.asyncio
    async def test_insert_any_source_allowed(self, tmp_path: Path):
        db = _setup_db(tmp_path / "t5.db"); orig = _patch(db)
        try:
            r = await CalendarSQLQueryTool().invoke(
                arguments={"sql": "INSERT INTO timeline_events (title,start_time,source,source_id) VALUES ('X','2026-01-01T00:00','bb','bb_x')"},
                context=_make_context(), host=ToolHostCapabilities())
            assert r.status == "success"
        finally: _restore(orig)

    @pytest.mark.asyncio
    async def test_ddl_blocked(self, tmp_path: Path):
        db = _setup_db(tmp_path / "t6.db"); orig = _patch(db)
        try:
            r = await CalendarSQLQueryTool().invoke(
                arguments={"sql": "DROP TABLE timeline_events"}, context=_make_context(), host=ToolHostCapabilities())
            assert r.status == "error"
        finally: _restore(orig)

    @pytest.mark.asyncio
    async def test_resolves_timeline_db_from_runtime_context_user_data_dir(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ):
        monkeypatch.delenv("COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR", raising=False)
        monkeypatch.delenv("COPILOT_DESKTOP_RUNTIME_DATABASE_DIR", raising=False)
        user_data_dir = tmp_path / "electron-user-data"
        user_data_dir.mkdir()
        _setup_db(user_data_dir / "timeline.db")
        runtime_context = RuntimeToolExecutionContext(
            tool_call_id="calendar.sql.query:call-1",
            metadata={"runtimePaths": {"userDataDir": str(user_data_dir)}},
        )

        with runtime_tool_execution_scope(runtime_context):
            r = await CalendarSQLQueryTool().invoke(
                arguments={"sql": "SELECT COUNT(*) AS c FROM timeline_events"},
                context=_make_context(),
                host=ToolHostCapabilities(),
            )

        assert r.status == "success"
        assert r.output["database"]["path"] == (user_data_dir / "timeline.db").as_posix()
        assert r.output["rowsPreview"][0]["c"] == 3

from __future__ import annotations

import threading
import time
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.desktop_runtime.routes import blackboard_ui
from app.desktop_runtime.routes.blackboard_ui import (
    _SYNC_LOCK,
    _infer_progress_stage,
    _sync_status,
    _update_sync_progress,
    build_blackboard_ui_router,
)
from app.integrations.sustech.blackboard.data.db_manager import (
    DatabaseManager,
    resolve_default_blackboard_db_path,
)
from app.integrations.sustech.blackboard.data.models import (
    Announcement,
    AnnouncementAssignmentLink,
    Assignment,
    Course,
    Grade,
    Resource,
    ResourceDownloadBinding,
    ResourceDownloadDirectoryPreference,
)


class _RuntimeConfig:
    def __init__(self, database_dir: Path) -> None:
        self.database_dir = database_dir


def _reset_sync_status() -> None:
    if _SYNC_LOCK.locked():
        _SYNC_LOCK.release()
    _sync_status.update(
        status="idle",
        lastSyncAt=None,
        lastSyncError=None,
        progressStage=None,
        progressMessage=None,
        progressLogs=[],
        canCancel=False,
        timeoutSeconds=blackboard_ui._SYNC_TIMEOUT_SECONDS,
        updatedAt=None,
    )
    blackboard_ui._RESOURCE_DOWNLOAD_TASKS_BY_ID.clear()
    blackboard_ui._RESOURCE_DOWNLOAD_TASK_ID_BY_URL.clear()


def _build_client(database_dir: Path) -> TestClient:
    _reset_sync_status()
    app = FastAPI()
    app.state.runtime_config = _RuntimeConfig(database_dir)
    app.include_router(build_blackboard_ui_router())
    return TestClient(app)


def _seed_blackboard_database(database_dir: Path) -> None:
    manager = DatabaseManager(
        resolve_default_blackboard_db_path(database_dir),
        reset_schema=True,
    )
    with manager._session_scope() as session:
        session.add(
            Course(
                course_id="course-1",
                name="CS101-30000001: Intro Spring 2026",
                code="CS101",
                instructor="Ada Lovelace",
                term="Spring 2026",
                url="https://bb.sustech.edu.cn/course-1",
                total_grade="95",
                listed_grade="A",
                total_assignments=1,
                total_resources=1,
                total_announcements=2,
                is_active=True,
            )
        )
        session.add(
            Announcement(
                course_id="course-1",
                announcement_id="ann-1",
                course_name="CS101-30000001: Intro Spring 2026",
                title="Welcome",
                content="Welcome to Blackboard.",
                content_html="<p>Welcome to <strong>Blackboard</strong>.</p>",
                author="Ada Lovelace",
                posted_at=datetime(2026, 4, 30, 9, 15),
                url="https://bb.sustech.edu.cn/ann-1",
                relation_type="plain_course_announcement",
                relation_confidence="none",
            )
        )
        session.add(
            Announcement(
                course_id="course-1",
                announcement_id="ann-2",
                course_name="CS101-30000001: Intro Spring 2026",
                title="Homework 1 released",
                content="Solve all questions before the due date.",
                content_html="<p>Solve <strong>all</strong> questions before the due date.</p>",
                author="Ada Lovelace",
                posted_at=datetime(2026, 4, 29, 9, 15),
                url="https://bb.sustech.edu.cn/ann-2",
                relation_type="assignment_notice",
                relation_confidence="high",
            )
        )
        session.add(
            Grade(
                course_id="course-1",
                grade_id="grade-1",
                item_name="Homework 1",
                score="9",
                total_score="10",
                score_numeric=9.0,
                max_score=10.0,
                percentage=90.0,
                status="Graded",
                grade_type="Assignment",
                category="Homework",
                due_date="2026-05-01",
                graded_date="2026-05-02",
                weight=10.0,
                is_counted=True,
                source_url="https://bb.sustech.edu.cn/grade-1",
            )
        )
        session.add(
            Resource(
                course_id="course-1",
                resource_id="res-1",
                title="Lecture 1 slides",
                type="pdf",
                size="1 MB",
                url="https://bb.sustech.edu.cn/res-1.pdf",
                source_page="https://bb.sustech.edu.cn/course-1/content",
                local_path="downloads/course-1/res-1.pdf",
                is_downloaded=True,
                download_failed=False,
            )
        )
        session.add(
            Assignment(
                course_id="course-1",
                assignment_id="asg-1",
                title="Homework 1",
                url="https://bb.sustech.edu.cn/asg-1",
                description="Solve all questions.",
                description_html="<p>Solve <strong>all</strong> questions.</p>",
                summary="Homework 1 summary",
                source_page="https://bb.sustech.edu.cn/course-1/assignments",
                due_date="2026-05-01",
                status="Open",
                submission_status="Not Submitted",
                score=None,
                total_score="100",
            )
        )
        session.add(
            Assignment(
                course_id="course-1",
                assignment_id="asg-dup-fragment",
                title="Homework 1",
                url="https://bb.sustech.edu.cn/asg-1#contentPanel",
                description=None,
                description_html=None,
                summary="Homework 1 duplicate summary",
                source_page="https://bb.sustech.edu.cn/course-1/assignments#contentPanel",
                due_date="2026-05-01",
                status="Open",
                submission_status="Not Submitted",
                score=None,
                total_score="100",
            )
        )
        session.add(
            Assignment(
                course_id="course-1",
                assignment_id="asg-2a",
                title="Assignment 2",
                url="https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment?content_id=_111_1&course_id=course-1",
                description="Assignment 2 full detail.",
                description_html="<p>Assignment 2 full detail.</p>",
                summary="Assignment 2 summary",
                source_page="https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id=course-1&content_id=_111_1",
                due_date="2026-05-09",
                posted_date="2026-04-23",
                status="Late",
                submission_status="Late",
                score=None,
                total_score="100",
            )
        )
        session.add(
            Assignment(
                course_id="course-1",
                assignment_id="asg-2b",
                title="Assignment 2",
                url="https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id=course-1#contentListItem:_111_1",
                description=None,
                description_html=None,
                summary="Assignment 2 duplicate summary",
                source_page="https://bb.sustech.edu.cn/webapps/blackboard/execute/launcher?type=Course&id=course-1",
                due_date="2026-05-09",
                posted_date=None,
                status="",
                submission_status="",
                score=None,
                total_score="100",
            )
        )
        session.add(
            AnnouncementAssignmentLink(
                announcement_id="ann-2",
                assignment_id="asg-1",
                course_id="course-1",
                link_source="ann_id_launch_link",
                confidence="high",
                evidence_json='{"ann_id":"_43635_1","path_text":"/Homework/Homework 1"}',
            )
        )


def _get_directory_preference(
    manager: DatabaseManager,
    scope_type: str,
    scope_key: str,
) -> ResourceDownloadDirectoryPreference | None:
    session = manager.SessionLocal()
    try:
        return (
            session.query(ResourceDownloadDirectoryPreference)
            .filter(
                ResourceDownloadDirectoryPreference.scope_type == scope_type,
                ResourceDownloadDirectoryPreference.scope_key == scope_key,
            )
            .one_or_none()
        )
    finally:
        session.close()


def _get_resource(manager: DatabaseManager, resource_id: str) -> Resource | None:
    session = manager.SessionLocal()
    try:
        return session.query(Resource).filter(Resource.resource_id == resource_id).one_or_none()
    finally:
        session.close()


def _get_download_binding(
    manager: DatabaseManager,
    resource_url_key: str,
) -> ResourceDownloadBinding | None:
    session = manager.SessionLocal()
    try:
        return (
            session.query(ResourceDownloadBinding)
            .filter(ResourceDownloadBinding.resource_url_key == resource_url_key)
            .one_or_none()
        )
    finally:
        session.close()


def test_blackboard_ui_course_payload_includes_database_summary_fields(tmp_path: Path) -> None:
    database_dir = tmp_path / "database"
    _seed_blackboard_database(database_dir)

    with _build_client(database_dir) as client:
        response = client.get("/api/blackboard/data/courses")

    payload = response.json()
    assert payload["ok"] is True
    assert payload["courses"] == [
        {
            "id": payload["courses"][0]["id"],
            "course_id": "course-1",
            "name": "CS101-30000001: Intro Spring 2026",
            "code": "CS101",
            "instructor": "Ada Lovelace",
            "term": "Spring 2026",
            "url": "https://bb.sustech.edu.cn/course-1",
            "is_active": True,
            "total_grade": "95",
            "listed_grade": "A",
            "total_assignments": 1,
            "total_resources": 1,
            "total_announcements": 2,
        }
    ]


def test_blackboard_ui_detail_routes_use_current_database_model_fields(tmp_path: Path) -> None:
    database_dir = tmp_path / "database"
    _seed_blackboard_database(database_dir)

    with _build_client(database_dir) as client:
        announcements = client.get(
            "/api/blackboard/data/courses/course-1/announcements"
        ).json()
        course_only_announcements = client.get(
            "/api/blackboard/data/courses/course-1/announcements?scope=course_only"
        ).json()
        assignments = client.get(
            "/api/blackboard/data/courses/course-1/assignments"
        ).json()
        links = client.get(
            "/api/blackboard/data/courses/course-1/announcement-assignment-links"
        ).json()
        grades = client.get("/api/blackboard/data/courses/course-1/grades").json()
        resources = client.get("/api/blackboard/data/courses/course-1/resources").json()

    assert announcements["ok"] is True
    assert announcements["scope"] == "all"
    assert len(announcements["announcements"]) == 2
    assert announcements["announcements"][0] | {
        "id": announcements["announcements"][0]["id"],
        "publish_time": announcements["announcements"][0]["publish_time"],
    } == {
        "id": announcements["announcements"][0]["id"],
        "announcement_id": "ann-1",
        "title": "Welcome",
        "body": "Welcome to Blackboard.",
        "content": "Welcome to Blackboard.",
        "body_html": "<p>Welcome to <strong>Blackboard</strong>.</p>",
        "content_html": "<p>Welcome to <strong>Blackboard</strong>.</p>",
        "body_markdown": "Welcome to **Blackboard**.",
        "content_markdown": "Welcome to **Blackboard**.",
        "author": "Ada Lovelace",
        "publish_time": announcements["announcements"][0]["publish_time"],
        "posted_at": announcements["announcements"][0]["posted_at"],
        "url": "https://bb.sustech.edu.cn/ann-1",
        "course_id": "course-1",
        "course_name": "CS101-30000001: Intro Spring 2026",
        "relation_type": "plain_course_announcement",
        "relation_confidence": "none",
        "linked_assignment_count": 0,
        "linked_assignments": [],
    }

    assert course_only_announcements == {
        "ok": True,
        "scope": "course_only",
        "announcements": [announcements["announcements"][0]],
    }

    assert assignments["ok"] is True
    assert len(assignments["assignments"]) == 2
    assignments_by_id = {
        item["assignment_id"]: item for item in assignments["assignments"]
    }
    homework_1 = assignments_by_id["asg-1"]
    assignment_2 = assignments_by_id["asg-2a"]

    assert homework_1 | {"id": homework_1["id"]} == {
        "id": homework_1["id"],
        "assignment_id": "asg-1",
        "title": "Homework 1",
        "due_date": "2026-05-01",
        "posted_date": None,
        "url": "https://bb.sustech.edu.cn/asg-1",
        "description": "Solve all questions.",
        "description_html": "<p>Solve <strong>all</strong> questions.</p>",
        "summary": "Homework 1 summary",
        "source_page": "https://bb.sustech.edu.cn/course-1/assignments",
        "attachments_json": None,
        "status": "Open",
        "submission_status": "Not Submitted",
        "score": None,
        "total_score": "100",
        "course_id": "course-1",
        "linked_announcements_count": 1,
        "linked_announcements": [
            {
                "announcement_id": "ann-2",
                "title": "Homework 1 released",
                "posted_at": homework_1["linked_announcements"][0]["posted_at"],
                "publish_time": homework_1["linked_announcements"][0]["publish_time"],
                "content": "Solve all questions before the due date.",
                "content_html": "<p>Solve <strong>all</strong> questions before the due date.</p>",
                "content_markdown": "Solve **all** questions before the due date.",
                "relation_confidence": "high",
                "link_source": "ann_id_launch_link",
            }
        ],
        }

    assert assignment_2 | {"id": assignment_2["id"]} == {
        "id": assignment_2["id"],
        "assignment_id": "asg-2a",
        "title": "Assignment 2",
        "due_date": "2026-05-09",
        "posted_date": "2026-04-23",
        "url": "https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment?content_id=_111_1&course_id=course-1",
        "description": "Assignment 2 full detail.",
        "description_html": "<p>Assignment 2 full detail.</p>",
        "summary": "Assignment 2 summary",
        "source_page": "https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id=course-1&content_id=_111_1",
        "attachments_json": None,
        "status": "Late",
        "submission_status": "Late",
        "score": None,
        "total_score": "100",
        "course_id": "course-1",
        "linked_announcements_count": 0,
        "linked_announcements": [],
        }

    assert "description_markdown" not in homework_1
    assert "description_markdown" not in assignment_2

    assert links["ok"] is True
    assert links["links"][0] | {
        "id": links["links"][0]["id"],
        "created_at": links["links"][0]["created_at"],
        "updated_at": links["links"][0]["updated_at"],
        "last_synced_at": links["links"][0]["last_synced_at"],
    } == {
        "id": links["links"][0]["id"],
        "announcement_id": "ann-2",
        "announcement_title": "Homework 1 released",
        "assignment_id": "asg-1",
        "assignment_title": "Homework 1",
        "course_id": "course-1",
        "link_source": "ann_id_launch_link",
        "confidence": "high",
        "evidence": {"ann_id": "_43635_1", "path_text": "/Homework/Homework 1"},
        "created_at": links["links"][0]["created_at"],
        "updated_at": links["links"][0]["updated_at"],
        "last_synced_at": links["links"][0]["last_synced_at"],
    }

    assert grades["ok"] is True
    assert grades["grades"][0] | {"id": grades["grades"][0]["id"]} == {
        "id": grades["grades"][0]["id"],
        "grade_id": "grade-1",
        "name": "Homework 1",
        "item_name": "Homework 1",
        "score": "9",
        "total_score": "10",
        "score_numeric": 9.0,
        "max_score": 10.0,
        "percentage": 90.0,
        "feedback": None,
        "status": "Graded",
        "grade_type": "Assignment",
        "category": "Homework",
        "due_date": "2026-05-01",
        "graded_date": "2026-05-02",
        "weight": 10.0,
        "is_counted": True,
        "source_url": "https://bb.sustech.edu.cn/grade-1",
        "course_id": "course-1",
    }


    assert resources["ok"] is True
    assert resources["resources"][0] | {"id": resources["resources"][0]["id"]} == {
        "id": resources["resources"][0]["id"],
        "resource_id": "res-1",
        "title": "Lecture 1 slides",
        "name": "Lecture 1 slides",
        "url": "https://bb.sustech.edu.cn/res-1.pdf",
        "type": "pdf",
        "size": "1 MB",
        "course_id": "course-1",
        "assignment_id": None,
        "source_page": "https://bb.sustech.edu.cn/course-1/content",
        "local_path": "downloads/course-1/res-1.pdf",
        "is_downloaded": True,
        "download_failed": False,
        "parent_id": None,
    }


def test_blackboard_ui_progress_stage_inference_tracks_snapshot_sync_messages() -> None:
    assert _infer_progress_stage("使用 CASClient 认证") == "authenticating"
    assert _infer_progress_stage("抓取 Blackboard 基础实时数据") == "fetching_courses"
    assert _infer_progress_stage("✅ 课程列表抓取成功：3 门") == "fetching_courses"
    assert _infer_progress_stage("✅ 已按当前学期筛选课程：2/5 门（当前学期：Spring 2026）") == "fetching_courses"
    assert _infer_progress_stage("▶ 处理课程 [1/3]: 数据结构 (course-1)") == "fetching_details"
    assert _infer_progress_stage("  作业: 2") == "fetching_details"
    assert _infer_progress_stage("▶ 同步数据库: /tmp/blackboard.db") == "syncing_db"
    assert _infer_progress_stage("第二次同步验证通过") == "verifying"


def test_blackboard_ui_markdown_normalization_trims_lines_and_removes_extra_blank_lines() -> None:
    assert blackboard_ui._normalize_markdown_text(
        "  First line  \r\n\r\n   \r\n  - item 1  \r\n\r\n\r\n  - item 2  \r\n"
    ) == "First line\n\n- item 1\n\n- item 2"

    assert blackboard_ui._normalize_markdown_text(" \r\n \r\n ") is None


def test_blackboard_ui_progress_update_exposes_capped_logs() -> None:
    state = {"progressStage": "authenticating", "progressMessage": None, "progressLogs": []}

    _update_sync_progress(state, "抓取 Blackboard 基础实时数据", max_logs=2)
    _update_sync_progress(state, "▶ 处理课程 [1/1]: 数据结构 (course-1)", max_logs=2)
    _update_sync_progress(state, "▶ 同步数据库: /tmp/blackboard.db", max_logs=2)

    assert state["progressStage"] == "syncing_db"
    assert state["progressMessage"] == "▶ 同步数据库: /tmp/blackboard.db"
    assert state["progressLogs"] == [
        "▶ 处理课程 [1/1]: 数据结构 (course-1)",
        "▶ 同步数据库: /tmp/blackboard.db",
    ]


def test_blackboard_ui_status_route_prefers_bridge_persisted_snapshot(
    tmp_path: Path,
) -> None:
    persisted_status = {
        "status": "running",
        "lastSyncAt": None,
        "lastSyncError": None,
        "progressStage": "fetching_details",
        "progressMessage": "▶ 处理课程 [1/2]: 数据结构 (course-1)",
        "progressLogs": ["开始同步...", "▶ 处理课程 [1/2]: 数据结构 (course-1)"],
        "canCancel": False,
        "timeoutSeconds": 480,
        "updatedAt": "2026-05-03T03:00:00Z",
    }

    class _BridgeStub:
        async def get_state_value(self, **_kwargs):
            return dict(persisted_status)

    _reset_sync_status()
    app = FastAPI()
    app.state.runtime_config = _RuntimeConfig(tmp_path / "database")
    app.state.host_capability_bridge_client = _BridgeStub()
    app.include_router(build_blackboard_ui_router())

    with TestClient(app) as client:
        payload = client.get("/api/blackboard/sync/status").json()

    assert payload["status"] == "running"
    assert payload["progressStage"] == "fetching_details"
    assert payload["progressMessage"] == "▶ 处理课程 [1/2]: 数据结构 (course-1)"
    assert payload["progressLogs"] == [
        "开始同步...",
        "▶ 处理课程 [1/2]: 数据结构 (course-1)",
    ]


def test_blackboard_ui_trigger_returns_running_status_while_background_sync_reports_progress(
    tmp_path: Path,
    monkeypatch,
) -> None:
    started = threading.Event()
    release_sync = threading.Event()

    def fake_snapshot_sync(*_args, progress=None, **_kwargs):
        assert _kwargs["parallel_workers"] == 3
        assert _kwargs["current_term_only"] is True
        if progress is not None:
            progress("使用 CASClient 认证")
            progress("抓取 Blackboard 基础实时数据")
        started.set()
        assert release_sync.wait(timeout=2)
        return SimpleNamespace(
            snapshot=SimpleNamespace(
                logs=[SimpleNamespace(timestamp="2026-04-30T10:00:00Z")]
            )
        )

    monkeypatch.setattr(blackboard_ui, "run_blackboard_snapshot_sync", fake_snapshot_sync)

    with _build_client(tmp_path / "database") as client:
        response = client.post(
            "/api/blackboard/sync/trigger",
            json={
                "username": "student",
                "password": "secret",
                "parallelWorkers": 3,
                "currentTermOnly": True,
            },
        )
        payload = response.json()

        assert payload["message"] == "sync started"
        assert payload["status"] == "running"
        assert payload["progressStage"] in {"authenticating", "fetching_courses"}
        assert started.wait(timeout=2)

        status = client.get("/api/blackboard/sync/status").json()
        assert status["status"] == "running"
        assert status["progressStage"] == "fetching_courses"
        assert status["progressMessage"] == "抓取 Blackboard 基础实时数据"
        assert status["progressLogs"][-2:] == [
            "使用 CASClient 认证",
            "抓取 Blackboard 基础实时数据",
        ]

        release_sync.set()
        deadline = time.monotonic() + 2
        completed = status
        while time.monotonic() < deadline:
            completed = client.get("/api/blackboard/sync/status").json()
            if completed["status"] == "completed":
                break
            time.sleep(0.01)

        assert completed["status"] == "completed"
        assert completed["lastSyncAt"] == "2026-04-30T10:00:00Z"


def test_blackboard_ui_cancel_route_requests_cancellation_and_marks_sync_failed(
    tmp_path: Path,
    monkeypatch,
) -> None:
    started = threading.Event()

    def fake_snapshot_sync(*_args, progress=None, **_kwargs):
        while not started.is_set():
            time.sleep(0.01)
        assert progress is not None
        while True:
            progress("▶ 处理课程 [1/1]: 数据结构 (course-1)")
            time.sleep(0.01)

    monkeypatch.setattr(blackboard_ui, "run_blackboard_snapshot_sync", fake_snapshot_sync)

    with _build_client(tmp_path / "database") as client:
        response = client.post(
            "/api/blackboard/sync/trigger",
            json={"username": "student", "password": "secret", "parallelWorkers": 1},
        )
        payload = response.json()
        assert payload["status"] == "running"
        started.set()

        cancel_payload = client.post("/api/blackboard/sync/cancel").json()
        assert cancel_payload["message"] == "sync cancellation requested"
        assert cancel_payload["canCancel"] is False

        deadline = time.monotonic() + 2
        cancelled = cancel_payload
        while time.monotonic() < deadline:
            cancelled = client.get("/api/blackboard/sync/status").json()
            if cancelled["status"] == "failed":
                break
            time.sleep(0.01)

        assert cancelled["status"] == "failed"
        assert cancelled["lastSyncError"] == "同步已取消"
        assert "正在取消同步..." in cancelled["progressLogs"]


def test_blackboard_ui_trigger_times_out_when_progress_callback_exceeds_limit(
    tmp_path: Path,
    monkeypatch,
) -> None:
    original_timeout = blackboard_ui._SYNC_TIMEOUT_SECONDS

    def fake_snapshot_sync(*_args, progress=None, **_kwargs):
        assert progress is not None
        time.sleep(0.03)
        progress("▶ 处理课程 [1/1]: 数据结构 (course-1)")
        return SimpleNamespace(snapshot=SimpleNamespace(logs=[]))

    monkeypatch.setattr(blackboard_ui, "run_blackboard_snapshot_sync", fake_snapshot_sync)
    monkeypatch.setattr(blackboard_ui, "_SYNC_TIMEOUT_SECONDS", 0.01)
    blackboard_ui._sync_status["timeoutSeconds"] = 0.01

    try:
        with _build_client(tmp_path / "database") as client:
            response = client.post(
                "/api/blackboard/sync/trigger",
                json={"username": "student", "password": "secret", "parallelWorkers": 1},
            )
            payload = response.json()
            assert payload["status"] == "running"

            deadline = time.monotonic() + 2
            failed = payload
            while time.monotonic() < deadline:
                failed = client.get("/api/blackboard/sync/status").json()
                if failed["status"] == "failed":
                    break
                time.sleep(0.01)

            assert failed["status"] == "failed"
            assert "同步超时" in failed["lastSyncError"]
    finally:
        monkeypatch.setattr(blackboard_ui, "_SYNC_TIMEOUT_SECONDS", original_timeout)
        blackboard_ui._sync_status["timeoutSeconds"] = original_timeout


def test_blackboard_ui_rebuild_announcement_links_route_backfills_existing_rows(
    tmp_path: Path,
) -> None:
    database_dir = tmp_path / "database"
    manager = DatabaseManager(
        resolve_default_blackboard_db_path(database_dir),
        reset_schema=True,
    )
    manager.sync_courses(
        [
            {
                "course_id": "_8132_1",
                "name": "Computer Organization Spring 2026",
                "url": "https://bb.sustech.edu.cn/course/_8132_1",
            }
        ]
    )
    manager.sync_assignments(
        "_8132_1",
        [
            {
                "assignment_id": "asg_hw2",
                "title": "Homework 2",
                "url": "https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment?course_id=_8132_1&content_id=_596747_1",
                "source_page": "https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id=_8132_1#contentListItem:_596747_1",
            }
        ],
    )
    manager.sync_announcements(
        [
            {
                "announcement_id": "ann_hw2_release",
                "course_id": "_8132_1",
                "course_name": "Computer Organization Spring 2026",
                "title": "Lab assignment 2 released",
                "content": "Please open Homework 2 from Blackboard.",
                "content_html": '<p><a href="/webapps/blackboard/content/launchLink.jsp?ann_id=_43635_1&course_id=_8132_1&mode=view">/Homework/Homework 2</a></p>',
                "publish_time": "2026-04-19 16:48",
            }
        ],
        links_data=[],
    )

    with _build_client(database_dir) as client:
        response = client.post("/api/blackboard/sync/rebuild-announcement-links")

    payload = response.json()
    assert payload["ok"] is True
    assert payload["links"] == 1
    assert payload["announcements"] == 1


def test_blackboard_ui_resource_download_start_persists_preferences_and_exposes_downloading_status(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_dir = tmp_path / "database"
    _seed_blackboard_database(database_dir)
    manager = DatabaseManager(resolve_default_blackboard_db_path(database_dir))
    selected_directory = tmp_path / "downloads"
    selected_directory.mkdir(parents=True, exist_ok=True)
    resource_url = "https://bb.sustech.edu.cn/res-1.pdf"

    monkeypatch.setattr(
        blackboard_ui,
        "_start_resource_download_worker",
        lambda *_args, **_kwargs: None,
    )

    with _build_client(database_dir) as client:
        payload = client.post(
            "/api/blackboard/resources/downloads/select-start",
            json={
                "username": "student",
                "password": "secret",
                "course_id": "course-1",
                "resource_url": resource_url,
                "resource_title": "Lecture 1 slides.pdf",
                "directory_path": str(selected_directory),
            },
        ).json()

        assert payload["ok"] is True
        assert payload["task"]["state"] == "downloading"
        assert payload["task"]["preferred_directory"] == str(selected_directory)

        status_payload = client.get(
            "/api/blackboard/resources/downloads/status",
            params={
                "course_id": "course-1",
                "resource_urls": resource_url,
            },
        ).json()

    assert status_payload["ok"] is True
    assert status_payload["statuses"][0]["state"] == "downloading"
    assert status_payload["statuses"][0]["preferred_directory"] == str(
        selected_directory
    )

    resource_pref = _get_directory_preference(manager, "resource", resource_url)
    course_pref = _get_directory_preference(manager, "course", "course-1")
    assert resource_pref is not None
    assert resource_pref.directory_path == str(selected_directory)
    assert course_pref is not None
    assert course_pref.directory_path == str(selected_directory)


def test_blackboard_ui_resource_download_cancel_marks_task_cancel_requested(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_dir = tmp_path / "database"
    _seed_blackboard_database(database_dir)
    selected_directory = tmp_path / "downloads"
    selected_directory.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(
        blackboard_ui,
        "_start_resource_download_worker",
        lambda *_args, **_kwargs: None,
    )

    with _build_client(database_dir) as client:
        start_payload = client.post(
            "/api/blackboard/resources/downloads/select-start",
            json={
                "username": "student",
                "password": "secret",
                "course_id": "course-1",
                "resource_url": "https://bb.sustech.edu.cn/res-1.pdf",
                "resource_title": "Lecture 1 slides.pdf",
                "directory_path": str(selected_directory),
            },
        ).json()
        task_id = start_payload["task"]["task_id"]

        cancel_payload = client.post(
            "/api/blackboard/resources/downloads/cancel",
            json={"task_id": task_id},
        ).json()

    assert cancel_payload["ok"] is True
    assert cancel_payload["accepted"] is True
    assert cancel_payload["task"]["cancel_requested"] is True


def test_blackboard_ui_resources_route_reprojects_download_binding_state(
    tmp_path: Path,
) -> None:
    database_dir = tmp_path / "database"
    _seed_blackboard_database(database_dir)
    manager = DatabaseManager(resolve_default_blackboard_db_path(database_dir))
    downloaded_file = tmp_path / "downloads" / "res-1.pdf"
    downloaded_file.parent.mkdir(parents=True, exist_ok=True)
    downloaded_file.write_bytes(b"pdf")

    with manager._session_scope() as session:
        resource = session.query(Resource).filter(Resource.resource_id == "res-1").one()
        resource.local_path = None
        resource.is_downloaded = False
        resource.download_failed = True
        session.add(
            ResourceDownloadBinding(
                course_id="course-1",
                resource_id=None,
                resource_url_key="https://bb.sustech.edu.cn/res-1.pdf",
                local_path=str(downloaded_file),
                directory_path=str(downloaded_file.parent),
                file_name=downloaded_file.name,
                downloaded_at=datetime(2026, 5, 2, 12, 0),
                verified_at=datetime(2026, 5, 2, 12, 0),
                file_size_bytes=3,
                content_length=3,
                is_deleted=False,
            )
        )

    with _build_client(database_dir) as client:
        payload = client.get("/api/blackboard/data/courses/course-1/resources").json()

    assert payload["ok"] is True
    assert payload["resources"][0]["local_path"] == str(downloaded_file)
    assert payload["resources"][0]["is_downloaded"] is True
    assert payload["resources"][0]["download_failed"] is False
    projected_resource = _get_resource(manager, "res-1")
    assert projected_resource is not None
    assert projected_resource.local_path == str(downloaded_file)
    assert projected_resource.is_downloaded is True
    assert projected_resource.download_failed is False


def test_blackboard_ui_resources_route_cleans_missing_download_binding_file(
    tmp_path: Path,
) -> None:
    database_dir = tmp_path / "database"
    _seed_blackboard_database(database_dir)
    manager = DatabaseManager(resolve_default_blackboard_db_path(database_dir))
    missing_file = tmp_path / "downloads" / "missing.pdf"

    with manager._session_scope() as session:
        resource = session.query(Resource).filter(Resource.resource_id == "res-1").one()
        resource.local_path = str(missing_file)
        resource.is_downloaded = True
        resource.download_failed = False
        session.add(
            ResourceDownloadBinding(
                course_id="course-1",
                resource_id="res-1",
                resource_url_key="https://bb.sustech.edu.cn/res-1.pdf",
                local_path=str(missing_file),
                directory_path=str(missing_file.parent),
                file_name=missing_file.name,
                downloaded_at=datetime(2026, 5, 2, 12, 0),
                verified_at=datetime(2026, 5, 2, 12, 0),
                file_size_bytes=3,
                content_length=3,
                is_deleted=False,
            )
        )

    with _build_client(database_dir) as client:
        payload = client.get("/api/blackboard/data/courses/course-1/resources").json()

    assert payload["ok"] is True
    assert payload["resources"][0]["local_path"] is None
    assert payload["resources"][0]["is_downloaded"] is False
    cleaned_resource = _get_resource(manager, "res-1")
    assert cleaned_resource is not None
    assert cleaned_resource.local_path is None
    assert cleaned_resource.is_downloaded is False
    binding = _get_download_binding(manager, "https://bb.sustech.edu.cn/res-1.pdf")
    assert binding is not None
    assert binding.is_deleted is True


def test_blackboard_ui_sync_trigger_reassociates_download_binding_by_url(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_dir = tmp_path / "database"
    _seed_blackboard_database(database_dir)
    manager = DatabaseManager(resolve_default_blackboard_db_path(database_dir))
    downloaded_file = tmp_path / "downloads" / "res-1.pdf"
    downloaded_file.parent.mkdir(parents=True, exist_ok=True)
    downloaded_file.write_bytes(b"pdf")

    with manager._session_scope() as session:
        resource = session.query(Resource).filter(Resource.resource_id == "res-1").one()
        resource.local_path = None
        resource.is_downloaded = False
        resource.download_failed = False
        session.add(
            ResourceDownloadBinding(
                course_id="course-1",
                resource_id=None,
                resource_url_key="https://bb.sustech.edu.cn/res-1.pdf",
                local_path=str(downloaded_file),
                directory_path=str(downloaded_file.parent),
                file_name=downloaded_file.name,
                downloaded_at=datetime(2026, 5, 2, 12, 0),
                verified_at=datetime(2026, 5, 2, 12, 0),
                file_size_bytes=3,
                content_length=3,
                is_deleted=False,
            )
        )

    def fake_snapshot_sync(*_args, **_kwargs):
        return SimpleNamespace(
            snapshot=SimpleNamespace(
                logs=[SimpleNamespace(timestamp="2026-05-02T12:00:00Z")]
            )
        )

    monkeypatch.setattr(blackboard_ui, "run_blackboard_snapshot_sync", fake_snapshot_sync)

    with _build_client(database_dir) as client:
        payload = client.post(
            "/api/blackboard/sync/trigger",
            json={"username": "student", "password": "secret", "parallelWorkers": 1},
        ).json()
        assert payload["status"] == "running"

        deadline = time.monotonic() + 2
        completed = payload
        while time.monotonic() < deadline:
            completed = client.get("/api/blackboard/sync/status").json()
            if completed["status"] == "completed":
                break
            time.sleep(0.01)

    assert completed["status"] == "completed"
    projected_resource = _get_resource(manager, "res-1")
    assert projected_resource is not None
    assert projected_resource.local_path == str(downloaded_file)
    assert projected_resource.is_downloaded is True

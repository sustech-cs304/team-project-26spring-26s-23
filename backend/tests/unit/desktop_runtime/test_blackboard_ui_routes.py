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
    Course,
    Grade,
    Resource,
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
    )


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
                total_announcements=1,
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
                author="Ada Lovelace",
                posted_at=datetime(2026, 4, 30, 9, 15),
                url="https://bb.sustech.edu.cn/ann-1",
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
            "total_announcements": 1,
        }
    ]


def test_blackboard_ui_detail_routes_use_current_database_model_fields(tmp_path: Path) -> None:
    database_dir = tmp_path / "database"
    _seed_blackboard_database(database_dir)

    with _build_client(database_dir) as client:
        announcements = client.get(
            "/api/blackboard/data/courses/course-1/announcements"
        ).json()
        grades = client.get("/api/blackboard/data/courses/course-1/grades").json()
        resources = client.get("/api/blackboard/data/courses/course-1/resources").json()

    assert announcements["ok"] is True
    assert announcements["announcements"][0] | {
        "id": announcements["announcements"][0]["id"],
        "publish_time": announcements["announcements"][0]["publish_time"],
    } == {
        "id": announcements["announcements"][0]["id"],
        "announcement_id": "ann-1",
        "title": "Welcome",
        "body": "Welcome to Blackboard.",
        "content": "Welcome to Blackboard.",
        "author": "Ada Lovelace",
        "publish_time": announcements["announcements"][0]["publish_time"],
        "posted_at": announcements["announcements"][0]["posted_at"],
        "url": "https://bb.sustech.edu.cn/ann-1",
        "course_id": "course-1",
        "course_name": "CS101-30000001: Intro Spring 2026",
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
    assert _infer_progress_stage("▶ 处理课程 [1/3]: 数据结构 (course-1)") == "fetching_details"
    assert _infer_progress_stage("  作业: 2") == "fetching_details"
    assert _infer_progress_stage("▶ 同步数据库: /tmp/blackboard.db") == "syncing_db"
    assert _infer_progress_stage("第二次同步验证通过") == "verifying"


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


def test_blackboard_ui_trigger_returns_running_status_while_background_sync_reports_progress(
    tmp_path: Path,
    monkeypatch,
) -> None:
    started = threading.Event()
    release_sync = threading.Event()

    def fake_snapshot_sync(*_args, progress=None, **_kwargs):
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
            json={"username": "student", "password": "secret"},
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

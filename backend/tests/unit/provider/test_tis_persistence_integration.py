from __future__ import annotations

from pathlib import Path

from app.integrations.sustech.teaching_information_system.api.dto import (
    TISCreditGPASummary,
    TISCreditGPATermRecord,
    TISCreditGPAYearRecord,
    TISGradeRecord,
    TISHomepageProfile,
    TISProbeResult,
    TISSelectedCourseRecord,
    TISSelectedCourseSemester,
    TISServiceConfig,
)
from app.integrations.sustech.teaching_information_system.data import TISDatabaseManager
from app.integrations.sustech.teaching_information_system.provider.use_cases import credit_gpa as credit_gpa_use_case
from app.integrations.sustech.teaching_information_system.provider.use_cases import personal_grades as personal_grades_use_case
from app.integrations.sustech.teaching_information_system.provider.use_cases import selected_courses as selected_courses_use_case


class _FakeTISClient:
    def __init__(self, *, config: TISServiceConfig | None = None, logger=None) -> None:
        self.config = config or TISServiceConfig()
        self.logger = logger
        self.context = type("Context", (), {"role_code": "01", "set_role_code": lambda self, value: None})()
        self.pylx = "1"

    def login(self, username: str, password: str, *, role_code: str | None = None) -> bool:
        return True

    def fetch_homepage(self) -> str:
        return "<html><title>TIS</title></html>"

    def close(self) -> None:
        return None

    def probe(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        raise NotImplementedError


def _db_path(tmp_path: Path, name: str) -> Path:
    return tmp_path / f"{name}.db"


def test_fetch_personal_grades_with_persist_writes_database(tmp_path: Path, monkeypatch) -> None:
    db_manager = TISDatabaseManager(_db_path(tmp_path, "tis_provider_persist"), reset_schema=True)

    monkeypatch.setattr(personal_grades_use_case, "TISClient", _FakeTISClient)
    monkeypatch.setattr(
        personal_grades_use_case,
        "analyze_homepage_html",
        lambda html, page_url, base_url: TISHomepageProfile(page_url=page_url, title="TIS", role_codes=["01"]),
    )
    monkeypatch.setattr(
        personal_grades_use_case,
        "probe_grade_candidates",
        lambda tis_client, homepage, logger=None, max_probe_count=12: [
            TISProbeResult(
                url="https://tis.sustech.edu.cn/cjgl/grcjcx/grcjcx",
                method="POST",
                status_code=200,
                record_count=1,
                grade_records=[TISGradeRecord(course_name="Course A", course_code="CS101", term="2025-20261", score="95")],
                is_json=True,
            )
        ],
    )

    result = personal_grades_use_case.fetch_personal_grades_with_credentials(
        "student_a",
        "password",
        persist=True,
        db_manager=db_manager,
        owner_key="student_a",
    )

    assert result.success is True
    assert result.persistence is not None
    assert result.persistence["enabled"] is True
    assert result.persistence["owner_key"] == "student_a"
    assert result.persistence["resources"]["personal_grades"]["stats"]["inserted"] == 1
    assert db_manager.get_table_counts()["personal_grades"] == {"total": 1, "active": 1}


def test_fetch_credit_gpa_with_persist_writes_database(tmp_path: Path, monkeypatch) -> None:
    db_manager = TISDatabaseManager(_db_path(tmp_path, "tis_credit_gpa_persist"), reset_schema=True)

    class _FakeResponse:
        def __init__(self, url: str, payload: dict | None = None) -> None:
            self.url = url
            self.status_code = 200
            self.headers = {"content-type": "application/json;charset=utf-8"}
            self.history = []
            self.request = type("Request", (), {"url": url, "method": "POST", "headers": {}})()
            self._payload = payload or {}

        def raise_for_status(self) -> None:
            return None

        def json(self):  # type: ignore[no-untyped-def]
            return self._payload

        @property
        def text(self) -> str:
            return "{}"

    class _FakeCreditGPAClient(_FakeTISClient):
        def probe(self, url: str, *args, **kwargs):  # type: ignore[no-untyped-def]
            if str(url).endswith("queryXnAndXqXfj"):
                return _FakeResponse(
                    str(url),
                    {
                        "xfjandpm": {"PJXFJ": 3.78, "PM": "7/100"},
                        "xnanxqxfj": [
                            {"XNXQ": "2025秋季", "XN": "2025-2026", "XQ": "1", "XQXFJ": 3.78, "XNXFJ": 3.78}
                        ],
                    },
                )
            return _FakeResponse(str(url))

    monkeypatch.setattr(credit_gpa_use_case, "TISClient", _FakeCreditGPAClient)
    monkeypatch.setattr(
        credit_gpa_use_case,
        "analyze_homepage_html",
        lambda html, page_url, base_url: TISHomepageProfile(page_url=page_url, title="TIS", role_codes=["01"]),
    )

    result = credit_gpa_use_case.fetch_credit_gpa_with_credentials(
        "student_gpa",
        "password",
        persist=True,
        db_manager=db_manager,
        owner_key="student_gpa",
    )

    assert result.success is True
    assert result.persistence is not None
    assert result.persistence["resources"]["credit_gpa"]["resources"]["summary"]["stats"]["inserted"] == 1
    assert db_manager.get_table_counts()["credit_gpa_summary"] == {"total": 1, "active": 1}
    assert db_manager.get_table_counts()["credit_gpa_terms"] == {"total": 1, "active": 1}
    assert db_manager.get_table_counts()["credit_gpa_years"] == {"total": 1, "active": 1}


def test_fetch_selected_courses_with_persist_writes_database(tmp_path: Path, monkeypatch) -> None:
    db_manager = TISDatabaseManager(_db_path(tmp_path, "tis_selected_courses_persist"), reset_schema=True)

    class _FakeResponse:
        def __init__(self, url: str, payload: dict | None = None, *, content_type: str = "application/json;charset=utf-8") -> None:
            self.url = url
            self.status_code = 200
            self.headers = {"content-type": content_type}
            self.history = []
            self.request = type("Request", (), {"url": url, "method": "POST", "headers": {}})()
            self._payload = payload or {}

        def raise_for_status(self) -> None:
            return None

        def json(self):  # type: ignore[no-untyped-def]
            return self._payload

        @property
        def text(self) -> str:
            return "{}"

    class _FakeSelectedCoursesClient(_FakeTISClient):
        def probe(self, url: str, *args, **kwargs):  # type: ignore[no-untyped-def]
            if str(url).endswith("queryXkdqXnxq"):
                return _FakeResponse(str(url), {"p_dqxn": "2025-2026", "p_dqxq": "1", "p_xn": "2025-2026", "p_xq": "1"})
            if str(url).endswith("queryYxkc"):
                return _FakeResponse(
                    str(url),
                    {
                        "yxkcList": [
                            {"kcdm": "CS101", "kcmc": "Course A", "kxh": "001", "xf": 3.0, "xnxq": "2025-20261"}
                        ]
                    },
                )
            return _FakeResponse(str(url), content_type="text/html;charset=utf-8")

    monkeypatch.setattr(selected_courses_use_case, "TISClient", _FakeSelectedCoursesClient)
    monkeypatch.setattr(
        selected_courses_use_case,
        "analyze_homepage_html",
        lambda html, page_url, base_url: TISHomepageProfile(page_url=page_url, title="TIS", role_codes=["01"]),
    )

    result = selected_courses_use_case.fetch_selected_courses_with_credentials(
        "student_courses",
        "password",
        persist=True,
        db_manager=db_manager,
        owner_key="student_courses",
    )

    assert result.success is True
    assert result.persistence is not None
    assert result.persistence["resources"]["selected_courses"]["stats"]["inserted"] == 1
    assert db_manager.get_table_counts()["selected_courses"] == {"total": 1, "active": 1}

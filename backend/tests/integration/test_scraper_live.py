from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.blackboard.api import BlackboardAPIContext, BlackboardContentAPI, BlackboardCourseAPI
from app.core.auth.cas_client import CASClient
from tests.helpers import require_live_credentials

pytestmark = pytest.mark.live


def _safe_dir_name(name: str) -> str:
    safe = re.sub(r"[\/:*?\"<>|]", "_", name).strip()
    return safe or "unknown_course"


def _safe_file_name(name: str) -> str:
    safe = re.sub(r"[\/:*?\"<>|]", "_", name).strip()
    return safe or "resource"


def test_api_live_flow(tmp_path: Path) -> None:
    username, password = require_live_credentials()

    cas_client = CASClient()
    try:
        bb_service_url = "https://bb.sustech.edu.cn/webapps/login/"
        assert cas_client.login(username, password, bb_service_url)

        course_api = BlackboardCourseAPI(cas_client.client)
        content_api = BlackboardContentAPI(BlackboardAPIContext(client=cas_client.client, debug_enabled=False))

        courses = course_api.get_courses()
        if not courses:
            pytest.skip("当前账号未返回课程，跳过 live API 校验")

        first_course = courses[0]
        first_course_id = str(first_course.course_id or "")
        first_course_name = str(first_course.name or "")
        assert first_course_id
        assert first_course_name

        resources = content_api.get_course_content_dtos(first_course_id)
        if not resources:
            pytest.skip("当前课程未解析到资源，跳过下载校验")

        first_resource = next((item for item in resources if item.url and item.type != "folder"), None)
        if first_resource is None:
            pytest.skip("当前课程资源没有可下载链接，跳过下载校验")

        first_url = str(first_resource.url or "")
        filename = _safe_file_name(str(first_resource.title or "resource"))
        ext = str(first_resource.type or "").strip().lower()
        if ext and ext != "link" and not Path(filename).suffix:
            filename = f"{filename}.{ext}"

        download_dir = tmp_path / "downloads" / _safe_dir_name(first_course_name)
        download_dir.mkdir(parents=True, exist_ok=True)
        save_path = download_dir / filename

        with cas_client.client.stream("GET", first_url) as response:
            response.raise_for_status()
            with save_path.open("wb") as file_obj:
                for chunk in response.iter_bytes(chunk_size=8192):
                    if chunk:
                        file_obj.write(chunk)

        assert save_path.exists()
    finally:
        cas_client.close()

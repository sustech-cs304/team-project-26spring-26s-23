"""TIS 已选课程 provider use case。"""

from __future__ import annotations

from urllib.parse import urljoin

from app.integrations.sustech.teaching_information_system.api.client import TISClient
from app.integrations.sustech.teaching_information_system.api.constants import (
    _DEFAULT_TIS_ENTRY_PATH,
    _DEFAULT_TIS_SELECTED_COURSES_API_PATH,
    _DEFAULT_TIS_SELECTED_COURSES_CURRENT_TERM_PATH,
    _DEFAULT_TIS_SELECTED_COURSES_PAGE_PATH,
)
from app.integrations.sustech.teaching_information_system.api.dto import (
    DEFAULT_TIS_SERVICE_CONFIG,
    TISSelectedCoursesQueryResult,
    TISServiceConfig,
)
from app.integrations.sustech.teaching_information_system.api.fetch_helpers import (
    _is_authenticated_tis_response,
    _safe_parse_json_response,
)
from app.integrations.sustech.teaching_information_system.api.grades import (
    _build_tis_probe_result,
)
from app.integrations.sustech.teaching_information_system.api.homepage import (
    analyze_homepage_html,
)
from app.integrations.sustech.teaching_information_system.api.selected_courses import (
    _build_selected_courses_base_payload,
    _extract_selected_courses_current_semester,
    _parse_selected_course_semester_argument,
    build_selected_course_summary,
    extract_selected_course_records_from_json,
)
from app.integrations.sustech.teaching_information_system.data import TISDatabaseManager
from app.integrations.sustech.teaching_information_system.provider.results import (
    TISPersistenceSummary,
    attach_persistence_summary,
    resource_result,
)
from app.integrations.sustech.teaching_information_system.shared import (
    _clean_text,
    create_tis_log_session,
)


def fetch_selected_courses_with_credentials(
    username: str,
    password: str,
    *,
    semester: str | None = None,
    role_code: str | None = None,
    homepage_html: str | None = None,
    config: TISServiceConfig | None = None,
    enable_console_logging: bool = False,
    page_num: int = 1,
    page_size: int = 19,
    persist: bool = False,
    db_manager: TISDatabaseManager | None = None,
    owner_key: str | None = None,
) -> TISSelectedCoursesQueryResult:
    normalized_username = _clean_text(username)
    normalized_password = str(password or "").strip()
    if not normalized_username or not normalized_password:
        raise ValueError("缺少 TIS/CAS 用户名或密码")

    service_config = config or DEFAULT_TIS_SERVICE_CONFIG
    log_session = create_tis_log_session(console=enable_console_logging)
    logger = log_session.make_logger(
        layer="provider",
        source="teaching_information_system.fetch_selected_courses",
        context={
            "base_url": service_config.base_url,
            "role_code": _clean_text(role_code) or None,
            "semester": _clean_text(semester) or None,
        },
    )

    tis_client = TISClient(
        config=service_config, logger=logger.child("teaching_information_system.client")
    )
    try:
        logger.info("▶ 开始建立 TIS 会话")
        if not tis_client.login(
            normalized_username, normalized_password, role_code=role_code
        ):
            raise RuntimeError("CAS 登录成功状态未能传递到 TIS")

        if homepage_html is None:
            logger.info("▶ 抓取 TIS 首页 HTML")
            homepage_html = tis_client.fetch_homepage()
        else:
            logger.info("ℹ 使用外部提供的 TIS 首页 HTML")

        homepage = analyze_homepage_html(
            homepage_html,
            page_url=service_config.homepage_url,
            base_url=service_config.base_url,
        )
        if tis_client.context.role_code is None:
            resolved_role_code = homepage.role_codes[0] if homepage.role_codes else "01"
            tis_client.context.set_role_code(resolved_role_code)
            logger.info(
                "ℹ 已补全 TIS RoleCode",
                payload={
                    "resolved_role_code": tis_client.context.role_code,
                    "source": "homepage"
                    if homepage.role_codes
                    else "default-student-selected-course-role",
                },
            )

        page_url = urljoin(
            service_config.base_url, _DEFAULT_TIS_SELECTED_COURSES_PAGE_PATH
        )
        current_term_url = urljoin(
            service_config.base_url, _DEFAULT_TIS_SELECTED_COURSES_CURRENT_TERM_PATH
        )
        api_url = urljoin(
            service_config.base_url, _DEFAULT_TIS_SELECTED_COURSES_API_PATH
        )
        resolved_pylx = tis_client.pylx or "1"

        logger.info("▶ 访问 TIS 我要选课页面", payload={"page_url": page_url})
        page_response = tis_client.probe(
            page_url,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Referer": urljoin(service_config.base_url, _DEFAULT_TIS_ENTRY_PATH),
            },
        )
        page_response.raise_for_status()
        if not _is_authenticated_tis_response(
            page_response, base_url=service_config.base_url
        ):
            raise RuntimeError("TIS 我要选课页面返回了未认证内容")

        current_term_request_payload = _build_selected_courses_base_payload(
            pylx=resolved_pylx, selected_credit_flag="0"
        )
        logger.info(
            "▶ 请求 TIS 当前选课学期上下文",
            payload={"current_term_url": current_term_url},
        )
        current_term_response = tis_client.probe(
            current_term_url,
            method="POST",
            params=current_term_request_payload,
            headers={
                "Accept": "*/*",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Origin": service_config.base_url,
                "Referer": page_url,
            },
        )
        current_term_response.raise_for_status()
        if not _is_authenticated_tis_response(
            current_term_response, base_url=service_config.base_url
        ):
            raise RuntimeError("TIS 当前选课学期接口返回了未认证内容")

        current_term_payload = _safe_parse_json_response(current_term_response)
        if not isinstance(current_term_payload, dict):
            raise RuntimeError("TIS 当前选课学期接口返回的响应不是有效 JSON")
        current_semester = _extract_selected_courses_current_semester(
            current_term_payload
        )
        actual_semester = _parse_selected_course_semester_argument(
            semester, current_semester=current_semester
        )
        semester_source = (
            "parameter" if semester is not None else "default-current-term"
        )

        request_payload = _build_selected_courses_base_payload(
            pylx=resolved_pylx,
            academic_year=actual_semester.academic_year,
            term_code=actual_semester.term_code,
            semester_id=actual_semester.semester_id,
            current_academic_year=current_semester.academic_year
            if current_semester is not None
            else actual_semester.academic_year,
            current_term_code=current_semester.term_code
            if current_semester is not None
            else actual_semester.term_code,
            current_semester_id=current_semester.semester_id
            if current_semester is not None
            else actual_semester.semester_id,
            selection_mode="yixuan",
            page_num=page_num,
            page_size=page_size,
            selected_credit_flag="",
        )

        logger.info(
            "▶ 请求 TIS 已选课程明细接口",
            payload={
                "api_url": api_url,
                "semester_id": actual_semester.semester_id,
                "semester_source": semester_source,
            },
        )
        api_response = tis_client.probe(
            api_url,
            method="POST",
            params=request_payload,
            headers={
                "Accept": "*/*",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Origin": service_config.base_url,
                "Referer": page_url,
            },
        )
        api_response.raise_for_status()
        if not _is_authenticated_tis_response(
            api_response, base_url=service_config.base_url
        ):
            raise RuntimeError("TIS 已选课程明细接口返回了未认证内容")

        payload = _safe_parse_json_response(api_response)
        if not isinstance(payload, dict):
            raise RuntimeError("TIS 已选课程明细接口返回的响应不是有效 JSON")
        if "yxkcList" not in payload:
            raise RuntimeError("TIS 已选课程明细接口未返回 yxkcList 字段")

        courses = extract_selected_course_records_from_json(
            payload, semester=actual_semester
        )
        summary = build_selected_course_summary(
            payload, courses=courses, page_num=page_num, page_size=page_size
        )
        probes = [
            _build_tis_probe_result(page_response, probe_label="selected-courses-page"),
            _build_tis_probe_result(
                current_term_response,
                probe_label="selected-courses-current-term",
                request_payload=current_term_request_payload,
            ),
            _build_tis_probe_result(
                api_response,
                probe_label="selected-courses-api",
                request_payload=request_payload,
                record_count=len(courses),
            ),
        ]
        logger.info(
            "✅ TIS 已选课程明细查询完成",
            payload={
                "page_url": page_url,
                "api_url": api_url,
                "actual_semester": actual_semester.semester_id,
                "current_semester": None
                if current_semester is None
                else current_semester.semester_id,
                "semester_source": semester_source,
                "course_count": len(courses),
                "total_credits": summary.total_credits,
                "resolved_role_code": tis_client.context.role_code,
                "resolved_pylx": resolved_pylx,
            },
        )
        result = TISSelectedCoursesQueryResult(
            success=True,
            source_url=api_url,
            page_url=page_url,
            api_url=api_url,
            homepage=homepage,
            semester=actual_semester,
            current_semester=current_semester,
            courses=courses,
            summary=summary,
            probes=probes,
            logs=log_session.snapshot(),
            resolved_role_code=tis_client.context.role_code,
            resolved_pylx=resolved_pylx,
            semester_source=semester_source,
        )
        if not persist:
            return attach_persistence_summary(result, None)

        resolved_owner_key = _clean_text(owner_key) or normalized_username
        resolved_db_manager = db_manager or TISDatabaseManager()
        stats = resolved_db_manager.sync_selected_courses(
            resolved_owner_key, actual_semester.semester_id, courses
        )
        persistence_summary = TISPersistenceSummary(
            enabled=True,
            owner_key=resolved_owner_key,
            db_path=resolved_db_manager.describe().db_path,
            resources={"selected_courses": resource_result("selected_courses", stats)},
            metadata={
                "semester_id": actual_semester.semester_id,
                "course_count": len(courses),
            },
        )
        logger.info("✅ TIS 已选课程持久化完成", payload=persistence_summary.to_dict())
        return attach_persistence_summary(result, persistence_summary)
    except Exception as ex:
        logger.exception("TIS 已选课程明细查询失败", ex)
        raise
    finally:
        tis_client.close()


__all__ = ["fetch_selected_courses_with_credentials"]

"""TIS 个人成绩 provider use case。"""

from __future__ import annotations

from app.integrations.sustech.teaching_information_system.api.client import TISClient
from app.integrations.sustech.teaching_information_system.api.dto import (
    DEFAULT_TIS_SERVICE_CONFIG,
    TISGradeQueryResult,
    TISGradeRecord,
    TISHomepageProfile,
    TISProbeResult,
    TISServiceConfig,
)
from app.integrations.sustech.teaching_information_system.api.grades import (
    probe_grade_candidates,
)
from app.integrations.sustech.teaching_information_system.api.homepage import (
    analyze_homepage_html,
)
from app.integrations.sustech.teaching_information_system.data import TISDatabaseManager
from app.integrations.sustech.teaching_information_system.provider.results import (
    TISPersistenceSummary,
    attach_persistence_summary,
    resource_result,
)
from app.integrations.sustech.teaching_information_system.shared import (
    TISLogSession,
    TISLogger,
    _clean_text,
    create_tis_log_session,
)


def _normalize_credentials(username: str, password: str) -> tuple[str, str]:
    normalized_username = _clean_text(username)
    normalized_password = str(password or "").strip()
    if not normalized_username or not normalized_password:
        raise ValueError("缺少 TIS/CAS 用户名或密码")
    return normalized_username, normalized_password


def _build_personal_grades_logger(
    log_session: TISLogSession,
    config: TISServiceConfig,
    role_code: str | None,
) -> TISLogger:
    return log_session.make_logger(
        layer="provider",
        source="teaching_information_system.fetch_personal_grades",
        context={
            "base_url": config.base_url,
            "role_code": _clean_text(role_code) or None,
        },
    )


def _login_tis_session(
    tis_client: TISClient,
    logger: TISLogger,
    username: str,
    password: str,
    role_code: str | None,
) -> None:
    logger.info("▶ 开始建立 TIS 会话")
    if not tis_client.login(username, password, role_code=role_code):
        raise RuntimeError("CAS 登录成功状态未能传递到 TIS")


def _resolve_homepage_html(
    tis_client: TISClient,
    logger: TISLogger,
    homepage_html: str | None,
) -> str:
    if homepage_html is None:
        logger.info("▶ 抓取 TIS 首页 HTML")
        return tis_client.fetch_homepage()
    logger.info("ℹ 使用外部提供的 TIS 首页 HTML")
    return homepage_html


def _ensure_role_code_from_homepage(
    tis_client: TISClient,
    homepage: TISHomepageProfile,
    logger: TISLogger,
) -> None:
    if tis_client.context.role_code is not None:
        return

    source = "homepage" if homepage.role_codes else "default-student-grade-role"
    tis_client.context.set_role_code(
        homepage.role_codes[0] if homepage.role_codes else "01"
    )
    logger.info(
        "ℹ 已补全 TIS RoleCode",
        payload={
            "resolved_role_code": tis_client.context.role_code,
            "source": source,
        },
    )


def _analyze_homepage(
    tis_client: TISClient,
    logger: TISLogger,
    service_config: TISServiceConfig,
    homepage_html: str,
) -> TISHomepageProfile:
    homepage = analyze_homepage_html(
        homepage_html,
        page_url=service_config.homepage_url,
        base_url=service_config.base_url,
    )
    _ensure_role_code_from_homepage(tis_client, homepage, logger)
    logger.info(
        "✅ TIS 首页分析完成",
        payload={
            "iframe_count": len(homepage.iframe_urls),
            "menu_count": len(homepage.menu_entries),
            "endpoint_count": len(homepage.discovered_endpoints),
            "grade_endpoint_count": len(homepage.grade_related_endpoints),
            "prefers_json_api": homepage.prefers_json_api,
            "role_code_count": len(homepage.role_codes),
            "resolved_role_code": tis_client.context.role_code,
        },
    )
    return homepage


def _collect_grade_records(probes: list[TISProbeResult]) -> list[TISGradeRecord]:
    grade_records: list[TISGradeRecord] = []
    for probe in probes:
        grade_records.extend(probe.grade_records)
    return grade_records


def _resolve_source_url(
    probes: list[TISProbeResult], homepage: TISHomepageProfile
) -> str:
    if probes:
        return probes[0].url
    return homepage.page_url


def _probe_personal_grades(
    tis_client: TISClient,
    homepage: TISHomepageProfile,
    logger: TISLogger,
    max_probe_count: int,
) -> tuple[list[TISProbeResult], list[TISGradeRecord], str]:
    probes = probe_grade_candidates(
        tis_client,
        homepage,
        logger=logger.child("teaching_information_system.probe"),
        max_probe_count=max_probe_count,
    )
    grade_records = _collect_grade_records(probes)
    source_url = _resolve_source_url(probes, homepage)
    logger.info(
        "✅ TIS 成绩候选探测完成",
        payload={
            "probe_count": len(probes),
            "record_count": len(grade_records),
            "source_url": source_url,
        },
    )
    return probes, grade_records, source_url


def _build_grade_query_result(
    homepage: TISHomepageProfile,
    grade_records: list[TISGradeRecord],
    probes: list[TISProbeResult],
    log_session: TISLogSession,
    resolved_role_code: str | None,
    source_url: str,
) -> TISGradeQueryResult:
    return TISGradeQueryResult(
        success=bool(grade_records),
        source_url=source_url,
        homepage=homepage,
        grade_records=grade_records,
        probes=probes,
        logs=log_session.snapshot(),
        resolved_role_code=resolved_role_code,
    )


def _persist_grade_result(
    result: TISGradeQueryResult,
    grade_records: list[TISGradeRecord],
    normalized_username: str,
    owner_key: str | None,
    db_manager: TISDatabaseManager | None,
    logger: TISLogger,
) -> TISGradeQueryResult:
    resolved_owner_key = _clean_text(owner_key) or normalized_username
    resolved_db_manager = db_manager or TISDatabaseManager()
    stats = resolved_db_manager.sync_personal_grades(resolved_owner_key, grade_records)
    summary = TISPersistenceSummary(
        enabled=True,
        owner_key=resolved_owner_key,
        db_path=resolved_db_manager.describe().db_path,
        resources={"personal_grades": resource_result("personal_grades", stats)},
        metadata={"record_count": len(grade_records)},
    )
    logger.info("✅ TIS 个人成绩持久化完成", payload=summary.to_dict())
    return attach_persistence_summary(result, summary)


def fetch_personal_grades_with_credentials(
    username: str,
    password: str,
    *,
    role_code: str | None = None,
    homepage_html: str | None = None,
    config: TISServiceConfig | None = None,
    enable_console_logging: bool = False,
    max_probe_count: int = 12,
    persist: bool = False,
    db_manager: TISDatabaseManager | None = None,
    owner_key: str | None = None,
) -> TISGradeQueryResult:
    normalized_username, normalized_password = _normalize_credentials(
        username, password
    )
    service_config = config or DEFAULT_TIS_SERVICE_CONFIG
    log_session = create_tis_log_session(console=enable_console_logging)
    logger = _build_personal_grades_logger(log_session, service_config, role_code)

    tis_client = TISClient(
        config=service_config,
        logger=logger.child("teaching_information_system.client"),
    )
    try:
        _login_tis_session(
            tis_client,
            logger,
            normalized_username,
            normalized_password,
            role_code,
        )
        resolved_homepage_html = _resolve_homepage_html(
            tis_client, logger, homepage_html
        )
        homepage = _analyze_homepage(
            tis_client,
            logger,
            service_config,
            resolved_homepage_html,
        )
        probes, grade_records, source_url = _probe_personal_grades(
            tis_client,
            homepage,
            logger,
            max_probe_count,
        )
        result = _build_grade_query_result(
            homepage,
            grade_records,
            probes,
            log_session,
            tis_client.context.role_code,
            source_url,
        )
        if not persist:
            return attach_persistence_summary(result, None)
        return _persist_grade_result(
            result,
            grade_records,
            normalized_username,
            owner_key,
            db_manager,
            logger,
        )
    except Exception as ex:
        logger.exception("TIS 个人成绩探测失败", ex)
        raise
    finally:
        tis_client.close()


__all__ = ["fetch_personal_grades_with_credentials"]

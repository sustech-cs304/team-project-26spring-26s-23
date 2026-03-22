"""TIS 个人成绩 provider use case。"""

from __future__ import annotations

from app.teaching_information_system.api import (
    DEFAULT_TIS_SERVICE_CONFIG,
    TISClient,
    TISGradeQueryResult,
    TISServiceConfig,
    analyze_homepage_html,
    probe_grade_candidates,
)
from app.teaching_information_system.data import TISDatabaseManager
from app.teaching_information_system.provider.results import TISPersistenceSummary, attach_persistence_summary, resource_result
from app.teaching_information_system.shared import _clean_text, create_tis_log_session


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
    normalized_username = _clean_text(username)
    normalized_password = str(password or "").strip()
    if not normalized_username or not normalized_password:
        raise ValueError("缺少 TIS/CAS 用户名或密码")

    service_config = config or DEFAULT_TIS_SERVICE_CONFIG
    log_session = create_tis_log_session(console=enable_console_logging)
    logger = log_session.make_logger(
        layer="provider",
        source="teaching_information_system.fetch_personal_grades",
        context={"base_url": service_config.base_url, "role_code": _clean_text(role_code) or None},
    )

    tis_client = TISClient(config=service_config, logger=logger.child("teaching_information_system.client"))
    try:
        logger.info("▶ 开始建立 TIS 会话")
        if not tis_client.login(normalized_username, normalized_password, role_code=role_code):
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
                    "source": "homepage" if homepage.role_codes else "default-student-grade-role",
                },
            )
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

        probes = probe_grade_candidates(
            tis_client,
            homepage,
            logger=logger.child("teaching_information_system.probe"),
            max_probe_count=max_probe_count,
        )
        grade_records = []
        for probe in probes:
            grade_records.extend(probe.grade_records)
        source_url = probes[0].url if probes else homepage.page_url
        logger.info(
            "✅ TIS 成绩候选探测完成",
            payload={"probe_count": len(probes), "record_count": len(grade_records), "source_url": source_url},
        )
        result = TISGradeQueryResult(
            success=bool(grade_records),
            source_url=source_url,
            homepage=homepage,
            grade_records=grade_records,
            probes=probes,
            logs=log_session.snapshot(),
            resolved_role_code=tis_client.context.role_code,
        )
        if not persist:
            return attach_persistence_summary(result, None)

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
    except Exception as ex:
        logger.exception("TIS 个人成绩探测失败", ex)
        raise
    finally:
        tis_client.close()


__all__ = ["fetch_personal_grades_with_credentials"]

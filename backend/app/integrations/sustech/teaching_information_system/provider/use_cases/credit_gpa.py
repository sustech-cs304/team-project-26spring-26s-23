"""TIS 学分绩 provider use case。"""

from __future__ import annotations

from urllib.parse import urljoin

from app.integrations.sustech.teaching_information_system.api.client import TISClient
from app.integrations.sustech.teaching_information_system.api.constants import (
    _DEFAULT_TIS_CREDIT_GPA_API_PATH,
    _DEFAULT_TIS_CREDIT_GPA_PAGE_PATH,
    _DEFAULT_TIS_ENTRY_PATH,
)
from app.integrations.sustech.teaching_information_system.api.credit_gpa import (
    extract_credit_gpa_summary_from_json,
    extract_credit_gpa_term_records_from_json,
    extract_credit_gpa_year_records_from_json,
)
from app.integrations.sustech.teaching_information_system.api.dto import (
    DEFAULT_TIS_SERVICE_CONFIG,
    TISCreditGPAQueryResult,
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
from app.integrations.sustech.teaching_information_system.data import TISDatabaseManager
from app.integrations.sustech.teaching_information_system.provider.results import (
    TISPersistenceSummary,
    attach_persistence_summary,
    resource_group_result,
)
from app.integrations.sustech.teaching_information_system.shared import (
    _clean_text,
    create_tis_log_session,
)


def fetch_credit_gpa_with_credentials(
    username: str,
    password: str,
    *,
    role_code: str | None = None,
    homepage_html: str | None = None,
    config: TISServiceConfig | None = None,
    enable_console_logging: bool = False,
    persist: bool = False,
    db_manager: TISDatabaseManager | None = None,
    owner_key: str | None = None,
) -> TISCreditGPAQueryResult:
    normalized_username = _clean_text(username)
    normalized_password = str(password or "").strip()
    if not normalized_username or not normalized_password:
        raise ValueError("缺少 TIS/CAS 用户名或密码")

    service_config = config or DEFAULT_TIS_SERVICE_CONFIG
    log_session = create_tis_log_session(console=enable_console_logging)
    logger = log_session.make_logger(
        layer="provider",
        source="teaching_information_system.fetch_credit_gpa",
        context={
            "base_url": service_config.base_url,
            "role_code": _clean_text(role_code) or None,
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
                    else "default-student-grade-role",
                },
            )

        page_url = urljoin(service_config.base_url, _DEFAULT_TIS_CREDIT_GPA_PAGE_PATH)
        api_url = urljoin(service_config.base_url, _DEFAULT_TIS_CREDIT_GPA_API_PATH)

        logger.info("▶ 访问 TIS 学分绩查询页面", payload={"page_url": page_url})
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
            raise RuntimeError("TIS 学分绩查询页面返回了未认证内容")

        logger.info("▶ 请求 TIS 学分绩查询数据接口", payload={"api_url": api_url})
        api_response = tis_client.probe(
            api_url,
            method="POST",
            headers={
                "Accept": "*/*",
                "Origin": service_config.base_url,
                "Referer": page_url,
            },
        )
        api_response.raise_for_status()
        if not _is_authenticated_tis_response(
            api_response, base_url=service_config.base_url
        ):
            raise RuntimeError("TIS 学分绩查询接口返回了未认证内容")

        payload = _safe_parse_json_response(api_response)
        if not isinstance(payload, dict):
            raise RuntimeError("TIS 学分绩查询接口返回的响应不是有效 JSON")

        summary = extract_credit_gpa_summary_from_json(payload)
        term_records = extract_credit_gpa_term_records_from_json(payload)
        year_records = extract_credit_gpa_year_records_from_json(payload)
        if (
            summary.average_credit_gpa is None
            and not summary.rank
            and not term_records
            and not year_records
        ):
            raise RuntimeError("TIS 学分绩查询接口未返回可识别的学分绩数据")

        probes = [
            _build_tis_probe_result(page_response, probe_label="credit-gpa-page"),
            _build_tis_probe_result(
                api_response,
                probe_label="credit-gpa-api",
                request_payload=None,
                record_count=len(term_records),
            ),
        ]
        logger.info(
            "✅ TIS 学分绩查询完成",
            payload={
                "page_url": page_url,
                "api_url": api_url,
                "average_credit_gpa": summary.average_credit_gpa,
                "rank": summary.rank,
                "term_record_count": len(term_records),
                "year_record_count": len(year_records),
                "resolved_role_code": tis_client.context.role_code,
            },
        )
        result = TISCreditGPAQueryResult(
            success=True,
            source_url=api_url,
            page_url=page_url,
            api_url=api_url,
            homepage=homepage,
            summary=summary,
            term_records=term_records,
            year_records=year_records,
            probes=probes,
            logs=log_session.snapshot(),
            resolved_role_code=tis_client.context.role_code,
        )
        if not persist:
            return attach_persistence_summary(result, None)

        resolved_owner_key = _clean_text(owner_key) or normalized_username
        resolved_db_manager = db_manager or TISDatabaseManager()
        stats = resolved_db_manager.sync_credit_gpa(
            resolved_owner_key, summary, term_records, year_records
        )
        persistence_summary = TISPersistenceSummary(
            enabled=True,
            owner_key=resolved_owner_key,
            db_path=resolved_db_manager.describe().db_path,
            resources={"credit_gpa": resource_group_result("credit_gpa", stats)},
            metadata={
                "term_record_count": len(term_records),
                "year_record_count": len(year_records),
            },
        )
        logger.info("✅ TIS 学分绩持久化完成", payload=persistence_summary.to_dict())
        return attach_persistence_summary(result, persistence_summary)
    except Exception as ex:
        logger.exception("TIS 学分绩查询失败", ex)
        raise
    finally:
        tis_client.close()


__all__ = ["fetch_credit_gpa_with_credentials"]

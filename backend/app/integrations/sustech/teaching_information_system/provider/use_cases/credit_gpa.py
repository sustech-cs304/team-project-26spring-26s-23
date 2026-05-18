"""TIS 学分绩 provider use case。"""

from __future__ import annotations

from urllib.parse import urljoin
from typing import Any

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
    TISCreditGPASummary,
    TISCreditGPATermRecord,
    TISCreditGPAYearRecord,
    TISHomepageProfile,
    TISProbeResult,
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


def _prepare_credit_gpa_inputs(
    username: str,
    password: str,
    config: TISServiceConfig | None,
) -> tuple[str, str, TISServiceConfig]:
    normalized_username = _clean_text(username)
    normalized_password = str(password or "").strip()
    if not normalized_username or not normalized_password:
        raise ValueError("缺少 TIS/CAS 用户名或密码")
    return (
        normalized_username,
        normalized_password,
        config or DEFAULT_TIS_SERVICE_CONFIG,
    )


def _resolve_credit_gpa_homepage_html(
    tis_client: TISClient,
    logger: Any,
    homepage_html: str | None,
) -> str:
    if homepage_html is not None:
        logger.info("ℹ 使用外部提供的 TIS 首页 HTML")
        return homepage_html

    logger.info("▶ 抓取 TIS 首页 HTML")
    return tis_client.fetch_homepage()


def _resolve_credit_gpa_homepage(
    tis_client: TISClient,
    logger: Any,
    homepage_html: str,
    service_config: TISServiceConfig,
) -> TISHomepageProfile:
    homepage = analyze_homepage_html(
        homepage_html,
        page_url=service_config.homepage_url,
        base_url=service_config.base_url,
    )
    if tis_client.context.role_code is not None:
        return homepage

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
    return homepage


def _probe_credit_gpa_page(
    tis_client: TISClient,
    logger: Any,
    service_config: TISServiceConfig,
    page_url: str,
) -> Any:
    logger.info("▶ 访问 TIS 学分绩查询页面", payload={"page_url": page_url})
    page_response = tis_client.probe(
        page_url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Referer": urljoin(service_config.base_url, _DEFAULT_TIS_ENTRY_PATH),
        },
    )
    page_response.raise_for_status()
    if _is_authenticated_tis_response(page_response, base_url=service_config.base_url):
        return page_response
    raise RuntimeError("TIS 学分绩查询页面返回了未认证内容")


def _probe_credit_gpa_api(
    tis_client: TISClient,
    logger: Any,
    service_config: TISServiceConfig,
    page_url: str,
    api_url: str,
) -> Any:
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
    if _is_authenticated_tis_response(api_response, base_url=service_config.base_url):
        return api_response
    raise RuntimeError("TIS 学分绩查询接口返回了未认证内容")


def _extract_credit_gpa_payload(
    api_response: Any,
) -> tuple[
    TISCreditGPASummary, list[TISCreditGPATermRecord], list[TISCreditGPAYearRecord]
]:
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
    return summary, term_records, year_records


def _build_credit_gpa_result(
    *,
    log_session,
    tis_client: TISClient,
    homepage,
    summary,
    term_records,
    year_records,
    page_response,
    api_response,
    page_url: str,
    api_url: str,
    logger: Any,
) -> TISCreditGPAQueryResult:
    probes: list[TISProbeResult] = [
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
    return TISCreditGPAQueryResult(
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


def _persist_credit_gpa_result(
    *,
    result: TISCreditGPAQueryResult,
    db_manager: TISDatabaseManager | None,
    owner_key: str | None,
    normalized_username: str,
    summary: TISCreditGPASummary,
    term_records: list[TISCreditGPATermRecord],
    year_records: list[TISCreditGPAYearRecord],
    logger: Any,
) -> TISCreditGPAQueryResult:
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
    normalized_username, normalized_password, service_config = (
        _prepare_credit_gpa_inputs(username, password, config)
    )
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

        resolved_homepage_html = _resolve_credit_gpa_homepage_html(
            tis_client, logger, homepage_html
        )
        homepage = _resolve_credit_gpa_homepage(
            tis_client, logger, resolved_homepage_html, service_config
        )

        page_url = urljoin(service_config.base_url, _DEFAULT_TIS_CREDIT_GPA_PAGE_PATH)
        api_url = urljoin(service_config.base_url, _DEFAULT_TIS_CREDIT_GPA_API_PATH)

        page_response = _probe_credit_gpa_page(
            tis_client, logger, service_config, page_url
        )
        api_response = _probe_credit_gpa_api(
            tis_client, logger, service_config, page_url, api_url
        )
        summary, term_records, year_records = _extract_credit_gpa_payload(api_response)
        result = _build_credit_gpa_result(
            log_session=log_session,
            tis_client=tis_client,
            homepage=homepage,
            summary=summary,
            term_records=term_records,
            year_records=year_records,
            page_response=page_response,
            api_response=api_response,
            page_url=page_url,
            api_url=api_url,
            logger=logger,
        )
        if not persist:
            return attach_persistence_summary(result, None)

        return _persist_credit_gpa_result(
            result=result,
            db_manager=db_manager,
            owner_key=owner_key,
            normalized_username=normalized_username,
            summary=summary,
            term_records=term_records,
            year_records=year_records,
            logger=logger,
        )
    except Exception as ex:
        logger.exception("TIS 学分绩查询失败", ex)
        raise
    finally:
        tis_client.close()


__all__ = ["fetch_credit_gpa_with_credentials"]

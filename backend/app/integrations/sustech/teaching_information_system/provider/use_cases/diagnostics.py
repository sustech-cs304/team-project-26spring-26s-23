"""TIS 链路诊断 provider use case。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from dotenv import dotenv_values

from app.integrations.sustech.teaching_information_system.api.client import TISClient
from app.integrations.sustech.teaching_information_system.api.dto import (
    DEFAULT_TIS_SERVICE_CONFIG,
    TISHomepageProfile,
    TISProbeResult,
    TISServiceConfig,
)
from app.integrations.sustech.teaching_information_system.api.grades import (
    build_grade_candidate_urls,
    probe_grade_candidates,
)
from app.integrations.sustech.teaching_information_system.api.homepage import (
    analyze_homepage_html,
)
from app.integrations.sustech.teaching_information_system.shared import (
    TISLogSession,
    TISLogger,
    _clean_text,
    create_tis_log_session,
)


def _normalize_role_code(role_code: str | None) -> str | None:
    return _clean_text(role_code) or None


def _build_diagnostic_summary(role_code: str | None) -> dict[str, Any]:
    normalized_role_code = _normalize_role_code(role_code)
    return {
        "login_success": False,
        "homepage_fetch_success": False,
        "homepage_analysis_success": False,
        "grade_candidate_probe_success": False,
        "resolved_role_code": normalized_role_code,
        "failure_stage": None,
        "error": None,
        "homepage": None,
        "candidate_url_count": 0,
        "candidate_urls": [],
        "probe_count": 0,
        "probes": [],
        "request_history": [],
        "cookie_names": [],
    }


def _build_diagnostic_logger(
    log_session: TISLogSession,
    config: TISServiceConfig,
    role_code: str | None,
) -> TISLogger:
    return log_session.make_logger(
        layer="debug",
        source="teaching_information_system.link_diagnostic",
        context={
            "base_url": config.base_url,
            "input_role_code": _normalize_role_code(role_code),
        },
    )


def _serialize_diagnostic_result(
    summary: dict[str, Any],
    log_session: TISLogSession,
) -> dict[str, Any]:
    return {**summary, "logs": log_session.to_dicts()}


def _record_login_success(
    summary: dict[str, Any],
    tis_client: TISClient,
    logger: TISLogger,
) -> None:
    summary["login_success"] = True
    summary["cookie_names"] = sorted(tis_client.get_cookies().keys())
    logger.info(
        "✅ 已确认 TIS 登录成功", payload={"cookie_names": summary["cookie_names"]}
    )


def _fetch_homepage_profile(
    tis_client: TISClient,
    service_config: TISServiceConfig,
    summary: dict[str, Any],
) -> TISHomepageProfile:
    homepage_response = tis_client.context.get(
        service_config.homepage_url,
        label="TIS-Homepage-Diagnostic",
    )
    summary["homepage_status_code"] = int(homepage_response.status_code)
    summary["homepage_url"] = str(homepage_response.url)
    homepage_response.raise_for_status()
    summary["homepage_fetch_success"] = True

    homepage = analyze_homepage_html(
        homepage_response.text,
        page_url=str(homepage_response.url),
        base_url=service_config.base_url,
    )
    if tis_client.context.role_code is None:
        tis_client.context.set_role_code(
            homepage.role_codes[0] if homepage.role_codes else "01"
        )
    return homepage


def _limit_candidate_urls(candidate_urls: list[str], max_probe_count: int) -> list[str]:
    probe_limit = max(int(max_probe_count), 0)
    return candidate_urls[:probe_limit]


def _record_homepage_summary(
    summary: dict[str, Any],
    homepage: TISHomepageProfile,
    service_config: TISServiceConfig,
    tis_client: TISClient,
    logger: TISLogger,
    max_probe_count: int,
) -> None:
    candidate_urls = build_grade_candidate_urls(
        homepage, base_url=service_config.base_url
    )
    summary.update(
        homepage_analysis_success=True,
        homepage=homepage.to_dict(),
        resolved_role_code=tis_client.context.role_code,
        candidate_url_count=len(candidate_urls),
        candidate_urls=_limit_candidate_urls(candidate_urls, max_probe_count),
    )
    logger.info(
        "✅ 已完成 TIS 首页分析",
        payload={
            "iframe_count": len(homepage.iframe_urls),
            "grade_endpoint_count": len(homepage.grade_related_endpoints),
            "role_codes": homepage.role_codes,
            "candidate_url_count": len(candidate_urls),
        },
    )


def _probe_to_dict(probe: TISProbeResult) -> dict[str, Any]:
    return {
        "url": probe.url,
        "method": probe.method,
        "status_code": probe.status_code,
        "content_type": probe.content_type,
        "record_count": probe.record_count,
        "preview": probe.preview,
    }


def _resolve_probe_failure_stage(probes: list[TISProbeResult]) -> str | None:
    if not probes:
        return "grade_probe"
    if not any(probe.record_count > 0 for probe in probes):
        return "grade_parse_or_candidate_path"
    return None


def _record_probe_summary(
    summary: dict[str, Any], probes: list[TISProbeResult]
) -> None:
    summary["probe_count"] = len(probes)
    summary["probes"] = [_probe_to_dict(probe) for probe in probes]
    summary["grade_candidate_probe_success"] = bool(probes)
    summary["failure_stage"] = _resolve_probe_failure_stage(probes)


def _record_request_history(summary: dict[str, Any], tis_client: TISClient) -> None:
    summary["request_history"] = [
        {"label": label, "method": method, "status_code": status_code, "url": url}
        for label, method, status_code, url in tis_client.context.request_history
    ]


def _resolve_env_path(env_path: str | None) -> Path:
    if env_path:
        return Path(env_path)
    return Path(__file__).resolve().parents[4] / ".env"


def _load_env_credentials(
    resolved_env_path: Path,
    role_code: str | None,
) -> tuple[str | None, str, str | None]:
    env_values = dotenv_values(resolved_env_path)
    username = _clean_text(env_values.get("SUSTECH_USERNAME"))
    password = str(env_values.get("SUSTECH_PASSWORD") or "").strip()
    derived_role_code = _normalize_role_code(
        role_code or env_values.get("TIS_ROLE_CODE") or env_values.get("ROLE_CODE")
    )
    return username, password, derived_role_code


def _build_env_summary(
    username: str | None,
    password: str,
    derived_role_code: str | None,
) -> dict[str, bool]:
    return {
        "username_present": bool(username),
        "password_present": bool(password),
        "role_code_present": bool(derived_role_code),
    }


def run_tis_link_diagnostic(
    username: str,
    password: str,
    *,
    role_code: str | None = None,
    config: TISServiceConfig | None = None,
    enable_console_logging: bool = False,
    max_probe_count: int = 12,
) -> dict[str, Any]:
    service_config = config or DEFAULT_TIS_SERVICE_CONFIG
    log_session = create_tis_log_session(
        console=enable_console_logging, min_level="debug"
    )
    logger = _build_diagnostic_logger(log_session, service_config, role_code)
    summary = _build_diagnostic_summary(role_code)

    tis_client = TISClient(
        config=service_config,
        logger=logger.child("teaching_information_system.client"),
    )
    try:
        logger.info("▶ 开始 TIS 最小链路诊断")
        if not tis_client.login(username, password, role_code=role_code):
            summary["failure_stage"] = "login"
            logger.warning("⚠ TIS 登录未建立有效会话")
            return _serialize_diagnostic_result(summary, log_session)

        _record_login_success(summary, tis_client, logger)
        homepage = _fetch_homepage_profile(tis_client, service_config, summary)
        _record_homepage_summary(
            summary,
            homepage,
            service_config,
            tis_client,
            logger,
            max_probe_count,
        )
        probes = probe_grade_candidates(
            tis_client,
            homepage,
            logger=logger.child("teaching_information_system.probe"),
            max_probe_count=max_probe_count,
        )
        _record_probe_summary(summary, probes)
    except Exception as ex:
        summary["failure_stage"] = summary["failure_stage"] or "exception"
        summary["error"] = f"{type(ex).__name__}: {ex}"
        logger.exception(
            "TIS 链路诊断失败",
            ex,
            payload={"failure_stage": summary["failure_stage"]},
        )
    finally:
        _record_request_history(summary, tis_client)
        tis_client.close()

    return _serialize_diagnostic_result(summary, log_session)


def run_tis_link_diagnostic_from_env(
    *,
    env_path: str | None = None,
    role_code: str | None = None,
    config: TISServiceConfig | None = None,
    enable_console_logging: bool = False,
    max_probe_count: int = 12,
) -> dict[str, Any]:
    resolved_env_path = _resolve_env_path(env_path)
    username, password, derived_role_code = _load_env_credentials(
        resolved_env_path,
        role_code,
    )
    if not username or not password:
        raise RuntimeError(f"缺少 TIS/CAS 登录凭据：{resolved_env_path}")

    summary = run_tis_link_diagnostic(
        username,
        password,
        role_code=derived_role_code,
        config=config,
        enable_console_logging=enable_console_logging,
        max_probe_count=max_probe_count,
    )
    summary["env_path"] = str(resolved_env_path)
    summary["env_summary"] = _build_env_summary(username, password, derived_role_code)
    return summary


__all__ = ["run_tis_link_diagnostic", "run_tis_link_diagnostic_from_env"]

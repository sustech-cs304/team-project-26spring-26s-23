"""TIS 链路诊断 provider use case。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from dotenv import dotenv_values

from app.teaching_information_system.api.client import TISClient
from app.teaching_information_system.api.dto import DEFAULT_TIS_SERVICE_CONFIG, TISServiceConfig
from app.teaching_information_system.api.grades import build_grade_candidate_urls, probe_grade_candidates
from app.teaching_information_system.api.homepage import analyze_homepage_html
from app.teaching_information_system.shared import _clean_text, create_tis_log_session


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
    log_session = create_tis_log_session(console=enable_console_logging, min_level="debug")
    logger = log_session.make_logger(
        layer="debug",
        source="teaching_information_system.link_diagnostic",
        context={"base_url": service_config.base_url, "input_role_code": _clean_text(role_code) or None},
    )
    summary: dict[str, Any] = {
        "login_success": False,
        "homepage_fetch_success": False,
        "homepage_analysis_success": False,
        "grade_candidate_probe_success": False,
        "resolved_role_code": _clean_text(role_code) or None,
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

    tis_client = TISClient(config=service_config, logger=logger.child("teaching_information_system.client"))
    try:
        logger.info("▶ 开始 TIS 最小链路诊断")
        if not tis_client.login(username, password, role_code=role_code):
            summary["failure_stage"] = "login"
            logger.warning("⚠ TIS 登录未建立有效会话")
            return {**summary, "logs": log_session.to_dicts()}

        summary["login_success"] = True
        summary["cookie_names"] = sorted(tis_client.get_cookies().keys())
        logger.info("✅ 已确认 TIS 登录成功", payload={"cookie_names": summary["cookie_names"]})

        homepage_response = tis_client.context.get(service_config.homepage_url, label="TIS-Homepage-Diagnostic")
        summary["homepage_status_code"] = int(homepage_response.status_code)
        summary["homepage_url"] = str(homepage_response.url)
        homepage_response.raise_for_status()
        summary["homepage_fetch_success"] = True

        homepage = analyze_homepage_html(homepage_response.text, page_url=str(homepage_response.url), base_url=service_config.base_url)
        if tis_client.context.role_code is None:
            tis_client.context.set_role_code(homepage.role_codes[0] if homepage.role_codes else "01")
        summary["homepage_analysis_success"] = True
        summary["homepage"] = homepage.to_dict()
        summary["resolved_role_code"] = tis_client.context.role_code

        candidate_urls = build_grade_candidate_urls(homepage, base_url=service_config.base_url)
        summary["candidate_url_count"] = len(candidate_urls)
        summary["candidate_urls"] = candidate_urls[: max(int(max_probe_count), 0) or 0]
        logger.info(
            "✅ 已完成 TIS 首页分析",
            payload={
                "iframe_count": len(homepage.iframe_urls),
                "grade_endpoint_count": len(homepage.grade_related_endpoints),
                "role_codes": homepage.role_codes,
                "candidate_url_count": len(candidate_urls),
            },
        )

        probes = probe_grade_candidates(
            tis_client,
            homepage,
            logger=logger.child("teaching_information_system.probe"),
            max_probe_count=max_probe_count,
        )
        summary["probe_count"] = len(probes)
        summary["probes"] = [
            {
                "url": probe.url,
                "method": probe.method,
                "status_code": probe.status_code,
                "content_type": probe.content_type,
                "record_count": probe.record_count,
                "preview": probe.preview,
            }
            for probe in probes
        ]
        summary["grade_candidate_probe_success"] = bool(probes)
        if not probes:
            summary["failure_stage"] = "grade_probe"
        elif not any(probe.record_count > 0 for probe in probes):
            summary["failure_stage"] = "grade_parse_or_candidate_path"
    except Exception as ex:
        summary["failure_stage"] = summary["failure_stage"] or "exception"
        summary["error"] = f"{type(ex).__name__}: {ex}"
        logger.exception("TIS 链路诊断失败", ex, payload={"failure_stage": summary["failure_stage"]})
    finally:
        summary["request_history"] = [
            {"label": label, "method": method, "status_code": status_code, "url": url}
            for label, method, status_code, url in tis_client.context.request_history
        ]
        tis_client.close()

    return {**summary, "logs": log_session.to_dicts()}


def run_tis_link_diagnostic_from_env(
    *,
    env_path: str | None = None,
    role_code: str | None = None,
    config: TISServiceConfig | None = None,
    enable_console_logging: bool = False,
    max_probe_count: int = 12,
) -> dict[str, Any]:
    resolved_env_path = Path(env_path) if env_path else Path(__file__).resolve().parents[4] / ".env"
    env_values = dotenv_values(resolved_env_path)
    username = _clean_text(env_values.get("SUSTECH_USERNAME"))
    password = str(env_values.get("SUSTECH_PASSWORD") or "").strip()
    derived_role_code = _clean_text(role_code or env_values.get("TIS_ROLE_CODE") or env_values.get("ROLE_CODE")) or None
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
    summary["env_summary"] = {
        "username_present": bool(username),
        "password_present": bool(password),
        "role_code_present": bool(derived_role_code),
    }
    return summary


__all__ = ["run_tis_link_diagnostic", "run_tis_link_diagnostic_from_env"]

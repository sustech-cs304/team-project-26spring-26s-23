"""TIS 登录与会话客户端。"""

from __future__ import annotations

from typing import Any, cast
from urllib.parse import urljoin

import httpx

from app.core.auth.cas_client import CASClient

from ..shared import TISLogger, _clean_text
from .constants import (
    _DEFAULT_TIS_ENTRY_PATH,
    _DEFAULT_TIS_HOME_PATH,
    _DEFAULT_TIS_QUERYXSXX_PATH,
    _DEFAULT_TIS_SYSTEM_PROPERTY_PATH,
    _DEFAULT_TIS_USER_ME_PATH,
    _DEFAULT_TIS_USER_MK_PATH,
    _DEFAULT_TIS_USER_MODULES_PATH,
)
from .context import TISAPIContext
from .dto import DEFAULT_TIS_SERVICE_CONFIG, TISServiceConfig
from .fetch_helpers import (
    _extract_pylx_from_payload,
    _extract_response_auth_markers,
    _extract_role_code_from_user_payload,
    _is_authenticated_tis_response,
    _response_chain_urls,
    _safe_parse_json_response,
    _summarize_cookie_names,
)


class TISClient:
    """复用 CAS 登录建立 TIS 会话，并提供后续探测请求。"""

    def __init__(self, *, config: TISServiceConfig | None = None, logger: TISLogger | None = None) -> None:
        self.config = config or DEFAULT_TIS_SERVICE_CONFIG
        self.logger = logger
        self.cas_client = CASClient(logger=None)
        self.pylx: str | None = None
        self.context = TISAPIContext(
            self.cas_client.client,
            base_url=self.config.base_url,
            logger=None if logger is None else logger.child("tis.client.http"),
        )

    @property
    def client(self) -> httpx.Client:
        return self.cas_client.client

    def login(self, username: str, password: str, *, role_code: str | None = None) -> bool:
        normalized_username = _clean_text(username)
        normalized_password = str(password or "").strip()
        if not normalized_username or not normalized_password:
            raise ValueError("缺少 TIS/CAS 用户名或密码")
        if self.logger is not None:
            self.logger.info(
                "▶ 开始执行 CAS -> TIS 登录",
                payload={"entry_url": self.config.entry_url, "requested_role_code": _clean_text(role_code) or None},
            )
        ok = self.cas_client.login(normalized_username, normalized_password, self.config.entry_url)
        cookie_summary = _summarize_cookie_names(self.get_cookies())
        if self.logger is not None:
            self.logger.info("ℹ TIS 登录后 Cookie 概览", payload={"entry_url": self.config.entry_url, **cookie_summary})
        if not ok:
            if self.logger is not None:
                self.logger.error("❌ TIS 会话建立失败", payload={"entry_url": self.config.entry_url, **cookie_summary})
            return False

        self.context.set_role_code(role_code)
        warmup_summary = self._warmup_authenticated_context()
        self.pylx = _clean_text(warmup_summary.get("derived_pylx")) or None
        verify_response = cast(httpx.Response, warmup_summary["verify_response"])
        verify_markers = _extract_response_auth_markers(verify_response, base_url=self.config.base_url)
        verify_chain = _response_chain_urls(verify_response)
        authenticated = bool(warmup_summary["authenticated"])
        if self.logger is not None:
            verify_payload = {
                "entry_url": self.config.entry_url,
                "role_code": self.context.role_code,
                "pylx": self.pylx,
                "verify_url": str(verify_response.url),
                "verify_status_code": int(verify_response.status_code),
                "verify_redirect_chain": verify_chain,
                "warmup_step_count": len(cast(list[dict[str, Any]], warmup_summary["steps"])),
                "available_grade_menu_count": warmup_summary.get("available_grade_menu_count"),
                **verify_markers,
                **cookie_summary,
            }
            if authenticated:
                self.logger.info("✅ TIS 会话已建立", payload=verify_payload)
            else:
                self.logger.error("❌ TIS 会话认证校验失败", payload=verify_payload)
        return authenticated

    def _warmup_authenticated_context(self) -> dict[str, Any]:
        dashboard_url = urljoin(self.config.base_url, _DEFAULT_TIS_HOME_PATH)
        auth_main_url = urljoin(self.config.base_url, _DEFAULT_TIS_ENTRY_PATH)
        steps: list[dict[str, Any]] = []

        def _capture_step(label: str, response: httpx.Response) -> tuple[httpx.Response, Any | None]:
            payload = _safe_parse_json_response(response)
            markers = _extract_response_auth_markers(response, base_url=self.config.base_url)
            redirect_chain = _response_chain_urls(response)
            payload_keys = sorted(str(key) for key in payload.keys())[:20] if isinstance(payload, dict) else []
            steps.append({"label": label, "status_code": int(response.status_code), "url": str(response.url), "redirect_chain": redirect_chain})
            if self.logger is not None:
                self.logger.info(
                    "ℹ TIS 登录后预热步骤完成",
                    payload={
                        "label": label,
                        "requested_url": str(response.request.url),
                        "final_url": str(response.url),
                        "status_code": int(response.status_code),
                        "redirect_chain": redirect_chain,
                        "payload_keys": payload_keys,
                        **markers,
                    },
                )
            return response, payload

        auth_main_response, _ = _capture_step(
            "authentication-main",
            self.context.get(
                auth_main_url,
                headers={
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Referer": self.config.entry_url,
                },
                label="TIS-Auth-Main",
            ),
        )
        student_index_response, _ = _capture_step(
            "student-index",
            self.context.get(
                dashboard_url,
                headers={
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Referer": auth_main_url,
                },
                label="TIS-Student-Index",
            ),
        )
        _capture_step(
            "user-mk",
            self.context.post(urljoin(self.config.base_url, _DEFAULT_TIS_USER_MK_PATH), headers={"Accept": "*/*", "Referer": auth_main_url}, label="TIS-User-MK"),
        )
        _capture_step(
            "system-property",
            self.context.post(urljoin(self.config.base_url, _DEFAULT_TIS_SYSTEM_PROPERTY_PATH), headers={"Accept": "*/*", "Referer": dashboard_url}, label="TIS-System-Property"),
        )
        user_me_response, user_me_payload = _capture_step(
            "user-me",
            self.context.post(urljoin(self.config.base_url, _DEFAULT_TIS_USER_ME_PATH), headers={"Accept": "*/*", "Referer": dashboard_url}, label="TIS-User-Me"),
        )
        derived_role_code = _extract_role_code_from_user_payload(user_me_payload)
        derived_pylx = _extract_pylx_from_payload(user_me_payload)
        if derived_role_code and not self.context.role_code:
            self.context.set_role_code(derived_role_code)
            if self.logger is not None:
                self.logger.info("ℹ 已从用户上下文补全 TIS RoleCode", payload={"resolved_role_code": self.context.role_code, "source": "user.me"})
        queryxsxx_response, queryxsxx_payload = _capture_step(
            "queryxsxx",
            self.context.post(urljoin(self.config.base_url, _DEFAULT_TIS_QUERYXSXX_PATH), headers={"Accept": "*/*", "Referer": dashboard_url}, label="TIS-QueryXsxx"),
        )
        if derived_pylx is None:
            derived_pylx = _extract_pylx_from_payload(queryxsxx_payload)
        get_mknode_response, get_mknode_payload = _capture_step(
            "getMknodeMore",
            self.context.post(
                urljoin(self.config.base_url, _DEFAULT_TIS_USER_MODULES_PATH),
                data={"mkdm[]": ["002", "102", "007"]},
                headers={
                    "Accept": "*/*",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "Referer": dashboard_url,
                },
                label="TIS-GetMknodeMore",
            ),
        )
        grade_modules = get_mknode_payload.get("002") if isinstance(get_mknode_payload, dict) else None
        available_grade_menu_count = len(grade_modules) if isinstance(grade_modules, list) else None
        authenticated = all(
            _is_authenticated_tis_response(response, base_url=self.config.base_url)
            for response in (auth_main_response, student_index_response, user_me_response, queryxsxx_response, get_mknode_response)
        ) and all(
            int(response.status_code) < 400
            for response in (auth_main_response, student_index_response, user_me_response, queryxsxx_response, get_mknode_response)
        )
        return {
            "authenticated": authenticated,
            "derived_role_code": derived_role_code,
            "derived_pylx": derived_pylx,
            "verify_response": student_index_response,
            "steps": steps,
            "available_grade_menu_count": available_grade_menu_count,
        }

    def fetch_homepage(self) -> str:
        response = self.context.get(
            self.config.homepage_url,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Referer": urljoin(self.config.base_url, _DEFAULT_TIS_ENTRY_PATH),
            },
            label="TIS-Homepage",
        )
        response.raise_for_status()
        return response.text

    def probe(
        self,
        url: str,
        *,
        method: str = "GET",
        params: dict[str, Any] | None = None,
        json_data: Any | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        normalized_method = str(method or "GET").upper()
        if normalized_method == "POST":
            response = self.context.post(url, data=params, json_data=json_data, headers=headers, label=f"TIS-Probe-{normalized_method}")
        else:
            response = self.context.get(url, params=params, headers=headers, label=f"TIS-Probe-{normalized_method}")
        return response

    def get_cookies(self) -> dict[str, str]:
        return self.cas_client.get_cookies()

    def close(self) -> None:
        self.cas_client.close()


__all__ = ["TISClient"]

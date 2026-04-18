from __future__ import annotations

from app.integrations.sustech.blackboard.api.course_catalog import BlackboardCourseCatalogAPI
from app.integrations.sustech.blackboard.provider.results import CourseCatalogSearchResult
from app.integrations.sustech.blackboard.shared import create_log_session
from app.shared_integrations.sustech_auth.cas_client import CASClient

BLACKBOARD_LOGIN_SERVICE_URL = "https://bb.sustech.edu.cn/webapps/login/"
_ALLOWED_FETCH_MODES = {"quick", "full"}
_DEFAULT_FETCH_MODE = "full"
_DEFAULT_MAX_PAGES = 30


def _normalize_fetch_mode(fetch_mode: str | None) -> str:
    normalized = str(fetch_mode or "").strip().lower() or _DEFAULT_FETCH_MODE
    if normalized not in _ALLOWED_FETCH_MODES:
        raise ValueError("fetch_mode must be one of: full, quick")
    return normalized


def _normalize_max_pages(max_pages: int | None) -> int:
    if max_pages is None:
        return _DEFAULT_MAX_PAGES
    if isinstance(max_pages, bool):
        raise ValueError("max_pages must be a positive integer")
    normalized = int(max_pages)
    if normalized <= 0:
        raise ValueError("max_pages must be a positive integer")
    return normalized


def search_course_catalog_with_credentials(
    username: str,
    password: str,
    *,
    keyword: str,
    field: str = "CourseName",
    operator: str = "Contains",
    limit: int | None = None,
    fetch_mode: str = _DEFAULT_FETCH_MODE,
    max_pages: int | None = _DEFAULT_MAX_PAGES,
    enable_console_logging: bool = False,
) -> CourseCatalogSearchResult:
    normalized_username = str(username or "").strip()
    normalized_password = str(password or "").strip()
    normalized_keyword = str(keyword or "").strip()
    normalized_field = str(field or "").strip() or "CourseName"
    normalized_operator = str(operator or "").strip() or "Contains"
    normalized_limit = limit if limit and limit > 0 else None
    normalized_fetch_mode = _normalize_fetch_mode(fetch_mode)
    normalized_max_pages = _normalize_max_pages(max_pages)
    log_session = create_log_session(console=enable_console_logging)
    logger = log_session.make_logger(
        layer="provider",
        source="provider.use_cases.course_catalog",
        context={
            "keyword": normalized_keyword,
            "field": normalized_field,
            "operator": normalized_operator,
            "limit": normalized_limit,
            "fetch_mode": normalized_fetch_mode,
            "max_pages": normalized_max_pages,
        },
    )

    if not normalized_username or not normalized_password:
        raise ValueError("缺少 CAS 用户名或密码")
    if not normalized_keyword:
        raise ValueError("keyword 不能为空")

    cas_client = CASClient(logger=logger.child("provider.use_cases.course_catalog.cas"))
    try:
        logger.info("▶ 开始执行课程目录搜索")
        if not cas_client.login(normalized_username, normalized_password, BLACKBOARD_LOGIN_SERVICE_URL):
            logger.error("❌  CAS 登录失败")
            raise RuntimeError("CAS 登录失败")

        logger.info("✅ CAS 登录成功，开始调用课程目录 API")
        api = BlackboardCourseCatalogAPI(cas_client.client)
        typed_results = api.search_course_catalog(
            normalized_keyword,
            field=normalized_field,
            operator=normalized_operator,
            limit=normalized_limit,
            fetch_mode=normalized_fetch_mode,
            max_pages=normalized_max_pages,
        )
        logger.info(
            "✅ 课程目录搜索完成",
            payload={
                "result_count": len(typed_results),
                "fetch_mode": normalized_fetch_mode,
                "max_pages": normalized_max_pages,
            },
        )
        return CourseCatalogSearchResult(
            keyword=normalized_keyword,
            field=normalized_field,
            operator=normalized_operator,
            limit=normalized_limit,
            fetch_mode=normalized_fetch_mode,
            max_pages=normalized_max_pages,
            results=typed_results,
            logs=log_session.snapshot(),
        )
    except Exception as ex:
        logger.exception("课程目录搜索异常", ex)
        raise
    finally:
        logger.debug("ℹ 关闭 CASClient")
        cas_client.close()

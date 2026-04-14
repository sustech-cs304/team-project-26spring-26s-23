from __future__ import annotations

from app.blackboard.api.course_catalog import BlackboardCourseCatalogAPI
from app.blackboard.provider.results import CourseCatalogSearchResult
from app.blackboard.shared import create_log_session
from app.shared_integrations.sustech_auth.cas_client import CASClient

BLACKBOARD_LOGIN_SERVICE_URL = "https://bb.sustech.edu.cn/webapps/login/"


def search_course_catalog_with_credentials(
    username: str,
    password: str,
    *,
    keyword: str,
    field: str = "CourseName",
    operator: str = "Contains",
    limit: int | None = None,
    enable_console_logging: bool = False,
) -> CourseCatalogSearchResult:
    normalized_username = str(username or "").strip()
    normalized_password = str(password or "").strip()
    normalized_keyword = str(keyword or "").strip()
    normalized_field = str(field or "").strip() or "CourseName"
    normalized_operator = str(operator or "").strip() or "Contains"
    normalized_limit = limit if limit and limit > 0 else None
    log_session = create_log_session(console=enable_console_logging)
    logger = log_session.make_logger(
        layer="provider",
        source="provider.use_cases.course_catalog",
        context={
            "keyword": normalized_keyword,
            "field": normalized_field,
            "operator": normalized_operator,
            "limit": normalized_limit,
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
        )
        logger.info(
            "✅ 课程目录搜索完成",
            payload={"result_count": len(typed_results)},
        )
        return CourseCatalogSearchResult(
            keyword=normalized_keyword,
            field=normalized_field,
            operator=normalized_operator,
            limit=normalized_limit,
            results=typed_results,
            logs=log_session.snapshot(),
        )
    except Exception as ex:
        logger.exception("课程目录搜索异常", ex)
        raise
    finally:
        logger.debug("ℹ 关闭 CASClient")
        cas_client.close()

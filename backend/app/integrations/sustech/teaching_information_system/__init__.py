"""TIS 根包稳定导出面。

仅保留当前仍有真实消费者依赖的稳定入口；更细粒度的 API、facade 工具类、
shared helper 与兼容细节应从对应子包显式导入，而不是通过根包聚合暴露。
"""

from app.integrations.sustech.teaching_information_system.api import (
    DEFAULT_TIS_SERVICE_CONFIG,
    TISCreditGPAQueryResult,
    TISGradeQueryResult,
    TISSelectedCoursesQueryResult,
    TISServiceConfig,
)
from app.integrations.sustech.teaching_information_system.facade import (
    get_tis_tool_contracts,
)
from app.integrations.sustech.teaching_information_system.provider import (
    fetch_credit_gpa_with_credentials,
    fetch_personal_grades_with_credentials,
    fetch_selected_courses_with_credentials,
    run_tis_link_diagnostic,
)

__all__ = [
    "DEFAULT_TIS_SERVICE_CONFIG",
    "TISCreditGPAQueryResult",
    "TISGradeQueryResult",
    "TISSelectedCoursesQueryResult",
    "TISServiceConfig",
    "fetch_credit_gpa_with_credentials",
    "fetch_personal_grades_with_credentials",
    "fetch_selected_courses_with_credentials",
    "get_tis_tool_contracts",
    "run_tis_link_diagnostic",
]

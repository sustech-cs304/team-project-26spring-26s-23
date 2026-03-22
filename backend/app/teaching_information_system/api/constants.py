"""TIS API 常量定义。"""

from __future__ import annotations

_DEFAULT_TIS_BASE_URL = "https://tis.sustech.edu.cn"
_DEFAULT_TIS_CAS_ENTRY_PATH = "/cas"
_DEFAULT_TIS_ENTRY_PATH = "/authentication/main"
_DEFAULT_TIS_HOME_PATH = "/student_index"
_DEFAULT_TIS_USER_ME_PATH = "/user/me"
_DEFAULT_TIS_USER_MK_PATH = "/user/mk"
_DEFAULT_TIS_SYSTEM_PROPERTY_PATH = "/system/property"
_DEFAULT_TIS_QUERYXSXX_PATH = "/UserManager/queryxsxx"
_DEFAULT_TIS_USER_MODULES_PATH = "/user/getMknodeMore"
_DEFAULT_TIS_PERSONAL_GRADES_PAGE_PATH = "/cjgl/grcjcx/go/1"
_DEFAULT_TIS_PERSONAL_GRADES_API_PATH = "/cjgl/grcjcx/grcjcx"
_DEFAULT_TIS_CREDIT_GPA_PAGE_PATH = "/cjgl/xscjgl/xsgrcjcx/xspjxfjcx"
_DEFAULT_TIS_CREDIT_GPA_API_PATH = "/cjgl/xscjgl/xsgrcjcx/queryXnAndXqXfj"
_DEFAULT_TIS_SELECTED_COURSES_PAGE_PATH = "/Xsxk/query/1"
_DEFAULT_TIS_SELECTED_COURSES_API_PATH = "/Xsxk/queryYxkc"
_DEFAULT_TIS_SELECTED_COURSES_CURRENT_TERM_PATH = "/Xsxk/queryXkdqXnxq"

_JSON_CONTAINER_KEYS: tuple[str, ...] = (
    "data",
    "datas",
    "rows",
    "items",
    "list",
    "result",
    "results",
    "content",
    "obj",
)
_COURSE_NAME_KEYS: tuple[str, ...] = (
    "courseName",
    "course_name",
    "course",
    "name",
    "kcmc",
    "课程名称",
    "课程",
)
_COURSE_CODE_KEYS: tuple[str, ...] = (
    "courseCode",
    "course_code",
    "code",
    "kch",
    "kcdm",
    "课程代码",
)
_TERM_KEYS: tuple[str, ...] = (
    "term",
    "termName",
    "semester",
    "xn",
    "xq",
    "xnxq",
    "xnxqmc",
    "学期",
    "学年学期",
)
_SCORE_KEYS: tuple[str, ...] = (
    "score",
    "grade",
    "gradeScore",
    "finalScore",
    "cj",
    "zzcj",
    "zzzscj",
    "xscj",
    "xszscj",
    "zpcj",
    "zpzscj",
    "成绩",
    "总评成绩",
    "最终成绩",
)
_CREDIT_KEYS: tuple[str, ...] = ("credit", "credits", "xf", "学分")
_GRADE_MENU_KEYWORDS: tuple[str, ...] = ("成绩", "grade", "score", "绩点", "考试")
_SCHEDULE_KEYWORDS: tuple[str, ...] = ("课表", "schedule", "timetable", "kb")
_DEFAULT_GRADE_PATH_CANDIDATES: tuple[str, ...] = (
    _DEFAULT_TIS_PERSONAL_GRADES_PAGE_PATH,
    "/student/studentinfo/achievementinfo.do",
    "/student/studentinfo/achievementinfo/index",
    "/student/studentinfo/achievementinfo",
    "/student/achievementinfo",
    "/for-std/grade/sheet",
    "/for-std/grade/sheet/info",
    "/queryScore",
    "/score/query",
)

__all__ = [
    "_COURSE_CODE_KEYS",
    "_COURSE_NAME_KEYS",
    "_CREDIT_KEYS",
    "_DEFAULT_GRADE_PATH_CANDIDATES",
    "_DEFAULT_TIS_BASE_URL",
    "_DEFAULT_TIS_CAS_ENTRY_PATH",
    "_DEFAULT_TIS_CREDIT_GPA_API_PATH",
    "_DEFAULT_TIS_CREDIT_GPA_PAGE_PATH",
    "_DEFAULT_TIS_ENTRY_PATH",
    "_DEFAULT_TIS_HOME_PATH",
    "_DEFAULT_TIS_PERSONAL_GRADES_API_PATH",
    "_DEFAULT_TIS_PERSONAL_GRADES_PAGE_PATH",
    "_DEFAULT_TIS_QUERYXSXX_PATH",
    "_DEFAULT_TIS_SELECTED_COURSES_API_PATH",
    "_DEFAULT_TIS_SELECTED_COURSES_CURRENT_TERM_PATH",
    "_DEFAULT_TIS_SELECTED_COURSES_PAGE_PATH",
    "_DEFAULT_TIS_SYSTEM_PROPERTY_PATH",
    "_DEFAULT_TIS_USER_ME_PATH",
    "_DEFAULT_TIS_USER_MK_PATH",
    "_DEFAULT_TIS_USER_MODULES_PATH",
    "_GRADE_MENU_KEYWORDS",
    "_JSON_CONTAINER_KEYS",
    "_SCHEDULE_KEYWORDS",
    "_SCORE_KEYS",
    "_TERM_KEYS",
]

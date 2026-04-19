"""Blackboard 剩余抓取链路复用的轻量解析/过滤辅助。"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Any

from app.integrations.sustech.blackboard.shared.logging import BlackboardLogger
from urllib.parse import urlparse

from app.integrations.sustech.blackboard.shared import (
    clean_text,
    extract_date_text,
    parse_loose_datetime_or_min,
)


def clean_field(text: str, max_length: int = 600) -> str:
    """清理抓取文本中的空白/控制字符并截断。"""
    return clean_text(text, max_length=max_length)


def looks_like_course_name(text: str) -> bool:
    """判断文本是否像课程名，过滤日期/导航/正文碎片。"""
    candidate = clean_field(text, max_length=180)
    if not candidate or len(candidate) < 2:
        return False

    lower = candidate.lower()
    noise_tokens = (
        "发布时间",
        "发布于",
        "posted on",
        "top frame tabs",
        "顶框标签",
        "课程菜单",
        "menu",
        "http://",
        "https://",
    )
    if any(token in lower for token in noise_tokens):
        return False

    if re.search(r"\b(?:mon|tue|wed|thu|fri|sat|sun)\b", lower):
        return False

    if re.fullmatch(r"(?:20\d{2}[\-./年]\s*\d{1,2}[\-./月]\s*\d{1,2}.*)", candidate):
        return False

    return True


def extract_status_text(text: str) -> str:
    """从文本中提取作业/成绩状态。"""
    if not text:
        return ""

    status_patterns = [
        r"(已提交|未提交|已批改|待批改|逾期|缺交|草稿)",
        r"(submitted|not submitted|graded|needs grading|late|missing|in progress|draft)",
    ]
    for pattern in status_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()

    return ""


def extract_grade_text(text: str) -> str:
    """从文本中提取成绩值。"""
    if not text:
        return ""

    match = re.search(r"(\d+(?:\.\d+)?\s*/\s*\d+(?:\.\d+)?)", text)
    if match:
        return match.group(1)

    match = re.search(r"(\d+(?:\.\d+)?\s*%)", text)
    if match:
        return match.group(1)

    match = re.search(
        r"\b(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F)\b", text, re.IGNORECASE
    )
    if match:
        return match.group(1).upper()

    match = re.search(
        r"(?:得分|成绩|score|grade)\s*[:：]?\s*(\d+(?:\.\d+)?)", text, re.IGNORECASE
    )
    if match:
        return match.group(1)

    return ""


def parse_datetime_safe(value: str) -> datetime:
    """尽力将日期字符串解析为 datetime；失败时返回 `datetime.min`。"""
    return parse_loose_datetime_or_min(value)


def is_navigation_noise(text: str) -> bool:
    """判断文本是否属于导航/布局噪声。"""
    lower = (text or "").lower()
    noise_tokens = (
        "menu management options",
        "course menu",
        "top frame tabs",
        "current location",
        "open global navigation",
        "assist is in your blackboard menu",
        "内容页面的操作",
        "课程菜单",
        "打开快速链接",
        "快速链接",
        "注销",
        "my groups",
    )
    return any(token in lower for token in noise_tokens)


def normalize_assignment_title(raw: str) -> str:
    """规范化作业标题。"""
    text = re.sub(r"\s+", " ", raw or "").strip()
    if not text:
        return ""

    text = re.sub(r"\bDue\s*:\s*.*$", "", text, flags=re.IGNORECASE).strip()
    return text


def _log_filtered_assignment(
    logger: BlackboardLogger | None,
    reason: str,
    *,
    payload: dict[str, Any] | None = None,
) -> None:
    if logger is not None:
        logger.debug(
            "🗑 过滤作业噪音",
            payload={"reason": reason, **(payload or {})},
        )



def _assignment_noise_reason(title: str, url: str) -> str | None:
    lower_title = title.lower()
    if any(token in title for token in ("失败", "错误")) or "error" in lower_title:
        return "error_message"
    if re.fullmatch(r"https?://\S+", title, flags=re.IGNORECASE):
        return "title_is_url"
    if any(token in title for token in ("活动标签", "课程(", "课程（")):
        return "navigation_title"
    if url.lower().startswith("javascript:"):
        return "javascript_url"
    if any(
        token in lower_title
        for token in ("course menu", "menu management options", "top frame tabs")
    ):
        return "navigation_text"
    return None



def _assignment_has_signal(
    *,
    title: str,
    url: str,
    due_date: str,
    status: str,
    summary: str,
) -> bool:
    if due_date or extract_grade_text(f"{status} {summary}"):
        return True

    lower_title = title.lower()
    assignment_title_tokens = (
        "assignment",
        "homework",
        "quiz",
        "project",
        "lab",
        "exam",
        "作业",
        "实验",
        "测验",
        "考试",
    )
    if any(token in lower_title for token in assignment_title_tokens):
        return True

    lower_url = url.lower()
    return any(
        token in lower_url
        for token in ("/webapps/assignment/", "/bb-assignment-", "/bb-mygrades-")
    )



def is_valid_assignment(
    assignment: dict[str, Any],
    *,
    logger: BlackboardLogger | None = None,
) -> bool:
    """判断是否为有效作业（非噪音数据）。"""
    title = str(assignment.get("title") or "").strip()
    if not title:
        _log_filtered_assignment(logger, "empty_title")
        return False

    url = str(assignment.get("url") or "").strip()
    noise_reason = _assignment_noise_reason(title, url)
    if noise_reason is not None:
        _log_filtered_assignment(logger, noise_reason, payload={"title": title, "url": url})
        return False

    if _assignment_has_signal(
        title=title,
        url=url,
        due_date=str(assignment.get("due_date") or "").strip(),
        status=str(assignment.get("status") or "").strip(),
        summary=str(assignment.get("summary") or "").strip(),
    ):
        return True

    _log_filtered_assignment(logger, "missing_signal", payload={"title": title, "url": url})
    return False


def is_valid_resource(
    resource: dict[str, Any],
    *,
    logger: BlackboardLogger | None = None,
) -> bool:
    """判断是否为有效资源（非噪音数据）。"""
    name = str(resource.get("name") or "").strip()
    download_url = str(resource.get("download_url") or "").strip()

    def _log_filtered(reason: str, *, payload: dict[str, Any] | None = None) -> None:
        if logger is not None:
            logger.debug(
                "🗑 过滤资源噪音",
                payload={"reason": reason, **(payload or {})},
            )

    if not download_url:
        _log_filtered("empty_download_url")
        return False

    lower_name = name.lower()
    lower_url = download_url.lower()

    if lower_url.startswith("javascript:"):
        _log_filtered("javascript_url", payload={"download_url": download_url})
        return False

    help_url_tokens = (
        "/webapps/blackboard/content/getting-started/",
        "/webapps/blackboard/content/course-content-and-materials/",
        "/webapps/blackboard/content/assessments/",
        "/webapps/blackboard/content/plagiarism/",
        "/webapps/blackboard/content/original-course-view/",
        "/webapps/blackboard/content/ultra/",
    )
    if any(token in lower_url for token in help_url_tokens):
        _log_filtered("help_link", payload={"download_url": download_url})
        return False

    help_title_tokens = (
        "your profile",
        "insert local file in the content editor",
        "about files and folders",
        "folder types",
        "browse files",
        "add files",
        "file and folder permissions",
        "create and edit folders",
        "files and folders",
        "content editor",
        "safeassign supported file types",
        "upload and download packages",
        "manage files",
        "folder properties",
        "folder notifications",
    )
    if any(token in lower_name for token in help_title_tokens):
        _log_filtered("help_title", payload={"name": name})
        return False

    if "/webapps/blackboard/content/" in lower_url and not any(
        token in lower_url
        for token in (
            "/bbcswebdav/",
            "/webapps/assignment/",
            "download",
            "xid=",
            "attachment",
        )
    ):
        _log_filtered("course_help_page", payload={"download_url": download_url})
        return False

    if "/webapps/blackboard/content/" in lower_url and any(
        token in lower_name
        for token in (
            "your profile",
            "browse files",
            "files and folders",
            "content editor",
            "safeassign",
            "manage files",
            "folder ",
        )
    ):
        _log_filtered(
            "blackboard_help_doc", payload={"name": name, "download_url": download_url}
        )
        return False

    return True


def extract_course_name_and_listed_grade(raw_text: str) -> tuple[str, str]:
    """从“我的成绩”左侧课程项文本中提取课程名与列表成绩。"""
    text = re.sub(r"\s+", " ", raw_text or "").strip()
    if not text:
        return "", ""

    match = re.match(r"^(.*?)\s*\(([^()]*)\)\s*$", text)
    if match:
        return match.group(1).strip(), match.group(2).strip()

    return text, ""


def stable_resource_id(course_id: str, name: str, url: str) -> str:
    """为资源生成稳定 resource_id。"""
    normalized = "|".join(
        part.strip() for part in (course_id, url, name) if part and part.strip()
    )
    digest = hashlib.sha1(
        (normalized or "<empty>").encode("utf-8"), usedforsecurity=False
    ).hexdigest()[:20]
    return f"res_{digest}"


def is_course_content_page_url(url: str, course_id: str, *, base_url: str) -> bool:
    """判断 URL 是否为当前课程的内容页面。"""
    parsed = urlparse(url)
    if parsed.netloc and parsed.netloc != urlparse(base_url).netloc:
        return False

    lower_path = parsed.path.lower()
    if course_id not in url:
        return False

    return any(
        token in lower_path
        for token in (
            "/webapps/blackboard/content/",
            "/webapps/blackboard/execute/launcher",
        )
    )


def is_sidebar_seed_candidate(
    title: str, url: str, course_id: str, *, base_url: str
) -> bool:
    """判断侧边栏链接是否应作为内容抓取 seed。"""
    parsed = urlparse(url)
    if parsed.netloc and parsed.netloc != urlparse(base_url).netloc:
        return False

    lower_url = url.lower()
    lower_title = clean_field(title, max_length=160).lower()

    if course_id and course_id not in url and f"id={course_id}" not in lower_url:
        return False

    noise_tokens = (
        "javascript:",
        "logout",
        "tool",
        "calendar",
        "messages",
        "discussionboard",
        "groups",
        "contacts",
        "sendemail",
        "help",
    )
    if any(token in lower_url for token in noise_tokens):
        return False

    signal_tokens = (
        "listcontent.jsp",
        "/webapps/blackboard/content/",
        "content_id=",
        "/bbcswebdav/",
        "assignment",
        "resource",
        "material",
        "module",
        "lecture",
        "week",
        "folder",
        "课程内容",
        "资源",
        "讲义",
        "课件",
        "作业",
        "实验",
        "项目",
    )
    joined = f"{lower_title} {lower_url}"
    return any(token in joined for token in signal_tokens)


def extract_date_text_safe(text: str) -> str:
    """与旧 facade 兼容的日期提取包装。"""
    return extract_date_text(text)

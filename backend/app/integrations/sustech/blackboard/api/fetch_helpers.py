"""Blackboard API 层抓取辅助函数。"""

from __future__ import annotations

import html
import re


_CONTENTS_PATTERN = re.compile(
    r"<contents\b[^>]*>(?P<body>.*?)</contents>",
    re.IGNORECASE | re.DOTALL,
)
_CDATA_PATTERN = re.compile(r"^<!\[CDATA\[(?P<body>.*)\]\]>$", re.DOTALL)


def extract_xml_contents(raw: str) -> str | None:
    """若响应为 XML，提取 ``<contents>`` 中的 HTML 片段。"""
    stripped = str(raw or "").lstrip()
    if not stripped.startswith("<?xml") and "<contents" not in stripped:
        return None

    match = _CONTENTS_PATTERN.search(raw)
    if match is None:
        return None

    contents_body = match.group("body")
    cdata_match = _CDATA_PATTERN.match(contents_body)
    if cdata_match is not None:
        return cdata_match.group("body")

    return html.unescape(contents_body)

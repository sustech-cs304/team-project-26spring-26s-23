"""Blackboard API 层抓取辅助函数。"""

from __future__ import annotations

import xml.etree.ElementTree as ET


def extract_xml_contents(raw: str) -> str | None:
    """若响应为 XML，提取 ``<contents>`` 中的 HTML 片段。"""
    stripped = str(raw or "").lstrip()
    if not stripped.startswith("<?xml") and "<contents" not in stripped:
        return None

    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return None

    if root.tag == "contents":
        return root.text or ""

    contents = root.find(".//contents")
    if contents is not None:
        return contents.text or ""

    return None

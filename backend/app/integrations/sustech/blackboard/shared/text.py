"""Blackboard 领域共享文本清洗与轻量字段解析工具。"""

from __future__ import annotations

import re
from typing import Any

_ZERO_WIDTH_PATTERN = re.compile(r"[\u200b\u200c\u200d\ufeff]")
_WHITESPACE_PATTERN = re.compile(r"\s+")


def clean_text(value: Any, *, max_length: int = 0) -> str:
    """清理空白、零宽字符与非断行空格。"""
    if value is None:
        return ""

    cleaned = str(value).replace("\xa0", " ")
    cleaned = _ZERO_WIDTH_PATTERN.sub("", cleaned)
    cleaned = _WHITESPACE_PATTERN.sub(" ", cleaned).strip()

    if max_length > 0 and len(cleaned) > max_length:
        cleaned = cleaned[:max_length].rstrip()
    return cleaned


def clean_optional_text(value: Any, *, max_length: int = 0) -> str | None:
    """返回清洗后的可空文本。"""
    cleaned = clean_text(value, max_length=max_length)
    return cleaned or None


def split_score_text(score: Any) -> tuple[str | None, str | None]:
    """将 `12 / 20` 形式分数拆分为得分与总分。"""
    text = clean_text(score)
    if not text:
        return None, None

    match = re.match(r"^\s*([^/]+?)\s*/\s*([^/]+?)\s*$", text)
    if match:
        return match.group(1).strip() or None, match.group(2).strip() or None
    return text, None


def extract_total_score(score: Any) -> str | None:
    """从成绩字段中提取总分部分。"""
    _, total = split_score_text(score)
    return total


def parse_score_metrics(score: Any) -> tuple[float | None, float | None, float | None]:
    """解析数值成绩、百分比与分数比。"""
    text = clean_text(score)
    if not text:
        return None, None, None

    ratio = re.search(r"(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", text)
    if ratio:
        numerator = float(ratio.group(1))
        denominator = float(ratio.group(2))
        percentage = (numerator / denominator * 100.0) if denominator > 0 else None
        return numerator, denominator, percentage

    percent = re.search(r"(\d+(?:\.\d+)?)\s*%", text)
    if percent:
        percentage = float(percent.group(1))
        return percentage, 100.0, percentage

    pure_number = re.fullmatch(r"\d+(?:\.\d+)?", text)
    if pure_number:
        value = float(text)
        return value, None, None

    return None, None, None

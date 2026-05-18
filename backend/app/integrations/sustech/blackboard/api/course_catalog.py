"""Blackboard 课程目录搜索 API。"""

from __future__ import annotations

import re
from typing import Callable
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from bs4.element import Tag

from app.integrations.sustech.blackboard.api.dto import CourseCatalogResultDTO
from app.integrations.sustech.blackboard.shared import (
    DEFAULT_BLACKBOARD_BASE_URL,
    clean_text,
    extract_course_id_from_url,
)

ResponseLogger = Callable[[str, httpx.Response], None]

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


def find_course_catalog_show_all_url(html: str, page_url: str) -> str | None:
    """从课程目录页面识别“全部显示”链接。"""
    soup = BeautifulSoup(html, "html.parser")
    for link in soup.select("a[href]"):
        href = str(link.get("href") or "").strip()
        if not href:
            continue
        if "showall=true" in href.lower():
            return urljoin(page_url, href)
    return None


def find_course_catalog_next_page_url(html: str, page_url: str) -> str | None:
    """从课程目录页面识别下一页链接。"""
    soup = BeautifulSoup(html, "html.parser")
    parsed_current = urlparse(page_url)
    current_start_raw = parse_qs(parsed_current.query).get("startIndex", ["0"])[0]
    current_start = int(current_start_raw) if str(current_start_raw).isdigit() else 0

    def _pick_by_start_index(candidates: list[str]) -> str | None:
        picked: tuple[int, str] | None = None
        for candidate in candidates:
            parsed = urlparse(candidate)
            query = parse_qs(parsed.query)
            start_raw = query.get("startIndex", [""])[0]
            if not str(start_raw).isdigit():
                continue
            start_val = int(start_raw)
            if start_val <= current_start:
                continue
            if picked is None or start_val < picked[0]:
                picked = (start_val, candidate)
        return picked[1] if picked else None

    next_like_urls: list[str] = []
    start_index_urls: list[str] = []

    for link in soup.select("a[href]"):
        href = str(link.get("href") or "").strip()
        if not href:
            continue

        full_url = urljoin(page_url, href)
        link_text = clean_text(link.get_text(" ", strip=True), max_length=80).lower()
        rel_values = [
            str(v).strip().lower() for v in (link.get("rel") or []) if str(v).strip()
        ]
        classes = " ".join(str(c) for c in (link.get("class") or [])).lower()

        if "startindex=" in full_url.lower():
            start_index_urls.append(full_url)

        if (
            "next" in link_text
            or "下一页" in link_text
            or link_text in (">", "»")
            or "next" in rel_values
            or "next" in classes
        ):
            next_like_urls.append(full_url)

    picked = _pick_by_start_index(next_like_urls)
    if picked:
        return picked

    picked = _pick_by_start_index(start_index_urls)
    if picked:
        return picked

    for candidate in next_like_urls:
        if urljoin(page_url, candidate) != page_url:
            return candidate

    return None


_COURSE_CATALOG_HEADER_TOKENS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("course_identifier", ("identifier", "course id", "课程id")),
    ("course_name", ("name", "课程名称")),
    ("instructor", ("instructor", "教师", "任课")),
    ("description", ("description", "描述", "简介")),
)


def _resolve_catalog_column_key(header: str) -> str | None:
    for key, tokens in _COURSE_CATALOG_HEADER_TOKENS:
        if any(token in header for token in tokens):
            return key
    return None


def _build_course_catalog_column_map(headers: list[str]) -> dict[str, int]:
    column_map: dict[str, int] = {}
    for idx, header in enumerate(headers):
        key = _resolve_catalog_column_key(header)
        if key is not None:
            column_map[key] = idx
    return column_map


def _course_catalog_rows(table: Tag) -> list[Tag]:
    rows = table.select("tbody tr")
    if rows:
        return rows
    return [row for row in table.select("tr") if row.find_all("td")]


def _course_catalog_cell_text(cell: Tag | None) -> str:
    if not isinstance(cell, Tag):
        return ""

    value_node = cell.select_one(".table-data-cell-value")
    if isinstance(value_node, Tag):
        return clean_text(value_node.get_text(" ", strip=True), max_length=1000)

    raw = clean_text(cell.get_text(" ", strip=True), max_length=1000)
    label_node = cell.select_one(".table-data-cell-label")
    if not isinstance(label_node, Tag):
        return raw

    label = clean_text(label_node.get_text(" ", strip=True), max_length=80)
    if not label:
        return raw

    pattern = rf"^{re.escape(label)}\s*[:：]?\s*"
    return re.sub(pattern, "", raw, count=1, flags=re.IGNORECASE)


def _course_catalog_row_cells(row: Tag) -> list[Tag]:
    direct_cells = [
        cell
        for cell in row.find_all(["th", "td"], recursive=False)
        if isinstance(cell, Tag)
    ]
    if direct_cells:
        return direct_cells
    return [cell for cell in row.find_all(["th", "td"]) if isinstance(cell, Tag)]


def _course_catalog_pick_cell(
    cells: list[Tag],
    index: int,
    fallback: int,
) -> Tag | None:
    actual_index = index if 0 <= index < len(cells) else fallback
    if 0 <= actual_index < len(cells):
        return cells[actual_index]
    return None


def _course_catalog_default_indices(cells: list[Tag]) -> dict[str, int]:
    return {
        "course_identifier": 0,
        "course_name": 1 if len(cells) > 1 else 0,
        "instructor": 2 if len(cells) > 2 else 0,
        "description": 3 if len(cells) > 3 else len(cells) - 1,
    }


def _extract_course_catalog_row_id(row: Tag) -> str | None:
    for link in row.select("a"):
        for attr in ("href", "onclick"):
            value = str(link.get(attr) or "").strip()
            if not value:
                continue
            extracted = extract_course_id_from_url(value)
            if extracted:
                return extracted
    return None


def _course_catalog_identifier_text(cell: Tag | None) -> str:
    if isinstance(cell, Tag) and cell.name == "th":
        th_link = cell.select_one("a")
        if isinstance(th_link, Tag):
            value = clean_text(th_link.get_text(" ", strip=True), max_length=500)
            if value:
                return value
    return _course_catalog_cell_text(cell)


def _parse_course_catalog_row(
    row: Tag,
    column_map: dict[str, int],
) -> CourseCatalogResultDTO | None:
    cells = _course_catalog_row_cells(row)
    if not cells:
        return None

    default_indices = _course_catalog_default_indices(cells)
    identifier_cell = _course_catalog_pick_cell(
        cells,
        column_map.get("course_identifier", default_indices["course_identifier"]),
        default_indices["course_identifier"],
    )
    name_cell = _course_catalog_pick_cell(
        cells,
        column_map.get("course_name", default_indices["course_name"]),
        default_indices["course_name"],
    )
    instructor_cell = _course_catalog_pick_cell(
        cells,
        column_map.get("instructor", default_indices["instructor"]),
        default_indices["instructor"],
    )
    description_cell = _course_catalog_pick_cell(
        cells,
        column_map.get("description", default_indices["description"]),
        default_indices["description"],
    )

    course_identifier = _course_catalog_identifier_text(identifier_cell)
    course_name = _course_catalog_cell_text(name_cell)
    instructor = _course_catalog_cell_text(instructor_cell)
    description = _course_catalog_cell_text(description_cell)
    course_id = _extract_course_catalog_row_id(row)

    return CourseCatalogResultDTO(
        course_id=course_id,
        course_identifier=course_identifier or None,
        course_name=course_name,
        instructor=instructor or None,
        description=description or None,
    )


def parse_course_catalog_table(html: str) -> list[CourseCatalogResultDTO]:
    """解析课程目录结果表格。"""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("#listContainer_datatable")
    if not isinstance(table, Tag):
        return []

    headers = [
        clean_text(cell.get_text(" ", strip=True), max_length=80).lower()
        for cell in table.select("thead th")
    ]
    column_map = _build_course_catalog_column_map(headers)
    results: list[CourseCatalogResultDTO] = []
    seen_keys: set[tuple[str, str, str]] = set()

    for row in _course_catalog_rows(table):
        item = _parse_course_catalog_row(row, column_map)
        if item is None:
            continue

        dedupe_key = (
            str(item.course_identifier or ""),
            str(item.course_name or ""),
            str(item.course_id or ""),
        )
        if dedupe_key in seen_keys:
            continue

        seen_keys.add(dedupe_key)
        results.append(item)

    return results


class BlackboardCourseCatalogAPI:
    """课程目录搜索 facade。"""

    def __init__(
        self,
        client: httpx.Client,
        *,
        base_url: str = DEFAULT_BLACKBOARD_BASE_URL,
        response_logger: ResponseLogger | None = None,
    ) -> None:
        self.client = client
        self.base_url = base_url
        self.response_logger = response_logger

    def search_course_catalog(
        self,
        keyword: str,
        *,
        field: str = "CourseName",
        operator: str = "Contains",
        limit: int | None = None,
        fetch_mode: str = _DEFAULT_FETCH_MODE,
        max_pages: int | None = _DEFAULT_MAX_PAGES,
    ) -> list[CourseCatalogResultDTO]:
        """搜索 Blackboard 课程目录。"""
        cleaned_keyword = clean_text(keyword, max_length=120)
        if not cleaned_keyword:
            return []

        normalized_fetch_mode = _normalize_fetch_mode(fetch_mode)
        resolved_max_pages = _normalize_max_pages(max_pages)
        catalog_url = f"{self.base_url}/webapps/blackboard/execute/viewCatalog"
        params = {
            "type": "Course",
            "searchField": clean_text(field, max_length=40) or "CourseName",
            "searchOperator": clean_text(operator, max_length=40) or "Contains",
            "searchText": cleaned_keyword,
            "command": "NewSearch",
        }

        try:
            response = self.client.get(catalog_url, params=params)
            if self.response_logger is not None:
                self.response_logger("Course-Catalog-Search", response)
            response.raise_for_status()
        except Exception:
            return []

        results: list[CourseCatalogResultDTO] = []
        seen_keys: set[tuple[str, str, str]] = set()

        def _merge_rows(rows: list[CourseCatalogResultDTO]) -> None:
            for item in rows:
                key = (
                    str(item.course_identifier or "").strip(),
                    str(item.course_name or "").strip(),
                    str(item.course_id or "").strip(),
                )
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                results.append(item)

        def _collect_from_page(start_html: str, start_url: str, source: str) -> None:
            html = start_html
            page_url = start_url
            visited_urls: set[str] = {page_url}
            page_count = 0

            while True:
                page_count += 1
                page_rows = parse_course_catalog_table(html)
                _merge_rows(page_rows)

                if page_count >= resolved_max_pages:
                    break

                next_page_url = find_course_catalog_next_page_url(html, page_url)
                if not next_page_url or next_page_url in visited_urls:
                    break

                visited_urls.add(next_page_url)
                try:
                    next_response = self.client.get(next_page_url)
                    if self.response_logger is not None:
                        self.response_logger(
                            f"Course-Catalog-Page-{source}-{page_count + 1}",
                            next_response,
                        )
                    next_response.raise_for_status()
                except Exception:
                    break

                html = next_response.text
                page_url = str(next_response.url)

        if normalized_fetch_mode == "quick":
            _merge_rows(parse_course_catalog_table(response.text))
        else:
            _collect_from_page(response.text, str(response.url), "search")

            show_all_url = find_course_catalog_show_all_url(
                response.text, str(response.url)
            )
            if show_all_url:
                try:
                    show_all_response = self.client.get(show_all_url)
                    if self.response_logger is not None:
                        self.response_logger(
                            "Course-Catalog-Show-All", show_all_response
                        )
                    show_all_response.raise_for_status()
                    _collect_from_page(
                        show_all_response.text, str(show_all_response.url), "show-all"
                    )
                except Exception:
                    return (
                        results[:limit] if limit is not None and limit > 0 else results
                    )

        if limit is not None and limit > 0:
            return results[:limit]
        return results

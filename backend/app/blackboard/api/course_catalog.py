"""Blackboard 课程目录搜索 API。"""

from __future__ import annotations

import re
from typing import Callable
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from bs4.element import Tag

from app.blackboard.api.dto import CourseCatalogResultDTO
from app.blackboard.shared import DEFAULT_BLACKBOARD_BASE_URL, clean_text, extract_course_id_from_url

ResponseLogger = Callable[[str, httpx.Response], None]


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
        rel_values = [str(v).strip().lower() for v in (link.get("rel") or []) if str(v).strip()]
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


def parse_course_catalog_table(html: str) -> list[CourseCatalogResultDTO]:
    """解析课程目录结果表格。"""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("#listContainer_datatable")
    if not isinstance(table, Tag):
        return []

    header_cells = table.select("thead th")
    headers = [clean_text(cell.get_text(" ", strip=True), max_length=80).lower() for cell in header_cells]
    column_map: dict[str, int] = {}

    for idx, header in enumerate(headers):
        if "identifier" in header or "course id" in header or "课程id" in header:
            column_map["course_identifier"] = idx
        elif "name" in header or "课程名称" in header:
            column_map["course_name"] = idx
        elif "instructor" in header or "教师" in header or "任课" in header:
            column_map["instructor"] = idx
        elif "description" in header or "描述" in header or "简介" in header:
            column_map["description"] = idx

    rows = table.select("tbody tr")
    if not rows:
        rows = [row for row in table.select("tr") if row.find_all("td")]

    results: list[CourseCatalogResultDTO] = []
    seen_keys: set[tuple[str, str, str]] = set()

    def _cell_text(cell: Tag | None) -> str:
        if not isinstance(cell, Tag):
            return ""

        value_node = cell.select_one(".table-data-cell-value")
        if isinstance(value_node, Tag):
            return clean_text(value_node.get_text(" ", strip=True), max_length=1000)

        raw = clean_text(cell.get_text(" ", strip=True), max_length=1000)
        label_node = cell.select_one(".table-data-cell-label")
        if isinstance(label_node, Tag):
            label = clean_text(label_node.get_text(" ", strip=True), max_length=80)
            if label:
                pattern = rf"^{re.escape(label)}\s*[:：]?\s*"
                raw = re.sub(pattern, "", raw, count=1, flags=re.IGNORECASE)
        return raw

    def _get_cell(cells: list[Tag], index: int, fallback: int) -> Tag | None:
        actual_index = index if 0 <= index < len(cells) else fallback
        return cells[actual_index] if 0 <= actual_index < len(cells) else None

    def _extract_row_course_id(row: Tag) -> str | None:
        for link in row.select("a"):
            for attr in ("href", "onclick"):
                value = str(link.get(attr) or "").strip()
                if not value:
                    continue
                extracted = extract_course_id_from_url(value)
                if extracted:
                    return extracted
        return None

    for row in rows:
        cells = [cell for cell in row.find_all(["th", "td"], recursive=False) if isinstance(cell, Tag)]
        if not cells:
            cells = [cell for cell in row.find_all(["th", "td"]) if isinstance(cell, Tag)]
        if not cells:
            continue

        identifier_idx = column_map.get("course_identifier", 0)
        course_name_idx = column_map.get("course_name", 1 if len(cells) > 1 else 0)
        instructor_idx = column_map.get("instructor", 2 if len(cells) > 2 else 0)
        description_idx = column_map.get("description", 3 if len(cells) > 3 else len(cells) - 1)

        identifier_cell = _get_cell(cells, identifier_idx, 0)
        name_cell = _get_cell(cells, course_name_idx, 1 if len(cells) > 1 else 0)
        instructor_cell = _get_cell(cells, instructor_idx, 2 if len(cells) > 2 else 0)
        description_cell = _get_cell(cells, description_idx, len(cells) - 1)

        course_identifier = ""
        if isinstance(identifier_cell, Tag) and identifier_cell.name == "th":
            th_link = identifier_cell.select_one("a")
            if isinstance(th_link, Tag):
                course_identifier = clean_text(th_link.get_text(" ", strip=True), max_length=500)
            if not course_identifier:
                course_identifier = _cell_text(identifier_cell)
        else:
            course_identifier = _cell_text(identifier_cell)

        course_name = _cell_text(name_cell)
        instructor = _cell_text(instructor_cell)
        description = _cell_text(description_cell)
        course_id = _extract_row_course_id(row)

        dedupe_key = (course_identifier, course_name, course_id or "")
        if dedupe_key in seen_keys:
            continue

        seen_keys.add(dedupe_key)
        results.append(
            CourseCatalogResultDTO(
                course_id=course_id,
                course_identifier=course_identifier or None,
                course_name=course_name,
                instructor=instructor or None,
                description=description or None,
            )
        )

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
    ) -> list[CourseCatalogResultDTO]:
        """搜索 Blackboard 课程目录。"""
        cleaned_keyword = clean_text(keyword, max_length=120)
        if not cleaned_keyword:
            return []

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

        max_pages = 30
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

                if page_count >= max_pages:
                    break

                next_page_url = find_course_catalog_next_page_url(html, page_url)
                if not next_page_url or next_page_url in visited_urls:
                    break

                visited_urls.add(next_page_url)
                try:
                    next_response = self.client.get(next_page_url)
                    if self.response_logger is not None:
                        self.response_logger(f"Course-Catalog-Page-{source}-{page_count + 1}", next_response)
                    next_response.raise_for_status()
                except Exception:
                    break

                html = next_response.text
                page_url = str(next_response.url)

        _collect_from_page(response.text, str(response.url), "search")

        show_all_url = find_course_catalog_show_all_url(response.text, str(response.url))
        if show_all_url:
            try:
                show_all_response = self.client.get(show_all_url)
                if self.response_logger is not None:
                    self.response_logger("Course-Catalog-Show-All", show_all_response)
                show_all_response.raise_for_status()
                _collect_from_page(show_all_response.text, str(show_all_response.url), "show-all")
            except Exception:
                pass

        if limit is not None and limit > 0:
            return results[:limit]
        return results

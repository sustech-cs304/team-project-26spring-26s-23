from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.campus_info.extractor import ExtractedDocument


@dataclass
class SectionNode:
    level: int
    heading: str
    title: str
    page_numbers: set[int] = field(default_factory=set)
    content_lines: list[str] = field(default_factory=list)
    children: list["SectionNode"] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return {
            "level": self.level,
            "heading": self.heading,
            "title": self.title,
            "page_numbers": sorted(self.page_numbers),
            "content": "\n".join(self.content_lines).strip(),
            "children": [c.to_dict() for c in self.children],
        }


_RE_CHAPTER = re.compile(r"^第(?P<num>[0-9一二三四五六七八九十百千万]+)章\s*(?P<title>.*)$")
_RE_ARTICLE = re.compile(r"^第(?P<num>[0-9一二三四五六七八九十百千万]+)条\s*(?P<title>.*)$")
_RE_CN_ENUM = re.compile(r"^(?P<num>[一二三四五六七八九十]+)、\s*(?P<title>.*)$")
_RE_CN_PAREN = re.compile(r"^（(?P<num>[一二三四五六七八九十]+)）\s*(?P<title>.*)$")
_RE_NUM_DOT = re.compile(r"^(?P<num>\d+)\.\s*(?P<title>.*)$")
_RE_NUM_DOT_DOT = re.compile(r"^(?P<a>\d+)\.(?P<b>\d+)\s*(?P<title>.*)$")
_RE_NUM_PAREN = re.compile(r"^\((?P<num>\d+)\)\s*(?P<title>.*)$")


def _match_heading(line: str) -> tuple[int, str, str] | None:
    s = line.strip()
    if not s:
        return None
    for level, pat in (
        (1, _RE_CHAPTER),
        (2, _RE_ARTICLE),
        (3, _RE_NUM_DOT_DOT),
        (3, _RE_NUM_DOT),
        (3, _RE_CN_ENUM),
        (4, _RE_CN_PAREN),
        (4, _RE_NUM_PAREN),
    ):
        m = pat.match(s)
        if m is None:
            continue
        heading = s
        title = m.groupdict().get("title") or ""
        title = title.strip()
        return (level, heading, title)
    return None


def sectionize_document(doc: ExtractedDocument) -> SectionNode:
    root = SectionNode(level=0, heading="", title="")
    stack: list[SectionNode] = [root]

    for page in doc.pages:
        lines = page.text.splitlines()
        for raw in lines:
            line = raw.rstrip()
            m = _match_heading(line)
            if m is not None:
                level, heading, title = m
                while stack and stack[-1].level >= level:
                    _=stack.pop()
                parent = stack[-1] if stack else root
                node = SectionNode(level=level, heading=heading, title=title)
                node.page_numbers.add(page.page_number)
                parent.children.append(node)
                stack.append(node)
                continue

            current = stack[-1] if stack else root
            if line.strip():
                current.content_lines.append(line)
                current.page_numbers.add(page.page_number)

    def _propagate_pages(node: SectionNode) -> set[int]:
        pages = set(node.page_numbers)
        for c in node.children:
            pages |= _propagate_pages(c)
        node.page_numbers = pages
        return pages

    _ = _propagate_pages(root)
    return root


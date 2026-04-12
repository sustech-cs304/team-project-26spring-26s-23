from __future__ import annotations

import logging
from dataclasses import dataclass

from app.campus_info.extractor import ExtractedDocument

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DocumentChunk:
    source_id: str
    title: str
    url: str
    chunk_index: int
    content: str
    page_numbers: list[int]


def chunk_extracted_document(
    doc: ExtractedDocument, max_chunk_size: int = 100, overlap: int = 20
) -> list[DocumentChunk]:
    """
    Naively chunks an extracted document by character count,
    keeping track of which pages the chunk spans.
    """
    if not doc.pages:
        return []

    chunks: list[DocumentChunk] = []
    chunk_index = 0
    segments: list[tuple[int, str]] = []
    head = 0
    buffered_len = 0

    for page in doc.pages:
        page_text = page.text
        if not page_text:
            continue
        seg_text = page_text + "\n"
        segments.append((page.page_number, seg_text))
        buffered_len += len(seg_text)

        while buffered_len >= max_chunk_size:
            remaining = max_chunk_size
            used_pages: set[int] = set()
            parts: list[str] = []
            i = head
            while remaining > 0 and i < len(segments):
                pn, txt = segments[i]
                if len(txt) <= remaining:
                    parts.append(txt)
                    used_pages.add(pn)
                    remaining -= len(txt)
                    i += 1
                else:
                    parts.append(txt[:remaining])
                    used_pages.add(pn)
                    remaining = 0
            chunks.append(
                DocumentChunk(
                    source_id=doc.source_id,
                    title=doc.title,
                    url=doc.url,
                    chunk_index=chunk_index,
                    content="".join(parts).strip(),
                    page_numbers=sorted(used_pages),
                )
            )
            chunk_index += 1

            advance_step = max_chunk_size - overlap
            to_drop = advance_step
            while to_drop > 0 and head < len(segments):
                pn0, txt0 = segments[head]
                if len(txt0) <= to_drop:
                    to_drop -= len(txt0)
                    buffered_len -= len(txt0)
                    head += 1
                else:
                    segments[head] = (pn0, txt0[to_drop:])
                    buffered_len -= to_drop
                    to_drop = 0

    if head < len(segments):
        remaining_text = "".join(txt for _, txt in segments[head:]).strip()
    else:
        remaining_text = ""
    if remaining_text:
        chunks.append(
            DocumentChunk(
                source_id=doc.source_id,
                title=doc.title,
                url=doc.url,
                chunk_index=chunk_index,
                content=remaining_text,
                page_numbers=sorted({pn for pn, _ in segments[head:]}),
            )
        )

    return chunks

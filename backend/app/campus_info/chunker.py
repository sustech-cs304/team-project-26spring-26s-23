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
    doc: ExtractedDocument, max_chunk_size: int = 1000, overlap: int = 200
) -> list[DocumentChunk]:
    """
    Naively chunks an extracted document by character count,
    keeping track of which pages the chunk spans.
    """
    if not doc.pages:
        return []

    chunks: list[DocumentChunk] = []
    
    current_chunk_text = ""
    current_chunk_pages: set[int] = set()
    chunk_index = 0

    for page in doc.pages:
        page_text = page.text
        if not page_text:
            continue
            
        # If adding this page exceeds max_chunk_size, we might need to split within the page
        # For simplicity in this naive implementation, we just accumulate and split when it gets too large
        current_chunk_text += page_text + "\n"
        current_chunk_pages.add(page.page_number)

        while len(current_chunk_text) >= max_chunk_size:
            # We have enough text to form a chunk
            chunk_content = current_chunk_text[:max_chunk_size]
            chunks.append(
                DocumentChunk(
                    source_id=doc.source_id,
                    title=doc.title,
                    url=doc.url,
                    chunk_index=chunk_index,
                    content=chunk_content.strip(),
                    page_numbers=sorted(list(current_chunk_pages)),
                )
            )
            chunk_index += 1
            
            # Slide the window
            advance_step = max_chunk_size - overlap
            current_chunk_text = current_chunk_text[advance_step:]
            # Note: The pages tracking here becomes imprecise after a split because
            # we don't know exactly which part of the text belongs to which page in the remaining buffer.
            # A more robust implementation would map character offsets to pages.
            # But for a v1, this is acceptable.

    # Process any remaining text
    if current_chunk_text.strip():
        chunks.append(
            DocumentChunk(
                source_id=doc.source_id,
                title=doc.title,
                url=doc.url,
                chunk_index=chunk_index,
                content=current_chunk_text.strip(),
                page_numbers=sorted(list(current_chunk_pages)),
            )
        )

    return chunks

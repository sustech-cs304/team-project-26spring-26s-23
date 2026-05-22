---
name: course-materials-qa
description: Answers questions using only the user-provided course PDFs, with mandatory quoted citations. Invoke when the user wants retrieval QA grounded strictly in uploaded materials.
---
# Course Materials Q&A (PDF-Only, Citation Required)

## Use when
- The user uploads course PDFs and wants Q&A where every answer is grounded in those PDFs.
- The user explicitly requires quoted citations and forbids using outside knowledge or other sources.

## Non-negotiable rules
- Scope lock: Use ONLY the PDFs provided in this conversation/session for both retrieval and answering.
- No external knowledge: Do not use prior knowledge, web sources, or general textbook facts unless they are explicitly present in the PDFs.
- No fabrication: If the PDFs do not contain enough information to answer, say so and provide what is found (if anything).
- Mandatory citations: Every substantive claim must be backed by at least one quote from the PDFs.
- Quote format: Provide short, relevant excerpts; do not dump large chunks of text.

## Inputs
- A set of PDF files (required). Treat these PDFs as the only knowledge base.
- A user question (required).
- Optional: course name, allowed page range, preferred answer language, verbosity preference.

## Output (full)

### Answer
<Direct answer strictly supported by the citations.>

### Citations
- [<PDF filename> p.<page>] "<exact excerpt>"
- [<PDF filename> p.<page>] "<exact excerpt>"

### How this maps to the sources (optional but recommended)
- Claim A → [<PDF filename> p.<page>]
- Claim B → [<PDF filename> p.<page>]

### If not found in the PDFs
- Status: Not enough evidence in the provided PDFs.
- What I did find (if any): <partial relevant quotes>
- What to upload / where to look next: <which chapter/slide type would likely contain it>
- Clarifying question (only if needed): <minimal question to proceed>

## Workflow
- Ingest PDFs:
  - Read text from each PDF.
  - Keep page numbers and filenames attached to every extracted span.
  - Ignore repetitive headers/footers when possible to reduce noise.
- Build an internal retrieval view:
  - Split into small chunks that preserve local context.
  - For each chunk, store: filename, page number(s), and exact text.
- Retrieve evidence first:
  - Search for key terms, synonyms, symbols, and section headings.
  - Prefer chunks that directly define terms or state equations/theorems.
- Answer only from evidence:
  - Draft the answer using only what the retrieved chunks support.
  - If evidence is incomplete, answer partially and explicitly mark the missing parts.
- Validate grounding:
  - Ensure every claim has at least one citation.
  - If a claim cannot be cited, remove it or mark as unknown.

## Quality checks
- Citations are specific: include filename + page, and a short direct quote.
- Quotes match claims: no “citation laundering” where the excerpt does not actually support the statement.
- The answer does not introduce new definitions, constants, or steps not present in the PDFs.

## Suggested interaction pattern
- Step 1: User uploads PDFs.
- Step 2: Confirm which PDFs are in scope and optionally summarize their topics.
- Step 3: For each question, answer with citations or “not found”.

---
name: pdf-courseware-outline
description: Extracts outline, key definitions, and formulas from a courseware PDF. Invoke when the user uploads lecture slides in PDF and wants a study-ready outline.
---
# Courseware Outline & Key Concepts (PDF)

## Use when
- The user provides a courseware PDF and wants a study-ready outline, key definitions, and key formulas/theorems.

## Input
- A PDF file (required).
- Optional: course name, target chapter range, goal (quick skim / review / exam prep), preferred language, desired granularity (brief / detailed).

## Output (full)

### Quick view (≤ 10 lines)
- Topic: <course / lecture title>
- Scope: <page range or chapter range>
- Big picture (1–2 sentences): <what this lecture is about>
- Key sections: <Section A>, <Section B>, <Section C>
- Must-know definitions: <D1>, <D2>, <D3>
- Must-know formulas/theorems: <F1>, <F2>, <T1>
- Typical problems: <P1>, <P2>
- Common confusions: <C1>, <C2>

### Detailed outline
#### 1. Outline
- 1.1 <Section title>
  - Key points
    - <point 1>
    - <point 2>
- 1.2 <Section title>
  - Key points
    - <point 1>
    - <point 2>

#### 2. Key definitions
- <Term 1>
  - Definition: <definition>
  - Notes / boundaries: <assumptions, edge cases, what it does NOT mean>
- <Term 2>
  - Definition: <definition>
  - Notes / boundaries: <...>

#### 3. Key formulas & theorems
- <Formula/Theorem name>
  - Statement:
    - <math expression or theorem statement>
  - Variables:
    - <symbol>: <meaning>, <units if relevant>
  - Conditions:
    - <when it applies>
  - Common transformations / variants:
    - <variant 1>
    - <variant 2>
  - Typical use:
    - <what this is used for>

#### 4. Examples & solution templates (if present)
- Problem type: <type>
  - Template:
    - Step 1: <...>
    - Step 2: <...>
    - Step 3: <...>
  - Common mistakes:
    - <mistake 1>
    - <mistake 2>

#### 5. One-page cram sheet
- Definitions (top 5–10)
  - <D1>: <one-line definition>
- Formulas (top 5–10)
  - <F1>: <formula> — <when to use>
- Key takeaways (3–8)
  - <takeaway 1>
  - <takeaway 2>
- Easy-to-confuse points
  - <confusion 1> vs <confusion 2>

## Workflow
- Extract & scan: read the PDF, identify table of contents, headings, and remove repetitive headers/footers/watermarks.
- Build outline: produce a hierarchy (chapter → section → key points). For chart-heavy pages, summarize the conclusion and variable meanings.
- Collect definitions: extract core terms and rewrite them precisely; include boundaries/assumptions when stated.
- Collect formulas/theorems: list key formulas/theorems with variable glossary and applicability conditions; do not invent derivations.
- Summarize examples: convert worked examples into reusable templates (problem type → steps → pitfalls).
- Produce cram sheet: end with a compact “one-page” study sheet.

## Quality checks
- Do not add definitions/formulas that are not present; if unclear, state “not specified in the slides”.
- Keep symbols consistent; if the same symbol is used with different meanings, separate them by section and explain.
- If the PDF is mostly images or text extraction fails, state the limitation and ask for a selectable-text PDF or a higher-quality copy.

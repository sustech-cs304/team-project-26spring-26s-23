---
name: exam-review-scheduler
description: Builds a daily review schedule from exam date and chapter PDFs, with weighted allocation and spaced review intervals. Invoke when the user wants an exam revision plan.
---
# Exam Review Scheduler (PDF Chapters + Spaced Review)

## Use when
- The user has an exam date and a set of chapter PDFs (1 PDF = 1 chapter) and wants a day-by-day revision plan.
- The user asks for daily time allocation and spaced review intervals (e.g., D+1, D+3, D+7), not just a one-pass reading list.

## Inputs
- Exam date & timezone.
- Chapter PDFs:
  - A list of PDFs, where each PDF corresponds to one chapter.
  - Optional per-chapter weight/difficulty (if the user knows it).
- Daily availability (preferred):
  - Available hours per day, or at least weekdays vs weekends capacity.
- Preferences (optional):
  - Focus block size (e.g., 50/10), max hours/day, rest day rules.
  - Review interval policy (default provided below).

## Output (full)

### 1) Summary
- Exam: <date time, tz>
- Chapters: <N> PDFs
- Total capacity until exam: <hours>
- Plan style: <balanced / deadline-heavy / difficulty-heavy>

### 2) Chapter table (inventory)
| Chapter | Source PDF | Weight | New study (h) | Review cycles | Notes |
|---:|---|---:|---:|---:|---|
| 1 | <file> | 1.0 | 2.0 | 3 | <hard topics> |

Defaults if missing:
- Weight: 1.0 each
- New study per chapter: 1.5–3.0h depending on total days and daily capacity (state your assumption)

### 3) Review interval policy (spaced repetition)
Use fixed review offsets unless the user specifies otherwise:
- After first study of a chapter: Review #1 on +1 day (D+1)
- Review #2 on +3 days (D+3)
- Review #3 on +7 days (D+7)
- Final consolidation: last 1–2 days before the exam (global mixed review)

If time is short:
- Use +1 and +3 only, plus final consolidation.

### 4) Day-by-day plan (calendar-like)
For each day, output:
- Total planned hours: <h>
- New study blocks:
  - <Start–End> — Chapter X: <goal / deliverable>
- Review blocks:
  - <Start–End> — Review Chapter Y (cycle #k): <quiz yourself / recall / formula sheet>
- Mini test / recall:
  - <10–30 min> mixed retrieval from previous chapters

### 5) Daily chapter mix ratio
Explain the daily allocation ratio:
- New study: <X%>
- Reviews: <Y%>
- Retrieval practice / mock: <Z%>

Guidance:
- Early phase: 60–70% new, 20–30% reviews, 10% retrieval
- Mid phase: 40–50% new, 30–40% reviews, 10–20% retrieval
- Last phase: 10–20% new (only patches), 50–70% reviews, 20–30% mock/retrieval

### 6) “If I fall behind” replan rules
- Protect reviews and final consolidation first.
- Drop low-weight chapters last; shorten new-study blocks before dropping review cycles.
- Convert some reviews into quick retrieval quizzes if hours are tight.

## Workflow
- Determine horizon:
  - Count days until exam; identify last-day buffer (no new content on the day before the exam unless required).
- Normalize chapters:
  - Treat each PDF as one chapter; order by chapter index inferred from filename unless user specifies.
  - Assign weights (user-provided or default 1.0).
- Allocate total time:
  - Split total available hours into new-study budget and review budget using phase-based ratios.
  - Distribute new-study budget across chapters proportional to weight.
- Schedule spaced reviews:
  - For each chapter’s first study day, schedule reviews at +1, +3, +7 and near-exam consolidation.
  - If collisions happen, move reviews earlier (never later than the exam).
- Output the plan:
  - Provide chapter inventory + day-by-day schedule + rationale + replan rules.

## Quality checks
- Every chapter has at least 1 review cycle (unless exam is extremely near; then explicitly state limitation).
- Reviews never occur before the first study of that chapter.
- No day exceeds the stated daily capacity; if capacity is insufficient, clearly state the shortfall and propose a minimal viable plan.

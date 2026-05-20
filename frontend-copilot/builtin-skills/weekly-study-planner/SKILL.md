---
name: weekly-study-planner
description: Creates a weekly study plan from Blackboard tasks/DDL and free time in the personal calendar. Invoke when the user wants an executable weekly schedule prioritized by deadlines.
---
# Weekly Study Planner (Blackboard + Calendar)

## Use when
- The user wants a week plan that turns Blackboard tasks (assignments/quizzes/readings) into scheduled study blocks, prioritized by deadlines (DDL) and workload.
- The user asks “安排我这周怎么学/怎么做作业”，并希望直接生成可执行的日程时间块。

## Inputs
- Target window:
  - Week range (e.g., Mon–Sun) and timezone.
- Blackboard tasks (one of the following):
  - A pasted list / screenshot-transcribed list of tasks, each with: course, title, due time, expected effort (optional).
  - Or data obtained via Blackboard tools if available in this run.
- Calendar availability (one of the following):
  - A pasted summary of free slots (preferred if calendar tools are unavailable).
  - Or data obtained from the user’s calendar/ICS tools if available in this run.
- Preferences (optional):
  - Daily study hour cap, no-study times, preferred deep-work block length (e.g., 50/10), break rules.
  - Priority rules (e.g., “projects > quizzes > readings”, “hard courses first”, “no late-night blocks”).

## Output (full)

### 1) Assumptions & constraints
- Timezone: <tz>
- Week range: <start> to <end>
- Daily capacity: <hours/day>, max contiguous focus: <minutes>
- Protected times: <classes / commitments / no-study windows>

### 2) Task inventory (sorted by urgency)
| Priority | Course | Task | Due (DDL) | Effort | Risk | Notes |
|---:|---|---|---|---:|---|---|
| P0 | <course> | <task> | <timestamp> | <h> | <High/Med/Low> | <dependencies, rubric, etc> |

Priority guidance:
- P0: due ≤ 24h or high-risk submission (project/report) within 48h
- P1: due this week
- P2: due next week but needs early start
- P3: optional / bonus / low-impact

### 3) Weekly schedule (executable time blocks)
Represent each block with:
- <Day> <Start–End> — <Course>: <Task chunk> (goal, deliverable)

Rules:
- Schedule P0/P1 first, then P2, then P3.
- Place the hardest/highest-effort chunks into the user’s best focus windows.
- Include buffer blocks before each DDL (e.g., “submission check + upload”).
- Insert review blocks for quizzes/exams (spaced repetition if relevant).

### 4) Daily checklist (what to finish today)
- Today’s top 3 deliverables
- “If I only do one thing”: <single highest impact item>
- Quick admin: upload, formatting, plagiarism check, rubric checklist

### 5) Contingency plan
- If the week is overloaded: list what to drop/shorten first and what cannot be moved.
- If an unexpected event removes <X> hours: which blocks get reallocated.

## Workflow
- Normalize tasks:
  - Deduplicate, unify due timestamps, attach course tags.
  - Estimate effort if missing (ask user if needed; otherwise use conservative defaults).
- Compute priority:
  - Primary: time to DDL
  - Secondary: effort, risk, dependency (needs TA reply / teammate / dataset)
- Extract free slots:
  - Convert calendar events into “available windows”.
  - Respect protected times and daily caps.
- Build schedule:
  - Slice each task into chunks (e.g., 25–90 min) with clear deliverables.
  - Allocate chunks into slots using earliest-deadline-first + “buffer before DDL”.
  - Add submission buffer and recovery time.
- Output:
  - Provide the schedule + daily checklists + contingency.

## Quality checks
- No overlapping blocks; every task chunk has a concrete deliverable.
- Every DDL has a buffer block before it.
- Total planned hours ≤ total available hours (and respects daily caps).
- If data is insufficient (missing DDL / no free time), ask for the minimum missing fields instead of guessing.

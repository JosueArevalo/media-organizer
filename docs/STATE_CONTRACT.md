# State Contract (V1)

## 1. Purpose

This document defines the minimum persistent state contract for V1.

Goals:
- Resume long-running jobs safely.
- Keep user decisions across sessions.
- Track per-file progress for pipeline steps.
- Stay simple and implementation-friendly.

---

## 2. Storage Model

V1 uses a local SQLite database as the source of truth for runtime state.

Optional JSON manifests can be exported for debugging and audit, but they are not the primary state store.

---

## 3. Core Concepts

- Job: a resumable processing session with source and output folders.
- Media Item: one discovered file linked to a job.
- Decision: user choice for compression and target grouping.
- Stage Status: per-item status for scan, classify, compress, and organize.
- Checkpoint: progress marker to continue safely after interruption.

---

## 4. Required Enums

```text
job_status:
- draft
- scanned
- ready
- running
- paused
- completed
- failed
- cancelled

media_type:
- image
- video
- unknown

source_kind:
- camera
- whatsapp
- screenshot
- unknown

stage_name:
- scan
- classify
- compress
- organize

stage_status:
- pending
- running
- completed
- failed
- skipped
```

---

## 5. Minimal Schema

### 5.1 jobs

```text
id TEXT PRIMARY KEY                -- UUID
name TEXT NULL
source_dir TEXT NOT NULL
output_dir TEXT NOT NULL
status TEXT NOT NULL               -- job_status
created_at TEXT NOT NULL           -- ISO-8601
updated_at TEXT NOT NULL           -- ISO-8601
last_opened_at TEXT NULL           -- ISO-8601
```

### 5.2 media_items

```text
id TEXT PRIMARY KEY                -- UUID
job_id TEXT NOT NULL               -- FK jobs.id
source_path TEXT NOT NULL
relative_path TEXT NOT NULL
media_type TEXT NOT NULL           -- media_type
source_kind_detected TEXT NOT NULL -- source_kind
source_kind_override TEXT NULL     -- source_kind
size_bytes INTEGER NOT NULL
capture_time TEXT NULL             -- ISO-8601
created_at TEXT NOT NULL
updated_at TEXT NOT NULL

UNIQUE(job_id, source_path)
```

### 5.3 item_decisions

```text
id TEXT PRIMARY KEY                -- UUID
job_id TEXT NOT NULL               -- FK jobs.id
item_id TEXT NOT NULL              -- FK media_items.id
selected_for_compression INTEGER NOT NULL DEFAULT 0
selected_for_output INTEGER NOT NULL DEFAULT 1
target_group_label TEXT NULL       -- Example: 2026.04.15 - BBQ
user_overridden INTEGER NOT NULL DEFAULT 0
updated_at TEXT NOT NULL

UNIQUE(job_id, item_id)
```

### 5.4 item_stage_status

```text
id TEXT PRIMARY KEY                -- UUID
job_id TEXT NOT NULL               -- FK jobs.id
item_id TEXT NOT NULL              -- FK media_items.id
stage TEXT NOT NULL                -- stage_name
status TEXT NOT NULL               -- stage_status
attempt_count INTEGER NOT NULL DEFAULT 0
last_error TEXT NULL
updated_at TEXT NOT NULL

UNIQUE(job_id, item_id, stage)
```

### 5.5 job_checkpoints

```text
id TEXT PRIMARY KEY                -- UUID
job_id TEXT NOT NULL               -- FK jobs.id
stage TEXT NOT NULL                -- stage_name
cursor TEXT NULL                   -- implementation-defined pointer
payload_json TEXT NULL             -- optional serialized metadata
updated_at TEXT NOT NULL

UNIQUE(job_id, stage)
```

---

## 6. Job Lifecycle

```text
Create job      : draft
Scan finished   : scanned
User decisions  : ready
Pipeline start  : running
User pause      : paused
Pipeline finish : completed
Non-recoverable : failed
User cancel     : cancelled
```

Transition rules:
- `running -> paused` must be allowed at any time.
- On app restart, stale `running` jobs must be recovered as `paused`.
- `completed` jobs are immutable for processing status.
- `cancelled` jobs are not resumed unless explicitly cloned to a new job.

---

## 7. Resume Rules

When resuming a job:
1. Load latest job and checkpoints.
2. For each stage, treat stale `running` item statuses as `pending`.
3. Continue with items in `pending` and retryable `failed`.
4. Skip items in `completed` or `skipped`.
5. Persist updates in small transactions per item.

Idempotency constraints:
- Re-running a completed stage must not duplicate outputs.
- Stage handlers should verify output existence before writing.
- Any filesystem mutation should be traceable to one `(job_id, item_id, stage)` record.

---

## 8. Classification Contract

Detected kind (`source_kind_detected`) is a suggestion only.

Effective kind is computed as:
1. `source_kind_override` when present.
2. Otherwise `source_kind_detected`.

Dashboard requirements:
- Show kind badge for each item.
- Allow manual override.
- Support bulk actions using kind and size filters.

---

## 9. Bulk Selection Contract

V1 must support these server-side selectors:
- Select all.
- Select none.
- Select only large files (threshold configurable).
- Exclude likely WhatsApp and screenshot items.

Selectors update `item_decisions.selected_for_compression`.

---

## 10. Minimum API Expectations

These operations must be supported by the backend service layer:
- Create job.
- Resume job.
- Scan source folder and upsert media items.
- Read paginated items with filters (kind, type, status, size).
- Update item decisions (single and bulk).
- Start, pause, and continue pipeline execution.
- Read job progress summary by stage.

---

## 11. Out of Scope for V1

- Multi-user concurrency.
- Cloud sync.
- Analytics-grade event warehouse.
- Complex migration tooling.

Schema migrations may be simple versioned SQL scripts.

---

## 12. Reference Implementation (Current)

Current V1 state artifacts in this repository:

- `apps/backend/src/state/migrations/001_initial_state.sql`
- `apps/backend/src/state/dto/state.types.ts`

These files are the implementation baseline for this contract and should remain aligned with the schema and enums defined above.

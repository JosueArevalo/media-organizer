# State Contract (V1)

## 1. Purpose

This document defines the minimal persistent state contract for V1.

Goals:
- Resume long-running processing sessions safely
- Keep user decisions across sessions
- Track per-file progress for pipeline steps
- Stay simple: one active session at a time
- Support resumable, idempotent pipeline execution

---

## 2. Storage Model

V1 uses a local SQLite database as the source of truth for runtime state.

Only one processing session is active at a time. Previous sessions may be archived or cleaned up (out of scope for V1).

Optional JSON manifests can be exported for debugging and audit, but they are not the primary state store.

---

## 3. Core Concepts

- **Session**: A single processing run with a source folder and output folder.
- **Media Item**: One discovered file linked to the active session.
- **Decision**: User choice for compression and target grouping per file.
- **Stage Status**: Per-item status for scan, classify, compress, and organize.
- **Checkpoint**: Progress marker to continue safely after interruption.

---

## 4. Required Enums

```text
session_status:
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

Note: There is always at most one active session at a time.

### 5.1 sessions (was: jobs)

```text
id TEXT PRIMARY KEY                -- UUID
name TEXT NULL
source_dir TEXT NOT NULL
output_dir TEXT NOT NULL
status TEXT NOT NULL               -- session_status
created_at TEXT NOT NULL           -- ISO-8601
updated_at TEXT NOT NULL           -- ISO-8601
last_opened_at TEXT NULL           -- ISO-8601
```

### 5.2 media_items

```text
id TEXT PRIMARY KEY                -- UUID
session_id TEXT NOT NULL           -- FK sessions.id
source_path TEXT NOT NULL
relative_path TEXT NOT NULL
media_type TEXT NOT NULL           -- media_type
source_kind_detected TEXT NOT NULL -- source_kind
source_kind_override TEXT NULL     -- source_kind
size_bytes INTEGER NOT NULL
capture_time TEXT NULL             -- ISO-8601
created_at TEXT NOT NULL
updated_at TEXT NOT NULL

UNIQUE(session_id, source_path)
```

### 5.3 item_decisions

```text
id TEXT PRIMARY KEY                -- UUID
session_id TEXT NOT NULL           -- FK sessions.id
item_id TEXT NOT NULL              -- FK media_items.id
selected_for_compression INTEGER NOT NULL DEFAULT 0
selected_for_output INTEGER NOT NULL DEFAULT 1
target_group_label TEXT NULL       -- Example: 2026.04.15 - BBQ
user_overridden INTEGER NOT NULL DEFAULT 0
updated_at TEXT NOT NULL

UNIQUE(session_id, item_id)
```

### 5.4 item_stage_status

```text
id TEXT PRIMARY KEY                -- UUID
session_id TEXT NOT NULL           -- FK sessions.id
item_id TEXT NOT NULL              -- FK media_items.id
stage TEXT NOT NULL                -- stage_name
status TEXT NOT NULL               -- stage_status
attempt_count INTEGER NOT NULL DEFAULT 0
last_error TEXT NULL
updated_at TEXT NOT NULL

UNIQUE(session_id, item_id, stage)
```

### 5.5 job_checkpoints

```text
id TEXT PRIMARY KEY                -- UUID
session_id TEXT NOT NULL           -- FK sessions.id
stage TEXT NOT NULL                -- stage_name
cursor TEXT NULL                   -- implementation-defined pointer
payload_json TEXT NULL             -- optional serialized metadata
updated_at TEXT NOT NULL

UNIQUE(session_id, stage)
```

---

## 6. Session Lifecycle

```text
Create session  : draft
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
- On app restart, stale `running` sessions must be recovered as `paused`.
- `completed` sessions are immutable for processing status.
- `cancelled` sessions are not resumed unless explicitly cloned to a new session.
- Only one session can be active at a time (status != `completed`, `failed`, `cancelled`).

---

## 7. Resume Rules

When resuming the active session:
1. Load the current session and its checkpoints.
2. For each stage, treat stale `running` item statuses as `pending`.
3. Continue with items in `pending` and retryable `failed`.
4. Skip items in `completed` or `skipped`.
5. Persist updates in small transactions per item.

Idempotency constraints:
- Re-running a completed stage must not duplicate outputs.
- Stage handlers should verify output existence before writing.
- Any filesystem mutation should be traceable to one `(session_id, item_id, stage)` record.

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
- Start or resume the active session (source + output folders).
- Pause session.
- Scan source folder and upsert media items.
- Read paginated items with filters (kind, type, status, size).
- Update item decisions (single and bulk).
- Continue pipeline execution.
- Read session progress summary by stage.
- Get current session status (or null if none active).

Note: Only one session can be active at a time. Creating a new session implicitly closes the previous one.

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

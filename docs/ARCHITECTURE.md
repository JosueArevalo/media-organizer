# Architecture Document

## 1. Overview

Media Organizer is a local-first application designed to process, compress and organize personal media files (photos and videos).

The system is built as a modular monolith with a clear separation of concerns between UI, backend, core logic and external tools.

---

## 2. High-Level Architecture

```text
Frontend (React)
    -> Backend (Node.js + TypeScript)
    -> Pipeline Engine (Core logic)
    -> Filesystem + External Tools (mozjpeg, HandBrake)
```

---

## 3. Architectural Principles

- Local-first (no cloud dependency required)
- Modular monolith (simple but scalable)
- Separation of concerns
- Pipeline-based processing (core concept)
- Simple, minimal abstractions (one active session at a time)
- User-selected input and output folders
- Output structure mirrors source structure (flat)
- Compressed photos and videos in same output tree
- Preview-first workflows before file mutations
- Resumable workflows for long-running sessions
- Minimal SQLite persistence for V1 state

---

## 4. Project Structure

```text
media-organizer/
│
├─ README.md
├─ AGENTS.md
│
├─ docs/
│   ├─ PRD.md
│   ├─ ARCHITECTURE.md
│
├─ apps/
│   ├─ backend/
│   │   ├─ src/
│   │   │   ├─ api/
│   │   │   ├─ services/
│   │   │   ├─ pipeline/
│   │   │   ├─ state/
│   │   │   │   ├─ migrations/
│   │   │   │   │   └─ 001_initial_state.sql
│   │   │   │   └─ dto/
│   │   │   │       └─ state.types.ts
│   │   │   └─ index.ts
│   │   ├─ tests/
│   │   ├─ package.json
│   │   └─ tsconfig.json
│   │
│   └─ web/
│       ├─ src/
│       │   ├─ components/
│       │   ├─ pages/
│       │   ├─ services/
│       │   └─ main.tsx
│       ├─ tests/
│       ├─ index.html
│       ├─ package.json
│       └─ vite.config.ts
│
├─ packages/
│   ├─ core/
│   │   ├─ compression/
│   │   ├─ metadata/
│   │   └─ grouping/
│   │
│   ├─ pipeline/
│   │   ├─ Pipeline.ts
│   │   ├─ PipelineStep.ts
│   │   └─ steps/
│   │
│   └─ filesystem/
│
├─ scripts/
│   └─ media_tools/
│       ├─ compress_images.py
│       └─ compress_videos.py
│
└─ .gitignore
```

---

## 5. Backend Architecture

The backend is responsible for:

- Exposing a local HTTP API
- Orchestrating the pipeline
- Executing scripts and external tools
- Managing filesystem operations
- Persisting resumable session state

### Layers

- API Layer → HTTP endpoints
- Service Layer → business logic and orchestration
- Pipeline Layer → processing steps execution

### V1 Workflow

- Receive a source folder and a destination folder from the dashboard
- Start a processing session that can later be paused and resumed
- Scan nested media files without modifying them (preview-only)
- Build preview data for compression and grouping decisions
- Classify files with basic source heuristics (camera, WhatsApp, screenshot, unknown)
- Apply user-approved decisions through the pipeline
- Output structure mirrors source structure directly to destination folder
- Both compressed images and videos go to the same output tree

---

## 6. Pipeline Architecture (Core Concept)

The system is based on a pipeline pattern.

A pipeline is a sequence of steps that process media files.

Example pipeline:

```text
ImportStep
CompressImagesStep
CompressVideosStep
GroupByDateStep
OrganizeStep
```

Each step:

- receives input
- processes data
- returns output

Conceptual interface:

```text
PipelineStep:
    execute(input) -> output
```

The pipeline engine executes steps sequentially.

For V1, the pipeline should support preview-only steps and apply steps separately so the UI can inspect results before writes happen.
Pipeline steps should be idempotent where possible and record checkpoints per file to support resume behavior.

---

## 7. Core Modules

Located in `packages/`

### compression
Handles image and video compression logic.

### metadata
Extracts metadata such as creation date.

### grouping
Groups media files by rules (date, event, etc.).

### filesystem
Handles file system operations (read, write, move).

### state
Stores session state, checkpoints, selections and processed items using a minimal SQLite database.

Only one session can be active at a time. Previous sessions are archived or cleaned up.

State contract reference:

- `docs/STATE_CONTRACT.md`

### classification
Provides heuristics to detect probable source type (camera, WhatsApp, screenshot, unknown).

---

## 8. Frontend Architecture

The frontend is a React application.

Responsibilities:

- Let the user select input and output folders
- Display scan results, previews and processing state
- Show source-type badges and status badges per file
- Trigger backend operations
- Display progress and results

Structure:

- components → reusable UI elements
- pages → dashboard sections such as import, photos, video and grouping
- services → API communication with backend

The dashboard should provide bulk actions such as select all, select none, select only large files and exclude likely WhatsApp/screenshot files.

The UI should be a single local dashboard with sections, not multiple independent web apps.

---

## 9. External Tools Integration

The system relies on external tools:

- mozjpeg → image compression
- HandBrake CLI → video compression

These tools are invoked from the backend or scripts.

---

## 10. Future Considerations

- AI-based grouping (events, people)
- Face detection
- Persistent state (database)
- Background processing (queue system)
- Cloud integrations such as Google Photos and Synology

---

## 11. Summary

The system is designed to be simple but extensible.

The most important part of the architecture is the pipeline engine, which allows flexible and scalable media processing.

For V1 state semantics and persistence rules, use:

- `docs/STATE_CONTRACT.md`

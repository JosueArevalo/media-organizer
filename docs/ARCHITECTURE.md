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
- Avoid over-engineering in V1

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

### Layers

- API Layer → HTTP endpoints
- Service Layer → business logic and orchestration
- Pipeline Layer → processing steps execution

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

---

## 8. Frontend Architecture

The frontend is a React application.

Responsibilities:

- Select folders and files
- Trigger backend operations
- Display progress and results

Structure:

- components → reusable UI elements
- pages → main screens
- services → API communication with backend

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

---

## 11. Summary

The system is designed to be simple but extensible.

The most important part of the architecture is the pipeline engine, which allows flexible and scalable media processing.

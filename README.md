# Media Organizer

Media Organizer is a local-first application for organizing, compressing and managing personal photos and videos.

It is designed for large, periodic imports from mobile devices into a local workflow that stays under the user's control.

## What It Is

This repository contains:

- a local backend for filesystem orchestration and resumable processing jobs
- a local dashboard for scanning, previewing and applying actions
- a state contract for V1 persistence and resume behavior
- shared documentation for product, architecture and agent behavior

The goal of this project is to automate a manual and time-consuming process:
- exporting media from a mobile phone
- selecting source and destination folders locally
- scanning mixed photo and video folders
- reviewing a preview before applying changes
- compressing images and videos
- organizing files into structured folders
- preparing content for backup (Google Photos, NAS, etc.)

---

## Planned Capabilities

- Select input and output folders from a local dashboard
- Scan nested folders containing photos and videos
- Preview media before applying changes
- Resume work across sessions without losing progress
- Compress images using mozjpeg
- Compress videos using HandBrake
- Propose folder grouping by date and filename patterns
- Let the user adjust proposed groupings before applying them
- Detect probable media origin (camera, WhatsApp, screenshot)
- Support smart bulk actions (select all, select none, select large files, exclude WhatsApp/screenshots)
- Generate consistent folder names
- Local web interface to manage the process
- Optional AI-based grouping (future)

## Architecture Snapshot

The project follows a modular monolith structure:

- `apps/backend` → local API and filesystem orchestration
- `apps/web` → local dashboard UI
- `packages/` → core logic and pipeline building blocks
- `scripts/` → helper scripts for media processing and verification
- `docs/` → product, architecture and state contract documentation

---

## Getting Started

This repository already includes a minimal executable scaffold:

- Backend hello world (`apps/backend`) with SQLite migration bootstrapping.
- Frontend hello world (`apps/web`) with a dashboard that calls `/api/health`.

### Prerequisites

- Node.js LTS 22.x (recommended).
- npm (bundled with Node.js).

If Node is not installed, use:

```powershell
winget install OpenJS.NodeJS.LTS
```

If the installer requests elevation, run PowerShell as Administrator and repeat the command.

The intended V1 flow is:

1. Open the local dashboard.
2. Select input and output folders.
3. Create or resume a processing job.
4. Scan and preview the media.
5. Run compression or grouping steps.
6. Pause or close safely at any time.
7. Resume later and apply the proposed changes.

### Install

```powershell
cd <project-root>
npm install
```

### Run backend

```powershell
cd <project-root>
npm run dev:backend
```

Backend URL: `http://localhost:4000/api/health`

### Run frontend dashboard

```powershell
cd <project-root>
npm run dev:web
```

Dashboard URL: `http://localhost:5173`

### Run both with one command

```powershell
cd <project-root>
npm run dev
```

This starts backend and frontend together using a cross-platform Node script.

### Stop development servers

The development servers run in the terminal session while the command is active.

To stop them:

- Press `Ctrl+C` in the terminal where `npm run dev`, `npm run dev:backend`, or `npm run dev:web` is running.
- Or close the terminal tab/session.

No extra stop script is required for the current scaffold.

### Build both apps

```powershell
cd <project-root>
npm run build
```

### Run tests

Current automated tests cover the backend state contract and migration bootstrap.

```powershell
cd <project-root>
npm test
```

If you want to run the backend workspace test command directly:

```powershell
cd <project-root>
npm run test --workspace apps/backend
```

### Verify hello world (non-interactive)

With backend and frontend running, validate end-to-end in one command:

```powershell
cd <project-root>
npm run verify:hello
```

## Requirements

The project relies on external tools:

- mozjpeg (image compression)
- HandBrake CLI (video compression)

These tools must be installed on your system.

---

## Vision

The long-term goal is to build a system that can:

- automatically group photos by event or date
- detect people (e.g. family members)
- suggest folder structures
- reduce manual work as much as possible

---

## Documentation

- `docs/PRD.md` → Product requirements
- `docs/ARCHITECTURE.md` → System design
- `docs/STATE_CONTRACT.md` → V1 persistence contract (SQLite schema, states, resume rules)
- `AGENTS.md` → Instructions for AI agents
 - `AI_CONTEXT.md` → Operational, tool-agnostic guidance for automated assistants

## Agent Skills

- `.github/skills/state-contract-implementation/SKILL.md` → Workflow for implementing state and resume logic aligned with the V1 contract

---

## Contributing

If you open a pull request, please keep changes aligned with the documentation and the V1 state contract.

## Status

This repository is under active development.

The focus is on learning, experimentation and building a solid architecture.
The first usable version will be a local MVP with preview-driven workflows and resumable local state.

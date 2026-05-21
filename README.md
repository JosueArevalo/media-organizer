# Media Organizer

Media Organizer is a local-first application for organizing, compressing and managing personal photos and videos.

It is designed for large, periodic imports from mobile devices into a local workflow that stays under the user's control.

## What It Is

This repository contains:

- a local backend for filesystem orchestration and resumable processing jobs
- a local dashboard for scanning, previewing and applying actions
- a state contract for V1 persistence and resume behavior
- shared documentation for product, architecture, quality and agent behavior

The goal is to automate a manual and time-consuming process:

- exporting media from a mobile phone
- selecting source and destination folders locally
- scanning mixed photo and video folders
- reviewing a preview before applying changes
- compressing images and videos
- organizing files into structured folders
- preparing content for backup

## Current Capabilities

- Select input and output folders from a local dashboard
- Scan nested folders containing photos and videos
- Preview media before applying changes
- Persist resumable compression and grouping sessions
- Compress images using mozjpeg-compatible tooling
- Compress videos using HandBrake CLI
- Propose folder grouping by date and filename patterns
- Let the user adjust proposed groupings before applying them
- Support dashboard execution history and maintenance actions
- Keep V1 local, single-user and explicit around filesystem writes

## Architecture Snapshot

The project follows a modular monolith structure:

- `apps/backend` -> local API, state, pipeline and filesystem orchestration
- `apps/web` -> local React dashboard UI
- `scripts/` -> helper scripts for media processing and verification
- `docs/` -> product, architecture, state contract and quality guidance

Main flow:

```text
Frontend -> Backend -> Pipeline/Services -> SQLite / Filesystem / External Tools
```

## Getting Started

### Prerequisites

- Node.js LTS 22.x
- npm, bundled with Node.js
- Python, for media helper scripts
- mozjpeg-compatible `cjpeg`, for image compression
- `HandBrakeCLI`, for video compression

If Node is not installed on Windows:

```powershell
winget install OpenJS.NodeJS.LTS
```

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

Stop development servers with `Ctrl+C` in the terminal where the command is running.

## Build And Test

Build both apps:

```powershell
cd <project-root>
npm run build
```

Run backend tests:

```powershell
cd <project-root>
npm test
```

Run frontend tests:

```powershell
cd <project-root>
npm run test --workspace apps/web
```

Recommended quality gate before merging:

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test --workspace apps/web
```

On Windows PowerShell, use `npm.cmd` if script execution blocks `npm.ps1`.

## Security Model

V1 is local-first and single-user.

- The backend is intended for localhost use, not LAN or internet exposure.
- Browser origins and Host headers are restricted to localhost-style addresses.
- CORS does not use a wildcard origin.
- Request JSON bodies have a bounded size.
- Filesystem-mutating maintenance endpoints require explicit confirmation tokens.
- Do not widen host/origin rules for LAN access without adding authentication or a local token.

## Intended V1 Flow

1. Open the local dashboard.
2. Select input and output folders.
3. Create or resume a processing job.
4. Scan and preview the media.
5. Run compression or grouping steps.
6. Pause or close safely at any time.
7. Resume later and apply proposed changes.

## Documentation

- `docs/PRD.md` -> Product requirements
- `docs/ARCHITECTURE.md` -> Current system design
- `docs/STATE_CONTRACT.md` -> V1 persistence contract
- `docs/QUALITY_BASELINE.md` -> Current quality, security and dependency baseline
- `AGENTS.md` -> Instructions for AI agents
- `AI_CONTEXT.md` -> Operational, tool-agnostic guidance for automated assistants

## Agent Skills

- `.github/skills/state-contract-implementation/SKILL.md` -> Workflow for implementing state and resume logic aligned with the V1 contract

## Status

This repository is under active development.

The focus is on learning, experimentation and building a solid local MVP with preview-driven workflows and resumable state.

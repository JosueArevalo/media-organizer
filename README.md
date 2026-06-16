# Media Organizer

Media Organizer is a local-first application for organizing, compressing and managing personal photos and videos.

It is designed for large, periodic imports from mobile devices into a local workflow that stays under the user's control.

## Quick Start

### Prerequisites

- Node.js `22.13.0` or newer. Node 22 LTS or Node 24 LTS are recommended.
- npm, bundled with Node.js.
- Python, for media helper scripts.
- mozjpeg-compatible `cjpeg`, for image compression.
- `HandBrakeCLI`, for video compression.

The backend uses Node's built-in `node:sqlite` module. Node `22.9.0` is too old and will fail before the app starts.

### macOS / Linux

Install Node.js 22 LTS or 24 LTS from the official Node.js website, then run:

```bash
cd media-organizer
node -v
npm ci
npm run dev
```

Dashboard: `http://localhost:5173`

Backend health check: `http://localhost:4000/api/health`

If you already use a Node version manager such as `nvm`, `fnm`, `asdf`, or mise, the repository also includes `.nvmrc` and `.node-version` pinned to Node `22.22.3`.

With `nvm`:

```bash
nvm install
nvm use
npm ci
npm run dev
```

### Windows PowerShell

```powershell
cd media-organizer
node -v
npm.cmd ci
npm.cmd run dev
```

Dashboard: `http://localhost:5173`

Backend health check: `http://localhost:4000/api/health`

If Node is not installed on Windows:

```powershell
winget install OpenJS.NodeJS.LTS
```

On Windows PowerShell, use `npm.cmd` if script execution blocks `npm.ps1`.

### Install Notes

`npm` installs project dependencies after Node.js is already installed. It does not replace Node.js itself.

Use `npm ci` for a clean install from the committed `package-lock.json`. This is the best option when validating the project from a fresh clone or downloaded zip.

Use `npm install` when intentionally updating dependencies.

Do not run `npm audit fix --force` as part of normal setup. It can change major dependency versions and make the local install less predictable. Audit warnings are separate from the Node version required to start the app.

Docker is not required for local development. The simplest supported path is installing a compatible Node.js LTS version and running the commands above.

Stop development servers with `Ctrl+C` in the terminal where the command is running.

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

## Development Commands

Run both backend and frontend:

```powershell
npm.cmd run dev
```

Run only the backend:

```powershell
npm.cmd run dev:backend
```

Run only the frontend:

```powershell
npm.cmd run dev:web
```

Build both apps:

```powershell
npm.cmd run build
```

Run backend tests:

```powershell
npm.cmd test
```

Run frontend tests:

```powershell
npm.cmd run test --workspace apps/web
```

Recommended quality gate before merging:

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test --workspace apps/web
```

On macOS and Linux, use `npm` instead of `npm.cmd`.

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

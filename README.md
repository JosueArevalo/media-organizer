# Media Organizer

Media Organizer is a local-first tool to help organize, compress and manage personal photos and videos.

The goal of this project is to automate a manual and time-consuming process:
- exporting media from a mobile phone
- selecting source and destination folders locally
- scanning mixed photo and video folders
- reviewing a preview before applying changes
- compressing images and videos
- organizing files into structured folders
- preparing content for backup (Google Photos, NAS, etc.)

---

## ✨ Features (Planned)

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

---

## 🏗️ Project Structure

This project follows a modular monolith architecture:

- `apps/backend` → Local API and filesystem orchestration (Node.js + TypeScript)
- `apps/web` → Local dashboard UI (React)
- `packages/` → Core logic (pipeline, filesystem, metadata, etc.)
- `scripts/` → Python scripts for media processing
- `docs/` → Project documentation (PRD, architecture, etc.)

---

## 🚀 Getting Started

This repository already includes a minimal executable scaffold:

- Backend hello world (`apps/backend`) with SQLite migration bootstrapping.
- Frontend hello world (`apps/web`) with a dashboard that calls `/api/health`.

### Prerequisites (Windows)

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
cd "d:\Software Development\media-organizer"
npm install
```

### Run backend

```powershell
cd "d:\Software Development\media-organizer"
npm run dev:backend
```

Backend URL: `http://localhost:4000/api/health`

### Run frontend dashboard

```powershell
cd "d:\Software Development\media-organizer"
npm run dev:web
```

Dashboard URL: `http://localhost:5173`

### Run both with one command

```powershell
cd "d:\Software Development\media-organizer"
npm run dev
```

This starts backend and frontend together using a cross-platform Node script.

### Build both apps

```powershell
cd "d:\Software Development\media-organizer"
npm run build
```

### Verify hello world (non-interactive)

With backend and frontend running, validate end-to-end in one command:

```powershell
cd "d:\Software Development\media-organizer"
npm run verify:hello
```

---

## 📦 Requirements

The project relies on external tools:

- mozjpeg (image compression)
- HandBrake CLI (video compression)

These tools must be installed on your system.

---

## 🧠 Vision

The long-term goal is to build a system that can:

- automatically group photos by event or date
- detect people (e.g. family members)
- suggest folder structures
- reduce manual work as much as possible

---

## 📄 Documentation

- `docs/PRD.md` → Product requirements
- `docs/ARCHITECTURE.md` → System design
- `docs/STATE_CONTRACT.md` → V1 persistence contract (SQLite schema, states, resume rules)
- `AGENTS.md` → Instructions for AI agents

## 🧩 Agent Skills

- `.github/skills/state-contract-implementation/SKILL.md` → Workflow for implementing state and resume logic aligned with the V1 contract

---

## ⚠️ Status

This is a personal project under active development.

The focus is on learning, experimentation and building a solid architecture.
The first usable version will be a local MVP with preview-driven workflows and resumable local state.

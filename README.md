# Media Organizer

Media Organizer is a local-first tool to help organize, compress and manage personal photos and videos.

The goal of this project is to automate a manual and time-consuming process:
- exporting media from a mobile phone
- compressing images and videos
- organizing files into structured folders
- preparing content for backup (Google Photos, NAS, etc.)

---

## ✨ Features (Planned)

- Compress images using mozjpeg
- Compress videos using HandBrake
- Organize media into folders by date
- Generate consistent folder names
- Local web interface to manage the process
- Optional AI-based grouping (future)

---

## 🏗️ Project Structure

This project follows a modular monolith architecture:

- `apps/backend` → Local API (Node.js + TypeScript)
- `apps/web` → Web UI (React)
- `packages/` → Core logic (pipeline, filesystem, metadata, etc.)
- `scripts/` → Python scripts for media processing
- `docs/` → Project documentation (PRD, architecture, etc.)

---

## 🚀 Getting Started (WIP)

The project is currently in early development.

Planned setup:

```bash
# backend
cd apps/backend
npm install
npm run dev

# frontend
cd apps/web
npm install
npm run dev
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
- `AGENTS.md` → Instructions for AI agents

---

## ⚠️ Status

This is a personal project under active development.

The focus is on learning, experimentation and building a solid architecture.

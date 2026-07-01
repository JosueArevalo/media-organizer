# Product Requirements Document (PRD)

## 1. Overview

Media Organizer is a local tool designed to simplify the management of personal photos and videos.

Users often have large amounts of media stored on their phones. Organizing, compressing and backing up this media is a repetitive and time-consuming task.

This project aims to automate most of this process while keeping the user in control through a local dashboard.

---

## 2. Problem

The current workflow is manual and inefficient:

1. Export media from mobile device
2. Compress images manually (e.g. using TinyPNG)
3. Compress videos using tools like HandBrake
4. Manually create folders for events or categories
5. Upload files to cloud services (Google Photos)
6. Backup files to local storage (NAS)

This process:
- takes a lot of time
- requires multiple tools
- is repetitive
- does not scale well over time

---

## 3. Goals

- Reduce manual work when organizing media
- Automate compression of images and videos
- Create a consistent folder structure
- Improve workflow efficiency
- Provide a simple local interface
- Let the user review a preview before applying changes
- Keep V1 simple, local and testable
- Support long-running workflows that can be paused and resumed safely

---

## 4. Non-Goals (V1)

- Full automation using AI
- Integration with cloud providers (Google Photos API)
- Multi-user support
- Mobile app
- Sync with Synology or other NAS platforms
- Advanced analytics and reporting

---

## 5. Target User

- Single user (personal use)
- Technical user (developer / power user)
- Works locally on their machine

---

## 6. Core Features (V1)

### 6.1 Media Import

- Load media from a user-selected local folder, including nested subfolders
- Support images and videos
- Scan the source without mutating files during preview

---

### 6.2 Compression

- Compress images using mozjpeg
- Compress videos using HandBrake CLI
- Allow the user to select items before running compression
- Mark already processed items through persistent local state
- Provide smart selectors for bulk actions (all, none, only large files, exclude WhatsApp/screenshots)

---

### 6.3 Media Classification

- Classify files with simple heuristics: camera, WhatsApp, screenshot, unknown
- Show classification badges in the dashboard to guide user decisions
- Keep classification editable by the user when heuristics are wrong

---

### 6.4 Organization

- Group media by date and filename patterns as a first pass
- Create folder proposals using a naming convention:

Example:
```
YYYY.MM.DD - Event Name
```

If no event is detected:
```
YYYY - Misc
```

- Allow the user to move media between proposed folders before applying

---

### 6.5 Output

- Generate organized folders in a user-selected output directory
- Prepare files for backup or later export

---

### 6.6 State Tracking and Resume

- Persist processing jobs locally so the user can stop and resume later
- Store scans, selections, classification, grouping edits and processing status
- Use a minimal local SQLite database for V1 state
- Optionally export JSON manifests for debugging or auditing

Detailed contract:

- See `docs/STATE_CONTRACT.md` for schema, lifecycle, transitions and resume rules.

---

## 7. Future Features

- AI-based grouping (events, people, locations)
- Face detection (e.g. identify family members)
- Automatic album suggestions
- Integration with cloud services
- Metadata enrichment

---

## 8. Constraints

- Must run locally (no cloud dependency)
- Should work with large amounts of files
- Must be simple to use
- Must tolerate interruptions (app close, restart, or partial execution)

---

## 9. Success Criteria

- Reduce time spent organizing media
- Reduce manual steps
- Provide consistent output structure
- Let the user understand and control each step before it is applied
- Keep the system easy to extend without adding unnecessary complexity
- Allow the user to resume a large job without losing decisions or progress

---

## 10. Open Questions

- How to detect events automatically?
- How to handle duplicate files?
- Which heuristics should be enabled by default for source classification?

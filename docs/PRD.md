# Product Requirements Document (PRD)

## 1. Overview

Media Organizer is a local tool designed to simplify the management of personal photos and videos.

Users often have large amounts of media stored on their phones. Organizing, compressing and backing up this media is a repetitive and time-consuming task.

This project aims to automate most of this process.

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

---

## 4. Non-Goals (V1)

- Full automation using AI
- Integration with cloud providers (Google Photos API)
- Multi-user support
- Mobile app

---

## 5. Target User

- Single user (personal use)
- Technical user (developer / power user)
- Works locally on their machine

---

## 6. Core Features (V1)

### 6.1 Media Import

- Load media from a local folder
- Support images and videos

---

### 6.2 Compression

- Compress images using mozjpeg
- Compress videos using HandBrake CLI

---

### 6.3 Organization

- Group media by date (basic rule)
- Create folders using a naming convention:

Example:
```
YYYY.MM.DD - Event Name
```

If no event is detected:
```
YYYY - Misc
```

---

### 6.4 Output

- Generate organized folders
- Prepare files for upload and backup

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

---

## 9. Success Criteria

- Reduce time spent organizing media
- Reduce manual steps
- Provide consistent output structure

---

## 10. Open Questions

- How to detect events automatically?
- How to handle duplicate files?
- How to manage processing state?

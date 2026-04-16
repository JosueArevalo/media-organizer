# AGENTS.md

## Purpose

This file provides high-level guidance for AI agents (like Copilot) working in this repository.

Keep this file small and focused. Detailed rules are defined in the docs folder.

---

## General Rules

- Always use TypeScript for backend and frontend code
- Follow the existing folder structure
- Prefer simple solutions over complex ones
- Do not introduce unnecessary abstractions
- Keep functions small and focused
- Write readable and maintainable code

---

## Architecture

This project follows a modular monolith architecture.

Main flow:

```text
Frontend -> Backend -> Pipeline -> Filesystem / Tools
```

Do not break this flow.

For details, read:

- docs/ARCHITECTURE.md

---

## Backend Guidelines

- Do not put business logic inside controllers
- Use services for orchestration
- Use the pipeline for media processing logic
- Keep API layer thin
- Build resumable processing jobs for long-running tasks

More details:

- docs/AGENTS_BACKEND.md

---

## Frontend Guidelines

- Use React functional components
- Keep components small and reusable
- Separate UI from data fetching
- Use services for API calls

More details:

- docs/AGENTS_FRONTEND.md

---

## Pipeline Guidelines

- The pipeline is the core of the system
- Each step must have a single responsibility
- Steps must be composable and independent
- Avoid side effects when possible
- Keep steps resume-safe and idempotent when possible

More details:

- docs/AGENTS_PIPELINE.md

---

## What to Avoid

- Over-engineering
- Unnecessary patterns (no premature DDD)
- Large files with multiple responsibilities
- Tight coupling between modules

---

## When in doubt

- Choose the simplest solution
- Follow existing patterns in the codebase
- Prefer clarity over cleverness

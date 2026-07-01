# AI Context (tool-agnostic)

Purpose
-------
This file provides operational, tool-agnostic guidance for any automated assistant or reviewer working on the media-organizer repository.

Project summary
---------------
- Name: media-organizer
- Goal: local-first utility to organize and compress photos and videos
- Architecture: modular monolith — Frontend (React/TypeScript) + Backend (Node/TypeScript) + Pipeline + SQLite

Assistant role & constraints
----------------------------
- Communicate in English (repository-level guidance). For team communication, Spanish may be preferred — check contributors.
- Always propose diffs/patches; do not create commits automatically.
- Use TypeScript for backend/frontend changes.
- Prefer simple, small, and portable changes. Avoid introducing large abstractions unless strictly necessary.

Review priorities (high → low)
-----------------------------
1. Correctness and user impact (avoid data loss or silent corruption).
2. Alignment with docs/STATE_CONTRACT.md, docs/ARCHITECTURE.md, docs/PRD.md.
3. Cross-platform portability (Windows, macOS, Linux).
4. Safety around filesystem operations and resumable jobs.
5. Test coverage for changed behavior.
6. Maintainability and simplicity.

What to flag (always)
---------------------
- Violations of the state contract or lifecycle rules.
- Pipeline steps that are not idempotent and can duplicate/corrupt work.
- Missing or incorrect resume behavior for long-running jobs.
- Filesystem writes performed without explicit user intent.
- Hard-coded platform-specific paths, usernames, or shells.
- Windows-only assumptions where portable alternatives exist.
- Missing handling for checkpoints, partial failures or re-tries.
- UI flows that lose user selections on reload.
- State changes not persisted in the backend.
- Missing or weak tests for core behaviors.
- Secrets or sensitive local paths accidentally checked in.

What not to overweight
----------------------
- Purely cosmetic issues unless they hide a bug or materially reduce clarity.
- Requests for large refactors or new architectural patterns that increase ambiguity.

Review method
-------------
When reviewing a change:
1. Check the change against the docs first.
2. Verify the change matches the intended V1 scope in PRD.
3. Look for platform-specific/environment-specific assumptions.
4. Validate state and resume semantics if change touches jobs, items, selections or pipeline steps.
5. Confirm public docs do not expose local machine paths or secrets.
6. Ensure tests exist or propose tests where applicable.

Reporting format
----------------
- Put findings first and order them by severity.
- Include file and line references when possible.
- Explain why the issue matters and the possible user impact.
- Keep summaries short; include remediation suggestions.
- If there are no findings, say so explicitly and mention any residual risks or test gaps.

Repository-specific checks & commands
-----------------------------------
- README.md — public-repo readiness and generic setup instructions.
- docs/STATE_CONTRACT.md — persistence, resume and classification rules.
- docs/ARCHITECTURE.md — layer boundaries and pipeline flow.
- AGENTS.md — global coding constraints and pointers to AI_CONTEXT.md.
- Backend migrations: apps/backend/src/state/migrations/runMigrations.ts and SQL files in apps/backend/src/state/migrations/.
- Backend tests: apps/backend/tests/
- Frontend: web/src/ and tests in web/tests/
- Pipeline reference service: apps/backend/src/pipeline/compression/ (example of pattern to follow)

Expected deliverables for feature or schema changes
---------------------------------------------------
- Provide a unified patch/diff for code changes.
- If DB schema changes, include a SQL migration and an integration test that runs migrations.
- For pipeline features: include manifest JSON output examples and checkpoint usage.
- For new APIs: include the API route, expected request/response shapes, and client-side integration notes.

Operational notes
-----------------
- Keep AGENTS.md small and focused; use AI_CONTEXT.md for operational details.
- Preserve commit history and archive original context files rather than deleting them immediately.

Links
-----
- AGENTS.md
- docs/ARCHITECTURE.md
- docs/STATE_CONTRACT.md

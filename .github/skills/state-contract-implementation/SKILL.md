---
name: state-contract-implementation
description: "Use when implementing or updating resumable state, SQLite schema, migrations, DTOs, repositories, or APIs aligned with docs/STATE_CONTRACT.md. Trigger on keywords: state contract, sqlite migration, resume job, stage status, checkpoints, item decisions, media classification."
---

# State Contract Implementation

## Purpose

Implement state-related code in strict alignment with the repository contract in docs/STATE_CONTRACT.md.

This skill is focused on V1 local persistence and resumable jobs.

## Scope

Use this skill when the task includes one or more of these areas:
- SQLite schema and migrations for V1 state.
- TypeScript types and DTOs for state entities.
- Repository/service logic for jobs, items, decisions, stage status, and checkpoints.
- Resume-safe transitions and idempotency behavior.
- API endpoints that read or mutate state.

Do not use this skill for generic UI styling, unrelated refactors, or cloud integrations.

## Source Of Truth

Read and follow these files before writing code:
- docs/STATE_CONTRACT.md
- docs/ARCHITECTURE.md
- docs/PRD.md
- AGENTS.md
- docs/AGENTS_BACKEND.md
- docs/AGENTS_PIPELINE.md

If there is a conflict, prioritize docs/STATE_CONTRACT.md for state semantics and lifecycle.

## Required Contract Rules

Always preserve these guarantees:
- SQLite is the V1 source of truth for runtime state.
- Job lifecycle and transitions match the contract.
- Resume logic converts stale running work to resumable state.
- Per-file stage tracking exists for scan/classify/compress/organize.
- Stage operations are idempotent when possible.
- Classification supports detected and override values.
- Bulk selectors can update compression selection.

## Implementation Workflow

1. Analyze the requested change and map it to affected contract sections.
2. Update schema and migrations first when persistence changes are needed.
3. Update TypeScript types/DTOs to match schema exactly.
4. Update repositories/services with transition and resume rules.
5. Update API contracts for create/resume/list/update operations.
6. Add or update tests:
   - unit tests for transition and selection logic
   - integration tests for migration and persistence behavior
7. Re-check docs if any semantics changed.

## Validation Checklist

Before finishing, verify all items:
- Enums in code match contract values exactly.
- Unique constraints and foreign keys enforce expected relationships.
- Resume behavior is deterministic after restart.
- Completed work is not reprocessed unintentionally.
- Overrides take precedence over detected classification.
- Bulk selectors support all V1 required modes.
- No cloud or multi-user concerns are introduced in V1 code.

## Suggested Output Structure

When reporting results, include:
- What contract sections were implemented.
- Files added or modified.
- How resume and idempotency were validated.
- Remaining known gaps relative to contract.

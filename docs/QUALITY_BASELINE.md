# Quality Baseline V1

## Purpose

This document records the current quality posture for Media Organizer V1.

The goal is not to freeze development. The goal is to make the next changes safer by naming what is solid, what is risky and what should be improved in small branches.

---

## Current Baseline

Verified on 2026-05-21:

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test --workspace apps/web
```

Current automated coverage includes:

- SQLite migrations and legacy migration behavior.
- State DTO helper behavior.
- Compression session creation and per-item status persistence.
- Grouping workspace creation, assignment, deletion and apply behavior.
- Path traversal protections for grouping apply/delete flows.
- Dashboard execution history.
- HTTP integration coverage for localhost-only security checks.
- Native picker behavior and local-origin checks.
- Frontend route smoke coverage and i18n key parity.

This is a good baseline for a local MVP. The next improvements should strengthen HTTP/security contracts and reduce routing complexity without rewriting the application.

---

## Security Posture

V1 is a local-first, single-user application.

Assumptions:

- The backend is used from the same machine as the frontend.
- The app is not exposed to the internet.
- LAN access is not supported by default.
- Filesystem operations are sensitive because the app can read, copy, move and delete local files.

Implemented baseline:

- Local origins and Host headers are checked before serving API requests.
- CORS headers are centralized and do not use `*`.
- JSON request bodies are limited to 1 MiB.
- Native picker endpoints are restricted to localhost origins.
- Destructive maintenance endpoints require explicit confirmation tokens:
  - `CLEAR_DESTINATION`
  - `RESET_STATE`
- Clear-destination validation rejects missing confirmation, non-absolute destinations and source-as-destination.

Remaining security work:

- Review whether the backend should bind explicitly to localhost in all environments.
- Add a short threat-model section before supporting LAN access.
- Keep filesystem mutation tests close to the services that perform the writes.

---

## Dependency Audit

`npm audit --audit-level=moderate` currently reports a moderate advisory in the Vite development-server chain:

- `vite <= 6.4.1`
- transitive `esbuild <= 0.24.2`
- advisory: development server exposure issue

Do not run `npm audit fix --force` casually. The suggested fix upgrades Vite across a major version and should be handled in a dedicated branch with:

```powershell
npm.cmd install
npm.cmd run build
npm.cmd test
npm.cmd run test --workspace apps/web
```

After the upgrade, run the dashboard locally and verify the main views manually or with browser automation.

---

## Prioritized Roadmap

1. Keep the current tests green.
2. Continue extracting backend routes from `index.ts` by domain after each domain has tests.
3. Extract remaining grouping routes once the current route module pattern has settled.
4. Update Vite in a dedicated dependency branch.
5. Add more resume/idempotency tests for interrupted compression and grouping flows.
6. Expand security review when the app moves beyond localhost-only use.

---

## Refactor Policy

Avoid broad refactors during feature work.

Recommended sequence:

1. Add or improve tests for the behavior being touched.
2. Extract one narrow module or route group.
3. Keep public request/response shapes stable unless the change is explicitly planned.
4. Run build and both test suites.
5. Document any contract changes in this file or the relevant domain document.

Do not introduce a framework, shared package or generic pipeline abstraction unless it removes real complexity in the current codebase.

# AGENTS_BACKEND.md

## Backend Guidelines

### Structure

- api/ → HTTP endpoints
- services/ → business logic
- pipeline/ → pipeline orchestration

---

### Rules

- Controllers should only handle request/response
- Services contain business logic
- Do not access filesystem directly from controllers
- Use dependency injection when needed
- Persist resumable job state in V1
- Separate scan/preview logic from apply logic
- Design services so long-running jobs can pause and resume

---

### Example Flow

```text
Controller -> Service -> Pipeline -> Filesystem
```

### V1 State

- Use a minimal SQLite store for jobs, file status and user decisions
- Keep schema simple and focused on resume, not analytics
- Optionally emit JSON manifests for traceability

---

### Anti-patterns

- Fat controllers
- Logic duplicated across services
- Direct calls to external tools from API layer

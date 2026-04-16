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

---

### Example Flow

Controller → Service → Pipeline → Filesystem

---

### Anti-patterns

- Fat controllers
- Logic duplicated across services
- Direct calls to external tools from API layer

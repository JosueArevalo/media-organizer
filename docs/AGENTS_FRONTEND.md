# AGENTS_FRONTEND.md

## Frontend Guidelines

### Structure

```text
components/ -> reusable UI components
pages/ -> screens
services/ -> API calls
```

---

### Rules

- Use functional components
- Keep components small
- Avoid business logic inside UI
- Use services for backend communication
- Build a single dashboard with sections, not separate apps
- Keep preview and selection state in the frontend, but persist real processing state in the backend
- Add bulk actions for large datasets (select all/none, only large files, exclude WhatsApp/screenshots)
- Make resume state visible so users can continue interrupted sessions

---

### Anti-patterns

- Large components
- Mixing UI and logic
- Direct API calls inside components

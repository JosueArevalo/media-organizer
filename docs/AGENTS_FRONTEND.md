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
- Keep active compression controls in the Compression page; do not introduce a separate Sessions screen
- Make active compression state visible in the Compression page

### Internationalization

- Do not add new hardcoded visible UI copy in React components.
- Use `apps/web/src/i18n` translation keys for labels, buttons, headings, helper text, placeholders, prompts, and app-owned status messages.
- To add a language, create a locale dictionary file, register it in the i18n metadata, and keep the same key set as English.
- Keep technical values and dynamic data outside dictionaries when they are not UI copy, including executable names, paths, user-provided names, backend/tool errors, and HandBrake preset names.

---

### Anti-patterns

- Large components
- Mixing UI and logic
- Direct API calls inside components

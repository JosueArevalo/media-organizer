# AGENTS_PIPELINE.md

## Pipeline Guidelines

### Concept

The pipeline is the core of the system.

It processes media step by step.

---

### Rules

- Each step must do one thing
- Steps must be independent
- Steps must be composable
- Input/output must be clear

---

### Example Steps

```text
ImportStep
CompressImagesStep
CompressVideosStep
GroupByDateStep
OrganizeStep
```

---

### Anti-patterns

- Steps with multiple responsibilities
- Hidden side effects
- Tight coupling between steps

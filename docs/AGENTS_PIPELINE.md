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
- Separate preview steps from mutation steps
- Do not write to the filesystem during scan-only steps
- Track per-file checkpoints to support interruption and resume
- Keep step behavior idempotent when possible

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
- Mixing preview and apply behavior in the same step
- Steps that cannot be resumed safely after interruption

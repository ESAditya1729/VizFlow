# AGENTS.md

Guidance for AI coding agents working in this repository.

## Workflow authoring (`.vizflow` files)

Before generating, editing, or validating any VizFlow workflow JSON, read:

- `AI_CONTEXT.md` — the workflow-authoring spec (format, variables, control
  flow, sub-workflows, RBQL, validation rules, pitfalls, prompt templates).
- `docs/workflow-catalog.md` — auto-generated catalog of every activity `type`,
  its config fields, options and defaults (source of truth; do not guess).
- `docs/workflow-schema.json` — JSON Schema (draft-07) for `.vizflow` files.

Rules:

1. Never invent activity `type` names or config fields — look them up in the
   catalog. Unknown types and missing required config fail validation.
2. Every activity node needs a unique `id`.
3. After authoring, self-check against the validation rules and pitfalls in
   `AI_CONTEXT.md` (§11–§12).

## Keeping the AI docs in sync

`docs/workflow-catalog.md` and `docs/workflow-schema.json` are **generated**
from the live activity registry:

```
npm run gen:context
```

Whenever an activity is added, removed, or its `configRequirements` change, run
this and commit the regenerated files. A test (`test/workflow.test.js`) fails if
they drift from the registry.

## Commands

- `npm run lint` — ESLint (expect 0 errors).
- `npm test` — full suite via vscode-test.
- `npm run gen:context` — regenerate AI context artifacts.

# VizFlow Workflow Authoring Context (for AI models)

This document teaches an AI model how to **read, write, validate, and extend**
VizFlow workflow files (`.vizflow`). Use it together with the auto-generated
reference artifacts:

- **Activity catalog** → `docs/workflow-catalog.md`
  (every valid `type`, its config fields, required flags, options, defaults)
- **JSON Schema** → `docs/workflow-schema.json`
  (draft-07 schema validating `.vizflow` files; can be used by any JSON Schema validator)

> The catalog and schema are **generated from the live activity registry** by
> `scripts/generate-ai-context.js` (`npm run gen:context`). If an activity is
> added, the generated docs are regenerated and enforced by a test. Never trust
> prose over the catalog: the catalog is the source of truth for activity
> `type` names, config field names, and required fields.

---

## 1. What is a VizFlow workflow?

A VizFlow workflow is a **declarative JSON file** (`.vizflow`) that describes a
pipeline of steps. Each step is an **activity node**. Activities are executed
**in array order**, each receiving the previous step's dataset and returning the
next one. The **last activity's dataset is the workflow output**.

```
readExcel → query → multiTransform → writeText
```

## 2. Top-level file format

```json
{
  "name": "Find Highest Check Date",
  "version": "1.0.0",
  "description": "Optional",
  "parameters": [ /* optional workflow-level parameters (see §5) */ ],
  "activities": [ /* array of activity nodes, at least 1 (see §3) */ ]
}
```

Top-level keys (schema: `docs/workflow-schema.json`):

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `name` | string | no | Display name of the workflow |
| `version` | string | no | Workflow version |
| `description` | string | no | Free text |
| `parameters` | array | no | Workflow-level parameters, injected as variables |
| `activities` | array | **yes** | 1+ activity nodes; executed in order |

## 3. Activity node

```json
{
  "id": "step_1",
  "type": "readExcel",
  "config": {
    "filePath": "Input/report.xlsx",
    "sheetName": "Report1",
    "headerRow": 4,
    "startRow": 5,
    "dateDetection": true
  }
}
```

- **`id`** — non-empty string, **unique within the workflow and within every
  nested branch**. Pattern: `[a-zA-Z0-9_-]+`. Use readable ids like `step_1`,
  `step_read`, `step_write`.
- **`type`** — must be one of the types in `docs/workflow-catalog.md`. Unknown
  types fail validation.
- **`config`** — an object. Which fields are allowed/required is defined per
  activity in the catalog. **All top-level string config values may reference
  variables as `{{varName}}`** (see §4). Nested arrays (e.g. `forEachFile.steps`,
  `multiTransform.actions`) are left untouched.

## 4. Variables & interpolation

- Variables are name → value pairs stored on the execution context.
- Anywhere in a config, a **string value can contain `{{variableName}}`** and it
  is resolved at execution time. Example: `"filePath": "{{outputDir}}/result.csv"`.
- **Built-in variables** (set by the VS Code runner before execution):

  `workflowName`, `timestamp`, `workspaceRoot`, `date` (`YYYY-MM-DD`), `time`
  (`HH:MM:SS`), `year`, `month`, `day`, `hour`, `minute`, `second`.

- **`setVariable` activity** is the only way to create your own variables at
  runtime, except loop variables from control activities (see §6).
- **Exception:** the `setVariable` activity's `value` (static source) does **not**
  interpolate `{{...}}`. Use it literally or choose a different `sourceType`
  (`expression`, `variable`, `column`, `jsonPath`).

## 5. Workflow-level parameters

Reusable workflows can declare `parameters` so a caller can supply values:

```json
{
  "name": "Shift Dates Sub",
  "parameters": [
    { "name": "inputPath",  "label": "Input",  "type": "string", "required": true },
    { "name": "days",       "label": "Days",   "type": "number", "defaultValue": "0" }
  ],
  "activities": [
    { "id": "s1", "type": "readCsv", "config": { "filePath": "{{inputPath}}" } },
    { "id": "s2", "type": "transform", "config": { "column": "Check Date", "opKey": "addDays", "params": "{{days}}" } }
  ]
}
```

Rules:

- Each parameter needs a unique non-empty `name`; it becomes a variable `{{name}}`.
- `type`: `string` | `number` | `boolean` | `array` | `object` (default `string`).
- `required: true` means the parameter **must resolve to a non-empty value**;
  otherwise execution fails with
  `Missing required parameter "<name>" for workflow "<name>"`.
- `defaultValue` is applied when no value is provided. Defaults may contain
  `{{variable}}` placeholders and are **coerced** to the declared `type`
  (e.g. `"5"` with type `number` becomes `5`).

## 6. Control flow

### `forEachFile` — run inner steps per file in a folder

```json
{
  "id": "step_1",
  "type": "forEachFile",
  "config": {
    "folderPath": "Input",
    "fileFilter": "*PaymentSummary*.xlsx",
    "recursive": false,
    "maxFiles": 0,
    "continueOnError": false,
    "mergeResults": true,
    "steps": [
      { "id": "step_1a", "type": "readExcel", "config": { "filePath": "{{filePath}}", "headerRow": 4, "startRow": 5 } },
      { "id": "step_1b", "type": "query",     "config": { "query": "SELECT a4 AS HighestDate ORDER BY a4 DESC LIMIT 1" } }
    ]
  }
}
```

- `steps` is an array of activity nodes, run once per matching file.
- Loop variables available inside `steps`: `{{filePath}}`, `{{fileName}}`,
  `{{fileExtension}}`, `{{currentFile}}`.
- **`mergeResults: true`** merges each file's inner-output rows into one dataset.
  The merged dataset contains the **union of columns** from the inner outputs.
  ⚠️ If the inner output has a single column, it is column `a1` — NOT `a4`
  (see Pitfall 1).
- `mergeResults: false` (default): only the **last** file's dataset is kept.

### `forEach` — group rows and run inner steps per group

- `config`: `groupBy` (required), `sortGroups`, `maxGroups`, `continueOnError`,
  and nested `steps`.
- Inner config strings may use `{{row.Column}}`, resolved against a **sample row**
  of the group. Results are merged back in group order.

### `ifElse` — conditional branch

- `config`: `column` + `operator` (select) + optional `value`/`caseSensitive`,
  plus nested `thenSteps` and `elseSteps` (arrays of activity nodes).

### `multiTransform` — batch of transform operations

- `config`: `actions` (required array) + `stopOnError`.
- Each action: `{ "column": "...", "opKey": "...", "params": "...", "asNewColumn": false }`.
- Full operation list (with param hints) is in the catalog under
  `multiTransform` → `actions operations`. Date-relevant ops:

  | opKey | params | Behavior |
  |-------|--------|----------|
  | `parseDate` | none | Parse the column into date values |
  | `formatDate` | `YYYY-MM-DD`, `MM/DD/YYYY`, `YYYYMMDD`, … | Format dates |
  | `addDays` | integer days (negative = subtract) | Shift dates (local time, no UTC offset bug) |
  | `extractDatePart` | `year`/`month`/`day`/`hour`/`minute`/`second`/`weekday` | Extract a part |
  | `dateDiff` | `compareDate`, `unit` (`days/hours/weeks/months/years`) | Difference |
  | `formatTime` | `HH:mm`, `hh:mm A`, … | Format time-of-day |

### `setVariable`

- `config`: `variableName` (required), `sourceType` (required: `static`/`column`/
  `expression`/`variable`/`jsonPath`), plus the matching source field
  (`value`, `column`, `expression`, `sourceVariable`, `jsonPath`), optional
  `rowIndex` (default 0) and `defaultValue`.

### `wait`

- `config`: `duration` (seconds, required), optional `maxDuration`, `condition`.

## 7. Sub-workflows — `callWorkflow`

Run another `.vizflow` file and use its result:

```json
{
  "id": "step_call",
  "type": "callWorkflow",
  "config": {
    "workflowPath": "Examples/Shift_Dates_Sub.vizflow",
    "parameters": { "inputPath": "Input/data.csv", "outputPath": "Output/out.csv", "days": "-1" },
    "exportVariables": true,
    "outputMode": "passthrough"
  }
}
```

- `workflowPath` (required, file) — absolute or workspace-relative path; the
  file must exist, parse as JSON, and contain an `activities` array.
- `parameters` (keyValue) — values passed as the sub-workflow's initial
  variables. **Every key must be a declared parameter of the sub-workflow**
  (unknown keys fail with
  `Call Workflow activity: unknown parameter "<key>" for workflow "<sub>"`).
  Omitted parameters fall back to the sub-workflow's defaults/required checks.
- `exportVariables` (default `true`) — copy the sub-workflow's final variables
  back to the caller (built-in variables are not exported).
- `outputMode` — `passthrough` (default): the sub-workflow's **last dataset**
  becomes the `callWorkflow` output. `keepCaller`: keep the caller's dataset.
- Cycles are rejected: a workflow that (transitively) calls itself fails with
  `Call Workflow activity: circular workflow call detected (...)`.

## 8. RBQL queries

The `query` activity executes RBQL (a SQL-like dialect over datasets):

- Positional column refs: `a1` (first), `a2`, … — **1-based**.
- With a header row you can also use header names directly.
- `SELECT a4 AS HighestDate ORDER BY a4 DESC LIMIT 1` returns the max of column 4.
- `config`: `query` (required), `allowUpdate` (use `false` for reads),
  `timeoutMs`.
- After `forEachFile` + `mergeResults`, the merged dataset's columns are the
  **union** of inner outputs — reference them by their actual position.

## 9. Excel & dates

- `readExcel`: `headerRow` and `startRow` are **1-based** row numbers.
  `skipEmptyRows` skips fully empty rows; `skipFooterRows` trims footer rows.
  `dateFormat` controls the output format (e.g. `YYYY-MM-DD`).
- `dateDetection: true` converts Excel date **serials** (e.g. `46241`) into
  readable date strings based on `dateFormat`.
- Date ops (see §6) work on columns that have been `parseDate`d.
- `addDays` uses **local time**, so results are consistent across timezones
  (no UTC off-by-one).

## 10. Output activities

- `writeCsv`: `filePath` (required), `delimiter`, `header`, `overwrite`,
  `timestampSuffix`, etc. Passes its input dataset through unchanged.
- `writeText` / `appendText`: `filePath` + `content`
  (`dataset` | `variable` | `custom`).
  - `content: "custom"` uses `customText`, which supports `{{variable}}` **and**
    `{{row.ColumnName}}` (first row of the input dataset). Example:
    `"customText": "{{row.D2}}\t{{row.D1}}"` (use `\t` in JSON for a tab).
  - `content: "variable"` writes the value of `variableName`.
- Use forward slashes in file paths in configs (`Input/data.csv`).

## 11. Validation rules (generated workflows MUST pass)

The engine runs `validateWorkflow` before execution. A valid definition must:

1. Have `activities` as a **non-empty array**.
2. `parameters` (if present) must be an array of objects with non-empty unique
   `name` strings.
3. Every activity: valid `id` (unique), known `type`, `config` must be an
   object, and all **required config fields** must be present and non-empty.
4. Nested branches (`ifElse.thenSteps/elseSteps`, `forEach.steps`,
   `forEachFile.steps`) are validated recursively with the same rules, and may
   not reference top-level activities (cycle protection).
5. No duplicate activity ids anywhere.

After authoring, validate your JSON against `docs/workflow-schema.json` AND the
rules above, then check the required fields for each `type` in the catalog.

## 12. Pitfalls checklist

1. **`forEachFile` + `mergeResults`:** the merged dataset has the union of inner
   columns. A single-column inner output is `a1`, not the original file's
   column letter. Querying `a4` on a one-column merged dataset yields `null`.
2. **`readExcel` offsets:** `headerRow`/`startRow` are 1-based and count title
   rows above the header. Get them wrong and you read metadata as data.
3. **`addDays`:** accepts negative numbers; uses local time (no UTC shift).
4. **`writeText` custom content:** requires `"content": "custom"`; interpolates
   `{{row.Column}}` from the **first row only**; use `\t` for tabs in JSON.
5. **`callWorkflow`:** parameters must match the sub-workflow's declared
   parameters; cycles and missing required params are hard errors.
6. **`setVariable` static `value`:** does not interpolate `{{...}}`.
7. **Every activity needs a unique `id`** — the engine will not guess well for
   you in generated JSON.
8. **`transform`/`multiTransform` params:** pass `params` as a string (or array);
   check the op's `paramsHint` in the catalog.
9. **Merged results / passthrough:** write/append activities return their input
   dataset unchanged; do not re-query them expecting a transformed output.
10. **Regenerate docs after activity changes:** run `npm run gen:context`.
11. **XML namespaces:** treated as a literal part of the tag/attribute name
    (`ns:Order`), not resolved — see §15.
12. **XML DTDs:** `<!DOCTYPE ...>` is skipped, never expanded — no external
    entity resolution, so DTD-driven default attribute values etc. are not
    applied.
13. **`xmlTransform` is file→file:** it reads `inputFilePath` and writes
    `outputFilePath` itself; like other output activities it passes its input
    dataset through unchanged (or a small `{outputFilePath, fileSize}`
    dataset when run standalone with no upstream input).

## 13. Prompt templates

### Generate a workflow from a description

```
You are authoring a VizFlow workflow (.vizflow JSON).

Task: <describe the data processing goal>
Data source: <path / format / columns / date formats>
Expected output: <path and exact format>

Use ONLY activity types, config field names and options from
docs/workflow-catalog.md. Comply with the validation rules in AI_CONTEXT.md §11
and avoid the pitfalls in §12. Emit one complete JSON object with "name",
"version" and "activities". Then self-check: list each activity's required
config and confirm it is present.
```

### Add a step to an existing workflow

```
Here is an existing VizFlow workflow:
<JSON>
Insert a <activity> after step "<id>" that <purpose>. Keep the existing ids,
preserve semantics, and follow AI_CONTEXT.md rules. Output the full updated JSON.
```

### Review a generated workflow

```
Review this VizFlow workflow JSON for correctness against docs/workflow-catalog.md
and AI_CONTEXT.md §11-§12. Report: unknown activity types, missing required
config, duplicate ids, invalid RBQL column refs, readExcel offset mistakes, and
any pitfall from §12. Suggest a corrected JSON.
```

### Convert a manual/scripted flow to a workflow

```
I do the following manually in Excel/PowerShell: <steps>
Convert it to a VizFlow workflow using the available activities. Prefer
forEachFile+mergeResults for batch files, readExcel dateDetection for dates,
multiTransform for date math, and writeText custom content for reports.
```

### Explain a workflow

```
Explain this VizFlow workflow step by step, including the dataset shape at each
step and what the final output is:
<JSON>
```

## 14. Workflow of AI-assisted authoring

1. Read `AI_CONTEXT.md` (this file) + `docs/workflow-catalog.md` + the schema.
2. Draft the workflow JSON per §2–§10.
3. Self-check against §11 (validation rules) and §12 (pitfalls).
4. Optionally validate programmatically: `node -e`
   `"const {validateWorkflow}=require('./engine/workflow/workflowEngine'); …"`
   or load the file in the Workflow Builder.
5. If activities changed, run `npm run gen:context` so the catalog/schema stay
   in sync (a test enforces this).

## 15. XML activities (`readXml` / `writeXml` / `xmlTransform`)

> **Status:** functional in the engine, but marked "Coming soon" and disabled
> in the Workflow Builder's activity palette pending a fuller release in v3
> (visual mapper UX needs more polish). Do not suggest adding these via the
> palette; a hand-authored `.vizflow` JSON using them still runs correctly.

Three activities bridge XML with the tabular `Dataset` model used everywhere
else, backed by a small dependency-free engine in `engine/xml/` (custom
parser/serializer/path resolver — no XML library, no DTD/external-entity
resolution, so XXE is not possible by construction).

- **`readXml`** (Input): `filePath`, `mode` (`auto` | `visual`, default
  `auto`), `recordPath` (auto mode — path to the repeating record element,
  e.g. `Orders/Order`), `mapping` (visual mode), `encoding`. Produces a
  `Dataset` — one row per record. Auto mode derives one column per direct
  child element/attribute of the record (attribute columns are named `@name`).
- **`writeXml`** (Output): `filePath`, `rootElement` (wrapping element name,
  default `Root`), `mapping` (required — a single element mapping describing
  how **one row** becomes one XML element), `overwrite`, `encoding`. Each
  input row is bound against its own column values (reachable by either the
  child-element path `ColumnName` or the attribute path `@ColumnName`) and
  wrapped as a child of `rootElement`. Passes its input dataset through
  unchanged, per the same convention as `writeCsv`/`writeText`.
- **`xmlTransform`** (Transformation): `inputFilePath`, `outputFilePath`,
  `mapping` (required — describes the full target tree, XSLT-like). Self
  contained: reads its own input file, writes its own output file. Passes its
  input dataset through unchanged (or a small `{outputFilePath, fileSize}`
  dataset if run with no upstream dataset).

### The `mapping` JSON schema (shared by all three, and by the Visual Mapper)

```jsonc
{
  "kind": "element",                          // "element" | "attribute" | "text" (default "element")
  "name": "Order",                            // omitted for kind:"text"
  "loop": { "path": "Orders/Order", "as": "order" },  // optional: repeat once per match
  "binding": { "path": "@id", "op": "upper", "opParams": [] }, // optional
  "expression": "{{id}} - {{status}}",        // optional formula bar, {{name}} refs sibling fields / loop alias
  "static": "N/A",                            // optional literal fallback
  "condition": { "path": "Status", "operator": "!=", "value": "cancelled" },
  "children": [ /* same shape, nested */ ]
}
```

- Path syntax (`engine/xml/xmlPath.js`) is a tiny "path-lite", not real XPath:
  `Name`, `Name[n]` (1-based), `@attr` (must be last segment), `.` (self).
- `binding.op`/`opParams` reuse the existing Transform operation catalog
  (`engine/expressions/operations.js`) as-is.
- `condition.operator` reuses the same vocabulary as the `ifElse` control
  activity: `== != > >= < <= contains startsWith endsWith isEmpty isNotEmpty
  regex`.
- `expression` runs through `engine/expressions/safeEval.js`: `{{token}}`
  placeholders are interpolated first; the result is evaluated as arithmetic
  only if it is provably restricted to `+ - * / % ( ) .` and digits — anything
  else (e.g. `"1 - ok"`) is returned as the literal interpolated string, so
  `{{id}}-{{status}}` concatenates rather than throwing.
- Fields in a `children` array see earlier siblings' already-computed values
  by name in their own `expression`, evaluated in declared order.

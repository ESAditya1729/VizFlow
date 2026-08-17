# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- **Visual Workflow Builder**: drag-and-drop pipeline editor with 28+ activity types across 7 categories (Input, Transformation, Query, Analytics, Output, Control, PowerShell) — chain CSV reads, transforms, RBQL queries, charts, and file writes into repeatable `.vizflow` workflows.
- **Workflow Scheduler**: schedule `.vizflow` workflows on a **cron schedule** or as a **one-time run** with built-in variables (`{{timestamp}}`, `{{date}}`, `{{time}}`, `{{workflowName}}`), timezone support, watch-folder triggers, and webhook/email notifications. Jobs auto-start with the extension and persist across restarts.
- **External Data Sources**: connect to **MongoDB**, **MySQL**, and **PostgreSQL** from the Data Sources panel; credentials stored in OS keychain via VS Code SecretStorage; visual query builder with column selection, filters, sort, and preview; "Add to Workflow Builder" generates ready-to-run activities.
- **HTTP/REST Integration**: new `httpRequest` activity calls any REST API — GET / POST / PUT / PATCH / DELETE — with custom headers, query params, JSON/text/form bodies, timeouts, and `responsePath` for navigating nested response payloads.
- **Reusable Sub-Workflows**: `callWorkflow` activity runs another `.vizflow` file, passing parameters and receiving its output dataset and variables back (circular-call detection, max depth guard of 10).
- **Workflow Parameters**: workflows can declare typed parameters (`string`, `number`, `boolean`) with defaults, type coercion, and required-value validation; config values interpolate `{{paramName}}`.
- **AI Workflow-Authoring Context**: `AI_CONTEXT.md` spec + `AGENTS.md` so AI models can author `.vizflow` JSON accurately.
- **Auto-Generated AI Artifacts**: `npm run gen:context` regenerates `docs/workflow-catalog.md` and `docs/workflow-schema.json` from the live activity registry; drift-guard test enforces sync.
- **Workflow Builder User Guide** (`docs/workflow-builder-guide.md`): all 33 activity types, variables & interpolation, control flow, data sources, scheduling, sub-workflows, 10 real-world use cases, troubleshooting, and best practices.
- Multi-Transform date operations: `parseDate`, `formatDate`, `addDays`, `extractDatePart`, `dateDiff`, `formatTime`.
- For-Each File `mergeResults`: accumulate each file's inner output rows into a single merged dataset.
- Write Text / Append Text row interpolation: `customText` supports `{{row.Column}}` using the first row of the input dataset.
- Key/Value config editor in the Workflow Builder for object fields, plus a Workflow Parameters modal.
- Example workflows: `Examples/Shift_Dates_Sub.vizflow` and `Examples/Use_Shift_Dates.vizflow`.
- DuckDB-compatible SQL export generator.
- RBQL WebView: display mapping between positional column names and original header names.
- Read-only database user recommendation in the Data Sources connection form.

### Changed
- Scheduler panel redesigned with interactive schedule builder (Once / Hourly / Daily / Weekly / Monthly / Custom presets), live human-readable description, timezone-aware next-run preview, search filter, and responsive card grid.
- `retryCount: 0` and `retryDelay: 0` on scheduler jobs now genuinely disable retries.
- RBQL results display now shows `Header (aN)` for easier positional column reference.
- SQL table selection now auto-previews the first rows in the Data Sources panel.
- MongoDB row counts use `estimatedDocumentCount()` when no filter is applied — dramatically faster on large collections.
- Workflow Builder renders object-typed config fields as JSON editors with live validation.
- `readExcel` `dateDetection` now defaults to on, converting date-column serials to readable date strings.

### Fixed
- **`ifElse` with `regex` operator threw "Unsupported operator"**: `VALID_OPERATORS` was missing `'regex'`.
- **MongoDB SRV DNS resilience**: TXT record lookup failures no longer kill the entire SRV resolution; `isDnsError` recognizes DoH error messages; `dohResolve` checks HTTP status codes.
- **MySQL connection strings were silently ignored**: mysql2 requires the `uri` option, not `connectionString`.
- **SQL columns rendered `[object Object]`** in the Data Sources panel.
- **SQL "Order by" broke on `col:desc` syntax**; now compiles to `name DESC` consistently.
- **"Add to Workflow" dropped the Mongo advanced filter**; now carried into the generated activity.
- **`readSql` failed silently on malformed `filterModel`**; now throws a clear error.
- Scheduler panel: invalid timezone crashed silently; now validates and shows clear errors.
- Scheduler: editing a job no longer drops Max Retries / Retry Delay values.
- Scheduler: "Run Now" now uses a proper in-webview modal instead of blocked `prompt()`.
- Scheduler auto-starts on activation (previously required opening the panel first).
- Scheduler: relative path jobs resolved correctly when run from a different base.
- Workflow Builder: `forEachFile` inner steps are now editable (previously the nested branch wasn't rendered).
- `readExcel` blank-row removal shifted row indices; header/data row offsets now stay correct.
- `parseDate` now parses numeric values as Excel date serials (not milliseconds).
- `addDays` fixed local-time arithmetic shifting results by a day in positive-offset timezones.
- `listFiles` / `forEachFile` header parsing stripped stray trailing quote from PowerShell CRLF output.
- ActivationEvents properly register onLanguage/onCommand triggers.

## [0.0.1] - 2026-08-10

### Added
- **CSV / TSV Analysis**: open any delimiter-separated file (comma, tab, semicolon, pipe, or custom) directly in VS Code with automatic delimiter detection.
- **Dataset Profiling Dashboard**: column types, null counts, distinct values, top values, min/max/avg — full dataset summary at a glance.
- **Interactive Charts**: bar charts, line charts, scatter plots, and pie charts with live mapping and instant updates; export charts as PNG images.
- **RBQL Query Console**: write SQL-like queries against your dataset using positional references (`a1`, `a2`, ...) or column header names; syntax highlighting for reserved keywords; history tracking for reproducible analysis.
- **CSV File Comparison**: value-based set comparison across two files to identify differences and overlaps.
- **Transform Column**: 40+ built-in operations (trim, uppercase, parseInt, multiply, substring, replace, date formatting, coalesce, and more) with preview-before-apply.
- **Data Quality Helpers**: find duplicates, list distinct values for any column.
- **Exports**: CSV / JSON export; DuckDB-compatible SQL with `{{INPUT_PATH}}` / `{{OUTPUT_PATH}}` placeholders.
- **About Panel**: extension author info with GitHub and LinkedIn links.


---

How to release
1. Move changes from `Unreleased` to a new version heading (e.g., `## [0.0.2] - 2026-08-15`).
2. Update `package.json` version.
3. Tag the release: `git tag -a v0.0.2 -m "Release v0.0.2"` and push tags.
4. Update this CHANGELOG.md with details of the release.
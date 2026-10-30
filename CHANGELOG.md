# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- **CSV comparison rows mode**: compare records by one or more key columns and report added / removed / changed / unchanged rows, composite keys, duplicate-key counts, and per-column changes.
- **CSV comparison normalization + input controls**: trim, case-insensitive, empty-as-null, numeric and date equivalence, plus encoding (auto BOM / UTF-8 / UTF-16LE / UTF-16BE / Latin-1) and delimiter overrides.
- **CSV comparison exports**: CSV/JSON/Markdown reports with metadata, source-row links, and remembered comparison configuration.
- **RBQL persistent history**: workspace-backed history with timestamp, source file, duration, row count, success state, per-item delete, and clear-all.
- **RBQL export options**: clipboard copy, Markdown export, and shared serializers with correct CSV quoting for commas, quotes, and newlines.
- **RBQL cancellation and timing**: run IDs ignore late results after Cancel, and each run shows elapsed time.
- **Independent RBQL join-header option**: join files can declare their own header state independently of the primary CSV.
- **`writeExcel` activity** (Output): writes the current dataset to a local `.xlsx` file — sheet name, date formatting, overwrite, and timestamp-suffix options, mirroring `writeCsv`/`writeJson`.
- **`joinDatasets` activity** (Transformation): joins the current pipeline dataset with a second CSV or JSON file on a key column (`inner` / `left` / `right` / `full`), with configurable column-name collision prefixing — a local VLOOKUP/Power-Query-style merge that needs no second pipeline branch.
- **`listFiles` activity** (Input): lists files in a folder using a native, cross-platform `services/fileLister.js` implementation — glob filters, recursive search, folder exclusion, and optional file metadata (`Length` / `LastWriteTime`). No longer requires PowerShell.
- **Shared activity helpers** (`engine/workflow/activities/shared.js`): single source of truth for `validateConfig`, `validateFile`, `ensureDirectory`, `checkFileWritable`, and `generateTimestampedFilename`, replacing per-module copies across every activity file.
- **`pivot` activity** (Transformation): spreads distinct values of a column into new columns and aggregates the cells (`sum` / `avg` / `min` / `max` / `count`), with a `maxPivotValues` guard — a full Excel-style pivot table with no second pipeline branch.
- **`mergeColumns` activity** (Transformation): concatenates two or more columns into a new column with a configurable delimiter, optionally dropping the originals.
- **`fuzzyDeduplicate` activity** (Transformation): clusters near-duplicate rows by normalized Levenshtein similarity (configurable threshold, case sensitivity); either annotates clusters (`__match_group`, `__duplicate_of`, optional `__similarity`) or keeps one representative per cluster.
- **`jsonTransform` activity** (Transformation): flattens a column of JSON strings into new columns — nested objects become dotted columns (`meta_user.name`), arrays are kept as JSON strings, and unparseable rows can pass through unchanged via `skipErrors`.
- **`validateData` activity** (Analytics): runs configurable quality rules (`notNull`, `notEmpty`, `numeric`, `integer`, `email`, `pattern`, `min`, `max`, `in`, `unique`) with either `annotate` output (`__validation_status` / `__validation_errors`) or `filterInvalid` mode.
- **`soapRequest` activity** (Integration): calls a SOAP web service — SOAP 1.1 / 1.2 envelopes, operation/namespace wrapping, `SOAPAction` handling, basic/bearer auth — and returns the raw XML response as a dataset row.

### Changed
- **RBQL templates rewritten**: replaced misleading examples with verified filter, aggregate, join, dedupe, update, and preview queries; renamed labels to describe what each query actually does.
- **RBQL `UPDATE` clarity**: the Query Console now states that UPDATE queries preview changed rows only and never modify source files.
- **RBQL join parsing**: join files use their own header state, with positional aliases used when the primary and join files disagree.
- **`forEachFile` activity**: now enumerates files via native `services/fileLister.js` instead of invoking PowerShell, so file loops work identically on Windows, macOS, and Linux.

### Fixed
- **RBQL CSV export corrupted rows**: exports now use `Papa.unparse`, so values containing commas, quotes, or newlines are quoted correctly. JSON export is consistent and Markdown/clipboard export was added.
- **RBQL join autocomplete leaked columns**: removing a join file now removes its `b1`, `b2`, ... suggestions instead of leaving stale entries behind.
- **RBQL query validation rejected leading comments**: `-- comment` lines before SELECT/UPDATE now validate correctly.
- **CSV comparison reopened with stale File A**: re-running Compare CSV now refreshes File A (and its URI) from the active editor instead of comparing against an outdated dataset.
- **CSV comparison keyed rows used A's key names for B-only rows**: added rows now display using the B-side key columns.
- **Powershell / file-system activities not registered**: `getPowerShellActivities()` in `activityRegistry.js` filtered by a non-existent `'powerShell'` category, so `execPowerShell` / `forEachFile` never appeared in the registry. It now reads the loaded activities directly.
- **Remove dead `Dataset.getStatistics()`**: leftover commented-out method removed from `engine/dataset.js`.
- **Config blank-value validation**: all activities now share the strictest `validateConfig` behavior (blank / whitespace-only values rejected) consistently across every activity module.

### Removed
- **`VizFlow: Transform Column` CLI command**: removed; the visual Transform Studio covers the same operations.
- **`VizFlow: Show Column Statistics` command**: removed; the Dataset Summary Dashboard covers column statistics.
- **`vsc-extension-quickstart.md`**: removed default scaffolding.
- **PowerShell-only `listFiles` implementation**: the OS-specific PowerShell listing logic and the unused `parseCSVLine` helper were removed from `powerShellActivities.js` in favor of the native cross-platform service.

### Fixed
- **Transform Column (Visual) operations dropdown**: the WebView's operation list and dynamic parameter fields were reading a stale data shape (`op.label` / `op.params`) from the operations catalogue, leaving the dropdown blank and parameter inputs broken for any operation with arguments. The WebView now consumes the same `description` / `paramDefs` shape as the CLI command.

### Removed
- **Standalone `Sum` / `Average` / `Min` / `Max` / `Count` commands**: removed from the Command Palette (`vizflow.sum`, `vizflow.average`, `vizflow.min`, `vizflow.max`, `vizflow.count`) as redundant with the Workflow Builder's **Aggregate** and **Group By** activities, which cover the same operations as a reusable, repeatable pipeline step. **Find Duplicate Values** and **Show Distinct Values** are unaffected and remain available.
- **Standalone `Quick Schedule Workflow` / `Stop Running Job` / `Show Running Jobs` commands**: removed from the Command Palette (`vizflow.scheduler.quickSchedule`, `vizflow.scheduler.stopJob`, `vizflow.scheduler.showRunning`) — these were `QuickPick`-based shortcuts into functionality the **Workflow Scheduler** panel already covers in its Jobs tab (add, run now, pause/resume, stop, delete) and History tab. `VizFlow: Workflow Scheduler` is now the single entry point; the Workflow Builder's ⏰ Schedule button continues to open it pre-filled with the current file.

## [0.0.2] - 2026-08-24

### Added
- **RBQL JOIN support**: load a second CSV as a join table directly in the RBQL Query Console; use `b1`, `b2`, ... for join columns with `INNER JOIN` / `LEFT JOIN` / `STRICT LEFT JOIN` syntax.
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
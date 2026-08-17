# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.0.2] - 2026-08-15

### Added
- **HTTP/REST integration**: new `httpRequest` activity (new **Integration** category) calls any REST API — GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS — with custom headers, query params, JSON / text / form bodies, timeouts and a `responsePath` for navigating into nested response payloads. The JSON response becomes a Dataset like any other data source, and the status is exposed as `{{httpRequest.status}}` for downstream branching (`ignoreErrorStatus` keeps non-2xx responses as data instead of failing the run).
- Read-only database user recommendation shown in the Data Sources connection form.
- Regression tests for the database connector fixes and the new HTTP activity (`test/http.test.js`).

### Changed
- SQL table selection now auto-previews the first rows in the Data Sources panel (previously only MongoDB did).
- MongoDB row counts now use `estimatedDocumentCount()` when no filter is applied — dramatically faster on large collections.
- Workflow Builder now renders object-typed config fields (e.g. `filterModel`) as a JSON editor with live validation instead of a plain text box.

### Fixed
- **MySQL connection strings were silently ignored**: mysql2 accepts a connection string via the `uri` option (not `connectionString`), so MySQL databases configured with a connection string could not connect. PostgreSQL continues to use `connectionString`.
- **SQL columns rendered `[object Object]`** in the Data Sources panel; `listColumns` now returns plain column names.
- **SQL "Order by" broke on the documented `col:desc` syntax**; `name:desc` now compiles to `name DESC` (raw expressions like `created_at DESC` still pass through), consistently in both the SQL builder and the `readSql` activity.
- **"Add to Workflow" dropped the Mongo advanced filter** (raw JSON filter document); it is now carried into the generated activity.
- **`readSql` failed silently on a malformed `filterModel`**; it now throws a clear error telling the user to build the filter in the Data Sources panel or enter valid JSON.

## [Unreleased]

### Added
- **AI workflow-authoring context**: `AI_CONTEXT.md` spec + `AGENTS.md` so AI models can author `.vizflow` JSON accurately.
- **Auto-generated AI artifacts**: `npm run gen:context` regenerates `docs/workflow-catalog.md` (every activity, its config fields, options, defaults) and `docs/workflow-schema.json` (JSON Schema) from the live activity registry — they auto-update when activities change, enforced by a drift-guard test.
- **Reusable sub-workflows**: new `callWorkflow` activity runs another `.vizflow` file, passing parameters and receiving its final dataset and variables back (with circular-call detection and a max call depth guard).
- **Workflow parameters**: workflows can declare `parameters` (name, label, type, required, default) that are resolved as variables with defaults, type coercion, and required-value validation. Config values throughout the engine now interpolate `{{paramName}}`.
- **For-Each File `mergeResults`**: accumulate each file's inner output rows into a single merged dataset.
- **Multi-Transform date operations**: `parseDate`, `formatDate`, `addDays`, `extractDatePart`, `dateDiff`, `formatTime` are now available as Multi-Transform actions.
- **Write Text / Append Text row interpolation**: `customText` supports `{{row.Column}}` using the first row of the input dataset.
- **Key/Value config editor** in the Workflow Builder for object fields, plus a **Workflow Parameters** modal (🧩) for editing workflow-level parameters.
- **Validation for `forEachFile`** nested steps (same checks as `forEach`).
- Example workflows: `Examples/Shift_Dates_Sub.vizflow` (reusable sub-workflow) and `Examples/Use_Shift_Dates.vizflow` (caller demonstrating `callWorkflow`).
- DuckDB-compatible SQL export generator (produces .sql with {{INPUT_PATH}} / {{OUTPUT_PATH}} placeholders).
- RBQL WebView: display mapping between positional column names (a1, a2, ...) and original header names.
- Export action for DuckDB SQL in RBQL console.
- Cleaner, marketplace-ready README and a dedicated ARCHITECTURE.md.
- About panel UI refresh with updated GitHub and LinkedIn links.
- Activation events in package.json to activate on CSV/TSV language and on VizFlow commands.
- **Scheduler rewrite** (`engine/scheduler/schedulerEngine.js`): scheduled runs now inject built-in variables (`{{workflowName}}`, `{{timestamp}}`, `{{date}}`, `{{time}}`, `{{year}}` … `{{second}}`, `{{workspaceRoot}}`) plus each job's declared `parameters`, so parameter values with quotes, backslashes or braces no longer corrupt the workflow (old whole-JSON string interpolation is gone).
- **Persistent, global scheduler storage** (`engine/scheduler/schedulerStore.js`): jobs and history now live in one JSON file under the user's global storage instead of the extension install folder, so schedules survive updates and installs. An existing `extensionPath/scheduler-config.json` is auto-migrated on first load.
- **Scheduler auto-start**: the scheduler initializes on extension activation and shuts down cleanly on deactivation, so scheduled jobs run even if the Scheduler panel was never opened.
- **One-time jobs**: schedule a job to run once at a future date/time (rejects past dates; expired one-time jobs are pruned on load).
- **Timezone support**: each job can set an IANA timezone applied to its cron schedule and next-run calculation.
- **Watch-folder hardening**: folder watching now triggers only on newly created files, supports a `fileFilter` (e.g. `*.csv`), debounces bursts, is reference-counted across jobs, and is released when the last job is removed. Files the job itself writes during a run can no longer re-trigger it.
- **`nextRun` refresh**: the next-run time is recomputed after every execution (and on resume), so the Scheduler panel always shows the correct upcoming time.
- **Edit scheduled jobs**: the Scheduler panel can edit an existing job in place (schedule, timezone, workflow, watch folder, parameters, notifications) instead of delete-and-recreate.
- **New Scheduler fields**: Timezone, Watch File Filter, and Webhook Notification per job; history now shows past runs in the panel (Refresh History was fixed to actually reload).

### Changed
- Scheduler panel redesigned: the add-job form now fills the whole page as structured cards, with an interactive **schedule builder** (Once / Every Minute / Hourly / Daily / Weekly / Monthly / Custom presets, day-of-week chips, native date & time pickers) that shows a live human-readable description, the generated cron expression, and a timezone-aware **next-run preview** instead of requiring raw cron input. Timezone is now a searchable picker with a live offset hint; stat cards are clickable, a live clock sits in the header, and the Jobs tab gained a search filter and a responsive card grid.
- `retryCount: 0` and `retryDelay: 0` on a job now genuinely disable retries (previously `0` fell back to the defaults of 3 retries / 60 s, which could stall the queue for minutes on a failing job).
- RBQL results display now shows `Header (aN)` where possible so users can easily reference positional columns.
- README trimmed for Marketplace; architecture details moved to ARCHITECTURE.md.
- `readExcel` `dateDetection` now defaults to on, converting date-column serials to readable date strings.

### Fixed
- Scheduler panel: saving a job with a timezone that isn't a valid IANA zone crashed the webview silently (an uncaught `Intl` RangeError) so Update/Schedule appeared to do nothing; it now validates the timezone and shows a clear error. Unexpected webview errors are also surfaced in the status bar instead of failing silently.
- Editing a job no longer drops its **Max Retries / Retry Delay** values (they weren't included in the edit payload) and now properly clears the one-time flags when a one-time job is converted to a recurring schedule (previously it kept self-removing after each run).
- Scheduler panel: "Run Now" used a JS `prompt()` that VS Code blocks; one-time scheduling now uses a proper in-webview modal.
- Scheduler did not start until the panel was opened; scheduler now auto-starts on activation.
- Jobs created relative to a workspace path broke when run later from a different base; each job records the base directory it was created from and resolves relative paths against it.
- Workflow Builder webview could not edit `forEachFile` inner steps (the nested "DO (per file)" branch was not rendered), so queries inside file loops couldn't be authored. `forEachFile` is now a first-class block like `forEach`/`ifElse` (config, add/remove/move steps, serialization and validation all recurse into its `steps`).
- `readExcel` blank-row removal shifted row indices; the header/data row offsets now stay correct.
- `parseDate` treated numeric values as milliseconds since epoch; they are now parsed as Excel date serials.
- `addDays` mixed local-time arithmetic with UTC formatting, shifting results by a day in positive-offset timezones.
- `listFiles` / `forEachFile` header parsing stripped a stray trailing quote caused by PowerShell CRLF output.
- ActivationEvents were empty; now properly register onLanguage/onCommand triggers to ensure activation.

## [0.0.1] - YYYY-MM-DD

- Initial public release notes placeholder.


---

How to release
1. Move changes from `Unreleased` to a new version heading (e.g., `## [0.0.1] - 2026-08-09`).
2. Update `package.json` version.
3. Tag the release: `git tag -a v0.0.1 -m "Release v0.0.1"` and push tags.
4. Update this CHANGELOG.md with details of the release.
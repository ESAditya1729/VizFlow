# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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

### Changed
- RBQL results display now shows `Header (aN)` where possible so users can easily reference positional columns.
- README trimmed for Marketplace; architecture details moved to ARCHITECTURE.md.
- `readExcel` `dateDetection` now defaults to on, converting date-column serials to readable date strings.

### Fixed
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
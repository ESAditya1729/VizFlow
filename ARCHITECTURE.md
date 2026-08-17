# VizFlow — Architecture & Implementation

This file complements the top-level README with implementation details, file layout, and developer notes.

Overview
--------
VizFlow is organized to keep UI/host code (commands and WebViews) separate from the data/engine logic and platform adapters.

High-level modules
- extension.js — VS Code extension entry point; registers commands and activation behavior.
- commands/ — command hosts that produce UI (WebViews) or run quick actions via the Output channel.
- media/ — static WebView assets (HTML/CSS/JS) used by panels (Transform, RBQL, Charts, Dashboard).
- engine/ — core dataset model and pure data logic (aggregations, duplication detection, transformations).
- services/ — adapters and utilities (CSV parsing, reading from active editor, RBQL wrapper, output helpers).
- services/database/ — external data-source adapters (MongoDB / MySQL / PostgreSQL): connection manager, read-only drivers, and the visual filter → SQL/Mongo query builders.

Directory layout
```
vizflow/
├── extension.js               # Entry point — registers commands
├── commands/                  # Command entry scripts (host WebViews or run quick actions)
├── engine/                    # Pure data logic: dataset model, aggregations, profiler, transformations
├── services/                  # CSV parsing, RBQL wrapper, compare engine, output helpers
└── media/                     # WebView HTML/CSS/JS assets
```

Key components
- Dataset model (engine/dataset.js)
  - Lightweight wrapper around rows and column metadata. Exposes profiling, aggregation and transform entry points.

- Parser (services/csvParser.js)
  - Uses PapaParse for robust CSV parsing and type inference.
  - Contains a delimiter detector and should be the single place to add streaming/sample-based parsing.

- RBQL service (services/rbqlService.js)
  - Wraps the rbql library to execute RBQL queries on an array-of-arrays input.
  - Exports executeQuery, validateQuery and formatResult.
  - This is a sensible place to add an alternate backend (DuckDB / DuckDB-WASM) as a pluggable option.

- WebViews (media/*.html)
  - Communicate with the extension host via `postMessage`.
  - Keep heavy work on the host side—WebViews should render and provide UI only.
  - Use `panel.webview.asWebviewUri()` for local resources and a nonce-based CSP for security.

External data sources (services/database/, commands/dataSources.js)
- Connection model: each connection has a friendly `name` + type-specific config. Passwords / connection strings go into VS Code **SecretStorage** keyed by the connection id; workflow `.vizflow` files and the Data Sources panel only ever see the redacted profile. Editing a connection without typing a new password preserves the stored secret.
- Drivers are wrapped by two read-only services:
  - `mongoService.js` — MongoDB via the `mongodb` driver (`listDatabases`, `listCollections`, `listColumns`, `runQuery` with projection/filter/sort/limit).
  - `sqlService.js` — MySQL/PostgreSQL via `mysql2` / `pg` (identical `list*` API, `runSelect` applies limit separately). `validateSelect` rejects anything that is not a `SELECT` / `WITH` statement.
- Query builders turn the visual filter model into dialect-specific statements:
  - `mongoFilterBuilder.js` — condition objects (`eq`, `contains`, `gt`, `between`, `null`, …) → Mongo filter document with value coercion (`'42'` → 42, `'true'` → true).
  - `sqlQueryBuilder.js` — same condition model → parameterized SQL with MySQL backticks + `?` or PostgreSQL double quotes + `$n`. Filter values stay as strings in the params array.
- The Data Sources panel (`commands/dataSources.js` + `media/datasources.*`) is a classic WebView host: host-side only answers `listDatabases` / `listCollections` / `listTables` / `listColumns` / `preview` / `query`; **secrets are never posted to the webview**. "Add to Workflow Builder" writes a generated `.vizflow` to `os.tmpdir()/vizflow-datasources/` and opens it.
- Workflow integration: the registry seeds connection names into `connection`-typed config fields via `enhanceActivitiesWithDynamicOptions`, and the builder resolves database/table/column choices dynamically (`dynamic: mongodbDatabases | mongodbCollections | sqlTables | sqlColumns`, `dependsOn` chaining, `requestId` echo). Activities `readMongo`, `readSql` (Input category) and `mongoQuery`, `sqlQuery` (Query category) execute at run time with the resolved secret.
- HTTP / REST integration (`engine/workflow/activities/httpActivities.js`, **Integration** category): the `httpRequest` activity calls a web API via `axios` (a regular dependency) and converts the JSON response into a Dataset. Top-level string config values (`url`, `headers`, `queryParams`, `body`) are `{{variable}}`-interpolated by the workflow engine before `execute`, so earlier steps can feed URLs and bodies. A `responsePath` (dot path like `data.items`) navigates into nested payloads; the response status is written to the `httpRequest` context variable for downstream branching. Activity registration requires the category to exist in `VALID_CATEGORIES` (`engine/workflow/activityRegistryCore.js`), and the WebView category chips live in `CAT` / `CAT_ORDER` in `media/workflow.js`.

Design notes & recommendations
- Large files
  - Add a "sample-first" parse mode: parse first N rows for previews and use streaming or DuckDB-backed queries for full operations.
  - WebView result panels should accept paged or truncated payloads (send first K rows and a total count).

- Pluggable SQL backend
  - Create a small adapter interface (executeQuery, explainQuery) and implement both RBQL and DuckDB adapters.
  - DuckDB adapter should accept a CSV path and run SQL directly without full in-memory conversion.

- Reproducibility
  - Persist transformations and RBQL queries as a small JSON "analysis recipe" which records source file path, transforms, and chart specs.
  - Recipes should reference files by path (not embed data) so they can be committed to git.

- Testing
  - Add unit tests for csvParser edge cases and rbqlService error conditions.
  - Add small integration tests that run the extension host (vscode-test) against representative sample CSVs.

- Security
  - WebViews must set restrictive CSP and avoid interpolating untrusted text into HTML. When including CSV samples, JSON-serialize the data and render safely.

Extending VizFlow
- To add a new transform operation:
  1. Implement the pure operation in `engine/expressions/operations.js` with metadata (label, params).
  2. Ensure the evaluator supports the operation signature.
  3. Add UI choices in `media/transform.html` to surface the new operation.

- To add a new export/dialect:
  1. Add a handler in `commands/rbql.js` or `services/rbqlService.js` to translate RBQL/AST into target SQL.
  2. Provide a small preview mode and a conservative fallback when translation is not possible.

- To add a new database type (e.g. SQLite / Oracle):
  1. Extend `CONNECTION_TYPES` in `services/database/connectionManager.js` and the profile validation.
  2. Implement the same `list*` / `runQuery`-style surface in a new service (mirror `sqlService.js`).
  3. Add a `queryBuilder` branch and any new placeholder style to `services/database/sqlQueryBuilder.js`.
  4. Surface it in `media/datasources.js` (type dropdown) and, if new dynamic fields are needed, register `dynamic` options in `commands/workflowBuilder.js`.
  5. Run `npm run gen:context` if activity configs change, then `npm test` (the drift-guard test fails if docs are stale).

Developer tips
- Use `output.clear()` / `output.writeLine()` helpers to make CLI-mode commands readable and copy-paste friendly.
- Keep WebView scripts isolated and test them in the browser first (DevTools available in the Extension Development Host).

Roadmap links
- For feature ideas and long-term roadmap, see the top-level README.
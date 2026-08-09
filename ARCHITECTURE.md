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

Developer tips
- Use `output.clear()` / `output.writeLine()` helpers to make CLI-mode commands readable and copy-paste friendly.
- Keep WebView scripts isolated and test them in the browser first (DevTools available in the Extension Development Host).

Roadmap links
- For feature ideas and long-term roadmap, see the top-level README.
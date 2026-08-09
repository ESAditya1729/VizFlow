# VizFlow

VizFlow is a lightweight, local-first Visual Studio Code extension for exploring, transforming, and visualizing CSV and TSV data without leaving your editor.

Why VizFlow
- Immediate dataset profiling and lightweight analytics inside VS Code
- Visual, repeatable transforms with preview before apply
- RBQL-powered SQL-like querying and easy exports (CSV / JSON / DuckDB SQL)
- Interactive charts and dataset dashboard for quick exploration

Core features
- Dataset profiling: column types, null counts, distinct values, top values
- Aggregations & statistics: sum, avg, min, max, count
- Data quality helpers: find duplicates, distinct value listings
- Visual Transformation Studio: build rule queues, preview first rows, apply & save
- RBQL Query Console: SQL-like queries (a1/a2 or header names), history, progress indicator
- Interactive Charts: bar, line, scatter, pie with live mapping
- CSV comparison: value-based set comparison across two files
- Exports: CSV / JSON and DuckDB-compatible SQL export with {{INPUT_PATH}} / {{OUTPUT_PATH}} placeholders

Quick start
1. Install VizFlow from the VS Code Marketplace or open the extension in dev mode (press F5).
2. Open a CSV/TSV file in the editor.
3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) and run any `VizFlow` command (e.g., `VizFlow: Dataset Summary Dashboard`).

Commands (high level)
- Aggregations: Sum / Average / Min / Max / Count
- Profiling & Data Quality: Show statistics, find duplicates, list distinct values
- Transformation: Transform Column (CLI) and Transform Column (Visual)
- Comparison: Compare CSV Files
- Analysis: Dataset Summary Dashboard, Interactive Charts
- RBQL Query Console: run RBQL queries, export results
- About / Creator: view extension author info

RBQL notes
- Use positional references `a1`, `a2`, ... or enable **Has Header Row** to use header names.
- Results can be exported to CSV, JSON, or a DuckDB SQL script (with placeholders) for reproducible runs.

Privacy & offline
VizFlow runs locally by default — parsing, transforms and queries are performed on your machine. Any cloud or AI features would be opt-in and clearly indicated.

Support & links
- GitHub: https://github.com/ESAditya1729/VizFlow.git
- Creator: Aditya Mukherjee (IBM)
- LinkedIn: https://www.linkedin.com/in/aditya-mukherjee-b15428239/

Architecture
Detailed architecture and implementation notes are kept in a separate document: [ARCHITECTURE.md](./ARCHITECTURE.md)

Installation
From Marketplace: Search **VizFlow** in the Extensions view and install.

From source:
```bash
git clone https://github.com/ESAditya1729/VizFlow.git
cd VizFlow
npm install
# Press F5 in VS Code to launch the Extension Development Host
```

Development
```bash
npm install
npm run lint
npm test
```

License
MIT — see [LICENSE](LICENSE)

---

Built with ❤️ by Aditya Mukherjee · IBM
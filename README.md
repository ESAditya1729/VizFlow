# VizFlow

> Created by **Aditya Mukherjee** · Application Developer — Azure Cloud FullStack · **IBM**  
> [aditya.mukherjee1@ibm.com](mailto:aditya.mukherjee1@ibm.com) · [github.ibm.com/Aditya-Mukherjee1/VizFlow](https://github.ibm.com/Aditya-Mukherjee1/VizFlow)

**VizFlow** is a Visual Studio Code extension for exploring, transforming, and visualizing CSV data — without ever leaving your editor.  
Open a CSV file, run a command from the Command Palette, and get instant results: aggregations, duplicate reports, column statistics, a full visual transformation studio, side-by-side CSV comparison, an interactive chart builder, a dataset summary dashboard, a full SQL-like RBQL query console, and more — all in one place.

<br>

## ✨ Features at a Glance

| Category | What you can do |
|---|---|
| **Aggregations** | Sum, Average, Min, Max, Count on any column |
| **Data Quality** | Find duplicate values with exact row locations |
| **Profiling** | Full column statistics (count, sum, avg, min, max, duplicates) |
| **Exploration** | List all distinct values in a column |
| **Transformation (CLI)** | Apply one operation to a column via Command Palette prompts |
| **Transformation (Visual)** | Multi-rule transformation studio in a side panel — preview, reorder, target specific rows, and save |
| **CSV Comparison** | Side-by-side column comparison across two files with match / only-A / only-B breakdown |
| **Dataset Dashboard** | At-a-glance summary of every column — types, nulls, distinct counts, and top values |
| **Interactive Charts** | Plot your CSV data as bar, line, pie, scatter, and more in a live chart panel |
| **RBQL Query Console** | Write and execute SQL-like RBQL queries against your CSV with syntax highlighting, query history, and CSV/JSON export |
| **About / Creator** | View creator info and project links directly inside VS Code |

<br>

## 🚀 Quick Start

1. Open any **CSV file** in VS Code.
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) to open the Command Palette.
3. Type **VizFlow** and choose any command.

All results appear in the dedicated **VizFlow Output** panel or a WebView panel depending on the command.

<br>

## 📋 Commands

### Aggregations

| Command | Description |
|---|---|
| `VizFlow: Sum Column` | Adds up all numeric values in the selected column |
| `VizFlow: Average Column` | Calculates the mean of all numeric values |
| `VizFlow: Minimum Value` | Finds the smallest value in a column |
| `VizFlow: Maximum Value` | Finds the largest value in a column |
| `VizFlow: Count Values` | Counts non-empty values in a column |

### Data Quality & Profiling

| Command | Description |
|---|---|
| `VizFlow: Find Duplicate Values` | Lists every duplicate value, its count, and the exact row numbers where it appears |
| `VizFlow: Show Column Statistics` | Shows count, sum, average, min, max, duplicate count, and duplicate row count in one shot |
| `VizFlow: Show Distinct Values` | Lists every unique value in the selected column along with the total distinct count |

### Transformation

| Command | Description |
|---|---|
| `VizFlow: Transform Column` | Command-line workflow — pick column → operation → parameters → preview 5 rows → apply to all |
| `VizFlow: Transform Column (Visual)` | Opens the **Visual Transformation Studio** as a side panel |

### Comparison

| Command | Description |
|---|---|
| `VizFlow: Compare CSV Files` | Select a column in the active CSV and compare it against a column in a second CSV file. Results are grouped into **common**, **only in File A**, and **only in File B** values, each with exact row numbers and column profiles |

### Visualization & Analysis

| Command | Description |
|---|---|
| `VizFlow: Dataset Summary Dashboard` | Opens a rich WebView dashboard with per-column type inference, null counts, distinct counts, and top-value charts |
| `VizFlow: Interactive Charts` | Opens a chart builder — choose chart type, X/Y axes, and render a live interactive chart from your CSV data |

### RBQL Query Console

| Command | Description |
|---|---|
| `VizFlow: RBQL Query Console` | Opens a full SQL-like query console powered by [RBQL](https://rbql.org/). Write queries with syntax highlighting, execute against your CSV, browse query history, and export results to CSV or JSON |

### General

| Command | Description |
|---|---|
| `VizFlow: About / Creator` | Opens a WebView panel with information about the extension creator |

<br>

## 🎨 Visual Transformation Studio

The **Visual Transformation Studio** (`VizFlow: Transform Column (Visual)`) opens a dedicated WebView panel beside your CSV file and lets you build, preview, and apply a queue of transformation rules.

### Workflow

```
Add a rule  →  Add more rules  →  Preview  →  Apply & Save
```

1. **Select a column** from the dropdown.
2. **Choose an operation** — grouped by Numeric, String, or Conditional.
3. **Fill in parameters** (inputs appear dynamically based on the chosen operation).
4. **Choose scope** — apply to *All rows* or *Selected rows only* (individual numbers or ranges like `5-8`).
5. Click **➕ Add Rule** — the rule appears as a numbered card in the queue.
6. Repeat steps 1–5 to add as many rules as needed. Reorder them with ↑ ↓, or remove with ✕.
7. Click **👁️ Preview (5 rows)** — see a before/after table for the first 5 rows, for every rule in sequence.
8. Click **✅ Apply & Save** — all rules are applied to the full dataset, results are written to the Output Channel, and a native **Save dialog** opens pre-filled with `<original-name>_transformed.csv`.

### Transformation Operations

#### Numeric
| Operation | Description |
|---|---|
| Add (+) | Adds a constant to every value |
| Subtract (−) | Subtracts a constant |
| Multiply (×) | Multiplies by a constant |
| Divide (÷) | Divides by a constant (guards against division by zero) |
| Power (^) | Raises every value to an exponent |
| Round | Rounds to N decimal places |
| Absolute Value | Removes the sign from every number |

#### String
| Operation | Description |
|---|---|
| UPPER CASE | Converts every value to upper case |
| lower case | Converts every value to lower case |
| Trim whitespace | Strips leading and trailing spaces |
| Concat (append) | Appends a fixed string to each value |
| Substring | Extracts characters from a start index, with optional length |
| Replace | Replaces every occurrence of a search string |
| Length (char count) | Replaces the value with its character count |
| Pad Start (left) | Left-pads to a target width with a chosen character |
| Pad End (right) | Right-pads to a target width with a chosen character |

#### Conditional
| Operation | Description |
|---|---|
| Coalesce (fallback) | Replaces blank or null values with a fallback |
| Starts With (check) | Returns `true`/`false` — does the value start with a prefix? |
| Ends With (check) | Returns `true`/`false` — does the value end with a suffix? |
| Contains (check) | Returns `true`/`false` — does the value contain a substring? |

### Targeted Row Transformation

Every rule in the queue can target **all rows** or a **subset of rows**:

- Select **Selected rows only** in the *Apply to* toggle.
- Enter row numbers or ranges in the **Row numbers** field — e.g. `1, 3, 5-8, 10`.
- Row 1 = first data row (header is not counted).
- Rows outside the selection are passed through unchanged. The preview table marks them as *(skipped)*.
- Rules with different scopes can be mixed in the same queue — e.g. uppercase column A for all rows, then multiply column B only for rows 5 and 10.

<br>

## 🔍 CSV Comparison

The **Compare CSV Files** command (`VizFlow: Compare CSV Files`) lets you pick one column from the currently open CSV and compare it against a column from any other CSV file on disk.

### How it works

1. Run `VizFlow: Compare CSV Files` with a CSV open in the editor.
2. Select the **column** to compare from the active file (File A).
3. Pick the **second CSV file** from a file-open dialog.
4. Select the **column** to compare from File B.
5. A **WebView panel** opens with a full side-by-side report:

| Section | What it shows |
|---|---|
| **Summary bar** | Total rows, match count, only-A count, only-B count |
| **Column profiles** | Distinct count, null count, inferred data type for each column |
| **Results table** | Every distinct value labelled `common`, `only A`, or `only B`, with row-number lists for both files |

The comparison is **value-based** (set logic) — row order and row count don't matter, only whether the value exists in each file's column.

<br>

## 🔎 RBQL Query Console

The **RBQL Query Console** (`VizFlow: RBQL Query Console`) brings a full SQL-like query experience to your CSV data, powered by the [RBQL](https://rbql.org/) engine.

### Features

- **Syntax-highlighted editor** — keywords, functions, strings, numbers, and operators each render in a distinct colour with a VS Code–styled gutter.
- **Query history** — previously run queries are saved and can be re-selected with a single click.
- **Progress indicator** — a live progress bar tracks execution on large files.
- **Export** — download results as **CSV** or **JSON** directly from the results panel.

### Example queries

```sql
SELECT * WHERE a1 == 'Sales' ORDER BY a2 DESC LIMIT 100

SELECT a1, COUNT(*) GROUP BY a1

SELECT * WHERE parseInt(a3) > 500 AND a4 LIKE '%active%'
```

> **Column naming:** RBQL uses `a1`, `a2`, … for columns by index. Enable **Has Header Row** to also reference columns by name.

<br>

## 📊 Interactive Charts

The **Interactive Charts** panel (`VizFlow: Interactive Charts`) lets you visualize your CSV data without leaving VS Code.

- Choose from **bar**, **line**, **pie**, **scatter**, and other chart types.
- Map any CSV columns to the X and Y axes.
- Charts render live inside a WebView panel with full interactivity.

<br>

## 🗂️ Architecture

```
vizflow/
├── extension.js               # Entry point — registers all commands
├── commands/
│   ├── sum.js                 # Aggregation commands
│   ├── average.js
│   ├── aggregate.js           # Shared min / max / count handler
│   ├── statistics.js
│   ├── duplicate.js
│   ├── distinctValues.js
│   ├── transform.js           # CLI-based transform workflow
│   ├── transformWebview.js    # Visual Transformation Studio host
│   ├── compareCSV.js          # CSV Comparison WebView host
│   ├── dashboard.js           # Dataset Summary Dashboard host
│   ├── charts.js              # Interactive Charts WebView host
│   ├── rbql.js                # RBQL Query Console WebView host
│   └── about.js               # About / Creator WebView panel
├── engine/
│   ├── dataset.js             # Dataset model (rows, columns, profiling)
│   ├── duplicateFinder.js     # Duplicate detection engine
│   ├── expressions/
│   │   ├── operations.js      # 20 pure transform functions + metadata catalogue
│   │   └── evaluator.js       # evaluate() / evaluateRows() / previewFirst()
│   ├── aggregations/          # Sum, average, distinct, statistics engines
│   └── profiler/              # Column profiler
├── services/
│   ├── csvReader.js           # Reads the active editor's CSV text
│   ├── csvParser.js           # PapaParse wrapper with type inference
│   ├── csvCompare.js          # Pure comparison engine (no VS Code deps)
│   └── output.js              # Shared VizFlow Output Channel helpers
└── media/
    ├── transform.html / .css  # Visual Transformation Studio
    ├── compare.html / .css    # CSV Comparison
    ├── dashboard.html / .css  # Dataset Summary Dashboard
    ├── charts.html / .css     # Interactive Charts
    ├── rbql.html / .css       # RBQL Query Console
    └── rbql-syntax.js         # Client-side RBQL syntax highlighter
```

<br>

## ⚙️ Requirements

- **VS Code** `1.125.0` or newer
- A **CSV file** open as the active editor when running any command

No other tools, runtimes, or accounts are needed. Everything runs locally.

<br>

## 📦 Installation

### From the VS Code Marketplace
Search for **VizFlow** in the Extensions view (`Ctrl+Shift+X`) and click **Install**.

### From a `.vsix` file
```bash
code --install-extension vizflow-0.0.2.vsix
```

### From source
```bash
git clone https://github.ibm.com/Aditya-Mukherjee1/VizFlow.git
cd VizFlow
npm install
# Press F5 in VS Code to launch the Extension Development Host
```

<br>

## 🛠️ Development

```bash
# Install dependencies
npm install

# Run lint
npm run lint

# Run tests
npm test
```

The extension uses [PapaParse](https://www.papaparse.com/) for CSV parsing and [RBQL](https://rbql.org/) for query execution, and has no other runtime dependencies.

<br>

## 🗺️ Roadmap

- [x] Dataset Summary view (row count, column types, null counts)
- [x] SQL-like query support via RBQL Query Console
- [x] Charts & visualizations
- [ ] Data Quality Report across all columns
- [ ] Remove / deduplicate rows
- [ ] Export results to a new CSV directly from the Output panel
- [ ] Multi-file join support in the RBQL console

<br>

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">
  Built with ❤️ for data engineers, analysts, and anyone who works with CSV files in VS Code.<br>
  <strong>Aditya Mukherjee</strong> · Application Developer — Azure Cloud FullStack · IBM
</div>

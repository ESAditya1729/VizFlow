# VizFlow

> Created by **Aditya Mukherjee** · [aditya.mukherjee1@ibm.com](mailto:aditya.mukherjee1@ibm.com)

**VizFlow** is a Visual Studio Code extension for exploring and transforming CSV data without leaving your editor.
Open a CSV file, run a command from the Command Palette, and get instant results — aggregations, duplicate reports, column statistics, and a full visual transformation studio — all in one place.

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

<br>

## 🚀 Quick Start

1. Open any **CSV file** in VS Code.
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) to open the Command Palette.
3. Type **VizFlow** and choose any command.

All results appear in the dedicated **VizFlow Output** panel.

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

<br>

## 🎨 Visual Transformation Studio

The **Visual Transformation Studio** (`VizFlow: Transform Column (Visual)`) is the centrepiece feature. It opens a dedicated WebView panel beside your CSV file and lets you build, preview, and apply a queue of transformation rules.

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
| Starts With (check) | Returns true/false — does the value start with a prefix? |
| Ends With (check) | Returns true/false — does the value end with a suffix? |
| Contains (check) | Returns true/false — does the value contain a substring? |

### Targeted Row Transformation

Every rule in the queue can target **all rows** or a **subset of rows**:

- Select **Selected rows only** in the *Apply to* toggle.
- Enter row numbers or ranges in the **Row numbers** field — e.g. `1, 3, 5-8, 10`.
- Row 1 = first data row (header is not counted).
- Rows outside the selection are passed through unchanged. The preview table marks them as *(skipped)*.
- Rules with different scopes can be mixed in the same queue — e.g. uppercase column A for all rows, then multiply column B only for rows 5 and 10.

<br>

## 🗂️ Architecture

```
vizflow/
├── extension.js               # Entry point — registers all commands
├── commands/
│   ├── sum.js                 # Aggregation commands
│   ├── average.js
│   ├── statistics.js
│   ├── duplicate.js
│   ├── distinctValues.js
│   ├── transform.js           # CLI-based transform workflow
│   └── transformWebview.js    # Visual Transformation Studio host
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
│   └── output.js              # Shared VizFlow Output Channel helpers
└── media/
    ├── transform.html         # Visual Studio WebView markup
    └── transform.css          # WebView stylesheet (VS Code theme-aware)
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
code --install-extension vizflow-0.0.1.vsix
```

### From source
```bash
git clone https://github.com/your-username/vizflow.git
cd vizflow
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

The extension uses [PapaParse](https://www.papaparse.com/) for CSV parsing and has no runtime dependencies beyond that.

<br>

## 🗺️ Roadmap

- [ ] Dataset Summary view (row count, column types, null counts)
- [ ] Data Quality Report across all columns
- [ ] Remove / deduplicate rows
- [ ] SQL-like query support
- [ ] Charts & visualizations
- [ ] Export results to a new CSV directly from the Output panel

<br>

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">
  Built with ❤️ for data engineers, analysts, and anyone who works with CSV files in VS Code.
</div>

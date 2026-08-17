# VizFlow Workflow Builder — User Guide

> Build, schedule, and run data pipelines entirely inside VS Code. No cloud account, no YAML headaches, no vendor lock-in.

---

## Table of Contents

1. [What is the Workflow Builder?](#1-what-is-the-workflow-builder)
2. [Core Concepts](#2-core-concepts)
3. [Activity Reference](#3-activity-reference)
4. [Variables & Interpolation](#4-variables--interpolation)
5. [Control Flow](#5-control-flow)
6. [Data Sources](#6-data-sources)
7. [Scheduling](#7-scheduling)
8. [Sub-Workflows](#8-sub-workflows)
9. [Real-World Use Cases](#9-real-world-use-cases)
10. [Troubleshooting](#10-troubleshooting)
11. [Best Practices](#11-best-practices)

---

## 1. What is the Workflow Builder?

The Workflow Builder is a visual, drag-and-drop pipeline editor inside VS Code. It lets you chain **activities** — self-contained steps like reading a file, calling an API, transforming data, or writing output — into repeatable `.vizflow` workflow files.

**Key advantages over cloud solutions (Azure Logic Apps, ADF, AWS Step Functions):**

| | VizFlow | Azure Logic Apps / ADF |
|---|---------|----------------------|
| **Cost** | Free (MIT license) | Pay per execution + connector |
| **Data residency** | Always local | Cloud storage required |
| **Setup time** | 2 minutes | Hours (subscriptions, IRs, VNETs) |
| **Credentials** | OS keychain | Azure Key Vault |
| **Scheduling** | Built-in cron | Requires triggers + plans |
| **Offline** | Fully offline | Needs internet |
| **Portability** | `.vizflow` file is a JSON | Vendor-specific templates |

---

## 2. Core Concepts

### Workflow Structure

A `.vizflow` file is JSON with this shape:

```json
{
  "name": "My Pipeline",
  "version": "1.0.0",
  "parameters": [],
  "activities": [
    { "id": "step_1", "type": "readCsv", "config": { ... } },
    { "id": "step_2", "type": "filter", "config": { ... } },
    { "id": "step_3", "type": "writeCsv", "config": { ... } }
  ]
}
```

### Data Flow

Activities execute sequentially. Each activity receives the **output dataset** from the previous step as its input. This is the pipeline pattern:

```
readCsv → Dataset { rows, columns }
  ↓
filter → Dataset { rows, columns }  (filtered)
  ↓
writeCsv → writes to disk, passes Dataset through
```

**Activities always return a Dataset**, even output activities. This means you can chain multiple writes or analytics steps after a single data source.

### Activity Categories

| Category | Purpose | Activities |
|----------|---------|------------|
| **Input** | Bring data into the pipeline | `readCsv`, `readExcel`, `readMongo`, `readSql`, `sampleData`, `listFiles` |
| **Transformation** | Reshape, clean, reorder data | `filter`, `transform`, `selectColumns`, `sort`, `removeDuplicates` |
| **Query** | SQL-like queries on data | `query` (RBQL), `previewQuery`, `columnStats` |
| **Analytics** | Aggregate and profile data | `aggregate`, `groupBy`, `dataProfile` |
| **Integration** | Connect to external services | `httpRequest` |
| **Output** | Write data to files | `writeCsv`, `writeJson`, `writeText`, `appendText`, `exportMultiple` |
| **Control** | Branching, loops, variables | `ifElse`, `forEach`, `setVariable`, `wait`, `multiTransform`, `callWorkflow` |
| **Database** | Direct database queries | `readMongo`, `readSql`, `mongoQuery`, `sqlQuery` |
| **PowerShell** | Run scripts, iterate files | `execPowerShell`, `forEachFile` |

---

## 3. Activity Reference

### Input Activities

#### `readCsv` — Read CSV/TSV File
Reads a CSV or TSV file into the pipeline.
- **filePath** (required): Path to the CSV file. Supports `{{variable}}` interpolation.
- **delimiter**: Column separator (default: auto-detect from extension).
- **hasHeader**: Whether the first row is column names (default: `true`).
- **encoding**: File encoding — `utf8`, `utf8-bom`, `ascii`, `latin1` (default: `utf8`).

#### `readExcel` — Read Excel File
Reads an `.xlsx` / `.xls` file.
- **filePath** (required): Path to the Excel file.
- **sheetName** or **sheetIndex**: Which sheet to read (default: first sheet).
- **headerRow**: Row number containing column names (default: `1`, 1-based).
- **startRow**: First data row (default: `2`, 1-based).

#### `readMongo` — Read MongoDB Collection
Reads documents from a MongoDB collection. Requires a Data Source connection.
- **connection** (required): Name of a saved MongoDB connection.
- **database** (required): Database name (populated dynamically).
- **collection** (required): Collection name (populated dynamically).
- **filter**: Mongo filter JSON (default: `{}` — all documents).
- **projection**: Fields to include/exclude.
- **sort**, **limit**: Ordering and row cap.

#### `readSql` — Read SQL Table
Reads from MySQL or PostgreSQL. Requires a Data Source connection.
- **connection** (required): Name of a saved SQL connection.
- **query** (required): SQL `SELECT` statement or table name.
- **limit**: Max rows (default: `1000`).

#### `sampleData` — Generate Sample Data
Creates a synthetic dataset for testing.
- **rowCount**: Number of rows (default: `100`).
- **columns**: Column definitions (name + type).

#### `listFiles` — List Files in Folder
Returns a dataset of files matching a pattern.
- **folderPath** (required): Directory to scan.
- **pattern**: Glob pattern (e.g., `*.csv`).
- **recursive**: Scan subdirectories (default: `false`).

---

### Transformation Activities

#### `filter` — Filter Rows
Keep rows matching a condition.
- **column** (required): Column to test.
- **operator** (required): `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `startsWith`, `endsWith`, `isEmpty`, `isNotEmpty`, `regex`.
- **value**: Comparison value.
- **caseSensitive**: Case-sensitive comparison (default: `false`).

#### `transform` — Transform Column
Apply an operation to a column (55+ built-in operations).
- **column** (required): Target column.
- **opKey** (required): Operation key (e.g., `toUpperCase`, `trim`, `parseInt`, `multiply`, `dateFormat`, `concat`, `substring`, `replace`, `coalesce`, `abs`, `round`, `ifNull`).
- **outputColumn**: Where to store the result (default: overwrite the source column).
- **operand**: Second operand for binary operations (e.g., `multiply` by what value).

#### `selectColumns` — Select Columns
Pick specific columns to keep (or reorder).
- **columns** (required): Comma-separated column names (e.g., `"name, email, phone"`).
- **includeAll**: If true, append remaining columns after the selected ones.

#### `sort` — Sort Data
Sort by one or more columns.
- **sorts** (required): Comma-separated sort specs (e.g., `"age:asc, name:desc"`).

#### `removeDuplicates` — Remove Duplicates
Deduplicate based on specified columns.
- **columns** (required): Columns to check for uniqueness (comma-separated).

---

### Query Activities

#### `query` — RBQL Query
Run a SQL-like query on the dataset using [RBQL](https://github.com/mechatroner/rbql_csv).
- **query** (required): RBQL query using either positional (`a1`, `a2`) or named column references.
- **allowUpdate**: Allow `UPDATE` / `DELETE` operations (default: `false`).

Examples:
```sql
SELECT emoji, title WHERE health > 90
SELECT a1, a3 WHERE a2 CONTAINS 'weather'
SELECT * ORDER BY a1 DESC LIMIT 10
```

#### `previewQuery` — Data Preview
Quick preview with limit, filter, and sort — no RBQL syntax needed.
- **limit**: Max rows to return.
- **where**: Simple filter expression.
- **orderBy**: Sort expression.

#### `columnStats` — Column Statistics
Computes min, max, avg, null count, distinct count for specified columns.
- **columns**: Columns to analyze (comma-separated).

---

### Analytics Activities

#### `aggregate` — Aggregate
Compute summary statistics across the dataset.
- **aggregations** (required): List of `{ column, operation }` pairs.
- **operations**: `sum`, `avg`, `min`, `max`, `count`, `countDistinct`.

#### `groupBy` — Group By
Group rows and compute per-group aggregates.
- **groupByColumns** (required): Columns to group by.
- **aggregations** (required): `{ column, operation }` pairs.

#### `dataProfile` — Data Profile
Full dataset profiling: column types, nulls, distinct values, top values, histograms.

---

### Output Activities

#### `writeCsv` — Write CSV
- **filePath** (required): Output path.
- **delimiter**: Column separator (default: `,`).
- **encoding**: File encoding (default: `utf8`).
- **overwrite**: Overwrite existing file (default: `true`).

#### `writeJson` — Write JSON
- **filePath** (required): Output path.
- **indent**: JSON indentation spaces (default: `2`).
- **arrayFormat**: `rows` (array of objects) or `columns` (columnar format).

#### `writeText` — Write Text File
- **filePath** (required): Output path.
- **content** (required): `dataset`, `variable`, or `custom`.
- **format**: `plain`, `csv`, `json`, or `table`.
- **variableName**: For `variable` content source.
- **customText**: For `custom` content source. Supports `{{variable}}` and `{{row.Column}}`.

#### `appendText` — Append to Text File
Same as `writeText` but appends instead of overwriting. Creates the file if it doesn't exist.

#### `exportMultiple` — Export Multiple Files
Export the dataset to multiple formats in one step (e.g., CSV + JSON + text).

---

### Integration Activities

#### `httpRequest` — HTTP Request
Call any REST API and convert the response into a Dataset.
- **url** (required): Request URL. Supports `{{variable}}` interpolation.
- **method** (required): `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`.
- **headers**: JSON object of request headers.
- **queryParams**: JSON object appended as query string.
- **body**: Request body (for POST/PUT/PATCH).
- **contentType**: `json`, `text`, or `form`.
- **responsePath**: Dot path into the response to extract data (e.g., `"data.items"`). Leave empty for the whole body.
- **timeout**: Request timeout in seconds (default: `30`).
- **ignoreErrorStatus**: Keep non-2xx responses as data instead of failing.

---

### Control Activities

#### `ifElse` — Conditional Branching
Execute different activity branches based on a condition.
- **column**: Column to test (from the input dataset).
- **operator**: `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `startsWith`, `endsWith`, `isEmpty`, `isNotEmpty`, `regex`.
- **value**: Comparison value.
- **thenSteps**: Activities to run when the condition is true.
- **elseSteps**: Activities to run when the condition is false.

#### `forEach` — Loop Over Rows
Execute activities for each row in the dataset. Reference row values with `{{row.ColumnName}}`.
- **steps** (required): Activities to execute per row.

#### `forEachFile` — Loop Over Files
Execute activities for each file matching a pattern.
- **folderPath** (required): Directory to scan.
- **pattern**: Glob pattern (e.g., `*.csv`).
- **steps** (required): Activities to execute per file. Use `{{filePath}}`, `{{fileName}}`, `{{fileNameWithoutExt}}`.

#### `setVariable` — Set Variable
Store a value in the workflow context for use in later steps.
- **variableName** (required): Variable name.
- **sourceType** (required): `static`, `column`, `expression`, `variable`, or `jsonPath`.
- **value**: The value or expression to evaluate.

#### `wait` — Wait
Pause the pipeline for a fixed duration or until a condition is met.
- **duration**: Seconds to wait (default: `5`).
- **condition**: Optional expression — waits until truthy.

#### `multiTransform` — Multi-Transform
Apply multiple transformations to different columns in one step.
- **operations** (required): Array of `{ column, opKey, operand?, outputColumn? }` objects.

#### `callWorkflow` — Call Sub-Workflow
Run another `.vizflow` file as a sub-workflow.
- **workflowPath** (required): Path to the `.vizflow` file.
- **parameters**: Key-value pairs to pass as workflow parameters.
- Circular calls are rejected; max nesting depth is 10.

---

### PowerShell Activities

#### `execPowerShell` — Execute PowerShell Script
Run a PowerShell script and capture its output as a Dataset.
- **script** (required): PowerShell script text. Supports `{{variable}}` interpolation.
- **parseOutput**: Parse stdout as CSV/JSON into a Dataset (default: `true`).

#### `forEachFile` — (listed above under Control)
Iterates over files in a folder and runs activities per file.

---

## 4. Variables & Interpolation

VizFlow supports `{{variable}}` interpolation in string config values across all activities.

### Built-in Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{{timestamp}}` | ISO 8601 timestamp | `2026-08-17T14:30:00.000Z` |
| `{{date}}` | Date string | `2026-08-17` |
| `{{time}}` | Time string | `14:30:00` |
| `{{year}}` | 4-digit year | `2026` |
| `{{month}}` | 2-digit month | `08` |
| `{{day}}` | 2-digit day | `17` |
| `{{hour}}` | 2-digit hour | `14` |
| `{{minute}}` | 2-digit minute | `30` |
| `{{second}}` | 2-digit second | `00` |
| `{{workflowName}}` | Current workflow name | `My Pipeline` |
| `{{workspaceRoot}}` | VS Code workspace root | `/Users/me/project` |

### User-Defined Variables

Use the **Set Variable** activity to create variables:

```json
{
  "id": "set_var",
  "type": "setVariable",
  "config": {
    "variableName": "apiKey",
    "sourceType": "static",
    "value": "sk-abc123"
  }
}
```

Then reference it anywhere: `"Authorization": "Bearer {{apiKey}}"`

### Row Variables (in Loops)

Inside `forEach` and `forEachFile` loops, reference row data with `{{row.ColumnName}}`:

```json
{
  "id": "write_loop",
  "type": "writeText",
  "config": {
    "filePath": "output/{{row.id}}.txt",
    "content": "custom",
    "customText": "Name: {{row.name}}, Score: {{row.score}}"
  }
}
```

### Expression Variables

Use expressions with `setVariable`:

```json
{
  "sourceType": "expression",
  "value": "{{row.price}} * {{row.quantity}}"
}
```

### Variable Source Types

| Source Type | Description | Value Field |
|-------------|-------------|-------------|
| `static` | Literal value (no interpolation) | Any string |
| `column` | Pull from a dataset column | Column name |
| `expression` | Math/string expression | Expression with `{{...}}` |
| `variable` | Reference another variable | Variable name |
| `jsonPath` | Navigate JSON with dot path | Dot path (e.g., `data.items.0.name`) |

---

## 5. Control Flow

### Conditional Branching (If/Else)

Route data through different paths based on conditions:

```json
{
  "id": "check_data",
  "type": "ifElse",
  "config": {
    "column": "status",
    "operator": "==",
    "value": "active",
    "thenSteps": [
      { "id": "write_active", "type": "writeCsv", "config": { "filePath": "active.csv" } }
    ],
    "elseSteps": [
      { "id": "write_inactive", "type": "writeCsv", "config": { "filePath": "inactive.csv" } }
    ]
  }
}
```

### Loop Over Rows (ForEach)

Process each row individually:

```json
{
  "id": "process_rows",
  "type": "forEach",
  "config": {
    "steps": [
      {
        "id": "write_per_row",
        "type": "writeText",
        "config": {
          "filePath": "output/{{row.id}}.txt",
          "content": "custom",
          "customText": "{{row.name}}: {{row.value}}"
        }
      }
    ]
  }
}
```

### Loop Over Files (ForEachFile)

Process every file in a folder:

```json
{
  "id": "process_files",
  "type": "forEachFile",
  "config": {
    "folderPath": "input/",
    "pattern": "*.csv",
    "steps": [
      {
        "id": "read_each",
        "type": "readCsv",
        "config": { "filePath": "{{filePath}}" }
      },
      {
        "id": "write_each",
        "type": "writeCsv",
        "config": { "filePath": "output/{{fileNameWithoutExt}}_processed.csv" }
      }
    ]
  }
}
```

### Wait / Delay

Pause execution:

```json
{
  "id": "pause",
  "type": "wait",
  "config": { "duration": 10 }
}
```

Conditional wait (poll until a condition is met):

```json
{
  "id": "wait_for_data",
  "type": "wait",
  "config": { "duration": 60, "condition": "{{row.isReady}}" }
}
```

---

## 6. Data Sources

VizFlow connects to MongoDB, MySQL, and PostgreSQL through the **Data Sources** panel (`Ctrl+Shift+P` → `VizFlow: External Data Sources`).

### Setting Up a Connection

1. Open the Data Sources panel
2. Click **+ Add Connection**
3. Choose type (MongoDB / MySQL / PostgreSQL)
4. Enter host, port, credentials, and database
5. Click **Test Connection** — VizFlow stores credentials in your OS keychain (never in files)
6. Name the connection and save

### Using Connections in Workflows

Connections are referenced by name in activity configs:

```json
{
  "id": "read_mongo",
  "type": "readMongo",
  "config": {
    "connection": "My Analytics DB",
    "database": "analytics",
    "collection": "events",
    "filter": "{ \"type\": \"click\" }",
    "limit": 5000
  }
}
```

### Visual Query Builder

From the Data Sources panel:
1. Select a connection and collection/table
2. Use the visual builder to tick columns, add filters, sort, and preview
3. Click **Add to Workflow Builder** to generate a ready-to-run activity

---

## 7. Scheduling

VizFlow includes a built-in cron scheduler that runs `.vizflow` workflows on a schedule.

### Quick Schedule

`Ctrl+Shift+P` → `VizFlow: Quick Schedule Workflow` — pick a file and a cron expression.

### Full Scheduler Panel

`Ctrl+Shift+P` → `VizFlow: Workflow Scheduler` — manage all scheduled jobs.

### Schedule Types

| Type | Description | Example |
|------|-------------|---------|
| **Cron** | Recurring schedule | `0 9 * * 1-5` (weekdays at 9 AM) |
| **One-time** | Run once at a future time | `2026-08-20T14:00:00` |

### Built-in Schedule Variables

Scheduled runs inject these variables automatically:

```
{{timestamp}}  {{date}}  {{time}}
{{year}}  {{month}}  {{day}}
{{hour}}  {{minute}}  {{second}}
{{workflowName}}
```

### Watch Folder Trigger

Automatically trigger a workflow when new files appear in a folder:

```json
{
  "watchFolder": "input/",
  "watchFilter": "*.csv"
}
```

### Notifications

Configure webhook or email notifications on job completion:

```json
{
  "notifications": {
    "onSuccess": { "type": "webhook", "url": "https://hooks.slack.com/..." },
    "onFailure": { "type": "email", "to": "admin@company.com" }
  }
}
```

---

## 8. Sub-Workflows

Break complex pipelines into reusable modules with `callWorkflow`.

### Declaring Parameters

In the workflow file:
```json
{
  "name": "Clean Data",
  "parameters": [
    { "name": "inputFile", "label": "Input File", "type": "string", "required": true },
    { "name": "outputDir", "label": "Output Directory", "type": "string", "defaultValue": "output/" }
  ],
  "activities": [...]
}
```

### Calling a Sub-Workflow

```json
{
  "id": "clean_step",
  "type": "callWorkflow",
  "config": {
    "workflowPath": "workflows/clean-data.vizflow",
    "parameters": {
      "inputFile": "{{inputFile}}",
      "outputDir": "processed/"
    }
  }
}
```

### Safety

- Circular calls are automatically detected and rejected
- Maximum nesting depth: 10 levels
- Sub-workflow parameters must match declared parameters

---

## 9. Real-World Use Cases

These are production-ready patterns that replace cloud ETL tools (Azure Logic Apps, ADF, AWS Glue) with lightweight, local, zero-cost alternatives.

---

### Use Case 1: Daily CSV Report Pipeline

**Problem:** Every morning, combine sales data from multiple CSV files, aggregate by region, and produce a summary report.

**Replaces:** Azure Data Factory Copy Data + Data Flow

```json
{
  "name": "Daily Sales Report",
  "version": "1.0.0",
  "activities": [
    {
      "id": "read_sales",
      "type": "readCsv",
      "config": { "filePath": "input/sales_{{date}}.csv" }
    },
    {
      "id": "clean_data",
      "type": "transform",
      "config": { "column": "amount", "opKey": "parseFloat" }
    },
    {
      "id": "region_totals",
      "type": "groupBy",
      "config": {
        "groupByColumns": "region",
        "aggregations": [
          { "column": "amount", "operation": "sum" },
          { "column": "amount", "operation": "count" }
        ]
      }
    },
    {
      "id": "sort_by_total",
      "type": "sort",
      "config": { "sorts": "amount_sum:desc" }
    },
    {
      "id": "write_report",
      "type": "writeCsv",
      "config": { "filePath": "reports/sales_summary_{{date}}.csv" }
    },
    {
      "id": "write_json",
      "type": "writeJson",
      "config": { "filePath": "reports/sales_summary_{{date}}.json" }
    }
  ]
}
```

**Schedule:** `0 8 * * 1-5` — weekdays at 8 AM

---

### Use Case 2: API Data Aggregator

**Problem:** Fetch data from multiple REST APIs, merge results, and export a unified dataset.

**Replaces:** Azure Logic Apps HTTP Connector + Liquid Maps

```json
{
  "name": "API Aggregator",
  "version": "1.0.0",
  "activities": [
    {
      "id": "fetch_weather",
      "type": "httpRequest",
      "config": {
        "url": "https://api.openweathermap.org/data/2.5/weather?q=London&appid={{apiKey}}",
        "method": "GET",
        "responsePath": "main",
        "timeout": 15
      }
    },
    {
      "id": "write_weather",
      "type": "writeJson",
      "config": { "filePath": "cache/weather_london.json" }
    },
    {
      "id": "fetch_news",
      "type": "httpRequest",
      "config": {
        "url": "https://newsapi.org/v2/top-headlines?country=us&apiKey={{newsApiKey}}",
        "method": "GET",
        "responsePath": "articles",
        "maxResponseRows": 50
      }
    },
    {
      "id": "select_news_fields",
      "type": "selectColumns",
      "config": { "columns": "title, description, publishedAt, source.name" }
    },
    {
      "id": "write_news",
      "type": "writeCsv",
      "config": { "filePath": "cache/news_{{date}}.csv" }
    }
  ]
}
```

**Schedule:** `0 */4 * * *` — every 4 hours

---

### Use Case 3: File Watcher & Auto-Processor

**Problem:** Monitor a folder for new CSV files, validate their structure, and process them automatically.

**Replaces:** Azure Logic Apps File System Trigger + parallelism settings

```json
{
  "name": "Auto-Process CSV Files",
  "version": "1.0.0",
  "activities": [
    {
      "id": "scan_folder",
      "type": "listFiles",
      "config": {
        "folderPath": "inbox/",
        "pattern": "*.csv",
        "recursive": false
      }
    },
    {
      "id": "process_each",
      "type": "forEachFile",
      "config": {
        "folderPath": "inbox/",
        "pattern": "*.csv",
        "steps": [
          {
            "id": "read_file",
            "type": "readCsv",
            "config": { "filePath": "{{filePath}}" }
          },
          {
            "id": "check_columns",
            "type": "columnStats",
            "config": { "columns": "id, name, email" }
          },
          {
            "id": "remove_dupes",
            "type": "removeDuplicates",
            "config": { "columns": "id" }
          },
          {
            "id": "write_clean",
            "type": "writeCsv",
            "config": { "filePath": "processed/{{fileNameWithoutExt}}_clean.csv" }
          }
        ]
      }
    }
  ]
}
```

**Schedule:** `*/15 * * * *` — every 15 minutes (or use watch folder trigger)

---

### Use Case 4: Database ETL Pipeline

**Problem:** Extract data from PostgreSQL, transform it, and load into MongoDB — a classic ETL pattern.

**Replaces:** Azure Data Factory Pipeline (Copy Activity + Data Flow)

```json
{
  "name": "PostgreSQL to MongoDB ETL",
  "version": "1.0.0",
  "activities": [
    {
      "id": "extract",
      "type": "readSql",
      "config": {
        "connection": "Production PostgreSQL",
        "query": "SELECT id, name, email, created_at FROM users WHERE created_at > '{{lastRunTimestamp}}'",
        "limit": 50000
      }
    },
    {
      "id": "clean_names",
      "type": "multiTransform",
      "config": {
        "operations": [
          { "column": "name", "opKey": "trim" },
          { "column": "name", "opKey": "toTitleCase" },
          { "column": "email", "opKey": "toLowerCase" }
        ]
      }
    },
    {
      "id": "add_metadata",
      "type": "transform",
      "config": {
        "column": "imported_at",
        "opKey": "coalesce",
        "operand": "{{timestamp}}",
        "outputColumn": "imported_at"
      }
    },
    {
      "id": "load_to_mongo",
      "type": "writeMongo",
      "config": {
        "connection": "Analytics MongoDB",
        "database": "analytics",
        "collection": "users_enriched",
        "overwrite": false
      }
    },
    {
      "id": "log_count",
      "type": "aggregate",
      "config": {
        "aggregations": [{ "column": "id", "operation": "count" }]
      }
    },
    {
      "id": "write_audit",
      "type": "writeJson",
      "config": { "filePath": "logs/etrun_{{timestamp}}.json" }
    }
  ]
}
```

**Schedule:** `0 2 * * *` — daily at 2 AM

---

### Use Case 5: Multi-Format Export with Conditional Logic

**Problem:** Read data, split into different output formats based on content, and produce multiple deliverables.

**Replaces:** Azure Logic Apps Compose + Switch + Parallel Branch

```json
{
  "name": "Conditional Multi-Export",
  "version": "1.0.0",
  "activities": [
    {
      "id": "read_data",
      "type": "readCsv",
      "config": { "filePath": "input/leads.csv" }
    },
    {
      "id": "enrich",
      "type": "multiTransform",
      "config": {
        "operations": [
          { "column": "score", "opKey": "parseInt" },
          { "column": "email", "opKey": "toLowerCase" }
        ]
      }
    },
    {
      "id": "split_by_score",
      "type": "ifElse",
      "config": {
        "column": "score",
        "operator": ">=",
        "value": "80",
        "thenSteps": [
          {
            "id": "export_hot",
            "type": "exportMultiple",
            "config": {
              "filePath": "output/hot_leads",
              "formats": ["csv", "json"]
            }
          }
        ],
        "elseSteps": [
          {
            "id": "export_nurture",
            "type": "writeCsv",
            "config": { "filePath": "output/nurture_leads.csv" }
          }
        ]
      }
    }
  ]
}
```

---

### Use Case 6: Scheduled Data Quality Monitor

**Problem:** Continuously monitor a dataset for quality issues (nulls, duplicates, anomalies) and alert when thresholds are breached.

**Replaces:** Azure Data Factory Data Flow + Alert activity

```json
{
  "name": "Data Quality Monitor",
  "version": "1.0.0",
  "activities": [
    {
      "id": "read_source",
      "type": "readCsv",
      "config": { "filePath": "data/production_data.csv" }
    },
    {
      "id": "profile_data",
      "type": "dataProfile",
      "config": {}
    },
    {
      "id": "find_dupes",
      "type": "removeDuplicates",
      "config": { "columns": "id" }
    },
    {
      "id": "compare_counts",
      "type": "aggregate",
      "config": {
        "aggregations": [{ "column": "id", "operation": "count" }]
      }
    },
    {
      "id": "check_quality",
      "type": "ifElse",
      "config": {
        "column": "id_count",
        "operator": ">",
        "value": "0",
        "thenSteps": [
          {
            "id": "alert_clean",
            "type": "writeText",
            "config": {
              "filePath": "logs/quality_{{date}}.txt",
              "content": "custom",
              "customText": "PASS: {{date}} — No quality issues detected."
            }
          }
        ],
        "elseSteps": [
          {
            "id": "alert_issue",
            "type": "writeText",
            "config": {
              "filePath": "logs/quality_{{date}}.txt",
              "content": "custom",
              "customText": "ALERT: {{date}} — Data quality issues found. Review production_data.csv."
            }
          }
        ]
      }
    }
  ]
}
```

**Schedule:** `0 6 * * *` — daily at 6 AM

---

### Use Case 7: PowerShell Automation + Data Processing

**Problem:** Run system commands, capture their output, and process the results as structured data.

**Replaces:** Azure Logic Apps PowerShell Connector (which requires Azure VM or hybrid runbook worker)

```json
{
  "name": "System Health Check",
  "version": "1.0.0",
  "activities": [
    {
      "id": "get_processes",
      "type": "execPowerShell",
      "config": {
        "script": "Get-Process | Select-Object Name, Id, CPU, WorkingSet64 | ConvertTo-Json",
        "parseOutput": true
      }
    },
    {
      "id": "select_fields",
      "type": "selectColumns",
      "config": { "columns": "Name, Id, CPU, WorkingSet64" }
    },
    {
      "id": "sort_by_cpu",
      "type": "sort",
      "config": { "sorts": "CPU:desc" }
    },
    {
      "id": "top_10",
      "type": "query",
      "config": { "query": "SELECT * LIMIT 10" }
    },
    {
      "id": "write_report",
      "type": "writeCsv",
      "config": { "filePath": "reports/processes_{{date}}.csv" }
    }
  ]
}
```

---

### Use Case 8: Sub-Workflow Orchestration (Modular Pipelines)

**Problem:** Build complex pipelines as composable, reusable modules.

**Replaces:** Azure Data Factory Linked Services + Pipeline References

**Main workflow:**
```json
{
  "name": "Master ETL Pipeline",
  "version": "1.0.0",
  "activities": [
    {
      "id": "extract",
      "type": "callWorkflow",
      "config": {
        "workflowPath": "pipelines/extract.vizflow",
        "parameters": {
          "source": "production",
          "since": "{{lastRunTimestamp}}"
        }
      }
    },
    {
      "id": "transform",
      "type": "callWorkflow",
      "config": {
        "workflowPath": "pipelines/transform.vizflow",
        "parameters": {
          "dedupColumns": "id,email",
          "normalizeCase": "true"
        }
      }
    },
    {
      "id": "load",
      "type": "callWorkflow",
      "config": {
        "workflowPath": "pipelines/load.vizflow",
        "parameters": {
          "target": "analytics",
          "collection": "clean_users"
        }
      }
    }
  ]
}
```

**extract.vizflow (reusable module):**
```json
{
  "name": "Extract",
  "parameters": [
    { "name": "source", "type": "string", "required": true },
    { "name": "since", "type": "string", "defaultValue": "2020-01-01" }
  ],
  "activities": [
    {
      "id": "read_source",
      "type": "readSql",
      "config": {
        "connection": "{{source}}",
        "query": "SELECT * FROM users WHERE created_at > '{{since}}'"
      }
    }
  ]
}
```

---

### Use Case 9: Webhook-Driven Data Ingestion

**Problem:** Accept data from external webhooks (e.g., form submissions, payment notifications) and process them.

**Replaces:** Azure Logic Apps Request Trigger + Response

Use `httpRequest` to poll an API endpoint on a schedule, process the results, and store them:

```json
{
  "name": "Ingest Webhook Data",
  "version": "1.0.0",
  "activities": [
    {
      "id": "fetch_submissions",
      "type": "httpRequest",
      "config": {
        "url": "https://api.forms.example.com/submissions?since={{lastRunTimestamp}}",
        "method": "GET",
        "headers": "{ \"Authorization\": \"Bearer {{formApiKey}}\" }",
        "responsePath": "data.submissions",
        "timeout": 30
      }
    },
    {
      "id": "normalize_fields",
      "type": "multiTransform",
      "config": {
        "operations": [
          { "column": "email", "opKey": "toLowerCase" },
          { "column": "name", "opKey": "trim" },
          { "column": "phone", "opKey": "replace", "operand": "[^0-9+]" }
        ]
      }
    },
    {
      "id": "write_ingest",
      "type": "appendText",
      "config": {
        "filePath": "data/form_submissions_{{date}}.jsonl",
        "content": "dataset",
        "format": "json"
      }
    }
  ]
}
```

**Schedule:** `*/5 * * * *` — every 5 minutes

---

### Use Case 10: Email Report Generator

**Problem:** Generate formatted reports and save them locally for email attachment or review.

**Replaces:** Azure Logic Apps Email Connector + HTML Template

```json
{
  "name": "Weekly Report Generator",
  "version": "1.0.0",
  "activities": [
    {
      "id": "read_metrics",
      "type": "readCsv",
      "config": { "filePath": "data/metrics_{{date}}.csv" }
    },
    {
      "id": "summary",
      "type": "aggregate",
      "config": {
        "aggregations": [
          { "column": "revenue", "operation": "sum" },
          { "column": "revenue", "operation": "avg" },
          { "column": "orders", "operation": "count" }
        ]
      }
    },
    {
      "id": "by_category",
      "type": "groupBy",
      "config": {
        "groupByColumns": "category",
        "aggregations": [
          { "column": "revenue", "operation": "sum" },
          { "column": "orders", "operation": "count" }
        ]
      }
    },
    {
      "id": "write_summary_csv",
      "type": "writeCsv",
      "config": { "filePath": "reports/weekly_summary_{{date}}.csv" }
    },
    {
      "id": "write_summary_json",
      "type": "writeJson",
      "config": { "filePath": "reports/weekly_summary_{{date}}.json" }
    },
    {
      "id": "write_summary_text",
      "type": "writeText",
      "config": {
        "filePath": "reports/weekly_summary_{{date}}.txt",
        "content": "dataset",
        "format": "table",
        "includeHeader": true
      }
    }
  ]
}
```

**Schedule:** `0 9 * * 1` — every Monday at 9 AM

---

### Use Case Comparison Matrix

| Use Case | VizFlow | Azure Logic Apps | Azure Data Factory | Cost Savings |
|----------|---------|-----------------|-------------------|--------------|
| Daily CSV Report | 3 activities | 5 actions + connector | Pipeline + 2 activities | Free vs ~$0.50/run |
| API Aggregator | 2 httpRequests | 2 HTTP actions + Transform | Pipeline + Lookup | Free vs ~$1/run |
| File Watcher | forEachFile | Recurrence trigger + For_each | Tumbling Window + Copy | Free vs ~$0.25/run |
| DB ETL | readSql → transform → writeMongo | SQL + Transform + Cosmos | Copy + Data Flow | Free vs ~$2/run |
| Conditional Export | ifElse + exportMultiple | Switch + Parallel branches | If Condition + Copy | Free vs ~$1/run |
| Data Quality Monitor | dataProfile + ifElse | HTTP + Condition + Response | Data Flow + Alert | Free vs ~$1.50/run |
| PowerShell Automation | execPowerShell | PowerShell connector (needs VM) | N/A (no native support) | Free vs ~$0.10/min VM |
| Sub-Workflow Orchestration | callWorkflow | Child Workflows | Linked Services | Free vs ~$0.50/pipeline |
| Webhook Ingestion | httpRequest (poll) | HTTP Webhook trigger | N/A (no webhook trigger) | Free vs ~$0.50/run |
| Report Generator | aggregate + writeText | HTML Template + Email | Data Flow + Copy | Free vs ~$1/run |

---

## 10. Troubleshooting

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `"url" is required` | httpRequest missing URL | Add `"url"` to config |
| `Columns not found: [col]` | selectColumns can't find a column | Check column names with `columnStats` or use `includeAll: true` |
| `No SRV records found` | MongoDB SRV DNS failure | Check connection string or use Data Sources panel to auto-convert |
| `Write Text: Input dataset is required` | writeText with `content: "dataset"` but no incoming data | Ensure an upstream activity produces data |
| `Unsupported operator "regex"` | Using regex in ifElse (fixed in latest version) | Update VizFlow to the latest version |
| `Variable "x" not found` | Referencing an undefined variable | Add a `setVariable` step before using it |

### Debugging Tips

1. **Preview intermediate results**: Insert a `writeCsv` or `writeJson` after any step to inspect the data at that point.
2. **Use `columnStats`**: Add it after a transform to verify column values changed as expected.
3. **Check activity stats**: Each activity stores execution stats (row counts, column counts, timing) in the workflow context.
4. **Test connections first**: Use the Data Sources panel to test database connections before referencing them in workflows.

---

## 11. Best Practices

### Workflow Design

- **Start simple**: Begin with a linear pipeline, then add branching and loops as needed.
- **One concern per step**: Each activity should do one thing well.
- **Use variables for reusable values**: API keys, file paths, timestamps — store them once, reference everywhere.
- **Name activities descriptively**: `fetch_orders` beats `step_3`.
- **Use sub-workflows** for repeated patterns: if the same sequence appears in multiple workflows, extract it.

### Performance

- **Limit row counts**: Use `limit` in read activities and `maxResponseRows` in HTTP requests.
- **Avoid unnecessary transforms**: Skip transforms that don't affect downstream steps.
- **Use `selectColumns` early**: Reduce dataset width before heavy operations like `query` or `groupBy`.
- **Batch file processing**: Use `forEachFile` with `listFiles` for parallel-aware iteration.

### Security

- **Never hardcode credentials**: Use Data Sources connections (stored in OS keychain) or `setVariable` with secure values.
- **Use `{{variable}}` interpolation**: Keep secrets out of workflow JSON files.
- **Mark sensitive workflows**: Use descriptive filenames that indicate sensitivity.

### Version Control

- **Commit `.vizflow` files**: They're plain JSON and diff-friendly.
- **Include `version` and `createdAt`**: Track workflow evolution.
- **Document `parameters`**: Future users (and AI agents) will thank you.

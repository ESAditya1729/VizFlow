# VizFlow Workflow Activity Catalog

> **GENERATED FILE — do not edit by hand.**
> Source: `scripts/generate-ai-context.js` · regenerate with `npm run gen:context`.
> A test enforces this file matches the live activity registry, so the catalog can
> never drift from the code. When you add/remove/change an activity, re-run the script.

Each activity below is a valid `type` for a `.vizflow` activity node:

```json
{ "id": "unique_step_id", "type": "readCsv", "config": { "filePath": "..." } }
```

## Index

- **Input** (6): `listFiles`, `readCsv`, `readExcel`, `readMongo`, `readSql`, `sampleData`
- **Transformation** (5): `filter`, `removeDuplicates`, `selectColumns`, `sort`, `transform`
- **Query** (4): `mongoQuery`, `previewQuery`, `query`, `sqlQuery`
- **Analytics** (4): `aggregate`, `columnStats`, `dataProfile`, `groupBy`
- **Output** (5): `appendText`, `exportMultiple`, `writeCsv`, `writeJson`, `writeText`
- **Control** (8): `callWorkflow`, `execPowerShell`, `forEach`, `forEachFile`, `ifElse`, `multiTransform`, `setVariable`, `wait`
- **Integration** (1): `httpRequest`

## Input

### `listFiles` — 📂 List Files in Folder

Lists files in a specified folder with optional filters.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `folderPath` | file | yes | — | Path to the folder to list files from |
| `filter` | string | no | — | File pattern to filter (e.g., "*.csv", "*report*.xlsx") |
| `recursive` | boolean | no | — | Search recursively in subfolders (default: false) |
| `includeMetadata` | boolean | no | — | Include file size, modified date, etc. (default: true) |
| `excludeFolders` | string | no | — | Comma-separated folder names to exclude (e.g., "temp,archive") |

### `readCsv` — 📥 Read CSV

Reads a CSV file into a Dataset from a local file path.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `filePath` | file | yes | — | Absolute path or workspace-relative path of the CSV file |
| `delimiter` | select | no | — | Column delimiter (default: auto-detect) |
| `hasHeader` | boolean | no | — | First row contains column headers (default: true) |
| `encoding` | select | no | — | File encoding (default: UTF-8) |
| `skipRows` | number | no | — | Number of rows to skip at the beginning (default: 0) |
| `limitRows` | number | no | — | Maximum number of rows to read (0 = unlimited) |

**`delimiter` options:** `auto`, `,`, `;`, `	`, `|`

**`encoding` options:** `utf8`, `utf8-bom`, `ascii`, `latin1`

### `readExcel` — 📊 Read Excel

Reads an Excel file (.xlsx, .xls) into a Dataset with flexible options.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `filePath` | file | yes | — | Absolute or workspace-relative path to the Excel file |
| `sheetName` | string | no | — | Name of the sheet to read (default: first sheet) |
| `headerRow` | number | no | 1 | Row number containing column headers (1-based) |
| `startRow` | number | no | 2 | Row number to start reading data from (1-based) |
| `hasHeader` | boolean | no | — | Row specified in headerRow contains column headers (default: true) |
| `skipEmptyRows` | boolean | no | — | Skip rows that are completely empty (default: true) |
| `skipFooterRows` | number | no | — | Number of rows to skip at the bottom (default: 0) |
| `dateFormat` | select | no | — | Format for converting Excel dates (default: MM/DD/YYYY) |
| `dateDetection` | boolean | no | — | Automatically detect and convert date columns (default: true) |

**`dateFormat` options:** `MM/DD/YYYY`, `YYYY-MM-DD`, `DD/MM/YYYY`, `MM-DD-YYYY`, `DD-MM-YYYY`

### `readMongo` — 🍃 Read Mongo Collection

Reads documents from a MongoDB collection into a Dataset using a saved connection.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `connection` | connection | yes | — | Saved connection (created in the VizFlow Data Sources panel) |
| `database` | select | no | — | Database to read from (default: connection database) |
| `collection` | select | yes | — | Collection to read documents from |
| `filter` | text | no | — | Optional Mongo filter document, e.g. { "status": "active" } |
| `projection` | string | no | — | Columns to include, comma-separated or JSON (default: all) |
| `sort` | string | no | — | Sort as field:1 / field:-1 or JSON (default: natural order) |
| `limit` | number | no | 0 | Maximum documents to read (0 = up to 100,000) |

### `readSql` — 🗄️ Read SQL Table

Reads rows from a MySQL or PostgreSQL table into a Dataset using a saved connection.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `connection` | connection | yes | — | Saved connection (created in the VizFlow Data Sources panel) |
| `table` | select | yes | — | Table to read rows from |
| `columns` | columns | no | — | Columns to include (default: all) |
| `filterModel` | object | no | — | Filter built by the Data Sources visual query builder |
| `where` | text | no | — | Optional raw SQL WHERE clause without the WHERE keyword |
| `orderBy` | string | no | — | Optional ORDER BY expression, e.g. "created_at DESC" |
| `limit` | number | no | 1000 | Maximum rows to read (0 = up to 100,000) |

### `sampleData` — 🎲 Sample Data

Creates a sample dataset for testing purposes.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `rowCount` | number | no | 10 | Number of sample rows to generate (default: 10) |
| `columns` | string | no | — | Comma-separated column names (default: id, name, value, category, date) |

## Transformation

### `filter` — 🔍 Filter Rows

Filters rows based on a specified column condition.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `column` | string | yes | — | The column to apply the filter on |
| `operator` | select | yes | — | Comparison operator |
| `value` | string | no | — | Value to compare against (not required for null/empty operators) |

**`operator` options:** `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `startsWith`, `endsWith`, `regex`, `isNull`, `isNotNull`, `isEmpty`, `isNotEmpty`

### `removeDuplicates` — 🧹 Remove Duplicates

Removes duplicate rows based on a column, retaining the first occurrence.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `column` | string | yes | — | Column to evaluate for duplicates |
| `caseSensitive` | boolean | no | — | Treat values case-sensitively (default: true) |
| `keep` | select | no | — | Which duplicate occurrence to keep (default: first) |

**`keep` options:** `first`, `last`

### `selectColumns` — 📋 Select Columns

Selects or reorders specific columns from the dataset.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `columns` | string | yes | — | Comma-separated list of column names to keep (in order) |
| `includeAll` | boolean | no | — | If true, includes all other columns after the selected ones |

### `sort` — 📊 Sort Data

Sorts rows by one or more columns in ascending or descending order.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `sortBy` | string | yes | — | Column name to sort by |
| `order` | select | no | — | Sort order (default: ascending) |
| `numeric` | select | no | — | Sort numerically instead of alphabetically (default: auto-detect) |
| `caseSensitive` | boolean | no | — | Treat strings case-sensitively (default: false) |

**`order` options:** `asc`, `desc`

**`numeric` options:** `auto`, `true`, `false`

### `transform` — 🔄 Transform Column

Applies an expression operation to a column.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `column` | string | yes | — | The column to transform (can be a new column name as well) |
| `opKey` | select | yes | — | Expression operation to apply |
| `params` | string | no | — | Comma-separated parameters (see hint below for format) |
| `asNewColumn` | boolean | no | — | If checked, creates a new column instead of replacing existing |

**`opKey` options:** `upper`, `lower`, `titleCase`, `camelCase`, `snakeCase`, `kebabCase`, `trim`, `trimAll`, `clean`, `replace` (params: search, replace), `regexReplace` (params: pattern, replacement), `regexExtract` (params: pattern), `concat` (params: text1, text2, ...), `substring` (params: startIndex, endIndex (optional)), `len`, `countWords`, `reverse`, `padStart` (params: targetLength, padString), `padEnd` (params: targetLength, padString), `truncate` (params: maxLength, suffix (optional)), `slugify`, `extractNumber`, `add` (params: amount), `subtract` (params: amount), `multiply` (params: factor), `divide` (params: divisor), `power` (params: exponent), `sqrt`, `round`, `roundTo` (params: decimals), `ceil`, `floor`, `abs`, `clamp` (params: min, max), `sign`, `percentOf` (params: total), `increment` (params: step (optional)), `decrement` (params: step (optional)), `parseDate`, `formatDate` (params: format (YYYY-MM-DD, MM/DD/YYYY, etc.)), `extractDatePart` (params: part (year/month/day/hour/minute/second/weekday)), `addDays` (params: days), `dateDiff` (params: compareDate (optional), unit (days/hours/weeks/months/years)), `formatTime` (params: format (HH:mm, hh:mm A, etc.)), `coalesce` (params: fallbackValue), `isNull`, `isNumeric`, `isEmail`, `isPhone`, `isUrl`, `mask` (params: start, end, maskChar (optional)), `eq` (params: compareValue), `neq` (params: compareValue), `gt` (params: compareValue), `gte` (params: compareValue), `lt` (params: compareValue), `lte` (params: compareValue), `ifThen` (params: conditionValue, trueResult, falseResult), `switchCase` (params: case1,value1,case2,value2,...,default)

## Query

### `mongoQuery` — 🍃 Mongo Query

Runs an advanced read-only Mongo query with a raw filter document.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `connection` | connection | yes | — | Saved connection (created in the VizFlow Data Sources panel) |
| `database` | select | no | — | Database to query (default: connection database) |
| `collection` | select | yes | — | Collection to query |
| `filter` | text | yes | — | Mongo filter document to apply |
| `projection` | string | no | — | Columns to include, comma-separated or JSON |
| `sort` | string | no | — | Sort as field:1 / field:-1 or JSON |
| `limit` | number | no | 1000 | Maximum documents to return (0 = up to 100,000) |

### `previewQuery` — 👁️ Data Preview

Preview top rows from a dataset with optional filtering.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `limit` | number | no | 100 | Maximum number of rows to preview (default: 100) |
| `where` | string | no | — | Optional RBQL WHERE clause (e.g., "a1 > 100 AND a2 = 'Active'") |
| `orderBy` | string | no | — | Optional column to order by (e.g., "a1 DESC") |

### `query` — 📊 RBQL Query

Executes an RBQL query on the input dataset.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `query` | text | yes | — | RBQL SQL-like query (e.g. "SELECT a1, a2 WHERE a3 > 100") |
| `allowUpdate` | boolean | no | — | Allow UPDATE and DELETE operations (use with caution) |
| `timeoutMs` | number | no | 30000 | Query execution timeout in milliseconds (default: 30000) |

### `sqlQuery` — 🗄️ SQL Query

Runs an advanced read-only SQL SELECT against a saved connection.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `connection` | connection | yes | — | Saved connection (created in the VizFlow Data Sources panel) |
| `sql` | text | yes | — | Read-only SELECT query (single statement) |
| `limit` | number | no | 1000 | Maximum rows to return (0 = up to 100,000) |

## Analytics

### `aggregate` — 📈 Aggregate

Computes aggregation (sum, average, min, max, count, etc.) on a column.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `column` | string | yes | — | The column to aggregate |
| `operation` | select | yes | — | Aggregation function |
| `skipNulls` | boolean | no | — | Skip null/undefined values in calculation (default: true) |
| `asColumn` | string | no | — | Custom name for the result column (default: operation_column) |

**`operation` options:** `sum`, `average`, `mean`, `min`, `max`, `count`, `distinct`, `median`, `stdDev`, `variance`

### `columnStats` — 📈 Column Statistics

Generates statistics for specified columns.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `columns` | string | yes | — | Comma-separated list of column names to analyze |
| `stats` | select | no | — | Which statistics to compute (default: all) |

**`stats` options:** `all`, `basic`, `quality`

### `dataProfile` — 📋 Data Profile

Generates a comprehensive profile of the dataset with statistics for each column.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `columns` | string | no | — | Comma-separated list of columns (leave empty for all columns) |
| `includeStats` | select | no | — | Which statistics to include (default: all) |
| `maxDistinctValues` | number | no | 10 | Maximum number of distinct values to show in profile |

**`includeStats` options:** `all`, `basic`, `numeric`, `string`

### `groupBy` — 📊 Group By

Groups data by a column and computes aggregations for each group.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `groupColumn` | string | yes | — | Column to group by |
| `aggregateColumn` | string | yes | — | Column to aggregate within each group |
| `operation` | select | yes | — | Aggregation function for each group |
| `skipNulls` | boolean | no | — | Skip null/undefined values in calculation (default: true) |
| `sortBy` | select | no | — | Sort order for results (default: groupAsc) |

**`operation` options:** `sum`, `average`, `mean`, `min`, `max`, `count`, `median`, `stdDev`, `first`, `last`

**`sortBy` options:** `groupAsc`, `groupDesc`, `aggAsc`, `aggDesc`, `none`

## Output

### `appendText` — 📄 Append to Text File

Appends data to an existing text file (creates file if it doesn't exist).

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `filePath` | file | yes | — | Absolute path or workspace-relative path of the text file to append to |
| `content` | select | yes | — | Source of the content to append |
| `variableName` | string | no | — | Name of the variable containing the content (for variable source) |
| `customText` | text | no | — | Custom text content to append (for custom source) |
| `format` | select | no | — | Format for dataset output (default: plain) |
| `includeHeader` | boolean | no | — | Include column headers in output (default: true) |
| `delimiter` | select | no | — | Column delimiter for CSV format (default: comma) |
| `addNewline` | boolean | no | — | Add a newline before appending (default: true) |
| `encoding` | select | no | — | File encoding (default: UTF-8) |

**`content` options:** `dataset`, `variable`, `custom`

**`format` options:** `plain`, `csv`, `json`, `table`

**`delimiter` options:** `,`, `;`, `	`, `|`

**`encoding` options:** `utf8`, `utf8-bom`, `ascii`, `latin1`

### `exportMultiple` — 📦 Export Multiple Files

Exports dataset to multiple formats or splits into multiple files.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `outputDir` | file | yes | — | Directory where files will be written |
| `baseName` | string | no | "output" | Base name for output files (default: "output") |
| `formats` | select | no | — | Export formats (default: CSV) |
| `splitBy` | number | no | 0 | Split into multiple files with this many rows per file (0 = no split) |
| `delimiter` | select | no | — | Column delimiter for CSV (default: comma) |

**`formats` options:** `csv`, `json`, `both`

**`delimiter` options:** `,`, `;`, `	`

### `writeCsv` — 💾 Write CSV

Writes the current dataset to a local CSV file path.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `filePath` | file | yes | — | Absolute path or workspace-relative path of the output CSV file |
| `delimiter` | select | no | — | Column delimiter (default: comma) |
| `header` | boolean | no | — | Include column headers in output (default: true) |
| `encoding` | select | no | — | File encoding (default: UTF-8) |
| `overwrite` | boolean | no | — | Overwrite existing file if it exists (default: true) |
| `quoteChar` | select | no | — | Character used to quote fields (default: double quote) |
| `escapeChar` | select | no | — | Character used to escape quotes (default: double quote) |
| `nullValue` | string | no | — | How to represent null/undefined values (default: empty string) |
| `timestampSuffix` | boolean | no | — | Add timestamp to filename to avoid overwriting (default: false) |

**`delimiter` options:** `,`, `;`, `	`, `|`

**`encoding` options:** `utf8`, `utf8-bom`, `ascii`, `latin1`

**`quoteChar` options:** `"`, `'`

**`escapeChar` options:** `"`, `\`

### `writeJson` — 📝 Write JSON

Writes the current dataset to a local JSON file.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `filePath` | file | yes | — | Absolute path or workspace-relative path of the output JSON file |
| `format` | select | no | — | JSON formatting style (default: pretty) |
| `overwrite` | boolean | no | — | Overwrite existing file if it exists (default: true) |
| `timestampSuffix` | boolean | no | — | Add timestamp to filename to avoid overwriting (default: false) |

**`format` options:** `pretty`, `compact`

### `writeText` — 📄 Write Text File

Writes data to a plain text file with customizable formatting.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `filePath` | file | yes | — | Absolute path or workspace-relative path of the output text file |
| `content` | select | yes | — | Source of the content to write |
| `variableName` | string | no | — | Name of the variable containing the content (for variable source) |
| `customText` | text | no | — | Custom text content to write (for custom source) - supports {{variable}} placeholders |
| `format` | select | no | — | Format for dataset output (default: plain) |
| `includeHeader` | boolean | no | — | Include column headers in output (default: true) |
| `delimiter` | select | no | — | Column delimiter for CSV format (default: comma) |
| `encoding` | select | no | — | File encoding (default: UTF-8) |
| `overwrite` | boolean | no | — | Overwrite existing file if it exists (default: true) |
| `timestampSuffix` | boolean | no | — | Add timestamp to filename to avoid overwriting (default: false) |

**`content` options:** `dataset`, `variable`, `custom`

**`format` options:** `plain`, `csv`, `json`, `table`

**`delimiter` options:** `,`, `;`, `	`, `|`

**`encoding` options:** `utf8`, `utf8-bom`, `ascii`, `latin1`

## Control

### `callWorkflow` — 🔗 Call Workflow

Runs another .vizflow workflow as a reusable sub-workflow, passing parameters and receiving its final dataset and variables.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `workflowPath` | file | yes | — | Path to the .vizflow workflow to run (absolute or relative to the workspace) |
| `parameters` | keyValue | no | — | Values to pass into the sub-workflow parameters ({{variable}} interpolation supported) |
| `exportVariables` | boolean | no | true | Copy sub-workflow variables (set via Set Variable) back into the caller (default: true) |
| `outputMode` | select | no | — | What the activity produces as its output dataset |

**`outputMode` options:** `passthrough`, `keepCaller`

### `execPowerShell` — ⚡ Execute PowerShell Script

Executes a PowerShell script file or command.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `sourceType` | select | yes | — | Whether to run a script file or inline command |
| `scriptPath` | file | no | — | Path to the .ps1 script file (for script file source) |
| `command` | text | no | — | PowerShell command to execute (for inline source) |
| `parameters` | text | no | — | JSON object of named parameters to pass to the script |
| `outputVariable` | string | no | — | Variable name to store the output (for use in later steps) |
| `parseOutput` | select | no | — | How to parse the PowerShell output (default: text) |

**`sourceType` options:** `file`, `inline`

**`parseOutput` options:** `text`, `json`, `csv`

### `forEach` — 🔁 For-Each Block

Groups rows by a column value and runs the inner steps on each group independently. Results are merged back in order.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `groupBy` | string | yes | — | Column whose distinct values define the groups (e.g. "region", "category") |
| `sortGroups` | select | no | — | Order in which group keys are processed (default: none) |
| `maxGroups` | number | no | — | Maximum number of groups to process (0 = unlimited) |
| `continueOnError` | boolean | no | — | Continue processing other groups if one fails (default: false) |

**`sortGroups` options:** `none`, `asc`, `desc`

- **Nested `steps`:** Array of activity objects to run per group. Placeholders like {{row.Column}} resolve against a sample row of the group.
- **Loop variables:** {{row.Column}} (sample row of the group)

### `forEachFile` — 🔄 For-Each File in Folder

Executes inner steps for each file in a folder.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `folderPath` | file | yes | — | Path to the folder to process files from |
| `fileFilter` | string | no | — | File pattern to filter (e.g., "*.csv", "*.xlsx") |
| `recursive` | boolean | no | — | Search recursively in subfolders (default: false) |
| `maxFiles` | number | no | — | Maximum number of files to process (0 = unlimited) |
| `continueOnError` | boolean | no | — | Continue processing other files if one fails (default: false) |
| `mergeResults` | boolean | no | — | Merge each file's inner output into one dataset (default: false — only the last file's dataset is kept) |

- **Nested `steps`:** Array of activity objects to run per file. Loop variables available: {{filePath}}, {{fileName}}, {{fileExtension}}, {{currentFile}}.
- **Loop variables:** {{filePath}}, {{fileName}}, {{fileExtension}}, {{currentFile}}

### `ifElse` — 🔀 If-Else Block

Splits rows by condition: matching rows go through the THEN branch, non-matching through the ELSE branch.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `column` | string | yes | — | Column to evaluate the condition on |
| `operator` | select | yes | — | Comparison operator for the condition |
| `value` | string | no | — | Value to compare against (not needed for isEmpty / isNotEmpty) |
| `caseSensitive` | boolean | no | — | Treat strings case-sensitively (default: true) |

**`operator` options:** `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `startsWith`, `endsWith`, `isEmpty`, `isNotEmpty`, `regex`

- **Nested `thenSteps`:** Array of activity objects to run when the condition matches.
- **Nested `elseSteps`:** Array of activity objects to run when the condition does not match.
- **Loop variables:** none

### `multiTransform` — ⚡ Multi-Transform

Applies multiple column operations in sequence within a single step.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `actions` | multiAction | yes | — | List of transform operations to apply in order |
| `stopOnError` | boolean | no | — | Stop processing if any action fails (default: true) |

**`actions` operations:** `upper`, `lower`, `titleCase`, `trim`, `replace`, `concat`, `substring`, `len`, `padStart`, `padEnd`, `add`, `subtract`, `multiply`, `divide`, `power`, `round`, `abs`, `parseDate`, `formatDate`, `addDays`, `extractDatePart`, `dateDiff`, `formatTime`, `coalesce`, `startsWith`, `endsWith`, `contains`, `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `ifThen`, `regexExtract`, `clean`

### `setVariable` — 📝 Set Variable

Set a variable value for use in later steps.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `variableName` | string | yes | — | Name of the variable to set |
| `sourceType` | select | yes | — | Where to get the value from |
| `value` | string | no | — | Static value to store (for static source type) |
| `column` | string | no | — | Column to extract value from (for column source type) |
| `expression` | text | no | — | JavaScript expression to evaluate (use {{variable}} for variable substitution) |
| `sourceVariable` | string | no | — | Variable to copy from (for variable source type) |
| `jsonPath` | string | no | — | JSON path to extract value from source object (e.g., "data.user.name") |
| `rowIndex` | number | no | 0 | Row index to extract from (for column source type) |
| `defaultValue` | string | no | — | Default value if source value is undefined or null |

**`sourceType` options:** `static`, `column`, `expression`, `variable`, `jsonPath`

### `wait` — ⏳ Wait

Pauses workflow execution for a specified duration.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `duration` | number | yes | 5 | Number of seconds to wait (minimum: 1) |
| `maxDuration` | number | no | — | Maximum duration to wait (0 = unlimited) |
| `condition` | string | no | — | Expression to evaluate as wait condition (e.g., "{{progress}} < 100") |

## Integration

### `httpRequest` — 🌐 HTTP Request

Calls a REST API (GET/POST/PUT/PATCH/DELETE/…) and converts the JSON response into a Dataset. {{variable}} interpolation is supported in URL, headers, query and body.

| Config field | Type | Required | Default | Description |
|--------------|------|----------|---------|-------------|
| `url` | string | yes | — | Request URL — {{variable}} interpolation supported |
| `method` | select | yes | "GET" | HTTP method to use |
| `headers` | text | no | — | JSON object of request headers (may include Authorization) |
| `queryParams` | text | no | — | JSON object appended to the URL as query string parameters |
| `contentType` | select | no | "json" | How the request body is interpreted |
| `body` | text | no | — | Request body — JSON when content type is json, {{variable}} interpolation supported |
| `responsePath` | string | no | — | Dot path into the response where the data array/object lives (e.g. "data.items"). Leave empty to use the whole body. |
| `timeout` | number | no | 30 | Request timeout in seconds |
| `maxResponseRows` | number | no | 10000 | Maximum rows to keep when the response is an array |
| `ignoreErrorStatus` | boolean | no | false | When enabled, error status responses are kept as data instead of failing the workflow |

**`method` options:** `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`

**`contentType` options:** `json`, `text`, `form`


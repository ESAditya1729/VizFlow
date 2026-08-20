/**
 * services/rbqlService.js
 *
 * RBQL query engine wrapper for VizFlow.
 * Uses the official rbql library to execute SQL-like queries on CSV data.
 */

const rbql = require('rbql');

// ── IN operator fix ──────────────────────────────────────────────────────────
// RBQL v0.30 translates `IN (...)` to JavaScript's native `in` operator,
// which checks property keys in objects — not values in arrays.  We
// pre-process the query to replace `expr IN (...)` / `expr IN [...]` with a
// call to a custom IN_LIST() function injected via user_init_code.

const IN_LIST_FN = `
function IN_LIST(val, lst) {
  if (!Array.isArray(lst)) return false;
  for (var i = 0; i < lst.length; i++) {
    if (lst[i] == val) return true;
  }
  return false;
}
`;

/**
 * Replace `expr IN (...)` and `expr IN [...]` with `IN_LIST(expr, [...])`.
 *
 * The left-hand side can be an identifier (a1, column_name), a dotted
 * reference (a1.field), or a function call (UPPER(a1)).  We match
 * everything up to the `IN` keyword using a lookbehind-style approach:
 * scan from the end of the match backwards to capture the expression.
 *
 * @param {string} query
 * @returns {string}
 */
function preprocessInOperator(query) {
    // Match: <something> IN ( ... ) or <something> IN [ ... ]
    // The <something> is captured by looking at what precedes IN.
    // We use a regex that matches:
    //   1. A closing paren/bracket/identifier char followed by IN
    //   2. Then the list literal (parenthesized or bracketed)
    //
    // Pattern explanation:
    //   ([\w\.)]+)      – capture group 1: the LHS expression (identifier, dotted ref)
    //   \s+IN\s+        – the IN keyword surrounded by whitespace
    //   ([\(\[])        – capture group 2: opening delimiter ( or [
    //   ([\s\S]*?)      – capture group 3: the list contents (non-greedy)
    //   ([\)\]])        – capture group 4: closing delimiter ) or ]

    return query.replace(
        /([\w.]+)\s+IN\s+([\(\[])([\s\S]*?)([\)\]])/gi,
        function (match, lhs, open, contents, close) {
            // Normalise single-quoted strings in the list to double-quoted
            // so the result is valid JS for the user_init_code context.
            // e.g.  ('A', 'B') → ["A","B"]
            const normalised = contents
                .replace(/'([^']*)'/g, '"$1"')
                .replace(/\s+/g, '');

            // If the list is empty, return a false condition
            if (!normalised) return 'false';

            return 'IN_LIST(' + lhs + ', [' + normalised + '])';
        }
    );
}

/**
 * @typedef {{
 *   success: boolean,
 *   columns?: string[],
 *   rows?: any[][],
 *   rowCount?: number,
 *   warnings?: string[],
 *   query?: string,
 *   backend?: string,
 *   hasHeader?: boolean,
 *   error?: string,
 * }} QueryResult
 */

/**
 * Execute an RBQL query on a dataset.
 *
 * rbql.query_table signature (v0.30):
 *   async query_table(query_text, input_table, output_table, output_warnings,
 *                     join_table?, input_column_names?, join_column_names?,
 *                     output_column_names?, normalize_column_names?, user_init_code?)
 *
 * @param {import('../engine/dataset')} dataset - Parsed CSV dataset
 * @param {string} query - RBQL query string
 * @param {Object} [opts] - Query options
 * @param {boolean} [opts.hasHeader] - Whether CSV has header row (default: true)
 * @param {import('../engine/dataset')} [opts.joinDataset] - Optional second dataset for JOINs
 * @returns {Promise<QueryResult>}
 */
async function executeQuery(dataset, query, opts = {}) {
    const {
        hasHeader = true,
        joinDataset = null,
    } = opts;

    const header = dataset.getColumns();

    // Build a flat array-of-arrays table; rbql works on positional columns (a1, a2, …)
    // We pass the header separately via input_column_names so named references work too.
    /** @type {any[][]} */
    const inputTable = dataset.rows.map(row =>
        header.map(col => (row[col] !== undefined && row[col] !== null ? String(row[col]) : ''))
    );

    // Build join table if a join dataset was provided
    let joinTable = null;
    let joinColumnNames = null;
    if (joinDataset) {
        const joinHeader = joinDataset.getColumns();
        joinTable = joinDataset.rows.map(row =>
            joinHeader.map(col => (row[col] !== undefined && row[col] !== null ? String(row[col]) : ''))
        );
        joinColumnNames = hasHeader ? joinHeader : null;
    }

    /** @type {any[][]} */
    const outputTable = [];
    /** @type {string[]} */
    const outputWarnings = [];
    /** @type {string[]} */
    const outputColumnNames = [];

    try {
        // Pre-process query: replace IN (...) / IN [...] with IN_LIST()
        const processedQuery = preprocessInOperator(query);

        await rbql.query_table(
            processedQuery,
            inputTable,
            outputTable,
            outputWarnings,
            /* join_table        */ joinTable,
            /* input_column_names*/ hasHeader ? header : null,
            /* join_column_names */ joinColumnNames,
            /* output_col_names  */ outputColumnNames,
            /* normalize_col_names */ true,
            /* user_init_code    */ IN_LIST_FN
        );

        // outputColumnNames is populated by rbql when output_column_names arg is provided
        const resultColumns = outputColumnNames.length > 0
            ? outputColumnNames
            : outputTable.length > 0
                ? outputTable[0].map((_, i) => `col${i + 1}`)
                : [];

        /** @type {QueryResult} */
        return {
            success: true,
            columns: resultColumns,
            rows: outputTable,
            rowCount: outputTable.length,
            warnings: outputWarnings,
            query,
            backend: 'js',
            hasHeader
        };

    } catch (err) {
        /** @type {QueryResult} */
        return {
            success: false,
            error: err.message || 'Unknown error occurred',
            query,
            backend: 'js'
        };
    }
}

/**
 * Validate query syntax without executing.
 *
 * @param {string} query - RBQL query string
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateQuery(query) {
    if (!query || !query.trim()) {
        return { valid: false, error: 'Query must not be empty' };
    }

    if (!/select\s+/i.test(query) && !/update\s+/i.test(query)) {
        return { valid: false, error: 'Query must start with SELECT or UPDATE' };
    }

    if (query.includes(';;')) {
        return { valid: false, error: 'Query contains double semicolons' };
    }

    return { valid: true, error: null };
}

/**
 * Format query results for display.
 *
 * @param {QueryResult} result
 * @param {'table'|'csv'|'json'} [format]
 * @returns {string | { columns: string[], rows: any[][], rowCount: number }}
 */
function formatResult(result, format = 'table') {
    if (!result.success) {
        return `Error: ${result.error}`;
    }

    const { columns, rows } = result;

    switch (format) {
        case 'csv': {
            const headerRow = columns.join(',');
            const dataRows = rows.map(row => row.join(','));
            return [headerRow, ...dataRows].join('\n');
        }

        case 'json': {
            const data = rows.map(row => {
                /** @type {Object.<string, any>} */
                const obj = {};
                columns.forEach((col, idx) => { obj[col] = row[idx]; });
                return obj;
            });
            return JSON.stringify(data, null, 2);
        }

        case 'table':
        default:
            return { columns, rows, rowCount: rows.length };
    }
}

module.exports = {
    executeQuery,
    validateQuery,
    formatResult
};

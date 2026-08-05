/**
 * services/rbqlService.js
 *
 * RBQL query engine wrapper for VizFlow.
 * Uses the official rbql library to execute SQL-like queries on CSV data.
 */

const rbql = require('rbql');

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
 * @returns {Promise<QueryResult>}
 */
async function executeQuery(dataset, query, opts = {}) {
    const {
        hasHeader = true,
    } = opts;

    const header = dataset.getColumns();

    // Build a flat array-of-arrays table; rbql works on positional columns (a1, a2, …)
    // We pass the header separately via input_column_names so named references work too.
    /** @type {any[][]} */
    const inputTable = dataset.rows.map(row =>
        header.map(col => (row[col] !== undefined && row[col] !== null ? String(row[col]) : ''))
    );

    /** @type {any[][]} */
    const outputTable = [];
    /** @type {string[]} */
    const outputWarnings = [];
    /** @type {string[]} */
    const outputColumnNames = [];

    try {
        await rbql.query_table(
            query,
            inputTable,
            outputTable,
            outputWarnings,
            /* join_table        */ null,
            /* input_column_names*/ hasHeader ? header : null,
            /* join_column_names */ null,
            /* output_col_names  */ outputColumnNames,
            /* normalize_col_names */ true,
            /* user_init_code    */ ''
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

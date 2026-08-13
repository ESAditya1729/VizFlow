/**
 * engine/expressions/evaluator.js
 *
 * Expression evaluator for transform operations.
 * Maintains the pipeline by ensuring each operation returns a new dataset.
 */

const { OPERATIONS } = require('./operations');
const Dataset = require('../dataset');

/**
 * Apply a single operation to every row of `rows` on `column`.
 *
 * @param {Record<string, any>[]}  rows        - Dataset rows (plain objects keyed by column name)
 * @param {string}    column      - Column to read the input value from
 * @param {string}    opName      - Key into OPERATIONS (e.g. "upper", "add")
 * @param {string[]}  [rawParams] - Extra user-supplied parameters as strings
 * @returns {{ row: object, original: any, result: any, skipped: boolean }[]}
 */
function evaluate(rows, column, opName, rawParams = []) {
    const op = OPERATIONS[opName];
    if (!op) {
        throw new Error(`Unknown operation: "${opName}". Available: ${Object.keys(OPERATIONS).join(', ')}`);
    }

    // Check if column exists in the first row
    if (rows.length > 0 && !(column in rows[0])) {
        throw new Error(`Column "${column}" not found in dataset. Available columns: ${Object.keys(rows[0]).join(', ')}`);
    }

    return rows.map((row, index) => {
        const original = row[column];

        let result;
        try {
            result = op.fn(original, ...rawParams);
        } catch (err) {
            throw new Error(`Row ${index + 1} (${column}="${original}"): ${err instanceof Error ? err.message : String(err)}`);
        }

        return { row, original, result, skipped: false };
    });
}

/**
 * Apply operation and return a new dataset with the transformed column.
 * This is the pipeline-safe version that creates a new dataset.
 *
 * @param {Dataset} dataset - Input dataset
 * @param {string} column - Column to transform (can be a new column name)
 * @param {string} opName - Operation key
 * @param {string[]} rawParams - Parameters
 * @returns {Dataset} New dataset with transformed column
 */
function transformDataset(dataset, column, opName, rawParams = []) {
    // Get rows - handle both Dataset objects and plain arrays
    const rows = dataset.getRows ? dataset.getRows() : dataset.rows;
    if (!rows || rows.length === 0) {
        // Return empty dataset if no rows
        return new Dataset([], []);
    }
    
    const columns = dataset.getColumns ? dataset.getColumns() : Object.keys(rows[0] || {});
    
    // Check if column exists
    const columnExists = columns.includes(column);
    
    let results;
    
    if (columnExists) {
        // Column exists - use it as source
        results = evaluate(rows, column, opName, rawParams);
    } else {
        // Column doesn't exist - create it from other column or use empty
        // For operations that need a source, try to use the first column or an empty value
        const sourceColumn = columns.length > 0 ? columns[0] : null;
        
        if (sourceColumn) {
            // Use the first available column as source
            results = evaluate(rows, sourceColumn, opName, rawParams);
        } else {
            // No columns exist - create from empty
            results = rows.map(row => ({
                row,
                original: '',
                result: opName === 'multiply' ? 0 : (opName === 'concat' ? '' : '')
            }));
        }
    }
    
    // Build new rows with transformed values
    const newRows = results.map(({ row, result }) => ({
        ...row,
        [column]: result
    }));

    // Ensure column exists in columns list
    let newColumns = [...columns];
    if (!newColumns.includes(column)) {
        newColumns.push(column);
    }

    // Return a new Dataset instance
    return new Dataset(newRows, newColumns);
}

/**
 * Apply a single operation to only the rows whose 0-based index appears in
 * `targetIndices`. Rows not in the set are returned unchanged with
 * `skipped: true` so callers can distinguish them in preview tables.
 *
 * @param {Record<string, any>[]}  rows          - Full dataset rows
 * @param {number[]}               targetIndices - 0-based row indices to transform
 * @param {string}                 column        - Column to operate on
 * @param {string}                 opName        - Key into OPERATIONS
 * @param {string[]}               [rawParams]   - Extra user-supplied parameters
 * @returns {{ row: object, original: any, result: any, skipped: boolean }[]}
 */
function evaluateRows(rows, targetIndices, column, opName, rawParams = []) {
    const op = OPERATIONS[opName];
    if (!op) {
        throw new Error(`Unknown operation: "${opName}". Available: ${Object.keys(OPERATIONS).join(', ')}`);
    }

    // Validate column exists
    if (rows.length > 0 && !(column in rows[0])) {
        throw new Error(`Column "${column}" not found in dataset. Available columns: ${Object.keys(rows[0]).join(', ')}`);
    }

    const indexSet = new Set(targetIndices);

    return rows.map((row, index) => {
        const original = row[column];

        if (!indexSet.has(index)) {
            return { row, original, result: original, skipped: true };
        }

        let result;
        try {
            result = op.fn(original, ...rawParams);
        } catch (err) {
            throw new Error(`Row ${index + 1} (${column}="${original}"): ${err instanceof Error ? err.message : String(err)}`);
        }

        return { row, original, result, skipped: false };
    });
}

/**
 * Run the operation on only the first `limit` rows — useful for showing a
 * live preview without processing the entire file.
 *
 * @param {object[]}  rows
 * @param {string}    column
 * @param {string}    opName
 * @param {string[]}  rawParams
 * @param {number}    [limit=5]
 * @returns {{ row: object, original: any, result: any }[]}
 */
function previewFirst(rows, column, opName, rawParams = [], limit = 5) {
    return evaluate(rows.slice(0, limit), column, opName, rawParams);
}

/**
 * Build a human-readable summary line for a single preview entry.
 * @param {{ original: any, result: any }} entry
 * @param {string} column
 * @param {string} opName
 */
function formatPreviewLine(entry, column, opName) {
    return `  ${column}: ${JSON.stringify(entry.original)}  →  ${JSON.stringify(entry.result)}  [${opName}]`;
}

/**
 * Get all available operations grouped by category
 * @returns {Object} Operations grouped by category
 */
function getOperationsByCategory() {
    const grouped = {};
    for (const [name, op] of Object.entries(OPERATIONS)) {
        const category = op.category || 'Other';
        if (!grouped[category]) grouped[category] = [];
        grouped[category].push({
            name,
            description: op.description || '',
            paramDefs: op.paramDefs || []
        });
    }
    return grouped;
}

module.exports = {
    evaluate,
    evaluateRows,
    transformDataset,
    previewFirst,
    formatPreviewLine,
    getOperationsByCategory,
    OPERATIONS
};
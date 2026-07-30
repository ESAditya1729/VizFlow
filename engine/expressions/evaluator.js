/**
 * Expression evaluator.
 *
 * Applies a named operation (from operations.js) to every row in a dataset,
 * producing a new column or a result array that callers can display.
 *
 * Usage:
 *   const { evaluate, evaluateRows, previewFirst } = require('./evaluator');
 *   const results = evaluate(dataset.rows, 'salary', 'multiply', ['1.1']);
 *   // results → Array<{ row: object, original: any, result: any, skipped: boolean }>
 */

const { OPERATIONS } = require('./operations');

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
 * Apply a single operation to only the rows whose 0-based index appears in
 * `targetIndices`.  Rows not in the set are returned unchanged with
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

module.exports = {
    evaluate,
    evaluateRows,
    previewFirst,
    formatPreviewLine,
};

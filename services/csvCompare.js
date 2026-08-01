/**
 * services/csvCompare.js
 *
 * Pure comparison engine — no VS Code dependencies.
 * Accepts two parsed Dataset objects, column names for each, and returns a
 * structured ComparisonResult ready for the webview.
 */

/**
 * Infer a simple data-type label from the values of a column.
 *
 * @param {any[]} values
 * @returns {'number' | 'date' | 'boolean' | 'string'}
 */
function inferType(values) {
    const nonNull = values.filter(v => v !== null && v !== undefined && v !== '');
    if (nonNull.length === 0) return 'string';
    if (nonNull.every(v => typeof v === 'number')) return 'number';
    if (nonNull.every(v => typeof v === 'boolean')) return 'boolean';
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
    if (nonNull.every(v => ISO_DATE.test(String(v)))) return 'date';
    return 'string';
}

/**
 * Build a column profile (distinct count, null count, inferred type).
 *
 * @param {any[]} rows
 * @param {string} column
 * @returns {{ distinctCount: number, nullCount: number, dataType: string }}
 */
function profileColumn(rows, column) {
    const values = rows.map(r => r[column]);
    const nullCount = values.filter(v => v === null || v === undefined || v === '').length;
    const distinct = new Set(values.filter(v => v !== null && v !== undefined && v !== '').map(String));
    return {
        distinctCount: distinct.size,
        nullCount,
        dataType: inferType(values),
    };
}

/**
 * @typedef {{
 *   value: string,
 *   type: 'onlyA' | 'onlyB' | 'common',
 *   rowsA: number[],
 *   rowsB: number[],
 *   countA: number,
 *   countB: number,
 * }} ComparisonRow
 *
 * @typedef {{
 *   totalRowsA: number,
 *   totalRowsB: number,
 *   matchCount: number,
 *   onlyACount: number,
 *   onlyBCount: number,
 *   columnA: string,
 *   columnB: string,
 *   profileA: { distinctCount: number, nullCount: number, dataType: string },
 *   profileB: { distinctCount: number, nullCount: number, dataType: string },
 *   rows: ComparisonRow[],
 * }} ComparisonResult
 */

/**
 * Compare two columns from two datasets using set-based logic.
 *
 * Each distinct value is classified as:
 *   - 'onlyA'  — present in File A column but not in File B column
 *   - 'onlyB'  — present in File B column but not in File A column
 *   - 'common' — present in both
 *
 * Row-number arrays (1-based) tell the user where each value appears.
 *
 * @param {import('../engine/dataset')} datasetA
 * @param {string} columnA
 * @param {import('../engine/dataset')} datasetB
 * @param {string} columnB
 * @param {{ onProgress?: (pct: number) => void }} [opts]
 * @returns {ComparisonResult}
 */
function compare(datasetA, columnA, datasetB, columnB, opts = {}) {

    const { onProgress } = opts;

    // ── Build value → row-list maps ────────────────────────────────────────────
    /** @type {Map<string, number[]>} */
    const mapA = new Map();
    /** @type {Map<string, number[]>} */
    const mapB = new Map();

    const rowsA = datasetA.rows;
    const rowsB = datasetB.rows;

    for (let i = 0; i < rowsA.length; i++) {
        const v = rowsA[i][columnA];
        if (v === null || v === undefined || v === '') continue;
        const key = String(v);
        if (!mapA.has(key)) mapA.set(key, []);
        /** @type {number[]} */ (mapA.get(key)).push(i + 1);  // 1-based row numbers
    }

    if (onProgress) onProgress(40);

    for (let i = 0; i < rowsB.length; i++) {
        const v = rowsB[i][columnB];
        if (v === null || v === undefined || v === '') continue;
        const key = String(v);
        if (!mapB.has(key)) mapB.set(key, []);
        /** @type {number[]} */ (mapB.get(key)).push(i + 1);
    }

    if (onProgress) onProgress(70);

    // ── Classify all distinct values ────────────────────────────────────────────
    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

    /** @type {ComparisonRow[]} */
    const rows = [];
    let matchCount = 0;
    let onlyACount = 0;
    let onlyBCount = 0;

    for (const key of allKeys) {
        const inA = mapA.has(key);
        const inB = mapB.has(key);
        const rowsAList = inA ? (mapA.get(key) || []) : [];
        const rowsBList = inB ? (mapB.get(key) || []) : [];

        /** @type {'onlyA' | 'onlyB' | 'common'} */
        let type;
        if (inA && inB) {
            type = 'common';
            matchCount++;
        } else if (inA) {
            type = 'onlyA';
            onlyACount++;
        } else {
            type = 'onlyB';
            onlyBCount++;
        }

        rows.push({
            value: key,
            type,
            rowsA: rowsAList,
            rowsB: rowsBList,
            countA: rowsAList.length,
            countB: rowsBList.length,
        });
    }

    if (onProgress) onProgress(90);

    // ── Column profiles ─────────────────────────────────────────────────────────
    const profileA = profileColumn(rowsA, columnA);
    const profileB = profileColumn(rowsB, columnB);

    if (onProgress) onProgress(100);

    return {
        totalRowsA: rowsA.length,
        totalRowsB: rowsB.length,
        matchCount,
        onlyACount,
        onlyBCount,
        columnA,
        columnB,
        profileA,
        profileB,
        rows,
    };
}

module.exports = { compare };

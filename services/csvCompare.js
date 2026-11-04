/**
 * services/csvCompare.js
 *
 * Pure comparison engine — no VS Code dependencies.
 *
 * Two comparison modes are supported:
 *   - values: compare the distinct values of one column from each dataset
 *   - rows:   compare records using one or more key columns and report
 *             added / removed / changed / unchanged rows
 *
 * Both modes share the same normalization pipeline so values such as
 * " 1 ", "1" and "1.0" can be treated as equal when the caller opts in.
 */

const KEY_SEPARATOR = '\u0001';

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
 *   trim?: boolean,
 *   caseInsensitive?: boolean,
 *   emptyAsNull?: boolean,
 *   numeric?: boolean,
 *   date?: boolean,
 * }} NormalizationOptions
 */

/**
 * Normalize the raw engine options, filling in safe defaults.
 *
 * @param {Object} [options]
 * @returns {{
 *   mode: 'values' | 'rows',
 *   includeEmpty: boolean,
 *   normalization: Required<NormalizationOptions>,
 *   keyColumnsA: string[],
 *   keyColumnsB: string[],
 *   compareColumns: { a: string, b: string }[],
 * }}
 */
function normalizeOptions(options = {}) {
    const rawNormalization = options.normalization || {};
    return {
        mode: options.mode === 'rows' ? 'rows' : 'values',
        includeEmpty: options.includeEmpty === true,
        normalization: {
            trim: rawNormalization.trim === true,
            caseInsensitive: rawNormalization.caseInsensitive === true,
            emptyAsNull: rawNormalization.emptyAsNull !== false,
            numeric: rawNormalization.numeric === true,
            date: rawNormalization.date === true,
        },
        keyColumnsA: Array.isArray(options.keyColumnsA) ? options.keyColumnsA.filter(Boolean) : [],
        keyColumnsB: Array.isArray(options.keyColumnsB) ? options.keyColumnsB.filter(Boolean) : [],
        compareColumns: Array.isArray(options.compareColumns)
            ? options.compareColumns
                .map(pair => {
                    if (typeof pair === 'string') return { a: pair, b: pair };
                    if (pair && typeof pair === 'object') return { a: pair.a, b: pair.b };
                    return null;
                })
                .filter(pair => pair && pair.a && pair.b)
            : [],
    };
}

/**
 * Normalize one cell to a canonical comparison key.
 *
 * @param {any} value
 * @param {Required<NormalizationOptions>} normalization
 * @returns {{ key: string, blank: boolean }}
 */
function normalizeValue(value, normalization) {
    if (value === null || value === undefined) {
        return { key: '', blank: true };
    }

    let text = String(value);

    if (normalization.trim) text = text.trim();

    if (text === '') {
        return { key: '', blank: true };
    }

    if (normalization.numeric) {
        const numeric = Number(text.replace(/,/g, ''));
        if (!Number.isNaN(numeric) && isFinite(numeric)) {
            return { key: '#n:' + String(numeric), blank: false };
        }
    }

    if (normalization.date) {
        const timestamp = Date.parse(text);
        if (!Number.isNaN(timestamp)) {
            return { key: '#d:' + String(timestamp), blank: false };
        }
    }

    if (normalization.caseInsensitive) text = text.toLowerCase();

    return { key: text, blank: false };
}

/**
 * Build a canonical composite key from the selected columns.
 *
 * @param {Object} row
 * @param {string[]} columns
 * @param {Required<NormalizationOptions>} normalization
 * @returns {{ key: string, blank: boolean }}
 */
function buildKey(row, columns, normalization) {
    const parts = [];
    let anyValue = false;

    for (const column of columns) {
        const normalized = normalizeValue(row[column], normalization);
        if (!normalized.blank) anyValue = true;
        parts.push(normalized.key);
    }

    return {
        key: parts.join(KEY_SEPARATOR),
        blank: !anyValue,
    };
}

/**
 * Human-friendly display for a key built from the selected columns.
 *
 * @param {Object} row
 * @param {string[]} columns
 * @returns {string}
 */
function displayKey(row, columns) {
    return columns
        .map(column => (row[column] === null || row[column] === undefined ? '' : String(row[column])))
        .join(' | ');
}

/**
 * @typedef {{
 *   value: string,
 *   key: string,
 *   type: 'onlyA' | 'onlyB' | 'common',
 *   rowsA: number[],
 *   rowsB: number[],
 *   countA: number,
 *   countB: number,
 *   isBlank: boolean,
 * }} ValueComparisonRow
 *
 * @typedef {{
 *   value: string,
 *   key: string,
 *   type: 'added' | 'removed' | 'changed' | 'unchanged',
 *   rowsA: number[],
 *   rowsB: number[],
 *   countA: number,
 *   countB: number,
 *   isBlank: boolean,
 *   changes: { columnA: string, columnB: string, valueA: any, valueB: any }[],
 * }} RowComparisonRow
 *
 * @typedef {{
 *   mode: 'values' | 'rows',
 *   totalRowsA: number,
 *   totalRowsB: number,
 *   matchCount: number,
 *   onlyACount: number,
 *   onlyBCount: number,
 *   addedCount: number,
 *   removedCount: number,
 *   changedCount: number,
 *   unchangedCount: number,
 *   columnA?: string,
 *   columnB?: string,
 *   keyColumnsA?: string[],
 *   keyColumnsB?: string[],
 *   compareColumns?: { a: string, b: string }[],
 *   duplicateKeyCountA?: number,
 *   duplicateKeyCountB?: number,
 *   profileA?: { distinctCount: number, nullCount: number, dataType: string },
 *   profileB?: { distinctCount: number, nullCount: number, dataType: string },
 *   normalization: Required<NormalizationOptions>,
 *   includeEmpty: boolean,
 *   warnings: string[],
 *   rows: (ValueComparisonRow | RowComparisonRow)[],
 * }} ComparisonResult
 */

/**
 * Compare the distinct values of one column from each dataset.
 *
 * @param {import('../engine/dataset')} datasetA
 * @param {string} columnA
 * @param {import('../engine/dataset')} datasetB
 * @param {string} columnB
 * @param {Object} normalized
 * @param {(pct: number) => void} [onProgress]
 * @returns {ComparisonResult}
 */
function compareValues(datasetA, columnA, datasetB, columnB, normalized, onProgress) {
    /** @type {Map<string, { rows: number[], display: string, blank: boolean }>} */
    const mapA = new Map();
    /** @type {Map<string, { rows: number[], display: string, blank: boolean }>} */
    const mapB = new Map();

    const rowsA = datasetA.rows;
    const rowsB = datasetB.rows;

    for (let i = 0; i < rowsA.length; i++) {
        const raw = rowsA[i][columnA];
        const value = normalizeValue(raw, normalized.normalization);
        if (value.blank && !normalized.includeEmpty) continue;
        if (!mapA.has(value.key)) {
            mapA.set(value.key, { rows: [], display: raw === null || raw === undefined ? '' : String(raw), blank: value.blank });
        }
        /** @type {{ rows: number[], display: string, blank: boolean }} */ (mapA.get(value.key)).rows.push(i + 1);
    }

    if (onProgress) onProgress(35);

    for (let i = 0; i < rowsB.length; i++) {
        const raw = rowsB[i][columnB];
        const value = normalizeValue(raw, normalized.normalization);
        if (value.blank && !normalized.includeEmpty) continue;
        if (!mapB.has(value.key)) {
            mapB.set(value.key, { rows: [], display: raw === null || raw === undefined ? '' : String(raw), blank: value.blank });
        }
        /** @type {{ rows: number[], display: string, blank: boolean }} */ (mapB.get(value.key)).rows.push(i + 1);
    }

    if (onProgress) onProgress(65);

    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

    /** @type {ValueComparisonRow[]} */
    const rows = [];
    let matchCount = 0;
    let onlyACount = 0;
    let onlyBCount = 0;

    for (const key of allKeys) {
        const entryA = mapA.get(key);
        const entryB = mapB.get(key);
        const inA = !!entryA;
        const inB = !!entryB;
        const rowsAList = entryA ? entryA.rows : [];
        const rowsBList = entryB ? entryB.rows : [];

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

        const entry = entryA || entryB;

        rows.push({
            value: entry ? entry.display : key,
            key,
            type,
            rowsA: rowsAList,
            rowsB: rowsBList,
            countA: rowsAList.length,
            countB: rowsBList.length,
            isBlank: entry ? entry.blank : false,
        });
    }

    if (onProgress) onProgress(85);

    const profileA = profileColumn(rowsA, columnA);
    const profileB = profileColumn(rowsB, columnB);

    if (onProgress) onProgress(100);

    return {
        mode: 'values',
        totalRowsA: rowsA.length,
        totalRowsB: rowsB.length,
        matchCount,
        onlyACount,
        onlyBCount,
        addedCount: 0,
        removedCount: 0,
        changedCount: 0,
        unchangedCount: 0,
        columnA,
        columnB,
        profileA,
        profileB,
        normalization: normalized.normalization,
        includeEmpty: normalized.includeEmpty,
        warnings: [],
        rows,
    };
}

/**
 * Compare records from two datasets using one or more key columns.
 *
 * @param {import('../engine/dataset')} datasetA
 * @param {import('../engine/dataset')} datasetB
 * @param {Object} normalized
 * @param {(pct: number) => void} [onProgress]
 * @returns {ComparisonResult}
 */
function compareRows(datasetA, datasetB, normalized, onProgress) {
    const keyColumnsA = normalized.keyColumnsA.length > 0 ? normalized.keyColumnsA : datasetA.getColumns().slice(0, 1);
    const keyColumnsB = normalized.keyColumnsB.length > 0 ? normalized.keyColumnsB : keyColumnsA;

    /** @type {Map<string, { row: Object, indexes: number[] }>} */
    const mapA = new Map();
    /** @type {Map<string, { row: Object, indexes: number[] }>} */
    const mapB = new Map();

    const rowsA = datasetA.rows;
    const rowsB = datasetB.rows;

    for (let i = 0; i < rowsA.length; i++) {
        const key = buildKey(rowsA[i], keyColumnsA, normalized.normalization);
        if (key.blank && !normalized.includeEmpty) continue;
        if (!mapA.has(key.key)) mapA.set(key.key, { row: rowsA[i], indexes: [] });
        /** @type {{ row: Object, indexes: number[] }} */ (mapA.get(key.key)).indexes.push(i + 1);
    }

    if (onProgress) onProgress(30);

    for (let i = 0; i < rowsB.length; i++) {
        const key = buildKey(rowsB[i], keyColumnsB, normalized.normalization);
        if (key.blank && !normalized.includeEmpty) continue;
        if (!mapB.has(key.key)) mapB.set(key.key, { row: rowsB[i], indexes: [] });
        /** @type {{ row: Object, indexes: number[] }} */ (mapB.get(key.key)).indexes.push(i + 1);
    }

    if (onProgress) onProgress(55);

    // Default comparison columns: every non-key column present in both files.
    let compareColumns = normalized.compareColumns;
    if (compareColumns.length === 0) {
        compareColumns = datasetA.getColumns()
            .filter(column => !keyColumnsA.includes(column) && datasetB.getColumns().includes(column))
            .map(column => ({ a: column, b: column }));
    }

    const warnings = [];
    const missingInB = compareColumns.filter(pair => !datasetB.getColumns().includes(pair.b));
    if (missingInB.length > 0) {
        warnings.push(`Columns missing in File B were skipped: ${missingInB.map(pair => pair.b).join(', ')}`);
    }
    compareColumns = compareColumns.filter(pair => datasetA.getColumns().includes(pair.a) && datasetB.getColumns().includes(pair.b));

    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

    /** @type {RowComparisonRow[]} */
    const rows = [];
    let addedCount = 0;
    let removedCount = 0;
    let changedCount = 0;
    let unchangedCount = 0;
    let duplicateKeyCountA = 0;
    let duplicateKeyCountB = 0;

    for (const key of allKeys) {
        const entryA = mapA.get(key);
        const entryB = mapB.get(key);
        if (entryA && entryA.indexes.length > 1) duplicateKeyCountA++;
        if (entryB && entryB.indexes.length > 1) duplicateKeyCountB++;

        const rowsAList = entryA ? entryA.indexes : [];
        const rowsBList = entryB ? entryB.indexes : [];

        /** @type {'added' | 'removed' | 'changed' | 'unchanged'} */
        let type;
        /** @type {{ columnA: string, columnB: string, valueA: any, valueB: any }[]} */
        let changes = [];

        if (entryA && entryB) {
            for (const pair of compareColumns) {
                const left = normalizeValue(entryA.row[pair.a], normalized.normalization);
                const right = normalizeValue(entryB.row[pair.b], normalized.normalization);
                if (left.key !== right.key) {
                    changes.push({
                        columnA: pair.a,
                        columnB: pair.b,
                        valueA: entryA.row[pair.a],
                        valueB: entryB.row[pair.b],
                    });
                }
            }
            if (changes.length > 0) {
                type = 'changed';
                changedCount++;
            } else {
                type = 'unchanged';
                unchangedCount++;
            }
        } else if (entryA) {
            type = 'removed';
            removedCount++;
        } else {
            type = 'added';
            addedCount++;
        }

        const displaySource = (entryA && entryA.row) || (entryB && entryB.row) || {};
        const displayColumns = entryA ? keyColumnsA : keyColumnsB;
        rows.push({
            value: displayKey(displaySource, displayColumns),
            key,
            type,
            rowsA: rowsAList,
            rowsB: rowsBList,
            countA: rowsAList.length,
            countB: rowsBList.length,
            isBlank: false,
            changes,
        });
    }

    if (onProgress) onProgress(85);

    const profileA = keyColumnsA[0] ? profileColumn(rowsA, keyColumnsA[0]) : undefined;
    const profileB = keyColumnsB[0] ? profileColumn(rowsB, keyColumnsB[0]) : undefined;

    if (onProgress) onProgress(100);

    return {
        mode: 'rows',
        totalRowsA: rowsA.length,
        totalRowsB: rowsB.length,
        matchCount: unchangedCount,
        onlyACount: removedCount,
        onlyBCount: addedCount,
        addedCount,
        removedCount,
        changedCount,
        unchangedCount,
        keyColumnsA,
        keyColumnsB,
        compareColumns,
        duplicateKeyCountA,
        duplicateKeyCountB,
        profileA,
        profileB,
        normalization: normalized.normalization,
        includeEmpty: normalized.includeEmpty,
        warnings,
        rows,
    };
}

/**
 * Compare two datasets.
 *
 * @param {import('../engine/dataset')} datasetA
 * @param {import('../engine/dataset')} datasetB
 * @param {Object} options
 * @param {'values' | 'rows'} [options.mode]
 * @param {string} [options.columnA]
 * @param {string} [options.columnB]
 * @param {string[]} [options.keyColumnsA]
 * @param {string[]} [options.keyColumnsB]
 * @param {(string | {a: string, b: string})[]} [options.compareColumns]
 * @param {boolean} [options.includeEmpty]
 * @param {NormalizationOptions} [options.normalization]
 * @param {(pct: number) => void} [options.onProgress]
 * @returns {ComparisonResult}
 */
function compareDatasets(datasetA, datasetB, options = {}) {
    const normalized = normalizeOptions(options);
    const { onProgress } = options;

    if (onProgress) onProgress(10);

    if (normalized.mode === 'rows') {
        return compareRows(datasetA, datasetB, normalized, onProgress);
    }

    const columnA = options.columnA || datasetA.getColumns()[0];
    const columnB = options.columnB || columnA;

    if (!datasetA.getColumns().includes(columnA)) {
        throw new Error(`Column "${columnA}" does not exist in File A.`);
    }
    if (!datasetB.getColumns().includes(columnB)) {
        throw new Error(`Column "${columnB}" does not exist in File B.`);
    }

    return compareValues(datasetA, columnA, datasetB, columnB, normalized, onProgress);
}

/**
 * Legacy value-set comparison wrapper.
 *
 * @param {import('../engine/dataset')} datasetA
 * @param {string} columnA
 * @param {import('../engine/dataset')} datasetB
 * @param {string} columnB
 * @param {{ onProgress?: (pct: number) => void }} [opts]
 * @returns {ComparisonResult}
 */
function compare(datasetA, columnA, datasetB, columnB, opts = {}) {
    return compareDatasets(datasetA, datasetB, {
        mode: 'values',
        columnA,
        columnB,
        onProgress: opts.onProgress,
    });
}

module.exports = {
    compare,
    compareDatasets,
    normalizeValue,
    normalizeOptions,
    profileColumn,
    inferType,
};

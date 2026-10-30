/**
 * engine/workflow/activities/analyticsActivities.js
 *
 * Analytics activities for data summarization and insights.
 */

'use strict';

const fs = require('fs');
const Dataset = require('../../dataset');
const csvParser = require('../../../services/csvParser');
const csvCompare = require('../../../services/csvCompare');
const { validateConfig, isNumeric, validateColumn, validateFile } = require('./shared');

// ─── Constants ──────────────────────────────────────────────────────────────
const VALID_AGGREGATIONS = ['sum', 'average', 'mean', 'min', 'max', 'count', 'distinct', 'median', 'stdDev', 'variance'];
const VALID_GROUP_OPERATIONS = ['sum', 'average', 'mean', 'min', 'max', 'count', 'median', 'stdDev', 'first', 'last'];

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Compute median of numeric values
 * @param {Array<number>} values - Array of numeric values
 * @returns {number} Median value
 */
function computeMedian(values) {
    if (!values || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

/**
 * Compute standard deviation
 * @param {Array<number>} values - Array of numeric values
 * @param {number} mean - Mean value (optional, computed if not provided)
 * @returns {number} Standard deviation
 */
function computeStdDev(values, mean = null) {
    if (!values || values.length < 2) return null;
    const avg = mean !== null ? mean : values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length;
    return Math.sqrt(variance);
}

/**
 * Extract numeric values from dataset column
 * @param {Dataset} dataset - Input dataset
 * @param {string} column - Column name
 * @param {boolean} skipNulls - Skip null/undefined values
 * @returns {Array<number>} Array of numeric values
 */
function extractNumericValues(dataset, column, skipNulls = true) {
    const values = dataset.rows
        .map(row => row[column])
        .filter(val => val !== null && val !== undefined)
        .map(val => typeof val === 'number' ? val : parseFloat(val))
        .filter(val => !isNaN(val));
    
    return skipNulls ? values : values;
}

// ─── Activity Definitions ──────────────────────────────────────────────────

const analyticsActivities = [];

// ─── 1. Aggregate Activity ───────────────────────────────────────────────────
analyticsActivities.push({
    type: 'aggregate',
    displayName: '📈 Aggregate',
    description: 'Computes aggregation (sum, average, min, max, count, etc.) on a column.',
    category: 'Analytics',
    configRequirements: [
        {
            name: 'column',
            label: 'Column Name',
            type: 'string',
            required: true,
            description: 'The column to aggregate'
        },
        {
            name: 'operation',
            label: 'Operation',
            type: 'select',
            required: true,
            options: [
                { label: 'Sum', value: 'sum' },
                { label: 'Average', value: 'average' },
                { label: 'Mean', value: 'mean' },
                { label: 'Min', value: 'min' },
                { label: 'Max', value: 'max' },
                { label: 'Count', value: 'count' },
                { label: 'Distinct Count', value: 'distinct' },
                { label: 'Median', value: 'median' },
                { label: 'Standard Deviation', value: 'stdDev' },
                { label: 'Variance', value: 'variance' }
            ],
            description: 'Aggregation function'
        },
        {
            name: 'skipNulls',
            label: 'Skip Null/Undefined',
            type: 'boolean',
            required: false,
            description: 'Skip null/undefined values in calculation (default: true)'
        },
        {
            name: 'asColumn',
            label: 'Result Column Name',
            type: 'string',
            required: false,
            description: 'Custom name for the result column (default: operation_column)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Aggregate activity: Input dataset is required');
        }

        const { column, operation, skipNulls = true, asColumn } = config;
        validateConfig({ column, operation }, ['column', 'operation'], 'Aggregate');

        if (!VALID_AGGREGATIONS.includes(operation)) {
            throw new Error(`Aggregate activity: Unsupported operation "${operation}"`);
        }

        const columns = inputDataset.getColumns();
        if (!columns.includes(column)) {
            throw new Error(`Aggregate activity: Column "${column}" not found. Available: ${columns.join(', ')}`);
        }

        // Handle empty dataset
        if (inputDataset.getRowCount() === 0) {
            const outputCol = asColumn || `${operation}_${column}`;
            const resultVal = operation === 'count' || operation === 'distinct' ? 0 : null;
            return new Dataset([{ [outputCol]: resultVal }], [outputCol]);
        }

        try {
            let resultVal;
            const values = extractNumericValues(inputDataset, column, skipNulls);

            // Special handling for operations that work on any values
            if (operation === 'count') {
                resultVal = skipNulls ? values.length : inputDataset.rows.length;
            } else if (operation === 'distinct') {
                const distinctValues = new Set(inputDataset.rows.map(row => row[column]));
                resultVal = distinctValues.size;
            } else {
                // Numeric operations
                if (values.length === 0) {
                    resultVal = null;
                } else {
                    switch (operation) {
                        case 'sum':
                            resultVal = values.reduce((a, b) => a + b, 0);
                            break;
                        case 'average':
                        case 'mean':
                            resultVal = values.reduce((a, b) => a + b, 0) / values.length;
                            break;
                        case 'min':
                            resultVal = Math.min(...values);
                            break;
                        case 'max':
                            resultVal = Math.max(...values);
                            break;
                        case 'median':
                            resultVal = computeMedian(values);
                            break;
                        case 'stdDev':
                            const mean = values.reduce((a, b) => a + b, 0) / values.length;
                            resultVal = computeStdDev(values, mean);
                            break;
                        case 'variance': {
                            const avg = values.reduce((a, b) => a + b, 0) / values.length;
                            const variance = values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length;
                            resultVal = variance;
                            break;
                        }
                        default:
                            resultVal = null;
                    }
                }
            }

            const outputCol = asColumn || `${operation}_${column}`;
            const outputDataset = new Dataset([{ [outputCol]: resultVal }], [outputCol]);

            if (context && context.setActivityStats) {
                context.setActivityStats({
                    inputRowCount: inputDataset.getRowCount(),
                    outputRowCount: outputDataset.getRowCount(),
                    operation: operation,
                    column: column,
                    result: resultVal,
                    numericValuesCount: values.length,
                    skipNulls: skipNulls
                });
            }

            return outputDataset;
        } catch (err) {
            throw new Error(`Aggregate activity: ${err.message}`);
        }
    }
});

// ─── 2. Group By Activity ────────────────────────────────────────────────────
analyticsActivities.push({
    type: 'groupBy',
    displayName: '📊 Group By',
    description: 'Groups data by a column and computes aggregations for each group.',
    category: 'Analytics',
    configRequirements: [
        {
            name: 'groupColumn',
            label: 'Group By Column',
            type: 'string',
            required: true,
            description: 'Column to group by'
        },
        {
            name: 'aggregateColumn',
            label: 'Aggregate Column',
            type: 'string',
            required: true,
            description: 'Column to aggregate within each group'
        },
        {
            name: 'operation',
            label: 'Operation',
            type: 'select',
            required: true,
            options: [
                { label: 'Sum', value: 'sum' },
                { label: 'Average', value: 'average' },
                { label: 'Mean', value: 'mean' },
                { label: 'Min', value: 'min' },
                { label: 'Max', value: 'max' },
                { label: 'Count', value: 'count' },
                { label: 'Median', value: 'median' },
                { label: 'Standard Deviation', value: 'stdDev' },
                { label: 'First Value', value: 'first' },
                { label: 'Last Value', value: 'last' }
            ],
            description: 'Aggregation function for each group'
        },
        {
            name: 'skipNulls',
            label: 'Skip Null/Undefined',
            type: 'boolean',
            required: false,
            description: 'Skip null/undefined values in calculation (default: true)'
        },
        {
            name: 'sortBy',
            label: 'Sort By',
            type: 'select',
            required: false,
            options: [
                { label: 'Group Value (Ascending)', value: 'groupAsc' },
                { label: 'Group Value (Descending)', value: 'groupDesc' },
                { label: 'Aggregate Value (Ascending)', value: 'aggAsc' },
                { label: 'Aggregate Value (Descending)', value: 'aggDesc' },
                { label: 'None', value: 'none' }
            ],
            description: 'Sort order for results (default: groupAsc)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Group By activity: Input dataset is required');
        }

        const {
            groupColumn,
            aggregateColumn,
            operation,
            skipNulls = true,
            sortBy = 'groupAsc'
        } = config;

        validateConfig({ groupColumn, aggregateColumn, operation }, ['groupColumn', 'aggregateColumn', 'operation'], 'Group By');

        if (!VALID_GROUP_OPERATIONS.includes(operation)) {
            throw new Error(`Group By activity: Unsupported operation "${operation}"`);
        }

        const columns = inputDataset.getColumns();
        if (!columns.includes(groupColumn)) {
            throw new Error(`Group By activity: Column "${groupColumn}" not found. Available: ${columns.join(', ')}`);
        }
        if (!columns.includes(aggregateColumn)) {
            throw new Error(`Group By activity: Column "${aggregateColumn}" not found. Available: ${columns.join(', ')}`);
        }

        // Build groups
        const groups = new Map();
        for (const row of inputDataset.rows) {
            const key = row[groupColumn] !== null && row[groupColumn] !== undefined ? String(row[groupColumn]) : '';
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(row[aggregateColumn]);
        }

        // Compute aggregates for each group
        const resultRows = [];
        for (const [key, values] of groups) {
            const numericValues = extractNumericValues(
                new Dataset(values.map(v => ({ [aggregateColumn]: v })), [aggregateColumn]),
                aggregateColumn,
                skipNulls
            );

            let result;
            if (numericValues.length === 0) {
                result = null;
            } else {
                switch (operation) {
                    case 'sum':
                        result = numericValues.reduce((a, b) => a + b, 0);
                        break;
                    case 'average':
                    case 'mean':
                        result = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
                        break;
                    case 'min':
                        result = Math.min(...numericValues);
                        break;
                    case 'max':
                        result = Math.max(...numericValues);
                        break;
                    case 'count':
                        result = numericValues.length;
                        break;
                    case 'median':
                        result = computeMedian(numericValues);
                        break;
                    case 'stdDev': {
                        const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
                        result = computeStdDev(numericValues, mean);
                        break;
                    }
                    case 'first':
                        result = values[0];
                        break;
                    case 'last':
                        result = values[values.length - 1];
                        break;
                    default:
                        result = null;
                }
            }

            resultRows.push({
                [groupColumn]: key,
                [`${operation}_${aggregateColumn}`]: result,
                '_groupCount': values.length
            });
        }

        // Sort results
        if (sortBy !== 'none') {
            const [sortField, sortDirection] = sortBy === 'groupAsc' || sortBy === 'groupDesc'
                ? [groupColumn, sortBy === 'groupAsc' ? 'asc' : 'desc']
                : [`${operation}_${aggregateColumn}`, sortBy === 'aggAsc' ? 'asc' : 'desc'];

            resultRows.sort((a, b) => {
                const valA = a[sortField];
                const valB = b[sortField];
                if (valA === null || valA === undefined) return 1;
                if (valB === null || valB === undefined) return -1;
                if (typeof valA === 'number' && typeof valB === 'number') {
                    return sortDirection === 'asc' ? valA - valB : valB - valA;
                }
                const strA = String(valA);
                const strB = String(valB);
                return sortDirection === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
            });
        }

        const resultColumns = [groupColumn, `${operation}_${aggregateColumn}`, '_groupCount'];
        const outputDataset = new Dataset(resultRows, resultColumns);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                groupColumn: groupColumn,
                aggregateColumn: aggregateColumn,
                operation: operation,
                groupCount: groups.size,
                sortBy: sortBy
            });
        }

        return outputDataset;
    }
});

// ─── 3. Data Profile Activity ────────────────────────────────────────────────
analyticsActivities.push({
    type: 'dataProfile',
    displayName: '📋 Data Profile',
    description: 'Generates a comprehensive profile of the dataset with statistics for each column.',
    category: 'Analytics',
    configRequirements: [
        {
            name: 'columns',
            label: 'Columns to Profile',
            type: 'string',
            required: false,
            description: 'Comma-separated list of columns (leave empty for all columns)'
        },
        {
            name: 'includeStats',
            label: 'Include Statistics',
            type: 'select',
            required: false,
            options: [
                { label: 'All Statistics', value: 'all' },
                { label: 'Basic (count, nulls, distinct)', value: 'basic' },
                { label: 'Numeric (mean, min, max, stdDev)', value: 'numeric' },
                { label: 'String (length, uniqueness)', value: 'string' }
            ],
            description: 'Which statistics to include (default: all)'
        },
        {
            name: 'maxDistinctValues',
            label: 'Max Distinct Values',
            type: 'number',
            required: false,
            defaultValue: 10,
            description: 'Maximum number of distinct values to show in profile'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Data Profile activity: Input dataset is required');
        }

        const {
            columns: columnsParam = '',
            includeStats = 'all',
            maxDistinctValues = 10
        } = config;

        const allColumns = inputDataset.getColumns();
        let targetColumns = columnsParam
            ? columnsParam.split(',').map(c => c.trim()).filter(c => c.length > 0)
            : allColumns;

        // Filter to valid columns
        targetColumns = targetColumns.filter(col => allColumns.includes(col));
        if (targetColumns.length === 0) {
            throw new Error(`Data Profile activity: No valid columns found. Available: ${allColumns.join(', ')}`);
        }

        const profileRows = [];

        for (const column of targetColumns) {
            const values = inputDataset.rows.map(row => row[column]);
            const validValues = values.filter(v => v !== null && v !== undefined);
            const totalCount = values.length;
            const nullCount = totalCount - validValues.length;
            const nullPercentage = totalCount > 0 ? (nullCount / totalCount) * 100 : 0;

            // Distinct values
            const distinctValues = new Set(validValues);
            const distinctCount = distinctValues.size;

            // Value distribution
            const distribution = {};
            let sampleValues = [];
            for (const val of distinctValues) {
                const count = validValues.filter(v => v === val).length;
                const percentage = totalCount > 0 ? (count / totalCount) * 100 : 0;
                distribution[val] = { count, percentage };
                sampleValues.push({ value: val, count, percentage });
            }

            // Sort by count descending and limit
            sampleValues.sort((a, b) => b.count - a.count);
            if (sampleValues.length > maxDistinctValues) {
                sampleValues = sampleValues.slice(0, maxDistinctValues);
            }

            // Data type detection
            let dataType = 'unknown';
            const numericValues = validValues
                .map(v => typeof v === 'number' ? v : parseFloat(v))
                .filter(v => !isNaN(v));
            const numericRatio = validValues.length > 0 ? numericValues.length / validValues.length : 0;

            if (validValues.length === 0) {
                dataType = 'empty';
            } else if (numericRatio > 0.8) {
                dataType = 'numeric';
            } else if (validValues.every(v => v instanceof Date || !isNaN(Date.parse(v)))) {
                dataType = 'date';
            } else if (validValues.every(v => typeof v === 'boolean')) {
                dataType = 'boolean';
            } else {
                dataType = 'string';
            }

            // Statistics
            const profile = {
                column,
                dataType,
                totalCount,
                nullCount,
                nullPercentage: Math.round(nullPercentage * 100) / 100,
                distinctCount,
                sampleValues: sampleValues.slice(0, maxDistinctValues),
                hasUniqueValues: distinctCount === validValues.length
            };

            // Add numeric stats if applicable
            if (includeStats === 'all' || includeStats === 'numeric') {
                if (numericValues.length > 0) {
                    const sum = numericValues.reduce((a, b) => a + b, 0);
                    const mean = sum / numericValues.length;
                    const sorted = [...numericValues].sort((a, b) => a - b);
                    const min = sorted[0];
                    const max = sorted[sorted.length - 1];
                    const median = computeMedian(sorted);
                    const stdDev = computeStdDev(numericValues, mean);

                    profile.numericStats = {
                        sum: Math.round(sum * 100) / 100,
                        mean: Math.round(mean * 100) / 100,
                        min: Math.round(min * 100) / 100,
                        max: Math.round(max * 100) / 100,
                        median: Math.round(median * 100) / 100,
                        stdDev: Math.round(stdDev * 100) / 100,
                        numericCount: numericValues.length
                    };
                }
            }

            // Add string stats if applicable
            if (includeStats === 'all' || includeStats === 'string') {
                const stringValues = validValues.filter(v => typeof v === 'string');
                if (stringValues.length > 0) {
                    const lengths = stringValues.map(v => v.length);
                    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
                    const minLength = Math.min(...lengths);
                    const maxLength = Math.max(...lengths);

                    profile.stringStats = {
                        avgLength: Math.round(avgLength * 100) / 100,
                        minLength,
                        maxLength,
                        stringCount: stringValues.length
                    };
                }
            }

            profileRows.push(profile);
        }

        // Convert profile to dataset
        const resultRows = profileRows.map(p => ({
            column: p.column,
            dataType: p.dataType,
            totalCount: p.totalCount,
            nullCount: p.nullCount,
            nullPercentage: p.nullPercentage,
            distinctCount: p.distinctCount,
            hasUniqueValues: p.hasUniqueValues,
            sampleValues: JSON.stringify(p.sampleValues.slice(0, 5)),
            numericStats: p.numericStats ? JSON.stringify(p.numericStats) : null,
            stringStats: p.stringStats ? JSON.stringify(p.stringStats) : null
        }));

        const resultColumns = ['column', 'dataType', 'totalCount', 'nullCount', 'nullPercentage', 'distinctCount', 'hasUniqueValues', 'sampleValues', 'numericStats', 'stringStats'];
        const outputDataset = new Dataset(resultRows, resultColumns);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                columnsProfiled: profileRows.length,
                totalColumns: allColumns.length,
                includeStats: includeStats
            });
        }

        return outputDataset;
    }
});

// ─── 4. Validate Data Activity ───────────────────────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse the `rules` config (JSON string or array) into a rule array.
 * @param {string|Array} raw
 * @returns {Array<Object>}
 */
function parseValidationRules(raw) {
    let rules = raw;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) throw new Error('ValidateData: "rules" is required');
        try {
            rules = JSON.parse(trimmed);
        } catch (err) {
            throw new Error(`ValidateData: "rules" must be valid JSON — ${err.message}`);
        }
    }
    if (!Array.isArray(rules)) {
        throw new Error('ValidateData: "rules" must be a JSON array of rule objects');
    }
    return rules;
}

/**
 * Evaluate a single non-unique check against a value, returning an error
 * message or null when the value passes.
 * @param {*} value
 * @param {Object} rule - { check, value?, pattern? }
 * @returns {string|null}
 */
function checkValidationValue(value, rule) {
    const { check } = rule;
    const hasValue = value !== null && value !== undefined;

    switch (check) {
        case 'notNull':
            return hasValue ? null : 'Value is null/undefined';
        case 'notEmpty': {
            if (!hasValue) return 'Value is null/undefined';
            if (String(value).trim() === '') return 'Value is empty';
            return null;
        }
        case 'numeric':
            if (!hasValue) return 'Value is missing';
            if (!isNumeric(value)) return `"${String(value)}" is not numeric`;
            return null;
        case 'integer': {
            if (!hasValue) return 'Value is missing';
            const n = Number(value);
            if (!Number.isFinite(n) || !Number.isInteger(n)) return `"${String(value)}" is not an integer`;
            return null;
        }
        case 'email': {
            if (!hasValue) return 'Value is missing';
            if (!EMAIL_REGEX.test(String(value).trim())) return `"${String(value)}" is not a valid email`;
            return null;
        }
        case 'pattern': {
            if (!hasValue) return 'Value is missing';
            const pattern = rule.pattern !== undefined ? rule.pattern : rule.value;
            if (pattern === undefined || pattern === null || String(pattern).trim() === '') {
                return 'pattern check requires a pattern';
            }
            try {
                const re = new RegExp(String(pattern));
                if (!re.test(String(value))) return `"${String(value)}" does not match pattern /${pattern}/`;
            } catch (err) {
                return `Invalid pattern /${pattern}/: ${err.message}`;
            }
            return null;
        }
        case 'min': {
            if (!hasValue) return 'Value is missing';
            if (!isNumeric(value)) return `"${String(value)}" is not numeric`;
            const n = parseFloat(value);
            const min = parseFloat(rule.value);
            if (isNaN(min)) return 'min check requires a numeric value';
            if (n < min) return `${n} is below the minimum ${min}`;
            return null;
        }
        case 'max': {
            if (!hasValue) return 'Value is missing';
            if (!isNumeric(value)) return `"${String(value)}" is not numeric`;
            const n = parseFloat(value);
            const max = parseFloat(rule.value);
            if (isNaN(max)) return 'max check requires a numeric value';
            if (n > max) return `${n} exceeds the maximum ${max}`;
            return null;
        }
        case 'in': {
            if (!hasValue) return 'Value is missing';
            let allowed = rule.value;
            if (typeof allowed === 'string') {
                allowed = allowed.split(',').map(v => v.trim());
            }
            if (!Array.isArray(allowed)) return 'in check requires a value list';
            const found = allowed.some(v => Number(v) === v && isNumeric(value)
                ? parseFloat(value) === v
                : String(v) === String(value));
            if (!found) return `"${String(value)}" is not in the allowed list`;
            return null;
        }
        case 'unique':
            return null; // handled separately (two-pass)
        default:
            return `unsupported check "${check}"`;
    }
}

analyticsActivities.push({
    type: 'validateData',
    displayName: '✅ Validate Data',
    description: 'Runs data-quality rules (non-null, numeric, email, pattern, min/max, allowed values, uniqueness) against the dataset and annotates every row with its validation status. Blanks, junk, and repeated emails across this column are precisely the patterns these checks catch.',
    category: 'Analytics',
    configRequirements: [
        {
            name: 'rules',
            label: 'Rules (JSON)',
            type: 'text',
            required: true,
            description: 'JSON array of rule objects: {"column", "check", "value?", "pattern?", "message?"}. Checks: notNull, notEmpty, numeric, integer, email, pattern, min, max, in, unique.',
            placeholder: '[{ "column": "email", "check": "email" }, { "column": "amount", "check": "min", "value": 0 }]'
        },
        {
            name: 'mode',
            label: 'Mode',
            type: 'select',
            required: false,
            defaultValue: 'annotate',
            options: [
                { label: 'Annotate Rows', value: 'annotate' },
                { label: 'Filter Invalid Rows', value: 'filterInvalid' }
            ],
            description: '"annotate" keeps every row and adds __validation_status / __validation_errors; "filterInvalid" removes failed rows (default: annotate)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('ValidateData activity: Input dataset is required');
        }

        const { mode = 'annotate' } = config;
        validateConfig(config, ['rules'], 'ValidateData');

        const rules = parseValidationRules(config.rules);
        if (rules.length === 0) throw new Error('ValidateData: at least one rule is required');

        // Resolve rule columns once (with fuzzy matching).
        const resolvedRules = rules.map((rule, idx) => {
            if (!rule || typeof rule !== 'object' || !rule.check) {
                throw new Error(`ValidateData: rule #${idx + 1} is missing a "check"`);
            }
            const columnName = rule.column === undefined || rule.column === null
                ? null
                : validateColumn(inputDataset, rule.column, 'ValidateData');
            return { ...rule, columnName };
        });

        const baseColumns = inputDataset.getColumns();
        const annotationColumns = ['__validation_status', '__validation_errors'];
        const ruleTallies = resolvedRules.map(() => ({ passed: 0, failed: 0 }));
        const seenCounts = resolvedRules.map(() => new Map());

        const outputRows = [];
        let rowsInvalid = 0;

        for (let i = 0; i < inputDataset.rows.length; i++) {
            const row = inputDataset.rows[i];
            const errors = [];

            for (let r = 0; r < resolvedRules.length; r++) {
                const rule = resolvedRules[r];
                let failMessage = null;

                if (rule.check === 'unique') {
                    const raw = row[rule.columnName];
                    const key = raw === null || raw === undefined ? '___null___' : String(raw);
                    const count = (seenCounts[r].get(key) || 0) + 1;
                    seenCounts[r].set(key, count);
                    if (count > 1) failMessage = 'Value is duplicated';
                } else {
                    failMessage = checkValidationValue(row[rule.columnName], rule);
                }

                if (failMessage) {
                    ruleTallies[r].failed++;
                    errors.push(rule.message || `${rule.columnName}: ${failMessage}`);
                } else {
                    ruleTallies[r].passed++;
                }
            }

            const status = errors.length === 0 ? 'valid' : 'invalid';
            if (status === 'invalid') rowsInvalid++;
            if (mode === 'filterInvalid' && status === 'invalid') continue;

            const out = { ...row };
            if (mode === 'annotate') {
                out.__validation_status = status;
                out.__validation_errors = errors.join('; ');
            }
            outputRows.push(out);
        }

        const outputColumns = mode === 'annotate' ? [...baseColumns, ...annotationColumns] : baseColumns;
        const outputDataset = new Dataset(outputRows, outputColumns);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                rowsInvalid,
                mode,
                rules: resolvedRules.map((rule, r) => ({
                    column: rule.columnName,
                    check: rule.check,
                    passed: ruleTallies[r].passed,
                    failed: ruleTallies[r].failed
                }))
            });
        }

        return outputDataset;
    }
});

// ─── Compare CSV Activity ───────────────────────────────────────────────────

/**
 * Split a comma-separated config value into a clean string array.
 * @param {string|string[]|undefined} value
 * @returns {string[]}
 */
function parseList(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    if (typeof value !== 'string') return [];
    return value.split(',').map(v => v.trim()).filter(Boolean);
}

/**
 * Parse compare-column config: "a", "a=b", or a mix.
 * @param {string|string[]|undefined} value
 * @returns {{ a: string, b: string }[]}
 */
function parseCompareColumns(value) {
    return parseList(value).map(entry => {
        const [a, b] = entry.split('=').map(v => v.trim());
        return { a, b: b || a };
    }).filter(pair => pair.a && pair.b);
}

/**
 * Read a CSV file for comparison.
 * @param {string} filePath
 * @param {Object} config
 * @param {Object} context
 * @returns {Promise<Dataset>}
 */
async function readComparisonCsv(filePath, config, context) {
    const {
        delimiter = 'auto',
        hasHeader = true,
        encoding = 'utf8',
    } = config;

    const resolvedPath = context.resolvePath ? context.resolvePath(filePath) : filePath;
    const fileValidation = await validateFile(resolvedPath);
    if (!fileValidation.exists) {
        throw new Error(`Compare CSV: ${fileValidation.error} - ${filePath}`);
    }

    const rawContent = await fs.promises.readFile(resolvedPath, encoding === 'utf8-bom' ? 'utf8' : encoding);
    let content = rawContent.toString();
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

    const usedDelimiter = delimiter === 'auto' ? csvParser.detectDelimiter(content) : delimiter;
    return csvParser.parse(content, { delimiter: usedDelimiter, header: hasHeader });
}

analyticsActivities.push({
    type: 'compareCsv',
    displayName: '🔀 Compare CSV',
    description: 'Compares the input dataset (File A) with a CSV file (File B) and outputs a diff dataset plus summary variables.',
    category: 'Analytics',
    configRequirements: [
        {
            name: 'filePathB',
            label: 'File B Path',
            type: 'file',
            required: true,
            description: 'Absolute or workspace-relative path of the CSV to compare against File A'
        },
        {
            name: 'mode',
            label: 'Comparison Mode',
            type: 'select',
            required: false,
            options: [
                { label: 'Keyed rows', value: 'rows' },
                { label: 'Distinct values', value: 'values' }
            ],
            description: 'Row-level keyed comparison or distinct-value set comparison (default: rows)'
        },
        {
            name: 'columnA',
            label: 'Value Column A',
            type: 'string',
            required: false,
            description: 'Column in File A for distinct-value mode'
        },
        {
            name: 'columnB',
            label: 'Value Column B',
            type: 'string',
            required: false,
            description: 'Column in File B for distinct-value mode (defaults to Value Column A)'
        },
        {
            name: 'keyColumns',
            label: 'Key Columns',
            type: 'string',
            required: false,
            description: 'Comma-separated key columns (default: first column)'
        },
        {
            name: 'keyColumnsB',
            label: 'Key Columns (File B)',
            type: 'string',
            required: false,
            description: 'Optional comma-separated key columns in File B when names differ'
        },
        {
            name: 'compareColumns',
            label: 'Compare Columns',
            type: 'string',
            required: false,
            description: 'Comma-separated columns to compare, optionally "a=b" when names differ (default: all non-key columns)'
        },
        {
            name: 'includeUnchanged',
            label: 'Include Unchanged Rows',
            type: 'boolean',
            required: false,
            description: 'Include matching/unchanged rows in the diff dataset (default: false)'
        },
        {
            name: 'includeEmpty',
            label: 'Include Empty Keys',
            type: 'boolean',
            required: false,
            description: 'Treat empty key values as comparable instead of skipping them'
        },
        {
            name: 'trim',
            label: 'Trim Whitespace',
            type: 'boolean',
            required: false,
            description: 'Trim values before comparing'
        },
        {
            name: 'caseInsensitive',
            label: 'Ignore Case',
            type: 'boolean',
            required: false,
            description: 'Compare text case-insensitively'
        },
        {
            name: 'numeric',
            label: 'Numeric Equality',
            type: 'boolean',
            required: false,
            description: 'Treat numerically equivalent values (e.g. 1 and 1.0) as equal'
        },
        {
            name: 'date',
            label: 'Date Equality',
            type: 'boolean',
            required: false,
            description: 'Treat equivalent dates in different formats as equal'
        },
        {
            name: 'delimiterB',
            label: 'File B Delimiter',
            type: 'select',
            required: false,
            options: [
                { label: 'Auto-detect', value: 'auto' },
                { label: 'Comma (,)', value: ',' },
                { label: 'Semicolon (;)', value: ';' },
                { label: 'Tab (\\t)', value: '\t' },
                { label: 'Pipe (|)', value: '|' }
            ],
            description: 'Delimiter for File B (default: auto-detect)'
        },
        {
            name: 'hasHeaderB',
            label: 'File B Has Header',
            type: 'boolean',
            required: false,
            description: 'First row of File B contains column headers (default: true)'
        },
        {
            name: 'encodingB',
            label: 'File B Encoding',
            type: 'select',
            required: false,
            options: [
                { label: 'UTF-8', value: 'utf8' },
                { label: 'UTF-8 with BOM', value: 'utf8-bom' },
                { label: 'ASCII', value: 'ascii' },
                { label: 'ISO-8859-1', value: 'latin1' }
            ],
            description: 'File B encoding (default: UTF-8)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Compare CSV: Input dataset (File A) is required');
        }

        const { filePathB } = config;
        validateConfig({ filePathB }, ['filePathB'], 'Compare CSV');

        const datasetB = await readComparisonCsv(filePathB, {
            delimiter: config.delimiterB,
            hasHeader: config.hasHeaderB !== false,
            encoding: config.encodingB,
        }, context);

        const mode = config.mode === 'values' ? 'values' : 'rows';
        const includeUnchanged = config.includeUnchanged === true;

        const result = csvCompare.compareDatasets(inputDataset, datasetB, {
            mode,
            columnA: config.columnA || undefined,
            columnB: config.columnB || undefined,
            keyColumnsA: parseList(config.keyColumns),
            keyColumnsB: parseList(config.keyColumnsB),
            compareColumns: parseCompareColumns(config.compareColumns),
            includeEmpty: config.includeEmpty === true,
            normalization: {
                trim: config.trim === true,
                caseInsensitive: config.caseInsensitive === true,
                numeric: config.numeric === true,
                date: config.date === true,
            },
        });

        const outputRows = [];
        for (const row of result.rows) {
            if (!includeUnchanged && (row.type === 'common' || row.type === 'unchanged')) continue;

            if (row.type === 'changed' && row.changes && row.changes.length > 0) {
                for (const change of row.changes) {
                    outputRows.push({
                        status: row.type,
                        key: row.key,
                        value: row.value,
                        columnA: change.columnA,
                        columnB: change.columnB,
                        valueA: change.valueA,
                        valueB: change.valueB,
                        rowsA: row.rowsA.join(','),
                        rowsB: row.rowsB.join(','),
                        countA: row.countA,
                        countB: row.countB,
                    });
                }
                continue;
            }

            outputRows.push({
                status: row.type,
                key: row.key,
                value: row.value,
                columnA: '',
                columnB: '',
                valueA: '',
                valueB: '',
                rowsA: row.rowsA.join(','),
                rowsB: row.rowsB.join(','),
                countA: row.countA,
                countB: row.countB,
            });
        }

        const outputColumns = ['status', 'key', 'value', 'columnA', 'columnB', 'valueA', 'valueB', 'rowsA', 'rowsB', 'countA', 'countB'];
        const outputDataset = new Dataset(outputRows, outputColumns);

        const summary = {
            mode: result.mode,
            totalRowsA: result.totalRowsA,
            totalRowsB: result.totalRowsB,
            matchCount: result.matchCount,
            onlyACount: result.onlyACount,
            onlyBCount: result.onlyBCount,
            addedCount: result.addedCount,
            removedCount: result.removedCount,
            changedCount: result.changedCount,
            unchangedCount: result.unchangedCount,
            duplicateKeyCountA: result.duplicateKeyCountA || 0,
            duplicateKeyCountB: result.duplicateKeyCountB || 0,
            diffRowCount: outputRows.length,
            warnings: result.warnings || [],
        };

        if (context && typeof context.setVariable === 'function') {
            context.setVariable('compare', summary);
            context.setVariable('compareAdded', summary.addedCount);
            context.setVariable('compareRemoved', summary.removedCount);
            context.setVariable('compareChanged', summary.changedCount);
            context.setVariable('compareUnchanged', summary.unchangedCount);
            context.setVariable('compareDiffRows', summary.diffRowCount);
        }

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                comparedRowCount: datasetB.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                ...summary,
            });
        }

        return outputDataset;
    }
});

module.exports = analyticsActivities;
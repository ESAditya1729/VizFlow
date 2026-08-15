/**
 * engine/workflow/activities/analyticsActivities.js
 *
 * Analytics activities for data summarization and insights.
 */

'use strict';

const Dataset = require('../../dataset');

// ─── Constants ──────────────────────────────────────────────────────────────
const VALID_AGGREGATIONS = ['sum', 'average', 'mean', 'min', 'max', 'count', 'distinct', 'median', 'stdDev', 'variance'];
const VALID_GROUP_OPERATIONS = ['sum', 'average', 'mean', 'min', 'max', 'count', 'median', 'stdDev', 'first', 'last'];

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Validate config with required fields
 * @param {Object} config - Configuration object
 * @param {Array} required - Array of required field names
 * @param {string} activityName - Activity name for error messages
 * @throws {Error} If required field is missing
 */
function validateConfig(config, required, activityName) {
    for (const field of required) {
        if (config[field] === undefined || config[field] === null || config[field] === '') {
            throw new Error(`${activityName}: "${field}" is required`);
        }
    }
}

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

module.exports = analyticsActivities;
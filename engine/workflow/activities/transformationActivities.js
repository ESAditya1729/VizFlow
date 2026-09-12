/**
 * engine/workflow/activities/transformationActivities.js
 *
 * Transformation activities for modifying data.
 */

'use strict';

const fs = require('fs');
const Dataset = require('../../dataset');
const csvParser = require('../../../services/csvParser');
const { validateConfig, findColumnFuzzy, isNumeric, validateColumn } = require('./shared');

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Normalize parameter values for transform activity
 * @param {*} input - Raw parameter input
 * @param {string} opKey - Operation key for special handling
 * @returns {Array} Normalized parameter array
 */
function normalizeParams(input, opKey) {
    if (Array.isArray(input)) {
        return input
            .flatMap(value => typeof value === 'string' ? value.split(',') : [value])
            .map(value => typeof value === 'string' ? value.trim() : value)
            .filter(value => value !== undefined && value !== null && value !== '');
    }
    
    if (typeof input === 'string') {
        if (input.trim() === '') return [];
        
        if (opKey === 'replace') {
            const firstComma = input.indexOf(',');
            if (firstComma === -1) {
                return [input.trim(), ''];
            }
            return [input.substring(0, firstComma).trim(), input.substring(firstComma + 1).trim()];
        }
        
        if (opKey === 'concat') {
            return input.split(',').map(p => p.trim());
        }
        
        return input.split(',').map(p => p.trim()).filter(p => p.length > 0);
    }
    
    if (input !== undefined && input !== null && input !== '') {
        return [input];
    }
    
    return [];
}

// ─── Activity Definitions ──────────────────────────────────────────────────

const transformationActivities = [];

// ─── 1. Filter Activity ──────────────────────────────────────────────────────
transformationActivities.push({
    type: 'filter',
    displayName: '🔍 Filter Rows',
    description: 'Filters rows based on a specified column condition.',
    category: 'Transformation',
    configRequirements: [
        {
            name: 'column',
            label: 'Column Name',
            type: 'string',
            required: true,
            description: 'The column to apply the filter on'
        },
        {
            name: 'operator',
            label: 'Operator',
            type: 'select',
            required: true,
            options: [
                { label: 'Equals (==)', value: '==' },
                { label: 'Not Equals (!=)', value: '!=' },
                { label: 'Greater Than (>)', value: '>' },
                { label: 'Greater Than or Equal (>=)', value: '>=' },
                { label: 'Less Than (<)', value: '<' },
                { label: 'Less Than or Equal (<=)', value: '<=' },
                { label: 'Contains', value: 'contains' },
                { label: 'Starts With', value: 'startsWith' },
                { label: 'Ends With', value: 'endsWith' },
                { label: 'Regex Match', value: 'regex' },
                { label: 'Is Null', value: 'isNull' },
                { label: 'Is Not Null', value: 'isNotNull' },
                { label: 'Is Empty', value: 'isEmpty' },
                { label: 'Is Not Empty', value: 'isNotEmpty' }
            ],
            description: 'Comparison operator'
        },
        {
            name: 'value',
            label: 'Value',
            type: 'string',
            required: false,
            description: 'Value to compare against (not required for null/empty operators)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Filter activity: Input dataset is required');
        }
        
        const { column, operator, value } = config;
        validateConfig({ column, operator }, ['column', 'operator'], 'Filter');
        
        // Find the actual column name
        const actualColumn = validateColumn(inputDataset, column, 'Filter');
        
        // Check if value is required for this operator
        const operatorsRequiringValue = ['==', '!=', '>', '>=', '<', '<=', 'contains', 'startsWith', 'endsWith', 'regex'];
        if (operatorsRequiringValue.includes(operator) && (value === undefined || value === null || value === '')) {
            throw new Error(`Filter activity: "value" is required for operator "${operator}"`);
        }

        const filteredRows = inputDataset.rows.filter(row => {
            const rawVal = row[actualColumn];
            const rawValStr = rawVal !== null && rawVal !== undefined ? String(rawVal) : '';
            
            switch (operator) {
                case '==': {
                    if (isNumeric(rawVal) && isNumeric(value)) {
                        return parseFloat(rawVal) === parseFloat(value);
                    }
                    return rawVal === value;
                }
                case '!=': {
                    if (isNumeric(rawVal) && isNumeric(value)) {
                        return parseFloat(rawVal) !== parseFloat(value);
                    }
                    return rawVal !== value;
                }
                case '>': {
                    if (isNumeric(rawVal) && isNumeric(value)) {
                        return parseFloat(rawVal) > parseFloat(value);
                    }
                    return rawVal > value;
                }
                case '>=': {
                    if (isNumeric(rawVal) && isNumeric(value)) {
                        return parseFloat(rawVal) >= parseFloat(value);
                    }
                    return rawVal >= value;
                }
                case '<': {
                    if (isNumeric(rawVal) && isNumeric(value)) {
                        return parseFloat(rawVal) < parseFloat(value);
                    }
                    return rawVal < value;
                }
                case '<=': {
                    if (isNumeric(rawVal) && isNumeric(value)) {
                        return parseFloat(rawVal) <= parseFloat(value);
                    }
                    return rawVal <= value;
                }
                case 'contains':
                    return rawValStr.toLowerCase().includes(String(value).toLowerCase());
                case 'startsWith':
                    return rawValStr.toLowerCase().startsWith(String(value).toLowerCase());
                case 'endsWith':
                    return rawValStr.toLowerCase().endsWith(String(value).toLowerCase());
                case 'regex': {
                    try {
                        const regex = new RegExp(String(value), 'i');
                        return regex.test(rawValStr);
                    } catch {
                        throw new Error(`Filter activity: Invalid regex pattern "${value}"`);
                    }
                }
                case 'isNull':
                    return rawVal === null || rawVal === undefined;
                case 'isNotNull':
                    return rawVal !== null && rawVal !== undefined;
                case 'isEmpty':
                    return rawVal === null || rawVal === undefined || String(rawVal).trim() === '';
                case 'isNotEmpty':
                    return rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '';
                default:
                    throw new Error(`Filter activity: Unsupported operator "${operator}"`);
            }
        });

        const columns = inputDataset.getColumns();
        const outputDataset = new Dataset(filteredRows, columns);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                recordsFiltered: inputDataset.getRowCount() - outputDataset.getRowCount(),
                filterColumn: actualColumn,
                filterOperator: operator
            });
        }

        return outputDataset;
    }
});

// ─── 2. Transform Activity ───────────────────────────────────────────────────
transformationActivities.push({
    type: 'transform',
    displayName: '🔄 Transform Column',
    description: 'Applies an expression operation to a column.',
    category: 'Transformation',
    configRequirements: [
        {
            name: 'column',
            label: 'Column Name',
            type: 'string',
            required: true,
            description: 'The column to transform (can be a new column name as well)'
        },
        {
            name: 'opKey',
            label: 'Operation',
            type: 'select',
            required: true,
            description: 'Expression operation to apply',
            options: [
                // String Operations
                { label: 'UPPER CASE', value: 'upper', paramsHint: 'none' },
                { label: 'lower case', value: 'lower', paramsHint: 'none' },
                { label: 'Title Case', value: 'titleCase', paramsHint: 'none' },
                { label: 'camelCase', value: 'camelCase', paramsHint: 'none' },
                { label: 'snake_case', value: 'snakeCase', paramsHint: 'none' },
                { label: 'kebab-case', value: 'kebabCase', paramsHint: 'none' },
                { label: 'Trim Whitespace', value: 'trim', paramsHint: 'none' },
                { label: 'Remove ALL Whitespace', value: 'trimAll', paramsHint: 'none' },
                { label: 'Clean (alphanumeric only)', value: 'clean', paramsHint: 'none' },
                { label: 'Replace Text', value: 'replace', paramsHint: 'search, replace' },
                { label: 'Regex Replace', value: 'regexReplace', paramsHint: 'pattern, replacement' },
                { label: 'Regex Extract', value: 'regexExtract', paramsHint: 'pattern' },
                { label: 'Concat (append)', value: 'concat', paramsHint: 'text1, text2, ...' },
                { label: 'Substring', value: 'substring', paramsHint: 'startIndex, endIndex (optional)' },
                { label: 'Length (char count)', value: 'len', paramsHint: 'none' },
                { label: 'Count Words', value: 'countWords', paramsHint: 'none' },
                { label: 'Reverse String', value: 'reverse', paramsHint: 'none' },
                { label: 'Pad Start (left)', value: 'padStart', paramsHint: 'targetLength, padString' },
                { label: 'Pad End (right)', value: 'padEnd', paramsHint: 'targetLength, padString' },
                { label: 'Truncate', value: 'truncate', paramsHint: 'maxLength, suffix (optional)' },
                { label: 'Slugify', value: 'slugify', paramsHint: 'none' },
                { label: 'Extract Number', value: 'extractNumber', paramsHint: 'none' },
                // Number Operations
                { label: 'Add (+)', value: 'add', paramsHint: 'amount' },
                { label: 'Subtract (-)', value: 'subtract', paramsHint: 'amount' },
                { label: 'Multiply (×)', value: 'multiply', paramsHint: 'factor' },
                { label: 'Divide (÷)', value: 'divide', paramsHint: 'divisor' },
                { label: 'Power (^)', value: 'power', paramsHint: 'exponent' },
                { label: 'Square Root (√)', value: 'sqrt', paramsHint: 'none' },
                { label: 'Round', value: 'round', paramsHint: 'none' },
                { label: 'Round To (decimal places)', value: 'roundTo', paramsHint: 'decimals' },
                { label: 'Ceiling', value: 'ceil', paramsHint: 'none' },
                { label: 'Floor', value: 'floor', paramsHint: 'none' },
                { label: 'Absolute Value', value: 'abs', paramsHint: 'none' },
                { label: 'Clamp (min/max)', value: 'clamp', paramsHint: 'min, max' },
                { label: 'Sign (-1/0/1)', value: 'sign', paramsHint: 'none' },
                { label: 'Percentage of Total', value: 'percentOf', paramsHint: 'total' },
                { label: 'Increment', value: 'increment', paramsHint: 'step (optional)' },
                { label: 'Decrement', value: 'decrement', paramsHint: 'step (optional)' },
                // Date Operations
                { label: 'Parse Date', value: 'parseDate', paramsHint: 'none' },
                { label: 'Format Date', value: 'formatDate', paramsHint: 'format (YYYY-MM-DD, MM/DD/YYYY, etc.)' },
                { label: 'Extract Date Part', value: 'extractDatePart', paramsHint: 'part (year/month/day/hour/minute/second/weekday)' },
                { label: 'Add Days', value: 'addDays', paramsHint: 'days' },
                { label: 'Date Difference', value: 'dateDiff', paramsHint: 'compareDate (optional), unit (days/hours/weeks/months/years)' },
                { label: 'Format Time', value: 'formatTime', paramsHint: 'format (HH:mm, hh:mm A, etc.)' },
                // Data Quality
                { label: 'Coalesce (fallback)', value: 'coalesce', paramsHint: 'fallbackValue' },
                { label: 'Is Null? (true/false)', value: 'isNull', paramsHint: 'none' },
                { label: 'Is Numeric? (true/false)', value: 'isNumeric', paramsHint: 'none' },
                { label: 'Is Email? (true/false)', value: 'isEmail', paramsHint: 'none' },
                { label: 'Is Phone? (true/false)', value: 'isPhone', paramsHint: 'none' },
                { label: 'Is URL? (true/false)', value: 'isUrl', paramsHint: 'none' },
                { label: 'Mask Data', value: 'mask', paramsHint: 'start, end, maskChar (optional)' },
                // Comparison (returns true/false)
                { label: 'Equal To (==)', value: 'eq', paramsHint: 'compareValue' },
                { label: 'Not Equal To (!=)', value: 'neq', paramsHint: 'compareValue' },
                { label: 'Greater Than (>)', value: 'gt', paramsHint: 'compareValue' },
                { label: 'Greater Than or Equal (>=)', value: 'gte', paramsHint: 'compareValue' },
                { label: 'Less Than (<)', value: 'lt', paramsHint: 'compareValue' },
                { label: 'Less Than or Equal (<=)', value: 'lte', paramsHint: 'compareValue' },
                // Conditional
                { label: 'If-Then-Else (map value)', value: 'ifThen', paramsHint: 'conditionValue, trueResult, falseResult' },
                { label: 'Switch Case', value: 'switchCase', paramsHint: 'case1,value1,case2,value2,...,default' }
            ]
        },
        {
            name: 'params',
            label: 'Parameters',
            type: 'string',
            required: false,
            description: 'Comma-separated parameters (see hint below for format)'
        },
        {
            name: 'asNewColumn',
            label: 'Create New Column',
            type: 'boolean',
            required: false,
            description: 'If checked, creates a new column instead of replacing existing'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Transform activity: Input dataset is required');
        }
        
        const { column, opKey, params = [], asNewColumn = false } = config;
        validateConfig({ column, opKey }, ['column', 'opKey'], 'Transform');
        
        // For new columns, skip validation since the column is being created
        const actualColumn = asNewColumn ? column : validateColumn(inputDataset, column, 'Transform');

        const paramArray = normalizeParams(params, opKey);
        const { transformDataset } = require('../../expressions/evaluator');
        
        const outputDataset = transformDataset(inputDataset, actualColumn, opKey, paramArray, asNewColumn);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                operation: opKey,
                parameters: paramArray.join(', '),
                targetColumn: actualColumn,
                originalColumn: column,
                isNewColumn: asNewColumn
            });
        }

        return outputDataset;
    }
});

// ─── 3. Remove Duplicates Activity ───────────────────────────────────────────
transformationActivities.push({
    type: 'removeDuplicates',
    displayName: '🧹 Remove Duplicates',
    description: 'Removes duplicate rows based on a column, retaining the first occurrence.',
    category: 'Transformation',
    configRequirements: [
        {
            name: 'column',
            label: 'Column Name',
            type: 'string',
            required: true,
            description: 'Column to evaluate for duplicates'
        },
        {
            name: 'caseSensitive',
            label: 'Case Sensitive',
            type: 'boolean',
            required: false,
            description: 'Treat values case-sensitively (default: true)'
        },
        {
            name: 'keep',
            label: 'Keep',
            type: 'select',
            required: false,
            options: [
                { label: 'First Occurrence', value: 'first' },
                { label: 'Last Occurrence', value: 'last' }
            ],
            description: 'Which duplicate occurrence to keep (default: first)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('RemoveDuplicates activity: Input dataset is required');
        }
        
        const { column, caseSensitive = true, keep = 'first' } = config;
        validateConfig({ column }, ['column'], 'RemoveDuplicates');
        
        // Find the actual column name
        const actualColumn = validateColumn(inputDataset, column, 'RemoveDuplicates');

        const seen = new Map();
        const uniqueRows = [];
        
        const rows = inputDataset.rows;
        
        if (keep === 'first') {
            for (const row of rows) {
                let val = row[actualColumn];
                if (!caseSensitive && typeof val === 'string') {
                    val = val.toLowerCase();
                }
                const key = val !== undefined && val !== null ? val : '___null___';
                if (!seen.has(key)) {
                    seen.set(key, row);
                    uniqueRows.push(row);
                }
            }
        } else {
            // Keep last - track last occurrence
            const rowMap = new Map();
            for (const row of rows) {
                let val = row[actualColumn];
                if (!caseSensitive && typeof val === 'string') {
                    val = val.toLowerCase();
                }
                const key = val !== undefined && val !== null ? val : '___null___';
                rowMap.set(key, row);
            }
            const processedKeys = new Set();
            for (const row of rows) {
                let val = row[actualColumn];
                if (!caseSensitive && typeof val === 'string') {
                    val = val.toLowerCase();
                }
                const key = val !== undefined && val !== null ? val : '___null___';
                if (!processedKeys.has(key)) {
                    const lastRow = rowMap.get(key);
                    if (lastRow) {
                        uniqueRows.push(lastRow);
                        processedKeys.add(key);
                    }
                }
            }
        }

        const outputDataset = new Dataset(uniqueRows, inputDataset.getColumns());

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                recordsRemoved: inputDataset.getRowCount() - outputDataset.getRowCount(),
                duplicateColumn: actualColumn,
                keepStrategy: keep,
                caseSensitive
            });
        }

        return outputDataset;
    }
});

// ─── 4. Sort Activity ─────────────────────────────────────────────────────────
transformationActivities.push({
    type: 'sort',
    displayName: '📊 Sort Data',
    description: 'Sorts rows by one or more columns in ascending or descending order.',
    category: 'Transformation',
    configRequirements: [
        {
            name: 'sortBy',
            label: 'Sort By',
            type: 'string',
            required: true,
            description: 'Column name to sort by'
        },
        {
            name: 'order',
            label: 'Order',
            type: 'select',
            required: false,
            options: [
                { label: 'Ascending (A-Z, 0-9)', value: 'asc' },
                { label: 'Descending (Z-A, 9-0)', value: 'desc' }
            ],
            description: 'Sort order (default: ascending)'
        },
        {
            name: 'numeric',
            label: 'Numeric Sort',
            type: 'select',
            required: false,
            options: [
                { label: 'Auto-detect', value: 'auto' },
                { label: 'Yes', value: 'true' },
                { label: 'No', value: 'false' }
            ],
            description: 'Sort numerically instead of alphabetically (default: auto-detect)'
        },
        {
            name: 'caseSensitive',
            label: 'Case Sensitive',
            type: 'boolean',
            required: false,
            description: 'Treat strings case-sensitively (default: false)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Sort activity: Input dataset is required');
        }
        
        const { sortBy, order = 'asc', numeric = 'auto', caseSensitive = false } = config;
        validateConfig({ sortBy }, ['sortBy'], 'Sort');
        
        // Find the actual column name
        const actualColumn = validateColumn(inputDataset, sortBy, 'Sort');

        const rows = [...inputDataset.rows];
        const columns = inputDataset.getColumns();

        let useNumericSort = numeric === 'auto';
        if (numeric === 'auto') {
            const sample = rows.slice(0, Math.min(100, rows.length));
            const numericCount = sample.filter(row => isNumeric(row[actualColumn])).length;
            useNumericSort = sample.length > 0 && numericCount / sample.length > 0.8;
        } else {
            useNumericSort = numeric === 'true';
        }

        rows.sort((a, b) => {
            let valA = a[actualColumn];
            let valB = b[actualColumn];
            
            if (valA === null || valA === undefined) return order === 'asc' ? -1 : 1;
            if (valB === null || valB === undefined) return order === 'asc' ? 1 : -1;
            
            if (typeof valA === 'string' && !caseSensitive) valA = valA.toLowerCase();
            if (typeof valB === 'string' && !caseSensitive) valB = valB.toLowerCase();
            
            if (useNumericSort) {
                const numA = parseFloat(valA);
                const numB = parseFloat(valB);
                if (!isNaN(numA) && !isNaN(numB)) {
                    return order === 'asc' ? numA - numB : numB - numA;
                }
            }
            
            if (typeof valA === 'string' && typeof valB === 'string') {
                return order === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            
            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        const outputDataset = new Dataset(rows, columns);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                sortColumn: actualColumn,
                sortOrder: order,
                numericSort: useNumericSort
            });
        }

        return outputDataset;
    }
});

// ─── 5. Select Columns Activity ──────────────────────────────────────────────
transformationActivities.push({
    type: 'selectColumns',
    displayName: '📋 Select Columns',
    description: 'Selects or reorders specific columns from the dataset.',
    category: 'Transformation',
    configRequirements: [
        {
            name: 'columns',
            label: 'Columns',
            type: 'string',
            required: true,
            description: 'Comma-separated list of column names to keep (in order)'
        },
        {
            name: 'includeAll',
            label: 'Include All Others',
            type: 'boolean',
            required: false,
            description: 'If true, includes all other columns after the selected ones'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('SelectColumns activity: Input dataset is required');
        }
        
        const { columns, includeAll = false } = config;
        validateConfig({ columns }, ['columns'], 'SelectColumns');
        
        const selectedColumns = columns.split(',').map(c => c.trim()).filter(c => c.length > 0);
        if (selectedColumns.length === 0) {
            throw new Error('SelectColumns activity: No valid columns specified');
        }

        const allColumns = inputDataset.getColumns();
        const validColumns = [];
        const missingColumns = [];

        for (const col of selectedColumns) {
            // Try exact match first
            if (allColumns.includes(col)) {
                validColumns.push(col);
            } else {
                // Try fuzzy match
                const found = findColumnFuzzy(allColumns, col);
                if (found) {
                    validColumns.push(found);
                    console.log(`[VizFlow] Column "${col}" mapped to "${found}"`);
                } else {
                    missingColumns.push(col);
                }
            }
        }

        if (missingColumns.length > 0 && !includeAll) {
            const availableColumns = allColumns.map(c => `"${c}"`).join(', ');
            throw new Error(`SelectColumns activity: Columns not found: ${missingColumns.join(', ')}. Available: ${availableColumns}`);
        }

        let finalColumns = validColumns;
        if (includeAll) {
            const remainingColumns = allColumns.filter(col => !validColumns.includes(col));
            finalColumns = [...validColumns, ...remainingColumns];
        }

        const outputRows = inputDataset.rows.map(row => {
            const newRow = {};
            for (const col of finalColumns) {
                newRow[col] = row[col];
            }
            return newRow;
        });

        const outputDataset = new Dataset(outputRows, finalColumns);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                selectedColumns: finalColumns.length,
                totalColumns: allColumns.length,
                columnsDropped: allColumns.length - finalColumns.length
            });
        }

        return outputDataset;
    }
});

// ─── 6. Join Datasets Activity ───────────────────────────────────────────────
transformationActivities.push({
    type: 'joinDatasets',
    displayName: '🔗 Join Datasets',
    description: 'Joins the current dataset with a second dataset loaded from a CSV or JSON file, matching rows on a key column (like a lookup/VLOOKUP merge).',
    category: 'Transformation',
    configRequirements: [
        {
            name: 'rightFilePath',
            label: 'Right Dataset File',
            type: 'file',
            required: true,
            description: 'Absolute or workspace-relative path to the CSV or JSON file to join against'
        },
        {
            name: 'rightSourceType',
            label: 'Right Source Type',
            type: 'select',
            required: false,
            options: [
                { label: 'CSV', value: 'csv' },
                { label: 'JSON', value: 'json' }
            ],
            description: 'Format of the right-side file (default: csv)'
        },
        {
            name: 'leftKey',
            label: 'Left Join Column',
            type: 'string',
            required: true,
            description: 'Column in the current dataset to match on'
        },
        {
            name: 'rightKey',
            label: 'Right Join Column',
            type: 'string',
            required: false,
            description: 'Column in the right dataset to match on (default: same name as Left Join Column)'
        },
        {
            name: 'joinType',
            label: 'Join Type',
            type: 'select',
            required: false,
            options: [
                { label: 'Inner Join', value: 'inner' },
                { label: 'Left Join', value: 'left' },
                { label: 'Right Join', value: 'right' },
                { label: 'Full Outer Join', value: 'full' }
            ],
            description: 'How to handle rows without a match (default: inner)'
        },
        {
            name: 'columnPrefix',
            label: 'Right Column Prefix',
            type: 'string',
            required: false,
            defaultValue: 'right_',
            description: 'Prefix applied to right-dataset columns whose name collides with a left-dataset column (default: "right_")'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('JoinDatasets activity: Input dataset is required');
        }

        const {
            rightFilePath,
            rightSourceType = 'csv',
            leftKey,
            joinType = 'inner',
            columnPrefix = 'right_'
        } = config;
        const rightKey = config.rightKey || leftKey;

        validateConfig({ rightFilePath, leftKey }, ['rightFilePath', 'leftKey'], 'JoinDatasets');

        // Load the right-side dataset from disk
        const resolvedRightPath = context.resolvePath ? context.resolvePath(rightFilePath) : rightFilePath;
        let rightDataset;
        if (rightSourceType === 'json') {
            const raw = await fs.promises.readFile(resolvedRightPath, 'utf8');
            const parsed = JSON.parse(raw);
            const rightRows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.data) ? parsed.data : []);
            const rightColumns = rightRows.length > 0 ? Object.keys(rightRows[0]) : [];
            rightDataset = new Dataset(rightRows, rightColumns);
        } else {
            const raw = await fs.promises.readFile(resolvedRightPath, 'utf8');
            rightDataset = csvParser.parse(raw);
        }

        const leftColumn = validateColumn(inputDataset, leftKey, 'JoinDatasets');
        const rightColumn = validateColumn(rightDataset, rightKey, 'JoinDatasets');

        const leftColumns = inputDataset.getColumns();
        const rightColumns = rightDataset.getColumns();

        // Map right columns to their (possibly prefixed) output name
        const rightColumnMap = new Map();
        for (const col of rightColumns) {
            if (col === rightColumn && leftColumn === rightColumn) {
                continue; // shared join key, only emitted once
            }
            const outName = leftColumns.includes(col) ? `${columnPrefix}${col}` : col;
            rightColumnMap.set(col, outName);
        }

        const outputColumns = [...leftColumns, ...rightColumnMap.values()];

        // Index right rows by join key for O(1) lookups
        const rightIndex = new Map();
        for (const row of rightDataset.rows) {
            const key = row[rightColumn];
            const bucket = rightIndex.get(key);
            if (bucket) {
                bucket.push(row);
            } else {
                rightIndex.set(key, [row]);
            }
        }

        function mergeRow(leftRow, rightRow) {
            const merged = leftRow ? { ...leftRow } : {};
            if (!leftRow) {
                for (const col of leftColumns) merged[col] = null;
            }
            for (const [rightCol, outName] of rightColumnMap.entries()) {
                merged[outName] = rightRow ? rightRow[rightCol] : null;
            }
            if (rightRow && leftColumn === rightColumn) {
                merged[leftColumn] = leftRow ? leftRow[leftColumn] : rightRow[rightColumn];
            }
            return merged;
        }

        const outputRows = [];
        const matchedRightRows = new Set();
        let matchedCount = 0;
        let unmatchedLeft = 0;

        for (const leftRow of inputDataset.rows) {
            const matches = rightIndex.get(leftRow[leftColumn]) || [];
            if (matches.length > 0) {
                matchedCount += 1;
                for (const rightRow of matches) {
                    outputRows.push(mergeRow(leftRow, rightRow));
                    matchedRightRows.add(rightRow);
                }
            } else {
                unmatchedLeft += 1;
                if (joinType === 'left' || joinType === 'full') {
                    outputRows.push(mergeRow(leftRow, null));
                }
            }
        }

        let unmatchedRight = 0;
        if (joinType === 'right' || joinType === 'full') {
            for (const rightRow of rightDataset.rows) {
                if (!matchedRightRows.has(rightRow)) {
                    unmatchedRight += 1;
                    outputRows.push(mergeRow(null, rightRow));
                }
            }
        }

        const outputDataset = new Dataset(outputRows, outputColumns);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                rightRowCount: rightDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                matchedRows: matchedCount,
                unmatchedLeft,
                unmatchedRight,
                joinType
            });
        }

        return outputDataset;
    }
});

// ─── 7. Pivot Activity ───────────────────────────────────────────────────────
transformationActivities.push({
    type: 'pivot',
    displayName: '🔃 Pivot Table',
    description: 'Reshapes the dataset: rows are grouped by one or more id columns and the distinct values of a pivot column become new columns, aggregated over a value column.',
    category: 'Transformation',
    configRequirements: [
        {
            name: 'idColumns',
            label: 'ID Columns',
            type: 'string',
            required: true,
            description: 'Comma-separated columns that define each output row (the group key)'
        },
        {
            name: 'pivotColumn',
            label: 'Pivot Column',
            type: 'string',
            required: true,
            description: 'Distinct values of this column become new columns'
        },
        {
            name: 'valueColumn',
            label: 'Value Column',
            type: 'string',
            required: true,
            description: 'The column whose values are aggregated into each pivoted cell'
        },
        {
            name: 'aggregation',
            label: 'Aggregation',
            type: 'select',
            required: false,
            defaultValue: 'sum',
            options: [
                { label: 'Sum', value: 'sum' },
                { label: 'Average', value: 'avg' },
                { label: 'Count', value: 'count' },
                { label: 'Minimum', value: 'min' },
                { label: 'Maximum', value: 'max' },
                { label: 'First Value', value: 'first' }
            ],
            description: 'How values are aggregated per pivoted cell (default: sum)'
        },
        {
            name: 'valuePrefix',
            label: 'Value Column Prefix',
            type: 'string',
            required: false,
            description: 'Optional prefix added to each generated pivoted column name'
        },
        {
            name: 'maxPivotValues',
            label: 'Max Pivot Values',
            type: 'number',
            required: false,
            defaultValue: 200,
            description: 'Maximum number of distinct pivot values allowed (guards against column explosion, default: 200)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Pivot activity: Input dataset is required');
        }

        const { aggregation = 'sum', valuePrefix = '', maxPivotValues = 200 } = config;
        validateConfig(config, ['idColumns', 'pivotColumn', 'valueColumn'], 'Pivot');

        const idColumnNames = config.idColumns.split(',').map(c => c.trim()).filter(c => c.length > 0);
        if (idColumnNames.length === 0) {
            throw new Error('Pivot activity: No valid id columns specified');
        }

        const idColumns = idColumnNames.map(c => validateColumn(inputDataset, c, 'Pivot'));
        const pivotColumn = validateColumn(inputDataset, config.pivotColumn, 'Pivot');
        const valueColumn = validateColumn(inputDataset, config.valueColumn, 'Pivot');

        // Collect distinct pivot values in first-seen order (capped to avoid column explosion).
        const pivotValues = [];
        const pivotIndex = new Map();
        for (const row of inputDataset.rows) {
            const raw = row[pivotColumn];
            const key = raw === null || raw === undefined ? '' : String(raw);
            if (!pivotIndex.has(key)) {
                pivotIndex.set(key, pivotValues.length);
                pivotValues.push(key);
            }
        }
        if (pivotValues.length > maxPivotValues) {
            throw new Error(`Pivot: column "${pivotColumn}" has ${pivotValues.length} distinct values exceeding the maximum (${maxPivotValues}). Increase "maxPivotValues" or filter the data first.`);
        }

        // Group rows by composite id key.
        const groups = new Map();
        for (const row of inputDataset.rows) {
            const groupKey = JSON.stringify(idColumns.map(c => row[c]));
            let group = groups.get(groupKey);
            if (!group) {
                group = { idValues: idColumns.map(c => row[c]), cells: [] };
                groups.set(groupKey, group);
            }
            const rawPivot = row[pivotColumn];
            group.cells.push({
                pivotKey: rawPivot === null || rawPivot === undefined ? '' : String(rawPivot),
                value: row[valueColumn]
            });
        }

        function aggregateValues(cellValues, agg) {
            if (cellValues.length === 0) return null;
            switch (agg) {
                case 'count':
                    return cellValues.filter(v => v !== null && v !== undefined).length;
                case 'min':
                case 'max': {
                    const nums = cellValues.filter(v => isNumeric(v)).map(v => parseFloat(v));
                    if (nums.length === 0) return null;
                    return agg === 'min' ? Math.min(...nums) : Math.max(...nums);
                }
                case 'avg': {
                    const nums = cellValues.filter(v => isNumeric(v)).map(v => parseFloat(v));
                    if (nums.length === 0) return null;
                    return nums.reduce((a, b) => a + b, 0) / nums.length;
                }
                case 'first':
                    for (const v of cellValues) {
                        if (v !== null && v !== undefined && v !== '') return v;
                    }
                    return null;
                case 'sum':
                default: {
                    const nums = cellValues.filter(v => isNumeric(v)).map(v => parseFloat(v));
                    if (nums.length === 0) return null;
                    return nums.reduce((a, b) => a + b, 0);
                }
            }
        }

        const pivotedColumnNames = pivotValues.map(pv => `${valuePrefix}${pv}`);
        const outputColumns = [...idColumns, ...pivotedColumnNames];
        const outputRows = [];

        for (const group of groups.values()) {
            const byPivot = new Map();
            for (const cell of group.cells) {
                let bucket = byPivot.get(cell.pivotKey);
                if (!bucket) {
                    bucket = [];
                    byPivot.set(cell.pivotKey, bucket);
                }
                bucket.push(cell.value);
            }
            const row = {};
            idColumns.forEach((col, i) => { row[col] = group.idValues[i]; });
            pivotValues.forEach((pv, i) => {
                row[pivotedColumnNames[i]] = byPivot.has(pv) ? aggregateValues(byPivot.get(pv), aggregation) : null;
            });
            outputRows.push(row);
        }

        const outputDataset = new Dataset(outputRows, outputColumns);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                pivotColumn,
                valueColumn,
                aggregation,
                distinctPivotValues: pivotValues.length
            });
        }

        return outputDataset;
    }
});

// ─── 8. Merge Columns Activity ─────────────────────────────────────────────────
transformationActivities.push({
    type: 'mergeColumns',
    displayName: '🔀 Merge Columns',
    description: 'Combines several columns into a single column, joined by a delimiter.',
    category: 'Transformation',
    configRequirements: [
        {
            name: 'columns',
            label: 'Columns',
            type: 'string',
            required: true,
            description: 'Comma-separated list of column names to merge'
        },
        {
            name: 'targetColumn',
            label: 'Target Column',
            type: 'string',
            required: true,
            description: 'Name of the merged output column'
        },
        {
            name: 'delimiter',
            label: 'Delimiter',
            type: 'string',
            required: false,
            defaultValue: ' ',
            description: 'String placed between the merged values (default: single space)'
        },
        {
            name: 'dropOriginals',
            label: 'Drop Originals',
            type: 'boolean',
            required: false,
            defaultValue: true,
            description: 'Remove the source columns from the output (default: true)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('MergeColumns activity: Input dataset is required');
        }

        const { targetColumn, delimiter = ' ', dropOriginals = true } = config;
        validateConfig(config, ['columns', 'targetColumn'], 'MergeColumns');

        const requestedColumns = config.columns.split(',').map(c => c.trim()).filter(c => c.length > 0);
        if (requestedColumns.length === 0) {
            throw new Error('MergeColumns activity: No valid source columns specified');
        }
        const actualColumns = requestedColumns.map(c => validateColumn(inputDataset, c, 'MergeColumns'));

        const allColumns = inputDataset.getColumns();
        const outputColumns = dropOriginals
            ? [...allColumns.filter(c => !actualColumns.includes(c)), targetColumn]
            : [...allColumns, targetColumn];
        const finalColumns = [...new Set(outputColumns)];

        const outputRows = inputDataset.rows.map(row => {
            const newRow = {};
            for (const col of finalColumns) {
                newRow[col] = row[col];
            }
            const parts = actualColumns.map(c => {
                const v = row[c];
                return v === null || v === undefined ? '' : String(v);
            });
            newRow[targetColumn] = parts.join(delimiter);
            return newRow;
        });

        const outputDataset = new Dataset(outputRows, finalColumns);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                mergedColumns: actualColumns.length,
                targetColumn,
                dropOriginals
            });
        }

        return outputDataset;
    }
});

// ─── 9. Fuzzy Deduplicate Activity ────────────────────────────────────────────
function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
    }
    return dp[a.length][b.length];
}

/**
 * Similarity ratio in [0, 1] based on Levenshtein distance.
 * @param {string} a
 * @param {string} b
 * @returns {number} 1 = identical, 0 = completely different
 */
function similarityRatio(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - levenshteinDistance(a, b) / maxLen;
}

transformationActivities.push({
    type: 'fuzzyDeduplicate',
    displayName: '🔍 Fuzzy Deduplicate',
    description: 'Groups near-duplicate rows by string similarity across one or more columns and marks each cluster, optionally removing the duplicates within it.',
    category: 'Transformation',
    configRequirements: [
        {
            name: 'columns',
            label: 'Columns',
            type: 'string',
            required: true,
            description: 'Comma-separated columns compared when scoring each row'
        },
        {
            name: 'threshold',
            label: 'Similarity Threshold',
            type: 'number',
            required: false,
            defaultValue: 0.8,
            description: 'Minimum similarity (0–1) for a row to join an existing cluster (default: 0.8)'
        },
        {
            name: 'caseSensitive',
            label: 'Case Sensitive',
            type: 'boolean',
            required: false,
            defaultValue: false,
            description: 'Treat values case-sensitively when comparing (default: false)'
        },
        {
            name: 'mode',
            label: 'Mode',
            type: 'select',
            required: false,
            defaultValue: 'annotate',
            options: [
                { label: 'Annotate Clusters', value: 'annotate' },
                { label: 'Remove Duplicates', value: 'removeDuplicates' }
            ],
            description: '"annotate" marks clusters with extra columns; "removeDuplicates" keeps only the representative of each cluster (default: annotate)'
        },
        {
            name: 'includeSimilarity',
            label: 'Include Similarity Column',
            type: 'boolean',
            required: false,
            defaultValue: false,
            description: 'When annotating, also add a __similarity column with each duplicate’s score against its representative'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('FuzzyDeduplicate activity: Input dataset is required');
        }

        const { threshold = 0.8, caseSensitive = false, mode = 'annotate', includeSimilarity = false } = config;
        validateConfig(config, ['columns'], 'FuzzyDeduplicate');

        const requestedColumns = config.columns.split(',').map(c => c.trim()).filter(c => c.length > 0);
        if (requestedColumns.length === 0) {
            throw new Error('FuzzyDeduplicate activity: No valid source columns specified');
        }
        const actualColumns = requestedColumns.map(c => validateColumn(inputDataset, c, 'FuzzyDeduplicate'));

        function normalizedParts(row) {
            return actualColumns.map(c => {
                const v = row[c];
                const s = v === null || v === undefined ? '' : String(v);
                return caseSensitive ? s : s.toLowerCase();
            });
        }
        function partsRatio(a, b) {
            let total = 0;
            for (let i = 0; i < actualColumns.length; i++) {
                total += similarityRatio(a[i], b[i]);
            }
            return actualColumns.length > 0 ? total / actualColumns.length : 0;
        }

        // Greedy clustering: each row is compared against the representative of
        // every cluster seen so far and joins the best match above the threshold.
        const representatives = [];
        const assignments = [];
        for (let i = 0; i < inputDataset.rows.length; i++) {
            const parts = normalizedParts(inputDataset.rows[i]);
            let bestRep = -1;
            let bestSim = 0;
            for (let r = 0; r < representatives.length; r++) {
                const sim = partsRatio(parts, representatives[r].parts);
                if (sim > bestSim) {
                    bestSim = sim;
                    bestRep = r;
                }
            }
            if (bestRep !== -1 && bestSim >= threshold) {
                assignments.push({
                    cluster: representatives[bestRep].cluster,
                    repRow: representatives[bestRep].sourceRow,
                    similarity: bestSim
                });
            } else {
                const cluster = representatives.length + 1;
                representatives.push({ parts, sourceRow: i, cluster });
                assignments.push({ cluster, repRow: i, similarity: null });
            }
        }

        const baseColumns = inputDataset.getColumns();
        const annotationColumns = ['__match_group', '__duplicate_of'];
        if (includeSimilarity) annotationColumns.push('__similarity');

        const outputRows = [];
        for (let i = 0; i < inputDataset.rows.length; i++) {
            const assign = assignments[i];
            const isRepresentative = assign.repRow === i;
            if (mode === 'removeDuplicates' && !isRepresentative) continue;

            const out = { ...inputDataset.rows[i] };
            if (mode === 'annotate') {
                out.__match_group = assign.cluster;
                out.__duplicate_of = isRepresentative ? '' : assign.repRow + 1;
                if (includeSimilarity) {
                    out.__similarity = isRepresentative || assign.similarity === null
                        ? ''
                        : Math.round(assign.similarity * 1000) / 1000;
                }
            }
            outputRows.push(out);
        }

        const outputColumns = mode === 'annotate'
            ? [...baseColumns, ...annotationColumns]
            : baseColumns;
        const outputDataset = new Dataset(outputRows, outputColumns);

        if (context && context.setActivityStats) {
            const clustersFound = representatives.filter(r =>
                assignments.some(a => a.cluster === r.cluster && a.repRow !== r.sourceRow)
            ).length;
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                clustersFound,
                duplicatesFlagged: inputDataset.getRowCount() - representatives.length,
                threshold,
                mode
            });
        }

        return outputDataset;
    }
});

// ─── 10. JSON Transform Activity ──────────────────────────────────────────────
/**
 * Flatten a parsed JSON value into a flat object of columns. Nested objects are
 * spread recursively as `parent.child`; arrays are stored as JSON strings.
 * @param {*} obj - Parsed JSON value
 * @param {string} prefix - Optional column name prefix
 * @returns {Object} Flattened column -> value map
 */
function flattenJsonToColumns(obj, prefix) {
    const out = {};
    const visit = (value, path) => {
        if (value === null || value === undefined) {
            out[path] = null;
            return;
        }
        if (Array.isArray(value)) {
            out[path] = JSON.stringify(value);
            return;
        }
        if (typeof value === 'object') {
            for (const [k, v] of Object.entries(value)) {
                const childPath = path === undefined
                    ? (prefix ? `${prefix}${k}` : k)
                    : `${path}.${k}`;
                if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
                    visit(v, childPath);
                } else {
                    out[childPath] = Array.isArray(v) ? JSON.stringify(v) : v;
                }
            }
            return;
        }
        out[path] = value;
    };
    visit(obj, undefined);
    return out;
}

transformationActivities.push({
    type: 'jsonTransform',
    displayName: '🧩 JSON Transform',
    description: 'Parses a JSON-string column and spreads nested object fields into new flattened columns. Nested arrays are kept as JSON string values.',
    category: 'Transformation',
    configRequirements: [
        {
            name: 'column',
            label: 'Column Name',
            type: 'string',
            required: true,
            description: 'The column containing JSON strings to parse and flatten'
        },
        {
            name: 'prefix',
            label: 'Generated Column Prefix',
            type: 'string',
            required: false,
            description: 'Optional prefix added to every generated column name'
        },
        {
            name: 'skipErrors',
            label: 'Skip Invalid Rows',
            type: 'boolean',
            required: false,
            defaultValue: false,
            description: 'When enabled, rows with invalid/non-object JSON are passed through unchanged instead of failing the workflow (default: false)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('JSON Transform activity: Input dataset is required');
        }

        const { prefix = '', skipErrors = false } = config;
        validateConfig(config, ['column'], 'JSON Transform');

        const sourceColumn = validateColumn(inputDataset, config.column, 'JSON Transform');
        const baseColumns = inputDataset.getColumns();

        const generatedColumns = [];
        const generatedIndex = new Map();
        function registerGenerated(name) {
            if (!generatedIndex.has(name)) {
                generatedIndex.set(name, generatedColumns.length);
                generatedColumns.push(name);
            }
        }

        const outputRows = [];
        let skippedRows = 0;
        for (let i = 0; i < inputDataset.rows.length; i++) {
            const original = inputDataset.rows[i];
            const out = { ...original };
            const raw = original[sourceColumn];
            if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
                outputRows.push(out);
                continue;
            }

            let parsed = raw;
            if (typeof raw === 'string') {
                try {
                    parsed = JSON.parse(raw.trim());
                } catch (err) {
                    if (skipErrors) {
                        skippedRows++;
                        outputRows.push(out);
                        continue;
                    }
                    throw new Error(`JSON Transform: row ${i + 1} in column "${sourceColumn}" is not valid JSON: ${err.message}`);
                }
            }
            if (parsed === null || typeof parsed !== 'object') {
                if (skipErrors) {
                    skippedRows++;
                    outputRows.push(out);
                    continue;
                }
                throw new Error(`JSON Transform: row ${i + 1} in column "${sourceColumn}" must contain a JSON object or array`);
            }

            const flattened = flattenJsonToColumns(parsed, prefix);
            for (const key of Object.keys(flattened)) {
                registerGenerated(key);
                out[key] = flattened[key];
            }
            outputRows.push(out);
        }

        const outputColumns = [...baseColumns];
        for (const col of generatedColumns) {
            if (!outputColumns.includes(col)) {
                outputColumns.push(col);
            }
        }

        const outputDataset = new Dataset(outputRows, outputColumns);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                parsedColumn: sourceColumn,
                columnsAdded: outputColumns.filter(c => !baseColumns.includes(c)).length,
                skippedRows
            });
        }

        return outputDataset;
    }
});

module.exports = transformationActivities;
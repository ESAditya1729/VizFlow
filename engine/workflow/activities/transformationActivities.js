/**
 * engine/workflow/activities/transformationActivities.js
 *
 * Transformation activities for modifying data.
 */

'use strict';

const Dataset = require('../../dataset');

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Find column by name with fuzzy matching (non-recursive version)
 * @param {Array<string>} columns - Array of column names
 * @param {string} targetName - Target column name to find
 * @returns {string|null} Found column name or null
 */
function findColumnFuzzy(columns, targetName) {
    if (!columns || !targetName || columns.length === 0) return null;
    
    const targetLower = targetName.toLowerCase().trim();
    
    // 1. Exact match (case insensitive)
    for (const col of columns) {
        if (col.toLowerCase() === targetLower) {
            return col;
        }
    }
    
    // 2. Trim and normalize match (handle extra spaces)
    const normalizedTarget = targetLower.replace(/\s+/g, ' ');
    for (const col of columns) {
        const normalizedCol = col.toLowerCase().trim().replace(/\s+/g, ' ');
        if (normalizedCol === normalizedTarget) {
            return col;
        }
    }
    
    // 3. Contains match (for partial matches)
    for (const col of columns) {
        const colLower = col.toLowerCase().trim();
        if (colLower.includes(targetLower) || targetLower.includes(colLower)) {
            return col;
        }
    }
    
    // 4. Replace underscores with spaces
    const withSpaces = targetLower.replace(/_/g, ' ');
    if (withSpaces !== targetLower) {
        for (const col of columns) {
            if (col.toLowerCase().trim().replace(/\s+/g, ' ') === withSpaces.replace(/\s+/g, ' ')) {
                return col;
            }
        }
    }
    
    // 5. Replace spaces with underscores
    const withUnderscores = targetLower.replace(/ /g, '_');
    if (withUnderscores !== targetLower) {
        for (const col of columns) {
            if (col.toLowerCase() === withUnderscores) {
                return col;
            }
        }
    }
    
    // 6. Remove common prefixes/suffixes
    const cleanTarget = targetLower.replace(/^(date|column|field|value)_?/i, '').trim();
    if (cleanTarget !== targetLower && cleanTarget.length > 0) {
        for (const col of columns) {
            const colLower = col.toLowerCase().trim();
            const cleanCol = colLower.replace(/^(date|column|field|value)_?/i, '').trim();
            if (cleanCol === cleanTarget) {
                return col;
            }
            if (colLower.includes(cleanTarget) || cleanTarget.includes(colLower)) {
                return col;
            }
        }
    }
    
    return null;
}

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

/**
 * Validate required configuration
 * @param {Object} config - Activity configuration
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
 * Validate column exists in dataset with fuzzy matching
 * @param {Dataset} dataset - Input dataset
 * @param {string} column - Column name to validate
 * @param {string} activityName - Activity name for error messages
 * @returns {string} The actual column name found (or original if not found)
 * @throws {Error} If column not found
 */
function validateColumn(dataset, column, activityName) {
    const columns = dataset.getColumns();
    
    // Try exact match first
    if (columns.includes(column)) {
        return column;
    }
    
    // Try fuzzy match
    const foundColumn = findColumnFuzzy(columns, column);
    if (foundColumn) {
        console.log(`[VizFlow] Column "${column}" mapped to "${foundColumn}"`);
        return foundColumn;
    }
    
    // If still not found, throw with available columns
    const availableColumns = columns.map(c => `"${c}"`).join(', ');
    throw new Error(`${activityName}: Column "${column}" not found. Available columns: ${availableColumns}`);
}

/**
 * Check if a value is numeric
 * @param {*} value - Value to check
 * @returns {boolean} True if value is numeric
 */
function isNumeric(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'number') return !isNaN(value);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return false;
        return !isNaN(trimmed) && !isNaN(parseFloat(trimmed));
    }
    return false;
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
        
        // Find the actual column name
        const actualColumn = validateColumn(inputDataset, column, 'Transform');

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

module.exports = transformationActivities;
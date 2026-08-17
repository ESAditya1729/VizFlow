/**
 * engine/workflow/activities/controlActivities.js
 *
 * Control flow activities for workflow orchestration.
 */

'use strict';

const Dataset = require('../../dataset');
const templateService = require('../../../services/templateService');

// ─── Constants ──────────────────────────────────────────────────────────────
const VALID_OPERATORS = ['==', '!=', '>', '>=', '<', '<=', 'contains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty', 'regex'];
const VALID_SOURCE_TYPES = ['static', 'column', 'expression', 'variable', 'jsonPath'];

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
 * Check if a value matches a condition
 * @param {*} row - Row object
 * @param {string} column - Column name
 * @param {string} operator - Comparison operator
 * @param {*} value - Value to compare against
 * @returns {boolean} True if condition matches
 */
function matchesCondition(row, column, operator, value, caseSensitive = true) {
    const rawVal = row[column];
    const compStr = value !== undefined && value !== null ? String(value) : '';

    // Handle null/undefined operators
    if (operator === 'isEmpty') {
        return rawVal === null || rawVal === undefined || String(rawVal).trim() === '';
    }
    if (operator === 'isNotEmpty') {
        return rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '';
    }

    // Normalize values for comparison
    let a = rawVal;
    let b = value;

    // Try numeric comparison
    const numA = Number(rawVal);
    const numB = Number(value);
    const isNumericCompare = !isNaN(numA) && !isNaN(numB) && value !== '' && value !== undefined && value !== null;

    if (isNumericCompare) {
        a = numA;
        b = numB;
    } else {
        // Convert to strings for string comparison
        a = rawVal !== null && rawVal !== undefined ? String(rawVal) : '';
        b = compStr;
        if (!caseSensitive) {
            a = a.toLowerCase();
            b = b.toLowerCase();
        }
    }

    switch (operator) {
        case '==': return a === b;
        case '!=': return a !== b;
        case '>': return a > b;
        case '>=': return a >= b;
        case '<': return a < b;
        case '<=': return a <= b;
        case 'contains':
            if (caseSensitive) {
                return String(rawVal !== null && rawVal !== undefined ? rawVal : '').includes(compStr);
            }
            return String(rawVal !== null && rawVal !== undefined ? rawVal : '').toLowerCase().includes(compStr.toLowerCase());
        case 'startsWith':
            if (caseSensitive) {
                return String(rawVal !== null && rawVal !== undefined ? rawVal : '').startsWith(compStr);
            }
            return String(rawVal !== null && rawVal !== undefined ? rawVal : '').toLowerCase().startsWith(compStr.toLowerCase());
        case 'endsWith':
            if (caseSensitive) {
                return String(rawVal !== null && rawVal !== undefined ? rawVal : '').endsWith(compStr);
            }
            return String(rawVal !== null && rawVal !== undefined ? rawVal : '').toLowerCase().endsWith(compStr.toLowerCase());
        case 'regex': {
            try {
                const regex = new RegExp(value, caseSensitive ? '' : 'i');
                return regex.test(String(rawVal !== null && rawVal !== undefined ? rawVal : ''));
            } catch {
                return false;
            }
        }
        default:
            throw new Error(`Unsupported operator "${operator}"`);
    }
}

/**
 * Evaluate expression with variable substitution
 * @param {string} expr - Expression string
 * @param {Object} context - Execution context
 * @param {Object} row - Optional row for row reference
 * @returns {*} Evaluated value
 */
function evaluateExpression(expr, context, row = null) {
    if (!expr || typeof expr !== 'string') return expr;

    // Replace {{row.column}} and {{variable}} / {{variable.path}} references
    let result = templateService.interpolate(expr, context.variables || {}, {
        row,
        replaceMissingWith: ''
    });

    // Try to evaluate as JavaScript expression
    try {
        if (/[+\-*/%(){}\[\]"']/.test(result) || /^\s*\d/.test(result)) {
            // Safety: only allow safe expressions
            const sanitized = result.replace(/[^0-9+\-*/%().\s[\]{}"',]/g, '');
            if (sanitized === result || /^[\d\s+\-*/%().]+$/.test(result)) {
                const fn = new Function(`return (${result})`);
                const evaluated = fn();
                if (evaluated !== undefined) {
                    return evaluated;
                }
            }
        }
    } catch {
        // If evaluation fails, return the substituted string
    }

    return result;
}

/**
 * True when the current run has been cancelled via the engine's abort signal.
 * @param {Object} [engineOptions]
 * @returns {boolean}
 */
function isCancelled(engineOptions) {
    return !!(engineOptions && engineOptions.signal && engineOptions.signal.aborted);
}

/**
 * Merge datasets with column alignment
 * @param {Array<Dataset>} datasets - Array of datasets to merge
 * @returns {Dataset} Merged dataset
 */
function mergeDatasets(datasets) {
    if (datasets.length === 0) {
        return new Dataset([], []);
    }

    if (datasets.length === 1) {
        return datasets[0];
    }

    // Collect all columns
    const allColumns = new Set();
    for (const ds of datasets) {
        for (const col of ds.getColumns()) {
            allColumns.add(col);
        }
    }

    const columns = Array.from(allColumns);
    const rows = [];

    for (const ds of datasets) {
        for (const row of ds.rows) {
            const mergedRow = {};
            for (const col of columns) {
                mergedRow[col] = row[col] !== undefined ? row[col] : null;
            }
            rows.push(mergedRow);
        }
    }

    return new Dataset(rows, columns);
}

// ─── Activity Definitions ──────────────────────────────────────────────────

const controlActivities = [];

// ─── 1. Multi-Transform Activity ─────────────────────────────────────────────
controlActivities.push({
    type: 'multiTransform',
    displayName: '⚡ Multi-Transform',
    description: 'Applies multiple column operations in sequence within a single step.',
    category: 'Control',
    configRequirements: [
        {
            name: 'actions',
            label: 'Actions',
            type: 'multiAction',
            required: true,
            description: 'List of transform operations to apply in order',
            operationOptions: [
                { label: 'UPPER CASE', value: 'upper' },
                { label: 'lower case', value: 'lower' },
                { label: 'Title Case', value: 'titleCase' },
                { label: 'Trim Whitespace', value: 'trim' },
                { label: 'Replace Text', value: 'replace' },
                { label: 'Concat (append)', value: 'concat' },
                { label: 'Substring', value: 'substring' },
                { label: 'Length (char count)', value: 'len' },
                { label: 'Pad Start (left)', value: 'padStart' },
                { label: 'Pad End (right)', value: 'padEnd' },
                { label: 'Add (+)', value: 'add' },
                { label: 'Subtract (-)', value: 'subtract' },
                { label: 'Multiply (×)', value: 'multiply' },
                { label: 'Divide (÷)', value: 'divide' },
                { label: 'Power (^)', value: 'power' },
                { label: 'Round', value: 'round' },
                { label: 'Absolute Value', value: 'abs' },
                // Date Operations
                { label: 'Parse Date', value: 'parseDate' },
                { label: 'Format Date', value: 'formatDate' },
                { label: 'Add Days', value: 'addDays' },
                { label: 'Extract Date Part', value: 'extractDatePart' },
                { label: 'Date Difference', value: 'dateDiff' },
                { label: 'Format Time', value: 'formatTime' },
                { label: 'Coalesce (fallback)', value: 'coalesce' },
                { label: 'Starts With (check)', value: 'startsWith' },
                { label: 'Ends With (check)', value: 'endsWith' },
                { label: 'Contains (check)', value: 'contains' },
                { label: 'Equal To (==)', value: 'eq' },
                { label: 'Not Equal To (!=)', value: 'neq' },
                { label: 'Greater Than (>)', value: 'gt' },
                { label: 'Greater Than or Equal (>=)', value: 'gte' },
                { label: 'Less Than (<)', value: 'lt' },
                { label: 'Less Than or Equal (<=)', value: 'lte' },
                { label: 'If-Then-Else (map value)', value: 'ifThen' },
                { label: 'Regex Extract', value: 'regexExtract' },
                { label: 'Clean (alphanumeric only)', value: 'clean' }
            ]
        },
        {
            name: 'stopOnError',
            label: 'Stop on Error',
            type: 'boolean',
            required: false,
            description: 'Stop processing if any action fails (default: true)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Multi-Transform activity: Input dataset is required');
        }

        const actions = config.actions;
        const stopOnError = config.stopOnError !== false;

        if (!Array.isArray(actions) || actions.length === 0) {
            throw new Error('Multi-Transform activity: at least one action is required');
        }

        const evaluator = require('../../expressions/evaluator');
        let dataset = inputDataset;
        let actionsApplied = 0;
        const errors = [];

        for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            const { column, opKey, params = '', asNewColumn = false } = action;

            if (!column) {
                const error = `Multi-Transform action ${i + 1}: "column" is required`;
                if (stopOnError) throw new Error(error);
                errors.push(error);
                continue;
            }

            if (!opKey) {
                const error = `Multi-Transform action ${i + 1}: "opKey" is required`;
                if (stopOnError) throw new Error(error);
                errors.push(error);
                continue;
            }

            let paramArray = typeof params === 'string'
                ? params.split(',').map(p => p.trim()).filter(p => p.length > 0)
                : (Array.isArray(params) ? params : []);

            try {
                const results = evaluator.evaluate(dataset.rows, column, opKey, paramArray);
                const targetCol = asNewColumn ? `${column}_transformed` : column;
                const newRows = results.map(r => ({ ...r.row, [targetCol]: r.result }));
                let newCols = [...dataset.getColumns()];
                if (!newCols.includes(targetCol)) newCols.push(targetCol);
                dataset = new Dataset(newRows, newCols);
                actionsApplied++;
            } catch (error) {
                const errorMsg = `Multi-Transform action ${i + 1} failed: ${error.message}`;
                if (stopOnError) throw new Error(errorMsg);
                errors.push(errorMsg);
            }
        }

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: dataset.getRowCount(),
                actionsApplied,
                actionsTotal: actions.length,
                errors: errors.length,
                hasErrors: errors.length > 0
            });
        }

        return dataset;
    }
});

// ─── 2. If-Else Block Activity ───────────────────────────────────────────────
controlActivities.push({
    type: 'ifElse',
    displayName: '🔀 If-Else Block',
    description: 'Splits rows by condition: matching rows go through the THEN branch, non-matching through the ELSE branch.',
    category: 'Control',
    configRequirements: [
        {
            name: 'column',
            label: 'Column',
            type: 'string',
            required: true,
            description: 'Column to evaluate the condition on'
        },
        {
            name: 'operator',
            label: 'Operator',
            type: 'select',
            required: true,
            options: [
                { label: 'Equal To (==)', value: '==' },
                { label: 'Not Equal To (!=)', value: '!=' },
                { label: 'Greater Than (>)', value: '>' },
                { label: 'Greater Than or Equal (>=)', value: '>=' },
                { label: 'Less Than (<)', value: '<' },
                { label: 'Less Than or Equal (<=)', value: '<=' },
                { label: 'Contains', value: 'contains' },
                { label: 'Starts With', value: 'startsWith' },
                { label: 'Ends With', value: 'endsWith' },
                { label: 'Is Empty', value: 'isEmpty' },
                { label: 'Is Not Empty', value: 'isNotEmpty' },
                { label: 'Regex Match', value: 'regex' }
            ],
            description: 'Comparison operator for the condition'
        },
        {
            name: 'value',
            label: 'Value',
            type: 'string',
            required: false,
            description: 'Value to compare against (not needed for isEmpty / isNotEmpty)'
        },
        {
            name: 'caseSensitive',
            label: 'Case Sensitive',
            type: 'boolean',
            required: false,
            description: 'Treat strings case-sensitively (default: true)'
        }
    ],
    async execute(config, context, inputDataset, engineOptions) {
        if (!inputDataset) {
            throw new Error('If-Else activity: Input dataset is required');
        }

        const { column, operator, value = '', caseSensitive = true } = config;
        validateConfig({ column, operator }, ['column', 'operator'], 'If-Else');

        // Validate operator
        if (!VALID_OPERATORS.includes(operator)) {
            throw new Error(`If-Else activity: Unsupported operator "${operator}"`);
        }

        // Check if value is required
        const operatorsRequiringValue = ['==', '!=', '>', '>=', '<', '<=', 'contains', 'startsWith', 'endsWith', 'regex'];
        if (operatorsRequiringValue.includes(operator) && (value === undefined || value === '')) {
            throw new Error(`If-Else activity: "value" is required for operator "${operator}"`);
        }

        const cols = inputDataset.getColumns();

        // Split rows
        const thenRows = [];
        const elseRows = [];

        for (const row of inputDataset.rows) {
            const matches = matchesCondition(row, column, operator, value, caseSensitive);
            if (matches) {
                thenRows.push(row);
            } else {
                elseRows.push(row);
            }
        }

        const thenSteps = config.thenSteps || [];
        const elseSteps = config.elseSteps || [];

        const { executeSteps } = require('../workflowEngine');
        const dummyResults = {};

        let thenDataset = new Dataset(thenRows, cols);
        if (thenSteps.length > 0) {
            const thenResult = await executeSteps(thenSteps, context, thenDataset, dummyResults, engineOptions);
            if (!thenResult.success) {
                throw new Error(`If-Else THEN branch failed: ${thenResult.error}`);
            }
            thenDataset = thenResult.dataset || thenDataset;
        }

        let elseDataset = new Dataset(elseRows, cols);
        if (elseSteps.length > 0) {
            const elseResult = await executeSteps(elseSteps, context, elseDataset, dummyResults, engineOptions);
            if (!elseResult.success) {
                throw new Error(`If-Else ELSE branch failed: ${elseResult.error}`);
            }
            elseDataset = elseResult.dataset || elseDataset;
        }

        // Merge results
        const outputDataset = mergeDatasets([thenDataset, elseDataset]);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                thenRows: thenRows.length,
                elseRows: elseRows.length,
                outputRowCount: outputDataset.getRowCount(),
                conditionColumn: column,
                conditionOperator: operator
            });
        }

        return outputDataset;
    }
});

// ─── 3. For-Each Block Activity ─────────────────────────────────────────────
controlActivities.push({
    type: 'forEach',
    displayName: '🔁 For-Each Block',
    description: 'Groups rows by a column value and runs the inner steps on each group independently. Results are merged back in order.',
    category: 'Control',
    configRequirements: [
        {
            name: 'groupBy',
            label: 'Group By Column',
            type: 'string',
            required: true,
            description: 'Column whose distinct values define the groups (e.g. "region", "category")'
        },
        {
            name: 'sortGroups',
            label: 'Sort Groups',
            type: 'select',
            required: false,
            options: [
                { label: 'None (preserve order)', value: 'none' },
                { label: 'Ascending', value: 'asc' },
                { label: 'Descending', value: 'desc' }
            ],
            description: 'Order in which group keys are processed (default: none)'
        },
        {
            name: 'maxGroups',
            label: 'Max Groups',
            type: 'number',
            required: false,
            description: 'Maximum number of groups to process (0 = unlimited)'
        },
        {
            name: 'continueOnError',
            label: 'Continue on Error',
            type: 'boolean',
            required: false,
            description: 'Continue processing other groups if one fails (default: false)'
        }
    ],
    async execute(config, context, inputDataset, engineOptions) {
        if (!inputDataset) {
            throw new Error('For-Each activity: Input dataset is required');
        }

        const { groupBy, sortGroups = 'none', maxGroups = 0, continueOnError = false } = config;
        validateConfig({ groupBy }, ['groupBy'], 'For-Each');

        const cols = inputDataset.getColumns();
        if (!cols.includes(groupBy)) {
            throw new Error(`For-Each activity: Column "${groupBy}" not found in dataset`);
        }

        // ─── Build group map ──────────────────────────────────────────────────
        const groupMap = new Map();
        for (const row of inputDataset.rows) {
            const key = row[groupBy] !== null && row[groupBy] !== undefined ? String(row[groupBy]) : '';
            if (!groupMap.has(key)) groupMap.set(key, []);
            groupMap.get(key).push(row);
        }

        let keys = Array.from(groupMap.keys());
        if (sortGroups === 'asc') keys.sort((a, b) => a.localeCompare(b));
        if (sortGroups === 'desc') keys.sort((a, b) => b.localeCompare(a));

        // Limit groups if specified
        if (maxGroups > 0 && keys.length > maxGroups) {
            keys = keys.slice(0, maxGroups);
        }

        const innerSteps = config.steps || [];
        const { executeSteps } = require('../workflowEngine');
        const opts = engineOptions || {};

        const mergedRows = [];
        let mergedCols = cols;
        let groupsProcessed = 0;
        const errors = [];

        for (const key of keys) {
            if (isCancelled(opts)) {
                const err = new Error('Workflow cancelled');
                err.name = 'AbortError';
                throw err;
            }

            const groupRows = groupMap.get(key);
            let groupDataset = new Dataset(groupRows, cols);

            if (innerSteps.length > 0) {
                // Create a sample row for template substitution
                const sampleRow = groupRows[0] || {};

                // Process inner steps with template substitution
                const processedSteps = innerSteps.map(step => {
                    const processedConfig = {};
                    for (const [configKey, configValue] of Object.entries(step.config || {})) {
                        if (typeof configValue === 'string') {
                            processedConfig[configKey] = evaluateExpression(configValue, context, sampleRow);
                        } else {
                            processedConfig[configKey] = configValue;
                        }
                    }
                    return {
                        ...step,
                        config: processedConfig
                    };
                });

                const dummyResults = {};
                try {
                    const groupResult = await executeSteps(processedSteps, context, groupDataset, dummyResults, opts);
                    if (!groupResult.success) {
                        const errorMsg = `For-Each group "${key}" failed: ${groupResult.error}`;
                        if (!continueOnError) {
                            throw new Error(errorMsg);
                        }
                        errors.push(errorMsg);
                        continue;
                    }
                    groupDataset = groupResult.dataset || groupDataset;
                } catch (error) {
                    const errorMsg = `For-Each group "${key}" error: ${error.message}`;
                    if (!continueOnError) {
                        throw new Error(errorMsg);
                    }
                    errors.push(errorMsg);
                    continue;
                }
            }

            // Accumulate columns
            for (const c of groupDataset.getColumns()) {
                if (!mergedCols.includes(c)) mergedCols = [...mergedCols, c];
            }
            mergedRows.push(...groupDataset.rows);
            groupsProcessed++;
        }

        const outputDataset = new Dataset(mergedRows, mergedCols);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                groupsProcessed,
                groupsTotal: groupMap.size,
                groupByColumn: groupBy,
                errors: errors.length,
                hasErrors: errors.length > 0
            });
        }

        return outputDataset;
    }
});

// ─── 4. Set Variable Activity ──────────────────────────────────────────────
controlActivities.push({
    type: 'setVariable',
    displayName: '📝 Set Variable',
    description: 'Set a variable value for use in later steps.',
    category: 'Control',
    configRequirements: [
        {
            name: 'variableName',
            label: 'Variable Name',
            type: 'string',
            required: true,
            description: 'Name of the variable to set'
        },
        {
            name: 'sourceType',
            label: 'Source Type',
            type: 'select',
            required: true,
            options: [
                { label: '📝 Static Value', value: 'static' },
                { label: '📊 From Column (first row)', value: 'column' },
                { label: '📈 From Expression', value: 'expression' },
                { label: '📋 From Previous Variable', value: 'variable' },
                { label: '🔍 From JSON Path', value: 'jsonPath' }
            ],
            description: 'Where to get the value from'
        },
        {
            name: 'value',
            label: 'Static Value',
            type: 'string',
            required: false,
            description: 'Static value to store (for static source type)'
        },
        {
            name: 'column',
            label: 'Column Name',
            type: 'string',
            required: false,
            description: 'Column to extract value from (for column source type)'
        },
        {
            name: 'expression',
            label: 'Expression',
            type: 'text',
            required: false,
            description: 'JavaScript expression to evaluate (use {{variable}} for variable substitution)'
        },
        {
            name: 'sourceVariable',
            label: 'Source Variable',
            type: 'string',
            required: false,
            description: 'Variable to copy from (for variable source type)'
        },
        {
            name: 'jsonPath',
            label: 'JSON Path',
            type: 'string',
            required: false,
            description: 'JSON path to extract value from source object (e.g., "data.user.name")'
        },
        {
            name: 'rowIndex',
            label: 'Row Index',
            type: 'number',
            required: false,
            defaultValue: 0,
            description: 'Row index to extract from (for column source type)'
        },
        {
            name: 'defaultValue',
            label: 'Default Value',
            type: 'string',
            required: false,
            description: 'Default value if source value is undefined or null'
        }
    ],
    async execute(config, context, inputDataset) {
        const {
            variableName,
            sourceType,
            value,
            column,
            expression,
            sourceVariable,
            jsonPath,
            rowIndex = 0,
            defaultValue = ''
        } = config;

        validateConfig({ variableName, sourceType }, ['variableName', 'sourceType'], 'Set Variable');

        if (!VALID_SOURCE_TYPES.includes(sourceType)) {
            throw new Error(`Set Variable activity: Unknown sourceType "${sourceType}"`);
        }

        let resultValue;

        switch (sourceType) {
            case 'static':
                resultValue = value !== undefined ? value : '';
                break;

            case 'column':
                if (!column) {
                    throw new Error('Set Variable activity: "column" is required for column source type');
                }
                if (!inputDataset || inputDataset.rows.length === 0) {
                    throw new Error('Set Variable activity: No data available to extract column value');
                }
                const idx = Math.min(parseInt(rowIndex) || 0, inputDataset.rows.length - 1);
                resultValue = inputDataset.rows[idx]?.[column];
                if (resultValue === undefined || resultValue === null) {
                    resultValue = defaultValue;
                }
                break;

            case 'variable':
                if (!sourceVariable) {
                    throw new Error('Set Variable activity: "sourceVariable" is required for variable source type');
                }
                resultValue = context.getVariable(sourceVariable);
                if (resultValue === undefined || resultValue === null) {
                    resultValue = defaultValue;
                }
                break;

            case 'expression':
                if (!expression) {
                    throw new Error('Set Variable activity: "expression" is required for expression source type');
                }
                // First interpolate variables in the expression
                let interpolatedExpr = expression;
                const varRegex = /\{\{([^}]+)\}\}/g;
                let match;
                while ((match = varRegex.exec(expression)) !== null) {
                    const varPath = match[1].trim();
                    const varValue = templateService.getPath(context.variables, varPath);
                    if (varValue !== undefined && varValue !== null) {
                        // If it's a string, wrap in quotes for JS evaluation
                        const replacement = typeof varValue === 'string'
                            ? `'${varValue.replace(/'/g, "\\'")}'`
                            : String(varValue);
                        interpolatedExpr = interpolatedExpr.replace(match[0], replacement);
                    }
                }

                // Now evaluate the expression
                try {
                    // Safe evaluation using Function constructor
                    const fn = new Function(`return (${interpolatedExpr})`);
                    resultValue = fn();

                    // If the result is a Date object, format it
                    if (resultValue instanceof Date && !isNaN(resultValue)) {
                        resultValue = resultValue;
                    }

                    if (resultValue === undefined || resultValue === null) {
                        resultValue = defaultValue;
                    }
                } catch (error) {
                    console.error('Expression evaluation error:', error);
                    resultValue = defaultValue;
                }
                break;

            case 'jsonPath':
                if (!jsonPath) {
                    throw new Error('Set Variable activity: "jsonPath" is required for jsonPath source type');
                }
                if (!sourceVariable) {
                    throw new Error('Set Variable activity: "sourceVariable" is required for jsonPath source type');
                }
                const sourceObj = context.getVariable(sourceVariable);
                if (sourceObj === undefined || sourceObj === null) {
                    resultValue = defaultValue;
                } else {
                    resultValue = templateService.getPath(sourceObj, jsonPath);
                    if (resultValue === undefined || resultValue === null) {
                        resultValue = defaultValue;
                    }
                }
                break;

            default:
                throw new Error(`Set Variable activity: Unknown sourceType "${sourceType}"`);
        }

        context.setVariable(variableName, resultValue);

        if (context && context.setActivityStats) {
            const valuePreview = typeof resultValue === 'object'
                ? JSON.stringify(resultValue).slice(0, 100)
                : String(resultValue).slice(0, 100);

            context.setActivityStats({
                variableName,
                sourceType,
                valueSet: resultValue !== undefined && resultValue !== null,
                valuePreview: valuePreview,
                valueType: typeof resultValue
            });
        }

        return inputDataset;
    }
});

// ─── 5. Wait Activity ────────────────────────────────────────────────────────
controlActivities.push({
    type: 'wait',
    displayName: '⏳ Wait',
    description: 'Pauses workflow execution for a specified duration.',
    category: 'Control',
    configRequirements: [
        {
            name: 'duration',
            label: 'Duration (seconds)',
            type: 'number',
            required: true,
            defaultValue: 5,
            description: 'Number of seconds to wait (minimum: 1)'
        },
        {
            name: 'maxDuration',
            label: 'Max Duration (seconds)',
            type: 'number',
            required: false,
            description: 'Maximum duration to wait (0 = unlimited)'
        },
        {
            name: 'condition',
            label: 'Wait Condition',
            type: 'string',
            required: false,
            description: 'Expression to evaluate as wait condition (e.g., "{{progress}} < 100")'
        }
    ],
    async execute(config, context, inputDataset, engineOptions) {
        const { duration = 5, maxDuration = 0, condition } = config;

        if (duration < 1) {
            throw new Error('Wait activity: "duration" must be at least 1 second');
        }

        let elapsed = 0;

        const startTime = Date.now();

        while (elapsed < duration) {
            // Exit promptly if the run was cancelled
            if (isCancelled(engineOptions)) {
                const err = new Error('Workflow cancelled');
                err.name = 'AbortError';
                throw err;
            }

            // Check if condition is satisfied (if provided)
            if (condition) {
                const evaluated = evaluateExpression(condition, context);
                if (evaluated === true || evaluated === 'true') {
                    // Condition satisfied, exit early
                    break;
                }
            }

            // Wait for 1 second
            await new Promise(resolve => setTimeout(resolve, 1000));
            elapsed = (Date.now() - startTime) / 1000;

            // Check max duration
            if (maxDuration > 0 && elapsed >= maxDuration) {
                break;
            }
        }

        if (context && context.setActivityStats) {
            context.setActivityStats({
                durationSeconds: elapsed,
                maxDurationSeconds: maxDuration,
                hadCondition: !!condition,
                conditionMet: condition ? evaluateExpression(condition, context) === true : null
            });
        }

        return inputDataset;
    }
});

// ─── 6. Call Workflow Activity ──────────────────────────────────────────────

const CALL_WORKFLOW_MAX_DEPTH = 10;
const CALL_WORKFLOW_BUILTIN_VARIABLES = new Set([
    'workflowName', 'timestamp', 'workspaceRoot', 'date', 'time',
    'year', 'month', 'day', 'hour', 'minute', 'second'
]);

/**
 * Return the last non-empty dataset from a set of step results.
 * @param {Object} results - Results object from executeWorkflow
 * @returns {Dataset|null}
 */
function lastDatasetOf(results) {
    if (!results || typeof results !== 'object') return null;
    const keys = Object.keys(results);
    for (let i = keys.length - 1; i >= 0; i--) {
        const r = results[keys[i]];
        if (r && r.success && r.dataset) return r.dataset;
    }
    return null;
}

controlActivities.push({
    type: 'callWorkflow',
    displayName: '🔗 Call Workflow',
    description: 'Runs another .vizflow workflow as a reusable sub-workflow, passing parameters and receiving its final dataset and variables.',
    category: 'Control',
    configRequirements: [
        {
            name: 'workflowPath',
            label: 'Workflow File',
            type: 'file',
            required: true,
            description: 'Path to the .vizflow workflow to run (absolute or relative to the workspace)'
        },
        {
            name: 'parameters',
            label: 'Parameters',
            type: 'keyValue',
            required: false,
            description: 'Values to pass into the sub-workflow parameters ({{variable}} interpolation supported)'
        },
        {
            name: 'exportVariables',
            label: 'Export Variables',
            type: 'boolean',
            required: false,
            defaultValue: true,
            description: 'Copy sub-workflow variables (set via Set Variable) back into the caller (default: true)'
        },
        {
            name: 'outputMode',
            label: 'Output Mode',
            type: 'select',
            required: false,
            options: [
                { label: 'Pass Through (sub-workflow output)', value: 'passthrough' },
                { label: 'Keep Caller Dataset', value: 'keepCaller' }
            ],
            description: 'What the activity produces as its output dataset'
        }
    ],
    async execute(config, context, inputDataset, engineOptions) {
        const {
            workflowPath,
            parameters = {},
            exportVariables = true,
            outputMode = 'passthrough'
        } = config;

        if (!workflowPath) {
            throw new Error('Call Workflow activity: "workflowPath" is required');
        }

        const fs = require('fs');

        const resolved = typeof context.resolvePath === 'function'
            ? context.resolvePath(workflowPath)
            : workflowPath;

        if (!fs.existsSync(resolved)) {
            throw new Error(`Call Workflow activity: workflow file not found: "${resolved}"`);
        }

        let subDef;
        try {
            subDef = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        } catch (error) {
            throw new Error(`Call Workflow activity: invalid workflow file "${resolved}": ${error.message}`);
        }

        if (!subDef.activities || !Array.isArray(subDef.activities)) {
            throw new Error(`Call Workflow activity: "${resolved}" is not a valid workflow definition`);
        }

        // ─── Cycle guard ────────────────────────────────────────────────────
        const stack = Array.isArray(engineOptions && engineOptions.workflowStack)
            ? engineOptions.workflowStack
            : [];
        if (stack.includes(resolved)) {
            throw new Error(
                `Call Workflow activity: circular workflow call detected (${[...stack, resolved].join(' → ')})`
            );
        }
        if (stack.length >= CALL_WORKFLOW_MAX_DEPTH) {
            throw new Error(`Call Workflow activity: max call depth (${CALL_WORKFLOW_MAX_DEPTH}) exceeded`);
        }

        // ─── Validate & interpolate parameters ──────────────────────────────
        const declaredParams = Array.isArray(subDef.parameters) ? subDef.parameters : [];
        const declaredNames = new Set(declaredParams.map(p => p && p.name).filter(Boolean));
        const incoming = parameters && typeof parameters === 'object' ? parameters : {};

        for (const key of Object.keys(incoming)) {
            if (!declaredNames.has(key)) {
                throw new Error(
                    `Call Workflow activity: unknown parameter "${key}" for workflow "${subDef.name || resolved}". ` +
                    `Declared parameters: ${[...declaredNames].join(', ') || 'none'}`
                );
            }
        }

        const subParams = {};
        for (const key of Object.keys(incoming)) {
            const val = incoming[key];
            subParams[key] = typeof val === 'string' ? context.interpolate(val) : val;
        }

        // ─── Execute the sub-workflow ───────────────────────────────────────
        const { executeWorkflow } = require('../../workflow/workflowEngine');
        const subStart = Date.now();

        const subResult = await executeWorkflow(subDef, {
            resolvePath: typeof context.resolvePath === 'function' ? context.resolvePath : undefined,
            initialVariables: subParams,
            signal: engineOptions ? engineOptions.signal : undefined,
            maxRetries: engineOptions ? engineOptions.maxRetries : undefined,
            timeoutMs: engineOptions ? engineOptions.timeoutMs : undefined,
            workflowStack: [...stack, resolved]
        });

        if (!subResult.success) {
            throw new Error(
                `Call Workflow activity: sub-workflow "${subDef.name || resolved}" failed: ${subResult.error}`
            );
        }

        // ─── Export variables back to the caller ────────────────────────────
        let exportedCount = 0;
        if (exportVariables && subResult.variables) {
            for (const [key, val] of Object.entries(subResult.variables)) {
                if (CALL_WORKFLOW_BUILTIN_VARIABLES.has(key)) continue;
                context.setVariable(key, val);
                exportedCount++;
            }
        }

        // ─── Output dataset ─────────────────────────────────────────────────
        let outputDataset;
        if (outputMode === 'keepCaller') {
            outputDataset = inputDataset;
        } else {
            outputDataset = lastDatasetOf(subResult.results);
            if (!outputDataset) outputDataset = inputDataset;
        }

        if (context && context.setActivityStats) {
            context.setActivityStats({
                subWorkflow: subDef.name || resolved,
                workflowPath: resolved,
                callDepth: stack.length + 1,
                durationMs: Date.now() - subStart,
                outputRows: outputDataset ? outputDataset.getRowCount() : 0,
                parametersPassed: Object.keys(incoming).length,
                exportedVariables: exportedCount
            });
        }

        return outputDataset;
    }
});

module.exports = controlActivities;
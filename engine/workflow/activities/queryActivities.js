/**
 * engine/workflow/activities/queryActivities.js
 *
 * Query activities for executing RBQL queries.
 */

'use strict';

const Dataset = require('../../dataset');
const rbqlService = require('../../../services/rbqlService');

// ─── Constants ──────────────────────────────────────────────────────────────
const SUPPORTED_QUERY_TYPES = ['SELECT', 'UPDATE', 'DELETE', 'CREATE'];
const MAX_QUERY_LENGTH = 10000;

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Validate query string
 * @param {string} query - RBQL query string
 * @param {Object} options - Validation options
 * @param {boolean} options.allowUpdate - Allow UPDATE queries
 * @param {number} options.maxLength - Maximum query length
 * @throws {Error} If query is invalid
 */
function validateQueryString(query, options = {}) {
    const { allowUpdate = false, maxLength = MAX_QUERY_LENGTH } = options;
    
    if (!query || typeof query !== 'string') {
        throw new Error('Query must be a non-empty string');
    }
    
    const trimmed = query.trim();
    if (trimmed.length === 0) {
        throw new Error('Query cannot be empty');
    }
    
    if (trimmed.length > maxLength) {
        throw new Error(`Query exceeds maximum length of ${maxLength} characters`);
    }
    
    // Check for dangerous operations
    const upperQuery = trimmed.toUpperCase();
    if (!allowUpdate && (upperQuery.includes('UPDATE') || upperQuery.includes('DELETE'))) {
        throw new Error('UPDATE and DELETE queries are not allowed in this context');
    }
    
    // Check for SQL injection patterns (basic prevention)
    const dangerousPatterns = [
        /;\s*DROP\s+/i,
        /;\s*TRUNCATE\s+/i,
        /;\s*ALTER\s+/i,
        /UNION\s+SELECT/i,
        /--\s*$/m,
        /\/\*.*\*\//
    ];
    
    for (const pattern of dangerousPatterns) {
        if (pattern.test(trimmed)) {
            throw new Error('Query contains potentially dangerous operations');
        }
    }
    
    return true;
}

/**
 * Convert RBQL result rows to objects
 * @param {Array} rows - Array of row arrays
 * @param {Array} columns - Column names
 * @returns {Array} Array of row objects
 */
function rowsToObjects(rows, columns) {
    return rows.map(rowArray => {
        const obj = {};
        columns.forEach((col, idx) => {
            const val = rowArray[idx];
            // Convert numeric strings to numbers
            if (typeof val === 'string' && val !== '' && val !== null) {
                const num = Number(val);
                obj[col] = !isNaN(num) ? num : val;
            } else if (val === '' || val === null || val === undefined) {
                obj[col] = null;
            } else {
                obj[col] = val;
            }
        });
        return obj;
    });
}

/**
 * Generate query preview for stats
 * @param {string} query - Full query
 * @param {number} maxLength - Maximum preview length
 * @returns {string} Truncated query preview
 */
function getQueryPreview(query, maxLength = 50) {
    const trimmed = query.trim();
    if (trimmed.length <= maxLength) return trimmed;
    return trimmed.substring(0, maxLength) + '...';
}

/**
 * Get query type from query string
 * @param {string} query - RBQL query
 * @returns {string} Query type (SELECT, UPDATE, DELETE, etc.)
 */
function getQueryType(query) {
    const trimmed = query.trim().toUpperCase();
    for (const type of SUPPORTED_QUERY_TYPES) {
        if (trimmed.startsWith(type)) {
            return type;
        }
    }
    return 'UNKNOWN';
}

// ─── Activity Definitions ──────────────────────────────────────────────────

const queryActivities = [];

// ─── 1. RBQL Query Activity ──────────────────────────────────────────────────
queryActivities.push({
    type: 'query',
    displayName: '📊 RBQL Query',
    description: 'Executes an RBQL query on the input dataset.',
    category: 'Query',
    configRequirements: [
        {
            name: 'query',
            label: 'RBQL Query',
            type: 'text',
            required: true,
            description: 'RBQL SQL-like query (e.g. "SELECT a1, a2 WHERE a3 > 100")',
            placeholder: 'SELECT column1, column2 WHERE column3 > 100'
        },
        {
            name: 'allowUpdate',
            label: 'Allow UPDATE/DELETE',
            type: 'boolean',
            required: false,
            description: 'Allow UPDATE and DELETE operations (use with caution)'
        },
        {
            name: 'timeoutMs',
            label: 'Timeout (ms)',
            type: 'number',
            required: false,
            description: 'Query execution timeout in milliseconds (default: 30000)',
            defaultValue: 30000
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Query activity: Input dataset is required');
        }
        
        const { 
            query, 
            allowUpdate = false, 
            timeoutMs = 30000 
        } = config;
        
        if (!query) {
            throw new Error('Query activity: "query" is required');
        }

        // Validate query before execution
        try {
            validateQueryString(query, { allowUpdate, maxLength: MAX_QUERY_LENGTH });
        } catch (error) {
            throw new Error(`Query validation failed: ${error.message}`);
        }

        // First validate with RBQL service
        const validation = rbqlService.validateQuery(query);
        if (!validation.valid) {
            throw new Error(`Invalid RBQL query: ${validation.error}`);
        }

        // Execute query with timeout
        let result;
        if (timeoutMs > 0) {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Query execution timed out after ${timeoutMs}ms`)), timeoutMs);
            });
            result = await Promise.race([
                rbqlService.executeQuery(inputDataset, query),
                timeoutPromise
            ]);
        } else {
            result = await rbqlService.executeQuery(inputDataset, query);
        }
        
        if (!result.success) {
            throw new Error(`RBQL execution failed: ${result.error}`);
        }

        // Process results
        const queryType = getQueryType(query);
        let outputDataset;
        let rowCount;

        // Handle different query types
        if (queryType === 'UPDATE' || queryType === 'DELETE') {
            // For UPDATE/DELETE, return the modified dataset
            outputDataset = inputDataset;
            rowCount = result.rows ? result.rows.length : 0;
        } else {
            // For SELECT, CREATE, etc. return new dataset
            if (!result.rows || result.rows.length === 0) {
                // Return empty dataset with appropriate columns
                const columns = result.columns || [];
                outputDataset = new Dataset([], columns);
                rowCount = 0;
            } else {
                const rowObjects = rowsToObjects(result.rows, result.columns);
                outputDataset = new Dataset(rowObjects, result.columns);
                rowCount = result.rows.length;
            }
        }

        // Update stats
        if (context && context.setActivityStats) {
            const stats = {
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                queryType: queryType,
                queryPreview: getQueryPreview(query),
                rowCount: rowCount
            };
            
            // Add update-specific stats
            if (queryType === 'UPDATE') {
                stats.affectedRows = result.affectedRows || rowCount;
            } else if (queryType === 'DELETE') {
                stats.deletedRows = result.deletedRows || rowCount;
            }
            
            context.setActivityStats(stats);
        }

        return outputDataset;
    }
});

// ─── 2. Data Preview Query Activity ──────────────────────────────────────────
queryActivities.push({
    type: 'previewQuery',
    displayName: '👁️ Data Preview',
    description: 'Preview top rows from a dataset with optional filtering.',
    category: 'Query',
    configRequirements: [
        {
            name: 'limit',
            label: 'Number of Rows',
            type: 'number',
            required: false,
            description: 'Maximum number of rows to preview (default: 100)',
            defaultValue: 100
        },
        {
            name: 'where',
            label: 'Filter Condition',
            type: 'string',
            required: false,
            description: 'Optional RBQL WHERE clause (e.g., "a1 > 100 AND a2 = \'Active\'")'
        },
        {
            name: 'orderBy',
            label: 'Order By',
            type: 'string',
            required: false,
            description: 'Optional column to order by (e.g., "a1 DESC")'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('PreviewQuery activity: Input dataset is required');
        }

        const { limit = 100, where = '', orderBy = '' } = config;

        if (limit < 1) {
            throw new Error('PreviewQuery activity: "limit" must be at least 1');
        }

        if (limit > 10000) {
            throw new Error('PreviewQuery activity: "limit" cannot exceed 10000');
        }

        // Build query
        let query = 'SELECT *';
        
        if (where && where.trim()) {
            query += ` WHERE ${where.trim()}`;
        }
        
        if (orderBy && orderBy.trim()) {
            query += ` ORDER BY ${orderBy.trim()}`;
        }
        
        query += ` LIMIT ${limit}`;

        // Validate with RBQL service
        const validation = rbqlService.validateQuery(query);
        if (!validation.valid) {
            throw new Error(`Invalid preview query: ${validation.error}`);
        }

        // Execute query
        const result = await rbqlService.executeQuery(inputDataset, query);
        if (!result.success) {
            throw new Error(`Preview execution failed: ${result.error}`);
        }

        // Convert result
        let outputDataset;
        if (!result.rows || result.rows.length === 0) {
            const columns = result.columns || inputDataset.getColumns() || [];
            outputDataset = new Dataset([], columns);
        } else {
            const rowObjects = rowsToObjects(result.rows, result.columns);
            outputDataset = new Dataset(rowObjects, result.columns);
        }

        // Update stats
        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                previewLimit: limit,
                hasFilter: !!where,
                hasOrder: !!orderBy
            });
        }

        return outputDataset;
    }
});

// ─── 3. Column Statistics Query Activity ─────────────────────────────────────
queryActivities.push({
    type: 'columnStats',
    displayName: '📈 Column Statistics',
    description: 'Generates statistics for specified columns.',
    category: 'Analytics',
    configRequirements: [
        {
            name: 'columns',
            label: 'Columns',
            type: 'string',
            required: true,
            description: 'Comma-separated list of column names to analyze'
        },
        {
            name: 'stats',
            label: 'Statistics',
            type: 'select',
            required: false,
            options: [
                { label: 'All Statistics', value: 'all' },
                { label: 'Count, Min, Max, Mean', value: 'basic' },
                { label: 'Count, Distinct, Nulls', value: 'quality' }
            ],
            description: 'Which statistics to compute (default: all)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('ColumnStats activity: Input dataset is required');
        }

        const { columns, stats = 'all' } = config;
        if (!columns) {
            throw new Error('ColumnStats activity: "columns" is required');
        }

        const columnList = columns.split(',').map(c => c.trim()).filter(c => c.length > 0);
        if (columnList.length === 0) {
            throw new Error('ColumnStats activity: No valid columns specified');
        }

        const allColumns = inputDataset.getColumns();
        const validColumns = [];
        const missingColumns = [];

        for (const col of columnList) {
            if (allColumns.includes(col)) {
                validColumns.push(col);
            } else {
                missingColumns.push(col);
            }
        }

        if (validColumns.length === 0) {
            throw new Error(`ColumnStats activity: None of the specified columns exist. Available: ${allColumns.join(', ')}`);
        }

        if (missingColumns.length > 0) {
            console.warn(`[VizFlow] ColumnStats: Skipping missing columns: ${missingColumns.join(', ')}`);
        }

        // Compute statistics
        const results = [];
        for (const col of validColumns) {
            const values = inputDataset.rows.map(row => row[col]);
            const statsResult = computeColumnStats(values, stats);
            results.push({
                column: col,
                ...statsResult
            });
        }

        // Convert to dataset
        const resultRows = results.map(r => ({
            column: r.column,
            count: r.count,
            distinct: r.distinct,
            nulls: r.nulls,
            min: r.min,
            max: r.max,
            mean: r.mean,
            median: r.median,
            stdDev: r.stdDev,
            sum: r.sum
        }));

        const resultColumns = ['column', 'count', 'distinct', 'nulls', 'min', 'max', 'mean', 'median', 'stdDev', 'sum'];
        const outputDataset = new Dataset(resultRows, resultColumns);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: outputDataset.getRowCount(),
                columnsAnalyzed: validColumns.length,
                columnsSkipped: missingColumns.length,
                statsType: stats
            });
        }

        return outputDataset;
    }
});

// ─── Statistics Helper Functions ────────────────────────────────────────────

/**
 * Compute column statistics
 * @param {Array} values - Array of values
 * @param {string} statsType - Type of statistics to compute
 * @returns {Object} Statistics object
 */
function computeColumnStats(values, statsType = 'all') {
    const validValues = values.filter(v => v !== null && v !== undefined);
    const numericValues = validValues
        .map(v => typeof v === 'number' ? v : parseFloat(v))
        .filter(v => !isNaN(v));

    const count = values.length;
    const nulls = count - validValues.length;
    const distinct = new Set(validValues).size;

    const result = {
        count,
        nulls,
        distinct
    };

    if (statsType === 'quality') {
        return result;
    }

    if (numericValues.length > 0) {
        const sorted = [...numericValues].sort((a, b) => a - b);
        const sum = numericValues.reduce((acc, v) => acc + v, 0);
        const mean = sum / numericValues.length;
        const min = sorted[0];
        const max = sorted[sorted.length - 1];

        // Median
        let median;
        const mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) {
            median = (sorted[mid - 1] + sorted[mid]) / 2;
        } else {
            median = sorted[mid];
        }

        // Standard deviation
        const variance = numericValues.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / numericValues.length;
        const stdDev = Math.sqrt(variance);

        Object.assign(result, {
            min,
            max,
            mean,
            median,
            stdDev,
            sum
        });

        if (statsType === 'basic') {
            delete result.median;
            delete result.stdDev;
            delete result.sum;
        }
    } else {
        // Non-numeric column
        if (statsType === 'all' || statsType === 'basic') {
            // For string columns, add string-specific stats
            const stringValues = validValues.filter(v => typeof v === 'string');
            if (stringValues.length > 0) {
                const lengths = stringValues.map(v => v.length);
                const avgLength = lengths.reduce((acc, v) => acc + v, 0) / lengths.length;
                const minLength = Math.min(...lengths);
                const maxLength = Math.max(...lengths);
                
                Object.assign(result, {
                    avgLength,
                    minLength,
                    maxLength
                });
            }
        }
    }

    return result;
}

module.exports = queryActivities;
/**
 * engine/workflow/activities/databaseActivities.js
 *
 * External data source activities (MongoDB / MySQL / PostgreSQL).
 *
 * All activities are READ-ONLY and reference connections by their friendly
 * `name`; credentials are resolved from SecretStorage at execution time, so
 * `.vizflow` files never contain secrets.
 */

'use strict';

const Dataset = require('../../dataset');
const { buildSelect, parseOrderBy, quoteIdentifier } = require('../../../services/database/sqlQueryBuilder');

// ─── Connection resolution ───────────────────────────────────────────────────

/**
 * Resolve a connection profile from its friendly name/id.
 * Uses an injected context.connectionManager when available (tests), otherwise
 * the extension-host singleton.
 * @param {string} name
 * @param {Object} context
 * @returns {Promise<Object|null>}
 */
async function resolveConnection(name, context) {
    if (!name || typeof name !== 'string' || !name.trim()) {
        throw new Error('Database activity: a "connection" is required');
    }
    const manager = context && context.connectionManager
        ? context.connectionManager
        : require('../../../services/database/connectionManager').getConnectionManager();
    const profile = await manager.getByName(name.trim());
    if (!profile) {
        throw new Error(`Database activity: connection "${name}" was not found. Add it in the VizFlow Data Sources panel.`);
    }
    return profile;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Validate required config fields (mirrors other activity modules).
 * @param {Object} config
 * @param {Array<string>} required
 * @param {string} activityName
 */
function validateConfig(config, required, activityName) {
    for (const field of required) {
        const value = config[field];
        if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
            throw new Error(`${activityName}: "${field}" is required`);
        }
    }
}

/**
 * Parse a Mongo filter config into a filter document.
 * @param {string|Object} raw
 * @returns {Object} Mongo filter document
 */
function parseMongoFilter(raw) {
    if (!raw) return {};
    let filter = raw;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return {};
        try {
            filter = JSON.parse(trimmed);
        } catch (err) {
            throw new Error(`Invalid filter JSON: ${err.message}`);
        }
    }
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
        throw new Error('Filter must be a JSON object');
    }
    return filter;
}

/**
 * Parse a projection config ("a,b" or JSON) into a Mongo projection document.
 * @param {string|Object} raw
 * @returns {Object|null}
 */
function parseProjection(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{')) {
        try {
            return JSON.parse(trimmed);
        } catch (err) {
            throw new Error(`Invalid projection JSON: ${err.message}`);
        }
    }
    const projection = {};
    trimmed.split(',').map((f) => f.trim()).filter(Boolean).forEach((f) => {
        projection[f] = 1;
    });
    return projection;
}

/**
 * Parse a sort config ("field:1,other:-1" or JSON) into a Mongo sort document.
 * @param {string|Object} raw
 * @returns {Object|null}
 */
function parseSort(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{')) {
        try {
            return JSON.parse(trimmed);
        } catch (err) {
            throw new Error(`Invalid sort JSON: ${err.message}`);
        }
    }
    const sort = {};
    for (const part of trimmed.split(',')) {
        const [field, dir] = part.split(':').map((s) => s.trim());
        if (!field) continue;
        sort[field] = dir === 'desc' || dir === '-1' ? -1 : 1;
    }
    return sort;
}

/**
 * Split a comma-separated column list.
 * @param {string|Array} columns
 * @returns {Array<string>}
 */
function splitColumns(columns) {
    if (Array.isArray(columns)) return columns.map((c) => String(c).trim()).filter(Boolean);
    if (typeof columns === 'string') {
        return columns.split(',').map((c) => c.trim()).filter(Boolean);
    }
    return [];
}

// ─── Activity Definitions ────────────────────────────────────────────────────

const databaseActivities = [];

// ─── 1. Read Mongo ───────────────────────────────────────────────────────────
databaseActivities.push({
    type: 'readMongo',
    displayName: '🍃 Read Mongo Collection',
    description: 'Reads documents from a MongoDB collection into a Dataset using a saved connection.',
    category: 'Input',
    configRequirements: [
        {
            name: 'connection',
            label: 'Connection',
            type: 'connection',
            required: true,
            description: 'Saved connection (created in the VizFlow Data Sources panel)'
        },
        {
            name: 'database',
            label: 'Database',
            type: 'select',
            required: false,
            dynamic: 'mongodbDatabases',
            dependsOn: 'connection',
            description: 'Database to read from (default: connection database)'
        },
        {
            name: 'collection',
            label: 'Collection',
            type: 'select',
            required: true,
            dynamic: 'mongodbCollections',
            dependsOn: 'database',
            description: 'Collection to read documents from'
        },
        {
            name: 'filter',
            label: 'Filter (JSON)',
            type: 'text',
            required: false,
            description: 'Optional Mongo filter document, e.g. { "status": "active" }',
            placeholder: '{ "status": "active", "amount": { "$gt": 100 } }'
        },
        {
            name: 'projection',
            label: 'Projection',
            type: 'string',
            required: false,
            description: 'Columns to include, comma-separated or JSON (default: all)',
            placeholder: 'name, amount, createdAt'
        },
        {
            name: 'sort',
            label: 'Sort',
            type: 'string',
            required: false,
            description: 'Sort as field:1 / field:-1 or JSON (default: natural order)',
            placeholder: 'createdAt:-1'
        },
        {
            name: 'limit',
            label: 'Limit Rows',
            type: 'number',
            required: false,
            defaultValue: 0,
            description: 'Maximum documents to read (0 = up to 100,000)'
        }
    ],
    async execute(config, context, _inputDataset) {
        validateConfig(config, ['connection', 'collection'], 'Read Mongo');
        const connection = await resolveConnection(config.connection, context);
        const mongoService = require('../../../services/database/mongoService');

        const database = config.database && String(config.database).trim()
            ? String(config.database).trim()
            : connection.database;
        if (!database) {
            throw new Error('Read Mongo: a "database" is required (set one on the connection or in the activity)');
        }

        const limit = parseInt(config.limit, 10) || 0;
        const filter = parseMongoFilter(config.filter);
        const projection = parseProjection(config.projection);
        const sort = parseSort(config.sort);

        const { rows, columns } = await mongoService.find(connection, {
            database,
            collection: String(config.collection).trim(),
            filter,
            projection,
            sort,
            limit
        });

        if (context && context.setActivityStats) {
            context.setActivityStats({
                outputRowCount: rows.length,
                columnCount: columns.length,
                connection: config.connection,
                database,
                collection: config.collection,
                hasFilter: Object.keys(filter).length > 0
            });
        }

        return new Dataset(rows, columns);
    }
});

// ─── 2. Read SQL ─────────────────────────────────────────────────────────────
databaseActivities.push({
    type: 'readSql',
    displayName: '🗄️ Read SQL Table',
    description: 'Reads rows from a MySQL or PostgreSQL table into a Dataset using a saved connection.',
    category: 'Input',
    configRequirements: [
        {
            name: 'connection',
            label: 'Connection',
            type: 'connection',
            required: true,
            description: 'Saved connection (created in the VizFlow Data Sources panel)'
        },
        {
            name: 'table',
            label: 'Table',
            type: 'select',
            required: true,
            dynamic: 'sqlTables',
            dependsOn: 'connection',
            description: 'Table to read rows from'
        },
        {
            name: 'columns',
            label: 'Columns',
            type: 'columns',
            required: false,
            dynamic: 'sqlColumns',
            dependsOn: 'table',
            description: 'Columns to include (default: all)'
        },
        {
            name: 'filterModel',
            label: 'Filter (visual model)',
            type: 'object',
            required: false,
            description: 'Filter built by the Data Sources visual query builder',
            placeholder: '{ "conditions": [...] }'
        },
        {
            name: 'where',
            label: 'WHERE clause (advanced)',
            type: 'text',
            required: false,
            description: 'Optional raw SQL WHERE clause without the WHERE keyword',
            placeholder: 'amount > 100 AND status = \'active\''
        },
        {
            name: 'orderBy',
            label: 'Order By',
            type: 'string',
            required: false,
            description: 'Optional ORDER BY expression, e.g. "created_at DESC"',
            placeholder: 'created_at DESC'
        },
        {
            name: 'limit',
            label: 'Limit Rows',
            type: 'number',
            required: false,
            defaultValue: 1000,
            description: 'Maximum rows to read (0 = up to 100,000)'
        }
    ],
    async execute(config, context, _inputDataset) {
        validateConfig(config, ['connection', 'table'], 'Read SQL');
        const connection = await resolveConnection(config.connection, context);
        const sqlService = require('../../../services/database/sqlService');
        const dialect = connection.type === 'postgresql' ? 'postgresql' : 'mysql';

        const table = String(config.table).trim();
        const columns = splitColumns(config.columns);
        const limit = parseInt(config.limit, 10) || 0;

        let sql;
        let params = [];

        if (config.filterModel !== undefined && config.filterModel !== null &&
            (typeof config.filterModel !== 'object' || Array.isArray(config.filterModel) ||
             !Array.isArray(config.filterModel.conditions))) {
            throw new Error('Read SQL: "filterModel" must be an object with a "conditions" array (build it in the Data Sources panel or enter valid JSON)');
        }

        const hasFilterModel = config.filterModel &&
            typeof config.filterModel === 'object' &&
            Array.isArray(config.filterModel.conditions);

        if (hasFilterModel) {
            const built = buildSelect({
                table,
                dialect,
                columns,
                filterModel: config.filterModel,
                orderBy: config.orderBy,
                limit
            });
            if (built.errors.length > 0) {
                throw new Error(`Read SQL: filter error — ${built.errors.join('; ')}`);
            }
            sql = built.sql;
            params = built.params;
        } else {
            const colList = columns.length > 0
                ? columns.map((c) => quoteIdentifier(c, dialect)).join(', ')
                : '*';
            sql = `SELECT ${colList} FROM ${quoteIdentifier(table, dialect)}`;
            if (config.where && String(config.where).trim()) {
                sql += ` WHERE ${String(config.where).trim()}`;
            }
            if (config.orderBy && String(config.orderBy).trim()) {
                const parsed = parseOrderBy(String(config.orderBy), dialect);
                if (parsed) sql += ` ORDER BY ${parsed}`;
            }
        }

        const result = await sqlService.runSelect(connection, sql, params, { limit });

        if (context && context.setActivityStats) {
            context.setActivityStats({
                outputRowCount: result.rowCount,
                columnCount: result.columns.length,
                connection: config.connection,
                table,
                hasFilter: hasFilterModel || !!config.where
            });
        }

        return new Dataset(result.rows, result.columns);
    }
});

// ─── 3. Mongo Query (advanced) ───────────────────────────────────────────────
databaseActivities.push({
    type: 'mongoQuery',
    displayName: '🍃 Mongo Query',
    description: 'Runs an advanced read-only Mongo query with a raw filter document.',
    category: 'Query',
    configRequirements: [
        {
            name: 'connection',
            label: 'Connection',
            type: 'connection',
            required: true,
            description: 'Saved connection (created in the VizFlow Data Sources panel)'
        },
        {
            name: 'database',
            label: 'Database',
            type: 'select',
            required: false,
            dynamic: 'mongodbDatabases',
            dependsOn: 'connection',
            description: 'Database to query (default: connection database)'
        },
        {
            name: 'collection',
            label: 'Collection',
            type: 'select',
            required: true,
            dynamic: 'mongodbCollections',
            dependsOn: 'database',
            description: 'Collection to query'
        },
        {
            name: 'filter',
            label: 'Filter (JSON)',
            type: 'text',
            required: true,
            description: 'Mongo filter document to apply',
            placeholder: '{ "amount": { "$gt": 100 } }'
        },
        {
            name: 'projection',
            label: 'Projection',
            type: 'string',
            required: false,
            description: 'Columns to include, comma-separated or JSON',
            placeholder: 'name, amount'
        },
        {
            name: 'sort',
            label: 'Sort',
            type: 'string',
            required: false,
            description: 'Sort as field:1 / field:-1 or JSON',
            placeholder: 'createdAt:-1'
        },
        {
            name: 'limit',
            label: 'Limit Rows',
            type: 'number',
            required: false,
            defaultValue: 1000,
            description: 'Maximum documents to return (0 = up to 100,000)'
        }
    ],
    async execute(config, context, _inputDataset) {
        validateConfig(config, ['connection', 'collection', 'filter'], 'Mongo Query');
        const connection = await resolveConnection(config.connection, context);
        const mongoService = require('../../../services/database/mongoService');

        const database = config.database && String(config.database).trim()
            ? String(config.database).trim()
            : connection.database;
        if (!database) {
            throw new Error('Mongo Query: a "database" is required (set one on the connection or in the activity)');
        }

        const filter = parseMongoFilter(config.filter);
        const projection = parseProjection(config.projection);
        const sort = parseSort(config.sort);
        const limit = parseInt(config.limit, 10) || 0;

        const { rows, columns } = await mongoService.find(connection, {
            database,
            collection: String(config.collection).trim(),
            filter,
            projection,
            sort,
            limit
        });

        if (context && context.setActivityStats) {
            context.setActivityStats({
                outputRowCount: rows.length,
                columnCount: columns.length,
                connection: config.connection,
                database,
                collection: config.collection
            });
        }

        return new Dataset(rows, columns);
    }
});

// ─── 4. SQL Query (advanced) ─────────────────────────────────────────────────
databaseActivities.push({
    type: 'sqlQuery',
    displayName: '🗄️ SQL Query',
    description: 'Runs an advanced read-only SQL SELECT against a saved connection.',
    category: 'Query',
    configRequirements: [
        {
            name: 'connection',
            label: 'Connection',
            type: 'connection',
            required: true,
            description: 'Saved connection (created in the VizFlow Data Sources panel)'
        },
        {
            name: 'sql',
            label: 'SQL SELECT',
            type: 'text',
            required: true,
            description: 'Read-only SELECT query (single statement)',
            placeholder: 'SELECT * FROM orders WHERE amount > 100 ORDER BY created_at DESC'
        },
        {
            name: 'limit',
            label: 'Limit Rows',
            type: 'number',
            required: false,
            defaultValue: 1000,
            description: 'Maximum rows to return (0 = up to 100,000)'
        }
    ],
    async execute(config, context, _inputDataset) {
        validateConfig(config, ['connection', 'sql'], 'SQL Query');
        const connection = await resolveConnection(config.connection, context);
        const sqlService = require('../../../services/database/sqlService');

        const limit = parseInt(config.limit, 10) || 0;
        const result = await sqlService.runSelect(connection, String(config.sql), [], { limit });

        if (context && context.setActivityStats) {
            context.setActivityStats({
                outputRowCount: result.rowCount,
                columnCount: result.columns.length,
                connection: config.connection
            });
        }

        return new Dataset(result.rows, result.columns);
    }
});

module.exports = databaseActivities;

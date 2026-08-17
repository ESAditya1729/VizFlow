/**
 * services/database/sqlService.js
 *
 * Read-only SQL adapter for MySQL and PostgreSQL used by the Data Sources panel
 * and the workflow activities. All queries run through the driver with bind
 * parameters; `validateSelect` blocks non-SELECT statements and multi-statement
 * input as a first line of defense (a read-only database user is the real one).
 */

'use strict';

const { quoteIdentifier } = require('./sqlQueryBuilder');

const DEFAULT_MYSQL_PORT = 3306;
const DEFAULT_PG_PORT = 5432;
const CONNECT_TIMEOUT_MS = 8000;
const MAX_ROWS = 100000;

// ─── Config helpers ──────────────────────────────────────────────────────────

/**
 * Build driver-specific connection config from a profile.
 * @param {Object} profile
 * @param {string} profile.type - 'mysql' | 'postgresql'
 * @returns {Object}
 */
function buildDriverConfig(profile) {
    const base = {
        host: profile.host || 'localhost',
        port: Number(profile.port) || (profile.type === 'postgresql' ? DEFAULT_PG_PORT : DEFAULT_MYSQL_PORT),
        user: profile.username,
        password: profile.password,
        database: profile.database,
        connectTimeout: CONNECT_TIMEOUT_MS,
        connectionTimeoutMillis: CONNECT_TIMEOUT_MS
    };
    if (profile.ssl) {
        base.ssl = typeof profile.ssl === 'object' ? profile.ssl : { rejectUnauthorized: false };
    }
    if (profile.connectionString && profile.connectionString.trim()) {
        const connectionString = profile.connectionString.trim();
        if (profile.type === 'postgresql') {
            // pg.Client parses `connectionString` directly.
            return { connectionString, ...base };
        }
        // mysql2 has no `connectionString` config key — it accepts a `uri` option
        // (or the URI string itself). Use `uri` so the driver parses it properly.
        return { uri: connectionString, ...base };
    }
    return base;
}

/**
 * Open a single-use connection and close it afterwards.
 * @param {Object} profile
 * @param {Function} fn - Async fn receiving the client/connection
 * @returns {Promise<*>} Return value of fn
 */
async function withConnection(profile, fn) {
    if (profile.type === 'postgresql') {
        const { Client } = require('pg');
        const client = new Client(buildDriverConfig(profile));
        await client.connect();
        try {
            return await fn(client);
        } finally {
            await client.end();
        }
    }
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection(buildDriverConfig(profile));
    try {
        return await fn(conn);
    } finally {
        await conn.end();
    }
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Ensure a SQL string is a single read-only statement.
 * @param {string} sql
 * @returns {string} Trimmed single statement
 * @throws {Error} When the statement is unsafe
 */
function validateSelect(sql) {
    if (!sql || typeof sql !== 'string') {
        throw new Error('SQL query must be a non-empty string');
    }
    const trimmed = sql.trim().replace(/;\s*$/, '');
    if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
        throw new Error('Only SELECT (read-only) queries are allowed');
    }
    if (/[;]/m.test(trimmed)) {
        throw new Error('Multiple SQL statements are not allowed');
    }
    const forbidden = /\b(UPDATE|DELETE|INSERT|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|CALL|EXEC|EXECUTE|REPLACE|MERGE|COPY)\b/i;
    if (forbidden.test(trimmed)) {
        throw new Error('Query contains a non-read-only operation');
    }
    return trimmed;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Test a SQL connection.
 * @param {Object} profile
 * @returns {Promise<{ ok: boolean, message?: string, error?: string }>}
 */
async function testConnection(profile) {
    try {
        await withConnection(profile, async (client) => {
            if (profile.type === 'postgresql') {
                await client.query('SELECT 1');
            } else {
                await client.query('SELECT 1');
            }
        });
        return { ok: true, message: `Connected successfully to ${profile.type === 'postgresql' ? 'PostgreSQL' : 'MySQL'}` };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}

/**
 * List tables in the connection's database.
 * @param {Object} profile
 * @returns {Promise<Array<string>>}
 */
async function listTables(profile) {
    return withConnection(profile, async (client) => {
        if (profile.type === 'postgresql') {
            const res = await client.query(
                `SELECT table_name FROM information_schema.tables
                 WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                 AND table_type = 'BASE TABLE'
                 ORDER BY table_name`
            );
            return res.rows.map((r) => r.table_name);
        }
        const [rows] = await client.query('SHOW TABLES');
        return rows.map((r) => Object.values(r)[0]);
    });
}

/**
 * List column names of a table (plain strings — the Data Sources panel and the
 * Workflow Builder both consume names, never `{name,type}` objects).
 * @param {Object} profile
 * @param {string} table
 * @returns {Promise<Array<string>>}
 */
async function listColumns(profile, table) {
    return withConnection(profile, async (client) => {
        if (profile.type === 'postgresql') {
            const res = await client.query(
                `SELECT column_name FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = $1
                 ORDER BY ordinal_position`,
                [table]
            );
            return res.rows.map((r) => r.column_name);
        }
        const [rows] = await client.query(`SHOW COLUMNS FROM ${quoteIdentifier(table, 'mysql')}`);
        return rows.map((r) => r.Field);
    });
}

/**
 * Run a validated SELECT query.
 * @param {Object} profile
 * @param {string} sql
 * @param {Array} [params] - Bind parameters (optional)
 * @param {Object} [opts]
 * @param {number} [opts.limit]
 * @returns {Promise<{ rows: Array<Object>, columns: Array<string>, rowCount: number }>}
 */
async function runSelect(profile, sql, params = [], opts = {}) {
    const { limit = 0 } = opts;
    let statement = validateSelect(sql);

    if (limit > 0 && !/LIMIT\s+\d+/i.test(statement)) {
        statement += ` LIMIT ${Math.min(Math.floor(limit), MAX_ROWS)}`;
    }

    return withConnection(profile, async (client) => {
        const res = await client.query(statement, params);
        const rows = Array.isArray(res.rows) ? res.rows : res[0];
        const fields = Array.isArray(res.fields)
            ? res.fields
            : (res && res.meta ? res.meta : null);
        let columns = [];
        if (fields && fields.length > 0) {
            columns = fields.map((f) => (typeof f === 'string' ? f : f.name));
        } else if (Array.isArray(rows) && rows.length > 0) {
            columns = Object.keys(rows[0]);
        }
        return { rows, columns, rowCount: Array.isArray(rows) ? rows.length : 0 };
    });
}

/**
 * Preview a table: first N rows.
 * @param {Object} profile
 * @param {string} table
 * @param {Object} [opts]
 * @param {number} [opts.limit]
 * @returns {Promise<{ rows: Array<Object>, columns: Array<string> }>}
 */
async function preview(profile, table, opts = {}) {
    const { limit = 50 } = opts;
    const dialect = profile.type === 'postgresql' ? 'postgresql' : 'mysql';
    const sql = `SELECT * FROM ${quoteIdentifier(table, dialect)}`;
    const result = await runSelect(profile, sql, [], { limit });
    return { rows: result.rows, columns: result.columns };
}

/**
 * Count rows in a table.
 * @param {Object} profile
 * @param {string} table
 * @returns {Promise<number>}
 */
async function getCount(profile, table) {
    const dialect = profile.type === 'postgresql' ? 'postgresql' : 'mysql';
    const sql = `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table, dialect)}`;
    const result = await runSelect(profile, sql);
    const first = result.rows[0];
    return first ? Number(first.count) : 0;
}

module.exports = {
    buildDriverConfig,
    validateSelect,
    testConnection,
    listTables,
    listColumns,
    runSelect,
    preview,
    getCount
};

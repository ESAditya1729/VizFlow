/**
 * services/database/sqlQueryBuilder.js
 *
 * Translates the shared visual filter model into a parameterized SQL WHERE
 * clause for MySQL or PostgreSQL. All user-supplied values are passed as
 * bind parameters so the generated SQL is injection-safe; only column names
 * (which come from the database schema, never free-form user input) are
 * quoted as identifiers.
 */

'use strict';

const { normalizeCondition, validateFilterModel } = require('./queryBuilderCommon');

const PLACEHOLDER_STYLES = {
    mysql: () => '?',
    postgresql: () => {
        // Postgres uses $1, $2, ... — the counter is supplied per build.
        return null;
    }
};

/**
 * Quote an identifier for the given dialect.
 * @param {string} name
 * @param {string} dialect - 'mysql' | 'postgresql'
 * @returns {string}
 */
function quoteIdentifier(name, dialect) {
    const trimmed = String(name || '').trim();
    if (dialect === 'mysql') {
        return '`' + trimmed.replace(/`/g, '``') + '`';
    }
    return '"' + trimmed.replace(/"/g, '""') + '"';
}

/**
 * Build a single SQL condition fragment.
 * @param {Object} condition - Normalized condition
 * @param {string} dialect
 * @param {Array} params - Output bind-parameter array
 * @returns {string} SQL fragment (may be empty when incomplete)
 */
function buildCondition(condition, dialect, params) {
    const col = quoteIdentifier(condition.column, dialect);
    const values = condition.values || [];

    switch (condition.operator) {
        case 'equals':
            params.push(condition.value);
            return `${col} = ?`;
        case 'notEquals':
            params.push(condition.value);
            return `${col} <> ?`;
        case 'contains': {
            const like = dialect === 'postgresql' ? 'ILIKE' : 'LIKE';
            params.push(`%${condition.value}%`);
            return `${col} ${like} ?`;
        }
        case 'notContains': {
            const like = dialect === 'postgresql' ? 'NOT ILIKE' : 'NOT LIKE';
            params.push(`%${condition.value}%`);
            return `${col} ${like} ?`;
        }
        case 'startsWith': {
            const like = dialect === 'postgresql' ? 'ILIKE' : 'LIKE';
            params.push(`${condition.value}%`);
            return `${col} ${like} ?`;
        }
        case 'endsWith': {
            const like = dialect === 'postgresql' ? 'ILIKE' : 'LIKE';
            params.push(`%${condition.value}`);
            return `${col} ${like} ?`;
        }
        case 'greaterThan':
            params.push(condition.value);
            return `${col} > ?`;
        case 'lessThan':
            params.push(condition.value);
            return `${col} < ?`;
        case 'greaterThanOrEqual':
            params.push(condition.value);
            return `${col} >= ?`;
        case 'lessThanOrEqual':
            params.push(condition.value);
            return `${col} <= ?`;
        case 'in': {
            params.push(...values);
            return `${col} IN (${values.map(() => '?').join(', ')})`;
        }
        case 'notIn': {
            params.push(...values);
            return `${col} NOT IN (${values.map(() => '?').join(', ')})`;
        }
        case 'between': {
            params.push(values[0], values[1]);
            return `${col} BETWEEN ? AND ?`;
        }
        case 'isNull':
            return `${col} IS NULL`;
        case 'isNotNull':
            return `${col} IS NOT NULL`;
        case 'isEmpty':
            return `(${col} IS NULL OR ${col} = '')`;
        case 'isNotEmpty':
            return `(${col} IS NOT NULL AND ${col} <> '')`;
        default:
            return '';
    }
}

/**
 * Build a parameterized WHERE clause from the visual filter model.
 *
 * For PostgreSQL the returned fragment uses `$1, $2, ...` placeholders; for
 * MySQL it uses `?`. The matching `params` array is returned alongside.
 *
 * @param {Object} filterModel - { conditions: [...] }
 * @param {string} dialect - 'mysql' | 'postgresql'
 * @returns {{ where: string, params: Array, errors: Array<string> }}
 */
function buildSqlWhere(filterModel, dialect) {
    const errors = validateFilterModel(filterModel);
    if (errors.length > 0) {
        return { where: '', params: [], errors };
    }

    const conditions = (filterModel.conditions || [])
        .map(normalizeCondition)
        .filter((c) => c.column);

    if (conditions.length === 0) {
        return { where: '', params: [], errors: [] };
    }

    const isPg = dialect === 'postgresql';
    const params = [];
    let counter = 0;

    const render = (condition) => {
        // Collect a temporary fragment using '?' then rewrite placeholders for
        // Postgres, keeping a running counter.
        const before = params.length;
        const fragment = buildCondition(condition, dialect, params);
        if (isPg) {
            const newParams = params.slice(before);
            let pg = fragment;
            for (let i = 0; i < newParams.length; i++) {
                pg = pg.replace('?', `$${before + i + 1}`);
            }
            return pg;
        }
        return fragment;
    };

    let sql = render(conditions[0]);
    for (let i = 1; i < conditions.length; i++) {
        const cond = conditions[i];
        const rendered = render(cond);
        sql = cond.conjunction === 'OR' ? `${sql} OR ${rendered}` : `${sql} AND ${rendered}`;
    }

    return { where: sql, params, errors: [] };
}

/**
 * Parse a user-facing ORDER BY string into a SQL fragment (without the
 * ORDER BY keyword).
 *
 * Accepts the Data Sources UI syntax (`name:desc`) as well as raw SQL ORDER BY
 * expressions (`created_at DESC`). Simple `field` / `field:asc|desc` parts are
 * re-quoted as identifiers; anything more complex is passed through verbatim so
 * advanced users keep full control (e.g. `foo.bar`, `LOWER(name)`).
 * @param {string} orderBy
 * @param {string} dialect - 'mysql' | 'postgresql'
 * @returns {string}
 */
function parseOrderBy(orderBy, dialect) {
    const parts = String(orderBy || '').split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    const rendered = [];
    for (const part of parts) {
        const m = part.match(/^([^:\s]+)\s*:\s*(asc|desc)$/i);
        if (m) {
            rendered.push(`${quoteIdentifier(m[1], dialect)} ${m[2].toUpperCase()}`);
        } else {
            rendered.push(part);
        }
    }
    return rendered.join(', ');
}

/**
 * Build a full SELECT statement from the visual filter model.
 * @param {Object} options
 * @param {string} options.table
 * @param {string} options.dialect
 * @param {Array<string>} [options.columns]
 * @param {Object} [options.filterModel]
 * @param {string} [options.orderBy]
 * @param {number} [options.limit]
 * @returns {{ sql: string, params: Array, errors: Array<string> }}
 */
function buildSelect({ table, dialect, columns = null, filterModel = null, orderBy = '', limit = 0 }) {
    const colList = Array.isArray(columns) && columns.length > 0
        ? columns.map((c) => quoteIdentifier(c, dialect)).join(', ')
        : '*';

    let sql = `SELECT ${colList} FROM ${quoteIdentifier(table, dialect)}`;
    const params = [];

    if (filterModel && Array.isArray(filterModel.conditions) && filterModel.conditions.length > 0) {
        const built = buildSqlWhere(filterModel, dialect);
        if (built.errors.length > 0) {
            return { sql: '', params: [], errors: built.errors };
        }
        if (built.where) {
            sql += ` WHERE ${built.where}`;
            params.push(...built.params);
        }
    }

    if (orderBy && typeof orderBy === 'string' && orderBy.trim()) {
        const parsed = parseOrderBy(orderBy, dialect);
        if (parsed) {
            sql += ` ORDER BY ${parsed}`;
        }
    }

    if (limit && limit > 0) {
        sql += ` LIMIT ${Math.floor(limit)}`;
    }

    return { sql, params, errors: [] };
}

module.exports = {
    buildSqlWhere,
    buildSelect,
    parseOrderBy,
    quoteIdentifier,
    PLACEHOLDER_STYLES
};

/**
 * services/rbqlExport.js
 *
 * Pure serializers for RBQL result sets. Kept separate from the command so
 * quoting/escaping behaviour can be unit-tested without a VS Code host.
 */

const Papa = require('papaparse');

/**
 * @param {{ columns?: string[], rows?: any[][] }} data
 * @returns {{ columns: string[], rows: any[][] }}
 */
function normalizeData(data) {
    const columns = data && Array.isArray(data.columns) ? data.columns : [];
    const rows = data && Array.isArray(data.rows) ? data.rows : [];
    return { columns, rows };
}

/**
 * Serialize results as RFC 4180-style CSV.
 *
 * @param {{ columns?: string[], rows?: any[][] }} data
 * @returns {string}
 */
function toCsv(data) {
    const { columns, rows } = normalizeData(data);
    return Papa.unparse({ fields: columns, data: rows });
}

/**
 * Serialize results as an array of objects.
 *
 * @param {{ columns?: string[], rows?: any[][] }} data
 * @returns {string}
 */
function toJson(data) {
    const { columns, rows } = normalizeData(data);
    const objects = rows.map(row => {
        const obj = {};
        columns.forEach((column, index) => { obj[column] = row[index]; });
        return obj;
    });
    return JSON.stringify(objects, null, 2);
}

/**
 * Serialize results as a GitHub-flavoured Markdown table.
 *
 * @param {{ columns?: string[], rows?: any[][] }} data
 * @returns {string}
 */
function toMarkdown(data) {
    const { columns, rows } = normalizeData(data);
    const escapeCell = value => String(value === null || value === undefined ? '' : value)
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, '<br>');

    const header = `| ${columns.map(escapeCell).join(' | ')} |`;
    const divider = `| ${columns.map(() => '---').join(' | ')} |`;
    const body = rows.map(row =>
        `| ${columns.map((_, index) => escapeCell(row[index])).join(' | ')} |`
    );

    return [header, divider, ...body].join('\n');
}

module.exports = {
    toCsv,
    toJson,
    toMarkdown,
};

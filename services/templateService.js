/**
 * services/templateService.js
 *
 * Single, consistent implementation of {{placeholder}} interpolation.
 * Used by the workflow engine, output/control activities, and the scheduler so
 * variable substitution behaves identically everywhere.
 *
 * Supports:
 *   {{name}}            top-level variable
 *   {{user.name.first}} dotted paths into objects
 *   {{row.column}}      current row (when options.row is provided)
 */

'use strict';

/**
 * Resolve a dotted path inside an object, e.g. getPath({a:{b:1}}, 'a.b') → 1.
 * @param {Object} obj - Source object
 * @param {string} pathStr - Dotted path (e.g. "a.b.c")
 * @returns {*} Resolved value or undefined
 */
function getPath(obj, pathStr) {
    if (obj === null || obj === undefined) return undefined;
    if (typeof pathStr !== 'string') return undefined;
    const parts = pathStr.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }
    return current;
}

/**
 * Convert a value to a display string.
 * Objects are pretty-printed as JSON; null/undefined become ''.
 * @param {*} value
 * @returns {string}
 */
function stringifyValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
}

/**
 * Interpolate {{...}} placeholders in a template string.
 *
 * @param {string} template - Text containing {{...}} placeholders
 * @param {Object} [variables] - Variable bag (plain object) to resolve names against
 * @param {Object} [options]
 * @param {Object|null} [options.row] - Current row; enables {{row.col}} references
 * @param {string} [options.replaceMissingWith] - When set, unresolvable placeholders are
 *        replaced with this value instead of being left as-is
 * @returns {string}
 */
function interpolate(template, variables = {}, options = {}) {
    if (typeof template !== 'string') return template;
    const { row = null, replaceMissingWith } = options;

    return template.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
        const trimmed = expr.trim();
        if (!trimmed) return match;

        if (row && trimmed.startsWith('row.')) {
            const value = getPath(row, trimmed.slice(4));
            if (value !== undefined && value !== null) return stringifyValue(value);
            return replaceMissingWith !== undefined ? replaceMissingWith : match;
        }

        const value = getPath(variables, trimmed);
        if (value !== undefined && value !== null) return stringifyValue(value);
        return replaceMissingWith !== undefined ? replaceMissingWith : match;
    });
}

module.exports = {
    getPath,
    stringifyValue,
    interpolate
};

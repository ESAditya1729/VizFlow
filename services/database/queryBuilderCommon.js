/**
 * services/database/queryBuilderCommon.js
 *
 * Shared vocabulary for the visual query/filter builders used by the
 * Data Sources panel and the database workflow activities. Both the SQL and
 * Mongo builders translate the same in-memory filter model so behavior stays
 * identical everywhere.
 *
 * Filter model (also used by the Workflow Builder UI):
 *   { conditions: [
 *       { column, operator, value, conjunction: 'AND' | 'OR' }
 *   ] }
 *
 * `conjunction` connects a condition to the previous one; the first condition
 * ignores it. `value` is a string for scalar operators and a comma-separated
 * string for `in` / `notIn` / `between`.
 */

'use strict';

const FILTER_OPERATORS = [
    { value: 'equals', label: 'equals' },
    { value: 'notEquals', label: 'does not equal' },
    { value: 'contains', label: 'contains' },
    { value: 'notContains', label: 'does not contain' },
    { value: 'startsWith', label: 'starts with' },
    { value: 'endsWith', label: 'ends with' },
    { value: 'greaterThan', label: 'is greater than' },
    { value: 'lessThan', label: 'is less than' },
    { value: 'greaterThanOrEqual', label: 'is at least' },
    { value: 'lessThanOrEqual', label: 'is at most' },
    { value: 'in', label: 'is one of' },
    { value: 'notIn', label: 'is not one of' },
    { value: 'between', label: 'is between' },
    { value: 'isNull', label: 'is null / missing' },
    { value: 'isNotNull', label: 'is not null' },
    { value: 'isEmpty', label: 'is empty string' },
    { value: 'isNotEmpty', label: 'is not empty' }
];

/**
 * Does this operator require a value input?
 * @param {string} operator
 * @returns {boolean}
 */
function operatorNeedsValue(operator) {
    return !['isNull', 'isNotNull', 'isEmpty', 'isNotEmpty'].includes(operator);
}

/**
 * Normalize a condition: ensure conjunction default and split multi-values.
 * A bare "null" value (or the literal string `null`) used with `equals` /
 * `notEquals` is treated as SQL NULL / Mongo null — matching the semantics
 * users expect from "= null" / "≠ null". Quote the value (`'null'`) to match
 * the literal string "null" instead.
 * @param {Object} condition
 * @returns {Object} Normalized condition
 */
function normalizeCondition(condition) {
    let operator = condition.operator || 'equals';
    let value = condition.value;
    const conjunction = condition.conjunction === 'OR' ? 'OR' : 'AND';

    if ((operator === 'equals' || operator === 'notEquals') && typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.toLowerCase() === 'null') {
            operator = operator === 'equals' ? 'isNull' : 'isNotNull';
            value = null;
        } else if (trimmed === "'null'" || trimmed === '"null"') {
            value = 'null';
        }
    } else if ((operator === 'equals' || operator === 'notEquals') && (value === null || value === undefined)) {
        operator = operator === 'equals' ? 'isNull' : 'isNotNull';
        value = null;
    }

    const normalized = {
        column: condition.column || '',
        operator,
        value,
        conjunction
    };
    if (['in', 'notIn', 'between'].includes(operator)) {
        normalized.values = String(value || '')
            .split(',')
            .map((v) => v.trim())
            .filter((v) => v !== '');
    }
    return normalized;
}

/**
 * Validate a filter model. Returns a list of human-readable errors.
 * @param {Object} filterModel - { conditions: [...] }
 * @returns {Array<string>}
 */
function validateFilterModel(filterModel) {
    const errors = [];
    if (!filterModel || !Array.isArray(filterModel.conditions)) {
        errors.push('Filter model must contain a "conditions" array');
        return errors;
    }
    const validOps = new Set(FILTER_OPERATORS.map((o) => o.value));
    filterModel.conditions.forEach((c, i) => {
        if (!c || !c.column) {
            errors.push(`Filter #${i + 1}: column is required`);
        }
        if (!c.operator || !validOps.has(c.operator)) {
            errors.push(`Filter #${i + 1}: unknown operator "${c.operator}"`);
        }
        if (operatorNeedsValue(c.operator)) {
            const isNullLiteral = c.value === null || (typeof c.value === 'string' && c.value.trim().toLowerCase() === 'null');
            const hasValue = c.value !== undefined && c.value !== '' && c.value !== null;
            if (!hasValue && !(isNullLiteral && (c.operator === 'equals' || c.operator === 'notEquals'))) {
                errors.push(`Filter #${i + 1}: a value is required for "${c.operator}"`);
            }
        }
    });
    return errors;
}

module.exports = {
    FILTER_OPERATORS,
    operatorNeedsValue,
    normalizeCondition,
    validateFilterModel
};

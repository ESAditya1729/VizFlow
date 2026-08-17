/**
 * services/database/mongoFilterBuilder.js
 *
 * Translates the shared visual filter model into a MongoDB filter document for
 * use with `find()`. Mirrors `sqlQueryBuilder.js` so the same user-built
 * filters produce equivalent results on SQL and Mongo sources.
 */

'use strict';

const { normalizeCondition, validateFilterModel } = require('./queryBuilderCommon');

/**
 * Coerce a string value into a JS value for Mongo comparisons.
 * Numbers stay numbers, booleans stay booleans, everything else stays a string.
 * @param {string} value
 * @returns {*}
 */
function coerceValue(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    const num = Number(value);
    if (value.trim() !== '' && !Number.isNaN(num)) return num;
    return value;
}

/**
 * Build a single Mongo condition.
 * @param {Object} condition - Normalized condition
 * @returns {Object} Mongo filter fragment
 */
function buildCondition(condition) {
    const { column, operator } = condition;
    const values = condition.values || [];

    switch (operator) {
        case 'equals':
            return { [column]: coerceValue(condition.value) };
        case 'notEquals':
            return { [column]: { $ne: coerceValue(condition.value) } };
        case 'contains':
            return { [column]: { $regex: escapeRegExp(condition.value), $options: 'i' } };
        case 'notContains':
            return { [column]: { $not: { $regex: escapeRegExp(condition.value), $options: 'i' } } };
        case 'startsWith':
            return { [column]: { $regex: '^' + escapeRegExp(condition.value), $options: 'i' } };
        case 'endsWith':
            return { [column]: { $regex: escapeRegExp(condition.value) + '$', $options: 'i' } };
        case 'greaterThan':
            return { [column]: { $gt: coerceValue(condition.value) } };
        case 'lessThan':
            return { [column]: { $lt: coerceValue(condition.value) } };
        case 'greaterThanOrEqual':
            return { [column]: { $gte: coerceValue(condition.value) } };
        case 'lessThanOrEqual':
            return { [column]: { $lte: coerceValue(condition.value) } };
        case 'in':
            return { [column]: { $in: values.map(coerceValue) } };
        case 'notIn':
            return { [column]: { $nin: values.map(coerceValue) } };
        case 'between':
            return values.length >= 2
                ? { [column]: { $gte: coerceValue(values[0]), $lte: coerceValue(values[1]) } }
                : {};
        case 'isNull':
            // `{ field: null }` matches documents where the field is null OR missing.
            return { [column]: null };
        case 'isNotNull':
            // `{ $ne: null }` matches documents where the field exists and is not null.
            return { [column]: { $ne: null } };
        case 'isEmpty':
            return { $or: [{ [column]: '' }, { [column]: { $exists: false } }] };
        case 'isNotEmpty':
            return { [column]: { $ne: '' } };
        default:
            return {};
    }
}

/**
 * Escape a literal string for use inside a regex.
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a Mongo filter document from the visual filter model.
 * @param {Object} filterModel - { conditions: [...] }
 * @returns {{ filter: Object, errors: Array<string> }}
 */
function buildMongoFilter(filterModel) {
    const errors = validateFilterModel(filterModel);
    if (errors.length > 0) {
        return { filter: {}, errors };
    }

    const conditions = (filterModel.conditions || [])
        .map(normalizeCondition)
        .filter((c) => c.column);

    if (conditions.length === 0) {
        return { filter: {}, errors: [] };
    }

    let filter = buildCondition(conditions[0]);
    for (let i = 1; i < conditions.length; i++) {
        const cond = buildCondition(conditions[i]);
        if (conditions[i].conjunction === 'OR') {
            filter = { $or: [filter, cond] };
        } else {
            filter = { $and: [filter, cond] };
        }
    }

    return { filter, errors: [] };
}

module.exports = {
    buildMongoFilter,
    buildCondition,
    coerceValue
};

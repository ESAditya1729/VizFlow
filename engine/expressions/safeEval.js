/**
 * engine/expressions/safeEval.js
 *
 * Narrow, restricted expression evaluator for the XML Visual Mapper's
 * formula bar. This is a new, independent file — it does not modify or
 * import from controlActivities.js's `evaluateExpression`, so setVariable's
 * existing inline-expression path is left completely untouched.
 *
 * It mirrors that function's already-accepted safety pattern instead:
 * interpolate {{placeholder}} values via the shared templateService, then
 * only ever hand the result to `Function()` when it is provably restricted
 * to arithmetic characters — anything else (e.g. "ORD1-ok") is returned as
 * the plain interpolated string rather than evaluated.
 */

'use strict';

const templateService = require('../../services/templateService');

const SAFE_CHARS_RE = /^[\d\s+\-*/%().]+$/;
const HAS_OPERATOR_RE = /[+\-*/%(){}[\]"']/;
const LOOKS_NUMERIC_RE = /^\s*\d/;

/**
 * Interpolate {{token}} placeholders in `expr` against `variables`, then
 * evaluate the result as a restricted arithmetic expression when it is safe
 * to do so. Falls back to the plain interpolated string otherwise — this is
 * what lets a formula like "{{firstName}} {{lastName}}" just concatenate
 * text, while "{{price}} * {{qty}}" actually computes.
 *
 * @param {string} expr - Template/formula string, e.g. "{{price}} * {{qty}}"
 * @param {Object} variables - Flat name → value bag for {{token}} lookup
 * @returns {*} Evaluated number, or the interpolated string
 */
function evaluateTemplate(expr, variables = {}) {
    if (expr === undefined || expr === null || typeof expr !== 'string') return expr;

    const interpolated = templateService.interpolate(expr, variables, { replaceMissingWith: '' });

    if (HAS_OPERATOR_RE.test(interpolated) || LOOKS_NUMERIC_RE.test(interpolated)) {
        if (SAFE_CHARS_RE.test(interpolated)) {
            try {
                const fn = new Function(`return (${interpolated})`);
                const result = fn();
                if (result !== undefined) return result;
            } catch {
                // Not valid arithmetic after all — fall through to the literal string.
            }
        }
    }

    return interpolated;
}

module.exports = { evaluateTemplate };

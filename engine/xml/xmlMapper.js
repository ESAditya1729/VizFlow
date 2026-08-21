/**
 * engine/xml/xmlMapper.js
 *
 * Evaluates the mapping JSON that both the Visual Mapper UI and the runtime
 * activities (readXml/writeXml/xmlTransform) share — one schema, one
 * evaluator, used by the editor's live preview and by the actual workflow
 * run alike.
 *
 * Mapping node shape (see AI_CONTEXT.md for the full reference):
 *   {
 *     kind: 'element' | 'attribute' | 'text',   // default 'element'
 *     name: 'OrderId',                          // omitted for kind:'text'
 *     loop: { path: 'Orders/Order', as: 'order' },       // optional, repeats
 *     binding: { path: 'order/@id', op: 'upper', opParams: [] }, // optional
 *     expression: '{{id}} - {{status}}',        // optional formula bar
 *     static: 'N/A',                            // optional literal fallback
 *     condition: { path: 'Status', operator: '!=', value: 'cancelled' },
 *     children: [ /* same shape, nested *\/ ]
 *   }
 *
 * `binding.op`/`opParams` reuse engine/expressions/operations.js's OPERATIONS
 * catalog as-is (read-only import — that file is not modified). `expression`
 * runs through engine/expressions/safeEval.js. `condition.operator` reuses
 * the same operator vocabulary as the ifElse control activity (own copy —
 * controlActivities.js is not imported from, so it is never at risk here).
 *
 * The mapping tree itself is small and user-authored (built by clicking in
 * the Visual Mapper), so — unlike xmlParser's scan over untrusted file
 * bytes — walking it recursively here is safe and keeps this code readable.
 */

'use strict';

const { resolveAll, resolveOne, getText } = require('./xmlPath');
const { OPERATIONS } = require('../expressions/operations');
const { evaluateTemplate } = require('../expressions/safeEval');

const CONDITION_OPERATORS = ['==', '!=', '>', '>=', '<', '<=', 'contains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty', 'regex'];

function stringifyValue(value) {
    if (value === undefined || value === null) return '';
    return String(value);
}

/**
 * Standalone condition matcher for mapping `condition` blocks. Deliberately
 * a fresh implementation (not imported from controlActivities.js) so this
 * module has zero coupling to — and zero risk of destabilizing — the
 * existing ifElse activity; only the operator vocabulary is shared, for a
 * consistent picker in the UI.
 *
 * @param {*} rawVal
 * @param {string} operator
 * @param {*} value
 * @param {boolean} [caseSensitive]
 * @returns {boolean}
 */
function matchesXmlCondition(rawVal, operator, value, caseSensitive = true) {
    if (!CONDITION_OPERATORS.includes(operator)) {
        throw new Error(`xmlMapper: unsupported condition operator "${operator}"`);
    }
    if (operator === 'isEmpty') {
        return rawVal === null || rawVal === undefined || String(rawVal).trim() === '';
    }
    if (operator === 'isNotEmpty') {
        return rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '';
    }

    const compStr = value !== undefined && value !== null ? String(value) : '';
    const numA = Number(rawVal);
    const numB = Number(value);
    const isNumericCompare = rawVal !== undefined && rawVal !== null && rawVal !== ''
        && value !== undefined && value !== null && value !== ''
        && !isNaN(numA) && !isNaN(numB);

    let a;
    let b;
    if (isNumericCompare) {
        a = numA;
        b = numB;
    } else {
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
            return caseSensitive
                ? String(rawVal ?? '').includes(compStr)
                : String(rawVal ?? '').toLowerCase().includes(compStr.toLowerCase());
        case 'startsWith':
            return caseSensitive
                ? String(rawVal ?? '').startsWith(compStr)
                : String(rawVal ?? '').toLowerCase().startsWith(compStr.toLowerCase());
        case 'endsWith':
            return caseSensitive
                ? String(rawVal ?? '').endsWith(compStr)
                : String(rawVal ?? '').toLowerCase().endsWith(compStr.toLowerCase());
        case 'regex':
            try {
                return new RegExp(value, caseSensitive ? '' : 'i').test(String(rawVal ?? ''));
            } catch {
                return false;
            }
        default:
            return false;
    }
}

/**
 * Evaluate a mapping node's `condition` block against a context element.
 * An absent condition always passes.
 *
 * @param {object} contextEl
 * @param {{path?: string, operator: string, value?: *, caseSensitive?: boolean}} [condition]
 * @returns {boolean}
 */
function evaluateCondition(contextEl, condition) {
    if (!condition) return true;
    const { path, operator, value, caseSensitive = true } = condition;
    let rawVal;
    if (path === undefined || path === '') {
        rawVal = getText(contextEl);
    } else {
        const resolved = resolveOne(contextEl, path);
        rawVal = resolved === undefined ? undefined : getText(resolved);
    }
    return matchesXmlCondition(rawVal, operator, value, caseSensitive);
}

/**
 * Resolve a field's scalar value from its `expression` / `binding` /
 * `static`, in that priority order.
 *
 * @param {object} spec - mapping node (or field spec) carrying binding/expression/static
 * @param {object} contextEl - the element this field is evaluated relative to
 * @param {Object<string,*>} aliasVars - flat alias→text map from active `loop.as` bindings
 * @param {Object<string,*>} siblingVars - already-computed sibling field values (name→value)
 * @returns {*}
 */
function resolveFieldValue(spec, contextEl, aliasVars, siblingVars) {
    if (spec.expression) {
        const vars = { ...aliasVars, ...siblingVars };
        return evaluateTemplate(spec.expression, vars);
    }

    if (spec.binding && spec.binding.path !== undefined) {
        const resolved = resolveOne(contextEl, spec.binding.path);
        if (resolved === undefined) {
            return spec.static !== undefined ? spec.static : '';
        }
        let value = getText(resolved);
        if (spec.binding.op) {
            const op = OPERATIONS[spec.binding.op];
            if (!op) {
                throw new Error(`xmlMapper: unknown operation "${spec.binding.op}"`);
            }
            try {
                value = op.fn(value, ...(spec.binding.opParams || []));
            } catch (err) {
                const label = spec.name ? `field "${spec.name}"` : 'field';
                throw new Error(`xmlMapper: ${label} — operation "${spec.binding.op}" failed: ${err.message}`);
            }
        }
        return value;
    }

    if (spec.static !== undefined) return spec.static;
    return '';
}

// ─── Row-shape evaluation (readXml visual mode) ───────────────────────────

/**
 * Flatten XML into {rows, columns} using a mapping whose top level defines
 * the record loop and whose `children` are the output columns.
 *
 * @param {object} root - parsed XML root element (from xmlParser)
 * @param {{loop?: {path: string, as?: string}, children: object[]}} mapping
 * @returns {{rows: Object[], columns: string[]}}
 */
function mapToRows(root, mapping) {
    if (!mapping) return { rows: [], columns: [] };

    const fields = mapping.children || [];
    const columns = fields.map(f => f.name);
    const records = mapping.loop && mapping.loop.path ? resolveAll(root, mapping.loop.path) : [root];

    const rows = [];
    for (const record of records) {
        if (!record || record.type !== 'element') continue;

        const aliasVars = mapping.loop && mapping.loop.as ? { [mapping.loop.as]: getText(record) } : {};
        if (!evaluateCondition(record, mapping.condition)) continue;

        const row = {};
        const siblingVars = {};
        for (const field of fields) {
            let value;
            if (!evaluateCondition(record, field.condition)) {
                value = field.static !== undefined ? field.static : '';
            } else {
                value = resolveFieldValue(field, record, aliasVars, siblingVars);
            }
            row[field.name] = value;
            siblingVars[field.name] = value;
        }
        rows.push(row);
    }

    return { rows, columns };
}

/**
 * Derive a simple default mapping for readXml's "auto" mode: every direct
 * child element and attribute of the first record becomes a flat column.
 * Shares mapToRows with visual mode, so auto-mode is just "the mapping the
 * UI would have produced if you'd mapped every field 1:1".
 *
 * @param {object} root
 * @param {string} recordPath
 * @returns {{loop: {path: string, as: string}, children: object[]}}
 */
function autoMapping(root, recordPath) {
    const records = resolveAll(root, recordPath);
    const sample = records[0];
    const children = [];

    if (sample && sample.type === 'element') {
        for (const attrName of Object.keys(sample.attributes || {})) {
            children.push({ kind: 'attribute', name: `@${attrName}`, binding: { path: `@${attrName}` } });
        }
        for (const child of sample.children || []) {
            if (child.type === 'element' && !children.some(c => c.name === child.name)) {
                children.push({ name: child.name, binding: { path: child.name } });
            }
        }
    }

    return { loop: { path: recordPath, as: 'record' }, children };
}

// ─── Tree-shape evaluation (writeXml / xmlTransform) ──────────────────────

/**
 * Build every node instance a mapping node produces at `contextEl` — more
 * than one when `loop` matches multiple nodes, zero when `condition` fails
 * for all (or every) match.
 *
 * @param {object} mappingNode
 * @param {object} contextEl
 * @param {Object<string,*>} aliasVars
 * @returns {object[]} built xmlParser-shaped nodes (element/text)
 */
function buildNodes(mappingNode, contextEl, aliasVars) {
    if (!mappingNode) return [];

    const iterations = [];
    if (mappingNode.loop && mappingNode.loop.path) {
        for (const match of resolveAll(contextEl, mappingNode.loop.path)) {
            const nextAliasVars = mappingNode.loop.as
                ? { ...aliasVars, [mappingNode.loop.as]: getText(match) }
                : aliasVars;
            iterations.push({ ctx: match, aliasVars: nextAliasVars });
        }
    } else {
        iterations.push({ ctx: contextEl, aliasVars });
    }

    const results = [];
    for (const { ctx, aliasVars: iterVars } of iterations) {
        if (!evaluateCondition(ctx, mappingNode.condition)) continue;
        results.push(buildSingleNode(mappingNode, ctx, iterVars));
    }
    return results;
}

/**
 * Build exactly one node instance (already past loop expansion / condition
 * check) for `mappingNode` at `ctx`.
 *
 * @param {object} mappingNode
 * @param {object} ctx
 * @param {Object<string,*>} aliasVars
 * @returns {object}
 */
function buildSingleNode(mappingNode, ctx, aliasVars) {
    const kind = mappingNode.kind || 'element';

    if (kind === 'text') {
        return { type: 'text', value: stringifyValue(resolveFieldValue(mappingNode, ctx, aliasVars, {})) };
    }
    if (kind === 'attribute') {
        throw new Error('xmlMapper: "attribute" kind is only valid as a direct child of an element mapping node');
    }
    if (kind !== 'element') {
        throw new Error(`xmlMapper: unknown mapping kind "${kind}"`);
    }
    if (!mappingNode.name) {
        throw new Error('xmlMapper: element mapping node requires a "name"');
    }

    const element = { type: 'element', name: mappingNode.name, attributes: {}, children: [] };
    const siblingVars = {};

    for (const child of (mappingNode.children || [])) {
        const childKind = child.kind || 'element';

        if (childKind === 'attribute') {
            if (!child.name) {
                throw new Error('xmlMapper: attribute mapping node requires a "name"');
            }
            if (!evaluateCondition(ctx, child.condition)) continue;
            const value = resolveFieldValue(child, ctx, aliasVars, siblingVars);
            element.attributes[child.name] = stringifyValue(value);
            siblingVars[child.name] = value;
            continue;
        }

        const builtChildren = buildNodes(child, ctx, aliasVars);
        element.children.push(...builtChildren);
        if (child.name) {
            siblingVars[child.name] = builtChildren.length > 0 ? getText(builtChildren[0]) : '';
        }
    }

    if (element.children.length === 0
        && (mappingNode.binding || mappingNode.expression || mappingNode.static !== undefined)) {
        const value = resolveFieldValue(mappingNode, ctx, aliasVars, siblingVars);
        if (value !== undefined && value !== null && value !== '') {
            element.children.push({ type: 'text', value: stringifyValue(value) });
        }
    }

    return element;
}

/**
 * Build a full target XML tree from `mapping`, rooted at a single element.
 *
 * @param {object} root - source XML root element (from xmlParser)
 * @param {object} mapping - top-level mapping node describing the target root
 * @returns {object} target root element node (serializable via xmlSerializer)
 */
function mapToTree(root, mapping) {
    if (!mapping) {
        throw new Error('xmlMapper.mapToTree: mapping is required');
    }

    const built = buildNodes(mapping, root, {});
    if (built.length === 0) {
        throw new Error('xmlMapper.mapToTree: mapping produced no root element — check the top-level loop/condition');
    }
    if (built.length > 1 || built[0].type !== 'element') {
        throw new Error('xmlMapper.mapToTree: mapping must produce exactly one root element');
    }
    return built[0];
}

module.exports = {
    mapToRows,
    mapToTree,
    autoMapping,
    matchesXmlCondition,
    CONDITION_OPERATORS,
};

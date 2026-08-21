/**
 * engine/xml/xmlPath.js
 *
 * A tiny "path-lite" resolver over the tree produced by xmlParser.js. This
 * is deliberately NOT real XPath — no library needed, and one small syntax
 * is shared by the Visual Mapper UI, readXml's record/column paths, and
 * xmlMapper's bindings, so there's exactly one mental model across the
 * feature.
 *
 * Grammar (each `/`-separated segment is one of):
 *   Name        - child element(s) named Name
 *   Name[n]     - the n-th (1-based) matching child named Name
 *   @attr       - an attribute of the current element (only valid as the
 *                 last segment)
 *   .           - the current node itself (no-op segment, useful for
 *                 top-level bindings like ".")
 *
 * Namespaces are treated as a literal part of the tag/attribute name (e.g.
 * "ns:Order") — there is no prefix-aware resolution in v1.
 */

'use strict';

/**
 * Split a path string into segments, dropping empty ones from leading/
 * trailing/duplicate slashes.
 * @param {string} path
 * @returns {string[]}
 */
function splitPath(path) {
    if (path === undefined || path === null || path === '') return [];
    return String(path).split('/').filter(seg => seg.length > 0);
}

const INDEXED_SEGMENT = /^(.+)\[(\d+)\]$/;

/**
 * Resolve every node matching `path` starting from `contextNode`.
 * Only 'element' nodes are traversed for element-name segments (text/cdata/
 * comment siblings are skipped, so whitespace-only text nodes from
 * pretty-printed source never interfere with element matching).
 *
 * @param {object} contextNode - an element node
 * @param {string} path
 * @returns {Array<object|string>} element nodes, or attribute value strings
 *          when the path ends in `@attr`
 */
function resolveAll(contextNode, path) {
    if (!contextNode) return [];
    const segments = splitPath(path);
    if (segments.length === 0) return [contextNode];

    let current = [contextNode];

    for (let s = 0; s < segments.length; s++) {
        const seg = segments[s];
        const isLast = s === segments.length - 1;

        if (seg === '.') {
            continue;
        }

        if (seg.startsWith('@')) {
            if (!isLast) {
                throw new Error(`xmlPath: "@attr" segment must be last in path "${path}"`);
            }
            const attrName = seg.slice(1);
            const values = [];
            for (const node of current) {
                if (node && node.type === 'element' && node.attributes && attrName in node.attributes) {
                    values.push(node.attributes[attrName]);
                }
            }
            return values;
        }

        const indexed = INDEXED_SEGMENT.exec(seg);
        const name = indexed ? indexed[1] : seg;
        const index = indexed ? parseInt(indexed[2], 10) : null;

        const next = [];
        for (const node of current) {
            if (!node || node.type !== 'element') continue;
            const matches = (node.children || []).filter(c => c.type === 'element' && c.name === name);
            if (index !== null) {
                if (matches[index - 1]) next.push(matches[index - 1]);
            } else {
                next.push(...matches);
            }
        }
        current = next;
    }

    return current;
}

/**
 * Resolve the first match of `path`, or undefined if none.
 * @param {object} contextNode
 * @param {string} path
 * @returns {object|string|undefined}
 */
function resolveOne(contextNode, path) {
    const results = resolveAll(contextNode, path);
    return results.length > 0 ? results[0] : undefined;
}

/**
 * Concatenate the text/cdata content of a node's direct children (not
 * recursive — matches typical "leaf element holds the value" XML shape).
 * If `node` is already a string (e.g. resolved from an `@attr` path), it is
 * returned as-is.
 *
 * @param {object|string|undefined} node
 * @returns {string}
 */
function getText(node) {
    if (node === undefined || node === null) return '';
    if (typeof node === 'string') return node;
    if (node.type === 'text' || node.type === 'cdata') return node.value;
    if (node.type !== 'element') return '';

    return (node.children || [])
        .filter(c => c.type === 'text' || c.type === 'cdata')
        .map(c => c.value)
        .join('')
        .trim();
}

/**
 * Read an attribute value off an element node.
 * @param {object} node
 * @param {string} name
 * @returns {string|undefined}
 */
function getAttr(node, name) {
    if (!node || node.type !== 'element' || !node.attributes) return undefined;
    return node.attributes[name];
}

module.exports = { resolveAll, resolveOne, getText, getAttr, splitPath };

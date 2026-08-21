/**
 * engine/xml/xmlSerializer.js
 *
 * Serializes the tree produced by xmlParser.js (or built by xmlMapper.js)
 * back into a pretty-printed XML string. Walks the tree iteratively (an
 * explicit stack, mirroring xmlParser's scanner) rather than recursively, so
 * it shares the same "no stack overflow on deep trees" guarantee.
 */

'use strict';

function escapeText(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeAttr(str) {
    return escapeText(str).replace(/"/g, '&quot;');
}

/**
 * Serialize an element tree (as produced by xmlParser's `root`) to an XML
 * string.
 *
 * @param {object} root - element node: { type: 'element', name, attributes, children }
 * @param {{ indent?: string, declaration?: boolean, encoding?: string }} [options]
 * @returns {string}
 */
function serializeXml(root, options = {}) {
    const { indent = '  ', declaration = true, encoding = 'UTF-8' } = options;

    if (!root || root.type !== 'element') {
        throw new TypeError('serializeXml: root must be an element node');
    }

    const lines = [];
    if (declaration) {
        lines.push(`<?xml version="1.0" encoding="${encoding}"?>`);
    }

    // Iterative pre-order walk. Each stack entry is either an opening node
    // to render, or a `{ close, depth }` marker for the matching close tag —
    // pushed right after its element's opening line so it pops after all of
    // that element's children have been rendered.
    const stack = [{ node: root, depth: 0 }];

    while (stack.length > 0) {
        const item = stack.pop();
        const pad = indent.repeat(item.depth);

        if (item.close !== undefined) {
            lines.push(`${pad}</${item.close}>`);
            continue;
        }

        const node = item.node;

        if (node.type === 'text') {
            const trimmed = node.value.trim();
            if (trimmed.length > 0) {
                lines.push(`${pad}${escapeText(trimmed)}`);
            }
            continue;
        }
        if (node.type === 'cdata') {
            lines.push(`${pad}<![CDATA[${node.value}]]>`);
            continue;
        }
        if (node.type === 'comment') {
            lines.push(`${pad}<!--${node.value}-->`);
            continue;
        }
        if (node.type !== 'element') {
            continue;
        }

        const attrStr = Object.entries(node.attributes || {})
            .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
            .join('');

        const meaningfulChildren = (node.children || [])
            .filter(c => !(c.type === 'text' && c.value.trim().length === 0));

        if (meaningfulChildren.length === 0) {
            lines.push(`${pad}<${node.name}${attrStr}/>`);
            continue;
        }

        if (meaningfulChildren.length === 1 && meaningfulChildren[0].type === 'text') {
            const text = escapeText(meaningfulChildren[0].value.trim());
            lines.push(`${pad}<${node.name}${attrStr}>${text}</${node.name}>`);
            continue;
        }

        lines.push(`${pad}<${node.name}${attrStr}>`);
        stack.push({ close: node.name, depth: item.depth });
        for (let idx = meaningfulChildren.length - 1; idx >= 0; idx--) {
            stack.push({ node: meaningfulChildren[idx], depth: item.depth + 1 });
        }
    }

    return lines.join('\n');
}

module.exports = { serializeXml, escapeText, escapeAttr };

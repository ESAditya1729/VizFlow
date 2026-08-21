/**
 * engine/xml/xmlParser.js
 *
 * Dependency-free XML parser. Produces a plain, JSON-serializable tree that
 * maps 1:1 to what the Visual Mapper UI shows (no array/scalar collapsing
 * like most XML→JSON libraries do), so the editor and the runtime evaluator
 * share one shape.
 *
 * Deliberately does NOT resolve DTDs or external entities — markup
 * declarations (<!DOCTYPE ...>) are skipped, not expanded — so XXE is not
 * possible by construction. Only the five standard entities plus numeric
 * character references are decoded.
 *
 * The scanner is iterative (an explicit array-based stack), not recursive,
 * so malformed or adversarially deep input fails with a clear error instead
 * of a stack overflow. A configurable MAX_DEPTH guards against pathological
 * nesting.
 *
 * Node shapes:
 *   { type: 'element', name, attributes: {name: value}, children: [Node] }
 *   { type: 'text', value }
 *   { type: 'cdata', value }
 *   { type: 'comment', value }
 */

'use strict';

const MAX_DEPTH = 5000;

const NAME_START = /^[A-Za-z_:][-A-Za-z0-9_:.]*/;
const ATTR_RE = /^([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/;
const ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g;
const NAMED_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * Thrown on malformed XML. Carries 1-based line/column of the offending
 * position for actionable error messages.
 */
class XmlParseError extends Error {
    constructor(message, pos, input) {
        const { line, column } = XmlParseError.locate(input, pos);
        super(`${message} (line ${line}, column ${column})`);
        this.name = 'XmlParseError';
        this.line = line;
        this.column = column;
    }

    static locate(input, pos) {
        let line = 1;
        let column = 1;
        const end = Math.min(pos, input.length);
        for (let i = 0; i < end; i++) {
            if (input[i] === '\n') {
                line++;
                column = 1;
            } else {
                column++;
            }
        }
        return { line, column };
    }
}

/**
 * Decode the five standard XML entities and numeric character references.
 * Unknown named entities (e.g. HTML-only ones) are left untouched rather
 * than guessed at.
 * @param {string} str
 * @returns {string}
 */
function decodeEntities(str) {
    return str.replace(ENTITY_RE, (match, body) => {
        if (body[0] === '#') {
            const isHex = body[1] === 'x' || body[1] === 'X';
            const code = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        return NAMED_ENTITIES[body] !== undefined ? NAMED_ENTITIES[body] : match;
    });
}

/**
 * Parse an XML string into a plain tree.
 * @param {string} input
 * @returns {{ root: object, declaration: Object|null }}
 */
function parseXml(input) {
    if (typeof input !== 'string') {
        throw new TypeError('parseXml: input must be a string');
    }

    let text = input;
    if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
    }

    const len = text.length;
    let i = 0;
    let declaration = null;

    // ─── XML declaration ───────────────────────────────────────────────────
    if (text.startsWith('<?xml', i)) {
        const end = text.indexOf('?>', i);
        if (end === -1) throw new XmlParseError('Unterminated XML declaration', i, text);
        const declText = text.slice(i + 5, end);
        declaration = {};
        const attrRe = /([a-zA-Z]+)\s*=\s*"([^"]*)"|([a-zA-Z]+)\s*=\s*'([^']*)'/g;
        let m;
        while ((m = attrRe.exec(declText))) {
            const name = m[1] || m[3];
            const value = m[2] !== undefined ? m[2] : m[4];
            declaration[name] = value;
        }
        i = end + 2;
    }

    const stack = [];
    let root = null;

    while (i < len) {
        if (text[i] === '<') {
            // ─── Comment ────────────────────────────────────────────────────
            if (text.startsWith('<!--', i)) {
                const end = text.indexOf('-->', i + 4);
                if (end === -1) throw new XmlParseError('Unterminated comment', i, text);
                if (stack.length > 0) {
                    stack[stack.length - 1].children.push({ type: 'comment', value: text.slice(i + 4, end) });
                }
                i = end + 3;
                continue;
            }

            // ─── CDATA ──────────────────────────────────────────────────────
            if (text.startsWith('<![CDATA[', i)) {
                const end = text.indexOf(']]>', i + 9);
                if (end === -1) throw new XmlParseError('Unterminated CDATA section', i, text);
                if (stack.length === 0) {
                    throw new XmlParseError('CDATA section found outside the root element', i, text);
                }
                stack[stack.length - 1].children.push({ type: 'cdata', value: text.slice(i + 9, end) });
                i = end + 3;
                continue;
            }

            // ─── DOCTYPE / other markup declaration — skipped, not expanded ──
            if (text.startsWith('<!', i)) {
                let j = i + 2;
                let depth = 0;
                while (j < len) {
                    if (text[j] === '[') depth++;
                    else if (text[j] === ']') depth--;
                    else if (text[j] === '>' && depth <= 0) break;
                    j++;
                }
                if (j >= len) throw new XmlParseError('Unterminated markup declaration', i, text);
                i = j + 1;
                continue;
            }

            // ─── Processing instruction ────────────────────────────────────
            if (text.startsWith('<?', i)) {
                const end = text.indexOf('?>', i + 2);
                if (end === -1) throw new XmlParseError('Unterminated processing instruction', i, text);
                i = end + 2;
                continue;
            }

            // ─── Closing tag ────────────────────────────────────────────────
            if (text.startsWith('</', i)) {
                const end = text.indexOf('>', i + 2);
                if (end === -1) throw new XmlParseError('Unterminated closing tag', i, text);
                const name = text.slice(i + 2, end).trim();
                if (stack.length === 0) {
                    throw new XmlParseError(`Unexpected closing tag "</${name}>" with no open element`, i, text);
                }
                const open = stack.pop();
                if (open.name !== name) {
                    throw new XmlParseError(`Mismatched closing tag: expected "</${open.name}>" but found "</${name}>"`, i, text);
                }
                i = end + 1;
                if (stack.length === 0) {
                    root = open;
                }
                continue;
            }

            // ─── Opening / self-closing tag ─────────────────────────────────
            const nameMatch = NAME_START.exec(text.slice(i + 1));
            if (!nameMatch) {
                throw new XmlParseError('Invalid tag name', i, text);
            }
            const tagName = nameMatch[0];
            let j = i + 1 + tagName.length;
            const attributes = {};
            let selfClosing = false;

            while (true) {
                while (j < len && /\s/.test(text[j])) j++;
                if (text[j] === '/' && text[j + 1] === '>') {
                    selfClosing = true;
                    j += 2;
                    break;
                }
                if (text[j] === '>') {
                    j += 1;
                    break;
                }
                if (j >= len) {
                    throw new XmlParseError(`Unterminated tag "<${tagName}>"`, i, text);
                }
                const attrMatch = ATTR_RE.exec(text.slice(j));
                if (!attrMatch) {
                    throw new XmlParseError(`Malformed attribute in tag "<${tagName}>"`, j, text);
                }
                const attrName = attrMatch[1];
                const attrValue = attrMatch[3] !== undefined ? attrMatch[3] : attrMatch[4];
                attributes[attrName] = decodeEntities(attrValue);
                j += attrMatch[0].length;
            }

            const node = { type: 'element', name: tagName, attributes, children: [] };

            if (stack.length > 0) {
                stack[stack.length - 1].children.push(node);
            } else if (root !== null) {
                throw new XmlParseError('Multiple root elements are not allowed', i, text);
            }

            if (selfClosing) {
                if (stack.length === 0) {
                    root = node;
                }
            } else {
                if (stack.length + 1 > MAX_DEPTH) {
                    throw new XmlParseError(`Maximum nesting depth (${MAX_DEPTH}) exceeded`, i, text);
                }
                stack.push(node);
            }

            i = j;
            continue;
        }

        // ─── Text content ────────────────────────────────────────────────────
        const nextTag = text.indexOf('<', i);
        const end = nextTag === -1 ? len : nextTag;
        const raw = text.slice(i, end);
        if (raw.length > 0) {
            if (stack.length === 0) {
                if (raw.trim().length > 0) {
                    throw new XmlParseError('Content found outside the root element', i, text);
                }
                // Insignificant whitespace before/after the root — ignored.
            } else {
                stack[stack.length - 1].children.push({ type: 'text', value: decodeEntities(raw) });
            }
        }
        i = end;
    }

    if (stack.length > 0) {
        throw new XmlParseError(`Unclosed element "<${stack[stack.length - 1].name}>"`, len, text);
    }
    if (!root) {
        throw new XmlParseError('No root element found', 0, text);
    }

    return { root, declaration };
}

module.exports = { parseXml, decodeEntities, XmlParseError, MAX_DEPTH };

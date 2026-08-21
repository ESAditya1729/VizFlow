/**
 * services/xmlSampleService.js
 *
 * Host-side helper for the Workflow Builder's XML Visual Mapper. Resolves a
 * sample XML file, parses it with the dependency-free engine/xml parser, and
 * returns a size-capped, JSON-safe tree the WebView can render — parsing
 * itself stays on the host (WebViews render, they don't parse). Also runs a
 * mapping against the same sample for the mapper's live preview pane,
 * reusing engine/xml/xmlMapper.js exactly as the runtime activities do, so
 * the preview and the actual run can never disagree.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseXml } = require('../engine/xml/xmlParser');
const { mapToRows, mapToTree, autoMapping } = require('../engine/xml/xmlMapper');

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB, same cap as xmlActivities.js
const DEFAULT_MAX_NODES = 500;
const DEFAULT_MAX_TEXT_LENGTH = 200;
const PREVIEW_ROW_LIMIT = 5; // matches the existing "inline preview" convention

/**
 * @param {string} filePath
 * @param {string} workspaceRoot
 * @returns {string}
 */
function resolveSamplePath(filePath, workspaceRoot) {
    if (!filePath) return '';
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(workspaceRoot || '', filePath);
}

/**
 * Copy a parsed element/text/cdata/comment node into a JSON-safe, capped
 * tree. `budget.remaining` is shared and decremented across the whole walk,
 * so wide-but-shallow and narrow-but-deep files are capped the same way.
 * Children are dropped once the budget runs out (not truncated mid-list),
 * and `budget.truncated` is set so the caller can tell the UI some nodes
 * were omitted.
 *
 * @param {object} node
 * @param {{remaining: number, truncated: boolean}} budget
 * @param {number} maxTextLength
 * @returns {object|null}
 */
function capNode(node, budget, maxTextLength) {
    if (!node) return null;
    if (budget.remaining <= 0) {
        budget.truncated = true;
        return null;
    }
    budget.remaining--;

    if (node.type === 'text' || node.type === 'cdata' || node.type === 'comment') {
        const value = node.value.length > maxTextLength
            ? `${node.value.slice(0, maxTextLength)}…`
            : node.value;
        return { type: node.type, value };
    }

    const children = [];
    for (const child of node.children || []) {
        if (budget.remaining <= 0) {
            budget.truncated = true;
            break;
        }
        const capped = capNode(child, budget, maxTextLength);
        if (capped) children.push(capped);
    }

    return { type: 'element', name: node.name, attributes: { ...node.attributes }, children };
}

/**
 * @param {string} filePath
 * @param {string} workspaceRoot
 * @returns {Promise<{root: object, declaration: Object|null, resolvedPath: string}>}
 */
async function readAndParse(filePath, workspaceRoot) {
    const resolvedPath = resolveSamplePath(filePath, workspaceRoot);
    if (!resolvedPath) {
        throw new Error('xmlSampleService: filePath is required');
    }

    let stats;
    try {
        stats = await fs.promises.stat(resolvedPath);
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`xmlSampleService: file not found - ${filePath}`);
        }
        throw error;
    }
    if (!stats.isFile()) {
        throw new Error(`xmlSampleService: "${filePath}" is not a file`);
    }
    if (stats.size > MAX_FILE_SIZE) {
        throw new Error(`xmlSampleService: file size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    const content = await fs.promises.readFile(resolvedPath, 'utf8');
    const { root, declaration } = parseXml(content);
    return { root, declaration, resolvedPath };
}

/**
 * Load a sample XML file for the Visual Mapper's source-tree pane.
 *
 * @param {string} filePath
 * @param {string} workspaceRoot
 * @param {{maxNodes?: number, maxTextLength?: number}} [options]
 * @returns {Promise<{tree: object, declaration: Object|null, truncated: boolean}>}
 */
async function loadXmlSample(filePath, workspaceRoot, options = {}) {
    const { maxNodes = DEFAULT_MAX_NODES, maxTextLength = DEFAULT_MAX_TEXT_LENGTH } = options;
    const { root, declaration } = await readAndParse(filePath, workspaceRoot);

    const budget = { remaining: maxNodes, truncated: false };
    const tree = capNode(root, budget, maxTextLength);

    return { tree, declaration, truncated: budget.truncated };
}

/**
 * Run a mapping against the same sample file for the Visual Mapper's live
 * preview pane. `targetShape: 'rows'` mirrors readXml (mapToRows, capped to
 * a handful of rows); `'tree'` mirrors xmlTransform (mapToTree, capped the
 * same way as loadXmlSample).
 *
 * @param {string} filePath
 * @param {string} workspaceRoot
 * @param {{mapping?: object, targetShape?: 'rows'|'tree', mode?: 'auto'|'visual', recordPath?: string}} options
 * @returns {Promise<object>}
 */
async function previewXmlMapping(filePath, workspaceRoot, options = {}) {
    const { mapping, targetShape = 'rows', mode = 'visual', recordPath = '' } = options;
    const { root } = await readAndParse(filePath, workspaceRoot);

    if (targetShape === 'tree') {
        if (!mapping) {
            throw new Error('xmlSampleService: mapping is required for a tree preview');
        }
        const target = mapToTree(root, mapping);
        const budget = { remaining: DEFAULT_MAX_NODES, truncated: false };
        const tree = capNode(target, budget, DEFAULT_MAX_TEXT_LENGTH);
        return { tree, truncated: budget.truncated };
    }

    const effectiveMapping = mode === 'auto' ? autoMapping(root, recordPath) : mapping;
    if (!effectiveMapping) {
        throw new Error('xmlSampleService: mapping is required for a rows preview');
    }
    const { rows, columns } = mapToRows(root, effectiveMapping);
    return {
        rows: rows.slice(0, PREVIEW_ROW_LIMIT),
        columns,
        totalRows: rows.length,
        truncated: rows.length > PREVIEW_ROW_LIMIT
    };
}

module.exports = {
    loadXmlSample,
    previewXmlMapping,
    resolveSamplePath,
    DEFAULT_MAX_NODES,
    DEFAULT_MAX_TEXT_LENGTH,
    PREVIEW_ROW_LIMIT
};

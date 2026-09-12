/**
 * engine/workflow/activities/xmlActivities.js
 *
 * XML activities bridging the Workflow Builder's tabular Dataset model with
 * hierarchical XML, on top of the dependency-free engine/xml/ modules:
 *   - readXml       (Input)          XML file -> Dataset
 *   - writeXml       (Output)         Dataset -> XML file (passthrough)
 *   - xmlTransform   (Transformation) XML file -> XML file (passthrough)
 *
 * Same shape/conventions as inputActivities.js / outputActivities.js. This
 * file only requires the new engine/xml/ modules (read-only) — nothing in
 * inputActivities.js/outputActivities.js is imported from or modified.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Dataset = require('../../dataset');
const { parseXml } = require('../../xml/xmlParser');
const { serializeXml } = require('../../xml/xmlSerializer');
const { mapToRows, mapToTree, autoMapping } = require('../../xml/xmlMapper');
const { validateConfig, validateFile, ensureDirectory, checkFileWritable } = require('./shared');

// ─── Constants ──────────────────────────────────────────────────────────────
const DEFAULT_ENCODING = 'utf8';
const ENCODING_OPTIONS = [
    { label: 'UTF-8', value: 'utf8' },
    { label: 'ASCII', value: 'ascii' },
    { label: 'ISO-8859-1', value: 'latin1' }
];

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Wrap a single flat Dataset row into a synthetic element node in the same
 * shape xmlParser produces, so writeXml's mapping (authored against
 * xmlPath's `Name` / `@attr` grammar, same as every other mapping) can bind
 * to column values by name — column "OrderId" is reachable via either the
 * child-element path "OrderId" or the attribute path "@OrderId".
 *
 * @param {Object<string,*>} row
 * @param {string[]} columns
 * @returns {object} synthetic 'Row' element node
 */
function rowToSourceNode(row, columns) {
    const attributes = {};
    const children = [];
    for (const col of columns) {
        const value = row[col];
        const text = value === null || value === undefined ? '' : String(value);
        // Auto-mode column names carry a leading "@" for attribute-derived
        // columns (see xmlMapper.autoMapping) — strip it so both the
        // attribute path "@id" and the child-element path "id" resolve to
        // the same value on this synthetic node.
        const bareName = col.startsWith('@') ? col.slice(1) : col;
        attributes[bareName] = text;
        children.push({ type: 'element', name: bareName, attributes: {}, children: [{ type: 'text', value: text }] });
    }
    return { type: 'element', name: 'Row', attributes, children };
}

// ─── Activity Definitions ──────────────────────────────────────────────────

const xmlActivities = [];

// ─── 1. Read XML Activity ────────────────────────────────────────────────────
xmlActivities.push({
    type: 'readXml',
    displayName: '📥 Read XML',
    description: 'Reads an XML file into a Dataset, either by auto-flattening a repeating element or via a visual field mapping.',
    category: 'Input',
    configRequirements: [
        {
            name: 'filePath',
            label: 'XML File Path',
            type: 'file',
            required: true,
            description: 'Absolute path or workspace-relative path of the XML file'
        },
        {
            name: 'mode',
            label: 'Mapping Mode',
            type: 'select',
            required: false,
            options: [
                { label: 'Auto (flatten a repeating element)', value: 'auto' },
                { label: 'Visual mapping', value: 'visual' }
            ],
            defaultValue: 'auto',
            description: 'Auto derives one column per child element/attribute of the record path; Visual uses a hand-built field mapping'
        },
        {
            name: 'recordPath',
            label: 'Record Path',
            type: 'string',
            required: false,
            description: 'Path to the repeating record element in Auto mode, e.g. "Orders/Order"'
        },
        {
            name: 'mapping',
            label: 'Field Mapping',
            type: 'xmlMapper',
            required: false,
            description: 'Visual field mapping used in Visual mode (built in the Visual Mapper editor)'
        },
        {
            name: 'encoding',
            label: 'Encoding',
            type: 'select',
            required: false,
            options: ENCODING_OPTIONS,
            description: 'File encoding (default: UTF-8)'
        }
    ],
    async execute(config, context, _inputDataset) {
        const {
            filePath,
            mode = 'auto',
            recordPath = '',
            mapping,
            encoding = DEFAULT_ENCODING
        } = config;

        validateConfig({ filePath }, ['filePath'], 'Read XML');

        const resolvedPath = context.resolvePath ? context.resolvePath(filePath) : filePath;

        const fileValidation = await validateFile(resolvedPath);
        if (!fileValidation.exists) {
            throw new Error(`Read XML: ${fileValidation.error} - ${filePath}`);
        }

        let content;
        try {
            content = (await fs.promises.readFile(resolvedPath, encoding)).toString();
        } catch (error) {
            throw new Error(`Read XML: Failed to read file - ${error.message}`);
        }

        let parsed;
        try {
            parsed = parseXml(content);
        } catch (error) {
            throw new Error(`Read XML: Failed to parse XML - ${error.message}`);
        }

        let effectiveMapping;
        if (mode === 'visual') {
            if (!mapping) {
                throw new Error('Read XML: "mapping" is required when mode is "visual"');
            }
            effectiveMapping = mapping;
        } else {
            if (!recordPath) {
                throw new Error('Read XML: "recordPath" is required when mode is "auto"');
            }
            effectiveMapping = autoMapping(parsed.root, recordPath);
        }

        let rows;
        let columns;
        try {
            const result = mapToRows(parsed.root, effectiveMapping);
            rows = result.rows;
            columns = result.columns;
        } catch (error) {
            throw new Error(`Read XML: ${error.message}`);
        }

        const dataset = new Dataset(rows, columns);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                outputRowCount: dataset.getRowCount(),
                columnCount: dataset.getColumns().length,
                fileSize: fileValidation.size,
                mode,
                encoding,
                filePath: resolvedPath
            });
        }

        return dataset;
    }
});

// ─── 2. Write XML Activity ───────────────────────────────────────────────────
xmlActivities.push({
    type: 'writeXml',
    displayName: '💾 Write XML',
    description: 'Writes the current dataset to an XML file, using a visual mapping to shape each row into an element.',
    category: 'Output',
    configRequirements: [
        {
            name: 'filePath',
            label: 'XML File Path',
            type: 'file',
            required: true,
            description: 'Absolute path or workspace-relative path of the output XML file'
        },
        {
            name: 'rootElement',
            label: 'Root Element Name',
            type: 'string',
            required: false,
            defaultValue: 'Root',
            description: 'Name of the wrapping root element that contains one child per row'
        },
        {
            name: 'mapping',
            label: 'Field Mapping',
            type: 'xmlMapper',
            required: true,
            description: 'Per-row element mapping used to build each row into an XML element (built in the Visual Mapper editor)'
        },
        {
            name: 'overwrite',
            label: 'Overwrite Existing',
            type: 'boolean',
            required: false,
            description: 'Overwrite existing file if it exists (default: true)'
        },
        {
            name: 'encoding',
            label: 'Encoding',
            type: 'select',
            required: false,
            options: ENCODING_OPTIONS,
            description: 'File encoding (default: UTF-8)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Write XML activity: Input dataset is required');
        }

        const {
            filePath,
            rootElement = 'Root',
            mapping,
            overwrite = true,
            encoding = DEFAULT_ENCODING
        } = config;

        validateConfig({ filePath, mapping }, ['filePath', 'mapping'], 'Write XML');

        const resolvedPath = context.resolvePath ? context.resolvePath(filePath) : filePath;

        const checkResult = await checkFileWritable(resolvedPath, { overwrite });
        if (!checkResult.writable) {
            throw new Error(`Write XML: ${checkResult.error}`);
        }
        if (checkResult.warning) {
            console.warn(`[VizFlow] Write XML warning: ${checkResult.warning}`);
        }

        await ensureDirectory(path.dirname(resolvedPath));

        const columns = inputDataset.getColumns();
        const targetRoot = { type: 'element', name: rootElement, attributes: {}, children: [] };

        for (const row of inputDataset.rows) {
            const rowNode = rowToSourceNode(row, columns);
            let built;
            try {
                built = mapToTree(rowNode, mapping);
            } catch (error) {
                throw new Error(`Write XML: ${error.message}`);
            }
            targetRoot.children.push(built);
        }

        const xmlText = serializeXml(targetRoot);

        try {
            await fs.promises.writeFile(resolvedPath, xmlText, encoding);
        } catch (error) {
            throw new Error(`Write XML: Failed to write file - ${error.message}`);
        }

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: inputDataset.getRowCount(),
                elementsWritten: targetRoot.children.length,
                filePath: resolvedPath,
                fileSize: Buffer.byteLength(xmlText, encoding)
            });
        }

        return inputDataset;
    }
});

// ─── 3. XML Transform Activity ───────────────────────────────────────────────
xmlActivities.push({
    type: 'xmlTransform',
    displayName: '🔄 XML Transform',
    description: 'Transforms one XML file into another XML file using a visual, XSLT-like tree mapping. Self-contained (reads its own input, writes its own output).',
    category: 'Transformation',
    configRequirements: [
        {
            name: 'inputFilePath',
            label: 'Input XML File Path',
            type: 'file',
            required: true,
            description: 'Absolute path or workspace-relative path of the source XML file'
        },
        {
            name: 'outputFilePath',
            label: 'Output XML File Path',
            type: 'file',
            required: true,
            description: 'Absolute path or workspace-relative path of the transformed XML file'
        },
        {
            name: 'mapping',
            label: 'Tree Mapping',
            type: 'xmlMapper',
            required: true,
            description: 'Visual tree mapping describing the target XML shape (built in the Visual Mapper editor)'
        },
        {
            name: 'overwrite',
            label: 'Overwrite Existing',
            type: 'boolean',
            required: false,
            description: 'Overwrite existing output file if it exists (default: true)'
        },
        {
            name: 'encoding',
            label: 'Encoding',
            type: 'select',
            required: false,
            options: ENCODING_OPTIONS,
            description: 'File encoding for both input and output (default: UTF-8)'
        }
    ],
    async execute(config, context, inputDataset) {
        const {
            inputFilePath,
            outputFilePath,
            mapping,
            overwrite = true,
            encoding = DEFAULT_ENCODING
        } = config;

        validateConfig({ inputFilePath, outputFilePath, mapping }, ['inputFilePath', 'outputFilePath', 'mapping'], 'XML Transform');

        const resolvedInput = context.resolvePath ? context.resolvePath(inputFilePath) : inputFilePath;
        const resolvedOutput = context.resolvePath ? context.resolvePath(outputFilePath) : outputFilePath;

        const fileValidation = await validateFile(resolvedInput);
        if (!fileValidation.exists) {
            throw new Error(`XML Transform: ${fileValidation.error} - ${inputFilePath}`);
        }

        let content;
        try {
            content = (await fs.promises.readFile(resolvedInput, encoding)).toString();
        } catch (error) {
            throw new Error(`XML Transform: Failed to read file - ${error.message}`);
        }

        let parsed;
        try {
            parsed = parseXml(content);
        } catch (error) {
            throw new Error(`XML Transform: Failed to parse XML - ${error.message}`);
        }

        let targetRoot;
        try {
            targetRoot = mapToTree(parsed.root, mapping);
        } catch (error) {
            throw new Error(`XML Transform: ${error.message}`);
        }

        const xmlText = serializeXml(targetRoot);

        const checkResult = await checkFileWritable(resolvedOutput, { overwrite });
        if (!checkResult.writable) {
            throw new Error(`XML Transform: ${checkResult.error}`);
        }
        if (checkResult.warning) {
            console.warn(`[VizFlow] XML Transform warning: ${checkResult.warning}`);
        }

        await ensureDirectory(path.dirname(resolvedOutput));

        try {
            await fs.promises.writeFile(resolvedOutput, xmlText, encoding);
        } catch (error) {
            throw new Error(`XML Transform: Failed to write file - ${error.message}`);
        }

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputFilePath: resolvedInput,
                outputFilePath: resolvedOutput,
                fileSize: Buffer.byteLength(xmlText, encoding)
            });
        }

        if (inputDataset) return inputDataset;
        return new Dataset([{ outputFilePath: resolvedOutput, fileSize: Buffer.byteLength(xmlText, encoding) }], ['outputFilePath', 'fileSize']);
    }
});

module.exports = xmlActivities;

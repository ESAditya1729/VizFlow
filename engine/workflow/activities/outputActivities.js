/**
 * engine/workflow/activities/outputActivities.js
 *
 * Output activities for writing data to files.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const templateService = require('../../../services/templateService');

// ─── Constants ──────────────────────────────────────────────────────────────
const DEFAULT_ENCODING = 'utf8';
const DEFAULT_DELIMITER = ',';
const DEFAULT_QUOTE_CHAR = '"';
const MAX_FILE_SIZE_WARNING = 100 * 1024 * 1024; // 100MB

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Ensure directory exists, create if not
 * @param {string} dirPath - Directory path
 * @returns {Promise<void>}
 */
async function ensureDirectory(dirPath) {
    if (!dirPath) return;
    try {
        await fs.promises.access(dirPath, fs.constants.F_OK);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.promises.mkdir(dirPath, { recursive: true });
        } else {
            throw error;
        }
    }
}

/**
 * Check if file is writable
 * @param {string} filePath - File path
 * @param {Object} options - Check options
 * @param {boolean} options.overwrite - Allow overwrite (default: true)
 * @param {number} options.maxSize - Maximum file size in bytes
 * @returns {Promise<{ writable: boolean, error?: string, warning?: string }>}
 */
async function checkFileWritable(filePath, options = {}) {
    const { overwrite = true, maxSize = MAX_FILE_SIZE_WARNING } = options;
    
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        // File exists
        if (!overwrite) {
            return { writable: false, error: `File "${path.basename(filePath)}" already exists and overwrite is disabled` };
        }
        
        // Check file size
        const stats = await fs.promises.stat(filePath);
        if (stats.size > maxSize) {
            return { 
                writable: true, 
                warning: `File size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds recommended limit` 
            };
        }
        
        return { writable: true };
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist, check parent directory
            const dir = path.dirname(filePath);
            try {
                await fs.promises.access(dir, fs.constants.W_OK);
                return { writable: true };
            } catch {
                return { writable: false, error: `Directory "${dir}" is not writable` };
            }
        }
        return { writable: false, error: `Cannot access file: ${error.message}` };
    }
}

/**
 * Generate filename with timestamp
 * @param {string} baseName - Base filename without extension
 * @param {string} extension - File extension (e.g., 'csv')
 * @returns {string} Filename with timestamp
 */
function generateTimestampedFilename(baseName, extension) {
    const timestamp = new Date().toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
    return `${baseName}_${timestamp}.${extension}`;
}

/**
 * Validate config with required fields
 * @param {Object} config - Configuration object
 * @param {Array} required - Array of required field names
 * @param {string} activityName - Activity name for error messages
 * @throws {Error} If required field is missing
 */
function validateConfig(config, required, activityName) {
    for (const field of required) {
        if (config[field] === undefined || config[field] === null || config[field] === '') {
            throw new Error(`${activityName}: "${field}" is required`);
        }
    }
}

/**
 * Format data based on type for text output
 * @param {*} data - Data to format
 * @param {string} format - Format type (json, csv, table, plain)
 * @param {Object} options - Formatting options
 * @returns {string} Formatted text
 */
function formatDataForText(data, format = 'plain', options = {}) {
    if (data === null || data === undefined) {
        return '';
    }

    // If it's a Dataset, convert to appropriate format
    if (data.rows && data.getColumns) {
        const columns = data.getColumns();
        const rows = data.rows;

        switch (format) {
            case 'json':
                return JSON.stringify(rows, null, 2);
            
            case 'csv':
                return Papa.unparse(rows, {
                    columns: columns,
                    delimiter: options.delimiter || ',',
                    header: options.header !== false
                });
            
            case 'table':
                // Create a formatted table
                const colWidths = columns.map(col => {
                    const maxRowLen = rows.reduce((max, row) => {
                        const val = String(row[col] ?? '');
                        return Math.max(max, val.length);
                    }, 0);
                    return Math.max(col.length, maxRowLen);
                });

                let table = '┌' + colWidths.map(w => '─'.repeat(w + 2)).join('┬') + '┐\n';
                table += '│' + columns.map((col, i) => ` ${col.padEnd(colWidths[i])} `).join('│') + '│\n';
                table += '├' + colWidths.map(w => '─'.repeat(w + 2)).join('┼') + '┤\n';
                
                for (const row of rows) {
                    table += '│' + columns.map((col, i) => {
                        const val = String(row[col] ?? '');
                        return ` ${val.padEnd(colWidths[i])} `;
                    }).join('│') + '│\n';
                }
                table += '└' + colWidths.map(w => '─'.repeat(w + 2)).join('┴') + '┘';
                return table;
            
            case 'plain':
            default:
                // Simple formatted output
                let output = '';
                if (options.includeHeader !== false) {
                    output += columns.join(', ') + '\n';
                    output += '-'.repeat(output.length) + '\n';
                }
                for (const row of rows) {
                    output += columns.map(col => row[col] ?? '').join(', ') + '\n';
                }
                return output;
        }
    }

    // If it's an array or object, stringify
    if (typeof data === 'object') {
        return JSON.stringify(data, null, 2);
    }

    // If it's a string or primitive, return as-is
    return String(data);
}

// ─── Activity Definitions ──────────────────────────────────────────────────

const outputActivities = [];

// ─── 1. Write CSV Activity ───────────────────────────────────────────────────
outputActivities.push({
    type: 'writeCsv',
    displayName: '💾 Write CSV',
    description: 'Writes the current dataset to a local CSV file path.',
    category: 'Output',
    configRequirements: [
        {
            name: 'filePath',
            label: 'CSV File Path',
            type: 'file',
            required: true,
            description: 'Absolute path or workspace-relative path of the output CSV file'
        },
        {
            name: 'delimiter',
            label: 'Delimiter',
            type: 'select',
            required: false,
            options: [
                { label: 'Comma (,)', value: ',' },
                { label: 'Semicolon (;)', value: ';' },
                { label: 'Tab (\\t)', value: '\t' },
                { label: 'Pipe (|)', value: '|' }
            ],
            description: 'Column delimiter (default: comma)'
        },
        {
            name: 'header',
            label: 'Include Header',
            type: 'boolean',
            required: false,
            description: 'Include column headers in output (default: true)'
        },
        {
            name: 'encoding',
            label: 'Encoding',
            type: 'select',
            required: false,
            options: [
                { label: 'UTF-8', value: 'utf8' },
                { label: 'UTF-8 with BOM', value: 'utf8-bom' },
                { label: 'ASCII', value: 'ascii' },
                { label: 'ISO-8859-1', value: 'latin1' }
            ],
            description: 'File encoding (default: UTF-8)'
        },
        {
            name: 'overwrite',
            label: 'Overwrite Existing',
            type: 'boolean',
            required: false,
            description: 'Overwrite existing file if it exists (default: true)'
        },
        {
            name: 'quoteChar',
            label: 'Quote Character',
            type: 'select',
            required: false,
            options: [
                { label: 'Double Quote (")', value: '"' },
                { label: 'Single Quote (\')', value: "'" }
            ],
            description: 'Character used to quote fields (default: double quote)'
        },
        {
            name: 'escapeChar',
            label: 'Escape Character',
            type: 'select',
            required: false,
            options: [
                { label: 'Double Quote (")', value: '"' },
                { label: 'Backslash (\\)', value: '\\' }
            ],
            description: 'Character used to escape quotes (default: double quote)'
        },
        {
            name: 'nullValue',
            label: 'Null Value Representation',
            type: 'string',
            required: false,
            description: 'How to represent null/undefined values (default: empty string)'
        },
        {
            name: 'timestampSuffix',
            label: 'Add Timestamp Suffix',
            type: 'boolean',
            required: false,
            description: 'Add timestamp to filename to avoid overwriting (default: false)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Write CSV activity: Input dataset is required');
        }
        
        const {
            filePath,
            delimiter = DEFAULT_DELIMITER,
            header = true,
            encoding = DEFAULT_ENCODING,
            overwrite = true,
            quoteChar = DEFAULT_QUOTE_CHAR,
            escapeChar = DEFAULT_QUOTE_CHAR,
            nullValue = '',
            timestampSuffix = false
        } = config;

        validateConfig({ filePath }, ['filePath'], 'Write CSV');

        // Resolve file path
        let resolvedPath = context.resolvePath ? context.resolvePath(filePath) : filePath;
        
        // Apply timestamp suffix if requested
        if (timestampSuffix) {
            const parsed = path.parse(resolvedPath);
            resolvedPath = path.join(
                parsed.dir,
                generateTimestampedFilename(parsed.name, parsed.ext.substring(1) || 'csv')
            );
        }

        // Check if file is writable
        const checkResult = await checkFileWritable(resolvedPath, { overwrite });
        if (!checkResult.writable) {
            throw new Error(`Write CSV: ${checkResult.error}`);
        }
        if (checkResult.warning) {
            console.warn(`[VizFlow] Write CSV warning: ${checkResult.warning}`);
        }

        // Ensure directory exists
        const dir = path.dirname(resolvedPath);
        await ensureDirectory(dir);

        // Prepare data for CSV
        const columns = inputDataset.getColumns();
        const rows = inputDataset.rows;

        // Handle null values
        const processedRows = rows.map(row => {
            const processedRow = {};
            for (const col of columns) {
                const value = row[col];
                processedRow[col] = value === null || value === undefined ? nullValue : value;
            }
            return processedRow;
        });

        // Generate CSV
        const csvOptions = {
            columns: columns,
            delimiter: delimiter,
            quoteChar: quoteChar,
            escapeChar: escapeChar,
            header: header,
            skipEmptyLines: true
        };

        const csvText = Papa.unparse(processedRows, csvOptions);

        // Write with appropriate encoding
        let writeContent = csvText;
        if (encoding === 'utf8-bom') {
            writeContent = '\uFEFF' + csvText; // Add BOM for UTF-8
        }

        await fs.promises.writeFile(resolvedPath, writeContent, encoding === 'utf8-bom' ? 'utf8' : encoding);

        // Track stats
        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: inputDataset.getRowCount(),
                filePath: resolvedPath,
                fileSize: Buffer.byteLength(writeContent, encoding),
                delimiter: delimiter === '\t' ? 'tab' : delimiter,
                hasHeader: header,
                encoding: encoding,
                columns: columns.length
            });
        }

        return inputDataset;
    }
});

// ─── 2. Write JSON Activity ──────────────────────────────────────────────────
outputActivities.push({
    type: 'writeJson',
    displayName: '📝 Write JSON',
    description: 'Writes the current dataset to a local JSON file.',
    category: 'Output',
    configRequirements: [
        {
            name: 'filePath',
            label: 'JSON File Path',
            type: 'file',
            required: true,
            description: 'Absolute path or workspace-relative path of the output JSON file'
        },
        {
            name: 'format',
            label: 'JSON Format',
            type: 'select',
            required: false,
            options: [
                { label: 'Pretty (indented)', value: 'pretty' },
                { label: 'Compact (minified)', value: 'compact' }
            ],
            description: 'JSON formatting style (default: pretty)'
        },
        {
            name: 'overwrite',
            label: 'Overwrite Existing',
            type: 'boolean',
            required: false,
            description: 'Overwrite existing file if it exists (default: true)'
        },
        {
            name: 'timestampSuffix',
            label: 'Add Timestamp Suffix',
            type: 'boolean',
            required: false,
            description: 'Add timestamp to filename to avoid overwriting (default: false)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Write JSON activity: Input dataset is required');
        }

        const {
            filePath,
            format = 'pretty',
            overwrite = true,
            timestampSuffix = false
        } = config;

        validateConfig({ filePath }, ['filePath'], 'Write JSON');

        // Resolve file path
        let resolvedPath = context.resolvePath ? context.resolvePath(filePath) : filePath;
        
        if (timestampSuffix) {
            const parsed = path.parse(resolvedPath);
            resolvedPath = path.join(
                parsed.dir,
                generateTimestampedFilename(parsed.name, parsed.ext.substring(1) || 'json')
            );
        }

        // Check if file is writable
        const checkResult = await checkFileWritable(resolvedPath, { overwrite });
        if (!checkResult.writable) {
            throw new Error(`Write JSON: ${checkResult.error}`);
        }

        // Ensure directory exists
        const dir = path.dirname(resolvedPath);
        await ensureDirectory(dir);

        // Convert dataset to JSON
        const jsonData = inputDataset.rows.map(row => {
            const obj = {};
            for (const col of inputDataset.getColumns()) {
                obj[col] = row[col];
            }
            return obj;
        });

        // Include metadata
        const output = {
            metadata: {
                rowCount: jsonData.length,
                columns: inputDataset.getColumns(),
                exportedAt: new Date().toISOString()
            },
            data: jsonData
        };

        const jsonString = format === 'pretty' 
            ? JSON.stringify(output, null, 2)
            : JSON.stringify(output);

        await fs.promises.writeFile(resolvedPath, jsonString, 'utf8');

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: inputDataset.getRowCount(),
                outputRowCount: inputDataset.getRowCount(),
                filePath: resolvedPath,
                fileSize: Buffer.byteLength(jsonString, 'utf8'),
                format: format
            });
        }

        return inputDataset;
    }
});

// ─── 3. Export Multiple Files Activity ──────────────────────────────────────
outputActivities.push({
    type: 'exportMultiple',
    displayName: '📦 Export Multiple Files',
    description: 'Exports dataset to multiple formats or splits into multiple files.',
    category: 'Output',
    configRequirements: [
        {
            name: 'outputDir',
            label: 'Output Directory',
            type: 'file',
            required: true,
            description: 'Directory where files will be written'
        },
        {
            name: 'baseName',
            label: 'Base Filename',
            type: 'string',
            required: false,
            description: 'Base name for output files (default: "output")',
            defaultValue: 'output'
        },
        {
            name: 'formats',
            label: 'Formats',
            type: 'select',
            required: false,
            options: [
                { label: 'CSV only', value: 'csv' },
                { label: 'JSON only', value: 'json' },
                { label: 'CSV and JSON', value: 'both' }
            ],
            description: 'Export formats (default: CSV)'
        },
        {
            name: 'splitBy',
            label: 'Split By',
            type: 'number',
            required: false,
            description: 'Split into multiple files with this many rows per file (0 = no split)',
            defaultValue: 0
        },
        {
            name: 'delimiter',
            label: 'CSV Delimiter',
            type: 'select',
            required: false,
            options: [
                { label: 'Comma (,)', value: ',' },
                { label: 'Semicolon (;)', value: ';' },
                { label: 'Tab (\\t)', value: '\t' }
            ],
            description: 'Column delimiter for CSV (default: comma)'
        }
    ],
    async execute(config, context, inputDataset) {
        if (!inputDataset) {
            throw new Error('Export Multiple activity: Input dataset is required');
        }

        const {
            outputDir,
            baseName = 'output',
            formats = 'csv',
            splitBy = 0,
            delimiter = DEFAULT_DELIMITER
        } = config;

        validateConfig({ outputDir }, ['outputDir'], 'Export Multiple');

        // Resolve output directory
        const resolvedDir = context.resolvePath ? context.resolvePath(outputDir) : outputDir;
        await ensureDirectory(resolvedDir);

        const formatsList = formats === 'both' ? ['csv', 'json'] : [formats];
        const totalRows = inputDataset.getRowCount();
        const shouldSplit = splitBy > 0 && splitBy < totalRows;

        let fileCount = 0;
        const generatedFiles = [];

        if (shouldSplit) {
            // Split into multiple files
            const numFiles = Math.ceil(totalRows / splitBy);
            const columns = inputDataset.getColumns();

            for (let i = 0; i < numFiles; i++) {
                const start = i * splitBy;
                const end = Math.min(start + splitBy, totalRows);
                const chunkRows = inputDataset.rows.slice(start, end);

                // Generate filename with part number
                const partName = `${baseName}_part${String(i + 1).padStart(2, '0')}`;

                for (const format of formatsList) {
                    const fileName = `${partName}.${format}`;
                    const filePath = path.join(resolvedDir, fileName);
                    
                    if (format === 'csv') {
                        const csvText = Papa.unparse(chunkRows, { columns, delimiter });
                        await fs.promises.writeFile(filePath, csvText, 'utf8');
                    } else if (format === 'json') {
                        const jsonData = chunkRows.map(row => {
                            const obj = {};
                            for (const col of columns) {
                                obj[col] = row[col];
                            }
                            return obj;
                        });
                        await fs.promises.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf8');
                    }
                    
                    generatedFiles.push(filePath);
                    fileCount++;
                }
            }
        } else {
            // Single file export
            for (const format of formatsList) {
                const fileName = `${baseName}.${format}`;
                const filePath = path.join(resolvedDir, fileName);

                if (format === 'csv') {
                    const csvText = Papa.unparse(inputDataset.rows, {
                        columns: inputDataset.getColumns(),
                        delimiter
                    });
                    await fs.promises.writeFile(filePath, csvText, 'utf8');
                } else if (format === 'json') {
                    const jsonData = inputDataset.rows.map(row => {
                        const obj = {};
                        for (const col of inputDataset.getColumns()) {
                            obj[col] = row[col];
                        }
                        return obj;
                    });
                    await fs.promises.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf8');
                }

                generatedFiles.push(filePath);
                fileCount++;
            }
        }

        if (context && context.setActivityStats) {
            context.setActivityStats({
                inputRowCount: totalRows,
                outputRowCount: totalRows,
                outputDir: resolvedDir,
                fileCount: fileCount,
                formats: formatsList.join(', '),
                splitBy: splitBy > 0 ? splitBy : 'none'
            });
        }

        return inputDataset;
    }
});

// ─── 4. Write Text File Activity ────────────────────────────────────────────
outputActivities.push({
    type: 'writeText',
    displayName: '📄 Write Text File',
    description: 'Writes data to a plain text file with customizable formatting.',
    category: 'Output',
    configRequirements: [
        {
            name: 'filePath',
            label: 'Text File Path',
            type: 'file',
            required: true,
            description: 'Absolute path or workspace-relative path of the output text file'
        },
        {
            name: 'content',
            label: 'Content Source',
            type: 'select',
            required: true,
            options: [
                { label: 'From Dataset (formatted)', value: 'dataset' },
                { label: 'From Variable', value: 'variable' },
                { label: 'Custom Text', value: 'custom' }
            ],
            description: 'Source of the content to write'
        },
        {
            name: 'variableName',
            label: 'Variable Name',
            type: 'string',
            required: false,
            description: 'Name of the variable containing the content (for variable source)'
        },
        {
            name: 'customText',
            label: 'Custom Text',
            type: 'text',
            required: false,
            description: 'Custom text content to write (for custom source) - supports {{variable}} placeholders'
        },
        {
            name: 'format',
            label: 'Output Format',
            type: 'select',
            required: false,
            options: [
                { label: 'Plain (comma-separated)', value: 'plain' },
                { label: 'CSV', value: 'csv' },
                { label: 'JSON', value: 'json' },
                { label: 'Table', value: 'table' }
            ],
            description: 'Format for dataset output (default: plain)'
        },
        {
            name: 'includeHeader',
            label: 'Include Header',
            type: 'boolean',
            required: false,
            description: 'Include column headers in output (default: true)'
        },
        {
            name: 'delimiter',
            label: 'Delimiter',
            type: 'select',
            required: false,
            options: [
                { label: 'Comma (,)', value: ',' },
                { label: 'Semicolon (;)', value: ';' },
                { label: 'Tab (\\t)', value: '\t' },
                { label: 'Pipe (|)', value: '|' }
            ],
            description: 'Column delimiter for CSV format (default: comma)'
        },
        {
            name: 'encoding',
            label: 'Encoding',
            type: 'select',
            required: false,
            options: [
                { label: 'UTF-8', value: 'utf8' },
                { label: 'UTF-8 with BOM', value: 'utf8-bom' },
                { label: 'ASCII', value: 'ascii' },
                { label: 'ISO-8859-1', value: 'latin1' }
            ],
            description: 'File encoding (default: UTF-8)'
        },
        {
            name: 'overwrite',
            label: 'Overwrite Existing',
            type: 'boolean',
            required: false,
            description: 'Overwrite existing file if it exists (default: true)'
        },
        {
            name: 'timestampSuffix',
            label: 'Add Timestamp Suffix',
            type: 'boolean',
            required: false,
            description: 'Add timestamp to filename to avoid overwriting (default: false)'
        }
    ],
    async execute(config, context, inputDataset) {
        const {
            filePath,
            content = 'dataset',
            variableName,
            customText,
            format = 'plain',
            includeHeader = true,
            delimiter = DEFAULT_DELIMITER,
            encoding = DEFAULT_ENCODING,
            overwrite = true,
            timestampSuffix = false
        } = config;

        validateConfig({ filePath, content }, ['filePath', 'content'], 'Write Text');

        // Resolve file path
        let resolvedPath = context.resolvePath ? context.resolvePath(filePath) : filePath;
        
        if (timestampSuffix) {
            const parsed = path.parse(resolvedPath);
            resolvedPath = path.join(
                parsed.dir,
                generateTimestampedFilename(parsed.name, parsed.ext.substring(1) || 'txt')
            );
        }

        // Check if file is writable
        const checkResult = await checkFileWritable(resolvedPath, { overwrite });
        if (!checkResult.writable) {
            throw new Error(`Write Text: ${checkResult.error}`);
        }

        // Ensure directory exists
        const dir = path.dirname(resolvedPath);
        await ensureDirectory(dir);

        // Get the content based on source
        let textContent = '';

        switch (content) {
            case 'dataset':
                if (!inputDataset) {
                    throw new Error('Write Text: Input dataset is required for dataset source');
                }
                textContent = formatDataForText(inputDataset, format, { includeHeader, delimiter });
                break;

            case 'variable':
                if (!variableName) {
                    throw new Error('Write Text: variableName is required for variable source');
                }
                const varValue = context.getVariable(variableName);
                if (varValue === undefined || varValue === null) {
                    throw new Error(`Write Text: Variable "${variableName}" not found or is empty`);
                }
                textContent = typeof varValue === 'object' 
                    ? JSON.stringify(varValue, null, 2)
                    : String(varValue);
                break;

            case 'custom':
                if (!customText) {
                    throw new Error('Write Text: customText is required for custom source');
                }
                textContent = customText;
                break;

            default:
                throw new Error(`Write Text: Unknown content source "${content}"`);
        }

        // ─── Interpolate variables in the content ──────────────────────────
        // Replace {{variable}} placeholders with actual variable values and
        // {{row.column}} with values from the first row of the input dataset
        const row0 = (inputDataset && inputDataset.rows && inputDataset.rows[0]) || null;
        if (context && context.interpolate) {
            textContent = context.interpolate(textContent, row0);
        } else {
            textContent = templateService.interpolate(textContent, (context && context.variables) || {}, { row: row0 });
        }

        // Write with appropriate encoding
        let writeContent = textContent;
        if (encoding === 'utf8-bom') {
            writeContent = '\uFEFF' + textContent;
        }

        await fs.promises.writeFile(resolvedPath, writeContent, encoding === 'utf8-bom' ? 'utf8' : encoding);

        // Track stats
        if (context && context.setActivityStats) {
            context.setActivityStats({
                filePath: resolvedPath,
                fileSize: Buffer.byteLength(writeContent, encoding),
                encoding: encoding,
                contentLength: textContent.length,
                lineCount: textContent.split('\n').length,
                contentFormat: format,
                contentSource: content
            });
        }

        return inputDataset;
    }
});

// ─── 5. Append to Text File Activity ────────────────────────────────────────
outputActivities.push({
    type: 'appendText',
    displayName: '📄 Append to Text File',
    description: 'Appends data to an existing text file (creates file if it doesn\'t exist).',
    category: 'Output',
    configRequirements: [
        {
            name: 'filePath',
            label: 'Text File Path',
            type: 'file',
            required: true,
            description: 'Absolute path or workspace-relative path of the text file to append to'
        },
        {
            name: 'content',
            label: 'Content Source',
            type: 'select',
            required: true,
            options: [
                { label: 'From Dataset (formatted)', value: 'dataset' },
                { label: 'From Variable', value: 'variable' },
                { label: 'Custom Text', value: 'custom' }
            ],
            description: 'Source of the content to append'
        },
        {
            name: 'variableName',
            label: 'Variable Name',
            type: 'string',
            required: false,
            description: 'Name of the variable containing the content (for variable source)'
        },
        {
            name: 'customText',
            label: 'Custom Text',
            type: 'text',
            required: false,
            description: 'Custom text content to append (for custom source)'
        },
        {
            name: 'format',
            label: 'Output Format',
            type: 'select',
            required: false,
            options: [
                { label: 'Plain (comma-separated)', value: 'plain' },
                { label: 'CSV', value: 'csv' },
                { label: 'JSON', value: 'json' },
                { label: 'Table', value: 'table' }
            ],
            description: 'Format for dataset output (default: plain)'
        },
        {
            name: 'includeHeader',
            label: 'Include Header',
            type: 'boolean',
            required: false,
            description: 'Include column headers in output (default: true)'
        },
        {
            name: 'delimiter',
            label: 'Delimiter',
            type: 'select',
            required: false,
            options: [
                { label: 'Comma (,)', value: ',' },
                { label: 'Semicolon (;)', value: ';' },
                { label: 'Tab (\\t)', value: '\t' },
                { label: 'Pipe (|)', value: '|' }
            ],
            description: 'Column delimiter for CSV format (default: comma)'
        },
        {
            name: 'addNewline',
            label: 'Add Newline',
            type: 'boolean',
            required: false,
            description: 'Add a newline before appending (default: true)'
        },
        {
            name: 'encoding',
            label: 'Encoding',
            type: 'select',
            required: false,
            options: [
                { label: 'UTF-8', value: 'utf8' },
                { label: 'UTF-8 with BOM', value: 'utf8-bom' },
                { label: 'ASCII', value: 'ascii' },
                { label: 'ISO-8859-1', value: 'latin1' }
            ],
            description: 'File encoding (default: UTF-8)'
        }
    ],
    async execute(config, context, inputDataset) {
        const {
            filePath,
            content = 'dataset',
            variableName,
            customText,
            format = 'plain',
            includeHeader = true,
            delimiter = DEFAULT_DELIMITER,
            addNewline = true,
            encoding = DEFAULT_ENCODING
        } = config;

        validateConfig({ filePath, content }, ['filePath', 'content'], 'Append Text');

        // Resolve file path
        const resolvedPath = context.resolvePath ? context.resolvePath(filePath) : filePath;

        // Ensure directory exists
        const dir = path.dirname(resolvedPath);
        await ensureDirectory(dir);

        // Get the content based on source
        let textContent = '';

        switch (content) {
            case 'dataset':
                if (!inputDataset) {
                    throw new Error('Append Text: Input dataset is required for dataset source');
                }
                textContent = formatDataForText(inputDataset, format, { includeHeader, delimiter });
                break;

            case 'variable':
                if (!variableName) {
                    throw new Error('Append Text: variableName is required for variable source');
                }
                const varValue = context.getVariable(variableName);
                if (varValue === undefined || varValue === null) {
                    throw new Error(`Append Text: Variable "${variableName}" not found or is empty`);
                }
                textContent = typeof varValue === 'object' 
                    ? JSON.stringify(varValue, null, 2)
                    : String(varValue);
                break;

            case 'custom':
                if (!customText) {
                    throw new Error('Append Text: customText is required for custom source');
                }
                textContent = customText;
                break;

            default:
                throw new Error(`Append Text: Unknown content source "${content}"`);
        }

        // ─── Interpolate variables in the content ──────────────────────────
        // Replace {{variable}} placeholders with actual variable values and
        // {{row.column}} with values from the first row of the input dataset
        const row0 = (inputDataset && inputDataset.rows && inputDataset.rows[0]) || null;
        if (context && context.interpolate) {
            textContent = context.interpolate(textContent, row0);
        } else {
            textContent = templateService.interpolate(textContent, (context && context.variables) || {}, { row: row0 });
        }

        // Check if file exists, if not create it
        let fileExists = false;
        try {
            await fs.promises.access(resolvedPath, fs.constants.F_OK);
            fileExists = true;
        } catch {
            // File doesn't exist, will create it
        }

        // Add newline if needed and file exists
        let writeContent = textContent;
        if (fileExists && addNewline) {
            // Check if file ends with newline
            const fileContent = await fs.promises.readFile(resolvedPath, 'utf8');
            if (fileContent.length > 0 && !fileContent.endsWith('\n')) {
                writeContent = '\n' + textContent;
            } else {
                writeContent = textContent;
            }
        }

        // Write with appropriate encoding
        let finalContent = writeContent;
        if (encoding === 'utf8-bom') {
            finalContent = '\uFEFF' + writeContent;
        }

        // Append to file
        await fs.promises.appendFile(resolvedPath, finalContent, encoding === 'utf8-bom' ? 'utf8' : encoding);

        // Track stats
        if (context && context.setActivityStats) {
            const stats = await fs.promises.stat(resolvedPath);
            context.setActivityStats({
                filePath: resolvedPath,
                fileSize: stats.size,
                encoding: encoding,
                appendedLength: textContent.length,
                contentFormat: format,
                contentSource: content,
                fileExisted: fileExists
            });
        }

        return inputDataset;
    }
});

module.exports = outputActivities;
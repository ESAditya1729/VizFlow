/**
 * engine/workflow/activities/inputActivities.js
 *
 * Input activities for reading data from various file formats.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const csvParser = require('../../../services/csvParser');
const Dataset = require('../../dataset');
const XLSX = require('xlsx');

// ─── Constants ──────────────────────────────────────────────────────────────
const DEFAULT_ENCODING = 'utf8';
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const SUPPORTED_CSV_DELIMITERS = [',', ';', '\t', '|'];
const EXCEL_SERIAL_MIN = 1;
const EXCEL_SERIAL_MAX = 50000;

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Validate file exists and is readable
 * @param {string} filePath - Path to file
 * @param {number} maxSize - Maximum file size in bytes
 * @returns {Promise<{ exists: boolean, size: number, error?: string }>}
 */
async function validateFile(filePath, maxSize = MAX_FILE_SIZE) {
    try {
        const stats = await fs.promises.stat(filePath);
        if (!stats.isFile()) {
            return { exists: false, size: 0, error: 'Path is not a file' };
        }
        if (stats.size === 0) {
            return { exists: true, size: 0, error: 'File is empty' };
        }
        if (stats.size > maxSize) {
            return { 
                exists: true, 
                size: stats.size, 
                error: `File size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum (${maxSize / 1024 / 1024}MB)` 
            };
        }
        return { exists: true, size: stats.size };
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { exists: false, size: 0, error: 'File not found' };
        }
        return { exists: false, size: 0, error: error.message };
    }
}

/**
 * Convert Excel serial number to date string
 * @param {number} serial - Excel serial number
 * @param {string} format - Date format (default: 'MM/DD/YYYY')
 * @returns {string} Formatted date string
 */
function excelSerialToDate(serial, format = 'MM/DD/YYYY') {
    const daysSince1970 = serial - 25569;
    const milliseconds = daysSince1970 * 86400000;
    const dateObj = new Date(milliseconds);
    
    const month = dateObj.getUTCMonth() + 1;
    const day = dateObj.getUTCDate();
    const year = dateObj.getUTCFullYear();
    
    if (year < 1900 || year > 2100) {
        return String(serial);
    }
    
    switch (format) {
        case 'YYYY-MM-DD':
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        case 'DD/MM/YYYY':
            return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
        case 'MM-DD-YYYY':
            return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${year}`;
        case 'DD-MM-YYYY':
            return `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`;
        case 'MM/DD/YYYY':
        default:
            return `${month}/${day}/${year}`;
    }
}

/**
 * Check if a value is an Excel date serial number
 * @param {*} val - Value to check
 * @returns {boolean} True if value is an Excel date serial
 */
function isExcelDateSerial(val) {
    if (typeof val !== 'number') return false;
    if (isNaN(val)) return false;
    return val >= EXCEL_SERIAL_MIN && val <= EXCEL_SERIAL_MAX;
}

/**
 * Clean column name - remove extra spaces, normalize
 * @param {string} name - Raw column name
 * @param {number} index - Column index
 * @returns {string} Cleaned column name
 */
function cleanColumnName(name, index) {
    if (!name || typeof name !== 'string') {
        return `Column_${String.fromCharCode(65 + index)}`;
    }
    // Remove extra spaces, trim, and normalize
    let cleaned = name.trim();
    // Replace multiple spaces with single space
    cleaned = cleaned.replace(/\s+/g, ' ');
    if (cleaned.length === 0) {
        return `Column_${String.fromCharCode(65 + index)}`;
    }
    return cleaned;
}

/**
 * Find column by name with fuzzy matching
 * @param {Array<string>} columns - Array of column names
 * @param {string} targetName - Target column name to find
 * @returns {string|null} Found column name or null
 */
function _findColumnFuzzy(columns, targetName) {
    if (!columns || !targetName) return null;
    
    // Exact match (case insensitive)
    const exactMatch = columns.find(col => col.toLowerCase() === targetName.toLowerCase());
    if (exactMatch) return exactMatch;
    
    // Trim and normalize match
    const normalizedTarget = targetName.trim().replace(/\s+/g, ' ');
    const normalizedMatch = columns.find(col => {
        const normalizedCol = col.trim().replace(/\s+/g, ' ');
        return normalizedCol.toLowerCase() === normalizedTarget.toLowerCase();
    });
    if (normalizedMatch) return normalizedMatch;
    
    // Contains match (for partial matches)
    const containsMatch = columns.find(col => {
        const colLower = col.toLowerCase().trim();
        const targetLower = targetName.toLowerCase().trim();
        return colLower.includes(targetLower) || targetLower.includes(colLower);
    });
    if (containsMatch) return containsMatch;
    
    // Remove common prefixes/suffixes and try again
    const cleanTarget = targetName.replace(/^(Date|Column|Field|Value)_?/i, '').trim();
    if (cleanTarget !== targetName) {
        return _findColumnFuzzy(columns, cleanTarget);
    }
    
    return null;
}

/**
 * Detect CSV delimiter from file content
 * @param {string} content - First few lines of CSV content
 * @returns {string} Detected delimiter
 */
function detectDelimiter(content) {
    if (!content || content.length === 0) return ',';
    
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    if (lines.length === 0) return ',';
    
    const firstLine = lines[0];
    const counts = {};
    
    for (const delimiter of SUPPORTED_CSV_DELIMITERS) {
        counts[delimiter] = (firstLine.match(new RegExp(delimiter, 'g')) || []).length;
    }
    
    let maxCount = 0;
    let detectedDelimiter = ',';
    for (const [delimiter, count] of Object.entries(counts)) {
        if (count > maxCount) {
            maxCount = count;
            detectedDelimiter = delimiter;
        }
    }
    
    return detectedDelimiter;
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

// ─── Activity Definitions ──────────────────────────────────────────────────

const inputActivities = [];

// ─── 1. Read CSV Activity ────────────────────────────────────────────────────
inputActivities.push({
    type: 'readCsv',
    displayName: '📥 Read CSV',
    description: 'Reads a CSV file into a Dataset from a local file path.',
    category: 'Input',
    configRequirements: [
        {
            name: 'filePath',
            label: 'CSV File Path',
            type: 'file',
            required: true,
            description: 'Absolute path or workspace-relative path of the CSV file'
        },
        {
            name: 'delimiter',
            label: 'Delimiter',
            type: 'select',
            required: false,
            options: [
                { label: 'Auto-detect', value: 'auto' },
                { label: 'Comma (,)', value: ',' },
                { label: 'Semicolon (;)', value: ';' },
                { label: 'Tab (\\t)', value: '\t' },
                { label: 'Pipe (|)', value: '|' }
            ],
            description: 'Column delimiter (default: auto-detect)'
        },
        {
            name: 'hasHeader',
            label: 'Has Header Row',
            type: 'boolean',
            required: false,
            description: 'First row contains column headers (default: true)'
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
            name: 'skipRows',
            label: 'Skip Rows',
            type: 'number',
            required: false,
            description: 'Number of rows to skip at the beginning (default: 0)'
        },
        {
            name: 'limitRows',
            label: 'Limit Rows',
            type: 'number',
            required: false,
            description: 'Maximum number of rows to read (0 = unlimited)'
        }
    ],
    async execute(config, context, _inputDataset) {
        const {
            filePath,
            delimiter = 'auto',
            hasHeader = true,
            encoding = DEFAULT_ENCODING,
            skipRows = 0,
            limitRows = 0
        } = config;

        validateConfig({ filePath }, ['filePath'], 'Read CSV');

        const resolvedPath = context.resolvePath ? context.resolvePath(filePath) : filePath;

        const fileValidation = await validateFile(resolvedPath);
        if (!fileValidation.exists) {
            throw new Error(`Read CSV: ${fileValidation.error} - ${filePath}`);
        }

        let content;
        try {
            const rawContent = await fs.promises.readFile(resolvedPath, encoding === 'utf8-bom' ? 'utf8' : encoding);
            content = rawContent.toString();
            if (content.charCodeAt(0) === 0xFEFF) {
                content = content.slice(1);
            }
        } catch (error) {
            throw new Error(`Read CSV: Failed to read file - ${error.message}`);
        }

        let usedDelimiter = delimiter;
        if (delimiter === 'auto') {
            usedDelimiter = detectDelimiter(content);
        }

        let dataset;
        try {
            const parseOptions = {
                delimiter: usedDelimiter,
                hasHeader: hasHeader,
                skipRows: skipRows,
                limitRows: limitRows > 0 ? limitRows : undefined
            };
            dataset = csvParser.parse(content, parseOptions);
        } catch (error) {
            throw new Error(`Read CSV: Failed to parse CSV - ${error.message}`);
        }

        if (context && context.setActivityStats) {
            context.setActivityStats({
                outputRowCount: dataset.getRowCount(),
                columnCount: dataset.getColumns().length,
                fileSize: fileValidation.size,
                delimiter: usedDelimiter === '\t' ? 'tab' : usedDelimiter,
                hasHeader: hasHeader,
                encoding: encoding,
                filePath: resolvedPath
            });
        }

        return dataset;
    }
});

// ─── 2. Read Excel Activity ───────────────────────────────────────────────────
inputActivities.push({
    type: 'readExcel',
    displayName: '📊 Read Excel',
    description: 'Reads an Excel file (.xlsx, .xls) into a Dataset with flexible options.',
    category: 'Input',
    configRequirements: [
        {
            name: 'filePath',
            label: 'Excel File Path',
            type: 'file',
            required: true,
            description: 'Absolute or workspace-relative path to the Excel file'
        },
        {
            name: 'sheetName',
            label: 'Sheet Name',
            type: 'string',
            required: false,
            description: 'Name of the sheet to read (default: first sheet)',
            placeholder: 'e.g., Sheet1'
        },
        {
            name: 'headerRow',
            label: 'Header Row Number',
            type: 'number',
            required: false,
            defaultValue: 1,
            description: 'Row number containing column headers (1-based)'
        },
        {
            name: 'startRow',
            label: 'Start Row Number',
            type: 'number',
            required: false,
            defaultValue: 2,
            description: 'Row number to start reading data from (1-based)'
        },
        {
            name: 'hasHeader',
            label: 'Has Header Row',
            type: 'boolean',
            required: false,
            description: 'Row specified in headerRow contains column headers (default: true)'
        },
        {
            name: 'skipEmptyRows',
            label: 'Skip Empty Rows',
            type: 'boolean',
            required: false,
            description: 'Skip rows that are completely empty (default: true)'
        },
        {
            name: 'skipFooterRows',
            label: 'Skip Footer Rows',
            type: 'number',
            required: false,
            description: 'Number of rows to skip at the bottom (default: 0)'
        },
        {
            name: 'dateFormat',
            label: 'Date Format',
            type: 'select',
            required: false,
            options: [
                { label: 'MM/DD/YYYY', value: 'MM/DD/YYYY' },
                { label: 'YYYY-MM-DD', value: 'YYYY-MM-DD' },
                { label: 'DD/MM/YYYY', value: 'DD/MM/YYYY' },
                { label: 'MM-DD-YYYY', value: 'MM-DD-YYYY' },
                { label: 'DD-MM-YYYY', value: 'DD-MM-YYYY' }
            ],
            description: 'Format for converting Excel dates (default: MM/DD/YYYY)'
        },
        {
            name: 'dateDetection',
            label: 'Auto-detect Dates',
            type: 'boolean',
            required: false,
            description: 'Automatically detect and convert date columns (default: true)'
        }
    ],
    async execute(config, context, _inputDataset) {
        const {
            filePath,
            sheetName,
            dateFormat = 'MM/DD/YYYY'
        } = config;

        const headerRow = parseInt(config.headerRow !== undefined ? config.headerRow : 1, 10);
        const startRow = parseInt(config.startRow !== undefined ? config.startRow : 2, 10);
        const skipFooterRows = parseInt(config.skipFooterRows !== undefined ? config.skipFooterRows : (config.skipFooter !== undefined ? config.skipFooter : 0), 10) || 0;
        const hasHeader = config.hasHeader === true || config.hasHeader === 'true' || config.hasHeader === undefined;
        const skipEmptyRows = config.skipEmptyRows === true || config.skipEmptyRows === 'true' || config.skipEmptyRows === undefined;
        const dateDetection = config.dateDetection === true || config.dateDetection === 'true' || config.dateDetection === undefined;

        validateConfig({ filePath }, ['filePath'], 'Read Excel');

        const resolvedPath = context.resolvePath ? context.resolvePath(filePath) : filePath;

        const fileValidation = await validateFile(resolvedPath);
        if (!fileValidation.exists) {
            throw new Error(`Read Excel: ${fileValidation.error} - ${filePath}`);
        }

        const ext = path.extname(resolvedPath).toLowerCase();
        if (!['.xlsx', '.xls', '.xlsm'].includes(ext)) {
            throw new Error(`Read Excel: Unsupported file format "${ext}". Supported: .xlsx, .xls, .xlsm`);
        }

        let workbook;
        try {
            workbook = XLSX.readFile(resolvedPath, { cellDates: false, raw: true });
        } catch (error) {
            throw new Error(`Read Excel: Failed to read file - ${error.message}`);
        }

        let sheet = workbook.Sheets[sheetName];
        if (!sheet) {
            const firstSheetName = workbook.SheetNames[0];
            if (!firstSheetName) {
                throw new Error('Read Excel: No sheets found in the Excel file');
            }
            sheet = workbook.Sheets[firstSheetName];
            if (!sheet) {
                throw new Error('Read Excel: Failed to read sheet data');
            }
        }

        let rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });

        if (!rows || rows.length === 0) {
            throw new Error('Read Excel: No data found in the Excel file');
        }

        // ─── Extract header ────────────────────────────────────────────────────
        const headerIdx = headerRow - 1;
        let headerRowData = null;
        if (hasHeader && headerIdx >= 0 && headerIdx < rows.length) {
            headerRowData = rows[headerIdx];
        }

        // ─── Extract data rows ─────────────────────────────────────────────────
        const startIdx = startRow - 1;
        let dataRows = [];

        for (let i = startIdx; i < rows.length; i++) {
            if (hasHeader && i === headerIdx) continue;
            
            const row = rows[i] || [];
            
            if (skipEmptyRows) {
                const hasData = row.some(cell => cell !== null && cell !== undefined && cell !== '');
                if (!hasData) continue;
            }
            
            dataRows.push(row);
        }

        if (skipFooterRows > 0 && dataRows.length > 0) {
            dataRows = dataRows.slice(0, dataRows.length - Math.min(skipFooterRows, dataRows.length));
        }

        if (dataRows.length === 0) {
            throw new Error('Read Excel: No data rows found after applying filters');
        }

        // ─── Build columns ─────────────────────────────────────────────────────
        let columns = [];

        if (headerRowData && hasHeader) {
            columns = headerRowData.map((h, idx) => cleanColumnName(h, idx));
        } else {
            const maxCols = dataRows.reduce((max, row) => Math.max(max, row.length), 0);
            columns = [];
            for (let i = 0; i < maxCols; i++) {
                columns.push(String.fromCharCode(65 + i));
            }
        }

        // Log columns for debugging
        console.log('[VizFlow] Read Excel columns:', columns);

        // ─── Convert to Dataset ────────────────────────────────────────────────
        const rowObjects = dataRows.map(row => {
            const obj = {};
            columns.forEach((col, idx) => {
                let val = row[idx];
                
                if (val === undefined || val === null) {
                    obj[col] = null;
                    return;
                }
                
                if (dateDetection) {
                    const isDateColumn = /date|day|month|year|timestamp|time|check|reconciled|period/i.test(col);
                    
                    if (isExcelDateSerial(val) && (isDateColumn || val >= 30000)) {
                        try {
                            const dateStr = excelSerialToDate(val, dateFormat);
                            obj[col] = dateStr;
                            return;
                        } catch {
                            obj[col] = val;
                            return;
                        }
                    }
                    
                    if (val instanceof Date && !isNaN(val.getTime())) {
                        const dateStr = excelSerialToDate(
                            (val.getTime() / 86400000) + 25569,
                            dateFormat
                        );
                        obj[col] = dateStr;
                        return;
                    }
                }
                
                if (typeof val === 'number' && !isNaN(val)) {
                    obj[col] = val;
                } else if (typeof val === 'boolean') {
                    obj[col] = val;
                } else if (typeof val === 'string') {
                    obj[col] = val.trim();
                } else {
                    obj[col] = val;
                }
            });
            return obj;
        });

        const outputDataset = new Dataset(rowObjects, columns);

        // Store column mapping for debug
        if (context && context.setActivityStats) {
            context.setActivityStats({
                outputRowCount: outputDataset.getRowCount(),
                columnCount: columns.length,
                sheetName: sheetName || workbook.SheetNames[0] || 'default',
                headerRow: headerRow,
                startRow: startRow,
                skipFooterRows: skipFooterRows,
                fileSize: fileValidation.size,
                hasHeader: hasHeader,
                dateFormat: dateFormat,
                columns: columns.join(', ')
            });
        }

        return outputDataset;
    }
});

// ─── 3. Sample Data Activity ─────────────────────────────────────────────────
inputActivities.push({
    type: 'sampleData',
    displayName: '🎲 Sample Data',
    description: 'Creates a sample dataset for testing purposes.',
    category: 'Input',
    configRequirements: [
        {
            name: 'rowCount',
            label: 'Number of Rows',
            type: 'number',
            required: false,
            defaultValue: 10,
            description: 'Number of sample rows to generate (default: 10)'
        },
        {
            name: 'columns',
            label: 'Columns',
            type: 'string',
            required: false,
            description: 'Comma-separated column names (default: id, name, value, category, date)'
        }
    ],
    async execute(config, context, _inputDataset) {
        const { rowCount = 10, columns = 'id,name,value,category,date' } = config;

        if (rowCount < 1) {
            throw new Error('Sample Data: "rowCount" must be at least 1');
        }

        if (rowCount > 10000) {
            throw new Error('Sample Data: "rowCount" cannot exceed 10000');
        }

        const columnList = columns.split(',').map(c => c.trim()).filter(c => c.length > 0);
        if (columnList.length === 0) {
            throw new Error('Sample Data: No valid columns specified');
        }

        const sampleData = [];
        const categories = ['A', 'B', 'C', 'D', 'E'];
        const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];

        for (let i = 0; i < rowCount; i++) {
            const row = {};
            for (const col of columnList) {
                switch (col.toLowerCase()) {
                    case 'id':
                    case 'index':
                        row[col] = i + 1;
                        break;
                    case 'name':
                        row[col] = names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : '');
                        break;
                    case 'value':
                    case 'amount':
                    case 'price':
                    case 'score':
                        row[col] = Math.round((Math.random() * 100) * 100) / 100;
                        break;
                    case 'category':
                    case 'type':
                        row[col] = categories[i % categories.length];
                        break;
                    case 'date':
                        const date = new Date(2024, 0, 1 + i);
                        row[col] = date.toISOString().split('T')[0];
                        break;
                    case 'active':
                    case 'enabled':
                        row[col] = i % 2 === 0;
                        break;
                    default:
                        row[col] = `value_${i + 1}`;
                }
            }
            sampleData.push(row);
        }

        const outputDataset = new Dataset(sampleData, columnList);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                outputRowCount: outputDataset.getRowCount(),
                columnCount: columnList.length,
                rowCount: rowCount,
                columns: columnList.join(', ')
            });
        }

        return outputDataset;
    }
});

module.exports = inputActivities;
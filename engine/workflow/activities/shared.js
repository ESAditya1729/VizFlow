/**
 * engine/workflow/activities/shared.js
 *
 * Shared helper utilities used by multiple activity modules.
 * Extracted to eliminate duplication across input/output/xml/ps/database/http
 * activity files.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Constants ──────────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// ─── validateConfig ─────────────────────────────────────────────────────────

/**
 * Validate that required config fields are present and non-empty.
 * Rejects `undefined`, `null`, and blank strings (empty or whitespace-only).
 * @param {Object} config - Configuration object
 * @param {Array<string>} required - Array of required field names
 * @param {string} activityName - Activity name for error messages
 * @throws {Error} If a required field is missing or blank
 */
function validateConfig(config, required, activityName) {
    for (const field of required) {
        const value = config[field];
        if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
            throw new Error(`${activityName}: "${field}" is required`);
        }
    }
}

// ─── validateFile ───────────────────────────────────────────────────────────

/**
 * Validate that a file exists, is readable, and does not exceed a size limit.
 * @param {string} filePath - Absolute path to the file
 * @param {number} [maxSize=MAX_FILE_SIZE] - Maximum allowed file size in bytes
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

// ─── ensureDirectory ────────────────────────────────────────────────────────

/**
 * Create a directory (and all parents) if it does not already exist.
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

// ─── checkFileWritable ──────────────────────────────────────────────────────

/**
 * Check whether a file is safe to write (exists + overwrite flag, parent dir writable).
 * @param {string} filePath - File path to check
 * @param {{ overwrite?: boolean, maxSize?: number }} [options]
 * @returns {Promise<{ writable: boolean, error?: string, warning?: string }>}
 */
async function checkFileWritable(filePath, options = {}) {
    const { overwrite = true, maxSize = MAX_FILE_SIZE } = options;

    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        if (!overwrite) {
            return { writable: false, error: `File "${path.basename(filePath)}" already exists and overwrite is disabled` };
        }
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

// ─── findColumnFuzzy ─────────────────────────────────────────────────────────

/**
 * Find a column by name with fuzzy matching (exact, whitespace-normalized,
 * contains, underscore/space swaps, common prefix stripping).
 * @param {Array<string>} columns - Array of column names
 * @param {string} targetName - Target column name to find
 * @returns {string|null} Found column name or null
 */
function findColumnFuzzy(columns, targetName) {
    if (!columns || !targetName || columns.length === 0) return null;

    const targetLower = targetName.toLowerCase().trim();

    // 1. Exact match (case insensitive)
    for (const col of columns) {
        if (col.toLowerCase() === targetLower) {
            return col;
        }
    }

    // 2. Trim and normalize match (handle extra spaces)
    const normalizedTarget = targetLower.replace(/\s+/g, ' ');
    for (const col of columns) {
        const normalizedCol = col.toLowerCase().trim().replace(/\s+/g, ' ');
        if (normalizedCol === normalizedTarget) {
            return col;
        }
    }

    // 3. Contains match (for partial matches)
    for (const col of columns) {
        const colLower = col.toLowerCase().trim();
        if (colLower.includes(targetLower) || targetLower.includes(colLower)) {
            return col;
        }
    }

    // 4. Replace underscores with spaces
    const withSpaces = targetLower.replace(/_/g, ' ');
    if (withSpaces !== targetLower) {
        for (const col of columns) {
            if (col.toLowerCase().trim().replace(/\s+/g, ' ') === withSpaces.replace(/\s+/g, ' ')) {
                return col;
            }
        }
    }

    // 5. Replace spaces with underscores
    const withUnderscores = targetLower.replace(/ /g, '_');
    if (withUnderscores !== targetLower) {
        for (const col of columns) {
            if (col.toLowerCase() === withUnderscores) {
                return col;
            }
        }
    }

    // 6. Remove common prefixes/suffixes
    const cleanTarget = targetLower.replace(/^(date|column|field|value)_?/i, '').trim();
    if (cleanTarget !== targetLower && cleanTarget.length > 0) {
        for (const col of columns) {
            const colLower = col.toLowerCase().trim();
            const cleanCol = colLower.replace(/^(date|column|field|value)_?/i, '').trim();
            if (cleanCol === cleanTarget) {
                return col;
            }
            if (colLower.includes(cleanTarget) || cleanTarget.includes(colLower)) {
                return col;
            }
        }
    }

    return null;
}

// ─── isNumeric ───────────────────────────────────────────────────────────────

/**
 * Check if a value is numeric.
 * @param {*} value - Value to check
 * @returns {boolean} True if value is numeric
 */
function isNumeric(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'number') return !isNaN(value);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return false;
        return !isNaN(trimmed) && !isNaN(parseFloat(trimmed));
    }
    return false;
}

// ─── validateColumn ──────────────────────────────────────────────────────────

/**
 * Validate a column exists in a dataset with fuzzy matching, returning the
 * actual column name (or original when an exact match exists) and throwing a
 * descriptive error listing available columns when it cannot be found.
 * @param {Dataset} dataset - Input dataset
 * @param {string} column - Column name to validate
 * @param {string} activityName - Activity name for error messages
 * @returns {string} The actual column name found
 * @throws {Error} If column not found
 */
function validateColumn(dataset, column, activityName) {
    const columns = dataset.getColumns();

    // Try exact match first
    if (columns.includes(column)) {
        return column;
    }

    // Try fuzzy match
    const foundColumn = findColumnFuzzy(columns, column);
    if (foundColumn) {
        console.log(`[VizFlow] Column "${column}" mapped to "${foundColumn}"`);
        return foundColumn;
    }

    // If still not found, throw with available columns
    const availableColumns = columns.map(c => `"${c}"`).join(', ');
    throw new Error(`${activityName}: Column "${column}" not found. Available columns: ${availableColumns}`);
}

// ─── generateTimestampedFilename ─────────────────────────────────────────────

/**
 * Generate a filename with an ISO timestamp suffix to avoid overwriting.
 * @param {string} baseName - Base filename without extension
 * @param {string} extension - File extension (e.g. 'csv', 'json')
 * @returns {string} Filename with timestamp, e.g. "report_2026-08-12T143000.csv"
 */
function generateTimestampedFilename(baseName, extension) {
    const timestamp = new Date().toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
    return `${baseName}_${timestamp}.${extension}`;
}

module.exports = {
    MAX_FILE_SIZE,
    validateConfig,
    validateFile,
    ensureDirectory,
    checkFileWritable,
    generateTimestampedFilename,
    findColumnFuzzy,
    isNumeric,
    validateColumn
};

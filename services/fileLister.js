/**
 * services/fileLister.js
 *
 * Cross-platform, dependency-free file listing used by workflow activities
 * (listFiles, forEachFile). Replaces the previous PowerShell-only
 * Get-ChildItem approach so file enumeration works on Windows, macOS, and
 * Linux alike.
 *
 * Returns file entries in the same shape PowerShell's ConvertTo-Csv produced:
 *   { FullName, Name, Extension, DirectoryName, Length?, LastWriteTime? }
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_FILES = 10000;

/**
 * Convert a glob-style pattern ("*report*.xlsx", "*.csv") into a RegExp.
 * Supports '*' (any run of chars) and '?' (a single char). Matching is
 * case-insensitive to mirror PowerShell's `-like` semantics on Windows.
 * @param {string} pattern
 * @returns {RegExp}
 */
function globToRegExp(pattern) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Test a file name against a list of glob filters. Empty/missing filters
 * match everything.
 * @param {string} name
 * @param {string[]} filters
 * @returns {boolean}
 */
function matchesFilter(name, filters) {
    if (!filters || filters.length === 0) return true;
    return filters.some((f) => {
        const pattern = String(f).trim();
        if (!pattern) return false;
        return globToRegExp(pattern).test(name);
    });
}

/**
 * Split a comma-separated filter string into trimmed glob filters.
 * @param {string|string[]|undefined} filter
 * @returns {string[]}
 */
function normalizeFilters(filter) {
    if (!filter) return [];
    if (Array.isArray(filter)) return filter.map((f) => String(f).trim()).filter(Boolean);
    return String(filter)
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
}

/**
 * Read metadata for a file path (size + modified timestamp).
 * Best-effort: returns {} if stat fails.
 * @param {string} fullPath
 * @returns {Promise<{ Length: number, LastWriteTime: string }>}
 */
async function readMetadata(fullPath) {
    try {
        const stats = await fs.promises.stat(fullPath);
        return {
            Length: stats.size,
            LastWriteTime: stats.mtime.toISOString()
        };
    } catch {
        return {};
    }
}

/**
 * Recursively walk a directory collecting matching file entries.
 * @param {string} dir
 * @param {Object} options
 * @param {string[]} options.filters - Glob filters ([] = all)
 * @param {boolean} options.recursive
 * @param {boolean} options.includeMetadata
 * @param {Set<string>} options.excludeFolders - Lower-cased folder names to skip
 * @param {number} options.maxFiles - 0 = unlimited
 * @param {Array<Object>} results - Shared accumulator
 * @returns {Promise<void>}
 */
async function walkDirectory(dir, options, results) {
    let entries;
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        if (options.maxFiles > 0 && results.length >= options.maxFiles) return;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (options.excludeFolders.has(entry.name.toLowerCase())) continue;
            if (options.recursive) {
                await walkDirectory(fullPath, options, results);
            }
            continue;
        }

        if (!entry.isFile()) continue;
        if (!matchesFilter(entry.name, options.filters)) continue;

        const entryRecord = {
            FullName: fullPath,
            Name: entry.name,
            Extension: path.extname(entry.name),
            DirectoryName: dir
        };

        if (options.includeMetadata) {
            Object.assign(entryRecord, await readMetadata(fullPath));
        }

        results.push(entryRecord);
    }
}

/**
 * List files in a folder (cross-platform).
 * @param {Object} options
 * @param {string} options.folderPath - Absolute folder path
 * @param {string|string[]|undefined} options.filter - Glob filter(s), comma-separated or array
 * @param {boolean} [options.recursive=false]
 * @param {boolean} [options.includeMetadata=true]
 * @param {string|string[]|undefined} [options.excludeFolders] - Folder names to skip
 * @param {number} [options.maxFiles=0] - 0 = unlimited
 * @returns {Promise<Array<Object>>} File entry records
 */
async function listFiles(options = {}) {
    const {
        folderPath,
        filter,
        recursive = false,
        includeMetadata = true,
        excludeFolders,
        maxFiles = 0
    } = options;

    const absoluteFolder = path.resolve(folderPath);
    const filters = normalizeFilters(filter);

    const excludeSet = new Set(
        normalizeFilters(excludeFolders).map((f) => f.toLowerCase())
    );

    const results = [];
    await walkDirectory(absoluteFolder, {
        filters,
        recursive,
        includeMetadata,
        excludeFolders: excludeSet,
        maxFiles: maxFiles > 0 ? maxFiles : DEFAULT_MAX_FILES
    }, results);

    return results;
}

module.exports = {
    listFiles,
    normalizeFilters,
    globToRegExp
};
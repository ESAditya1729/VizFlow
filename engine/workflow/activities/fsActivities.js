/**
 * engine/workflow/activities/fsActivities.js
 *
 * Filesystem activities that are platform-independent (no PowerShell needed).
 *
 * listFiles was originally part of powerShellActivities.js — it has been
 * extracted here and rewritten on native Node fs, so it works identically on
 * Windows, macOS, and Linux, and no longer requires PowerShell.
 */

'use strict';

const fs = require('fs');
const Dataset = require('../../dataset');
const fileLister = require('../../../services/fileLister');
const { validateConfig } = require('./shared');

const fsActivities = [];

// ─── 1. List Files in Folder ────────────────────────────────────────────────
fsActivities.push({
    type: 'listFiles',
    displayName: '📂 List Files in Folder',
    description: 'Lists files in a specified folder with optional filters.',
    category: 'Input',
    configRequirements: [
        {
            name: 'folderPath',
            label: 'Folder Path',
            type: 'file',
            required: true,
            description: 'Path to the folder to list files from'
        },
        {
            name: 'filter',
            label: 'File Filter',
            type: 'string',
            required: false,
            description: 'File pattern to filter (e.g., "*.csv", "*report*.xlsx")',
            placeholder: '*.csv'
        },
        {
            name: 'recursive',
            label: 'Include Subfolders',
            type: 'boolean',
            required: false,
            description: 'Search recursively in subfolders (default: false)'
        },
        {
            name: 'includeMetadata',
            label: 'Include File Metadata',
            type: 'boolean',
            required: false,
            description: 'Include file size, modified date, etc. (default: true)'
        },
        {
            name: 'excludeFolders',
            label: 'Exclude Folders',
            type: 'string',
            required: false,
            description: 'Comma-separated folder names to exclude (e.g., "temp,archive")'
        }
    ],
    async execute(config, context, _inputDataset) {
        const {
            folderPath,
            filter = '*',
            recursive = false,
            includeMetadata = true,
            excludeFolders = ''
        } = config;

        validateConfig({ folderPath }, ['folderPath'], 'List Files');

        const resolvedPath = context.resolvePath ? context.resolvePath(folderPath) : folderPath;

        let stat;
        try {
            stat = await fs.promises.stat(resolvedPath);
        } catch {
            throw new Error(`List Files activity: Folder not found or not accessible: ${resolvedPath}`);
        }
        if (!stat.isDirectory()) {
            throw new Error(`List Files activity: Path is not a folder: ${resolvedPath}`);
        }

        let files;
        try {
            files = await fileLister.listFiles({
                folderPath: resolvedPath,
                filter,
                recursive,
                includeMetadata,
                excludeFolders
            });
        } catch (error) {
            throw new Error(`List Files activity: Failed to list files - ${error.message}`);
        }

        const columns = [
            'FullName',
            'Name',
            'Extension',
            'DirectoryName',
            ...(includeMetadata ? ['Length', 'LastWriteTime'] : [])
        ];

        const rows = files.map((file) => {
            const row = { FullName: file.FullName, Name: file.Name, Extension: file.Extension, DirectoryName: file.DirectoryName };
            if (includeMetadata) {
                row.Length = file.Length;
                row.LastWriteTime = file.LastWriteTime;
            }
            return row;
        });

        const dataset = new Dataset(rows, columns);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                folderPath: resolvedPath,
                filter: filter,
                recursive: recursive,
                fileCount: rows.length,
                includeMetadata: includeMetadata
            });
        }

        return dataset;
    }
});

module.exports = fsActivities;
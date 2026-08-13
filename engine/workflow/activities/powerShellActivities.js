/**
 * engine/workflow/activities/powerShellActivities.js
 *
 * PowerShell integration activities for VizFlow.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const Dataset = require('../../dataset');

// ─── Lazy load PowerShellService to avoid initialization issues ────────────
let PowerShellService = null;

function getPowerShellService() {
    if (!PowerShellService) {
        try {
            PowerShellService = require('../../../services/powerShellService');
        } catch (error) {
            console.error('[VizFlow] Failed to load PowerShellService:', error.message);
            throw new Error('PowerShell service is not available. Please ensure PowerShell is installed.');
        }
    }
    return PowerShellService;
}

const powerShellActivities = [];

// ─── Helper Functions ──────────────────────────────────────────────────────

/**
 * Parse CSV line with quoted values
 */
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    
    return result.map(v => v.replace(/^"|"$/g, '').trim());
}

/**
 * Validate config with required fields
 */
function validateConfig(config, required, activityName) {
    for (const field of required) {
        if (config[field] === undefined || config[field] === null || config[field] === '') {
            throw new Error(`${activityName}: "${field}" is required`);
        }
    }
}

// ─── 1. List Files in Folder ────────────────────────────────────────────────
powerShellActivities.push({
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

        // Check if folder exists
        try {
            await fs.promises.access(resolvedPath, fs.constants.R_OK);
        } catch {
            throw new Error(`List Files activity: Folder not found or not accessible: ${resolvedPath}`);
        }

        // Get PowerShellService
        const PSService = getPowerShellService();
        const powerShell = new PSService({
            workingDirectory: context.resolvePath ? context.resolvePath('.') : (process.cwd ? process.cwd() : '.')
        });

        // Build PowerShell command with proper path escaping
        let psCommand = `Get-ChildItem -Path '${resolvedPath.replace(/\\/g, '\\\\')}'`;

        if (filter && filter !== '*') {
            const filters = filter.split(',').map(f => f.trim());
            if (filters.length === 1) {
                psCommand += ` -Filter '${filters[0]}'`;
            } else {
                const filterConditions = filters.map(f => `($_.Name -like '${f}')`).join(' -or ');
                psCommand += ` | Where-Object { ${filterConditions} }`;
            }
        }

        if (recursive) {
            psCommand += ' -Recurse';
        }

        // Exclude folders
        if (excludeFolders) {
            const excludeList = excludeFolders.split(',').map(f => f.trim()).filter(f => f.length > 0);
            if (excludeList.length > 0) {
                psCommand += ` | Where-Object { -not ($_.PSIsContainer -and ('${excludeList.join("','")}' -contains $_.Name)) }`;
            }
        }

        // Include only files (not folders)
        psCommand += ' | Where-Object { -not $_.PSIsContainer }';

        // Select properties
        if (includeMetadata) {
            psCommand += ' | Select-Object FullName, Name, Length, LastWriteTime, Extension, DirectoryName';
        } else {
            psCommand += ' | Select-Object FullName, Name';
        }

        // Convert to CSV for easy parsing
        psCommand += ' | ConvertTo-Csv -NoTypeInformation';

        // Execute PowerShell
        const result = await powerShell.executeCommand(psCommand);

        if (!result.success) {
            throw new Error(`PowerShell execution failed: ${result.stderr || result.stdout}`);
        }

        // Parse CSV output
        const lines = result.stdout.split('\n').filter(line => line.trim().length > 0);
        if (lines.length < 2) {
            return new Dataset([], ['FullName', 'Name']);
        }

        const header = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
        const rows = lines.slice(1).map(line => {
            const values = parseCSVLine(line);
            const row = {};
            header.forEach((col, idx) => {
                row[col] = values[idx] !== undefined ? values[idx] : '';
            });
            return row;
        });

        const dataset = new Dataset(rows, header);

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

// ─── 2. Execute PowerShell Script ───────────────────────────────────────────
powerShellActivities.push({
    type: 'execPowerShell',
    displayName: '⚡ Execute PowerShell Script',
    description: 'Executes a PowerShell script file or command.',
    category: 'Control',
    configRequirements: [
        {
            name: 'sourceType',
            label: 'Source Type',
            type: 'select',
            required: true,
            options: [
                { label: 'Script File (.ps1)', value: 'file' },
                { label: 'Inline Command', value: 'inline' }
            ],
            description: 'Whether to run a script file or inline command'
        },
        {
            name: 'scriptPath',
            label: 'Script Path',
            type: 'file',
            required: false,
            description: 'Path to the .ps1 script file (for script file source)'
        },
        {
            name: 'command',
            label: 'PowerShell Command',
            type: 'text',
            required: false,
            description: 'PowerShell command to execute (for inline source)'
        },
        {
            name: 'parameters',
            label: 'Script Parameters',
            type: 'text',
            required: false,
            description: 'JSON object of named parameters to pass to the script'
        },
        {
            name: 'outputVariable',
            label: 'Output Variable Name',
            type: 'string',
            required: false,
            description: 'Variable name to store the output (for use in later steps)'
        },
        {
            name: 'parseOutput',
            label: 'Parse Output As',
            type: 'select',
            required: false,
            options: [
                { label: 'Text', value: 'text' },
                { label: 'JSON', value: 'json' },
                { label: 'CSV', value: 'csv' }
            ],
            description: 'How to parse the PowerShell output (default: text)'
        }
    ],
    async execute(config, context, inputDataset) {
        const {
            sourceType,
            scriptPath,
            command,
            parameters = '{}',
            outputVariable,
            parseOutput = 'text'
        } = config;

        if (sourceType === 'file' && !scriptPath) {
            throw new Error('Execute PowerShell: scriptPath is required for file source');
        }

        if (sourceType === 'inline' && !command) {
            throw new Error('Execute PowerShell: command is required for inline source');
        }

        const PSService = getPowerShellService();
        const powerShell = new PSService({
            workingDirectory: context.resolvePath ? context.resolvePath('.') : (process.cwd ? process.cwd() : '.')
        });

        let result;
        let parsedParams = {};

        if (parameters && typeof parameters === 'string') {
            try {
                parsedParams = JSON.parse(parameters);
            } catch {
                parsedParams = { value: parameters };
            }
        } else if (typeof parameters === 'object') {
            parsedParams = parameters;
        }

        try {
            if (sourceType === 'file') {
                const resolvedPath = context.resolvePath ? context.resolvePath(scriptPath) : scriptPath;
                result = await powerShell.executeScript(resolvedPath, {
                    parameterValues: parsedParams
                });
            } else {
                result = await powerShell.executeCommand(command);
            }
        } catch (error) {
            throw new Error(`PowerShell execution failed: ${error.message}`);
        }

        if (!result.success) {
            throw new Error(`PowerShell execution failed: ${result.stderr || 'Unknown error'}`);
        }

        let parsedOutput = result.stdout;
        if (parseOutput === 'json') {
            try {
                parsedOutput = JSON.parse(result.stdout);
            } catch {
                parsedOutput = result.stdout;
            }
        } else if (parseOutput === 'csv') {
            const lines = result.stdout.split('\n').filter(line => line.trim().length > 0);
            if (lines.length > 1) {
                const header = lines[0].split(',').map(h => h.trim());
                const rows = lines.slice(1).map(line => {
                    const values = line.split(',').map(v => v.trim());
                    const row = {};
                    header.forEach((col, idx) => {
                        row[col] = values[idx] || '';
                    });
                    return row;
                });
                parsedOutput = rows;
            }
        }

        if (outputVariable) {
            context.setVariable(outputVariable, parsedOutput);
        }

        if (context && context.setActivityStats) {
            context.setActivityStats({
                sourceType: sourceType,
                exitCode: result.exitCode,
                outputSize: result.stdout.length,
                outputVariable: outputVariable || 'none',
                parseOutput: parseOutput
            });
        }

        return inputDataset;
    }
});

// ─── 3. For-Each File in Folder ──────────────────────────────────────────────
powerShellActivities.push({
    type: 'forEachFile',
    displayName: '🔄 For-Each File in Folder',
    description: 'Executes inner steps for each file in a folder.',
    category: 'Control',
    configRequirements: [
        {
            name: 'folderPath',
            label: 'Folder Path',
            type: 'file',
            required: true,
            description: 'Path to the folder to process files from'
        },
        {
            name: 'fileFilter',
            label: 'File Filter',
            type: 'string',
            required: false,
            description: 'File pattern to filter (e.g., "*.csv", "*.xlsx")',
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
            name: 'maxFiles',
            label: 'Maximum Files',
            type: 'number',
            required: false,
            description: 'Maximum number of files to process (0 = unlimited)'
        },
        {
            name: 'continueOnError',
            label: 'Continue on Error',
            type: 'boolean',
            required: false,
            description: 'Continue processing other files if one fails (default: false)'
        }
    ],
    async execute(config, context, inputDataset, engineOptions) {
        const {
            folderPath,
            fileFilter = '*',
            recursive = false,
            maxFiles = 0,
            continueOnError = false
        } = config;

        validateConfig({ folderPath }, ['folderPath'], 'For-Each File');

        const resolvedPath = context.resolvePath ? context.resolvePath(folderPath) : folderPath;

        try {
            await fs.promises.access(resolvedPath, fs.constants.R_OK);
        } catch {
            throw new Error(`For-Each File activity: Folder not found or not accessible: ${resolvedPath}`);
        }

        const PSService = getPowerShellService();
        const powerShell = new PSService({
            workingDirectory: context.resolvePath ? context.resolvePath('.') : (process.cwd ? process.cwd() : '.')
        });

        let psCommand = `Get-ChildItem -Path '${resolvedPath.replace(/\\/g, '\\\\')}'`;
        if (fileFilter && fileFilter !== '*') {
            psCommand += ` -Filter '${fileFilter}'`;
        }
        if (recursive) {
            psCommand += ' -Recurse';
        }
        psCommand += ' | Where-Object { -not $_.PSIsContainer }';
        if (maxFiles > 0) {
            psCommand += ` | Select-Object -First ${maxFiles}`;
        }
        psCommand += ' | Select-Object FullName, Name, Extension, DirectoryName';
        psCommand += ' | ConvertTo-Csv -NoTypeInformation';

        const result = await powerShell.executeCommand(psCommand);
        if (!result.success) {
            throw new Error(`For-Each File activity: Failed to list files - ${result.stderr}`);
        }

        const lines = result.stdout.split('\n').filter(line => line.trim().length > 0);
        if (lines.length < 2) {
            if (context && context.setActivityStats) {
                context.setActivityStats({
                    folderPath: resolvedPath,
                    filesProcessed: 0,
                    totalFiles: 0
                });
            }
            return inputDataset;
        }

        const header = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
        const files = lines.slice(1).map(line => {
            const values = parseCSVLine(line);
            const file = {};
            header.forEach((col, idx) => {
                file[col] = values[idx] !== undefined ? values[idx] : '';
            });
            return file;
        });

        const innerSteps = config.steps || [];
        const { executeSteps } = require('../workflowEngine');
        const opts = engineOptions || {};
        const dummyResults = {};
        const errors = [];

        let currentDataset = inputDataset;
        let filesProcessed = 0;

        for (const file of files) {
            try {
                context.setVariable('currentFile', file);
                context.setVariable('fileName', file.Name);
                context.setVariable('filePath', file.FullName);
                context.setVariable('fileExtension', file.Extension || path.extname(file.Name));

                if (innerSteps.length > 0) {
                    // Process steps with file context - replace template variables
                    const processedSteps = innerSteps.map(step => {
                        const processedConfig = {};
                        for (const [key, value] of Object.entries(step.config || {})) {
                            if (typeof value === 'string') {
                                let processed = value
                                    .replace(/\{\{filePath\}\}/g, file.FullName)
                                    .replace(/\{\{fileName\}\}/g, file.Name)
                                    .replace(/\{\{fileExtension\}\}/g, file.Extension || '');
                                processedConfig[key] = processed;
                            } else {
                                processedConfig[key] = value;
                            }
                        }
                        return {
                            ...step,
                            config: processedConfig
                        };
                    });

                    const stepResult = await executeSteps(
                        processedSteps,
                        context,
                        currentDataset,
                        dummyResults,
                        opts
                    );

                    if (!stepResult.success) {
                        const errorMsg = `File "${file.Name}" failed: ${stepResult.error}`;
                        if (!continueOnError) {
                            throw new Error(errorMsg);
                        }
                        errors.push(errorMsg);
                        continue;
                    }

                    currentDataset = stepResult.dataset || currentDataset;
                }

                filesProcessed++;
            } catch (error) {
                const errorMsg = `File "${file.Name}" error: ${error.message}`;
                if (!continueOnError) {
                    throw new Error(errorMsg);
                }
                errors.push(errorMsg);
            }
        }

        if (context && context.setActivityStats) {
            context.setActivityStats({
                folderPath: resolvedPath,
                filesProcessed: filesProcessed,
                totalFiles: files.length,
                errors: errors.length,
                hasErrors: errors.length > 0
            });
        }

        return currentDataset;
    }
});

module.exports = powerShellActivities;
/**
 * engine/workflow/activities/powerShellActivities.js
 *
 * PowerShell integration activities for VizFlow:
 *   - execPowerShell   (Control)  execute a script or inline command
 *   - forEachFile      (Control)  loop over files in a folder
 *
 * File enumeration inside forEachFile uses the cross-platform native lister
 * (services/fileLister.js), so the loop itself does not require PowerShell —
 * only the execPowerShell activity does. The standalone `listFiles` activity
 * lives in fsActivities.js.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const Dataset = require('../../dataset');
const fileLister = require('../../../services/fileLister');
const { validateConfig } = require('./shared');

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

// ─── 1. Execute PowerShell Script ───────────────────────────────────────────
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

// ─── 2. For-Each File in Folder ──────────────────────────────────────────────
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
        },
        {
            name: 'mergeResults',
            label: 'Merge Results',
            type: 'boolean',
            required: false,
            description: 'Merge each file\'s inner output into one dataset (default: false — only the last file\'s dataset is kept)'
        }
    ],
    async execute(config, context, inputDataset, engineOptions) {
        const {
            folderPath,
            fileFilter = '*',
            recursive = false,
            maxFiles = 0,
            continueOnError = false,
            mergeResults = false
        } = config;

        validateConfig({ folderPath }, ['folderPath'], 'For-Each File');

        const resolvedPath = context.resolvePath ? context.resolvePath(folderPath) : folderPath;

        try {
            const stat = await fs.promises.stat(resolvedPath);
            if (!stat.isDirectory()) {
                throw new Error('not a folder');
            }
        } catch (error) {
            throw new Error(`For-Each File activity: Folder not found or not accessible: ${resolvedPath}`);
        }

        let files;
        try {
            files = await fileLister.listFiles({
                folderPath: resolvedPath,
                filter: fileFilter,
                recursive,
                includeMetadata: false,
                maxFiles
            });
        } catch (error) {
            throw new Error(`For-Each File activity: Failed to list files - ${error.message}`);
        }

        const innerSteps = config.steps || [];
        const { executeSteps } = require('../workflowEngine');
        const opts = engineOptions || {};
        const dummyResults = {};
        const errors = [];

        let currentDataset = inputDataset;
        let filesProcessed = 0;

        // When mergeResults is on, accumulate every file's inner output rows
        let mergedRows = [];
        let mergedCols = inputDataset ? inputDataset.getColumns() : [];

        for (const file of files) {
            try {
                if (opts.signal && opts.signal.aborted) {
                    const err = new Error('Workflow cancelled');
                    err.name = 'AbortError';
                    throw err;
                }

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

                    const innerInput = currentDataset;
                    const stepResult = await executeSteps(
                        processedSteps,
                        context,
                        innerInput,
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

                    const outputDataset = stepResult.dataset || innerInput;

                    if (mergeResults) {
                        // A passthrough output (e.g. Write CSV returning its input)
                        // is the same instance we handed in — skip it to avoid duplicating
                        // accumulated rows.
                        if (outputDataset !== innerInput) {
                            for (const c of outputDataset.getColumns()) {
                                if (!mergedCols.includes(c)) mergedCols = [...mergedCols, c];
                            }
                            mergedRows.push(...outputDataset.rows);
                        }
                    }

                    currentDataset = outputDataset;
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
                hasErrors: errors.length > 0,
                mergeResults: mergeResults,
                mergedRowCount: mergeResults ? mergedRows.length : undefined
            });
        }

        if (mergeResults) {
            return new Dataset(mergedRows, mergedCols);
        }

        return currentDataset;
    }
});

module.exports = powerShellActivities;
/**
 * commands/workflowBuilder.js
 *
 * VizFlow: Workflow Builder
 *
 * Opens an interactive WebView panel for building, saving, opening,
 * and running .vizflow workflow files.
 *
 * Exported as a factory: (context) => async () => void
 */

'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { getActivities } = require('../engine/workflow/activityRegistry');
const { executeWorkflow, validateWorkflow } = require('../engine/workflow/workflowEngine');

// Lazy reference to the scheduler command — set by extension.js after both are created
let _openSchedulerWithWorkflow = null;
function setSchedulerOpener(fn) { _openSchedulerWithWorkflow = fn; }

// ── Constants ──────────────────────────────────────────────────────────────────
const PANEL_TYPE = 'vizflowWorkflow';
const PANEL_TITLE = 'VizFlow — Workflow Builder';
const MAX_RETRY_ATTEMPTS = 3;
const MESSAGE_TIMEOUT_MS = 30000;

// Abort controller for the currently running workflow (module scope because
// handleRun / handleStop live outside the panel factory)
/** @type {AbortController | null} */
let currentRunController = null;

// ── Operation param hints map ────────────────────────────────────────────────
const OPERATION_HINT_MAP = {
    'replace': 'search, replace',
    'regexReplace': 'pattern, replacement',
    'regexExtract': 'pattern',
    'concat': 'text1, text2, ...',
    'substring': 'startIndex, endIndex (optional)',
    'padStart': 'targetLength, padString',
    'padEnd': 'targetLength, padString',
    'truncate': 'maxLength, suffix (optional)',
    'add': 'amount',
    'subtract': 'amount',
    'multiply': 'factor',
    'divide': 'divisor',
    'power': 'exponent',
    'roundTo': 'decimals',
    'clamp': 'min, max',
    'percentOf': 'total',
    'formatDate': 'format (YYYY-MM-DD, MM/DD/YYYY, etc.)',
    'extractDatePart': 'year/month/day/hour/minute/second/weekday',
    'addDays': 'days',
    'dateDiff': 'compareDate (optional), unit (days/hours/weeks/months/years)',
    'coalesce': 'fallbackValue',
    'mask': 'start, end, maskChar (optional)',
    'eq': 'compareValue',
    'neq': 'compareValue',
    'gt': 'compareValue',
    'gte': 'compareValue',
    'lt': 'compareValue',
    'lte': 'compareValue',
    'ifThen': 'conditionValue, trueResult, falseResult'
};

/**
 * @param {vscode.ExtensionContext} context
 * @returns {() => Promise<void>}
 */
module.exports = function workflowBuilderCommand(context) {
    /** @type {vscode.WebviewPanel | undefined} */
    let panel = null;
    let panelDisposables = [];

    // ── Helper: Clean up panel resources ────────────────────────────────────
    function disposePanel() {
        if (panel) {
            panelDisposables.forEach(d => d.dispose());
            panelDisposables = [];
            panel = null;
        }
    }

    return async function (uriOrPath) {
        // Accept a vscode.Uri (from Explorer context menu / double-click) or a plain string
        let openFilePath = uriOrPath && typeof uriOrPath === 'object' && uriOrPath.fsPath
            ? uriOrPath.fsPath
            : (typeof uriOrPath === 'string' ? uriOrPath : undefined);

        // ── 1. Reveal existing panel ───────────────────────────────────────────
        if (panel) {
            panel.reveal(vscode.ViewColumn.One);
            if (openFilePath) {
                await handleOpen(panel, openFilePath);
            }
            return;
        }

        // ── 2. Create WebView panel ────────────────────────────────────────────
        panel = vscode.window.createWebviewPanel(
            PANEL_TYPE,
            PANEL_TITLE,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media'),
                    vscode.Uri.joinPath(context.extensionUri, 'images'),
                ],
            }
        );

        // ── 3. Build HTML ──────────────────────────────────────────────────────
        const nonce = crypto.randomBytes(16).toString('base64');

        // Get URIs for all files
        const cssUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'workflow.css')
        );

        const themeUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'theme.css')
        );

        const jsUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'workflow.js')
        );

        const iconUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')
        );

        // Read HTML and replace placeholders
        let html = fs.readFileSync(
            path.join(context.extensionPath, 'media', 'workflow.html'), 'utf8'
        );

        // Get version from package.json
        const version = context.extension.packageJSON.version || '0.0.1';

        html = html
            .replace(/\{\{NONCE\}\}/g, nonce)
            .replace(/\{\{THEME_CSS_URI\}\}/g, themeUri.toString())
            .replace(/\{\{WEBVIEW_CSS_URI\}\}/g, cssUri.toString())
            .replace(/\{\{WEBVIEW_JS_URI\}\}/g, jsUri.toString())
            .replace(/\{\{ICON_URI\}\}/g, iconUri.toString())
            .replace(/\{\{VERSION\}\}/g, version);

        panel.webview.html = html;

        // ── 4. Message handler ─────────────────────────────────────────────────
        const messageDisposable = panel.webview.onDidReceiveMessage(
            async (message) => {
                try {
                    await handleMessage(panel, message, context, openFilePath);
                    // Consume openFilePath after first use
                    if (openFilePath) openFilePath = undefined;
                } catch (err) {
                    console.error('[VizFlow] Message handler error:', err);
                    if (panel) {
                        panel.webview.postMessage({
                            type: 'error',
                            message: err.message || String(err)
                        });
                    }
                }
            },
            undefined,
            context.subscriptions
        );

        // ── 5. Cleanup ─────────────────────────────────────────────────────────
        const disposeListener = panel.onDidDispose(() => {
            disposePanel();
        }, undefined, context.subscriptions);

        panelDisposables = [messageDisposable, disposeListener];
    };
};

// ── Message Handler ───────────────────────────────────────────────────────────

/**
 * Centralized message handler with routing
 */
async function handleMessage(panel, message, context, initialOpenFilePath) {
    switch (message.type) {
        case 'ready':
            await handleReady(panel, initialOpenFilePath);
            break;

        case 'run':
            await handleRun(panel, message.workflow, context);
            break;

        case 'stop':
            handleStop(panel);
            break;

        case 'save':
            await handleSave(panel, message.workflow, message.filePath);
            break;

        case 'saveAs':
            await handleSaveAs(panel, message.workflow);
            break;

        case 'open':
            await handleOpenDialog(panel);
            break;

        case 'pickFile':
            await handlePickFile(panel, message.stepId, message.field, message.activityType);
            break;

        case 'scheduleWorkflow':
            await handleScheduleWorkflow(panel, message.filePath);
            break;

        case 'loadDynamicOptions':
            await handleDynamicOptions(panel, message);
            break;

        case 'loadConnectionOptions':
            handleConnectionOptions(panel);
            break;

        default:
            console.warn('[VizFlow] Unknown message type:', message.type);
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * Called when the WebView signals it is ready. Sends activity registry + optional workflow.
 */
async function handleReady(panel, openFilePath) {
    const activities = getActivities();

    // Enhanced: Ensure all operations have paramsHint for the UI
    const enhancedActivities = enhanceActivitiesWithParamsHint(activities);

    let workflow = null;
    let filePath = null;

    if (openFilePath) {
        try {
            // Check if file exists
            await fs.promises.access(openFilePath, fs.constants.R_OK);
            const raw = await fs.promises.readFile(openFilePath, 'utf8');
            workflow = JSON.parse(raw);
            filePath = openFilePath;
        } catch (e) {
            if (e.code === 'ENOENT') {
                console.warn(`[VizFlow] File not found: ${openFilePath}`);
            } else if (e instanceof SyntaxError) {
                vscode.window.showErrorMessage(`VizFlow: Invalid JSON in workflow file — ${e.message}`);
            } else {
                vscode.window.showErrorMessage(`VizFlow: Failed to open workflow — ${e.message}`);
            }
        }
    }

    panel.webview.postMessage({
        type: 'init',
        activities: enhanceActivitiesWithDynamicOptions(enhancedActivities),
        workflow,
        filePath
    });
}

/**
 * Seeds connection options into every `connection`-type config field and
 * marks `select` fields with a dynamic source so the UI can fetch live
 * databases/tables/columns.
 */
function enhanceActivitiesWithDynamicOptions(activities) {
    let connections = [];
    try {
        const manager = require('../services/database/connectionManager').getConnectionManager();
        connections = manager.list().map((c) => c.name);
    } catch {
        // Connection manager not initialized — leave connection fields empty.
    }

    return activities.map((act) => {
        if (!act.configRequirements) return act;
        act.configRequirements = act.configRequirements.map((req) => {
            const clone = { ...req };
            if (clone.type === 'connection') {
                clone.options = connections.map((name) => ({ value: name, label: name }));
            } else if (clone.type === 'select' && clone.dynamic) {
                clone.options = [];
            }
            return clone;
        });
        return act;
    });
}

/**
 * Fetches live options for a dynamic select field (databases / collections /
 * tables / columns) and sends them back to the WebView.
 */
async function handleDynamicOptions(panel, message) {
    const { field, dependencies } = message;
    if (!field || !field.dynamic) return;

    const manager = require('../services/database/connectionManager').getConnectionManager();
    const connectionName = dependencies && dependencies.connection;
    const profile = connectionName ? await manager.getByName(connectionName) : null;
    if (!profile) {
        panel.webview.postMessage({ type: 'dynamicOptions', requestId: message.requestId, field: field.name, options: [] });
        return;
    }

    const mongoService = require('../services/database/mongoService');
    const sqlService = require('../services/database/sqlService');
    let options = [];

    try {
        switch (field.dynamic) {
            case 'mongodbDatabases': {
                const databases = await mongoService.listDatabases(profile);
                options = databases.map((db) => ({ value: db, label: db }));
                break;
            }
            case 'mongodbCollections': {
                const dbName = dependencies && dependencies.database;
                if (!dbName) break;
                const collections = await mongoService.listCollections(profile, dbName);
                options = collections.map((coll) => ({ value: coll, label: coll }));
                break;
            }
            case 'sqlTables': {
                const tables = await sqlService.listTables(profile);
                options = tables.map((table) => ({ value: table, label: table }));
                break;
            }
            case 'sqlColumns': {
                const table = dependencies && dependencies.table;
                if (!table) break;
                const columns = await sqlService.listColumns(profile, table);
                options = columns.map((col) => ({ value: col, label: col }));
                break;
            }
            default:
                break;
        }
    } catch (err) {
        // Post an empty list so the UI can show "No options available" instead
        // of leaving the field silently unpopulated.
        console.error(`[VizFlow] Failed to load options for ${field.dynamic}:`, err.message || err);
        options = [];
    }

    panel.webview.postMessage({ type: 'dynamicOptions', requestId: message.requestId, field: field.name, options });
}

/**
 * Refreshes the list of saved connection names so connection dropdowns can
 * self-heal when connections are added while the builder panel is already open.
 */
function handleConnectionOptions(panel) {
    let connections = [];
    try {
        const manager = require('../services/database/connectionManager').getConnectionManager();
        connections = manager.list().map((c) => c.name);
    } catch {
        // Connection manager not initialized — respond with an empty list.
    }
    panel.webview.postMessage({
        type: 'connectionOptions',
        options: connections.map((name) => ({ value: name, label: name }))
    });
}

/**
 * Enhanced activities with paramsHint for operations
 */
function enhanceActivitiesWithParamsHint(activities) {
    return activities.map(act => {
        if (act.configRequirements) {
            const opKeyReq = act.configRequirements.find(r => r.name === 'opKey');
            if (opKeyReq && opKeyReq.options) {
                opKeyReq.options = opKeyReq.options.map(opt => {
                    if (!opt.paramsHint) {
                        opt.paramsHint = OPERATION_HINT_MAP[opt.value] || 'none';
                    }
                    return opt;
                });
            }
        }
        return act;
    });
}

/**
 * Runs the workflow definition and streams state changes back to the WebView.
 */
async function handleRun(panel, workflowDef, context) {
    if (!workflowDef || !workflowDef.activities || workflowDef.activities.length === 0) {
        panel.webview.postMessage({
            type: 'error',
            message: 'No workflow definition or activities provided.'
        });
        return;
    }

    // Validate first so we can give a clean error
    const validation = validateWorkflow(workflowDef);
    if (!validation.valid) {
        panel.webview.postMessage({
            type: 'error',
            message: `Validation failed: ${validation.error}`
        });
        return;
    }

    // Resolve paths relative to the first workspace folder (if available)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceRoot = workspaceFolders && workspaceFolders.length > 0
        ? workspaceFolders[0].uri.fsPath
        : context.extensionPath;

    function resolvePath(p) {
        if (!p) return '';
        if (path.isAbsolute(p)) return p;
        return path.join(workspaceRoot, p);
    }

    // Prepare initial variables with more context
    const now = new Date();
    const initialVariables = {
        workflowName: workflowDef.name || 'workflow',
        timestamp: now.toISOString(),
        workspaceRoot: workspaceRoot,
        date: now.toISOString().split('T')[0],
        time: now.toISOString().split('T')[1].split('.')[0],
        year: now.getFullYear().toString(),
        month: String(now.getMonth() + 1).padStart(2, '0'),
        day: String(now.getDate()).padStart(2, '0'),
        hour: String(now.getHours()).padStart(2, '0'),
        minute: String(now.getMinutes()).padStart(2, '0'),
        second: String(now.getSeconds()).padStart(2, '0')
    };

    const total = workflowDef.activities.length;
    let completed = 0;
    const trace = [];

    // Abort controller lets the webview Stop button cancel the run
    const controller = new AbortController();
    currentRunController = controller;

    try {
        const result = await executeWorkflow(workflowDef, {
            resolvePath,
            initialVariables,
            signal: controller.signal,
            onStateChange(activityId, state, stats, error) {
                trace.push({
                    activityId,
                    state,
                    stats: stats || {},
                    error: error || null,
                    timestamp: new Date().toISOString()
                });
                if (!panel) return;
                panel.webview.postMessage({
                    type: 'activityState',
                    activityId,
                    state,
                    stats: stats || {},
                    error: error || null
                });
                if (state === 'Completed') {
                    completed++;
                    const pct = Math.min(Math.round((completed / total) * 95), 95);
                    panel.webview.postMessage({
                        type: 'runProgress',
                        pct
                    });
                }
            }
        });

        if (panel) {
            // Send completion with variables and the run trace
            panel.webview.postMessage({
                type: 'runComplete',
                success: result.success,
                error: result.error || null,
                variables: result.variables || {},
                trace
            });

            // If successful, send final progress to 100%
            if (result.success) {
                panel.webview.postMessage({
                    type: 'runProgress',
                    pct: 100
                });
                vscode.window.showInformationMessage(`VizFlow: Workflow "${workflowDef.name || 'Untitled'}" completed successfully!`);
            } else if (controller.signal.aborted) {
                // User-initiated stop / timeout — treat as cancellation, not an error
                const reason = controller.signal.reason && controller.signal.reason.message
                    ? controller.signal.reason.message
                    : 'Workflow cancelled';
                vscode.window.showInformationMessage(`VizFlow: ${reason}`);
            } else {
                vscode.window.showErrorMessage(`VizFlow: Workflow execution failed — ${result.error || 'Unknown error'}`);
            }
        }
    } catch (error) {
        console.error('[VizFlow] Workflow execution error:', error);
        if (panel) {
            panel.webview.postMessage({
                type: 'runComplete',
                success: false,
                error: error.message || String(error),
                variables: {},
                trace
            });
        }
        if (controller.signal.aborted) {
            const reason = controller.signal.reason && controller.signal.reason.message
                ? controller.signal.reason.message
                : 'Workflow cancelled';
            vscode.window.showInformationMessage(`VizFlow: ${reason}`);
        } else {
            vscode.window.showErrorMessage(`VizFlow: Workflow execution error — ${error.message || String(error)}`);
        }
    } finally {
        if (currentRunController === controller) {
            currentRunController = null;
        }
    }
}

/**
 * Cancels the currently running workflow, if any.
 */
async function handleStop(panel) {
    if (!currentRunController) {
        panel.webview.postMessage({
            type: 'runStopped'
        });
        return;
    }
    currentRunController.abort(new Error('Workflow cancelled by user'));
}

/**
 * Saves to the given filePath, or falls back to Save As if none provided.
 */
async function handleSave(panel, workflowDef, filePath) {
    if (!workflowDef) {
        vscode.window.showErrorMessage('VizFlow: No workflow data to save.');
        return;
    }

    if (!filePath) {
        await handleSaveAs(panel, workflowDef);
        return;
    }

    try {
        const content = JSON.stringify(workflowDef, null, 2);
        await fs.promises.writeFile(filePath, content, 'utf8');
        panel.webview.postMessage({ type: 'saved', filePath });
        vscode.window.showInformationMessage(`VizFlow: Workflow saved to ${path.basename(filePath)}`);
    } catch (error) {
        vscode.window.showErrorMessage(`VizFlow: Failed to save workflow — ${error.message}`);
    }
}

/**
 * Prompts for a new file path and saves.
 */
async function handleSaveAs(panel, workflowDef) {
    if (!workflowDef) {
        vscode.window.showErrorMessage('VizFlow: No workflow data to save.');
        return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const defaultDir = workspaceFolders && workspaceFolders.length > 0
        ? workspaceFolders[0].uri
        : undefined;

    const safeName = (workflowDef.name || 'workflow')
        .replace(/[^a-zA-Z0-9_\- ]/g, '')
        .trim()
        .replace(/\s+/g, '_') || 'workflow';

    const saveUri = await vscode.window.showSaveDialog({
        defaultUri: defaultDir
            ? vscode.Uri.joinPath(defaultDir, `${safeName}.vizflow`)
            : vscode.Uri.file(`${safeName}.vizflow`),
        filters: { 'VizFlow Workflows': ['vizflow'], 'All Files': ['*'] },
        title: 'Save VizFlow Workflow'
    });

    if (!saveUri) return;

    try {
        const content = JSON.stringify(workflowDef, null, 2);
        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf8'));
        panel.webview.postMessage({ type: 'savedAs', filePath: saveUri.fsPath });
        vscode.window.showInformationMessage(`VizFlow: Workflow saved to ${path.basename(saveUri.fsPath)}`);
    } catch (error) {
        vscode.window.showErrorMessage(`VizFlow: Failed to save workflow — ${error.message}`);
    }
}

/**
 * Shows an open dialog and loads the selected .vizflow file.
 */
async function handleOpenDialog(panel) {
    const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'VizFlow Workflows': ['vizflow'], 'All Files': ['*'] },
        title: 'Open VizFlow Workflow'
    });

    if (!uris || uris.length === 0) return;
    await handleOpen(panel, uris[0].fsPath);
}

/**
 * Reads and sends a .vizflow file to the WebView.
 */
async function handleOpen(panel, filePath) {
    try {
        // Check if file exists and is readable
        await fs.promises.access(filePath, fs.constants.R_OK);
        const raw = await fs.promises.readFile(filePath, 'utf8');
        const workflow = JSON.parse(raw);

        // Validate workflow structure
        if (!workflow.activities || !Array.isArray(workflow.activities)) {
            throw new Error('Invalid workflow file: missing "activities" array');
        }

        panel.webview.postMessage({ type: 'opened', workflow, filePath });
        vscode.window.showInformationMessage(`VizFlow: Opened ${path.basename(filePath)}`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            vscode.window.showErrorMessage(`VizFlow: File not found — ${path.basename(filePath)}`);
        } else if (error instanceof SyntaxError) {
            vscode.window.showErrorMessage(`VizFlow: Invalid JSON in workflow file — ${error.message}`);
        } else {
            vscode.window.showErrorMessage(`VizFlow: Failed to open workflow — ${error.message}`);
        }
        console.error('[VizFlow] Open error:', error);
    }
}

/**
 * Find a config requirement for an activity + field name.
 */
function getConfigRequirement(activityType, field) {
    if (!activityType || !field) return null;
    const acts = getActivities();
    const act = acts.find(a => a.type === activityType);
    if (!act) return null;
    return (act.configRequirements || []).find(r => r.name === field) || null;
}

/**
 * Opens a file/folder-picker dialog appropriate for the requested config field.
 */
async function handlePickFile(panel, stepId, field, activityType) {
    let filters = { 'All Files': ['*'] };
    let canSelectFolders = false;
    let title = 'Select File';

    const req = getConfigRequirement(activityType, field);
    if (req) {
        const haystack = `${req.label || ''} ${req.description || ''} ${req.name || ''} ${req.placeholder || ''}`.toLowerCase();
        if (/output.?dir|folder|directory/.test(haystack)) {
            canSelectFolders = true;
            title = `Select ${req.label || 'Folder'}`;
        } else if (/excel|xlsx|xls/.test(haystack)) {
            filters = { 'Excel Files': ['xlsx', 'xls', 'xlsm'], 'All Files': ['*'] };
        } else if (/json/.test(haystack)) {
            filters = { 'JSON Files': ['json'], 'All Files': ['*'] };
        } else if (/text|\.txt|plain text/.test(haystack)) {
            filters = { 'Text Files': ['txt'], 'All Files': ['*'] };
        } else if (/csv/.test(haystack)) {
            filters = {
                'CSV Files': ['csv'],
                'Excel Files': ['xlsx', 'xls', 'xlsm'],
                'JSON Files': ['json'],
                'Text Files': ['txt'],
                'All Files': ['*']
            };
        }
    }

    const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: !canSelectFolders,
        canSelectFolders,
        filters,
        title
    });
    if (!uris || uris.length === 0) return;
    panel.webview.postMessage({
        type: 'pickFileResult',
        stepId,
        field,
        filePath: uris[0].fsPath
    });
}

/**
 * Opens the scheduler with the current workflow.
 */
async function handleScheduleWorkflow(panel, filePath) {
    if (!_openSchedulerWithWorkflow) {
        vscode.window.showErrorMessage('VizFlow: Scheduler is not available.');
        return;
    }

    if (!filePath) {
        vscode.window.showErrorMessage('VizFlow: Please save the workflow before scheduling.');
        return;
    }

    try {
        await _openSchedulerWithWorkflow('quickSchedule', filePath);
    } catch (error) {
        console.error('[VizFlow] Schedule error:', error);
        vscode.window.showErrorMessage(`VizFlow: Failed to open scheduler — ${error.message}`);
    }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports.setSchedulerOpener = setSchedulerOpener;
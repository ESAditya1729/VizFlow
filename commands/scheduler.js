/**
 * commands/scheduler.js
 *
 * VizFlow: Workflow Scheduler
 *
 * Opens an interactive WebView panel for managing scheduled workflow jobs.
 * Exported as a factory: (context) => async (commandType?, uri?) => void
 */

'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getScheduler } = require('../engine/scheduler/schedulerEngine');
const { SchedulerStore } = require('../engine/scheduler/schedulerStore');

/**
 * @param {vscode.ExtensionContext} context
 * @returns {(commandType?: string, uri?: vscode.Uri|string) => Promise<void>}
 */
module.exports = function schedulerCommand(context) {

    /** @type {vscode.WebviewPanel | undefined} */
    let panel;
    let scheduler = null;

    /**
     * Ensure the scheduler singleton is initialised and events wired.
     *
     * The scheduler is auto-started during extension activation (see
     * extension.js), so this is a no-op for the singleton once it is running.
     * The idempotency guard keeps jobs from being registered twice when the
     * panel is opened after activation.
     */
    function ensureScheduler() {
        if (scheduler) return;
        const configPath = path.join(context.globalStorageUri.fsPath, 'scheduler-config.json');
        scheduler = getScheduler();

        if (!scheduler.isRunning) {
            scheduler.initialize(configPath, {
                baseDir: getWorkspaceRoot() || context.extensionPath,
                store: new SchedulerStore(configPath),
                migrateFrom: path.join(context.extensionPath, 'scheduler-config.json')
            });
        }

        const forward = (type) => (data) => {
            if (panel) panel.webview.postMessage({ type, data });
        };

        scheduler.on('jobStarted', forward('jobStarted'));
        scheduler.on('jobCompleted', forward('jobCompleted'));
        scheduler.on('jobFailed', forward('jobFailed'));
        scheduler.on('jobCancelled', forward('jobCancelled'));
        scheduler.on('jobAdded', forward('jobAdded'));
        scheduler.on('jobRemoved', forward('jobRemoved'));
        scheduler.on('jobUpdated', (data) => {
            if (panel) {
                panel.webview.postMessage({ type: 'jobUpdated', data });
                refreshJobs();
            }
        });
        scheduler.on('notification', (data) => {
            if (!data) return;
            if (data.type === 'email') {
                vscode.window.showInformationMessage(`📧 Notification sent for job: ${data.jobName}`);
            } else if (data.type === 'webhook') {
                vscode.window.showInformationMessage(`🔗 Webhook triggered for job: ${data.jobName}`);
            }
        });
        scheduler.on('fileChanged', (data) => {
            vscode.window.showInformationMessage(`📁 File changed in ${data.folder}: ${data.filename}`);
        });
    }

    /** First workspace folder path (or null when no folder is open). */
    function getWorkspaceRoot() {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
    }

    /** Push the current job list, history, and running jobs to the WebView. */
    function refreshJobs() {
        if (!panel) return;
        panel.webview.postMessage({
            type: 'refreshJobs',
            jobs: scheduler.getJobs(),
            history: scheduler.getHistory(),
            runningJobs: scheduler.getRunningJobs()
        });
    }

    // ── Sub-command helpers ──────────────────────────────────────────────────

    async function quickSchedule(uri) {
        // Resolve a .vizflow file path from a URI argument or from the active editor
        let workflowPath = null;
        if (uri && typeof uri === 'object' && uri.fsPath) {
            workflowPath = uri.fsPath;
        } else if (uri && typeof uri === 'string') {
            workflowPath = uri;
        } else {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.fileName.endsWith('.vizflow')) {
                workflowPath = editor.document.fileName;
            }
        }

        if (!workflowPath) {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: { 'VizFlow Workflows': ['vizflow'] },
                title: 'Select Workflow to Schedule'
            });
            if (!uris || uris.length === 0) return;
            workflowPath = uris[0].fsPath;
        }

        // Open the scheduler panel, then pre-fill the workflow path
        await openPanel(workflowPath);
    }

    async function showRunning() {
        ensureScheduler();
        const running = scheduler.getRunningJobs();
        if (running.length === 0) {
            vscode.window.showInformationMessage('VizFlow Scheduler: No jobs currently running.');
            return;
        }
        const items = running.map(j => `${j.jobName}  (started ${new Date(j.startTime).toLocaleTimeString()})`);
        await vscode.window.showQuickPick(items, { title: 'Running Scheduler Jobs', canPickMany: false });
    }

    // ── Panel creation ───────────────────────────────────────────────────────

    async function openPanel(prefilledWorkflow) {
        ensureScheduler();

        if (panel) {
            panel.reveal(vscode.ViewColumn.One);
            if (prefilledWorkflow) {
                panel.webview.postMessage({ type: 'prefillWorkflow', filePath: prefilledWorkflow });
            }
            refreshJobs();
            return;
        }

        panel = vscode.window.createWebviewPanel(
            'vizflowScheduler',
            'VizFlow — Scheduler',
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

        // Build HTML from external file (same pattern as workflowBuilder)
        const nonce = crypto.randomBytes(16).toString('base64');

        const cssUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'scheduler.css')
        );
        const jsUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'scheduler.js')
        );
        const iconUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')
        );

        const version = context.extension.packageJSON.version || '0.0.1';

        let html = fs.readFileSync(
            path.join(context.extensionPath, 'media', 'scheduler.html'), 'utf8'
        );

        html = html
            .replace(/\{\{NONCE\}\}/g, nonce)
            .replace(/\{\{WEBVIEW_CSS_URI\}\}/g, cssUri.toString())
            .replace(/\{\{WEBVIEW_JS_URI\}\}/g, jsUri.toString())
            .replace(/\{\{ICON_URI\}\}/g, iconUri.toString())
            .replace(/\{\{VERSION\}\}/g, version);

        panel.webview.html = html;

        // Message handler
        panel.webview.onDidReceiveMessage(
            async (message) => {
                try {
                    switch (message.type) {
                        case 'ready':
                            refreshJobs();
                            if (prefilledWorkflow) {
                                panel.webview.postMessage({ type: 'prefillWorkflow', filePath: prefilledWorkflow });
                                prefilledWorkflow = null; // consume
                            }
                            break;
                        case 'addJob':
                            await handleAddJob(message.job);
                            break;
                        case 'removeJob':
                            try {
                                scheduler.removeJob(message.jobId);
                                refreshJobs();
                                panel.webview.postMessage({
                                    type: 'jobRemoved',
                                    jobId: message.jobId
                                });
                                vscode.window.showInformationMessage(`✅ Job removed successfully`);
                            } catch (error) {
                                panel.webview.postMessage({
                                    type: 'error',
                                    message: error.message
                                });
                            }
                            break;
                        case 'updateJob':
                            scheduler.updateJob(message.jobId, message.updates);
                            refreshJobs();
                            break;
                        case 'getHistory':
                            // Refresh button in the History tab
                            refreshJobs();
                            break;
                        case 'runNow':
                            scheduler.runNow(message.jobId);
                            break;
                        case 'stopJob':
                            scheduler.stopJob(message.jobId);
                            refreshJobs();
                            break;
                        case 'pauseJob':
                            scheduler.pauseJob(message.jobId);
                            refreshJobs();
                            break;
                        case 'resumeJob':
                            scheduler.resumeJob(message.jobId);
                            refreshJobs();
                            break;
                        case 'clearHistory':
                            scheduler.clearHistory();
                            refreshJobs();
                            break;
                        case 'pickWorkflow':
                            await handlePickWorkflow();
                            break;
                        case 'scheduleOnce':
                            try {
                                scheduler.scheduleOnce(message.jobId, message.runAt);
                                refreshJobs();
                            } catch (err) {
                                panel.webview.postMessage({ type: 'error', message: err.message });
                            }
                            break;
                        default:
                            console.warn('VizFlow Scheduler: unknown message type:', message.type);
                    }
                } catch (err) {
                    if (panel) panel.webview.postMessage({ type: 'error', message: err.message || String(err) });
                }
            },
            undefined,
            context.subscriptions
        );

        panel.onDidDispose(() => { panel = undefined; }, undefined, context.subscriptions);
        refreshJobs();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    async function handleAddJob(jobConfig) {
        if (jobConfig.workflowFile && !fs.existsSync(jobConfig.workflowFile)) {
            throw new Error(`Workflow file not found: ${jobConfig.workflowFile}`);
        }
        const job = scheduler.addJob(jobConfig);
        refreshJobs();
        panel.webview.postMessage({ type: 'jobAddedSuccess', job });
        vscode.window.showInformationMessage(`✅ Job "${job.name}" scheduled successfully!`);
    }

    async function handlePickWorkflow() {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'VizFlow Workflows': ['vizflow'] },
            title: 'Select Workflow File'
        });
        if (uris && uris.length > 0) {
            panel.webview.postMessage({ type: 'workflowPicked', filePath: uris[0].fsPath });
        }
    }

    // ── Main entry point ─────────────────────────────────────────────────────

    return async function (commandType, uri) {
        if (commandType === 'quickSchedule') { await quickSchedule(uri); return; }
        if (commandType === 'showRunning') { await showRunning(); return; }
        if (commandType === 'stopJob') {
            ensureScheduler();
            const running = scheduler.getRunningJobs();
            if (running.length === 0) {
                vscode.window.showInformationMessage('VizFlow Scheduler: No jobs currently running.');
                return;
            }
            const items = running.map(j => ({ label: j.jobName, description: j.jobId }));
            const pick = await vscode.window.showQuickPick(items, { title: 'Stop a Running Job' });
            if (pick) {
                try { scheduler.stopJob(pick.description); }
                catch (err) { vscode.window.showErrorMessage(`VizFlow Scheduler: ${err.message}`); }
            }
            return;
        }
        await openPanel(null);
    };
};

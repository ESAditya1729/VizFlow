/**
 * VizFlow: Run RBQL Query
 *
 * Opens a Webview panel for executing RBQL queries on CSV data.
 * Exported as a factory (context) => async () so it matches the
 * pattern used by dashboard, charts, compareCSV, etc.
 */

'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const csvReader = require('../services/csvReader');
const csvParser = require('../services/csvParser');
const rbqlService = require('../services/rbqlService');

/**
 * Factory — accepts `context` so we can resolve media URIs.
 *
 * @param {vscode.ExtensionContext} context
 * @returns {() => Promise<void>}
 */
module.exports = function rbqlCommand(context) {

    /** @type {vscode.WebviewPanel | undefined} */
    let panel;
    /** @type {import('../engine/dataset') | undefined} */
    let dataset;

    return async function () {

        // ── 1. Load and parse the active CSV ────────────────────────────────
        const csvText = await csvReader.load();
        if (!csvText) return;

        try {
            dataset = csvParser.parse(csvText);
        } catch (err) {
            vscode.window.showErrorMessage('VizFlow: Failed to parse CSV — ' + err.message);
            return;
        }

        const columns = dataset.getColumns();
        const rowCount = dataset.getRowCount();

        // ── 2. Reveal existing panel or create a new one ─────────────────────
        if (panel) {
            panel.reveal(vscode.ViewColumn.One);
            panel.webview.postMessage({ type: 'init', columns, rowCount });
            return;
        }

        panel = vscode.window.createWebviewPanel(
            'vizflowRBQL',
            'VizFlow — RBQL Query Console',
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

        // ── 3. Build HTML ────────────────────────────────────────────────────
        const nonce = crypto.randomBytes(16).toString('base64');

        const cssUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'rbql.css')
        ).toString();

        const iconUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')
        ).toString();

        const { version } = context.extension.packageJSON;

        let html = fs.readFileSync(
            path.join(context.extensionPath, 'media', 'rbql.html'), 'utf8'
        );

        html = html
            .split('{{NONCE}}').join(nonce)
            .replace('{{WEBVIEW_CSS_URI}}', cssUri)
            .replace('{{ICON_URI}}', iconUri)
            .split('{{VERSION}}').join(version);

        panel.webview.html = html;

        // ── 4. Send dataset info once the webview is ready ───────────────────
        setImmediate(() => {
            if (panel) {
                panel.webview.postMessage({ type: 'init', columns, rowCount });
            }
        });

        // ── 5. Handle messages from the webview ──────────────────────────────
        panel.webview.onDidReceiveMessage(
            async (message) => {
                try {
                    switch (message.type) {
                        case 'execute':
                            await handleExecute(message, dataset, panel);
                            break;
                        case 'export':
                            await handleExport(message, panel);
                            break;
                    }
                } catch (err) {
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

        // ── 6. Cleanup ───────────────────────────────────────────────────────
        panel.onDidDispose(() => { panel = undefined; }, undefined, context.subscriptions);
    };
};

// ── Message Handlers ────────────────────────────────────────────────────────

/**
 * @param {any} message
 * @param {import('../engine/dataset')} ds
 * @param {vscode.WebviewPanel} webviewPanel
 */
async function handleExecute(message, ds, webviewPanel) {
    const { query, hasHeader } = message;

    if (!query || !query.trim()) {
        webviewPanel.webview.postMessage({ type: 'error', message: 'Please enter a query.' });
        return;
    }

    // Validate
    const validation = rbqlService.validateQuery(query);
    if (!validation.valid) {
        webviewPanel.webview.postMessage({
            type: 'error',
            message: `Query validation error: ${validation.error}`
        });
        return;
    }

    webviewPanel.webview.postMessage({ type: 'progress', pct: 30 });

    const result = await rbqlService.executeQuery(ds, query, {
        hasHeader: hasHeader !== false
    });

    webviewPanel.webview.postMessage({ type: 'progress', pct: 90 });

    if (result.success) {
        webviewPanel.webview.postMessage({
            type: 'result',
            data: {
                columns: result.columns,
                rows: result.rows,
                rowCount: result.rowCount,
                query: result.query,
                backend: result.backend,
                warnings: result.warnings || []
            }
        });
    } else {
        webviewPanel.webview.postMessage({
            type: 'error',
            message: `Query execution error: ${result.error}`
        });
    }

    webviewPanel.webview.postMessage({ type: 'progress', pct: 100 });
    setTimeout(() => {
        webviewPanel.webview.postMessage({ type: 'progress', pct: -1 });
    }, 800);
}

/**
 * @param {any} message
 * @param {vscode.WebviewPanel} webviewPanel
 */
async function handleExport(message, webviewPanel) {
    const { data, format, filename } = message;

    if (!data) {
        vscode.window.showErrorMessage('No data to export.');
        return;
    }

    let content;
    let ext;
    let filters;

    switch (format) {
        case 'csv': {
            const headerRow = data.columns.join(',');
            const dataRows = data.rows.map(row => row.join(','));
            content = [headerRow, ...dataRows].join('\n');
            ext = 'csv';
            filters = { 'CSV Files': ['csv'], 'All Files': ['*'] };
            break;
        }
        case 'json': {
            const jsonData = data.rows.map(row => {
                const obj = {};
                data.columns.forEach((col, idx) => { obj[col] = row[idx]; });
                return obj;
            });
            content = JSON.stringify(jsonData, null, 2);
            ext = 'json';
            filters = { 'JSON Files': ['json'], 'All Files': ['*'] };
            break;
        }
        default:
            vscode.window.showErrorMessage(`Unsupported format: ${format}`);
            return;
    }

    const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(filename || `query_results.${ext}`),
        filters,
        title: `Export RBQL Results as ${format.toUpperCase()}`
    });

    if (!saveUri) return;

    try {
        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf8'));
        webviewPanel.webview.postMessage({
            type: 'exportDone',
            savedPath: saveUri.fsPath
        });
        vscode.window.showInformationMessage(
            `Results exported to: ${path.basename(saveUri.fsPath)}`
        );
    } catch (err) {
        vscode.window.showErrorMessage(`Export failed: ${err.message}`);
    }
}

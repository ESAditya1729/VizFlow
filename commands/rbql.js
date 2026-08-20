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
    /** @type {import('../engine/dataset') | undefined} */
    let joinDataset;

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
            // Dispose the old panel so the updated HTML (templates, autocomplete,
            // cursor fixes) is always loaded fresh from disk.
            panel.dispose();
            panel = undefined;
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

        const syntaxUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'rbql-syntax.js')
        ).toString();

        const templatesUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'rbql-templates.js')
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
            .replace('{{WEBVIEW_RESOURCE_ROOT}}', panel.webview.cspSource)
            .replace('{{WEBVIEW_CSS_URI}}', cssUri)
            .replace('{{WEBVIEW_SYNTAX_URI}}', syntaxUri)
            .replace('{{WEBVIEW_TEMPLATES_URI}}', templatesUri)
            .replace('{{ICON_URI}}', iconUri)
            .split('{{VERSION}}').join(version);

        panel.webview.html = html;

        // ── 4. Send dataset info once the webview is ready ───────────────────
        setImmediate(() => {
            if (panel) {
                // Build positional mapping a1,a2,... to help users write RBQL queries
                const positional = columns.map((_, i) => `a${i + 1}`);
                const columnMap = columns.map((name, i) => ({ pos: `a${i + 1}`, name }));
                panel.webview.postMessage({ type: 'init', columns, rowCount, positional, columnMap });
            }
        });

        // ── 5. Handle messages from the webview ──────────────────────────────
        panel.webview.onDidReceiveMessage(
            async (message) => {
                try {
                    switch (message.type) {
                        case 'execute':
                            await handleExecute(message, dataset, joinDataset, panel);
                            break;
                        case 'export':
                            await handleExport(message, panel);
                            break;
                        case 'selectJoinFile':
                            joinDataset = await handleSelectJoinFile(panel);
                            break;
                        case 'clearJoinFile':
                            joinDataset = undefined;
                            panel.webview.postMessage({ type: 'joinFileCleared' });
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
 * @param {import('../engine/dataset') | undefined} joinDs
 * @param {vscode.WebviewPanel} webviewPanel
 */
async function handleExecute(message, ds, joinDs, webviewPanel) {
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
        hasHeader: hasHeader !== false,
        joinDataset: joinDs || null
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

    if (format === 'duckdb_sql') {
        // data is expected to be { results, query, origColumns, positional }
        const { query, origColumns, positional } = data;
        // Build SQL content
        function escapeIdent(name) {
            if (typeof name !== 'string') return name;
            return '"' + name.replace(/"/g, '""') + '"';
        }

        let sql = (query || '').trim();
        if (!sql) {
            vscode.window.showErrorMessage('No query available to export.');
            return;
        }

        // If query does not contain FROM, inject FROM vizflow_src before WHERE/GROUP/ORDER/LIMIT
        if (!/\bfrom\b/i.test(sql)) {
            const m = sql.match(/\b(WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING|UNION)\b/i);
            if (m && m.index >= 0) {
                const idx = m.index;
                sql = sql.slice(0, idx) + ' FROM vizflow_src ' + sql.slice(idx);
            } else {
                sql = sql + ' FROM vizflow_src';
            }
        }

        // Replace aN tokens with quoted original column names (or positional aliases)
        sql = sql.replace(/\ba(\d+)\b/g, (match, p1) => {
            const idx = parseInt(p1, 10) - 1;
            const orig = Array.isArray(origColumns) && origColumns[idx] ? origColumns[idx] : null;
            const pos = Array.isArray(positional) && positional[idx] ? positional[idx] : `a${p1}`;
            const name = orig || pos;
            return escapeIdent(name);
        });

        // Build full script: read CSV, run query, write to output path
        const header = `-- VizFlow-generated DuckDB SQL\n-- INPUT: {{INPUT_PATH}}\n-- OUTPUT: {{OUTPUT_PATH}}\n\n`;
        const read = `CREATE TEMPORARY VIEW vizflow_src AS SELECT * FROM read_csv_auto('{{INPUT_PATH}}');\n\n`;

        // Wrap the select in a COPY ... TO statement to write CSV
        const copy = `COPY (\n  ${sql}\n) TO '{{OUTPUT_PATH}}' (FORMAT CSV, HEADER TRUE);\n`;

        content = header + read + copy;
        ext = 'sql';
        filters = { 'SQL Files': ['sql'], 'All Files': ['*'] };
    } else {
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

/**
 * Handle join file selection — opens a file picker, parses the CSV,
 * and returns the parsed dataset for use in JOIN queries.
 *
 * @param {vscode.WebviewPanel} webviewPanel
 * @returns {Promise<import('../engine/dataset') | undefined>}
 */
async function handleSelectJoinFile(webviewPanel) {
    const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        filters: { 'CSV Files': ['csv'], 'All Files': ['*'] },
        title: 'Select Join Table (CSV)'
    });

    if (!uris || !uris.length) return undefined;

    const joinUri = uris[0];
    try {
        const bytes = await vscode.workspace.fs.readFile(joinUri);
        const text = Buffer.from(bytes).toString('utf8');
        const parsed = csvParser.parse(text);

        const joinCols = parsed.getColumns();
        const joinRows = parsed.getRowCount();
        webviewPanel.webview.postMessage({
            type: 'joinFileLoaded',
            fileName: path.basename(joinUri.fsPath),
            columns: joinCols,
            rowCount: joinRows,
            columnMap: joinCols.map((name, i) => ({ pos: `b${i + 1}`, name }))
        });
        return parsed;
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to parse join file: ${err.message}`);
        return undefined;
    }
}

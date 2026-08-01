/**
 * VizFlow: Compare CSV Files (WebView)
 *
 * Opens a WebviewPanel that lets the user:
 *   1. Select File A (active editor or file-picker) and pick a column
 *   2. Select File B (file-picker) and pick a column
 *   3. Run the comparison and see a tabbed, colour-coded report with:
 *      - Summary cards (total rows, matches, only-A, only-B)
 *      - Column profiles (distinct count, null count, data type)
 *      - Filterable / searchable / sortable results table
 *      - Export as CSV or JSON
 *
 * host → webview : initFileA | columnsB | compareResult | compareError | exportDone | progress
 * webview → host : loadFileA | loadFileB | runCompare | exportResult
 */

'use strict';

const vscode  = require('vscode');
const path    = require('path');
const crypto  = require('crypto');
const fs      = require('fs');
const Papa    = require('papaparse');

const csvParser     = require('../services/csvParser');
const csvCompare    = require('../services/csvCompare');

/**
 * Factory — accepts `context` so we can resolve media paths.
 *
 * @param {vscode.ExtensionContext} context
 * @returns {() => Promise<void>}
 */
module.exports = function compareCSVCommand(context) {

    /** @type {vscode.WebviewPanel | undefined} */
    let panel;

    return async function () {

        // ── 1. Create (or reveal) the panel ────────────────────────────────────
        if (panel) {
            panel.reveal(vscode.ViewColumn.One);
            // Re-send file A if the active editor has a CSV
            tryLoadActiveCSV(panel, context);
            return;
        }

        panel = vscode.window.createWebviewPanel(
            'vizflowCompareCSV',
            'VizFlow: Compare CSV Files',
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

        /** @type {vscode.WebviewPanel} */
        const activePanel = panel;

        // ── 2. Load and inject HTML ─────────────────────────────────────────────
        const nonce   = crypto.randomBytes(16).toString('base64');
        const htmlUri = path.join(context.extensionPath, 'media', 'compare.html');
        let html      = fs.readFileSync(htmlUri, 'utf8');

        const cssUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'compare.css')
        ).toString();

        const iconUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')
        ).toString();

        const { version } = context.extension.packageJSON;

        html = html
            .split('{{NONCE}}').join(nonce)
            .replace('{{WEBVIEW_CSS_URI}}', cssUri)
            .replace('{{ICON_URI}}', iconUri)
            .replace('{{VERSION}}', version);

        panel.webview.html = html;

        // ── 3. State shared across message handlers ─────────────────────────────
        /** @type {import('../engine/dataset') | undefined} */
        let datasetA;
        /** @type {import('../engine/dataset') | undefined} */
        let datasetB;
        let uriA = /** @type {vscode.Uri | undefined} */ (undefined);

        // ── 4. Seed File A from the active editor ───────────────────────────────
        setImmediate(() => tryLoadActiveCSV(activePanel, context, (dataset, uri, columns) => {
            datasetA = dataset;
            uriA = uri;
            activePanel.webview.postMessage({ type: 'initFileA', columns, fileName: path.basename(uri.fsPath) });
        }));

        // ── 5. Message handler ──────────────────────────────────────────────────
        panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {

                // User clicked "Browse…" for File A
                case 'loadFileA': {
                    const result = await pickAndParse(msg.filePath);
                    if (!result) return;
                    datasetA = result.dataset;
                    uriA     = result.uri;
                    activePanel.webview.postMessage({
                        type:     'initFileA',
                        columns:  result.dataset.getColumns(),
                        fileName: path.basename(result.uri.fsPath),
                    });
                    break;
                }

                // User clicked "Browse…" for File B
                case 'loadFileB': {
                    const result = await pickAndParse(msg.filePath);
                    if (!result) return;
                    datasetB = result.dataset;
                    activePanel.webview.postMessage({
                        type:     'columnsB',
                        columns:  result.dataset.getColumns(),
                        fileName: path.basename(result.uri.fsPath),
                    });
                    break;
                }

                // User clicked "Run Comparison"
                case 'runCompare': {
                    if (!datasetA || !datasetB) {
                        activePanel.webview.postMessage({ type: 'compareError', message: 'Both files must be loaded before comparing.' });
                        return;
                    }
                    activePanel.webview.postMessage({ type: 'progress', pct: 10 });

                    try {
                        const result = csvCompare.compare(
                            datasetA, msg.columnA,
                            datasetB, msg.columnB,
                            {
                                onProgress: pct => activePanel.webview.postMessage({ type: 'progress', pct }),
                            }
                        );
                        activePanel.webview.postMessage({ type: 'compareResult', result });
                    } catch (err) {
                        activePanel.webview.postMessage({
                            type:    'compareError',
                            message: err instanceof Error ? err.message : String(err),
                        });
                    }
                    break;
                }

                // User clicked "Export CSV" or "Export JSON"
                case 'exportResult': {
                    await handleExport(msg, activePanel, uriA);
                    break;
                }
            }
        }, undefined, context.subscriptions);

        // ── 6. Cleanup ──────────────────────────────────────────────────────────
        panel.onDidDispose(() => { panel = undefined; }, undefined, context.subscriptions);
    };
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * If there is an active CSV editor, parse it and call `cb` with the result.
 * If no callback is provided, posts directly to the panel.
 *
 * @param {vscode.WebviewPanel} panel
 * @param {vscode.ExtensionContext} _context
 * @param {((dataset: any, uri: vscode.Uri, columns: string[]) => void) | undefined} [cb]
 */
function tryLoadActiveCSV(panel, _context, cb) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'csv') return;

    try {
        const dataset  = csvParser.parse(editor.document.getText());
        const uri      = editor.document.uri;
        const columns  = dataset.getColumns();

        if (cb) {
            cb(dataset, uri, columns);
        } else {
            panel.webview.postMessage({
                type:     'initFileA',
                columns,
                fileName: path.basename(uri.fsPath),
            });
        }
    } catch {
        // Silent — malformed CSV in editor is not a fatal error here
    }
}

/**
 * Show an open-file dialog (or use a provided path), parse the CSV, and
 * return the dataset + URI, or `null` if the user cancelled.
 *
 * @param {string | undefined} filePath   Optional pre-supplied path (unused currently)
 * @returns {Promise<{ dataset: import('../engine/dataset'), uri: vscode.Uri } | null>}
 */
async function pickAndParse(filePath) {
    let fileUri;

    if (filePath) {
        fileUri = vscode.Uri.file(filePath);
    } else {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany:  false,
            filters:        { 'CSV files': ['csv'], 'All files': ['*'] },
            title:          'Select a CSV file',
        });
        if (!uris || uris.length === 0) return null;
        fileUri = uris[0];
    }

    const bytes   = await vscode.workspace.fs.readFile(fileUri);
    const csvText = Buffer.from(bytes).toString('utf8');
    const dataset = csvParser.parse(csvText);

    return { dataset, uri: fileUri };
}

/**
 * Serialise the comparison rows according to the requested format and show
 * a Save dialog.
 *
 * @param {{ format: 'csv'|'json', rows: any[], columnA: string, columnB: string }} msg
 * @param {vscode.WebviewPanel} panel
 * @param {vscode.Uri | undefined} uriA
 */
async function handleExport(msg, panel, uriA) {
    const { format, rows, columnA, columnB } = msg;

    let content;
    let ext;

    if (format === 'json') {
        content = JSON.stringify(rows, null, 2);
        ext     = 'json';
    } else {
        // CSV export: flatten the rows array
        const flat = rows.map(r => ({
            value:    r.value,
            type:     r.type,
            count_A:  r.countA,
            count_B:  r.countB,
            rows_A:   r.rowsA.join(';'),
            rows_B:   r.rowsB.join(';'),
        }));
        content = Papa.unparse(flat);
        ext     = 'csv';
    }

    // Suggest a filename based on File A
    let defaultUri;
    if (uriA) {
        const dir  = path.dirname(uriA.fsPath);
        const stem = path.basename(uriA.fsPath, path.extname(uriA.fsPath));
        defaultUri = vscode.Uri.file(path.join(dir, `${stem}_vs_${columnA}_${columnB}.${ext}`));
    }

    const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: format === 'json'
            ? { 'JSON files': ['json'], 'All files': ['*'] }
            : { 'CSV files': ['csv'],  'All files': ['*'] },
        title: 'Export comparison report',
    });

    if (!saveUri) return;

    await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf8'));

    panel.webview.postMessage({
        type:      'exportDone',
        savedPath: saveUri.fsPath,
    });
}

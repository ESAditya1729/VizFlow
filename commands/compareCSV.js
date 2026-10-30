/**
 * VizFlow: Compare CSV Files (WebView)
 *
 * Opens a WebviewPanel that lets the user:
 *   1. Select File A (active editor or file-picker) and pick a comparison mode
 *   2. Select File B (file-picker)
 *   3. Run a value-set or keyed row comparison with optional normalization
 *   4. See a tabbed, colour-coded report with summary, profiles and details
 *   5. Export as CSV, JSON or Markdown, or jump to a row in the source file
 *
 * host → webview : initFileA | columnsB | compareResult | compareError | exportDone | progress
 * webview → host : loadFileA | loadFileB | runCompare | exportResult | revealRow
 */

'use strict';

const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const Papa = require('papaparse');

const csvParser = require('../services/csvParser');
const csvCompare = require('../services/csvCompare');
const textEncoding = require('../services/textEncoding');

/**
 * Factory — accepts `context` so we can resolve media paths.
 *
 * @param {vscode.ExtensionContext} context
 * @returns {() => Promise<void>}
 */
module.exports = function compareCSVCommand(context) {

    /** @type {vscode.WebviewPanel | undefined} */
    let panel;
    /** @type {import('../engine/dataset') | undefined} */
    let datasetA;
    /** @type {import('../engine/dataset') | undefined} */
    let datasetB;
    let uriA = /** @type {vscode.Uri | undefined} */ (undefined);
    let uriB = /** @type {vscode.Uri | undefined} */ (undefined);

    return async function () {

        // ── 1. Create (or reveal) the panel ────────────────────────────────────
        if (panel) {
            panel.reveal(vscode.ViewColumn.One);
            tryLoadActiveCSV(panel, (dataset, uri, columns) => {
                datasetA = dataset;
                uriA = uri;
                panel.webview.postMessage({
                    type: 'initFileA',
                    columns,
                    fileName: path.basename(uri.fsPath),
                });
            });
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
        const nonce = crypto.randomBytes(16).toString('base64');
        const htmlUri = path.join(context.extensionPath, 'media', 'compare.html');
        let html = fs.readFileSync(htmlUri, 'utf8');

        const cssUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'compare.css')
        ).toString();

        const themeUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'theme.css')
        ).toString();

        const iconUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')
        ).toString();

        const { version } = context.extension.packageJSON;

        html = html
            .split('{{NONCE}}').join(nonce)
            .replace('{{THEME_CSS_URI}}', themeUri)
            .replace('{{WEBVIEW_CSS_URI}}', cssUri)
            .replace('{{ICON_URI}}', iconUri)
            .replace('{{VERSION}}', version);

        panel.webview.html = html;

        // ── 3. Seed File A from the active editor ───────────────────────────────
        setImmediate(() => tryLoadActiveCSV(activePanel, (dataset, uri, columns) => {
            datasetA = dataset;
            uriA = uri;
            activePanel.webview.postMessage({ type: 'initFileA', columns, fileName: path.basename(uri.fsPath) });
        }));

        // ── 5. Message handler ──────────────────────────────────────────────────
        panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {

                // User clicked "Browse…" for File A
                case 'loadFileA': {
                    const result = await pickAndParse(msg);
                    if (!result) return;
                    datasetA = result.dataset;
                    uriA = result.uri;
                    activePanel.webview.postMessage({
                        type: 'initFileA',
                        columns: result.dataset.getColumns(),
                        fileName: path.basename(result.uri.fsPath),
                    });
                    break;
                }

                // User clicked "Browse…" for File B
                case 'loadFileB': {
                    const result = await pickAndParse(msg);
                    if (!result) return;
                    datasetB = result.dataset;
                    uriB = result.uri;
                    activePanel.webview.postMessage({
                        type: 'columnsB',
                        columns: result.dataset.getColumns(),
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
                        const result = csvCompare.compareDatasets(datasetA, datasetB, {
                            mode: msg.mode,
                            columnA: msg.columnA,
                            columnB: msg.columnB,
                            keyColumnsA: msg.keyColumnsA,
                            keyColumnsB: msg.keyColumnsB,
                            compareColumns: msg.compareColumns,
                            includeEmpty: msg.includeEmpty,
                            normalization: msg.normalization,
                            onProgress: pct => activePanel.webview.postMessage({ type: 'progress', pct }),
                        });
                        activePanel.webview.postMessage({ type: 'compareResult', result });
                    } catch (err) {
                        activePanel.webview.postMessage({
                            type: 'compareError',
                            message: err instanceof Error ? err.message : String(err),
                        });
                    }
                    break;
                }

                // User clicked an export button
                case 'exportResult': {
                    await handleExport(msg, activePanel, uriA);
                    break;
                }

                // User clicked a row number to jump to the source file
                case 'revealRow': {
                    await revealRow(msg, uriA, uriB);
                    break;
                }
            }
        }, undefined, context.subscriptions);

        // ── 6. Cleanup ──────────────────────────────────────────────────────────
        panel.onDidDispose(() => {
            panel = undefined;
            datasetA = undefined;
            datasetB = undefined;
            uriA = undefined;
            uriB = undefined;
        }, undefined, context.subscriptions);
    };
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * If there is an active CSV editor, parse it and call `cb` with the result.
 * If no callback is provided, posts directly to the panel.
 *
 * @param {vscode.WebviewPanel} panel
 * @param {((dataset: any, uri: vscode.Uri, columns: string[]) => void) | undefined} [cb]
 */
function tryLoadActiveCSV(panel, cb) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'csv') return;

    try {
        const dataset = csvParser.parse(editor.document.getText());
        const uri = editor.document.uri;
        const columns = dataset.getColumns();

        if (cb) {
            cb(dataset, uri, columns);
        } else {
            panel.webview.postMessage({
                type: 'initFileA',
                columns,
                fileName: path.basename(uri.fsPath),
            });
        }
    } catch {
        // Silent — malformed CSV in editor is not a fatal error here
    }
}

/**
 * Show an open-file dialog (or use a provided path), decode and parse the CSV.
 *
 * @param {{ filePath?: string, encoding?: string, delimiter?: string }} msg
 * @returns {Promise<{ dataset: import('../engine/dataset'), uri: vscode.Uri } | null>}
 */
async function pickAndParse(msg) {
    let fileUri;

    if (msg.filePath) {
        fileUri = vscode.Uri.file(msg.filePath);
    } else {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'CSV / TSV files': ['csv', 'tsv', 'txt'], 'All files': ['*'] },
            title: 'Select a delimited text file',
        });
        if (!uris || uris.length === 0) return null;
        fileUri = uris[0];
    }

    const bytes = await vscode.workspace.fs.readFile(fileUri);
    const decoded = textEncoding.decodeBuffer(Buffer.from(bytes), msg.encoding);
    const dataset = csvParser.parse(decoded.text, { delimiter: msg.delimiter });

    return { dataset, uri: fileUri };
}

/**
 * Serialize a comparison row for flat CSV/JSON export.
 *
 * @param {any} row
 * @param {'values'|'rows'} mode
 * @returns {Object}
 */
function serializeRow(row, mode) {
    if (mode === 'rows') {
        return {
            type: row.type,
            key: row.value,
            count_A: row.countA,
            count_B: row.countB,
            rows_A: row.rowsA.join(';'),
            rows_B: row.rowsB.join(';'),
            changed_columns: (row.changes || []).map(change => change.columnA).join(';'),
            changes: (row.changes || [])
                .map(change => `${change.columnA}: ${change.valueA} -> ${change.valueB}`)
                .join(' | '),
        };
    }

    return {
        type: row.type,
        value: row.value,
        count_A: row.countA,
        count_B: row.countB,
        rows_A: row.rowsA.join(';'),
        rows_B: row.rowsB.join(';'),
        blank: row.isBlank === true,
    };
}

/**
 * @param {any} result
 * @param {any[]} rows
 * @returns {Object}
 */
function buildMetadata(result, rows) {
    return {
        generatedBy: 'VizFlow',
        generatedAt: new Date().toISOString(),
        mode: result.mode,
        columnA: result.columnA || null,
        columnB: result.columnB || null,
        keyColumnsA: result.keyColumnsA || null,
        keyColumnsB: result.keyColumnsB || null,
        compareColumns: result.compareColumns || null,
        normalization: result.normalization,
        includeEmpty: result.includeEmpty,
        totalRowsA: result.totalRowsA,
        totalRowsB: result.totalRowsB,
        matchCount: result.matchCount,
        onlyACount: result.onlyACount,
        onlyBCount: result.onlyBCount,
        addedCount: result.addedCount,
        removedCount: result.removedCount,
        changedCount: result.changedCount,
        unchangedCount: result.unchangedCount,
        warnings: result.warnings || [],
        exportedRowCount: rows.length,
    };
}

/**
 * @param {string} value
 * @returns {string}
 */
function markdownCell(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, ' ');
}

/**
 * @param {any} result
 * @param {any[]} rows
 * @returns {string}
 */
function buildMarkdown(result, rows) {
    const metadata = buildMetadata(result, rows);
    const lines = [
        '# VizFlow CSV Comparison Report',
        '',
        `- Mode: **${metadata.mode}**`,
        `- Generated: ${metadata.generatedAt}`,
        `- File A rows: ${metadata.totalRowsA}`,
        `- File B rows: ${metadata.totalRowsB}`,
        '',
        '## Summary',
        '',
        '| Metric | Count |',
        '|---|---:|',
        `| Matched / unchanged | ${metadata.matchCount} |`,
        `| Only in A / removed | ${metadata.onlyACount} |`,
        `| Only in B / added | ${metadata.onlyBCount} |`,
        `| Changed | ${metadata.changedCount} |`,
        '',
        '## Rows',
        '',
    ];

    if (metadata.mode === 'rows') {
        lines.push('| Type | Key | Count A | Count B | Rows A | Rows B | Changes |');
        lines.push('|---|---|---:|---:|---|---|---|');
        for (const row of rows) {
            lines.push([
                row.type,
                markdownCell(row.value),
                row.countA,
                row.countB,
                markdownCell(row.rowsA.join(', ')),
                markdownCell(row.rowsB.join(', ')),
                markdownCell((row.changes || []).map(change => `${change.columnA}: ${change.valueA} -> ${change.valueB}`).join('; ')),
            ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
        }
    } else {
        lines.push('| Type | Value | Count A | Count B | Rows A | Rows B |');
        lines.push('|---|---|---:|---:|---|---|');
        for (const row of rows) {
            lines.push([
                row.type,
                markdownCell(row.value),
                row.countA,
                row.countB,
                markdownCell(row.rowsA.join(', ')),
                markdownCell(row.rowsB.join(', ')),
            ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
        }
    }

    if (metadata.warnings.length > 0) {
        lines.push('', '## Warnings', '');
        metadata.warnings.forEach(warning => lines.push(`- ${warning}`));
    }

    return lines.join('\n');
}

/**
 * Serialise the comparison rows according to the requested format and show
 * a Save dialog.
 *
 * @param {{ format: 'csv'|'json'|'markdown', rows: any[], result: any }} msg
 * @param {vscode.WebviewPanel} panel
 * @param {vscode.Uri | undefined} uriA
 */
async function handleExport(msg, panel, uriA) {
    const { format, rows, result } = msg;

    if (!result || !Array.isArray(rows)) {
        panel.webview.postMessage({ type: 'compareError', message: 'No comparison result to export.' });
        return;
    }

    const metadata = buildMetadata(result, rows);
    const flatRows = rows.map(row => serializeRow(row, result.mode));

    let content;
    let ext;
    let filters;

    if (format === 'json') {
        content = JSON.stringify({ metadata, rows: flatRows }, null, 2);
        ext = 'json';
        filters = { 'JSON files': ['json'], 'All files': ['*'] };
    } else if (format === 'markdown') {
        content = buildMarkdown(result, rows);
        ext = 'md';
        filters = { 'Markdown files': ['md'], 'All files': ['*'] };
    } else {
        content = Papa.unparse(flatRows);
        ext = 'csv';
        filters = { 'CSV files': ['csv'], 'All files': ['*'] };
    }

    // Suggest a filename based on File A
    let defaultUri;
    if (uriA) {
        const dir = path.dirname(uriA.fsPath);
        const stem = path.basename(uriA.fsPath, path.extname(uriA.fsPath));
        const suffix = result.mode === 'rows'
            ? `${result.keyColumnsA ? result.keyColumnsA.join('_') : 'rows'}`
            : `${result.columnA}_vs_${result.columnB}`;
        defaultUri = vscode.Uri.file(path.join(dir, `${stem}_vs_${suffix}.${ext}`));
    }

    const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters,
        title: 'Export comparison report',
    });

    if (!saveUri) return;

    await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf8'));

    panel.webview.postMessage({
        type: 'exportDone',
        savedPath: saveUri.fsPath,
    });
}

/**
 * Open the source file and reveal the requested data row.
 *
 * @param {{ file: 'A'|'B', row: number }} msg
 * @param {vscode.Uri | undefined} uriA
 * @param {vscode.Uri | undefined} uriB
 */
async function revealRow(msg, uriA, uriB) {
    const target = msg.file === 'B' ? uriB : uriA;
    if (!target) return;

    const row = Number(msg.row);
    if (!Number.isFinite(row) || row < 1) return;

    const document = await vscode.workspace.openTextDocument(target);
    const line = Math.min(Math.max(row, 0), Math.max(document.lineCount - 1, 0));
    const position = new vscode.Position(line, 0);
    await vscode.window.showTextDocument(document, {
        preview: true,
        selection: new vscode.Range(position, position),
    });
}

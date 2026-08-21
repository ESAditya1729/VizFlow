/**
 * VizFlow: Transform Columns (WebView)
 *
 * Opens a WebviewPanel that lets the user build a queue of transformation
 * rules — each rule targets one column with one operation — then preview
 * and apply the entire queue in one shot.
 *
 *   1. Pick a column + operation + params → "Add Rule"  (repeat as needed)
 *   2. Reorder or remove queued rules
 *   3. "Preview" → runs all rules sequentially on first 5 rows, shows table
 *   4. "Apply & Save" → applies to all rows, writes Output, offers Save dialog
 *
 * The extension host ↔ WebView bridge uses postMessage exclusively:
 *   host → webview : init | previewQueueResult | previewQueueError | applyQueueDone | applyQueueError
 *   webview → host : previewQueue | applyQueue
 */

const vscode   = require('vscode');
const path     = require('path');
const crypto   = require('crypto');
const fs       = require('fs');
const Papa     = require('papaparse');

const csvReader  = require('../services/csvReader');
const csvParser  = require('../services/csvParser');
const output     = require('../services/output');
const { OPERATIONS }                          = require('../engine/expressions/operations');
const { previewFirst, evaluate, evaluateRows } = require('../engine/expressions/evaluator');

/**
 * Factory — returns the actual command function.
 * Accepts `context` so we can resolve the path to media/transform.html.
 *
 * @param {vscode.ExtensionContext} context
 * @returns {() => Promise<void>}
 */
module.exports = function transformWebviewCommand(context) {

    /** @type {vscode.WebviewPanel | undefined} */
    let panel;

    return async function () {

        // ── 1. Load and parse the active CSV ──────────────────────────────
        const csvText = await csvReader.load();
        if (!csvText) {
            return;
        }

        // Capture the source file URI now (while the editor is active).
        // This is used later to suggest a save location.
        const sourceUri = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.document.uri
            : undefined;

        const dataset = csvParser.parse(csvText);

        // ── 2. If panel already open, just re-send fresh init data ────────
        if (panel) {
            panel.reveal(vscode.ViewColumn.Beside);
            sendInit(panel.webview, dataset);
            return;
        }

        // ── 3. Create the WebviewPanel ─────────────────────────────────────
        panel = vscode.window.createWebviewPanel(
            'vizflowTransform',
            'VizFlow: Transform Column',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                        vscode.Uri.joinPath(context.extensionUri, 'media'),
                        vscode.Uri.joinPath(context.extensionUri, 'images')
                    ]
            }
        );

        // ── 4. Load HTML, inject placeholders, set on panel ───────────────
        const nonce   = crypto.randomBytes(16).toString('base64');
        const htmlUri = path.join(context.extensionPath, 'media', 'transform.html');
        let html      = fs.readFileSync(htmlUri, 'utf8');

        // Convert the CSS file path to a WebView-safe URI the browser can load
        const cssUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'transform.css')
        ).toString();

        const themeUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'theme.css')
        ).toString();

        // Convert the icon path to a WebView-safe URI
        const iconUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')
        ).toString();

        // Read version from package.json once
        const { version } = require('../package.json');

        html = html
            .split('{{NONCE}}').join(nonce)
            .replace('{{THEME_CSS_URI}}', themeUri)
            .replace('{{WEBVIEW_CSS_URI}}', cssUri)
            .replace('{{ICON_URI}}', iconUri)
            .replace('{{VERSION}}', version);

        panel.webview.html = html;

        // ── 5. Send initial column + operations catalogue ──────────────────
        // Give the WebView a moment to register its message listener
        // before posting — a short setImmediate is enough.
        setImmediate(() => sendInit(panel.webview, dataset));

        // ── 6. Handle messages from the WebView ────────────────────────────
        panel.webview.onDidReceiveMessage(
            msg => handleMessage(msg, panel, dataset, sourceUri),
            undefined,
            context.subscriptions
        );

        // ── 7. Clean up when the panel is closed ───────────────────────────
        panel.onDidDispose(() => {
            panel = undefined;
        }, undefined, context.subscriptions);
    };
};

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Post the `init` message with columns and operations catalogue.
 *
 * @param {vscode.Webview} webview
 * @param {import('../engine/dataset')} dataset
 */
function sendInit(webview, dataset) {
    const operations = Object.entries(OPERATIONS).map(([key, op]) => ({
        key,
        label:    op.label,
        category: op.category,
        params:   op.params,
    }));

    webview.postMessage({
        type:       'init',
        columns:    dataset.getColumns(),
        rowCount:   dataset.getRowCount(),
        operations,
    });
}

/**
 * @typedef {{ column: string, opKey: string, params: string[], rowScope: 'all'|'selected', rowIndices: number[] }} Rule
 */

/**
 * Route an incoming message from the WebView to the right handler.
 *
 * @param {{ type: string, rules: Rule[] }} msg
 * @param {vscode.WebviewPanel} panel
 * @param {import('../engine/dataset')} dataset
 * @param {vscode.Uri | undefined} sourceUri
 */
function handleMessage(msg, panel, dataset, sourceUri) {

    if (msg.type === 'previewQueue') {
        handlePreviewQueue(msg, panel, dataset);
        return;
    }

    if (msg.type === 'applyQueue') {
        handleApplyQueue(msg, panel, dataset, sourceUri);
        return;
    }
}

/**
 * Apply each rule in sequence on the first 5 rows and send the per-rule
 * before/after data back to the WebView for display.
 *
 * @param {{ rules: Rule[] }} msg
 * @param {vscode.WebviewPanel} panel
 * @param {import('../engine/dataset')} dataset
 */
function handlePreviewQueue(msg, panel, dataset) {
    try {
        if (!msg.rules || msg.rules.length === 0) {
            panel.webview.postMessage({
                type:    'previewQueueError',
                message: 'No rules defined. Add at least one transformation rule.',
            });
            return;
        }

        const limit = 5;
        // workingRows is the "running" state — each rule sees results of the previous
        let workingRows = dataset.rows.slice(0, limit);

        /**
         * For each rule we capture: column, opLabel, rowScope info.
         * @type {{ column: string, opLabel: string, rowScope: string }[]}
         */
        const previewCols = [];

        /**
         * rows[rowIndex][ruleIndex] = { original, result, skipped }
         * @type {{ original: any, result: any, skipped: boolean }[][]}
         */
        const perRowEntries = Array.from({ length: workingRows.length }, () => []);

        for (const rule of msg.rules) {
            const op = OPERATIONS[rule.opKey];

            /** @type {{ row: object, original: any, result: any, skipped: boolean }[]} */
            let entries;

            if (rule.rowScope === 'selected' && rule.rowIndices && rule.rowIndices.length > 0) {
                // Remap the requested (1-based) global indices to 0-based positions
                // within the preview slice (rows 0..limit-1).
                const previewIndices = rule.rowIndices
                    .map(n => n - 1)          // convert to 0-based
                    .filter(n => n >= 0 && n < workingRows.length);

                entries = evaluateRows(workingRows, previewIndices, rule.column, rule.opKey, rule.params);
            } else {
                entries = previewFirst(workingRows, rule.column, rule.opKey, rule.params, limit);
            }

            previewCols.push({
                column:   rule.column,
                opLabel:  op ? op.label : rule.opKey,
                rowScope: rule.rowScope === 'selected'
                    ? `rows ${(rule.rowIndices || []).join(', ')}`
                    : 'all rows',
            });

            entries.forEach((entry, rowIdx) => {
                perRowEntries[rowIdx].push({
                    original: entry.original,
                    result:   entry.result,
                    skipped:  entry.skipped,
                });
            });

            // Feed results forward so the next rule sees the (possibly partial) transform
            workingRows = entries.map(e => ({ ...e.row, [rule.column]: e.result }));
        }

        panel.webview.postMessage({
            type:        'previewQueueResult',
            previewCols,
            rows:        perRowEntries,
            ruleCount:   msg.rules.length,
        });

    } catch (err) {
        panel.webview.postMessage({
            type:    'previewQueueError',
            message: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Apply every rule in sequence across all rows, write a summary to the Output
 * Channel, offer to save the transformed CSV, and reply to the WebView.
 *
 * @param {{ rules: Rule[] }} msg
 * @param {vscode.WebviewPanel} panel
 * @param {import('../engine/dataset')} dataset
 * @param {vscode.Uri | undefined} sourceUri
 */
async function handleApplyQueue(msg, panel, dataset, sourceUri) {
    try {
        if (!msg.rules || msg.rules.length === 0) {
            panel.webview.postMessage({
                type:    'applyQueueError',
                message: 'No rules defined. Add at least one transformation rule.',
            });
            return;
        }

        let workingRows = [...dataset.rows];

        output.clear();
        output.writeHeader(`Transform Result — ${msg.rules.length} rule(s) applied`);
        output.writeLine('');

        // Apply each rule in sequence, printing a small summary per rule
        for (const rule of msg.rules) {
            const op = OPERATIONS[rule.opKey];

            /** @type {{ row: object, original: any, result: any, skipped: boolean }[]} */
            let allResults;
            let scopeLabel;

            if (rule.rowScope === 'selected' && rule.rowIndices && rule.rowIndices.length > 0) {
                // Convert 1-based user indices to 0-based dataset indices
                const zeroIndices = rule.rowIndices.map(n => n - 1).filter(n => n >= 0 && n < workingRows.length);
                allResults = evaluateRows(workingRows, zeroIndices, rule.column, rule.opKey, rule.params);
                scopeLabel = `rows ${rule.rowIndices.join(', ')}`;
            } else {
                allResults = evaluate(workingRows, rule.column, rule.opKey, rule.params);
                scopeLabel = 'all rows';
            }

            const origHeader = `${rule.column} (original)`;
            const resHeader  = `${rule.column} → ${op ? op.label : rule.opKey}`;
            const origWidth  = Math.max(origHeader.length, ...allResults.map(e => String(e.original).length));
            const resWidth   = Math.max(resHeader.length,  ...allResults.map(e => String(e.result).length));

            const hr  = `  ${'─'.repeat(origWidth + resWidth + 7)}`;
            const fmtRow = (/** @type {string} */ a, /** @type {string} */ b) =>
                `  │ ${a.padEnd(origWidth)} │ ${b.padEnd(resWidth)} │`;

            output.writeSubHeader(
                `Rule: ${op ? op.label : rule.opKey} on "${rule.column}" [scope: ${scopeLabel}]` +
                (rule.params.length ? ` [params: ${rule.params.join(', ')}]` : '')
            );
            output.writeLine(hr);
            output.writeLine(fmtRow(origHeader, resHeader));
            output.writeLine(hr);

            for (const entry of allResults) {
                const marker = entry.skipped ? ' (skipped)' : '';
                output.writeLine(fmtRow(String(entry.original), String(entry.result) + marker));
            }

            output.writeLine(hr);
            output.writeLine('');

            // Feed results forward (skipped rows keep their original value)
            workingRows = allResults.map(entry => ({ ...entry.row, [rule.column]: entry.result }));
        }

        output.writeSuccess(`${workingRows.length} rows processed across ${msg.rules.length} rule(s).`);
        output.show();

        // Offer to save the final transformed CSV
        const savedPath = await saveTransformedCsv(workingRows, dataset.getColumns(), sourceUri);

        panel.webview.postMessage({
            type:      'applyQueueDone',
            count:     workingRows.length,
            ruleCount: msg.rules.length,
            saved:     savedPath !== null,
            savedPath: savedPath || undefined,
        });

    } catch (err) {
        panel.webview.postMessage({
            type:    'applyQueueError',
            message: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Serialise `rows` to CSV and show a Save dialog pre-filled with
 * `<original-stem>_transformed.csv` in the same directory as `sourceUri`.
 * Returns the saved path string on success, or null if the user cancelled.
 *
 * @param {Record<string, any>[]} rows       - Transformed rows (plain objects)
 * @param {string[]}              columns    - Column order (preserved from original)
 * @param {vscode.Uri | undefined} sourceUri - URI of the original CSV file
 * @returns {Promise<string | null>}
 */
async function saveTransformedCsv(rows, columns, sourceUri) {
    // ── Build suggested save URI ──────────────────────────────────────────────
    let defaultUri;
    if (sourceUri) {
        const dir      = path.dirname(sourceUri.fsPath);
        const ext      = path.extname(sourceUri.fsPath);                  // e.g. ".csv"
        const stem     = path.basename(sourceUri.fsPath, ext);            // e.g. "data"
        const suggestedName = `${stem}_transformed${ext || '.csv'}`;
        defaultUri = vscode.Uri.file(path.join(dir, suggestedName));
    }

    // ── Show native Save dialog ───────────────────────────────────────────────
    const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'CSV files': ['csv'], 'All files': ['*'] },
        title:   'Save transformed CSV',
    });

    if (!saveUri) {
        // User dismissed the dialog — not an error, just skipped.
        return null;
    }

    // ── Serialise to CSV (columns in original order) ──────────────────────────
    const csvText = Papa.unparse(rows, { columns });

    await vscode.workspace.fs.writeFile(
        saveUri,
        Buffer.from(csvText, 'utf8')
    );

    return saveUri.fsPath;
}

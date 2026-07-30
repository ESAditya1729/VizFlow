/**
 * VizFlow: Transform Column
 *
 * Guides the user through:
 *   1. Pick a column
 *   2. Pick an operation  (grouped by category: Numeric / String / Conditional)
 *   3. Supply each required parameter via an input box
 *   4. Shows a 5-row preview in the Output Channel
 *   5. Asks "Apply to all rows?" — prints the full result table to the Output Channel
 */

const vscode = require('vscode');
const csvReader = require('../services/csvReader');
const csvParser = require('../services/csvParser');
const output = require('../services/output');
const { OPERATIONS } = require('../engine/expressions/operations');
const { previewFirst, evaluate, formatPreviewLine } = require('../engine/expressions/evaluator');

module.exports = async function transformCommand() {

    try {

        // ── 1. Load & parse the active CSV ──────────────────────────────────
        const csvText = await csvReader.load();
        if (!csvText) {
            return;
        }

        const dataset = csvParser.parse(csvText);

        // ── 2. Pick a column ─────────────────────────────────────────────────
        const selectedColumn = await vscode.window.showQuickPick(
            dataset.getColumns(),
            { placeHolder: "Select a column to transform" }
        );
        if (!selectedColumn) {
            return;
        }

        // ── 3. Pick an operation (grouped by category) ───────────────────────
        /** @type {vscode.QuickPickItem[]} */
        const opItems = Object.entries(OPERATIONS).map(([key, op]) => ({
            label: op.label,
            description: op.category,
            detail: op.params.length
                ? `Parameters: ${op.params.map(p => p.name).join(', ')}`
                : 'No extra parameters needed',
            // stash the key so we can retrieve it after the pick
            _key: key,
        }));

        const selectedOpItem = /** @type {{ label:string, _key:string } | undefined} */ (
            await vscode.window.showQuickPick(opItems, {
                placeHolder: `Choose an operation to apply to "${selectedColumn}"`,
                matchOnDescription: true,
                matchOnDetail: true,
            })
        );
        if (!selectedOpItem) {
            return;
        }

        const opKey = /** @type {string} */ (selectedOpItem._key);
        const op = OPERATIONS[opKey];

        // ── 4. Collect parameters ────────────────────────────────────────────
        /** @type {string[]} */
        const rawParams = [];

        for (const param of op.params) {
            // Optional params have "(optional)" in their placeholder
            const isOptional = param.placeholder.includes('optional');

            const value = await vscode.window.showInputBox({
                prompt: `${op.label} — ${param.name}`,
                placeHolder: param.placeholder,
                ignoreFocusOut: true,
            });

            // User pressed Escape
            if (value === undefined) {
                return;
            }

            // Skip truly optional params when left blank
            if (value === '' && isOptional) {
                break;
            }

            rawParams.push(value);
        }

        // ── 5. Preview (first 5 rows) ────────────────────────────────────────
        const previewRows = previewFirst(dataset.rows, selectedColumn, opKey, rawParams);

        output.clear();
        output.writeHeader(`Transform Preview — ${op.label} on "${selectedColumn}"`);
        output.writeSubHeader(`Operation: ${op.label}  |  Column: ${selectedColumn}  |  Params: [${rawParams.join(', ') || 'none'}]`);
        output.writeLine('First 5 rows:');
        output.writeLine('');

        for (const entry of previewRows) {
            output.writeLine(formatPreviewLine(entry, selectedColumn, opKey));
        }

        output.writeLine('');
        output.writeSeparator();
        output.show();

        // ── 6. Ask whether to apply to all rows ──────────────────────────────
        const confirm = await vscode.window.showInformationMessage(
            `Apply "${op.label}" to all ${dataset.getRowCount()} rows in "${selectedColumn}"?`,
            { modal: false },
            'Apply to all rows',
            'Cancel'
        );

        if (confirm !== 'Apply to all rows') {
            return;
        }

        // ── 7. Evaluate full dataset and print result table ──────────────────
        const allResults = evaluate(dataset.rows, selectedColumn, opKey, rawParams);

        output.clear();
        output.writeHeader(`Transform Result — ${op.label} on "${selectedColumn}"`);
        output.writeSubHeader(`Rows processed: ${allResults.length}`);
        output.writeLine('');

        // Column-width formatting for a simple table
        const origHeader = `${selectedColumn} (original)`;
        const resHeader  = `${selectedColumn} (result)`;
        const origWidth  = Math.max(origHeader.length, ...allResults.map(e => String(e.original).length));
        const resWidth   = Math.max(resHeader.length,  ...allResults.map(e => String(e.result).length));

        const hr = `  ${'─'.repeat(origWidth + resWidth + 7)}`;
        const row = (/** @type {string} */ a, /** @type {string} */ b) =>
            `  │ ${a.padEnd(origWidth)} │ ${b.padEnd(resWidth)} │`;

        output.writeLine(hr);
        output.writeLine(row(origHeader, resHeader));
        output.writeLine(hr);

        for (const entry of allResults) {
            output.writeLine(row(String(entry.original), String(entry.result)));
        }

        output.writeLine(hr);
        output.writeLine('');
        output.writeSuccess(`${allResults.length} rows transformed successfully.`);
        output.show();

    } catch (error) {
        vscode.window.showErrorMessage(
            error instanceof Error ? error.message : String(error)
        );
    }

};

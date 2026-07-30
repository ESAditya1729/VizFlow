const vscode = require('vscode');
const csvReader = require('../services/csvReader');
const csvParser = require('../services/csvParser');

module.exports = async function (/** @type {string} */ operation) {

    try {

        const csvText = await csvReader.load();

        if (!csvText) {
            return;
        }

        const dataset = csvParser.parse(csvText);
        // Count can work on any column, others only on numeric columns
        const columns =
            operation === "count"
                ? dataset.getColumns()
                : dataset.getNumericColumns();

        const selectedColumn = await vscode.window.showQuickPick(
            columns,
            {
                placeHolder: `Select a column for ${operation}`
            }
        );

        if (!selectedColumn) {
            return;
        }

        // @ts-ignore
        const result = dataset[operation](selectedColumn);

        vscode.window.showInformationMessage(
            `${operation.toUpperCase()} of '${selectedColumn}' = ${result}`
        );

    } catch (error) {
    
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    
        }

};
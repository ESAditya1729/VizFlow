const vscode = require('vscode');
const csvReader = require('../services/csvReader');
const csvParser = require('../services/csvParser');

module.exports = async function () {

    try {

        const csvText = await csvReader.load();

        if (!csvText) {
            return;
        }

        const dataset = csvParser.parse(csvText);

        const selectedColumn = await vscode.window.showQuickPick(
            dataset.getNumericColumns(),
            {
                placeHolder: "Select a numeric column"
            }
        );

        if (!selectedColumn) {
            return;
        }

        const avg = dataset.average(selectedColumn);

        vscode.window.showInformationMessage(
            `Average of '${selectedColumn}' = ${avg}`
        );

    }
    catch (error) {
    
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    
        }

};
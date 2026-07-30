const vscode = require('vscode');
const csvReader = require('../services/csvReader');
const csvParser = require('../services/csvParser');

module.exports = async function () {

    try {

        // Read the active CSV file
        const csvText = await csvReader.load();

        if (!csvText) {
            return;
        }

        // Parse the CSV into a Dataset object
        const dataset = csvParser.parse(csvText);

        // Ask the user to choose a column
        const selectedColumn = await vscode.window.showQuickPick(
            dataset.getNumericColumns(),
            {
                placeHolder: "Select a numeric column"
            }
        );

        if (!selectedColumn) {
            return;
        }

        // Calculate the sum
        const total = dataset.sum(selectedColumn);

        // Display the result
        vscode.window.showInformationMessage(
            `Sum of '${selectedColumn}' = ${total}`
        );

    } catch (error) {
    
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    
        }

};
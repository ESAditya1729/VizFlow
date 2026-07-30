const vscode = require('vscode');
const csvReader = require('../services/csvReader');
const csvParser = require('../services/csvParser');
const output = require('../services/output');

module.exports = async function () {

    try {

        const csvText = await csvReader.load();

        if (!csvText) {
            return;
        }

        const dataset = csvParser.parse(csvText);

        const selectedColumn = await vscode.window.showQuickPick(
            dataset.getColumns(),
            {
                placeHolder: 'Select a column'
            }
        );

        if (!selectedColumn) {
            return;
        }

        const stats = dataset.profileColumn(selectedColumn);

        output.clear();

        output.writeHeader("VizFlow - Column Statistics");
        output.writeLine("");
        output.writeLine(`Column : ${selectedColumn}`);
        output.writeLine("");

        output.writeLine(`Count              : ${stats.count}`);
        output.writeLine(`Sum                : ${stats.sum}`);
        output.writeLine(`Average            : ${stats.average}`);
        output.writeLine(`Minimum            : ${stats.min}`);
        output.writeLine(`Maximum            : ${stats.max}`);
        output.writeLine("");
        output.writeLine(`Duplicate Values   : ${stats.duplicateValues}`);
        output.writeLine(`Duplicate Rows     : ${stats.duplicateRows}`);

        output.show();

    }
    catch (error) {
    
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    
        }

};
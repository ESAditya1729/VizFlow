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

        const duplicates = dataset.findDuplicates(selectedColumn);

        output.clear();

        output.writeHeader('VizFlow - Duplicate Report');
        output.writeLine('');
        output.writeLine(`Column : ${selectedColumn}`);
        output.writeLine('');

        if (duplicates.length === 0) {

            output.writeLine('No duplicate values found.');

        } else {

            output.writeLine(
                'Value'.padEnd(25) +
                'Count'.padEnd(10) +
                'Rows'
            );

            output.writeSeparator();

            let duplicateRows = 0;

            duplicates.forEach(item => {

                duplicateRows += item.rows.length;

                output.writeLine(
                    String(item.value).padEnd(25) +
                    String(item.count).padEnd(10) +
                    item.rows.join(', ')
                );

            });

            output.writeSeparator();

            output.writeLine(`Duplicate Values : ${duplicates.length}`);
            output.writeLine(`Duplicate Rows   : ${duplicateRows}`);

        }

        output.show();

    }
    catch (error) {
    
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    
        }

};
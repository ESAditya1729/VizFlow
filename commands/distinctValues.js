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
                placeHolder: "Select a column"
            }
        );

        if (!selectedColumn) {
            return;
        }

        /**
         * @type {{
         *   values: string[],
         *   count: number
         * }}
         */
        const result = dataset.distinctValues(selectedColumn);

        output.clear();

        output.writeHeader("Distinct Values");

        output.writeStats("Column", selectedColumn);
        output.writeStats("Distinct Count", result.count);

        output.writeSeparator();

        result.values.forEach(value => {
            output.writeLine(String(value));
        });

        output.show();

    }
    catch (error) {

        vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));

    }

};
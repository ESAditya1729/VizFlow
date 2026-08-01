const vscode = require('vscode');
const sumCommand = require('./commands/sum');
const averageCommand = require('./commands/average');
const aggregate = require('./commands/aggregate');
const duplicateCommand = require('./commands/duplicate');
const statsCommand = require('./commands/statistics');
const distinctValuesCommand = require('./commands/distinctValues');
const transformCommand = require('./commands/transform');
const transformWebviewCommand = require('./commands/transformWebview');
const compareCSVCommand       = require('./commands/compareCSV');
const aboutCommand            = require('./commands/about');

/**
 * @param {vscode.ExtensionContext} context
 */

function activate(context) {

    context.subscriptions.push(

        vscode.commands.registerCommand(
            'vizflow.sum',
            sumCommand
        ),
        vscode.commands.registerCommand(
            'vizflow.average',
            averageCommand
        ),
        vscode.commands.registerCommand(
            'vizflow.min',
            () => aggregate("min")
        ),

        vscode.commands.registerCommand(
            'vizflow.max',
            () => aggregate("max")
        ),

        vscode.commands.registerCommand(
            'vizflow.count',
            () => aggregate("count")
        ),

        vscode.commands.registerCommand(
            'vizflow.duplicates',
            duplicateCommand
        ),
        vscode.commands.registerCommand(
            'vizflow.statistics',
            statsCommand
        ),
        vscode.commands.registerCommand(
            'vizflow.distinctValues',
            distinctValuesCommand
        ),

        vscode.commands.registerCommand(
            'vizflow.transform',
            transformCommand
        ),

        vscode.commands.registerCommand(
            'vizflow.transformWebview',
            transformWebviewCommand(context)
        ),

        vscode.commands.registerCommand(
            'vizflow.compareCSV',
            compareCSVCommand(context)
        ),

        vscode.commands.registerCommand(
            'vizflow.about',
            aboutCommand(context)
        )

    );
}

function deactivate() { }

module.exports = {
    activate,
    deactivate
};
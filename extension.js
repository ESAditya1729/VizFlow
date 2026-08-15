const vscode = require('vscode');
const path = require('path');
const sumCommand = require('./commands/sum');
const averageCommand = require('./commands/average');
const aggregate = require('./commands/aggregate');
const duplicateCommand = require('./commands/duplicate');
const statsCommand = require('./commands/statistics');
const distinctValuesCommand = require('./commands/distinctValues');
const transformCommand = require('./commands/transform');
const transformWebviewCommand = require('./commands/transformWebview');
const compareCSVCommand = require('./commands/compareCSV');
const aboutCommand = require('./commands/about');
const dashboardCommand = require('./commands/dashboard');
const chartsCommand = require('./commands/charts');
const rbqlCommand = require('./commands/rbql');
const workflowBuilderCommand  = require('./commands/workflowBuilder');
const schedulerCommand        = require('./commands/scheduler');
const { getScheduler } = require('./engine/scheduler/schedulerEngine');
const { SchedulerStore } = require('./engine/scheduler/schedulerStore');

/**
 * @param {vscode.ExtensionContext} context
 */

function activate(context) {

    // ─── Auto-start the scheduler on activation ─────────────────────────
    // Scheduled jobs must fire from extension startup — not only after the
    // Scheduler panel is opened. Jobs are persisted under globalStorageUri so
    // they survive extension updates and do not depend on the (often
    // read-only) install folder. Any legacy config in the extension folder is
    // migrated on first run.
    const schedulerEngine = getScheduler();
    const schedulerConfigPath = path.join(context.globalStorageUri.fsPath, 'scheduler-config.json');
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceRoot = workspaceFolders && workspaceFolders.length > 0
        ? workspaceFolders[0].uri.fsPath
        : null;
    schedulerEngine.initialize(schedulerConfigPath, {
        baseDir: workspaceRoot || context.extensionPath,
        store: new SchedulerStore(schedulerConfigPath),
        migrateFrom: path.join(context.extensionPath, 'scheduler-config.json')
    });

    // ─── Create scheduler command instance ────────────────────────────
    const scheduler = schedulerCommand(context);

    // ─── Create wrapper functions for scheduler sub-commands ──────────
    const quickSchedule = (uri) => scheduler('quickSchedule', uri);
    const showRunning = () => scheduler('showRunning');
    const stopJob = () => scheduler('stopJob');

    context.subscriptions.push(

        // ─── Analytics Commands ────────────────────────────────────────
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

        // ─── Data Quality Commands ─────────────────────────────────────
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

        // ─── Transformation Commands ──────────────────────────────────
        vscode.commands.registerCommand(
            'vizflow.transform',
            transformCommand
        ),
        vscode.commands.registerCommand(
            'vizflow.transformWebview',
            transformWebviewCommand(context)
        ),

        // ─── Utility Commands ──────────────────────────────────────────
        vscode.commands.registerCommand(
            'vizflow.compareCSV',
            compareCSVCommand(context)
        ),
        vscode.commands.registerCommand(
            'vizflow.about',
            aboutCommand
        ),
        vscode.commands.registerCommand(
            'vizflow.dashboard',
            dashboardCommand(context)
        ),
        vscode.commands.registerCommand(
            'vizflow.charts',
            chartsCommand(context)
        ),
        vscode.commands.registerCommand(
            'vizflow.rbqlQuery',
            rbqlCommand(context)
        ),

        // ─── Scheduler Commands ────────────────────────────────────────
        vscode.commands.registerCommand(
            'vizflow.scheduler',
            scheduler
        ),
        vscode.commands.registerCommand(
            'vizflow.scheduler.quickSchedule',
            quickSchedule
        ),
        vscode.commands.registerCommand(
            'vizflow.scheduler.stopJob',
            stopJob
        ),
        vscode.commands.registerCommand(
            'vizflow.scheduler.showRunning',
            showRunning
        )

    );

    // ─── Workflow Builder Commands ─────────────────────────────────────
    // Call the factory ONCE so both commands share the same panel closure.
    // vizflow.workflowBuilder — open the builder with no file
    // vizflow.openWorkflow    — open/reveal with a specific .vizflow URI (from Explorer)
    const openWorkflow = workflowBuilderCommand(context);
    context.subscriptions.push(
        vscode.commands.registerCommand('vizflow.workflowBuilder', openWorkflow),
        vscode.commands.registerCommand('vizflow.openWorkflow', openWorkflow)
    );

    // ─── Wire the "Schedule" button in the Workflow Builder ────────────
    // Give workflowBuilder a reference to the scheduler so the ⏰ Schedule
    // toolbar button can open the Scheduler panel with the current file.
    workflowBuilderCommand.setSchedulerOpener(scheduler);
}

function deactivate() {
    // Stop cron tasks + folder watchers so nothing fires after the extension
    // unloads.
    getScheduler().stop();
}

module.exports = {
    activate,
    deactivate
};
const vscode = require('vscode');

async function load() {

    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showErrorMessage("No active editor.");
        return null;
    }

    const document = editor.document;

    if (document.languageId !== "csv") {
        vscode.window.showErrorMessage(
            "Only CSV files are supported."
        );
        return null;
    }

    return document.getText();

}

module.exports = {
    load
};
const vscode = require('vscode');

/**
 * Language IDs and file extensions that represent delimited text files.
 * Covers CSV, TSV, pipe-separated, and plain-text variants.
 */
const SUPPORTED_LANGUAGE_IDS = new Set(["csv", "tsv", "plaintext"]);
const SUPPORTED_EXTENSIONS   = new Set([".csv", ".tsv", ".txt", ".psv", ".tab"]);

async function load() {

    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showErrorMessage("No active editor.");
        return null;
    }

    const document = editor.document;
    const fileName  = document.fileName || "";
    const ext       = fileName.includes(".")
        ? "." + (fileName.split(".").pop() ?? "").toLowerCase()
        : "";

    const isSupported =
        SUPPORTED_LANGUAGE_IDS.has(document.languageId) ||
        SUPPORTED_EXTENSIONS.has(ext);

    if (!isSupported) {
        vscode.window.showErrorMessage(
            "VizFlow: Unsupported file type. Open a CSV, TSV, or pipe-separated (PSV) file."
        );
        return null;
    }

    return document.getText();

}

module.exports = {
    load
};
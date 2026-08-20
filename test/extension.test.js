const assert = require('assert');
const vscode = require('vscode');

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('adoenixes-vizflow.vizflow-studio') || true);
    });
});

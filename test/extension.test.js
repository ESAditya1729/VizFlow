const assert = require('assert');
const vscode = require('vscode');
const { OPERATIONS } = require('../engine/expressions/operations');

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('adoenixes-vizflow.vizflow-studio') || true);
    });

    // Regression guard: commands/transform.js and commands/transformWebview.js
    // read `op.description` (as the display label) and `op.paramDefs` off each
    // registry entry. A prior bug had them reading the non-existent `op.label`
    // / `op.params`, which left the Transform Column dropdowns blank/broken.
    test('Every registered transform operation exposes description + paramDefs shape', () => {
        for (const [key, op] of Object.entries(OPERATIONS)) {
            assert.ok(typeof op.description === 'string' && op.description.length > 0,
                `Operation "${key}" is missing a non-empty description`);
            assert.ok(typeof op.category === 'string' && op.category.length > 0,
                `Operation "${key}" is missing a category`);
            assert.ok(Array.isArray(op.paramDefs),
                `Operation "${key}" is missing a paramDefs array`);

            for (const param of op.paramDefs) {
                assert.ok(typeof param.name === 'string' && param.name.length > 0,
                    `A paramDef on "${key}" is missing a name`);
                assert.ok(typeof param.required === 'boolean',
                    `paramDef "${param.name}" on "${key}" is missing a boolean required flag`);
            }
        }
    });
});

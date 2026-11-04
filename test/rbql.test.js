const assert = require('assert');
const rbqlService = require('../services/rbqlService');

function makeDataset(rows, columns) {
    return {
        rows,
        columns,
        getColumns: () => columns,
        getRowCount: () => rows.length,
    };
}

suite('RBQL service', () => {
    test('validateQuery accepts SELECT, UPDATE and leading comments', () => {
        assert.strictEqual(rbqlService.validateQuery('SELECT *').valid, true);
        assert.strictEqual(rbqlService.validateQuery('UPDATE SET a1 = 1').valid, true);
        assert.strictEqual(rbqlService.validateQuery('-- note\nSELECT *').valid, true);
        assert.strictEqual(rbqlService.validateQuery('DELETE FROM data').valid, false);
        assert.strictEqual(rbqlService.validateQuery('').valid, false);
    });

    test('executes a filtered SELECT query', async () => {
        const dataset = makeDataset([
            { id: '1', name: 'Ada' },
            { id: '2', name: 'Bob' },
            { id: '3', name: 'Ada' },
        ], ['id', 'name']);

        const result = await rbqlService.executeQuery(
            dataset,
            "SELECT a1, a2 WHERE a2 == 'Ada'",
            { hasHeader: true }
        );

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.rowCount, 2);
        assert.deepStrictEqual(result.rows, [['1', 'Ada'], ['3', 'Ada']]);
    });

    test('supports IN filters through the IN_LIST shim', async () => {
        const dataset = makeDataset([
            { id: '1', name: 'Ada' },
            { id: '2', name: 'Bob' },
            { id: '3', name: 'Cara' },
        ], ['id', 'name']);

        const result = await rbqlService.executeQuery(
            dataset,
            "SELECT a1 WHERE a2 IN ('Ada', 'Cara')",
            { hasHeader: true }
        );

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.rowCount, 2);
        assert.deepStrictEqual(result.rows, [['1'], ['3']]);
    });

    test('uses independent join-header metadata', async () => {
        const dataset = makeDataset([
            { id: '1', name: 'Ada' },
            { id: '2', name: 'Bob' },
        ], ['id', 'name']);
        const joinDataset = makeDataset([
            { id: '1', team: 'Blue' },
            { id: '2', team: 'Red' },
        ], ['id', 'team']);

        const result = await rbqlService.executeQuery(
            dataset,
            'SELECT a1, a2, b2 JOIN b ON a1 == b1',
            {
                hasHeader: false,
                joinHasHeader: true,
                joinDataset,
            }
        );

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.rowCount, 2);
        assert.deepStrictEqual(result.rows, [['1', 'Ada', 'Blue'], ['2', 'Bob', 'Red']]);
    });

    suite('templates', () => {
        // The templates file is a browser script (plain `var`s), so evaluate it.
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(path.join(__dirname, '..', 'media', 'rbql-templates.js'), 'utf8');
        const { templates, categories } = new Function(
            src + '\nreturn { templates: RBQL_TEMPLATES, categories: RBQL_TEMPLATE_CATEGORIES };'
        )();

        // a1 = key, a2/a3 = numeric (templates aggregate and multiply them).
        const main = makeDataset([
            { id: '1', score: '10', qty: '2' },
            { id: '2', score: '20', qty: '3' },
            { id: '3', score: '30', qty: '4' },
        ], ['id', 'score', 'qty']);
        const join = makeDataset([
            { id: '1', team: 'Blue' },
            { id: '2', team: 'Red' },
        ], ['id', 'team']);

        test('every template has a known category, label, desc and query', () => {
            assert.ok(templates.length > 0);
            const labels = new Set();
            for (const t of templates) {
                assert.ok(categories.includes(t.category), `unknown category for ${t.label}`);
                assert.ok(t.label && t.desc && t.query, `incomplete template ${t.label}`);
                assert.ok(!labels.has(t.label), `duplicate label ${t.label}`);
                labels.add(t.label);
            }
            for (const c of categories) {
                assert.ok(templates.some(t => t.category === c), `empty category ${c}`);
            }
        });

        test('every template validates and executes on sample data', async () => {
            for (const t of templates) {
                assert.strictEqual(rbqlService.validateQuery(t.query).valid, true, t.label);
                const result = await rbqlService.executeQuery(main, t.query, {
                    hasHeader: true,
                    joinDataset: t.needsJoin ? join : null,
                });
                assert.strictEqual(result.success, true, `${t.label}: ${result.error}`);
            }
        });

        test('"Rows Without a Match" returns only unmatched source rows', async () => {
            const t = templates.find(x => x.label === 'Rows Without a Match');
            const result = await rbqlService.executeQuery(main, t.query, {
                hasHeader: true,
                joinDataset: join,
            });
            assert.strictEqual(result.success, true, result.error);
            assert.deepStrictEqual(result.rows, [['3', '30']]);
        });
    });

    test('returns a helpful error for invalid queries', async () => {
        const dataset = makeDataset([{ id: '1' }], ['id']);
        const result = await rbqlService.executeQuery(dataset, 'BOGUS QUERY', { hasHeader: true });

        assert.strictEqual(result.success, false);
        assert.ok(result.error);
    });
});

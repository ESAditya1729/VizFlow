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

    test('returns a helpful error for invalid queries', async () => {
        const dataset = makeDataset([{ id: '1' }], ['id']);
        const result = await rbqlService.executeQuery(dataset, 'BOGUS QUERY', { hasHeader: true });

        assert.strictEqual(result.success, false);
        assert.ok(result.error);
    });
});

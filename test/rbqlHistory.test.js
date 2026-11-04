const assert = require('assert');
const history = require('../services/rbqlHistory');

function entry(query, extra = {}) {
    return { query, timestamp: 1, success: true, rowCount: 1, durationMs: 5, sourceFile: 'a.csv', ...extra };
}

suite('RBQL history', () => {
    test('migrates legacy string and object arrays', () => {
        const migrated = history.fromStored(['SELECT 1', { query: 'SELECT 2', rowCount: 4 }, null, { query: '  ' }, 42]);
        assert.deepStrictEqual(migrated.map(e => e.query), ['SELECT 1', 'SELECT 2']);
        assert.strictEqual(migrated[0].pinned, false);
        assert.strictEqual(migrated[0].success, true);
        assert.strictEqual(migrated[0].rowCount, null);
        assert.strictEqual(migrated[1].rowCount, 4);
    });

    test('reads the versioned envelope and tolerates junk', () => {
        const stored = history.toStored([entry('SELECT *')]);
        assert.strictEqual(stored.version, history.SCHEMA_VERSION);
        assert.deepStrictEqual(history.fromStored(stored).map(e => e.query), ['SELECT *']);
        assert.deepStrictEqual(history.fromStored(undefined), []);
        assert.deepStrictEqual(history.fromStored({ version: 99 }), []);
        assert.deepStrictEqual(history.fromStored('nope'), []);
    });

    test('upsert moves a re-run query to the front and keeps its pin', () => {
        let list = [];
        list = history.upsert(list, entry('A'));
        list = history.upsert(list, entry('B'));
        list = history.togglePin(list, 'A');
        list = history.upsert(list, entry('A', { rowCount: 9 }));
        assert.deepStrictEqual(list.map(e => e.query), ['A', 'B']);
        assert.strictEqual(list[0].pinned, true);
        assert.strictEqual(list[0].rowCount, 9);
    });

    test('upsert ignores entries without a query', () => {
        const list = [entry('A')];
        assert.strictEqual(history.upsert(list, { query: '' }), list);
    });

    test('trims only unpinned entries beyond the cap', () => {
        let list = history.upsert([], entry('Q0'));
        list = history.togglePin(list, 'Q0'); // pin the oldest entry before the cap is hit
        for (let i = 1; i < history.MAX_UNPINNED + 20; i++) {
            list = history.upsert(list, entry('Q' + i));
        }
        assert.ok(list.some(e => e.query === 'Q0' && e.pinned));
        assert.strictEqual(list.filter(e => !e.pinned).length, history.MAX_UNPINNED);
    });

    test('clear keeps pinned entries unless asked otherwise', () => {
        let list = [entry('A'), entry('B', { pinned: true })];
        assert.deepStrictEqual(history.clear(list).map(e => e.query), ['B']);
        assert.deepStrictEqual(history.clear(list, { includePinned: true }), []);
    });

    test('remove deletes by query text', () => {
        const list = [entry('A'), entry('B')];
        assert.deepStrictEqual(history.remove(list, 'A').map(e => e.query), ['B']);
    });

    test('ordered puts pinned first and is stable', () => {
        const list = [entry('A'), entry('B', { pinned: true }), entry('C'), entry('D', { pinned: true })];
        assert.deepStrictEqual(history.ordered(list).map(e => e.query), ['B', 'D', 'A', 'C']);
    });
});

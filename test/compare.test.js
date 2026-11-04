const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const csvCompare = require('../services/csvCompare');
const textEncoding = require('../services/textEncoding');
const analyticsActivities = require('../engine/workflow/activities/analyticsActivities');

function makeDataset(rows, columns) {
    return {
        rows,
        columns,
        getColumns: () => columns,
        getRowCount: () => rows.length,
    };
}

suite('CSV comparison engine', () => {
    test('values mode treats trimmed numeric values as equal', () => {
        const datasetA = makeDataset([{ id: ' 1 ' }, { id: '2.0' }, { id: '' }], ['id']);
        const datasetB = makeDataset([{ id: '1' }, { id: '2' }, { id: null }], ['id']);

        const result = csvCompare.compareDatasets(datasetA, datasetB, {
            mode: 'values',
            columnA: 'id',
            columnB: 'id',
            normalization: { trim: true, numeric: true },
        });

        assert.strictEqual(result.matchCount, 2);
        assert.strictEqual(result.onlyACount, 0);
        assert.strictEqual(result.onlyBCount, 0);
        assert.strictEqual(result.rows.length, 2);
    });

    test('values mode can include blank values or ignore them', () => {
        const datasetA = makeDataset([{ id: '' }, { id: 'x' }], ['id']);
        const datasetB = makeDataset([{ id: '' }, { id: 'y' }], ['id']);

        const withoutEmpty = csvCompare.compareDatasets(datasetA, datasetB, {
            mode: 'values',
            columnA: 'id',
        });
        assert.strictEqual(withoutEmpty.rows.length, 2);

        const withEmpty = csvCompare.compareDatasets(datasetA, datasetB, {
            mode: 'values',
            columnA: 'id',
            includeEmpty: true,
        });
        assert.strictEqual(withEmpty.rows.length, 3);
        assert.strictEqual(withEmpty.matchCount, 1);
    });

    test('values mode supports case-insensitive matching', () => {
        const datasetA = makeDataset([{ id: 'Alpha' }], ['id']);
        const datasetB = makeDataset([{ id: 'alpha' }], ['id']);

        const result = csvCompare.compareDatasets(datasetA, datasetB, {
            mode: 'values',
            columnA: 'id',
            normalization: { caseInsensitive: true },
        });

        assert.strictEqual(result.matchCount, 1);
        assert.strictEqual(result.onlyACount, 0);
        assert.strictEqual(result.onlyBCount, 0);
    });

    test('rows mode reports added, removed, changed and unchanged rows', () => {
        const datasetA = makeDataset([
            { id: '1', name: 'Ada' },
            { id: '2', name: 'Bob' },
            { id: '3', name: 'Cara' },
        ], ['id', 'name']);
        const datasetB = makeDataset([
            { id: '1', name: 'Ada' },
            { id: '2', name: 'Bobby' },
            { id: '4', name: 'Drew' },
        ], ['id', 'name']);

        const result = csvCompare.compareDatasets(datasetA, datasetB, {
            mode: 'rows',
            keyColumnsA: ['id'],
            keyColumnsB: ['id'],
        });

        assert.strictEqual(result.unchangedCount, 1);
        assert.strictEqual(result.changedCount, 1);
        assert.strictEqual(result.removedCount, 1);
        assert.strictEqual(result.addedCount, 1);

        const changed = result.rows.find(row => row.type === 'changed');
        assert.ok(changed);
        assert.strictEqual(changed.value, '2');
        assert.strictEqual(changed.changes.length, 1);
        assert.strictEqual(changed.changes[0].valueA, 'Bob');
        assert.strictEqual(changed.changes[0].valueB, 'Bobby');
    });

    test('rows mode counts duplicate keys', () => {
        const datasetA = makeDataset([{ id: '1' }, { id: '1' }], ['id']);
        const datasetB = makeDataset([{ id: '1' }], ['id']);

        const result = csvCompare.compareDatasets(datasetA, datasetB, {
            mode: 'rows',
            keyColumnsA: ['id'],
            keyColumnsB: ['id'],
        });

        assert.strictEqual(result.duplicateKeyCountA, 1);
        assert.strictEqual(result.duplicateKeyCountB, 0);
        assert.strictEqual(result.unchangedCount, 1);
    });

    test('rows mode supports composite keys and per-column mapping', () => {
        const datasetA = makeDataset([
            { first: 'Ada', last: 'Lovelace', score: '10' },
            { first: 'Ada', last: 'Byron', score: '20' },
        ], ['first', 'last', 'score']);
        const datasetB = makeDataset([
            { given: 'Ada', family: 'Lovelace', points: '10' },
            { given: 'Ada', family: 'Byron', points: '21' },
        ], ['given', 'family', 'points']);

        const result = csvCompare.compareDatasets(datasetA, datasetB, {
            mode: 'rows',
            keyColumnsA: ['first', 'last'],
            keyColumnsB: ['given', 'family'],
            compareColumns: [{ a: 'score', b: 'points' }],
        });

        assert.strictEqual(result.unchangedCount, 1);
        assert.strictEqual(result.changedCount, 1);
        const changed = result.rows.find(row => row.type === 'changed');
        assert.strictEqual(changed.value, 'Ada | Byron');
        assert.strictEqual(changed.changes[0].columnA, 'score');
        assert.strictEqual(changed.changes[0].columnB, 'points');
    });

    test('rows mode displays B-only keys using B key columns', () => {
        const datasetA = makeDataset([{ source_id: '1' }], ['source_id']);
        const datasetB = makeDataset([{ target_id: '2' }], ['target_id']);

        const result = csvCompare.compareDatasets(datasetA, datasetB, {
            mode: 'rows',
            keyColumnsA: ['source_id'],
            keyColumnsB: ['target_id'],
        });

        const added = result.rows.find(row => row.type === 'added');
        assert.ok(added);
        assert.strictEqual(added.value, '2');
    });
});

suite('compareCsv workflow activity', () => {
    test('outputs a diff dataset and exposes summary variables', async () => {
        const activity = analyticsActivities.find(a => a.type === 'compareCsv');
        assert.ok(activity, 'compareCsv activity should be registered');

        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vizflow-compare-'));
        const fileB = path.join(dir, 'b.csv');
        await fs.promises.writeFile(fileB, 'id,name\n1,Ada\n2,Bobby\n4,Drew\n', 'utf8');

        const datasetA = makeDataset([
            { id: 1, name: 'Ada' },
            { id: 2, name: 'Bob' },
            { id: 3, name: 'Cara' },
        ], ['id', 'name']);

        const variables = {};
        const stats = {};
        const output = await activity.execute({
            filePathB: fileB,
            mode: 'rows',
            keyColumns: 'id',
        }, {
            resolvePath: p => p,
            setVariable: (name, value) => { variables[name] = value; },
            setActivityStats: value => Object.assign(stats, value),
        }, datasetA);

        const statuses = output.rows.map(row => row.status);
        assert.deepStrictEqual(statuses.sort(), ['added', 'changed', 'removed']);
        assert.strictEqual(output.getRowCount(), 3);
        assert.strictEqual(variables.compareChanged, 1);
        assert.strictEqual(variables.compareAdded, 1);
        assert.strictEqual(variables.compareRemoved, 1);
        assert.strictEqual(variables.compare.mode, 'rows');
        assert.strictEqual(stats.comparedRowCount, 3);

        await fs.promises.rm(dir, { recursive: true, force: true });
    });

    test('includeUnchanged adds matching rows to the diff dataset', async () => {
        const activity = analyticsActivities.find(a => a.type === 'compareCsv');
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vizflow-compare-'));
        const fileB = path.join(dir, 'b.csv');
        await fs.promises.writeFile(fileB, 'id,name\n1,Ada\n', 'utf8');

        const output = await activity.execute({
            filePathB: fileB,
            mode: 'rows',
            keyColumns: 'id',
            includeUnchanged: true,
        }, { resolvePath: p => p }, makeDataset([{ id: 1, name: 'Ada' }], ['id', 'name']));

        assert.strictEqual(output.getRowCount(), 1);
        assert.strictEqual(output.rows[0].status, 'unchanged');

        await fs.promises.rm(dir, { recursive: true, force: true });
    });
});

suite('CSV encoding detection', () => {
    test('decodes UTF-8 with and without a BOM', () => {
        const plain = Buffer.from('héllo', 'utf8');
        assert.strictEqual(textEncoding.decodeBuffer(plain).text, 'héllo');

        const withBom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), plain]);
        assert.strictEqual(textEncoding.decodeBuffer(withBom).text, 'héllo');
    });

    test('decodes UTF-16LE with a BOM', () => {
        const buffer = Buffer.concat([
            Buffer.from([0xFF, 0xFE]),
            Buffer.from('id,name\n1,Ada\n', 'utf16le'),
        ]);
        const decoded = textEncoding.decodeBuffer(buffer);
        assert.strictEqual(decoded.encoding, 'utf16le');
        assert.strictEqual(decoded.text, 'id,name\n1,Ada\n');
    });

    test('honours an explicit encoding', () => {
        const buffer = Buffer.from('café', 'latin1');
        assert.strictEqual(textEncoding.decodeBuffer(buffer, 'latin1').text, 'café');
    });
});

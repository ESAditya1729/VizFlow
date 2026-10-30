const assert = require('assert');
const rbqlExport = require('../services/rbqlExport');

const DATA = {
    columns: ['id', 'note'],
    rows: [
        ['1', 'has, comma'],
        ['2', 'has "quote"'],
        ['3', 'line\nbreak'],
    ],
};

suite('RBQL export serializers', () => {
    test('CSV export quotes commas, quotes and newlines', () => {
        const csv = rbqlExport.toCsv(DATA);
        assert.ok(csv.startsWith('id,note'));
        assert.ok(csv.includes('"has, comma"'));
        assert.ok(csv.includes('"has ""quote"""'));
        assert.ok(csv.includes('"line\nbreak"'));
    });

    test('JSON export maps columns to object keys', () => {
        const parsed = JSON.parse(rbqlExport.toJson(DATA));
        assert.deepStrictEqual(parsed, [
            { id: '1', note: 'has, comma' },
            { id: '2', note: 'has "quote"' },
            { id: '3', note: 'line\nbreak' },
        ]);
    });

    test('Markdown export escapes pipes and newlines', () => {
        const markdown = rbqlExport.toMarkdown({
            columns: ['id', 'note'],
            rows: [['1', 'a|b\nc']],
        });
        assert.ok(markdown.includes('| id | note |'));
        assert.ok(markdown.includes('a\\|b<br>c'));
    });

    test('empty result sets still produce a valid header', () => {
        assert.strictEqual(rbqlExport.toCsv({ columns: ['id'], rows: [] }).trim(), 'id');
        assert.strictEqual(rbqlExport.toJson({ columns: ['id'], rows: [] }), '[]');
        assert.ok(rbqlExport.toMarkdown({ columns: ['id'], rows: [] }).startsWith('| id |'));
    });
});

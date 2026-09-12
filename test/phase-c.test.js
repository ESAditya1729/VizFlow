'use strict';

/**
 * test/phase-c.test.js
 *
 * Unit + end-to-end tests for the Phase C activities:
 *   pivot, mergeColumns, fuzzyDeduplicate, jsonTransform, validateData, soapRequest.
 * The soapRequest tests stub the lazy `require('axios')` (same pattern as
 * test/http.test.js) so no real network call ever happens.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const Module = require('module');
const { getActivity } = require('../engine/workflow/activityRegistry');
const { executeWorkflow } = require('../engine/workflow/workflowEngine');
const Dataset = require('../engine/dataset');

suite('Phase C Activities Test Suite', () => {
    const testDir = path.join(__dirname, 'temp_test_phase_c');
    const inputCsvPath = path.join(testDir, 'input.csv');

    const pivot = getActivity('pivot', true);
    const mergeColumns = getActivity('mergeColumns', true);
    const fuzzyDeduplicate = getActivity('fuzzyDeduplicate', true);
    const jsonTransform = getActivity('jsonTransform', true);
    const validateData = getActivity('validateData', true);
    const soapRequest = getActivity('soapRequest', true);

    function fakeContext() {
        const stats = {};
        const variables = {};
        return {
            variables,
            setActivityStats: (s) => Object.assign(stats, s),
            getActivityStats: () => stats,
            setVariable: (name, value) => { variables[name] = value; }
        };
    }

    /**
     * Stub the lazy axios require with a fake that mirrors real axios
     * semantics (validateStatus throwing, timeout passthrough).
     * @param {(config: Object) => any} handler - Returns the response object
     * @returns {() => void} Restore function
     */
    function stubAxios(handler) {
        const originalLoad = Module._load;
        const axiosPath = require.resolve('axios');
        const cached = require.cache[axiosPath];
        delete require.cache[axiosPath];
        Module._load = function (request) {
            if (request === 'axios') {
                return async (config) => {
                    const response = await handler(config);
                    if (typeof config.validateStatus === 'function' && !config.validateStatus(response.status)) {
                        const err = new Error(`Request failed with status code ${response.status}`);
                        err.response = response;
                        throw err;
                    }
                    return response;
                };
            }
            return originalLoad.apply(this, arguments);
        };
        return function restore() {
            Module._load = originalLoad;
            if (cached) require.cache[axiosPath] = cached;
        };
    }

    suiteSetup(async () => {
        assert.ok(pivot, 'pivot activity must be registered');
        assert.ok(mergeColumns, 'mergeColumns activity must be registered');
        assert.ok(fuzzyDeduplicate, 'fuzzyDeduplicate activity must be registered');
        assert.ok(jsonTransform, 'jsonTransform activity must be registered');
        assert.ok(validateData, 'validateData activity must be registered');
        assert.ok(soapRequest, 'soapRequest activity must be registered');

        if (!fs.existsSync(testDir)) {
            await fs.promises.mkdir(testDir, { recursive: true });
        }
        const Papa = require('papaparse');
        const csvContent = Papa.unparse([
            { region: 'North', product: 'A', amount: '10', email: 'a@b.com', name: 'Apple Inc.', payload: '{"user":{"name":"Ada","tags":["x"]},"active":true}' },
            { region: 'North', product: 'B', amount: '20', email: 'b@c.com', name: 'Apple Inc', payload: '{"user":{"name":"Bob","tags":[]},"active":false}' },
            { region: 'South', product: 'A', amount: '5', email: 'bad@', name: 'Acme Corp', payload: '{"user":{"name":"Carol"},"active":true}' },
            { region: 'North', product: 'A', amount: '15', email: 'a@b.com', name: 'Apple Inco', payload: '{"user":{"name":"Ada"},"active":true}' }
        ]);
        await fs.promises.writeFile(inputCsvPath, csvContent, 'utf8');
    });

    suiteTeardown(async () => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    // ── Registration ─────────────────────────────────────────────────────────
    suite('Registration', () => {
        test('activities are exposed in the expected categories', () => {
            assert.strictEqual(pivot.category, 'Transformation');
            assert.strictEqual(mergeColumns.category, 'Transformation');
            assert.strictEqual(fuzzyDeduplicate.category, 'Transformation');
            assert.strictEqual(jsonTransform.category, 'Transformation');
            assert.strictEqual(validateData.category, 'Analytics');
            assert.strictEqual(soapRequest.category, 'Integration');
        });

        test('required config fields are declared', () => {
            const names = (cfg) => (cfg.configRequirements || []).map((r) => r.name);
            assert.ok(names(pivot).includes('idColumns'));
            assert.ok(names(pivot).includes('pivotColumn'));
            assert.ok(names(pivot).includes('valueColumn'));
            assert.ok(names(mergeColumns).includes('columns'));
            assert.ok(names(mergeColumns).includes('targetColumn'));
            assert.ok(names(fuzzyDeduplicate).includes('columns'));
            assert.ok(names(jsonTransform).includes('column'));
            assert.ok(names(validateData).includes('rules'));
            assert.ok(names(soapRequest).includes('url'));
            assert.ok(names(soapRequest).includes('body'));
        });
    });

    // ── pivot ────────────────────────────────────────────────────────────────
    suite('pivot', () => {
        const sales = () => new Dataset([
            { region: 'North', product: 'A', amount: 10 },
            { region: 'North', product: 'B', amount: 20 },
            { region: 'South', product: 'A', amount: 5 }
        ], ['region', 'product', 'amount']);

        test('sum aggregation spreads distinct pivot values into columns', async () => {
            const ctx = fakeContext();
            const out = await pivot.execute(
                { idColumns: 'region', pivotColumn: 'product', valueColumn: 'amount' },
                ctx, sales()
            );
            assert.deepStrictEqual(out.columns, ['region', 'A', 'B']);
            const north = out.rows.find((r) => r.region === 'North');
            const south = out.rows.find((r) => r.region === 'South');
            assert.strictEqual(north.A, 10);
            assert.strictEqual(north.B, 20);
            assert.strictEqual(south.A, 5);
            assert.strictEqual(south.B, null);
        });

        test('avg aggregation computes the mean of numeric values', async () => {
            const out = await pivot.execute(
                { idColumns: 'region', pivotColumn: 'product', valueColumn: 'amount', aggregation: 'avg' },
                fakeContext(), sales()
            );
            const north = out.rows.find((r) => r.region === 'North');
            assert.strictEqual(north.A, 10);
            assert.strictEqual(north.B, 20);
        });

        test('count aggregation counts the non-null values per cell', async () => {
            const out = await pivot.execute(
                { idColumns: 'region', pivotColumn: 'product', valueColumn: 'amount', aggregation: 'count' },
                fakeContext(), sales()
            );
            const north = out.rows.find((r) => r.region === 'North');
            assert.strictEqual(north.A, 1);
            assert.strictEqual(north.B, 1);
            const south = out.rows.find((r) => r.region === 'South');
            assert.strictEqual(south.A, 1);
            assert.strictEqual(south.B, null);
        });

        test('valuePrefix is applied to generated column names', async () => {
            const out = await pivot.execute(
                { idColumns: 'region', pivotColumn: 'product', valueColumn: 'amount', valuePrefix: 'amt_' },
                fakeContext(), sales()
            );
            assert.deepStrictEqual(out.columns, ['region', 'amt_A', 'amt_B']);
        });

        test('throws when distinct pivot values exceed maxPivotValues', async () => {
            const wide = new Dataset([
                { g: 1, k: 'a', v: 1 }, { g: 1, k: 'b', v: 2 }, { g: 1, k: 'c', v: 3 }
            ], ['g', 'k', 'v']);
            await assert.rejects(
                () => pivot.execute({ idColumns: 'g', pivotColumn: 'k', valueColumn: 'v', maxPivotValues: 2 },
                    fakeContext(), wide),
                /exceeding the maximum \(2\)/
            );
        });
    });

    // ── mergeColumns ─────────────────────────────────────────────────────────
    suite('mergeColumns', () => {
        const people = () => new Dataset([
            { first: 'Ada', last: 'Lovelace', extra: 1 },
            { first: 'Alan', last: 'Turing', extra: 2 }
        ], ['first', 'last', 'extra']);

        test('merges columns into one with a delimiter and drops originals', async () => {
            const out = await mergeColumns.execute(
                { columns: 'first,last', targetColumn: 'full', delimiter: ' ' },
                fakeContext(), people()
            );
            assert.deepStrictEqual(out.rows.map((r) => r.full), ['Ada Lovelace', 'Alan Turing']);
            assert.deepStrictEqual(out.columns, ['extra', 'full']);
        });

        test('keeps originals when dropOriginals is false', async () => {
            const out = await mergeColumns.execute(
                { columns: 'first,last', targetColumn: 'full', dropOriginals: false },
                fakeContext(), people()
            );
            assert.deepStrictEqual(out.columns, ['first', 'last', 'extra', 'full']);
        });

        test('missing columns are reported with available columns', async () => {
            await assert.rejects(
                () => mergeColumns.execute({ columns: 'nope', targetColumn: 'x' }, fakeContext(), people()),
                /"nope" not found/
            );
        });
    });

    // ── fuzzyDeduplicate ─────────────────────────────────────────────────────
    suite('fuzzyDeduplicate', () => {
        const rows = () => new Dataset([
            { name: 'Apple Inc.' },
            { name: 'Apple Inc' },
            { name: 'Apple Inco' },
            { name: 'Acme Corp' }
        ], ['name']);

        test('annotates near-duplicates into the same cluster', async () => {
            const out = await fuzzyDeduplicate.execute({ columns: 'name', threshold: 0.8 }, fakeContext(), rows());
            assert.strictEqual(out.rows.length, 4);
            assert.strictEqual(out.rows[0].__match_group, out.rows[1].__match_group);
            assert.strictEqual(out.rows[2].__duplicate_of, 1);
            assert.strictEqual(out.rows[2].__match_group, 1);
            assert.strictEqual(out.rows[3].__duplicate_of, '');
            assert.strictEqual(out.rows[3].__match_group, 2);
            assert.deepStrictEqual(out.columns, ['name', '__match_group', '__duplicate_of']);
        });

        test('includeSimilarity adds a similarity column', async () => {
            const out = await fuzzyDeduplicate.execute(
                { columns: 'name', threshold: 0.8, includeSimilarity: true },
                fakeContext(), rows()
            );
            assert.deepStrictEqual(out.columns, ['name', '__match_group', '__duplicate_of', '__similarity']);
            assert.strictEqual(out.rows[1].__similarity, 0.9);
            assert.strictEqual(out.rows[2].__similarity, 0.9);
            assert.strictEqual(out.rows[0].__similarity, '');
        });

        test('removeDuplicates mode keeps only cluster representatives', async () => {
            const out = await fuzzyDeduplicate.execute(
                { columns: 'name', threshold: 0.8, mode: 'removeDuplicates' },
                fakeContext(), rows()
            );
            assert.strictEqual(out.rows.length, 2);
            assert.deepStrictEqual(out.rows.map((r) => r.name), ['Apple Inc.', 'Acme Corp']);
            assert.deepStrictEqual(out.columns, ['name']);
        });

        test('case-insensitive matching by default, sensitive when requested', async () => {
            const mixed = () => new Dataset([{ name: 'IBM' }, { name: 'ibm' }], ['name']);
            const insensitive = await fuzzyDeduplicate.execute({ columns: 'name', threshold: 0.8 }, fakeContext(), mixed());
            assert.strictEqual(insensitive.rows[1].__duplicate_of, 1);
            const sensitive = await fuzzyDeduplicate.execute({ columns: 'name', caseSensitive: true, threshold: 0.8 }, fakeContext(), mixed());
            assert.strictEqual(sensitive.rows[1].__duplicate_of, '');
        });
    });

    // ── jsonTransform ────────────────────────────────────────────────────────
    suite('jsonTransform', () => {
        const rows = () => new Dataset([
            { id: 1, payload: '{"user":{"name":"Ada","tags":["a"]},"active":true}' },
            { id: 2, payload: '{"user":{"name":"Alan"},"active":false}' },
            { id: 3, payload: '' }
        ], ['id', 'payload']);

        test('flattens nested objects and stringifies arrays', async () => {
            const out = await jsonTransform.execute({ column: 'payload' }, fakeContext(), rows());
            assert.strictEqual(out.rows[0]['user.name'], 'Ada');
            assert.strictEqual(out.rows[0]['user.tags'], JSON.stringify(['a']));
            assert.strictEqual(out.rows[0].active, true);
            assert.strictEqual(out.rows[1].active, false);
            assert.ok(out.columns.includes('user.name'));
            assert.ok(out.columns.includes('user.tags'));
            assert.ok(out.columns.includes('active'));
        });

        test('prefix is prepended to the first generated segment', async () => {
            const out = await jsonTransform.execute({ column: 'payload', prefix: 'meta_' }, fakeContext(), rows());
            assert.strictEqual(out.rows[0]['meta_user.name'], 'Ada');
            assert.strictEqual(out.rows[0].meta_active, true);
        });

        test('blank and missing cells pass through unchanged', async () => {
            const out = await jsonTransform.execute({ column: 'payload' }, fakeContext(), rows());
            assert.strictEqual(out.rows[2].id, 3);
            assert.strictEqual(out.rows[2].payload, '');
            assert.strictEqual(out.rows[2].active, undefined);
        });

        test('throws on invalid JSON unless skipErrors is enabled', async () => {
            const bad = () => new Dataset([{ id: 1, payload: '{not json' }], ['id', 'payload']);
            await assert.rejects(
                () => jsonTransform.execute({ column: 'payload' }, fakeContext(), bad()),
                /not valid JSON/
            );
            const skipped = await jsonTransform.execute({ column: 'payload', skipErrors: true }, fakeContext(), bad());
            assert.strictEqual(skipped.rows.length, 1);
            assert.strictEqual(skipped.rows[0].payload, '{not json');
        });
    });

    // ── validateData ─────────────────────────────────────────────────────────
    suite('validateData', () => {
        const rows = () => new Dataset([
            { id: 1, email: 'a@b.com', amount: '10' },
            { id: 2, email: 'bad', amount: '-5' },
            { id: 2, email: 'a@b.com', amount: '5' }
        ], ['id', 'email', 'amount']);

        test('annotates rows with status and error messages', async () => {
            const out = await validateData.execute({ rules: JSON.stringify([
                { column: 'email', check: 'email' },
                { column: 'amount', check: 'min', value: 0 },
                { column: 'id', check: 'unique' }
            ]) }, fakeContext(), rows());

            assert.strictEqual(out.rows[0].__validation_status, 'valid');
            assert.strictEqual(out.rows[1].__validation_status, 'invalid');
            assert.ok(out.rows[1].__validation_errors.includes('not a valid email'));
            assert.ok(out.rows[1].__validation_errors.includes('below the minimum'));
            assert.strictEqual(out.rows[2].__validation_status, 'invalid');
            assert.ok(out.rows[2].__validation_errors.includes('duplicated'));
            assert.deepStrictEqual(out.columns.slice(-2), ['__validation_status', '__validation_errors']);
        });

        test('filterInvalid mode removes failed rows', async () => {
            const out = await validateData.execute({ rules: JSON.stringify([
                { column: 'email', check: 'email' }
            ]), mode: 'filterInvalid' }, fakeContext(), rows());
            assert.strictEqual(out.rows.length, 2);
            assert.ok(out.rows.every((r) => r.email !== 'bad'));
            assert.ok(!out.columns.includes('__validation_status'));
        });

        test('custom rule messages appear in the error output', async () => {
            const out = await validateData.execute({ rules: JSON.stringify([
                { column: 'amount', check: 'min', value: 0, message: 'Amount cannot be negative' }
            ]) }, fakeContext(), rows());
            assert.ok(out.rows[1].__validation_errors.includes('Amount cannot be negative'));
        });

        test('pattern, in, notEmpty and integer checks', async () => {
            const checked = await validateData.execute({ rules: JSON.stringify([
                { column: 'amount', check: 'integer' },
                { column: 'name', check: 'notEmpty' },
                { column: 'code', check: 'pattern', pattern: '^[A-Z]{3}$' },
                { column: 'color', check: 'in', value: ['red', 'green'] }
            ]) }, fakeContext(), new Dataset([
                { amount: '12', name: 'x', code: 'ABC', color: 'red' },
                { amount: '1.5', name: '', code: 'ab1', color: 'blue' }
            ], ['amount', 'name', 'code', 'color']));

            assert.strictEqual(checked.rows[0].__validation_status, 'valid');
            assert.strictEqual(checked.rows[1].__validation_status, 'invalid');
            assert.ok(checked.rows[1].__validation_errors.includes('not an integer'));
            assert.ok(checked.rows[1].__validation_errors.includes('is empty'));
            assert.ok(checked.rows[1].__validation_errors.includes('does not match'));
            assert.ok(checked.rows[1].__validation_errors.includes('not in the allowed list'));
        });

        test('rejects malformed rules JSON', async () => {
            await assert.rejects(
                () => validateData.execute({ rules: '{nope' }, fakeContext(), rows()),
                /must be valid JSON/
            );
        });
    });

    // ── soapRequest ──────────────────────────────────────────────────────────
    suite('soapRequest', () => {
        test('builds a SOAP 1.1 envelope with basic auth', async () => {
            let captured = null;
            const restore = stubAxios((config) => {
                captured = config;
                return {
                    status: 200,
                    statusText: 'OK',
                    data: '<?xml version="1.0"?><soap:Envelope><soap:Body><GetQuoteResponse><price>42</price></GetQuoteResponse></soap:Body></soap:Envelope>'
                };
            });
            try {
                const ctx = fakeContext();
                const ds = await soapRequest.execute({
                    url: 'https://api.example.com/soap',
                    body: '<GetQuote><symbol>AAPL</symbol></GetQuote>',
                    operation: 'GetQuote',
                    namespace: 'http://tempuri.org/',
                    soapAction: 'http://tempuri.org/GetQuote',
                    authType: 'basic',
                    username: 'user',
                    password: 'pass'
                }, ctx, null);

                assert.strictEqual(captured.method, 'POST');
                assert.ok(captured.data.includes('xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"'));
                assert.ok(captured.data.includes('<GetQuote xmlns="http://tempuri.org/"><GetQuote><symbol>AAPL</symbol></GetQuote></GetQuote>'));
                assert.strictEqual(captured.headers['Content-Type'], 'text/xml; charset=utf-8');
                assert.strictEqual(captured.headers['SOAPAction'], 'http://tempuri.org/GetQuote');
                assert.strictEqual(captured.headers.Authorization, `Basic ${Buffer.from('user:pass').toString('base64')}`);
                assert.strictEqual(captured.timeout, 30000);

                assert.strictEqual(ds.rows.length, 1);
                assert.strictEqual(ds.rows[0].soapStatus, 200);
                assert.ok(ds.rows[0].soapResponse.includes('GetQuoteResponse'));
                assert.deepStrictEqual(ds.columns, ['soapStatus', 'soapResponse']);
                assert.strictEqual(ctx.variables.soapRequest.status, 200);
            } finally {
                restore();
            }
        });

        test('builds a SOAP 1.2 envelope with bearer auth and action in content type', async () => {
            let captured = null;
            const restore = stubAxios((config) => {
                captured = config;
                return { status: 200, statusText: 'OK', data: '<x/>' };
            });
            try {
                await soapRequest.execute({
                    url: 'https://api.example.com/soap12',
                    body: '<Ping/>',
                    soapVersion: 'soap12',
                    soapAction: 'urn:ping',
                    authType: 'bearer',
                    bearerToken: 'tok123'
                }, fakeContext(), null);

                assert.ok(captured.data.includes('xmlns:soapenv="http://www.w3.org/2003/05/soap-envelope"'));
                assert.strictEqual(captured.headers['Content-Type'], 'application/soap+xml; charset=utf-8; action="urn:ping"');
                assert.strictEqual(captured.headers.Authorization, 'Bearer tok123');
                assert.strictEqual(captured.headers.SOAPAction, undefined);
            } finally {
                restore();
            }
        });

        test('strips an XML declaration from the body and wraps bare XML', async () => {
            let captured = null;
            const restore = stubAxios((config) => {
                captured = config;
                return { status: 200, statusText: 'OK', data: '<x/>' };
            });
            try {
                await soapRequest.execute({
                    url: 'https://api.example.com/soap',
                    body: '<?xml version="1.0" encoding="utf-8"?><Ping/>'
                }, fakeContext(), null);
                assert.strictEqual((captured.data.match(/<\?xml/g) || []).length, 1, 'one XML declaration total');
                assert.ok(captured.data.includes('<soapenv:Body><Ping/></soapenv:Body>'), 'bare body wrapped');
            } finally {
                restore();
            }
        });

        test('requires url and body', async () => {
            await assert.rejects(
                () => soapRequest.execute({ url: 'https://x' }, fakeContext(), null),
                /"body" is required/
            );
            await assert.rejects(
                () => soapRequest.execute({ body: '<Ping/>' }, fakeContext(), null),
                /"url" is required/
            );
        });

        test('throws a friendly error on non-2xx status', async () => {
            const restore = stubAxios(() => ({ status: 500, statusText: 'Server Error', data: '<fault/>' }));
            try {
                await assert.rejects(
                    () => soapRequest.execute({ url: 'https://x', body: '<Ping/>' }, fakeContext(), null),
                    /failed with status 500/
                );
            } finally {
                restore();
            }
        });
    });

    // ── End-to-end workflow runs ─────────────────────────────────────────────
    suite('End-to-end workflows', () => {
        test('readCsv → validateData → fuzzyDeduplicate pipeline', async () => {
            const execution = await executeWorkflow({
                name: 'Phase C - validate + dedupe',
                version: '1.0.0',
                activities: [
                    { id: 'read', type: 'readCsv', config: { filePath: inputCsvPath } },
                    {
                        id: 'validate',
                        type: 'validateData',
                        config: { rules: JSON.stringify([{ column: 'email', check: 'email' }]) }
                    },
                    {
                        id: 'dedupe',
                        type: 'fuzzyDeduplicate',
                        config: { columns: 'name', threshold: 0.8, mode: 'removeDuplicates' }
                    }
                ]
            });

            assert.strictEqual(execution.success, true, execution.error);
            const validateResult = execution.results.validate.dataset;
            assert.strictEqual(validateResult.rows[2].__validation_status, 'invalid', 'bad email flagged');
            const dedupeResult = execution.results.dedupe.dataset;
            assert.strictEqual(dedupeResult.rows.length, 2, 'dedupe keeps one representative per cluster');
            assert.deepStrictEqual(dedupeResult.rows.map((r) => r.name), ['Apple Inc.', 'Acme Corp']);
        });

        test('readCsv → mergeColumns → jsonTransform → pivot pipeline', async () => {
            const execution = await executeWorkflow({
                name: 'Phase C - merge/json/pivot',
                version: '1.0.0',
                activities: [
                    { id: 'read', type: 'readCsv', config: { filePath: inputCsvPath } },
                    {
                        id: 'merge',
                        type: 'mergeColumns',
                        config: { columns: 'email,name', targetColumn: 'contact' }
                    },
                    {
                        id: 'json',
                        type: 'jsonTransform',
                        config: { column: 'payload', prefix: 'meta_' }
                    },
                    {
                        id: 'pivot',
                        type: 'pivot',
                        config: { idColumns: 'region', pivotColumn: 'product', valueColumn: 'amount' }
                    }
                ]
            });

            assert.strictEqual(execution.success, true, execution.error);
            const mergeResult = execution.results.merge.dataset;
            assert.strictEqual(mergeResult.rows[0].contact, 'a@b.com Apple Inc.');
            const jsonResult = execution.results.json.dataset;
            assert.strictEqual(jsonResult.rows[0]['meta_user.name'], 'Ada');
            assert.strictEqual(jsonResult.rows[0].meta_active, true);
            const pivotResult = execution.results.pivot.dataset;
            assert.strictEqual(pivotResult.getRowCount(), 2, 'one row per region');
            const north = pivotResult.rows.find((r) => r.region === 'North');
            const south = pivotResult.rows.find((r) => r.region === 'South');
            assert.ok(north, 'North row present');
            assert.strictEqual(north.A, 25, 'North/A sums 10 + 15');
            assert.strictEqual(north.B, 20, 'North/B sums 20');
            assert.strictEqual(south.A, 5, 'South/A sums 5');
        });
    });
});
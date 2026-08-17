'use strict';

/**
 * test/http.test.js
 *
 * Unit tests for the HTTP Request (REST) workflow activity.
 * No real network call is made — the lazy `require('axios')` inside the
 * activity is stubbed via Module._load (same pattern as database tests).
 */

const assert = require('assert');
const Module = require('module');
const templateService = require('../services/templateService');
const { getActivity } = require('../engine/workflow/activityRegistry');

suite('HTTP Activities Test Suite', () => {

    const httpRequest = getActivity('httpRequest', true);

    suiteSetup(() => {
        assert.ok(httpRequest, 'httpRequest activity must be registered');
        assert.strictEqual(httpRequest.category, 'Integration');
    });

    function fakeContext() {
        const stats = {};
        const variables = {};
        return {
            variables,
            setActivityStats: (s) => Object.assign(stats, s),
            getActivityStats: () => stats,
            setVariable: (name, value) => { variables[name] = value; },
            interpolate: (tpl) => templateService.interpolate(tpl, variables)
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

    // ── Registration / metadata ─────────────────────────────────────────────
    suite('Registration', () => {
        test('exposes a valid configRequirements schema', () => {
            const names = (httpRequest.configRequirements || []).map((r) => r.name);
            assert.ok(names.includes('url'));
            assert.ok(names.includes('method'));
            assert.ok(names.includes('headers'));
            assert.ok(names.includes('body'));
            const urlReq = httpRequest.configRequirements.find((r) => r.name === 'url');
            assert.strictEqual(urlReq.required, true);
        });
    });

    // ── Execution ───────────────────────────────────────────────────────────
    suite('Execution', () => {
        test('converts a JSON array response into a Dataset', async () => {
            const restore = stubAxios((config) => {
                assert.strictEqual(config.method, 'GET');
                assert.ok(config.url.includes('orders'));
                return {
                    status: 200,
                    statusText: 'OK',
                    data: JSON.stringify([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]),
                    headers: { 'content-type': 'application/json' }
                };
            });
            try {
                const ctx = fakeContext();
                const ds = await httpRequest.execute(
                    { url: 'https://api.example.com/v1/orders', method: 'GET' },
                    ctx, null
                );
                assert.strictEqual(ds.rows.length, 2);
                assert.deepStrictEqual(ds.rows[0], { id: 1, name: 'Alice' });
                assert.deepStrictEqual(ds.columns, ['id', 'name']);
                assert.strictEqual(ctx.getActivityStats().httpStatus, 200);
                assert.strictEqual(ctx.variables.httpRequest.status, 200);
            } finally {
                restore();
            }
        });

        test('navigates a responsePath to a nested data array', async () => {
            const restore = stubAxios(() => ({
                status: 200,
                statusText: 'OK',
                data: { status: 'ok', data: { items: [{ a: 1 }, { a: 2 }] } }
            }));
            try {
                const ctx = fakeContext();
                const ds = await httpRequest.execute(
                    { url: 'https://api.example.com/v1/x', method: 'GET', responsePath: 'data.items' },
                    ctx, null
                );
                assert.strictEqual(ds.rows.length, 2);
                assert.deepStrictEqual(ds.columns, ['a']);
            } finally {
                restore();
            }
        });

        test('turns a single JSON object response into one row (nested values stringified)', async () => {
            const restore = stubAxios(() => ({
                status: 200,
                statusText: 'OK',
                data: { id: 7, name: 'Alice', tags: ['a', 'b'] }
            }));
            try {
                const ds = await httpRequest.execute({ url: 'https://api.example.com/v1/user' }, fakeContext(), null);
                assert.strictEqual(ds.rows.length, 1);
                assert.deepStrictEqual(ds.columns, ['id', 'name', 'tags']);
                assert.strictEqual(ds.rows[0].tags, JSON.stringify(['a', 'b']));
            } finally {
                restore();
            }
        });

        test('sends JSON headers, query params, and a parsed JSON body', async () => {
            let captured = null;
            const restore = stubAxios((config) => {
                captured = config;
                return { status: 201, statusText: 'Created', data: { id: 1 } };
            });
            try {
                await httpRequest.execute({
                    url: 'https://api.example.com/v1/orders',
                    method: 'POST',
                    headers: '{ "Authorization": "Bearer abc123" }',
                    queryParams: '{ "debug": "true" }',
                    contentType: 'json',
                    body: '{ "amount": 100 }'
                }, fakeContext(), null);
                assert.strictEqual(captured.headers['Authorization'], 'Bearer abc123');
                assert.strictEqual(captured.headers['Content-Type'], 'application/json');
                assert.deepStrictEqual(captured.params, { debug: 'true' });
                assert.deepStrictEqual(captured.data, { amount: 100 });
            } finally {
                restore();
            }
        });

        test('sends a form body as URLSearchParams', async () => {
            let captured = null;
            const restore = stubAxios((config) => {
                captured = config;
                return { status: 200, statusText: 'OK', data: { ok: true } };
            });
            try {
                await httpRequest.execute({
                    url: 'https://api.example.com/v1/form',
                    method: 'POST',
                    contentType: 'form',
                    body: '{ "name": "Alice", "age": 30 }'
                }, fakeContext(), null);
                assert.strictEqual(captured.headers['Content-Type'], 'application/x-www-form-urlencoded');
                assert.ok(captured.data instanceof URLSearchParams);
                assert.strictEqual(captured.data.get('name'), 'Alice');
            } finally {
                restore();
            }
        });

        test('passes the configured timeout (seconds → ms)', async () => {
            let captured = null;
            const restore = stubAxios((config) => {
                captured = config;
                return { status: 200, statusText: 'OK', data: [] };
            });
            try {
                await httpRequest.execute({ url: 'https://api.example.com/v1', timeout: '15' }, fakeContext(), null);
                assert.strictEqual(captured.timeout, 15000);
            } finally {
                restore();
            }
        });

        test('throws a friendly error on non-2xx status by default', async () => {
            const restore = stubAxios(() => ({ status: 500, statusText: 'Internal Server Error', data: 'boom' }));
            try {
                await assert.rejects(
                    () => httpRequest.execute({ url: 'https://api.example.com/v1' }, fakeContext(), null),
                    /failed with status 500/
                );
            } finally {
                restore();
            }
        });

        test('keeps non-2xx responses as data when ignoreErrorStatus is enabled', async () => {
            const restore = stubAxios(() => ({ status: 404, statusText: 'Not Found', data: { error: 'missing' } }));
            try {
                const ds = await httpRequest.execute(
                    { url: 'https://api.example.com/v1/missing', ignoreErrorStatus: true },
                    fakeContext(), null
                );
                assert.strictEqual(ds.rows.length, 1);
                assert.strictEqual(ds.rows[0].error, 'missing');
            } finally {
                restore();
            }
        });

        test('requires a URL', async () => {
            await assert.rejects(
                () => httpRequest.execute({ method: 'GET' }, fakeContext(), null),
                /"url" is required/
            );
        });

        test('honours {{variable}} interpolation in the URL', async () => {
            let capturedUrl = null;
            const restore = stubAxios((config) => {
                capturedUrl = config.url;
                return { status: 200, statusText: 'OK', data: [] };
            });
            try {
                const ctx = fakeContext();
                ctx.setVariable('region', 'eu');
                // The engine interpolates top-level string config before execute;
                // simulate that here as the activity receives already-interpolated config.
                const config = ctx.interpolate('https://api.example.com/{{region}}/v1');
                await httpRequest.execute({ url: config }, ctx, null);
                assert.strictEqual(capturedUrl, 'https://api.example.com/eu/v1');
            } finally {
                restore();
            }
        });
    });
});

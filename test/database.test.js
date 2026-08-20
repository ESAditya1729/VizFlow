/**
 * test/database.test.js
 *
 * Unit tests for the external data-source layer:
 *   - ConnectionManager persistence + SecretStorage redaction
 *   - Visual filter → SQL / Mongo query builders
 *   - Read-only SQL guard (validateSelect)
 *   - Database workflow activities (validation + execution paths)
 *
 * No live database is contacted — drivers are stubbed where execution happens.
 */

'use strict';

const assert = require('assert');
const Module = require('module');
const { createConnectionManager } = require('../services/database/connectionManager');
const { buildMongoFilter, coerceValue } = require('../services/database/mongoFilterBuilder');
const { buildSqlWhere, buildSelect, parseOrderBy, quoteIdentifier } = require('../services/database/sqlQueryBuilder');
const { validateFilterModel, FILTER_OPERATORS } = require('../services/database/queryBuilderCommon');
const sqlService = require('../services/database/sqlService');
const mongoService = require('../services/database/mongoService');
const { getActivity } = require('../engine/workflow/activityRegistry');

// ─── In-memory VS Code storage mocks ─────────────────────────────────────────

function makeMemoryState() {
    const store = new Map();
    return {
        globalState: {
            get: (key, def) => (store.has(key) ? store.get(key) : def),
            update: async (key, value) => { store.set(key, value); }
        },
        secrets: {
            get: async (key) => (store.has(key) ? store.get(key) : undefined),
            store: async (key, value) => { store.set(key, value); },
            delete: async (key) => { store.delete(key); }
        }
    };
}

const mongoProfile = {
    name: 'Analytics DB',
    type: 'mongodb',
    host: 'localhost',
    port: 27017,
    database: 'analytics',
    username: 'admin',
    password: 's3cret',
    ssl: true
};

const sqlProfile = {
    name: 'Sales DB',
    type: 'mysql',
    host: 'db.internal',
    port: 3306,
    database: 'sales',
    username: 'reporter',
    password: 'pw123'
};

// ─── Test Suite ──────────────────────────────────────────────────────────────

suite('Database Services Test Suite', () => {

    // ── ConnectionManager ───────────────────────────────────────────────────
    suite('ConnectionManager', () => {
        test('save assigns an id, persists metadata and stores the secret', async () => {
            const cm = createConnectionManager(makeMemoryState());
            const saved = await cm.save({ ...mongoProfile });
            assert.ok(saved.id, 'should assign an id');
            assert.strictEqual(saved.password, undefined, 'saved return value must be redacted');
            assert.strictEqual(saved.connectionString, undefined);

            const fetched = await cm.get(saved.id);
            assert.strictEqual(fetched.password, 's3cret', 'get() must merge the stored secret');
            assert.strictEqual(fetched.name, 'Analytics DB');
        });

        test('list() never exposes secrets', async () => {
            const cm = createConnectionManager(makeMemoryState());
            await cm.save({ ...mongoProfile });
            await cm.save({ ...sqlProfile });
            const all = cm.list();
            assert.strictEqual(all.length, 2);
            for (const conn of all) {
                assert.strictEqual(conn.password, undefined);
                assert.strictEqual(conn.connectionString, undefined);
            }
        });

        test('getByName matches case-insensitively and by id', async () => {
            const cm = createConnectionManager(makeMemoryState());
            const saved = await cm.save({ ...sqlProfile });
            const byName = await cm.getByName('SALES db');
            assert.ok(byName, 'should resolve case-insensitively');
            assert.strictEqual(byName.id, saved.id);
            assert.strictEqual(byName.password, 'pw123');

            const byId = await cm.getByName(saved.id);
            assert.strictEqual(byId.id, saved.id);
        });

        test('editing without a new password preserves the stored secret', async () => {
            const cm = createConnectionManager(makeMemoryState());
            const saved = await cm.save({ ...sqlProfile });

            const updated = await cm.save({ ...sqlProfile, id: saved.id, host: 'db.internal:3307' });
            assert.strictEqual(updated.host, 'db.internal:3307');
            const fetched = await cm.get(saved.id);
            assert.strictEqual(fetched.password, 'pw123', 'secret must survive an edit that omits it');
        });

        test('providing a new password replaces the stored secret', async () => {
            const cm = createConnectionManager(makeMemoryState());
            const saved = await cm.save({ ...sqlProfile });
            await cm.save({ ...sqlProfile, id: saved.id, password: 'new-pw' });
            const fetched = await cm.get(saved.id);
            assert.strictEqual(fetched.password, 'new-pw');
        });

        test('saving a new profile with an existing name reuses the same id', async () => {
            const cm = createConnectionManager(makeMemoryState());
            const first = await cm.save({ ...sqlProfile });
            const second = await cm.save({ ...sqlProfile }); // no id provided
            assert.strictEqual(second.id, first.id, 'id must stay stable for a given name');
            assert.strictEqual(cm.list().length, 1);
        });

        test('delete removes metadata and the secret', async () => {
            const cm = createConnectionManager(makeMemoryState());
            const saved = await cm.save({ ...mongoProfile });
            const removed = await cm.delete(saved.id);
            assert.strictEqual(removed, true);
            assert.strictEqual(cm.list().length, 0);
            assert.strictEqual(await cm.get(saved.id), null);
            assert.strictEqual(await cm.delete(saved.id), false);
        });

        test('validateProfile rejects invalid profiles', async () => {
            const cm = createConnectionManager(makeMemoryState());
            await assert.rejects(() => cm.save({}), /name.*is required/);
            await assert.rejects(() => cm.save({ name: 'x', type: 'oracle', host: 'h' }), /Unsupported connection type/);
            await assert.rejects(() => cm.save({ name: 'x', type: 'mysql' }), /host.*is required/);
        });

        test('connection-string-only profiles skip the host requirement', async () => {
            const cm = createConnectionManager(makeMemoryState());
            const saved = await cm.save({
                name: 'Atlas',
                type: 'mongodb',
                connectionString: '' //mongodb+srv://<YourUsername>:<YourPassword>@cluster.mongodb.net/db
            });
            assert.ok(saved.id);
            const fetched = await cm.get(saved.id);
            assert.strictEqual(fetched.connectionString, ''); // the connection string is preserved
            assert.strictEqual(fetched.password, undefined);
        });
    });

    // ── Mongo filter builder ────────────────────────────────────────────────
    suite('mongoFilterBuilder', () => {
        test('builds an equals condition with value coercion', () => {
            const { filter, errors } = buildMongoFilter({
                conditions: [{ column: 'status', operator: 'equals', value: 'active' }]
            });
            assert.deepStrictEqual(errors, []);
            assert.deepStrictEqual(filter, { status: 'active' });
        });

        test('coerces numeric and boolean strings', () => {
            assert.strictEqual(coerceValue('42'), 42);
            assert.strictEqual(coerceValue('true'), true);
            assert.strictEqual(coerceValue('abc'), 'abc');
        });

        test('builds a contains condition as a case-insensitive regex', () => {
            const { filter } = buildMongoFilter({
                conditions: [{ column: 'name', operator: 'contains', value: 'foo.bar' }]
            });
            assert.deepStrictEqual(filter, { name: { $regex: 'foo\\.bar', $options: 'i' } });
        });

        test('combines conditions with AND and OR', () => {
            const { filter } = buildMongoFilter({
                conditions: [
                    { column: 'a', operator: 'equals', value: '1' },
                    { column: 'b', operator: 'equals', value: '2', conjunction: 'OR' }
                ]
            });
            assert.deepStrictEqual(filter, {
                $or: [{ a: 1 }, { b: 2 }]
            });
        });

        test('builds between and null checks', () => {
            const between = buildMongoFilter({
                conditions: [{ column: 'amount', operator: 'between', value: '10,20' }]
            });
            assert.deepStrictEqual(between.filter, { amount: { $gte: 10, $lte: 20 } });

            const isNull = buildMongoFilter({
                conditions: [{ column: 'deletedAt', operator: 'isNull' }]
            });
            assert.deepStrictEqual(isNull.filter, { deletedAt: null });

            const isNotNull = buildMongoFilter({
                conditions: [{ column: 'deletedAt', operator: 'isNotNull' }]
            });
            assert.deepStrictEqual(isNotNull.filter, { deletedAt: { $ne: null } });
        });

        test('treats a literal null value as null semantics', () => {
            const notEquals = buildMongoFilter({
                conditions: [{ column: 'artisanID', operator: 'notEquals', value: 'null' }]
            });
            assert.deepStrictEqual(notEquals.filter, { artisanID: { $ne: null } });
            assert.deepStrictEqual(notEquals.errors, []);

            const equals = buildMongoFilter({
                conditions: [{ column: 'artisanID', operator: 'equals', value: 'NULL' }]
            });
            assert.deepStrictEqual(equals.filter, { artisanID: null });
        });

        test('quoted "null" stays a literal string', () => {
            const { filter } = buildMongoFilter({
                conditions: [{ column: 'code', operator: 'notEquals', value: "'null'" }]
            });
            assert.deepStrictEqual(filter, { code: { $ne: 'null' } });
        });

        test('returns validation errors for bad operators', () => {
            const { filter, errors } = buildMongoFilter({
                conditions: [{ column: 'a', operator: 'bogus', value: 'x' }]
            });
            assert.deepStrictEqual(filter, {});
            assert.ok(errors.length > 0);
        });

        test('empty model yields an empty filter', () => {
            assert.deepStrictEqual(buildMongoFilter({ conditions: [] }).filter, {});
        });
    });

    // ── SQL query builder ───────────────────────────────────────────────────
    suite('sqlQueryBuilder', () => {
        test('mysql uses backticks and ? placeholders', () => {
            const { where, params, errors } = buildSqlWhere({
                conditions: [
                    { column: 'status', operator: 'equals', value: 'active' },
                    { column: 'amount', operator: 'greaterThan', value: '100', conjunction: 'AND' }
                ]
            }, 'mysql');
            assert.deepStrictEqual(errors, []);
            assert.strictEqual(where, '`status` = ? AND `amount` > ?');
            assert.deepStrictEqual(params, ['active', '100']);
        });

        test('postgresql uses double quotes and $n placeholders', () => {
            const { where, params } = buildSqlWhere({
                conditions: [
                    { column: 'name', operator: 'startsWith', value: 'Ac' },
                    { column: 'age', operator: 'lessThan', value: '30', conjunction: 'OR' }
                ]
            }, 'postgresql');
            assert.strictEqual(where, '"name" ILIKE $1 OR "age" < $2');
            assert.deepStrictEqual(params, ['Ac%', '30']);
        });

        test('a literal null value builds IS NULL / IS NOT NULL', () => {
            const notEquals = buildSqlWhere({
                conditions: [{ column: 'artisanID', operator: 'notEquals', value: 'null' }]
            }, 'postgresql');
            assert.deepStrictEqual(notEquals.errors, []);
            assert.strictEqual(notEquals.where, '"artisanID" IS NOT NULL');
            assert.deepStrictEqual(notEquals.params, []);

            const equals = buildSqlWhere({
                conditions: [{ column: 'artisanID', operator: 'equals', value: 'NULL' }]
            }, 'mysql');
            assert.deepStrictEqual(equals.errors, []);
            assert.strictEqual(equals.where, '`artisanID` IS NULL');
        });

        test('buildSelect produces a full statement', () => {
            const { sql, params, errors } = buildSelect({
                table: 'orders',
                dialect: 'postgresql',
                columns: ['id', 'customer'],
                filterModel: { conditions: [{ column: 'status', operator: 'equals', value: 'paid' }] },
                orderBy: 'created_at DESC',
                limit: 25
            });
            assert.deepStrictEqual(errors, []);
            assert.strictEqual(sql, 'SELECT "id", "customer" FROM "orders" WHERE "status" = $1 ORDER BY created_at DESC LIMIT 25');
            assert.deepStrictEqual(params, ['paid']);
        });

        test('quoteIdentifier escapes embedded quote characters', () => {
            assert.strictEqual(quoteIdentifier('we`ird', 'mysql'), '`we``ird`');
            assert.strictEqual(quoteIdentifier('we"ird', 'postgresql'), '"we""ird"');
        });

        test('validateFilterModel rejects missing columns and values', () => {
            const errors = validateFilterModel({
                conditions: [
                    { operator: 'equals', value: 'x' },
                    { column: 'a', operator: 'equals' }
                ]
            });
            assert.ok(errors.some((e) => e.includes('column is required')));
            assert.ok(errors.some((e) => e.includes('value is required')));
        });

        test('FILTER_OPERATORS exposes a complete vocabulary', () => {
            assert.ok(Array.isArray(FILTER_OPERATORS));
            assert.ok(FILTER_OPERATORS.some((o) => o.value === 'between'));
            assert.ok(FILTER_OPERATORS.some((o) => o.value === 'isNotEmpty'));
        });

        test('parseOrderBy converts the UI col:desc syntax into quoted SQL', () => {
            assert.strictEqual(parseOrderBy('name:desc', 'mysql'), '`name` DESC');
            assert.strictEqual(parseOrderBy('created_at:asc', 'postgresql'), '"created_at" ASC');
        });

        test('parseOrderBy passes raw SQL ORDER BY expressions through', () => {
            assert.strictEqual(parseOrderBy('created_at DESC', 'mysql'), 'created_at DESC');
            assert.strictEqual(parseOrderBy('a.b, c DESC', 'postgresql'), 'a.b, c DESC');
        });

        test('parseOrderBy mixes both forms with commas', () => {
            assert.strictEqual(
                parseOrderBy('name:asc, amount desc', 'postgresql'),
                '"name" ASC, amount desc'
            );
        });

        test('buildSelect uses the parsed order by', () => {
            const { sql, errors } = buildSelect({ table: 'orders', dialect: 'mysql', orderBy: 'name:desc', limit: 10 });
            assert.deepStrictEqual(errors, []);
            assert.strictEqual(sql, 'SELECT * FROM `orders` ORDER BY `name` DESC LIMIT 10');
        });
    });

    // ── sqlService.buildDriverConfig ────────────────────────────────────────
    suite('sqlService.buildDriverConfig', () => {
        const { buildDriverConfig } = sqlService;

        test('maps MySQL connection strings to the mysql2 `uri` option', () => {
            const cfg = buildDriverConfig({ type: 'mysql', connectionString: 'mysql://u:p@h:3307/db' });
            assert.strictEqual(cfg.uri, 'mysql://u:p@h:3307/db');
            assert.strictEqual(cfg.connectionString, undefined, 'mysql2 has no connectionString key — must be uri');
        });

        test('keeps PostgreSQL connection strings as connectionString', () => {
            const cfg = buildDriverConfig({ type: 'postgresql', connectionString: 'postgresql://u:p@h:5433/db' });
            assert.strictEqual(cfg.connectionString, 'postgresql://u:p@h:5433/db');
            assert.strictEqual(cfg.uri, undefined);
        });

        test('builds a field-based config when no connection string is present', () => {
            const cfg = buildDriverConfig({ type: 'mysql', host: 'db.local', port: '3306', username: 'u', password: 'p', database: 'd' });
            assert.strictEqual(cfg.host, 'db.local');
            assert.strictEqual(cfg.port, 3306);
            assert.strictEqual(cfg.user, 'u');
            assert.strictEqual(cfg.uri, undefined);
        });
    });

    // ── sqlService.listColumns ──────────────────────────────────────────────
    suite('sqlService.listColumns', () => {
        test('returns plain column-name strings (not {name,type} objects)', async () => {
            const originalLoad = Module._load;
            const pgPath = require.resolve('pg');
            const cached = require.cache[pgPath];
            delete require.cache[pgPath];
            Module._load = function (request) {
                if (request === 'pg') {
                    return {
                        Client: class {
                            constructor() {}
                            async connect() {}
                            async end() {}
                            query() { return { rows: [{ column_name: 'id' }, { column_name: 'name' }] }; }
                        }
                    };
                }
                return originalLoad.apply(this, arguments);
            };
            try {
                const cols = await sqlService.listColumns({ type: 'postgresql' }, 'users');
                assert.deepStrictEqual(cols, ['id', 'name']);
                assert.ok(cols.every((c) => typeof c === 'string'));
            } finally {
                Module._load = originalLoad;
                if (cached) require.cache[pgPath] = cached;
            }
        });
    });

    // ── sqlService.validateSelect ──────────────────────────────────────────────
    suite('sqlService.validateSelect', () => {
        const { validateSelect } = sqlService;

        test('accepts plain SELECT and WITH statements', () => {
            assert.strictEqual(validateSelect('SELECT * FROM t'), 'SELECT * FROM t');
            assert.strictEqual(validateSelect('WITH x AS (SELECT 1) SELECT * FROM x'), 'WITH x AS (SELECT 1) SELECT * FROM x');
            assert.strictEqual(validateSelect('select id from t;'), 'select id from t', 'trailing semicolon is tolerated');
        });

        test('rejects write / DDL statements', () => {
            // Leading write/DDL keywords fail the SELECT/WITH guard first.
            assert.throws(() => validateSelect('INSERT INTO t VALUES (1)'), /Only SELECT/);
            assert.throws(() => validateSelect('UPDATE t SET a=1'), /Only SELECT/);
            assert.throws(() => validateSelect('DELETE FROM t'), /Only SELECT/);
            assert.throws(() => validateSelect('DROP TABLE t'), /Only SELECT/);
            assert.throws(() => validateSelect('CREATE TABLE t (a int)'), /Only SELECT/);
        });

        test('rejects multi-statement input', () => {
            assert.throws(() => validateSelect('SELECT 1; SELECT 2'), /Multiple SQL statements/);
        });

        test('rejects non-query strings', () => {
            assert.throws(() => validateSelect('   '), /Only SELECT/);
            assert.throws(() => validateSelect('SHOW TABLES'), /Only SELECT/);
        });
    });

    // ── Mongo SRV resilience ─────────────────────────────────────────────────
    suite('mongoService SRV helpers', () => {
        const { isSrvUri, isDnsError, parseSrvUri, srvToStandardUri } = mongoService;

        test('isSrvUri detects the mongodb+srv scheme', () => {
            assert.strictEqual(isSrvUri('mongodb+srv://u:p@h/db'), true);
            assert.strictEqual(isSrvUri('mongodb://u:p@h/db'), false);
            assert.strictEqual(isSrvUri(''), false);
            assert.strictEqual(isSrvUri(null), false);
        });

        test('isDnsError recognizes querySrv and friends', () => {
            assert.strictEqual(isDnsError(new Error('querySrv ECONNREFUSED _mongodb._tcp.x')), true);
            assert.strictEqual(isDnsError(new Error('getaddrinfo ENOTFOUND host')), true);
            assert.strictEqual(isDnsError(new Error('bad auth')), false);
        });

        test('parseSrvUri extracts auth, host, db and options', () => {
            const parsed = parseSrvUri('mongodb+srv://user:pass@cluster.mongodb.net/sales?appName=MyApp&retryWrites=true');
            assert.strictEqual(parsed.auth, 'user:pass');
            assert.strictEqual(parsed.host, 'cluster.mongodb.net');
            assert.strictEqual(parsed.db, 'sales');
            assert.deepStrictEqual(parsed.queryOptions, { appName: 'MyApp', retryWrites: 'true' });
        });

        test('parseSrvUri tolerates URIs without database', () => {
            const parsed = parseSrvUri('mongodb+srv://user:pass@cluster.mongodb.net');
            assert.strictEqual(parsed.auth, 'user:pass');
            assert.strictEqual(parsed.host, 'cluster.mongodb.net');
            assert.strictEqual(parsed.db, '');
        });

        test('srvToStandardUri builds a seed-list URI from SRV/TXT records', async () => {
            const fakeResolver = (name, type) => {
                if (type === 'SRV') {
                    return Promise.resolve([
                        { name, type: 33, TTL: 60, data: '0 0 27017 ac-x-shard-00-00.h.mongodb.net.' },
                        { name, type: 33, TTL: 60, data: '0 0 27017 ac-x-shard-00-01.h.mongodb.net.' }
                    ]);
                }
                return Promise.resolve([
                    { name, type: 16, TTL: 60, data: '"authSource=admin&replicaSet=atlas-abc-shard-0"' }
                ]);
            };
            const standard = await srvToStandardUri(
                'mongodb+srv://user:pass@cluster.mongodb.net/sales?appName=MyApp',
                fakeResolver
            );
            assert.strictEqual(
                standard,
                'mongodb://user:pass@ac-x-shard-00-00.h.mongodb.net:27017,ac-x-shard-00-01.h.mongodb.net:27017/sales?replicaSet=atlas-abc-shard-0&authSource=admin&appName=MyApp&ssl=true'
            );
        });

        test('srvToStandardUri throws when no SRV records are returned', async () => {
            const fakeResolver = () => Promise.resolve([]);
            await assert.rejects(
                () => srvToStandardUri('mongodb+srv://u@cluster.mongodb.net', fakeResolver),
                /No SRV records/
            );
        });

        test('srvToStandardUri succeeds when TXT lookup fails', async () => {
            const fakeResolver = (name, type) => {
                if (type === 'SRV') {
                    return Promise.resolve([
                        { name, type: 33, TTL: 60, data: '0 0 27017 shard-00.h.mongodb.net.' }
                    ]);
                }
                return Promise.reject(new Error('DNS-over-HTTPS lookup failed for TXT'));
            };
            const standard = await srvToStandardUri(
                'mongodb+srv://user:pass@cluster.mongodb.net/sales',
                fakeResolver
            );
            assert.ok(standard.includes('shard-00.h.mongodb.net:27017'));
            assert.ok(standard.includes('ssl=true'));
            assert.ok(!standard.includes('replicaSet='));
            assert.ok(!standard.includes('authSource='));
        });

        test('isDnsError recognizes DoH fallback errors', () => {
            assert.strictEqual(isDnsError(new Error('DNS-over-HTTPS lookup failed for _mongodb._tcp.x (TXT)')), true);
        });
    });

    // ── mongoService.listDatabases ─────────────────────────────────────────
    suite('mongoService.listDatabases', () => {
        const realLoad = Module._load;
        const mongoKey = require.resolve('../services/database/mongoService');
        const originalMongoEntry = require.cache[mongoKey];

        function withFakeClient(fake) {
            const fakeMongo = { MongoClient: fake, ObjectId: class {} };
            Module._load = function (request) {
                if (request === 'mongodb') return fakeMongo;
                return realLoad.apply(this, arguments);
            };
            delete require.cache[mongoKey];
            return require('../services/database/mongoService');
        }

        function restoreMongo() {
            Module._load = realLoad;
            require.cache[mongoKey] = originalMongoEntry;
        }

        function makeClient(databases) {
            return {
                async connect() {},
                async close() {},
                db() {
                    return {
                        admin: () => ({
                            listDatabases: async () => ({ databases })
                        })
                    };
                }
            };
        }

        let fakeClient;
        function FakeMongoClient() { return fakeClient; }

        test('drops system DBs and prioritizes the connection database', async () => {
            fakeClient = makeClient([
                { name: 'config' },
                { name: 'analytics' },
                { name: 'local' },
                { name: 'admin' },
                { name: 'logs' }
            ]);
            try {
                const ms = withFakeClient(FakeMongoClient);
                const dbs = await ms.listDatabases({ ...mongoProfile, database: 'analytics' });
                assert.deepStrictEqual(dbs, ['analytics', 'logs']);
            } finally {
                restoreMongo();
            }
        });

        test('returns sorted user DBs when no preferred database matches', async () => {
            fakeClient = makeClient([
                { name: 'admin' },
                { name: 'metrics' },
                { name: 'logs' }
            ]);
            try {
                const ms = withFakeClient(FakeMongoClient);
                const dbs = await ms.listDatabases({ ...mongoProfile, database: 'does-not-exist' });
                assert.deepStrictEqual(dbs, ['logs', 'metrics']);
            } finally {
                restoreMongo();
            }
        });
    });

    // ── Database activities ─────────────────────────────────────────────────
    suite('Database workflow activities', () => {
        let readSql;
        let readMongo;
        let sqlQuery;
        let mongoQuery;

        suiteSetup(() => {
            readSql = getActivity('readSql', true);
            readMongo = getActivity('readMongo', true);
            sqlQuery = getActivity('sqlQuery', true);
            mongoQuery = getActivity('mongoQuery', true);
            assert.ok(readSql, 'readSql activity must be registered');
            assert.ok(readMongo, 'readMongo activity must be registered');
            assert.ok(sqlQuery, 'sqlQuery activity must be registered');
            assert.ok(mongoQuery, 'mongoQuery activity must be registered');
        });

        function fakeContext() {
            const connections = new Map();
            const setConnection = (profile) => {
                const conn = { ...profile, id: profile.name.toLowerCase() };
                connections.set(conn.name.toLowerCase(), conn);
                return conn;
            };
            const manager = {
                getByName: async (name) => {
                    if (name === undefined || name === null) return null;
                    return connections.get(String(name).toLowerCase()) || null;
                }
            };
            return { connectionManager: manager, setConnection };
        }

        test('readSql executes with a parameterized SELECT via buildSelect', async () => {
            const ctx = fakeContext();
            ctx.setConnection(sqlProfile);
            const original = sqlService.runSelect;
            let captured = null;
            sqlService.runSelect = async (profile, sql, params) => {
                captured = { profile, sql, params };
                return {
                    rows: [{ id: 1, name: 'Alice' }],
                    columns: ['id', 'name'],
                    rowCount: 1
                };
            };
            try {
                const ds = await readSql.execute({
                    connection: 'Sales DB',
                    table: 'customers',
                    columns: 'id, name',
                    filterModel: { conditions: [{ column: 'status', operator: 'equals', value: 'active' }] },
                    limit: '10'
                }, ctx, null);

                assert.strictEqual(ds.getRowCount(), 1);
                assert.deepStrictEqual(ds.getColumns(), ['id', 'name']);
                assert.strictEqual(captured.profile.password, 'pw123', 'execution must receive the merged secret');
                assert.strictEqual(
                    captured.sql,
                    'SELECT `id`, `name` FROM `customers` WHERE `status` = ? LIMIT 10'
                );
                assert.deepStrictEqual(captured.params, ['active']);
            } finally {
                sqlService.runSelect = original;
            }
        });

        test('readSql supports a raw WHERE clause', async () => {
            const ctx = fakeContext();
            ctx.setConnection(sqlProfile);
            const original = sqlService.runSelect;
            let captured = null;
            sqlService.runSelect = async (_p, sql) => {
                captured = sql;
                return { rows: [], columns: ['id'], rowCount: 0 };
            };
            try {
                await readSql.execute({
                    connection: 'Sales DB',
                    table: 'customers',
                    columns: '',
                    where: "amount > 100 AND status = 'active'",
                    orderBy: 'created_at DESC',
                    limit: '50'
                }, ctx, null);
                // The LIMIT is applied inside runSelect (opts.limit), not inline here.
                assert.strictEqual(
                    captured,
                    "SELECT * FROM `customers` WHERE amount > 100 AND status = 'active' ORDER BY created_at DESC"
                );
            } finally {
                sqlService.runSelect = original;
            }
        });

        test('readSql rejects a string filterModel with a clear error', async () => {
            const ctx = fakeContext();
            ctx.setConnection(sqlProfile);
            await assert.rejects(
                () => readSql.execute({
                    connection: 'Sales DB',
                    table: 'customers',
                    filterModel: 'not-a-real-object'
                }, ctx, null),
                /filterModel.*conditions/
            );
            await assert.rejects(
                () => readSql.execute({
                    connection: 'Sales DB',
                    table: 'customers',
                    filterModel: { conditions: 'nope' }
                }, ctx, null),
                /filterModel.*conditions/
            );
        });

        test('readMongo executes with a JSON filter document', async () => {
            const ctx = fakeContext();
            ctx.setConnection(mongoProfile);
            const original = mongoService.find;
            let captured = null;
            mongoService.find = async (profile, opts) => {
                captured = { profile, opts };
                return {
                    rows: [{ _id: 1, name: 'Alice', address: { city: 'NYC' } }],
                    columns: ['_id', 'name', 'address.city']
                };
            };
            try {
                const ds = await readMongo.execute({
                    connection: 'Analytics DB',
                    database: 'analytics',
                    collection: 'users',
                    filter: '{ "status": "active" }',
                    projection: 'name',
                    sort: 'createdAt:-1',
                    limit: '20'
                }, ctx, null);

                assert.strictEqual(ds.getRowCount(), 1);
                assert.deepStrictEqual(captured.opts, {
                    database: 'analytics',
                    collection: 'users',
                    filter: { status: 'active' },
                    projection: { name: 1 },
                    sort: { createdAt: -1 },
                    limit: 20
                });
            } finally {
                mongoService.find = original;
            }
        });

        test('sqlQuery executes a raw validated SELECT', async () => {
            const ctx = fakeContext();
            ctx.setConnection(sqlProfile);
            const original = sqlService.runSelect;
            let captured = null;
            sqlService.runSelect = async (profile, sql, params, opts) => {
                captured = { sql, params, opts };
                return { rows: [{ a: 1 }], columns: ['a'], rowCount: 1 };
            };
            try {
                const ds = await sqlQuery.execute({
                    connection: 'Sales DB',
                    sql: 'SELECT * FROM orders WHERE amount > 100',
                    limit: '1000'
                }, ctx, null);
                assert.strictEqual(ds.getRowCount(), 1);
                assert.strictEqual(captured.sql, 'SELECT * FROM orders WHERE amount > 100');
            } finally {
                sqlService.runSelect = original;
            }
        });

        test('mongoQuery requires a filter', async () => {
            const ctx = fakeContext();
            ctx.setConnection(mongoProfile);
            await assert.rejects(
                () => mongoQuery.execute({ connection: 'Analytics DB', collection: 'users' }, ctx, null),
                /"filter" is required/
            );
        });

        test('missing required config fields throw', async () => {
            const ctx = fakeContext();
            ctx.setConnection(sqlProfile);
            await assert.rejects(() => readSql.execute({ connection: 'Sales DB' }, ctx, null), /"table" is required/);
            await assert.rejects(() => readMongo.execute({ connection: 'Analytics DB' }, ctx, null), /"collection" is required/);
            await assert.rejects(() => readMongo.execute({ table: 'x', collection: 'y' }, ctx, null), /"connection" is required/);
        });

        test('an unknown connection produces a friendly error', async () => {
            const ctx = fakeContext();
            ctx.setConnection(sqlProfile);
            await assert.rejects(
                () => readSql.execute({ connection: 'Nope', table: 't' }, ctx, null),
                /was not found/
            );
        });
    });
});

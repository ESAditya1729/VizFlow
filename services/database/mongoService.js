/**
 * services/database/mongoService.js
 *
 * Read-only MongoDB adapter used by the Data Sources panel and the workflow
 * activities. Only `find()` (filter + projection + sort + limit) is exposed —
 * no aggregation pipelines or write operations, keeping the adapter safe for
 * non-technical users.
 */

'use strict';

const https = require('https');
const { MongoClient, ObjectId } = require('mongodb');

const DEFAULT_PORT = 27017;
const CONNECT_TIMEOUT_MS = 5000;
const SERVER_SELECTION_TIMEOUT_MS = 5000;
const MAX_ROWS = 100000;

// Transient-DNS resilience: some home / corporate DNS servers intermittently
// refuse SRV lookups (`querySrv ECONNREFUSED`), so retry a couple of times
// before giving up.
const CONNECT_RETRIES = 3;
const CONNECT_RETRY_DELAY_MS = 400;

// ─── Connection helpers ──────────────────────────────────────────────────────

/**
 * Build a MongoDB URI from a connection profile.
 * @param {Object} profile
 * @returns {string}
 */
function buildUri(profile) {
    if (profile.connectionString && profile.connectionString.trim()) {
        return profile.connectionString.trim();
    }
    const user = profile.username ? encodeURIComponent(profile.username) : '';
    const pass = profile.password ? encodeURIComponent(profile.password) : '';
    const creds = user ? `${user}:${pass}@` : '';
    const host = profile.host || 'localhost';
    const port = profile.port || DEFAULT_PORT;
    const db = profile.database ? `/${encodeURIComponent(profile.database)}` : '';
    return `mongodb://${creds}${host}:${port}${db}`;
}

/**
 * Open a MongoDB client with sane read-only defaults.
 * @param {Object} profile
 * @param {Object} [options]
 * @returns {Promise<MongoClient>}
 */
async function openClient(profile, options = {}) {
    const uri = buildUri(profile);
    const srv = isSrvUri(uri);
    let lastErr;
    for (let attempt = 0; attempt < CONNECT_RETRIES; attempt++) {
        const client = new MongoClient(uri, {
            serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
            connectTimeoutMS: CONNECT_TIMEOUT_MS,
            ...options
        });
        try {
            await client.connect();
            return client;
        } catch (err) {
            lastErr = err;
            await client.close().catch(() => {});
            if (!(srv && isDnsError(err))) break;
            if (attempt < CONNECT_RETRIES - 1) {
                await sleep(CONNECT_RETRY_DELAY_MS * (attempt + 1));
            }
        }
    }

    // The local DNS server keeps refusing the SRV lookup. Transparently
    // convert the URI to a standard seed list over DNS-over-HTTPS (bypassing
    // the local DNS server) and try once more.
    if (srv && isDnsError(lastErr)) {
        try {
            const standardUri = await srvToStandardUri(uri);
            const client = new MongoClient(standardUri, {
                serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
                connectTimeoutMS: CONNECT_TIMEOUT_MS,
                ...options
            });
            await client.connect();
            return client;
        } catch (err) {
            if (isDnsError(err)) throw lastErr;
            throw err;
        }
    }
    throw lastErr;
}

/**
 * Test a MongoDB connection.
 * @param {Object} profile
 * @returns {Promise<{ ok: boolean, message?: string, error?: string }>}
 */
async function testConnection(profile) {
    let client;
    try {
        client = await openClient(profile);
        await client.db(profile.database || 'admin').command({ ping: 1 });
        return { ok: true, message: 'Connected successfully to MongoDB' };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    } finally {
        if (client) await client.close();
    }
}

/**
 * List databases visible to the connection.
 * @param {Object} profile
 * @returns {Promise<Array<string>>}
 */
async function listDatabases(profile) {
    let client;
    try {
        client = await openClient(profile);
        const result = await client.db(profile.database || 'admin').admin().listDatabases();
        const names = (result.databases || [])
            .map((d) => d.name)
            .filter((n) => n !== 'local');
        // Drop MongoDB system databases and sort so auto-selection in the
        // Workflow Builder picks a user database (not "admin"/"config").
        const system = new Set(['admin', 'config', 'local']);
        const userDbs = names.filter((n) => !system.has(n)).sort((a, b) => a.localeCompare(b));
        // Prioritize the connection's default database so auto-selection
        // lands on the database the user actually configured.
        const preferred = profile.database;
        if (preferred && !system.has(preferred)) {
            const idx = userDbs.findIndex((n) => n === preferred);
            if (idx > 0) {
                const [p] = userDbs.splice(idx, 1);
                userDbs.unshift(p);
            }
        }
        return userDbs.length > 0 ? userDbs : names;
    } finally {
        if (client) await client.close();
    }
}

/**
 * List collections in a database.
 * @param {Object} profile
 * @param {string} dbName
 * @returns {Promise<Array<string>>}
 */
async function listCollections(profile, dbName) {
    if (!dbName) return [];
    let client;
    try {
        client = await openClient(profile);
        const db = client.db(dbName);
        const collections = await db.listCollections({}, { nameOnly: true }).toArray();
        return collections.map((c) => c.name).sort();
    } finally {
        if (client) await client.close();
    }
}

/**
 * Count documents in a collection (optionally filtered).
 * @param {Object} profile
 * @param {Object} opts
 * @param {string} opts.database
 * @param {string} opts.collection
 * @param {Object} [opts.filter]
 * @returns {Promise<number>}
 */
async function getCount(profile, { database, collection, filter = {} }) {
    let client;
    try {
        client = await openClient(profile);
        const coll = client.db(database).collection(collection);
        const hasFilter = filter && typeof filter === 'object' && Object.keys(filter).length > 0;
        return hasFilter
            ? await coll.countDocuments(filter)
            : await coll.estimatedDocumentCount();
    } finally {
        if (client) await client.close();
    }
}

/**
 * Run a read-only find query against a collection.
 * @param {Object} profile
 * @param {Object} opts
 * @param {string} opts.database
 * @param {string} opts.collection
 * @param {Object} [opts.filter] - Mongo filter document ({} for all)
 * @param {Object|Array|null} [opts.projection]
 * @param {Object} [opts.sort]
 * @param {number} [opts.limit]
 * @param {number} [opts.skip]
 * @returns {Promise<{ rows: Array<Object>, columns: Array<string>, total?: number }>}
 */
async function find(profile, { database, collection, filter = {}, projection = null, sort = null, limit = 0, skip = 0 }) {
    const safeLimit = limit > 0 ? Math.min(Math.floor(limit), MAX_ROWS) : MAX_ROWS;
    let client;
    try {
        client = await openClient(profile);
        const db = client.db(database);
        const cursor = db.collection(collection).find(filter || {});
        if (projection) cursor.project(projection);
        if (sort) cursor.sort(sort);
        if (skip > 0) cursor.skip(Math.floor(skip));
        cursor.limit(safeLimit);

        const docs = await cursor.toArray();
        const { rows, columns } = documentsToRows(docs);
        return { rows, columns };
    } finally {
        if (client) await client.close();
    }
}

/**
 * Preview a collection: first N documents with no filter.
 * @param {Object} profile
 * @param {Object} opts
 * @param {string} opts.database
 * @param {string} opts.collection
 * @param {number} [opts.limit]
 * @returns {Promise<{ rows: Array<Object>, columns: Array<string> }>}
 */
async function preview(profile, { database, collection, limit = 50 }) {
    return find(profile, { database, collection, filter: {}, limit });
}

// ─── Row shaping ─────────────────────────────────────────────────────────────

/**
 * Convert a Mongo value into a Dataset-friendly value.
 * @param {*} value
 * @param {string} prefix - Dot-path prefix for nested objects
 * @param {Object} out - Output object receiving flattened keys
 */
function flattenValue(value, prefix, out) {
    if (value === null || value === undefined) {
        out[prefix] = null;
        return;
    }
    if (typeof value === 'object') {
        if (value instanceof Date) {
            out[prefix] = value.toISOString();
            return;
        }
        if (value instanceof Buffer) {
            out[prefix] = value.toString('base64');
            return;
        }
        if (value instanceof ObjectId) {
            out[prefix] = value.toString();
            return;
        }
        if (Array.isArray(value)) {
            out[prefix] = JSON.stringify(value);
            return;
        }
        const keys = Object.keys(value);
        if (keys.length === 0) {
            out[prefix] = JSON.stringify(value);
            return;
        }
        for (const key of keys) {
            flattenValue(value[key], prefix ? `${prefix}.${key}` : key, out);
        }
        return;
    }
    out[prefix] = value;
}

/**
 * Flatten a single Mongo document into a flat row object.
 * @param {Object} doc
 * @returns {Object}
 */
function flattenDocument(doc) {
    const out = {};
    flattenValue(doc, '', out);
    return out;
}

/**
 * Convert an array of Mongo documents into rows + ordered columns.
 * @param {Array<Object>} docs
 * @returns {{ rows: Array<Object>, columns: Array<string> }}
 */
function documentsToRows(docs) {
    const rows = docs.map(flattenDocument);
    const columns = [];
    const seen = new Set();
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (!seen.has(key)) {
                seen.add(key);
                columns.push(key);
            }
        }
    }
    return { rows, columns };
}

// ─── SRV resilience ──────────────────────────────────────────────────────────

/**
 * True when a MongoDB URI uses the SRV scheme (`mongodb+srv://`).
 * @param {string} uri
 * @returns {boolean}
 */
function isSrvUri(uri) {
    return /^mongodb\+srv:\/\//i.test(String(uri || '').trim());
}

/**
 * True when an error looks like a DNS / SRV resolution failure.
 * @param {*} err
 * @returns {boolean}
 */
function isDnsError(err) {
    const msg = String((err && err.message) || err || '');
    return /querySrv|ECONNREFUSED|ENOTFOUND|ESERVFAIL|EBADRESP|ETIMEOUT|SERVFAIL/i.test(msg);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a `mongodb+srv://` URI into its components.
 * @param {string} uri
 * @returns {{ auth: string, host: string, db: string, queryOptions: Object }}
 */
function parseSrvUri(uri) {
    const rest = String(uri || '').replace(/^mongodb\+srv:\/\//i, '');
    let auth = '';
    let remainder = rest;
    const at = remainder.lastIndexOf('@');
    if (at !== -1) {
        auth = remainder.slice(0, at);
        remainder = remainder.slice(at + 1);
    }

    let host;
    let db = '';
    let query = '';
    const slash = remainder.indexOf('/');
    if (slash !== -1) {
        host = remainder.slice(0, slash);
        const after = remainder.slice(slash + 1);
        const q = after.indexOf('?');
        db = q !== -1 ? after.slice(0, q) : after;
        query = q !== -1 ? after.slice(q + 1) : '';
    } else {
        host = remainder;
        const q = host.indexOf('?');
        if (q !== -1) {
            query = host.slice(q + 1);
            host = host.slice(0, q);
        }
    }

    const queryOptions = {};
    for (const pair of query.split('&')) {
        if (!pair) continue;
        const eq = pair.indexOf('=');
        if (eq !== -1) queryOptions[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
    }
    return { auth, host, db, queryOptions };
}

const DOH_PROVIDERS = [
    {
        url: (name, type) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
        headers: {}
    },
    {
        url: (name, type) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
        headers: { Accept: 'application/dns-json' }
    }
];

/**
 * Resolve DNS records over HTTPS, bypassing a broken local DNS server.
 * Tries dns.google then cloudflare-dns.com. Resolves to an array of answers
 * in the DNS-over-HTTPS JSON shape (`{ name, type, TTL, data }[]`).
 * @param {string} name
 * @param {string} type - DNS record type, e.g. 'SRV' | 'TXT'
 * @param {number} [providerIndex]
 * @returns {Promise<Array<{ type: number, data: string }>>}
 */
function dohResolve(name, type, providerIndex = 0) {
    if (providerIndex >= DOH_PROVIDERS.length) {
        return Promise.reject(new Error(`DNS-over-HTTPS lookup failed for ${name} (${type})`));
    }
    const provider = DOH_PROVIDERS[providerIndex];
    return new Promise((resolve) => {
        const req = https.get(
            provider.url(name, type),
            { headers: provider.headers, timeout: 8000 },
            (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        if (!data || data.Status !== 0 || !Array.isArray(data.Answer)) {
                            resolve(dohResolve(name, type, providerIndex + 1));
                            return;
                        }
                        resolve(data.Answer);
                    } catch {
                        resolve(dohResolve(name, type, providerIndex + 1));
                    }
                });
            }
        );
        req.on('error', () => resolve(dohResolve(name, type, providerIndex + 1)));
        req.on('timeout', () => req.destroy());
    });
}

/**
 * Convert a `mongodb+srv://` URI into an equivalent standard `mongodb://`
 * URI with an explicit seed list, resolving the SRV/TXT records over
 * DNS-over-HTTPS so it works even when the local DNS server mishandles SRV.
 * @param {string} uri
 * @param {(name: string, type: string) => Promise<Array<{type: number, data: string}>>} [resolver]
 * @returns {Promise<string>}
 */
async function srvToStandardUri(uri, resolver = dohResolve) {
    const { auth, host, db, queryOptions } = parseSrvUri(uri);
    if (!host) throw new Error('Invalid SRV connection string: missing host');
    const srvName = `_mongodb._tcp.${host}`;

    const [srvAnswers, txtAnswers] = await Promise.all([
        resolver(srvName, 'SRV'),
        resolver(srvName, 'TXT')
    ]);

    const hosts = [];
    for (const answer of srvAnswers) {
        if (answer.type !== 33) continue;
        const parts = String(answer.data).trim().split(/\s+/);
        const port = parts[2] || String(DEFAULT_PORT);
        const target = String(parts[3] || '').replace(/\.$/, '');
        if (target) hosts.push(`${target}:${port}`);
    }
    if (hosts.length === 0) {
        throw new Error(`No SRV records found for ${srvName}`);
    }
    const seedList = [...new Set(hosts)].join(',');

    const opts = {};
    for (const answer of txtAnswers) {
        if (answer.type !== 16) continue;
        const clean = String(answer.data).replace(/^"|"$/g, '');
        for (const pair of clean.split('&')) {
            const eq = pair.indexOf('=');
            if (eq > 0) opts[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
    }

    const params = [];
    if (opts.replicaSet) params.push(`replicaSet=${opts.replicaSet}`);
    if (opts.authSource) params.push(`authSource=${opts.authSource}`);
    if (queryOptions.appName) params.push(`appName=${queryOptions.appName}`);
    if (queryOptions.retryWrites) params.push(`retryWrites=${queryOptions.retryWrites}`);
    params.push('ssl=true');

    const creds = auth ? `${auth}@` : '';
    const dbPart = db ? `/${db}` : '';
    const queryPart = params.length ? `?${params.join('&')}` : '';
    return `mongodb://${creds}${seedList}${dbPart}${queryPart}`;
}

module.exports = {
    buildUri,
    testConnection,
    listDatabases,
    listCollections,
    getCount,
    find,
    preview,
    flattenDocument,
    documentsToRows,
    isSrvUri,
    isDnsError,
    parseSrvUri,
    srvToStandardUri,
    dohResolve
};

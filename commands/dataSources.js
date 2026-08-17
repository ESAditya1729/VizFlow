/**
 * commands/dataSources.js
 *
 * VizFlow: Data Sources
 *
 * Opens an interactive WebView panel for managing external data-source
 * connections (MongoDB, MySQL, PostgreSQL) and exploring their data:
 *
 *   - Manage connections (add / edit / test / delete) — secrets live in
 *     VS Code SecretStorage, never in the webview.
 *   - Browse databases / collections / tables and preview rows.
 *   - Visual query builder (columns, filters, sort, limit) with an
 *     Advanced SQL / Mongo-JSON toggle.
 *   - "Add to Workflow Builder" — generates a read-only `.vizflow` activity
 *     referencing the connection by name and opens it in the builder.
 *
 * Exported as a factory: (context) => () => void
 */

'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const { getConnectionManager } = require('../services/database/connectionManager');
const mongoService = require('../services/database/mongoService');
const sqlService = require('../services/database/sqlService');
const { buildMongoFilter } = require('../services/database/mongoFilterBuilder');
const { buildSelect } = require('../services/database/sqlQueryBuilder');

const PANEL_TYPE = 'vizflowDataSources';
const PANEL_TITLE = 'VizFlow — Data Sources';
const PREVIEW_LIMIT = 50;

/**
 * @param {vscode.ExtensionContext} context
 * @returns {() => Promise<void>}
 */
module.exports = function dataSourcesCommand(context) {
    /** @type {vscode.WebviewPanel | undefined} */
    let panel = null;
    let disposables = [];

    function disposePanel() {
        if (panel) {
            disposables.forEach((d) => d.dispose());
            disposables = [];
            panel = null;
        }
    }

    return async function () {
        if (panel) {
            panel.reveal(vscode.ViewColumn.One);
            return;
        }

        panel = vscode.window.createWebviewPanel(
            PANEL_TYPE,
            PANEL_TITLE,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media'),
                    vscode.Uri.joinPath(context.extensionUri, 'images'),
                ],
            }
        );

        const nonce = crypto.randomBytes(16).toString('base64');
        const cssUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'datasources.css')
        );
        const jsUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'datasources.js')
        );
        const iconUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')
        );

        let html = fs.readFileSync(
            path.join(context.extensionPath, 'media', 'datasources.html'), 'utf8'
        );
        const version = context.extension.packageJSON.version || '0.0.1';

        html = html
            .replace(/\{\{NONCE\}\}/g, nonce)
            .replace(/\{\{WEBVIEW_CSS_URI\}\}/g, cssUri.toString())
            .replace(/\{\{WEBVIEW_JS_URI\}\}/g, jsUri.toString())
            .replace(/\{\{ICON_URI\}\}/g, iconUri.toString())
            .replace(/\{\{VERSION\}\}/g, version);

        panel.webview.html = html;

        const messageDisposable = panel.webview.onDidReceiveMessage(
            async (message) => {
                try {
                    await handleMessage(panel, message);
                } catch (err) {
                    console.error('[VizFlow] Data Sources message error:', err);
                    if (panel) {
                        let messageText = err.message || String(err);
                        if (mongoService.isDnsError(err)) {
                            messageText = `${messageText} - This usually means your network DNS can't resolve MongoDB Atlas SRV records. Set a public DNS (e.g. 8.8.8.8) or use a standard (non-SRV) connection string.`;
                        }
                        panel.webview.postMessage({ type: 'error', message: messageText });
                    }
                }
            },
            undefined,
            context.subscriptions
        );

        const disposeListener = panel.onDidDispose(disposePanel, undefined, context.subscriptions);
        disposables = [messageDisposable, disposeListener];
    };
};

// ─── Message routing ─────────────────────────────────────────────────────────

async function handleMessage(panel, message) {
    const manager = getConnectionManager();
    const wv = panel.webview;

    switch (message.type) {
        case 'ready':
            await sendConnections(panel);
            break;

        case 'saveConnection': {
            const saved = await manager.save(message.profile || {});
            await sendConnections(panel);
            wv.postMessage({ type: 'connectionSaved', connection: saved });
            break;
        }

        case 'deleteConnection': {
            const deleted = await manager.delete(message.id);
            await sendConnections(panel);
            wv.postMessage({ type: 'connectionDeleted', deleted, id: message.id });
            break;
        }

        case 'getConnectionDetail': {
            const profile = await manager.get(message.id);
            // Never echo secrets back to the webview — redact fully.
            const safe = profile ? {
                id: profile.id,
                name: profile.name,
                type: profile.type,
                host: profile.host || '',
                port: profile.port || '',
                database: profile.database || '',
                username: profile.username || '',
                ssl: !!profile.ssl
            } : null;
            wv.postMessage({ type: 'connectionDetail', connection: safe });
            break;
        }

        case 'testConnection': {
            const requested = message.profile || {};
            const profile = message.id
                ? (await manager.get(message.id)) || requested
                : requested;
            let result = await manager.test(profile);
            if (!result.ok) {
                const fix = await trySrvFix(profile);
                if (fix) {
                    result = {
                        ...result,
                        srvFixed: true,
                        standardUri: fix.standardUri,
                        verified: fix.verified
                    };
                } else if (mongoService.isDnsError(result.error)) {
                    result = {
                        ...result,
                        error: `${result.error} — This usually means your network DNS can't resolve MongoDB Atlas SRV records. Set a public DNS (e.g. 8.8.8.8) or use a standard (non-SRV) connection string.`
                    };
                }
            }
            wv.postMessage({ type: 'testResult', id: message.id, result });
            break;
        }

        case 'applySrvFix': {
            const profile = await manager.get(message.connectionId);
            if (!profile) {
                wv.postMessage({ type: 'error', message: 'Connection not found. It may have been deleted.' });
                break;
            }
            profile.connectionString = message.standardUri;
            await manager.save(profile);
            await sendConnections(panel);
            const result = await manager.test({ ...profile, connectionString: message.standardUri });
            wv.postMessage({ type: 'srvFixApplied', result });
            break;
        }

        case 'listDatabases': {
            const profile = await resolveProfile(manager, message.connectionId);
            if (!profile) return;
            const databases = profile.type === 'mongodb'
                ? await mongoService.listDatabases(profile)
                : [];
            wv.postMessage({ type: 'databases', connectionId: message.connectionId, databases });
            break;
        }

        case 'listCollections': {
            const profile = await resolveProfile(manager, message.connectionId);
            if (!profile) return;
            const collections = await mongoService.listCollections(profile, message.database);
            wv.postMessage({
                type: 'collections',
                connectionId: message.connectionId,
                database: message.database,
                collections
            });
            break;
        }

        case 'listTables': {
            const profile = await resolveProfile(manager, message.connectionId);
            if (!profile) return;
            const tables = await sqlService.listTables(profile);
            wv.postMessage({ type: 'tables', connectionId: message.connectionId, tables });
            break;
        }

        case 'listColumns': {
            const profile = await resolveProfile(manager, message.connectionId);
            if (!profile) return;
            const columns = await sqlService.listColumns(profile, message.table);
            wv.postMessage({
                type: 'columns',
                connectionId: message.connectionId,
                table: message.table,
                columns
            });
            break;
        }

        case 'preview': {
            const profile = await resolveProfile(manager, message.connectionId);
            if (!profile) return;
            const limit = message.limit || PREVIEW_LIMIT;
            if (profile.type === 'mongodb') {
                const result = await mongoService.preview(profile, {
                    database: message.database || profile.database,
                    collection: message.collection,
                    limit
                });
                const total = message.collection
                    ? await safeCount(() => mongoService.getCount(profile, {
                        database: message.database || profile.database,
                        collection: message.collection
                    }))
                    : null;
                wv.postMessage({
                    type: 'previewResult',
                    connectionId: message.connectionId,
                    rows: result.rows,
                    columns: result.columns,
                    total
                });
            } else {
                const result = await sqlService.preview(profile, message.table, { limit });
                const total = message.table
                    ? await safeCount(() => sqlService.getCount(profile, message.table))
                    : null;
                wv.postMessage({
                    type: 'previewResult',
                    connectionId: message.connectionId,
                    rows: result.rows,
                    columns: result.columns,
                    total
                });
            }
            break;
        }

        case 'query': {
            const profile = await resolveProfile(manager, message.connectionId);
            if (!profile) return;
            const limit = message.limit || PREVIEW_LIMIT;

            if (profile.type === 'mongodb') {
                let filter;
                if (message.advancedFilter && String(message.advancedFilter).trim()) {
                    try {
                        filter = JSON.parse(String(message.advancedFilter).trim());
                    } catch (err) {
                        wv.postMessage({ type: 'queryResult', connectionId: message.connectionId, error: `Invalid filter JSON: ${err.message}` });
                        return;
                    }
                } else {
                    const built = buildMongoFilter(message.filterModel || { conditions: [] });
                    if (built.errors.length > 0) {
                        wv.postMessage({ type: 'queryResult', connectionId: message.connectionId, error: built.errors.join('; ') });
                        return;
                    }
                    filter = built.filter;
                }
                const projection = message.columns && message.columns.length > 0
                    ? Object.fromEntries(message.columns.map((c) => [c, 1]))
                    : null;
                const sort = parseSort(message.orderBy);
                const result = await mongoService.find(profile, {
                    database: message.database || profile.database,
                    collection: message.collection,
                    filter,
                    projection,
                    sort,
                    limit
                });
                wv.postMessage({
                    type: 'queryResult',
                    connectionId: message.connectionId,
                    rows: result.rows,
                    columns: result.columns,
                    limit
                });
            } else {
                const dialect = profile.type === 'postgresql' ? 'postgresql' : 'mysql';
                let sql;
                let params = [];
                if (message.advancedSql && String(message.advancedSql).trim()) {
                    sql = `SELECT * FROM ${quoteId(message.table, dialect)} WHERE ${String(message.advancedSql).trim()}`;
                } else {
                    const built = buildSelect({
                        table: message.table,
                        dialect,
                        columns: message.columns || [],
                        filterModel: message.filterModel || { conditions: [] },
                        orderBy: message.orderBy,
                        limit
                    });
                    if (built.errors.length > 0) {
                        wv.postMessage({ type: 'queryResult', connectionId: message.connectionId, error: built.errors.join('; ') });
                        return;
                    }
                    sql = built.sql;
                    params = built.params;
                }
                const result = await sqlService.runSelect(profile, sql, params, { limit });
                wv.postMessage({
                    type: 'queryResult',
                    connectionId: message.connectionId,
                    rows: result.rows,
                    columns: result.columns,
                    limit
                });
            }
            break;
        }

        case 'addToWorkflow': {
            await handleAddToWorkflow(panel, message);
            break;
        }

        default:
            console.warn('[VizFlow] Unknown Data Sources message:', message.type);
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function resolveProfile(manager, connectionId) {
    const profile = await manager.get(connectionId);
    if (!profile) {
        throw new Error('Connection not found. It may have been deleted.');
    }
    return profile;
}

async function safeCount(fn) {
    try {
        return await fn();
    } catch {
        return null;
    }
}

/**
 * When a Mongo SRV connection fails, try to convert the `mongodb+srv://` URI
 * into a standard `mongodb://` seed list via DNS-over-HTTPS (bypassing a
 * broken local DNS server) and verify it actually connects.
 * @param {Object} profile
 * @returns {Promise<{ standardUri: string, verified: boolean } | null>}
 */
async function trySrvFix(profile) {
    if (!profile || profile.type !== 'mongodb') return null;
    const uri = profile.connectionString || '';
    if (!mongoService.isSrvUri(uri)) return null;
    try {
        const standardUri = await mongoService.srvToStandardUri(uri);
        const test = await getConnectionManager().test({ ...profile, connectionString: standardUri });
        return { standardUri, verified: !!test.ok };
    } catch {
        return null;
    }
}

function quoteId(name, dialect) {
    const { quoteIdentifier } = require('../services/database/sqlQueryBuilder');
    return quoteIdentifier(name, dialect);
}

/**
 * Parse "field:asc, other:desc" into a Mongo sort document.
 */
function parseSort(orderBy) {
    if (!orderBy || !String(orderBy).trim()) return null;
    const sort = {};
    for (const part of String(orderBy).split(',')) {
        const m = part.trim().match(/^([^\s:]+)(?:\s*[:]\s*(asc|desc))?$/i);
        if (!m) continue;
        const dir = m[2] && m[2].toLowerCase() === 'desc' ? -1 : 1;
        sort[m[1]] = dir;
    }
    return Object.keys(sort).length ? sort : null;
}

async function sendConnections(panel) {
    const manager = getConnectionManager();
    panel.webview.postMessage({
        type: 'init',
        connections: manager.list()
    });
}

// ─── Add to Workflow Builder ─────────────────────────────────────────────────

async function handleAddToWorkflow(panel, message) {
    const manager = getConnectionManager();
    const profile = await resolveProfile(manager, message.connectionId);
    const payload = message.payload || {};

    let activity;
    if (profile.type === 'mongodb') {
        let filter;
        if (payload.advancedFilter && String(payload.advancedFilter).trim()) {
            try {
                filter = JSON.parse(String(payload.advancedFilter).trim());
            } catch (err) {
                throw new Error(`Invalid filter JSON: ${err.message}`);
            }
        } else {
            const built = buildMongoFilter(payload.filterModel || { conditions: [] });
            if (built.errors.length > 0) {
                throw new Error(`Filter error: ${built.errors.join('; ')}`);
            }
            filter = built.filter;
        }
        activity = {
            id: 'step_read',
            type: 'readMongo',
            config: {
                connection: profile.name,
                database: payload.database || profile.database || '',
                collection: payload.collection || '',
                filter: JSON.stringify(filter),
                limit: payload.limit ? String(payload.limit) : '0'
            }
        };
    } else {
        activity = {
            id: 'step_read',
            type: 'readSql',
            config: {
                connection: profile.name,
                table: payload.table || '',
                columns: Array.isArray(payload.columns) && payload.columns.length > 0
                    ? payload.columns.join(', ')
                    : '',
                filterModel: payload.filterModel || undefined,
                orderBy: payload.orderBy || '',
                limit: payload.limit ? String(payload.limit) : '1000'
            }
        };
        // Advanced SQL mode: embed a literal WHERE clause instead.
        if (payload.advancedSql && String(payload.advancedSql).trim()) {
            delete activity.config.filterModel;
            activity.config.where = String(payload.advancedSql).trim();
        }
    }

    const workflow = {
        name: `Read ${profile.name} — ${payload.collection || payload.table || ''}`.trim(),
        version: '1.0.0',
        description: `Read-only data loaded from the "${profile.name}" connection in the VizFlow Data Sources panel.`,
        activities: [activity]
    };

    const safeName = (workflow.name || 'workflow')
        .replace(/[^a-zA-Z0-9_\- ]/g, '')
        .trim()
        .replace(/\s+/g, '_') || 'workflow';

    const dir = path.join(os.tmpdir(), 'vizflow-datasources');
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${safeName}.vizflow`);
    await fs.promises.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8');

    panel.webview.postMessage({ type: 'workflowCreated', filePath });

    // Open the builder with the generated workflow.
    await vscode.commands.executeCommand('vizflow.openWorkflow', filePath);
    vscode.window.showInformationMessage(`VizFlow: Opened "${profile.name}" data in the Workflow Builder.`);
}

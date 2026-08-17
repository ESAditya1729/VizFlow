/**
 * media/datasources.js
 *
 * VizFlow — Data Sources WebView client.
 * Talks to the host (commands/dataSources.js) via postMessage.
 */

'use strict';

(function () {
    const vscode = acquireVsCodeApi();
    const state = {
        connections: [],
        connectionId: null,          // active connection
        selected: {
            database: '', collection: '', table: ''
        },
        columns: [],                 // columns/fields of the active source
        previewRows: [],
        previewColumns: [],
        lastMode: 'visual',
        srvFix: null                 // { standardUri, connectionId, verified }
    };

    // ─── DOM helpers ──────────────────────────────────────
    const $ = (id) => document.getElementById(id);

    // ─── Boot ─────────────────────────────────────────────
    window.addEventListener('DOMContentLoaded', () => {
        bindEvents();
        send({ type: 'ready' });
    });

    // ─── Messaging ────────────────────────────────────────
    function send(msg) {
        vscode.postMessage(msg);
    }

    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || !msg.type) return;
        switch (msg.type) {
            case 'init':
                state.connections = msg.connections || [];
                hideLoading();
                if (state.connectionId && !state.connections.some((c) => c.id === state.connectionId)) {
                    state.connectionId = null;
                }
                renderConnections();
                onConnectionsLoaded();
                break;
            case 'connectionsChanged':
                state.connections = msg.connections || [];
                if (state.connectionId && !state.connections.some((c) => c.id === state.connectionId)) {
                    state.connectionId = null;
                }
                renderConnections();
                renderConnectionToolbar();
                onConnectionsLoaded();
                break;
            case 'connectionSaved': {
                toast('Connection saved.', 'ok');
                closeModal();
                if (msg.connection && msg.connection.id) {
                    state.connectionId = msg.connection.id;
                    if (!state.connections.some((c) => c.id === msg.connection.id)) {
                        state.connections.push(msg.connection);
                    }
                }
                renderConnections();
                onConnectionsLoaded();
                break;
            }
            case 'connectionDeleted':
                if (msg.deleted) {
                    toast('Connection deleted.', 'ok');
                    if (state.connectionId === msg.id) {
                        state.connectionId = null;
                        resetSelection();
                    }
                    onConnectionsLoaded();
                } else {
                    toast('Could not delete connection.', 'err');
                }
                break;
            case 'connectionDetail':
                openEditModal(msg.connection);
                break;
            case 'testResult':
                renderTestResult(msg.result, msg.id);
                break;
            case 'srvFixApplied':
                renderSrvFixApplied(msg.result);
                break;
            case 'databases':
                state.databases = msg.databases || [];
                renderDatabases(msg.connectionId);
                break;
            case 'collections':
                state.collections = msg.collections || [];
                renderCollections(msg.connectionId, msg.database);
                break;
            case 'tables':
                state.tables = msg.tables || [];
                renderTables(msg.connectionId);
                break;
            case 'columns':
                state.columns = msg.columns || [];
                renderColumnOptions(msg.connectionId);
                break;
            case 'previewResult':
                renderPreviewResult(msg);
                break;
            case 'queryResult':
                renderQueryResult(msg);
                break;
            case 'workflowCreated':
                toast('Added to Workflow Builder.', 'ok');
                break;
            case 'error':
                toast(msg.message, 'err');
                break;
        }
    });

    // ─── Connection list / toolbar ────────────────────────
    function onConnectionsLoaded() {
        if (state.connections.length === 0) {
            $('empty-state').style.display = '';
            $('main-layout').style.display = 'none';
            return;
        }
        $('empty-state').style.display = 'none';
        $('main-layout').style.display = '';
        if (!state.connectionId) {
            state.connectionId = state.connections[0].id;
        }
        refreshSourcePicker();
    }

    function renderConnections() {
        const list = $('connection-list');
        list.innerHTML = '';
        for (const conn of state.connections) {
            const item = document.createElement('div');
            item.className = 'conn-item' + (conn.id === state.connectionId ? ' active' : '');
            const typeLabel = { mongodb: 'MongoDB', mysql: 'MySQL', postgresql: 'PostgreSQL' }[conn.type] || conn.type;
            item.innerHTML =
                '<div class="conn-item-name">' + escapeHtml(conn.name) + '</div>' +
                '<div class="conn-item-type">' + typeLabel + '</div>';
            item.title = conn.name + ' (' + typeLabel + ')';
            item.addEventListener('click', () => {
                state.connectionId = conn.id;
                renderConnections();
                renderConnectionToolbar();
                refreshSourcePicker();
            });
            list.appendChild(item);
        }
        renderConnectionToolbar();
    }

    function renderConnectionToolbar() {
        const sel = $('connection-select');
        const hasConn = state.connections.length > 0;
        sel.innerHTML = '';
        if (!hasConn) {
            $('btn-test-connection').disabled = true;
            $('btn-edit-connection').disabled = true;
            $('btn-delete-connection').disabled = true;
            return;
        }
        for (const conn of state.connections) {
            const opt = document.createElement('option');
            opt.value = conn.id;
            opt.textContent = conn.name + ' (' + conn.type + ')';
            if (conn.id === state.connectionId) opt.selected = true;
            sel.appendChild(opt);
        }
        $('btn-test-connection').disabled = false;
        $('btn-edit-connection').disabled = false;
        $('btn-delete-connection').disabled = false;
    }

    // ─── Source picker ────────────────────────────────────
    function refreshSourcePicker() {
        const conn = currentConnection();
        const holder = $('source-picker');
        if (!conn) {
            holder.innerHTML = '<div class="source-picker-empty">Select a connection to begin.</div>';
            return;
        }
        const prevDb = state.selected.database || (conn.type === 'mongodb' ? conn.database || '' : '');
        const prevColl = state.selected.collection;
        const prevTable = state.selected.table;
        resetSelection();
        state.selected.database = prevDb;
        state.selected.collection = prevColl;
        state.selected.table = prevTable;

        holder.innerHTML = '';
        if (conn.type === 'mongodb') {
            holder.appendChild(sourceSelect('database', state.selected.database, placeholder('Database')));
            holder.appendChild(sourceSelect('collection', state.selected.collection, placeholder('Collection')));
        } else {
            holder.appendChild(sourceSelect('table', state.selected.table, placeholder('Table')));
        }
        if (conn.type === 'mongodb') {
            send({ type: 'listDatabases', connectionId: conn.id });
        } else {
            send({ type: 'listTables', connectionId: conn.id });
        }
    }

    function placeholder(text) {
        const el = document.createElement('option');
        el.value = '';
        el.textContent = '— ' + text + ' —';
        return el;
    }

    function sourceSelect(key, value, placeholderEl) {
        const label = document.createElement('label');
        label.textContent = key === 'database' ? 'Database' : key === 'collection' ? 'Collection' : 'Table';
        const sel = document.createElement('select');
        sel.id = 'source-' + key;
        sel.dataset.key = key;
        sel.appendChild(placeholderEl);
        sel.value = value || '';
        sel.addEventListener('change', () => {
            state.selected[key] = sel.value;
            if (key === 'database') {
                state.selected.collection = '';
                if (sel.value) {
                    send({ type: 'listCollections', connectionId: state.connectionId, database: sel.value });
                } else {
                    state.collections = [];
                    renderCollections(state.connectionId, '');
                }
            } else {
                loadColumnsForSource();
            }
        });
        label.appendChild(sel);
        return label;
    }

    function renderDatabases(connectionId) {
        if (connectionId !== state.connectionId) return;
        const sel = $('source-database');
        if (!sel) return;
        sel.innerHTML = '';
        sel.appendChild(placeholder('Database'));
        for (const db of state.databases) {
            const opt = document.createElement('option');
            opt.value = db;
            opt.textContent = db;
            sel.appendChild(opt);
        }
        if (state.selected.database) {
            sel.value = state.selected.database;
        }
        if (sel.value) {
            send({ type: 'listCollections', connectionId, database: sel.value });
        }
    }

    function renderCollections(connectionId, database) {
        if (connectionId !== state.connectionId) return;
        if (database !== state.selected.database) return;
        const sel = $('source-collection');
        if (!sel) return;
        sel.innerHTML = '';
        sel.appendChild(placeholder('Collection'));
        for (const coll of state.collections) {
            const opt = document.createElement('option');
            opt.value = coll;
            opt.textContent = coll;
            sel.appendChild(opt);
        }
        if (state.selected.collection) sel.value = state.selected.collection;
        loadColumnsForSource();
    }

    function renderTables(connectionId) {
        if (connectionId !== state.connectionId) return;
        const sel = $('source-table');
        if (!sel) return;
        sel.innerHTML = '';
        sel.appendChild(placeholder('Table'));
        for (const t of state.tables) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            sel.appendChild(opt);
        }
        if (state.selected.table) sel.value = state.selected.table;
        loadColumnsForSource();
    }

    function loadColumnsForSource() {
        const conn = currentConnection();
        if (!conn) return;
        if (conn.type === 'mongodb') {
            if (state.selected.collection) {
                send({
                    type: 'preview',
                    connectionId: state.connectionId,
                    database: state.selected.database || conn.database || '',
                    collection: state.selected.collection,
                    limit: 50
                });
            } else {
                state.columns = [];
                renderColumnOptions(state.connectionId);
            }
        } else if (state.selected.table) {
            send({ type: 'listColumns', connectionId: state.connectionId, table: state.selected.table });
            send({
                type: 'preview',
                connectionId: state.connectionId,
                table: state.selected.table,
                limit: 50
            });
        } else {
            state.columns = [];
            renderColumnOptions(state.connectionId);
        }
    }

    function renderColumnOptions(connectionId) {
        if (connectionId !== state.connectionId) return;
        const box = $('column-checkboxes');
        box.innerHTML = '';
        if (state.columns.length === 0) {
            box.innerHTML = '<div style="color:var(--vscode-descriptionForeground);font-size:12px;">No columns to show yet — pick a collection or table.</div>';
            return;
        }
        const anyAll = document.createElement('label');
        anyAll.innerHTML = '<input type="checkbox" checked data-col="*"> <b>All fields</b>';
        anyAll.querySelector('input').addEventListener('change', (e) => {
            box.querySelectorAll('input[data-col]').forEach((c) => { c.checked = e.target.checked; });
        });
        box.appendChild(anyAll);
        for (const col of state.columns) {
            const label = document.createElement('label');
            label.innerHTML = '<input type="checkbox" data-col="' + escapeAttr(col) + '"> ' + escapeHtml(col);
            label.querySelector('input').addEventListener('change', () => updateFiltersFromColumns());
            box.appendChild(label);
        }
        buildFilterRowOptions();
    }

    // ─── Visual filter builder ────────────────────────────
    function buildFilterRowOptions() {
        document.querySelectorAll('.filter-row').forEach((row) => {
            const colSel = row.querySelector('.filter-col');
            const opSel = row.querySelector('.filter-op');
            updateColOptions(colSel);
            updateOpOptions(opSel);
            colSel.addEventListener('change', () => {
                updateOpOptions(opSel);
                renderColumnsGrid();
            });
        });
    }

    function updateColOptions(sel) {
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '— column —';
        sel.appendChild(placeholder);
        for (const col of state.columns) {
            const opt = document.createElement('option');
            opt.value = col;
            opt.textContent = col;
            sel.appendChild(opt);
        }
        sel.value = state.columns.includes(current) ? current : '';
    }

    function updateOpOptions(sel) {
        if (!sel) return;
        const ops = getOperatorsFor();
        const current = sel.value;
        sel.innerHTML = '';
        for (const op of ops) {
            const opt = document.createElement('option');
            opt.value = op;
            opt.textContent = op;
            sel.appendChild(opt);
        }
        if (ops.includes(current)) sel.value = current;
    }

    function getOperatorsFor() {
        return ['equals', 'not equals', 'contains', 'starts with', 'ends with', '>', '>=', '<', '<=', 'is empty', 'is not empty'];
    }

    // Display label → canonical operator value expected by the shared filter
    // model (queryBuilderCommon.js FILTER_OPERATORS).
    const OPERATOR_MAP = {
        'equals': 'equals',
        'not equals': 'notEquals',
        'contains': 'contains',
        'starts with': 'startsWith',
        'ends with': 'endsWith',
        '>': 'greaterThan',
        '>=': 'greaterThanOrEqual',
        '<': 'lessThan',
        '<=': 'lessThanOrEqual',
        'is empty': 'isEmpty',
        'is not empty': 'isNotEmpty'
    };

    function addFilterRow(column, operator, value) {
        const box = $('filter-rows');
        const row = document.createElement('div');
        row.className = 'filter-row';
        const colSel = document.createElement('select');
        colSel.className = 'filter-col';
        const opSel = document.createElement('select');
        opSel.className = 'filter-op';
        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.className = 'filter-val';
        valInput.placeholder = 'value';
        const connector = document.createElement('span');
        connector.className = 'filter-connector';
        connector.textContent = 'and';
        const remove = document.createElement('button');
        remove.textContent = '✕';
        remove.title = 'Remove filter';
        remove.addEventListener('click', () => { row.remove(); renderColumnsGrid(); });

        updateColOptions(colSel);
        updateOpOptions(opSel);
        if (column) colSel.value = state.columns.includes(column) ? column : '';
        if (operator) opSel.value = operator;
        if (value) valInput.value = value;

        colSel.addEventListener('change', () => {
            updateOpOptions(opSel);
            renderColumnsGrid();
        });
        opSel.addEventListener('change', renderColumnsGrid);

        row.appendChild(connector);
        row.appendChild(colSel);
        row.appendChild(opSel);
        row.appendChild(valInput);
        row.appendChild(remove);
        box.appendChild(row);
    }

    function getFilterModel() {
        const conditions = [];
        document.querySelectorAll('.filter-row').forEach((row) => {
            const col = row.querySelector('.filter-col').value;
            const opLabel = row.querySelector('.filter-op').value;
            const val = row.querySelector('.filter-val').value;
            const op = OPERATOR_MAP[opLabel] || '';
            if (!col || !op) return;
            const isTextOp = ['contains', 'startsWith', 'endsWith'].includes(op);
            let value = val;
            if (op === 'isEmpty' || op === 'isNotEmpty') value = null;
            else if (!isTextOp && val !== '' && !isNaN(Number(val))) value = Number(val);
            conditions.push({ column: col, operator: op, value, conjunction: 'AND' });
        });
        return { logic: 'and', conditions };
    }

    function updateFiltersFromColumns() { renderColumnsGrid(); }

    // ─── Columns checkbox → filter options ────────────────
    function renderColumnsGrid() {
        // no-op hook kept for parity with column-checkbox refresh
    }

    function getSelectedColumns() {
        const cols = [];
        document.querySelectorAll('#column-checkboxes input[data-col]').forEach((c) => {
            if (c.checked) cols.push(c.dataset.col);
        });
        return cols.filter((c) => c !== '*');
    }

    // ─── Query execution ──────────────────────────────────
    function buildQueryMessage() {
        const conn = currentConnection();
        const mode = getActiveTab();
        const limit = parseInt($('input-limit').value, 10) || 100;
        const orderBy = $('input-orderby').value.trim();
        const base = {
            connectionId: state.connectionId,
            limit: Math.max(1, Math.min(limit, 100000))
        };
        if (conn.type === 'mongodb') {
            base.database = state.selected.database || conn.database || '';
            base.collection = state.selected.collection;
            if (mode === 'advanced') {
                base.advancedFilter = $('advanced-text').value.trim();
            } else {
                base.filterModel = getFilterModel();
            }
            base.columns = getSelectedColumns();
            base.orderBy = orderBy;
        } else {
            base.table = state.selected.table;
            if (mode === 'advanced') {
                base.advancedSql = $('advanced-text').value.trim();
            } else {
                base.filterModel = getFilterModel();
            }
            base.columns = getSelectedColumns();
            base.orderBy = orderBy;
        }
        return base;
    }

    function runQuery() {
        const msg = buildQueryMessage();
        if (currentConnection().type === 'mongodb') {
            if (!msg.collection) { toast('Pick a collection first.', 'err'); return; }
        } else if (!msg.table) { toast('Pick a table first.', 'err'); return; }
        send({ type: 'query', ...msg });
    }

    // ─── Results rendering ────────────────────────────────
    function renderPreviewResult(msg) {
        if (msg.error) { toast(msg.error, 'err'); return; }
        state.previewRows = msg.rows || [];
        state.previewColumns = msg.columns || [];
        // Only Mongo previews double as the source of column discovery — SQL
        // column lists come from listColumns (the full schema, even for empty
        // tables), which must stay authoritative.
        const conn = currentConnection();
        if (conn && conn.type === 'mongodb' && msg.columns && msg.columns.length) {
            state.columns = msg.columns;
            renderColumnOptions(state.connectionId);
        }
        renderResultsTable(state.previewRows, state.previewColumns, msg.total);
    }

    function renderQueryResult(msg) {
        if (msg.error) { toast(msg.error, 'err'); return; }
        state.previewRows = msg.rows || [];
        state.previewColumns = msg.columns || [];
        renderResultsTable(state.previewRows, state.previewColumns, null);
    }

    function renderResultsTable(rows, columns, total) {
        const wrap = $('results-wrapper');
        $('row-count-badge').textContent = formatCount(rows.length) + ' rows';
        if (!columns.length) {
            wrap.innerHTML = '<div id="results-empty">No results.</div>';
            return;
        }
        let html = '<table class="data-table"><thead><tr>';
        for (const col of columns) html += '<th>' + escapeHtml(col) + '</th>';
        html += '</tr></thead><tbody>';
        for (const row of rows.slice(0, 500)) {
            html += '<tr>';
            for (const col of columns) {
                const val = row[col];
                html += '<td title="' + escapeAttr(formatCell(val)) + '">' + renderCell(val) + '</td>';
            }
            html += '</tr>';
        }
        html += '</tbody></table>';
        wrap.innerHTML = html;
        if (total !== null && total !== undefined) {
            $('row-count-badge').textContent = formatCount(total) + ' total rows';
        }
    }

    function renderCell(val) {
        if (val === null || val === undefined) return '<span class="cell-null">null</span>';
        if (typeof val === 'object') return '<span class="cell-null">' + escapeHtml(JSON.stringify(val)) + '</span>';
        return escapeHtml(String(val));
    }

    function formatCell(val) {
        if (val === null || val === undefined) return 'null';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
    }

    function formatCount(n) {
        return n >= 1000 ? n.toLocaleString() : String(n);
    }

    // ─── Tabs ─────────────────────────────────────────────
    function getActiveTab() {
        return document.querySelector('.tab.active').dataset.tab || 'visual';
    }

    // ─── Modal ────────────────────────────────────────────
    function openModal(title) {
        $('modal-title').textContent = title;
        $('modal-overlay').style.display = 'flex';
        $('form-status').textContent = '';
        $('form-status').className = 'form-status';
        hideSrvFix();
    }

    function closeModal() {
        $('modal-overlay').style.display = 'none';
    }

    function openAddModal() {
        $('conn-id').value = '';
        $('conn-name').value = '';
        $('conn-host').value = '';
        $('conn-port').value = '';
        $('conn-database').value = '';
        $('conn-username').value = '';
        $('conn-password').value = '';
        $('conn-ssl').checked = false;
        $('conn-string').value = '';
        $('conn-type').disabled = false;
        $('conn-type').value = 'mongodb';
        openModal('Add Connection');
    }

    function openEditModal(conn) {
        if (!conn) return;
        $('conn-id').value = conn.id;
        $('conn-name').value = conn.name || '';
        $('conn-type').value = conn.type || 'mongodb';
        $('conn-type').disabled = true;
        $('conn-host').value = conn.host || '';
        $('conn-port').value = conn.port || '';
        $('conn-database').value = conn.database || '';
        $('conn-username').value = conn.username || '';
        $('conn-password').value = '';
        $('conn-ssl').checked = !!conn.ssl;
        $('conn-string').value = '';
        $('form-status').textContent = 'Password is kept in your OS keychain — leave blank to keep it.';
        $('form-status').className = 'form-status info';
        openModal('Edit Connection');
    }

    function collectProfile() {
        const type = $('conn-type').value;
        return {
            id: $('conn-id').value || undefined,
            name: $('conn-name').value.trim(),
            type,
            host: $('conn-host').value.trim(),
            port: $('conn-port').value.trim() || undefined,
            database: $('conn-database').value.trim() || undefined,
            username: $('conn-username').value.trim() || undefined,
            password: $('conn-password').value || undefined,
            ssl: $('conn-ssl').checked,
            connectionString: $('conn-string').value.trim() || undefined
        };
    }

    // ─── Misc ─────────────────────────────────────────────
    function currentConnection() {
        return state.connections.find((c) => c.id === state.connectionId) || null;
    }

    function resetSelection() {
        state.selected.database = '';
        state.selected.collection = '';
        state.selected.table = '';
        state.columns = [];
    }

    function hideLoading() {
        $('loading-overlay').style.display = 'none';
    }

    function toast(message, kind) {
        const container = $('toast-container');
        const el = document.createElement('div');
        el.className = 'toast ' + (kind || 'info');
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => { el.remove(); }, 4000);
    }

    // ─── Confirm dialog (webviews block window.confirm) ──
    // Bound ONCE via event delegation so the buttons stay responsive no
    // matter what re-renders or intercepts events.
    function bindConfirmDialog() {
        const overlay = $('confirm-overlay');
        const okBtn = $('btn-confirm-ok');
        const cancelBtn = $('btn-confirm-cancel');

        const hide = () => {
            overlay.style.display = 'none';
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('#btn-confirm-cancel')) {
                hide();
                return;
            }
            if (e.target.closest('#btn-confirm-ok')) {
                const cb = overlay._onOk || null;
                overlay._onOk = null;
                hide();
                if (cb) cb();
            }
        });

        overlay.addEventListener('mousedown', (e) => e.preventDefault());

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.style.display === 'flex') hide();
        });

        // Keep references so any direct calls still work.
        bindConfirmDialog._okBtn = okBtn;
        bindConfirmDialog._cancelBtn = cancelBtn;
    }

    function confirmDialog(message, okLabel, onOk) {
        const overlay = $('confirm-overlay');
        $('confirm-text').textContent = message;
        const okBtn = bindConfirmDialog._okBtn || $('btn-confirm-ok');
        okBtn.textContent = okLabel || 'Delete';
        overlay._onOk = onOk || null;
        overlay.style.display = 'flex';
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function escapeAttr(s) {
        return escapeHtml(s).replace(/`/g, '&#96;');
    }

    // ─── Event wiring ─────────────────────────────────────
    function bindEvents() {
        bindConfirmDialog();

        $('btn-empty-add').addEventListener('click', openAddModal);
        $('btn-add-connection').addEventListener('click', openAddModal);
        $('btn-close-modal').addEventListener('click', closeModal);

        $('btn-edit-connection').addEventListener('click', () => {
            if (state.connectionId) send({ type: 'getConnectionDetail', id: state.connectionId });
        });

        $('btn-delete-connection').addEventListener('click', () => {
            if (!state.connectionId) return;
            const conn = currentConnection();
            if (!conn) return;
            confirmDialog('Delete connection "' + conn.name + '" and its stored credentials?', 'Delete', () => {
                send({ type: 'deleteConnection', id: state.connectionId });
            });
        });

        $('btn-test-connection').addEventListener('click', () => {
            if (!state.connectionId) return;
            $('connection-status').textContent = 'testing…';
            $('connection-status').className = 'status-badge warn';
            send({ type: 'testConnection', id: state.connectionId });
        });

        $('connection-select').addEventListener('change', (e) => {
            state.connectionId = e.target.value;
            renderConnections();
            refreshSourcePicker();
        });

        document.querySelectorAll('.tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
                tab.classList.add('active');
                const isVisual = tab.dataset.tab === 'visual';
                $('tab-visual').style.display = isVisual ? '' : 'none';
                $('tab-advanced').style.display = isVisual ? 'none' : '';
            });
        });

        $('btn-add-filter').addEventListener('click', () => addFilterRow());

        $('btn-run-query').addEventListener('click', runQuery);

        $('btn-add-to-workflow').addEventListener('click', () => {
            const msg = buildQueryMessage();
            const conn = currentConnection();
            if (!conn) return;
            if (conn.type === 'mongodb') {
                if (!msg.collection) { toast('Pick a collection first.', 'err'); return; }
            } else if (!msg.table) { toast('Pick a table first.', 'err'); return; }
            const payload = {
                connectionId: state.connectionId,
                filterModel: msg.filterModel,
                advancedFilter: msg.advancedFilter,
                advancedSql: msg.advancedSql,
                columns: msg.columns,
                orderBy: msg.orderBy,
                limit: msg.limit,
                database: msg.database,
                collection: msg.collection,
                table: msg.table
            };
            send({ type: 'addToWorkflow', connectionId: state.connectionId, payload });
        });

        $('connection-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const profile = collectProfile();
            if (!profile.name) { setFormStatus('Name is required.', 'err'); return; }
            if (!profile.host && !profile.connectionString) { setFormStatus('Host or connection string is required.', 'err'); return; }
            send({ type: 'saveConnection', profile });
        });

        $('btn-test-form').addEventListener('click', () => {
            const profile = collectProfile();
            if (!profile.host && !profile.connectionString) { setFormStatus('Host or connection string is required.', 'err'); return; }
            setFormStatus('Testing…', 'info');
            send({ type: 'testConnection', profile });
        });

        $('btn-apply-srv-fix').addEventListener('click', () => {
            const fix = state.srvFix;
            if (!fix || !fix.connectionId) return;
            const btn = $('btn-apply-srv-fix');
            btn.disabled = true;
            send({ type: 'applySrvFix', connectionId: fix.connectionId, standardUri: fix.standardUri });
            setTimeout(() => { btn.disabled = false; }, 2000);
        });
    }

    function setFormStatus(text, kind) {
        const el = $('form-status');
        el.textContent = text;
        el.className = 'form-status ' + (kind || '');
    }

    function renderTestResult(result, connectionId) {
        const status = $('connection-status');
        if (result && result.ok) {
            status.textContent = '✓ Connected';
            status.className = 'status-badge ok';
        } else {
            status.textContent = '✗ Failed';
            status.className = 'status-badge err';
        }
        if (result && result.ok) {
            setFormStatus('✓ Connection successful' + (result.message ? ' — ' + result.message : ''), 'ok');
        } else {
            setFormStatus('✗ ' + ((result && result.error) || 'Connection failed.'), 'err');
        }
        if (result && result.parsed) {
            const p = result.parsed;
            if (p.host) $('conn-host').value = p.host;
            if (p.port) $('conn-port').value = p.port;
            if (p.database) $('conn-database').value = p.database;
            if (p.username) $('conn-username').value = p.username;
            if (p.type && !$('conn-id').value) $('conn-type').value = p.type;
        }
        if (result && result.srvFixed && result.standardUri) {
            showSrvFix(result.standardUri, connectionId, result.verified);
        } else {
            hideSrvFix();
        }
    }

    // ─── SRV DNS fix banner ─────────────────────────────
    function showSrvFix(standardUri, connectionId, verified) {
        state.srvFix = { standardUri, connectionId, verified };
        const banner = $('srv-fix-banner');
        const text = $('srv-fix-text');
        const btn = $('btn-apply-srv-fix');

        if (connectionId) {
            text.textContent = "Your network DNS can't resolve MongoDB SRV records. A standard connection string was generated" +
                (verified ? ' and verified.' : ', but could not be verified.') + ' Apply it to fix this connection.';
            btn.style.display = '';
        } else {
            text.textContent = "Your network DNS can't resolve MongoDB SRV records. A standard connection string was generated" +
                (verified ? ' and verified' : '') + ' and filled into the connection string field — just Save.';
            btn.style.display = 'none';
            const strInput = $('conn-string');
            if (strInput) strInput.value = standardUri;
        }
        banner.style.display = '';
    }

    function hideSrvFix() {
        state.srvFix = null;
        const banner = $('srv-fix-banner');
        if (banner) banner.style.display = 'none';
    }

    function renderSrvFixApplied(result) {
        hideSrvFix();
        if (result && result.ok) {
            toast('Standard connection string applied and verified.', 'ok');
        } else {
            toast('Applied, but the connection still fails: ' + ((result && result.error) || 'unknown error'), 'err');
        }
        renderTestResult(result, null);
    }
})();

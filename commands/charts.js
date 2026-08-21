/**
 * VizFlow: Interactive Chart Explorer
 *
 * Features:
 *   - Line Chart: Time series or categorical trends
 *   - Pie Chart: Distribution with percentage breakdown
 *   - Auto Insights: Trend detection, concentration analysis
 *   - Customization: Color themes, labels, legends
 *   - Export: PNG for PPT presentations
 */

'use strict';

const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const csvReader = require('../services/csvReader');
const csvParser = require('../services/csvParser');

module.exports = function chartsCommand(/** @type {vscode.ExtensionContext} */ context) {

    /** @type {vscode.WebviewPanel | undefined} */
    let panel;

    return async function () {

        const csvText = await csvReader.load();
        if (!csvText) return;

        let dataset;
        try {
            dataset = csvParser.parse(csvText);
        } catch (err) {
            vscode.window.showErrorMessage('VizFlow: Failed to parse CSV — ' + (err instanceof Error ? err.message : String(err)));
            return;
        }

        if (dataset.rows.length === 0) {
            vscode.window.showErrorMessage('VizFlow: CSV is empty.');
            return;
        }

        const columns = dataset.getColumns();
        const rowCount = dataset.rows.length;

        if (panel) {
            panel.reveal(vscode.ViewColumn.One);
            sendInit(panel.webview, dataset, columns, rowCount);
            return;
        }

        panel = vscode.window.createWebviewPanel(
            'vizflowCharts',
            'VizFlow: Chart Explorer',
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
        const htmlUri = path.join(context.extensionPath, 'media', 'charts.html');
        let html = fs.readFileSync(htmlUri, 'utf8');

        const cssUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'charts.css')
        ).toString();

        const themeUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'theme.css')
        ).toString();

        const iconUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')
        ).toString();

        const { version } = context.extension.packageJSON;

        html = html
            .split('{{NONCE}}').join(nonce)
            .replace('{{THEME_CSS_URI}}', themeUri)
            .replace('{{WEBVIEW_CSS_URI}}', cssUri)
            .replace('{{ICON_URI}}', iconUri)
            .split('{{VERSION}}').join(version);

        panel.webview.html = html;

        panel.webview.onDidReceiveMessage(
            msg => {
                if (!panel) return;
                if (msg.type === 'ready') {
                    sendInit(panel.webview, dataset, columns, rowCount);
                } else {
                    handleMessage(msg, dataset, panel);
                }
            },
            undefined,
            context.subscriptions
        );

        panel.onDidDispose(() => { panel = undefined; }, undefined, context.subscriptions);
    };
};

// ─── Message Handlers ────────────────────────────────────────────────

/**
 * @param {any} msg
 * @param {import('../engine/dataset')} dataset
 * @param {vscode.WebviewPanel} panel
 */
async function handleMessage(msg, dataset, panel) {
    switch (msg.type) {
        case 'getChartData': {
            const chartData = buildChartData(dataset, msg.chartType, msg.xCol, msg.yCol);
            const insights = generateInsights(dataset, msg.chartType, msg.xCol, msg.yCol);
            panel.webview.postMessage({ 
                type: 'chartData', 
                data: chartData, 
                insights: insights,
                chartType: msg.chartType 
            });
            break;
        }

        case 'exportChart':
            await handleExport(msg.format, msg.dataUrl, msg.title);
            break;
    }
}

// ─── Data Builders ─────────────────────────────────────────────────────

/**
 * @param {import('../engine/dataset')} dataset
 * @param {string} chartType
 * @param {string} xCol
 * @param {string} yCol
 */
function buildChartData(dataset, chartType, xCol, yCol) {
    const rows = dataset.rows;

    if (chartType === 'pie') {
        return buildPieData(rows, xCol);
    } else {
        // both 'line' and 'bar' use the same x/y point data
        return buildLineData(rows, xCol, yCol);
    }
}

/** @param {any[]} rows @param {string} xCol @param {string} yCol */
function buildLineData(rows, xCol, yCol) {
    const points = [];
    const labels = [];

    for (const row of rows) {
        const x = row[xCol];
        const y = parseFloat(row[yCol]);
        if (isFinite(y) && x !== null && x !== undefined && x !== '') {
            points.push(y);
            labels.push(String(x));
        }
    }

    return {
        points,
        labels,
        xCol,
        yCol,
        pointCount: points.length,
    };
}

/** @param {any[]} rows @param {string} col */
function buildPieData(rows, col) {
    const counts = new Map();

    for (const row of rows) {
        const val = row[col];
        if (val !== null && val !== undefined && val !== '') {
            const key = String(val);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }

    const entries = [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

    const total = entries.reduce((sum, e) => sum + e.count, 0);

    return {
        entries,
        total,
        col,
        uniqueCount: entries.length,
    };
}

// ─── Insights Generator ────────────────────────────────────────────────

/**
 * @param {import('../engine/dataset')} dataset
 * @param {string} chartType
 * @param {string} xCol
 * @param {string} yCol
 */
function generateInsights(dataset, chartType, xCol, yCol) {
    if (chartType === 'pie') {
        return generatePieInsights(dataset, xCol);
    } else {
        // 'line' and 'bar' share the same insight logic
        return generateLineInsights(dataset, xCol, yCol);
    }
}

/**
 * @param {import('../engine/dataset')} dataset
 * @param {string} col
 */
function generatePieInsights(dataset, col) {
    const rows = dataset.rows;
    const counts = new Map();

    for (const row of rows) {
        const val = row[col];
        if (val !== null && val !== undefined && val !== '') {
            const key = String(val);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
    }

    const entries = [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

    const total = entries.reduce((sum, e) => sum + e.count, 0);
    const insights = [];

    if (entries.length > 0) {
        const top = entries[0];
        const pct = ((top.count / total) * 100).toFixed(1);
        insights.push({
            icon: '👑',
            severity: 'highlight',
            title: 'Dominant Category',
            detail: `"${top.label}" accounts for ${pct}% of all values (${top.count} of ${total} rows)`
        });
    }

    if (entries.length >= 3) {
        const top3 = entries.slice(0, 3).reduce((s, e) => s + e.count, 0);
        const top3Pct = ((top3 / total) * 100).toFixed(1);
        insights.push({
            icon: '📊',
            severity: 'info',
            title: 'Top 3 Concentration',
            detail: `Top 3 categories represent ${top3Pct}% of the total distribution`
        });
    }

    if (entries.length > 20) {
        insights.push({
            icon: '📋',
            severity: 'info',
            title: 'High Cardinality',
            detail: `${entries.length} unique categories found. Consider grouping for better visualization.`
        });
    }

    if (entries.length === 0) {
        insights.push({
            icon: '⚠️',
            severity: 'warning',
            title: 'Empty Column',
            detail: 'No valid data found in this column'
        });
    }

    return insights;
}

/**
 * @param {import('../engine/dataset')} dataset
 * @param {string} xCol
 * @param {string} yCol
 */
function generateLineInsights(dataset, xCol, yCol) {
    const rows = dataset.rows;
    const points = [];
    const labels = [];

    for (const row of rows) {
        const x = row[xCol];
        const y = parseFloat(row[yCol]);
        if (isFinite(y) && x !== null && x !== undefined && x !== '') {
            points.push(y);
            labels.push(String(x));
        }
    }

    const insights = [];

    if (points.length === 0) {
        insights.push({
            icon: '⚠️',
            severity: 'warning',
            title: 'No Valid Data',
            detail: 'No valid numeric data found for the Y-axis'
        });
        return insights;
    }

    const sum = points.reduce((a, b) => a + b, 0);
    const avg = sum / points.length;
    const min = Math.min(...points);
    const max = Math.max(...points);

    if (points.length >= 3) {
        const firstHalf = points.slice(0, Math.floor(points.length / 2));
        const secondHalf = points.slice(Math.floor(points.length / 2));
        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        const trend = ((secondAvg - firstAvg) / Math.abs(firstAvg || 1)) * 100;

        if (Math.abs(trend) > 5) {
            const direction = trend > 0 ? '📈 rising' : '📉 falling';
            insights.push({
                icon: '📈',
                severity: 'highlight',
                title: `${trend > 0 ? 'Upward' : 'Downward'} Trend Detected`,
                detail: `Values show a ${Math.abs(trend).toFixed(1)}% ${direction} trend from first to second half`
            });
        } else {
            insights.push({
                icon: '➡️',
                severity: 'info',
                title: 'Stable Trend',
                detail: 'Values remain relatively stable across the data range'
            });
        }
    }

    const nullCount = rows.length - points.length;
    if (nullCount > 0) {
        insights.push({
            icon: '🔍',
            severity: 'warning',
            title: 'Missing Values',
            detail: `${nullCount} row${nullCount > 1 ? 's' : ''} (${((nullCount / rows.length) * 100).toFixed(1)}%) have missing or invalid Y values`
        });
    }

    insights.push({
        icon: '📊',
        severity: 'info',
        title: 'Quick Stats',
        detail: `Range: ${min.toFixed(2)} → ${max.toFixed(2)} | Avg: ${avg.toFixed(2)} | n=${points.length}`
    });

    return insights;
}

// ─── Export Handlers ──────────────────────────────────────────────────

/**
 * @param {string} format
 * @param {string} dataUrl
 * @param {string} title
 */
async function handleExport(format, dataUrl, title) {
    const ext = format === 'png' ? 'png' : 'svg';
    const defaultName = `${title || 'chart'}.${ext}`;

    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultName),
        filters: {
            'Images': [ext],
            'All Files': ['*'],
        },
    });

    if (!uri) return;

    try {
        const base64Data = dataUrl.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        await fs.promises.writeFile(uri.fsPath, buffer);
        vscode.window.showInformationMessage(`Chart exported to: ${path.basename(uri.fsPath)}`);
    } catch (err) {
        vscode.window.showErrorMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// ─── Send Initial Data ───────────────────────────────────────────────

/**
 * @param {vscode.Webview} webview
 * @param {import('../engine/dataset')} dataset
 * @param {string[]} columns
 * @param {number} rowCount
 */
function sendInit(webview, dataset, columns, rowCount) {
    const colTypes = /** @type {Record<string, string>} */ ({});
    const numericCols = [];
    const categoricalCols = [];

    for (const col of columns) {
        const sample = dataset.rows.slice(0, Math.min(dataset.rows.length, 100));
        const vals = sample.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '');
        const numVals = vals.map(v => parseFloat(v)).filter(v => isFinite(v));

        let type = 'text';
        if (numVals.length / Math.max(vals.length, 1) > 0.7) {
            type = 'numeric';
            numericCols.push(col);
        } else if (vals.length > 0) {
            const unique = new Set(vals.map(String));
            if (unique.size / vals.length < 0.5) {
                type = 'categorical';
                categoricalCols.push(col);
            } else {
                type = 'text';
            }
        }
        colTypes[col] = type;
    }

    for (const col of columns) {
        if (!numericCols.includes(col) && colTypes[col] === 'numeric') numericCols.push(col);
        if (!categoricalCols.includes(col) && (colTypes[col] === 'categorical' || colTypes[col] === 'text')) categoricalCols.push(col);
    }

    webview.postMessage({
        type: 'init',
        payload: {
            columns,
            numericCols,
            categoricalCols,
            rowCount,
            colTypes,
        },
    });
}
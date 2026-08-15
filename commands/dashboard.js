/**
 * VizFlow: Dataset Summary Dashboard
 *
 * Opens a WebviewPanel that shows a full dataset health and structure
 * overview after a CSV is loaded:
 *
 *   - Summary cards  : rows, columns, file size, quality score, nulls,
 *                      duplicates, memory, type counts
 *   - Column Explorer: sortable/searchable table with type, null count,
 *                      distinct, duplicates, completeness, mini-bar
 *   - Details Panel  : per-column stats, patterns, top values, samples,
 *                      quality issues, quick actions
 *   - Insights       : auto-detected anomalies, primary-key candidates,
 *                      foreign-key hints, missing values, casing, outliers
 *   - Coming Soon    : reserved space for AI, charts, schema drift, etc.
 *
 * host → webview : init | error
 * webview → host : action (duplicates | distinct | transform | chart | compare | export)
 */

'use strict';

const vscode  = require('vscode');
const path    = require('path');
const crypto  = require('crypto');
const fs      = require('fs');

const csvReader = require('../services/csvReader');
const csvParser = require('../services/csvParser');

/**
 * Factory — accepts `context` so we can resolve media paths.
 *
 * @param {vscode.ExtensionContext} context
 * @returns {() => Promise<void>}
 */
module.exports = function dashboardCommand(context) {

    /** @type {vscode.WebviewPanel | undefined} */
    let panel;

    return async function () {

        // ── 1. Load and parse the active CSV ──────────────────────────────
        const csvText = await csvReader.load();
        if (!csvText) return;

        // Capture the source URI *before* the panel is created (while editor is active)
        const sourceUri = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.document.uri
            : undefined;

        let dataset;
        try {
            dataset = csvParser.parse(csvText);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage('VizFlow: Failed to parse CSV — ' + message);
            return;
        }

        const fileName = sourceUri ? path.basename(sourceUri.fsPath) : 'unknown.csv';
        const byteSize = Buffer.byteLength(csvText, 'utf8');
        const fileSize = formatBytes(byteSize);

        // ── 2. Reveal existing panel or create new one ────────────────────
        if (panel) {
            panel.reveal(vscode.ViewColumn.One);
            sendInit(panel.webview, dataset, fileName, fileSize);
            return;
        }

        panel = vscode.window.createWebviewPanel(
            'vizflowDashboard',
            'VizFlow: Dataset Summary',
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

        // ── 3. Build and inject HTML ───────────────────────────────────────
        const nonce   = crypto.randomBytes(16).toString('base64');
        const htmlUri = path.join(context.extensionPath, 'media', 'dashboard.html');
        let html      = fs.readFileSync(htmlUri, 'utf8');

        const cssUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'dashboard.css')
        ).toString();

        const iconUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png')
        ).toString();

        const { version } = context.extension.packageJSON;

        html = html
            .split('{{NONCE}}').join(nonce)
            .replace('{{WEBVIEW_CSS_URI}}', cssUri)
            .replace('{{ICON_URI}}', iconUri)
            .split('{{VERSION}}').join(version);

        panel.webview.html = html;

        // ── 4. Send profile data once webview is ready ────────────────────
        setImmediate(() => { if (panel) sendInit(panel.webview, dataset, fileName, fileSize); });

        // ── 5. Handle quick-action messages ───────────────────────────────
        panel.webview.onDidReceiveMessage(
            msg => handleMessage(msg, sourceUri),
            undefined,
            context.subscriptions
        );

        // ── 6. Cleanup ────────────────────────────────────────────────────
        panel.onDidDispose(() => { panel = undefined; }, undefined, context.subscriptions);
    };
};

// ─── Profile builder ────────────────────────────────────────────────────────

/**
 * Build the full dashboard payload and post it to the webview.
 *
 * @param {vscode.Webview} webview
 * @param {import('../engine/dataset')} dataset
 * @param {string} fileName
 * @param {string} fileSize
 */
function sendInit(webview, dataset, fileName, fileSize) {
    try {
        const payload = buildPayload(dataset, fileName, fileSize);
        webview.postMessage({ type: 'init', payload });
    } catch (err) {
        webview.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
}

/**
 * @param {import('../engine/dataset')} dataset
 * @param {string} fileName
 * @param {string} fileSize
 */
function buildPayload(dataset, fileName, fileSize) {
    const rows    = dataset.rows;
    const columns = dataset.getColumns();
    const rowCount = rows.length;

    // ── Per-column profiles ───────────────────────────────────────────────
    const columnProfiles = columns.map(col => profileColumn(rows, col, rowCount));

    // ── Dataset-level aggregates ──────────────────────────────────────────
    let nullTotal      = 0;
    let duplicateValues = 0;
    columnProfiles.forEach(cp => {
        nullTotal      += cp.nullCount;
        duplicateValues += cp.duplicateValues;
    });

    // Estimate duplicate rows: rows where every column value is identical
    const duplicateRows = countDuplicateRows(rows, columns);

    // Memory estimate: average ~50 bytes per cell
    const memoryKB = Math.round((rowCount * columns.length * 50) / 1024);

    // Quality score (0–100)
    const qualityScore = computeQualityScore(rowCount, columns.length, nullTotal, duplicateRows, columnProfiles);

    // ── Auto insights ─────────────────────────────────────────────────────
    const insights = buildInsights(columnProfiles, rows, rowCount, columns, duplicateRows, nullTotal);

    return {
        fileName,
        fileSize,
        rowCount,
        colCount: columns.length,
        memoryKB,
        nullTotal,
        duplicateRows,
        duplicateValues,
        qualityScore,
        columns: columnProfiles,
        insights,
    };
}

// ── Column profiler ──────────────────────────────────────────────────────────

/** @typedef {{ name:string, type:string, nullCount:number, distinctCount:number, duplicateValues:number, completeness:number, stats:object|null, patterns:string[], topValues:{value:any,count:number}[], sampleValues:any[], issues:{level:string,message:string}[] }} ColumnProfile */

/**
 * @param {any[]} rows
 * @param {string} col
 * @param {number} rowCount
 * @returns {ColumnProfile}
 */
function profileColumn(rows, col, rowCount) {
    const values    = rows.map(r => r[col]);
    const nonNull   = values.filter(v => v !== null && v !== undefined && v !== '');
    const nullCount = rowCount - nonNull.length;

    // Detect type
    const type = detectType(nonNull);

    // Distinct count
    const distinctSet = new Set(nonNull.map(v => String(v)));
    const distinctCount = distinctSet.size;

    // Duplicate values (values appearing more than once)
    const freq = new Map();
    nonNull.forEach(v => {
        const k = String(v);
        freq.set(k, (freq.get(k) || 0) + 1);
    });
    const duplicateValues = [...freq.values()].filter(c => c > 1).length;

    // Completeness %
    const completeness = rowCount > 0 ? +((nonNull.length / rowCount) * 100).toFixed(2) : 100;

    // Numeric stats
    let stats = null;
    if (type === 'numeric') {
        const nums = nonNull.filter(v => typeof v === 'number');
        stats = computeNumericStats(nums);
    }

    // Detected patterns (text columns)
    const patterns = type === 'text' ? detectPatterns(nonNull) : [];

    // Top values by frequency
    const topValues = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([value, count]) => ({ value, count }));

    // Sample values (first 10 distinct)
    const sampleValues = [...distinctSet].slice(0, 10);

    // Per-column issues
    const issues = detectColumnIssues(col, type, nullCount, rowCount, duplicateValues, nonNull, stats);

    return { name: col, type, nullCount, distinctCount, duplicateValues, completeness, stats, patterns, topValues, sampleValues, issues };
}

/** @param {any[]} nonNull */
function detectType(nonNull) {
    if (nonNull.length === 0) return 'text';

    const sample = nonNull.slice(0, Math.min(nonNull.length, 200));

    const isNumeric  = sample.every(v => typeof v === 'number');
    if (isNumeric) return 'numeric';

    const isBoolean  = sample.every(v => typeof v === 'boolean' || /^(true|false|yes|no|0|1)$/i.test(String(v)));
    if (isBoolean) return 'boolean';

    const dateRe = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?|^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/;
    const isDate = sample.every(v => typeof v === 'string' && dateRe.test(v.trim()));
    if (isDate) return 'date';

    // Mixed: some numeric some not
    const numCount = sample.filter(v => typeof v === 'number' || !isNaN(Number(v))).length;
    if (numCount > 0 && numCount < sample.length) return 'mixed';

    return 'text';
}

/** @param {number[]} nums */
function computeNumericStats(nums) {
    if (nums.length === 0) return null;
    const sorted = [...nums].sort((a, b) => a - b);
    const sum    = nums.reduce((s, v) => s + v, 0);
    const mean   = sum / nums.length;
    const mid    = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    const variance = nums.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / nums.length;
    const stdDev   = Math.sqrt(variance);

    return {
        min:    sorted[0],
        max:    sorted[sorted.length - 1],
        mean:   +mean.toFixed(4),
        median: +median.toFixed(4),
        stdDev: +stdDev.toFixed(4),
        sum:    +sum.toFixed(4),
    };
}

const PATTERN_TESTS = [
    { name: 'Email',    re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    { name: 'URL',      re: /^https?:\/\/.+/ },
    { name: 'Phone',    re: /^[\+\d][\d\s\-\(\)\.]{6,}$/ },
    { name: 'Date',     re: /^\d{4}-\d{2}-\d{2}$/ },
    { name: 'Currency', re: /^[$€£¥]\s?\d[\d,.]*$|^\d[\d,.]*\s?[$€£¥]$/ },
    { name: 'UUID',     re: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
    { name: 'Boolean',  re: /^(true|false|yes|no|0|1)$/i },
    { name: 'Integer',  re: /^-?\d+$/ },
    { name: 'Decimal',  re: /^-?\d+\.\d+$/ },
    { name: 'Zip Code', re: /^\d{5}(-\d{4})?$/ },
];

/** @param {any[]} nonNull */
function detectPatterns(nonNull) {
    if (nonNull.length === 0) return [];
    const sample = nonNull.slice(0, Math.min(nonNull.length, 100)).map(v => String(v));
    const threshold = 0.8;
    const matched = [];
    for (const { name, re } of PATTERN_TESTS) {
        const matchCount = sample.filter(v => re.test(v.trim())).length;
        if (matchCount / sample.length >= threshold) matched.push(name);
    }
    return matched;
}

/** @param {string} col @param {string} type @param {number} nullCount @param {number} rowCount @param {number} dupVals @param {any[]} nonNull @param {{mean: number, stdDev: number, min: number}|null} stats */
function detectColumnIssues(col, type, nullCount, rowCount, dupVals, nonNull, stats) {
    const issues = [];
    const nullPct = rowCount > 0 ? (nullCount / rowCount) * 100 : 0;

    if (nullPct > 50)  issues.push({ level: 'error', message: `High null rate: ${nullPct.toFixed(1)}% of values are missing.` });
    else if (nullPct > 10) issues.push({ level: 'warn', message: `Moderate null rate: ${nullPct.toFixed(1)}% of values are missing.` });

    if (type === 'text' && nonNull.length > 0) {
        const lower = nonNull.filter(v => String(v) === String(v).toLowerCase()).length;
        const upper = nonNull.filter(v => String(v) === String(v).toUpperCase()).length;
        const mixed = nonNull.length - lower - upper;
        if (lower > 0 && upper > 0 && mixed > 0 && lower < nonNull.length * 0.9 && upper < nonNull.length * 0.9) {
            issues.push({ level: 'warn', message: 'Inconsistent casing detected (mixed upper/lower/title case).' });
        }

        const hasLeadingTrailing = nonNull.some(v => String(v) !== String(v).trim());
        if (hasLeadingTrailing) issues.push({ level: 'warn', message: 'Some values have leading/trailing whitespace.' });
    }

    if (type === 'numeric' && stats) {
        const { mean, stdDev, min } = stats;
        if (stdDev > 0) {
            const outliers = nonNull.filter(v => Math.abs(v - mean) > 3 * stdDev).length;
            if (outliers > 0) issues.push({ level: 'warn', message: `${outliers} potential outlier(s) detected (>3 std. deviations from mean).` });
        }
        if (min < 0 && col.toLowerCase().match(/price|amount|cost|qty|quantity|count|age/)) {
            issues.push({ level: 'warn', message: 'Negative values detected in a likely non-negative column.' });
        }
    }

    if (type === 'mixed') {
        issues.push({ level: 'warn', message: 'Column contains mixed data types (numeric and text).' });
    }

    return issues;
}

// ── Row duplicate counter ─────────────────────────────────────────────────────

/**
 * @param {any[]} rows
 * @param {string[]} columns
 */
function countDuplicateRows(rows, columns) {
    const seen = new Set();
    let count  = 0;
    for (const row of rows) {
        const key = columns.map(c => JSON.stringify(row[c])).join('|');
        if (seen.has(key)) count++;
        else seen.add(key);
    }
    return count;
}

// ── Quality score ─────────────────────────────────────────────────────────────

/**
 * @param {number} rowCount
 * @param {number} colCount
 * @param {number} nullTotal
 * @param {number} duplicateRows
 * @param {ColumnProfile[]} profiles
 */
function computeQualityScore(rowCount, colCount, nullTotal, duplicateRows, profiles) {
    const cells = rowCount * colCount || 1;

    const nullPenalty  = Math.min(40, (nullTotal / cells) * 200);
    const dupePenalty  = Math.min(20, (duplicateRows / (rowCount || 1)) * 100);
    const mixedPenalty = profiles.filter(p => p.type === 'mixed').length * 5;
    const issuePenalty = profiles.reduce((s, p) => s + p.issues.filter(i => i.level === 'error').length * 4 + p.issues.filter(i => i.level === 'warn').length * 2, 0);

    const score = Math.max(0, Math.round(100 - nullPenalty - dupePenalty - Math.min(15, mixedPenalty) - Math.min(15, issuePenalty)));
    return score;
}

// ── Auto insights ─────────────────────────────────────────────────────────────

/**
 * @param {ColumnProfile[]} profiles
 * @param {any[]} rows
 * @param {number} rowCount
 * @param {string[]} columns
 * @param {number} duplicateRows
 * @param {number} nullTotal
 * @returns {object[]}
 */
function buildInsights(profiles, rows, rowCount, columns, duplicateRows, nullTotal) {
    const insights = [];

    // Possible primary key candidates
    const pkCandidates = profiles.filter(p =>
        p.distinctCount === rowCount && p.nullCount === 0
    );
    if (pkCandidates.length > 0) {
        insights.push({
            icon: '🔑', severity: 'info',
            title: 'Possible Primary Key' + (pkCandidates.length > 1 ? 's' : ''),
            body: pkCandidates.map(p => `"${p.name}"`).join(', ') +
                ` ha${pkCandidates.length > 1 ? 've' : 's'} all unique, non-null values — likely primary key candidate(s).`,
            actions: pkCandidates.slice(0, 2).map(p => ({ type: 'distinct', column: p.name, label: 'Show Distinct: ' + p.name })),
        });
    }

    // Possible foreign key candidates (numeric ID-like columns with repeated values)
    const fkCandidates = profiles.filter(p =>
        p.name.toLowerCase().match(/(_id|id_|fk_|_fk|_key|_ref)$|^(id_|fk_|ref_)/) &&
        p.distinctCount < rowCount
    );
    if (fkCandidates.length > 0) {
        insights.push({
            icon: '🔗', severity: 'info',
            title: 'Possible Foreign Key Columns',
            body: fkCandidates.map(p => `"${p.name}"`).join(', ') +
                ' — naming pattern suggests foreign key reference. Consider verifying against a lookup table.',
            actions: fkCandidates.slice(0, 2).map(p => ({ type: 'distinct', column: p.name, label: 'Show: ' + p.name })),
        });
    }

    // High null columns
    const highNullCols = profiles.filter(p => p.nullCount / (rowCount || 1) > 0.3);
    highNullCols.forEach(p => {
        const nullPct = ((p.nullCount / rowCount) * 100).toFixed(1);
        insights.push({
            icon: '⚠️', severity: p.nullCount / rowCount > 0.5 ? 'high' : 'medium',
            title: `High Missing Values in "${p.name}"`,
            body: `${nullPct}% of values (${p.nullCount.toLocaleString()} rows) are null or empty. Consider imputation or dropping this column.`,
            actions: [
                { type: 'transform', column: p.name, label: 'Transform Column' },
                { type: 'distinct',  column: p.name, label: 'Show Distinct' },
            ],
        });
    });

    // Duplicate rows
    if (duplicateRows > 0) {
        insights.push({
            icon: '📋', severity: duplicateRows > rowCount * 0.1 ? 'high' : 'medium',
            title: 'Duplicate Rows Detected',
            body: `${duplicateRows.toLocaleString()} fully duplicate row(s) found (${((duplicateRows / rowCount) * 100).toFixed(1)}% of dataset). Consider deduplication.`,
            actions: [{ type: 'duplicates', column: '', label: 'View Duplicates' }],
        });
    }

    // Mixed type columns
    const mixedCols = profiles.filter(p => p.type === 'mixed');
    mixedCols.forEach(p => {
        insights.push({
            icon: '🔀', severity: 'medium',
            title: `Mixed Data Type in "${p.name}"`,
            body: `Column contains a mix of numeric and text values. This may indicate data entry errors or schema inconsistencies.`,
            actions: [
                { type: 'transform', column: p.name, label: 'Transform Column' },
                { type: 'distinct',  column: p.name, label: 'Show Distinct' },
            ],
        });
    });

    // Inconsistent casing
    const casingCols = profiles.filter(p => p.issues.some(i => i.message.includes('casing')));
    casingCols.forEach(p => {
        insights.push({
            icon: '🔡', severity: 'low',
            title: `Inconsistent Casing in "${p.name}"`,
            body: `Values in "${p.name}" use inconsistent capitalisation. Standardise with UPPERCASE, lowercase, or Title Case transforms.`,
            actions: [{ type: 'transform', column: p.name, label: 'Transform Column' }],
        });
    });

    // Whitespace issues
    const wsCols = profiles.filter(p => p.issues.some(i => i.message.includes('whitespace')));
    wsCols.forEach(p => {
        insights.push({
            icon: '⎵', severity: 'low',
            title: `Whitespace Issues in "${p.name}"`,
            body: `Some values in "${p.name}" have leading or trailing spaces. Use the "Trim" transform to clean them.`,
            actions: [{ type: 'transform', column: p.name, label: 'Trim Whitespace' }],
        });
    });

    // Outlier columns
    const outlierCols = profiles.filter(p => p.issues.some(i => i.message.includes('outlier')));
    outlierCols.forEach(p => {
        const issue = p.issues.find(i => i.message.includes('outlier'));
        insights.push({
            icon: '📊', severity: 'medium',
            title: `Outliers Detected in "${p.name}"`,
            body: issue ? issue.message : `"${p.name}" contains outlier values significantly far from the mean.`,
            actions: [
                { type: 'statistics', column: p.name, label: 'View Statistics' },
                { type: 'chart',      column: p.name, label: 'Generate Chart' },
            ],
        });
    });

    // Constant columns
    const constCols = profiles.filter(p => p.distinctCount === 1 && p.nullCount === 0);
    constCols.forEach(p => {
        insights.push({
            icon: '📌', severity: 'low',
            title: `Constant Column: "${p.name}"`,
            body: `All values in "${p.name}" are identical. This column carries no variance and may be safe to drop.`,
            actions: [{ type: 'distinct', column: p.name, label: 'Confirm Values' }],
        });
    });

    // Fully empty columns
    const emptyCols = profiles.filter(p => p.nullCount === rowCount);
    emptyCols.forEach(p => {
        insights.push({
            icon: '🚫', severity: 'high',
            title: `Empty Column: "${p.name}"`,
            body: `Column "${p.name}" has no non-null values at all. It is completely empty.`,
            actions: [],
        });
    });

    // Near-duplicate columns (identical distinct counts + type)
    for (let i = 0; i < profiles.length; i++) {
        for (let j = i + 1; j < profiles.length; j++) {
            const a = profiles[i], b = profiles[j];
            if (a.type === b.type && a.distinctCount === b.distinctCount && a.distinctCount > 0 && a.nullCount === b.nullCount) {
                insights.push({
                    icon: '👯', severity: 'info',
                    title: `Potentially Similar Columns`,
                    body: `"${a.name}" and "${b.name}" share the same type, distinct count, and null count — they may contain overlapping or duplicate data.`,
                    actions: [
                        { type: 'compare', column: a.name, label: 'Compare CSV' },
                    ],
                });
                // Only flag one pair to avoid noise
                i = profiles.length;
                break;
            }
        }
    }

    // Overall data quality praise
    if (insights.filter(i => ['high','medium'].includes(i.severity)).length === 0 && nullTotal === 0 && duplicateRows === 0) {
        insights.push({
            icon: '✅', severity: 'low',
            title: 'Dataset Looks Clean',
            body: 'No critical data quality issues detected. Zero nulls, zero duplicate rows, and all columns have consistent types.',
            actions: [],
        });
    }

    return insights;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** @param {number} bytes */
function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * Route quick-action messages from the webview.
 * Re-activates the source CSV editor first so that commands like
 * transformWebview / distinctValues / duplicates can read the active editor.
 *
 * @param {{ type:string, action:string, column:string }} msg
 * @param {vscode.Uri | undefined} sourceUri
 */
async function handleMessage(msg, sourceUri) {
    if (msg.type !== 'action') return;

    const cmdMap = /** @type {Record<string, string | null>} */ ({
        duplicates: 'vizflow.duplicates',
        distinct:   'vizflow.distinctValues',
        transform:  'vizflow.transformWebview',
        compare:    'vizflow.compareCSV',
        statistics: 'vizflow.statistics',
        export:     null,   // future: report generation
        chart:      null,   // future: chart view
    });

    const cmd = cmdMap[msg.action];
    if (!cmd) {
        vscode.window.showInformationMessage(
            `VizFlow: "${msg.action}" feature is coming soon!`
        );
        return;
    }

    // Re-show the source CSV document in a visible editor column so that the
    // target command can find it via vscode.window.activeTextEditor.
    if (sourceUri) {
        await vscode.window.showTextDocument(sourceUri, {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: false,
            preview: true,
        });
    }

    vscode.commands.executeCommand(cmd);
}
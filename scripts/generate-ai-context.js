/**
 * scripts/generate-ai-context.js
 *
 * Generates AI-friendly context artifacts from the LIVE activity registry so the
 * documentation can never drift from the code:
 *
 *   - docs/workflow-catalog.md   Human/LLM-readable catalog of every activity,
 *                                its config fields, options and defaults.
 *   - docs/workflow-schema.json  JSON Schema (draft-07) describing valid
 *                                .vizflow workflow definitions.
 *
 * Usage:
 *   npm run gen:context
 *
 * The generated files are committed. `test/workflow.test.js` has a drift-guard
 * test that fails if they are out of sync with the live registry, so when you
 * add/change an activity you must re-run this script.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');

const activityRegistry = require('../engine/workflow/activityRegistry');
const { VALID_CATEGORIES } = require('../engine/workflow/activityRegistryCore');

// NOTE: idempotent (registerAllActivities guards against double registration).
activityRegistry.registerAllActivities({ silent: true });

// ─── Activity metadata ───────────────────────────────────────────────────────

/**
 * Activities whose config carries nested arrays of activity objects (not part
 * of configRequirements).
 */
const NESTED_CONTROL = {
    ifElse: [
        { field: 'thenSteps', description: 'Array of activity objects to run when the condition matches.' },
        { field: 'elseSteps', description: 'Array of activity objects to run when the condition does not match.' }
    ],
    forEach: [
        { field: 'steps', description: 'Array of activity objects to run per group. Placeholders like {{row.Column}} resolve against a sample row of the group.' }
    ],
    forEachFile: [
        { field: 'steps', description: 'Array of activity objects to run per file. Loop variables available: {{filePath}}, {{fileName}}, {{fileExtension}}, {{currentFile}}.' }
    ]
};

/**
 * Loop variables exposed inside each control structure.
 */
const LOOP_VARIABLES = {
    forEachFile: '{{filePath}}, {{fileName}}, {{fileExtension}}, {{currentFile}}',
    forEach: '{{row.Column}} (sample row of the group)',
    ifElse: 'none'
};

function getActivities() {
    const acts = activityRegistry.getActivities();
    const categories = new Map();
    for (const a of acts) {
        const cat = a.category || 'Utility';
        if (!categories.has(cat)) categories.set(cat, []);
        categories.get(cat).push(a);
    }
    for (const list of categories.values()) {
        list.sort((a, b) => a.type.localeCompare(b.type));
    }
    return { activities: acts, categories, order: VALID_CATEGORIES };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDefault(value) {
    if (value === undefined || value === null) return '—';
    if (typeof value === 'string' && value === '') return '""';
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function optionLabel(opt) {
    const value = typeof opt === 'string' ? opt : opt.value;
    const hint = typeof opt === 'object' && opt ? opt.paramsHint : undefined;
    if (hint && hint !== 'none') {
        return '`' + value + '` (params: ' + hint + ')';
    }
    return '`' + value + '`';
}

// ─── Markdown catalog ────────────────────────────────────────────────────────

function buildCatalogMarkdown(data) {
    const { categories } = data;

    const lines = [];
    lines.push('# VizFlow Workflow Activity Catalog');
    lines.push('');
    lines.push('> **GENERATED FILE — do not edit by hand.**');
    lines.push('> Source: `scripts/generate-ai-context.js` · regenerate with `npm run gen:context`.');
    lines.push('> A test enforces this file matches the live activity registry, so the catalog can');
    lines.push('> never drift from the code. When you add/remove/change an activity, re-run the script.');
    lines.push('');
    lines.push('Each activity below is a valid `type` for a `.vizflow` activity node:');
    lines.push('');
    lines.push('```json');
    lines.push('{ "id": "unique_step_id", "type": "readCsv", "config": { "filePath": "..." } }');
    lines.push('```');
    lines.push('');
    lines.push('## Index');
    lines.push('');
    for (const category of VALID_CATEGORIES) {
        const list = categories.get(category);
        if (!list) continue;
        lines.push(`- **${category}** (${list.length}): ` + list.map((a) => `\`${a.type}\``).join(', '));
    }
    lines.push('');

    for (const category of VALID_CATEGORIES) {
        const list = categories.get(category);
        if (!list) continue;
        lines.push(`## ${category}`);
        lines.push('');
        for (const act of list) {
            lines.push(`### \`${act.type}\` — ${act.displayName}`);
            lines.push('');
            if (act.description) {
                lines.push(act.description.trim());
                lines.push('');
            }
            lines.push('| Config field | Type | Required | Default | Description |');
            lines.push('|--------------|------|----------|---------|-------------|');
            const reqs = act.configRequirements || [];
            for (const req of reqs) {
                const def = fmtDefault(req.defaultValue);
                const desc = (req.description || '').trim();
                lines.push(`| \`${req.name}\` | ${req.type} | ${req.required ? 'yes' : 'no'} | ${def} | ${desc} |`);
            }
            lines.push('');

            for (const req of reqs) {
                if (req.type === 'select' && req.options && req.options.length > 0) {
                    lines.push(`**\`${req.name}\` options:** ` + req.options.map(optionLabel).join(', '));
                    lines.push('');
                }
                if (req.type === 'multiAction' && req.operationOptions && req.operationOptions.length > 0) {
                    lines.push(`**\`${req.name}\` operations:** ` + req.operationOptions.map(optionLabel).join(', '));
                    lines.push('');
                }
            }

            const nested = NESTED_CONTROL[act.type];
            if (nested && nested.length > 0) {
                for (const n of nested) {
                    lines.push(`- **Nested \`${n.field}\`:** ${n.description}`);
                }
                if (LOOP_VARIABLES[act.type]) {
                    lines.push(`- **Loop variables:** ${LOOP_VARIABLES[act.type]}`);
                }
                lines.push('');
            }
        }
    }

    return lines.join('\n') + '\n';
}

// ─── JSON Schema ─────────────────────────────────────────────────────────────

function configFieldToSchema(req) {
    const out = { description: (req.description || `${req.name} config field.`).trim() };
    switch (req.type) {
        case 'number':
            out.type = 'number';
            break;
        case 'boolean':
            out.type = 'boolean';
            break;
        case 'select':
            out.type = 'string';
            if (req.options && req.options.length > 0) {
                out.enum = req.options.map((o) => (typeof o === 'string' ? o : o.value));
            }
            break;
        case 'array':
            out.type = 'array';
            break;
        case 'keyValue':
            out.type = 'object';
            out.additionalProperties = { type: 'string' };
            break;
        case 'object':
            out.type = 'object';
            break;
        case 'multiAction':
            out.type = 'array';
            out.description = (out.description || 'List of transform operations.') + ' Each entry: { column, opKey, params, asNewColumn }.';
            out.items = {
                type: 'object',
                required: ['column', 'opKey'],
                properties: {
                    column: { type: 'string', description: 'Column to transform.' },
                    opKey: { type: 'string', description: 'Operation key from the catalog operation list.' },
                    params: { type: ['string', 'array'], description: 'Operation parameters.' },
                    asNewColumn: { type: 'boolean', description: 'Write result to a new column instead of overwriting (default false).' }
                }
            };
            break;
        case 'string':
        case 'file':
        case 'text':
        case 'date':
        case 'time':
        case 'color':
        default:
            out.type = 'string';
            break;
    }
    return out;
}

function buildJsonSchema(data) {
    const { activities } = data;
    const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: 'https://vizflow.local/schemas/workflow.schema.json',
        title: 'VizFlow Workflow Definition',
        description: 'Declarative workflow definition for VizFlow (.vizflow files). Each activity receives the previous activity\'s dataset; the last activity\'s dataset is the workflow output.',
        type: 'object',
        additionalProperties: false,
        required: ['activities'],
        properties: {
            name: { type: 'string', description: 'Workflow display name.' },
            version: { type: 'string', description: 'Workflow version.' },
            description: { type: 'string', description: 'Optional description.' },
            parameters: {
                type: 'array',
                description: 'Workflow-level parameters. String config values across activities may reference them as {{paramName}}.',
                items: { $ref: '#/definitions/workflowParameter' }
            },
            activities: {
                type: 'array',
                minItems: 1,
                description: 'Activities run in order; each receives the previous activity\'s dataset.',
                items: { $ref: '#/definitions/activity' }
            },
            edges: {
                type: 'array',
                description: 'Visual connections (arrows) between activities on the canvas. These define the DAG layout but do not affect execution order.',
                items: { $ref: '#/definitions/edge' }
            }
        },
        definitions: {
            workflowParameter: {
                type: 'object',
                additionalProperties: false,
                required: ['name'],
                properties: {
                    name: { type: 'string', description: 'Unique parameter name; referenced as {{name}}.' },
                    label: { type: 'string' },
                    type: { type: 'string', enum: ['string', 'number', 'boolean', 'array', 'object'], default: 'string' },
                    required: { type: 'boolean', default: false, description: 'Required parameters must resolve to a non-empty value.' },
                    defaultValue: { description: 'Applied when the value is not provided; may contain {{variable}} placeholders; coerced to the declared type.' }
                }
            },
            edge: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'source', 'target'],
                properties: {
                    id: { type: 'string', description: 'Unique edge identifier.' },
                    source: {
                        type: 'object',
                        required: ['nodeId', 'port'],
                        properties: {
                            nodeId: { type: 'string', description: 'Source activity ID.' },
                            port: { type: 'string', enum: ['input', 'output'], description: 'Source port type.' }
                        }
                    },
                    target: {
                        type: 'object',
                        required: ['nodeId', 'port'],
                        properties: {
                            nodeId: { type: 'string', description: 'Target activity ID.' },
                            port: { type: 'string', enum: ['input', 'output'], description: 'Target port type.' }
                        }
                    },
                    label: { type: 'string', description: 'Optional label displayed on the edge.' }
                }
            },
            activity: {
                type: 'object',
                anyOf: activities.map((a) => ({ $ref: `#/definitions/activity/${a.type}` }))
            }
        }
    };

    for (const act of activities) {
        const props = {
            id: {
                type: 'string',
                pattern: '^[a-zA-Z0-9_-]+$',
                description: 'Unique id within this workflow (and nested branches).'
            },
            type: { const: act.type },
            displayName: { type: 'string', description: 'Custom display name for this activity on the canvas.' },
            notes: { type: 'string', description: 'Free-text notes/comments about this activity.' },
            config: {
                type: 'object',
                additionalProperties: false
            }
        };

        const configProps = {};
        const configRequired = [];
        for (const req of act.configRequirements || []) {
            configProps[req.name] = configFieldToSchema(req);
            if (req.required) configRequired.push(req.name);
        }

        const nested = NESTED_CONTROL[act.type];
        if (nested) {
            for (const n of nested) {
                configProps[n.field] = {
                    type: 'array',
                    description: n.description,
                    items: { $ref: '#/definitions/activity' }
                };
            }
        }

        props.config.properties = configProps;
        if (configRequired.length > 0) props.config.required = configRequired;

        schema.definitions[`activity/${act.type}`] = {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'type', 'config'],
            properties: props
        };
    }

    return schema;
}

// ─── Write artifacts ─────────────────────────────────────────────────────────

function generate() {
    const data = getActivities();
    const catalog = buildCatalogMarkdown(data);
    const schema = buildJsonSchema(data);

    if (!fs.existsSync(DOCS_DIR)) {
        fs.mkdirSync(DOCS_DIR, { recursive: true });
    }

    const catalogPath = path.join(DOCS_DIR, 'workflow-catalog.md');
    const schemaPath = path.join(DOCS_DIR, 'workflow-schema.json');
    fs.writeFileSync(catalogPath, catalog, 'utf8');
    fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2) + '\n', 'utf8');

    const { activities } = data;
    console.log(`[gen:context] Wrote ${activities.length} activities to:`);
    console.log(`  ${path.relative(ROOT, catalogPath)}`);
    console.log(`  ${path.relative(ROOT, schemaPath)}`);
    return { catalogPath, schemaPath, count: activities.length };
}

if (require.main === module) {
    generate();
}

module.exports = {
    getActivities,
    buildCatalogMarkdown,
    buildJsonSchema,
    generate
};

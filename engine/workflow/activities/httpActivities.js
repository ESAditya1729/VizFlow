/**
 * engine/workflow/activities/httpActivities.js
 *
 * HTTP / REST integration activities.
 *
 * The `httpRequest` activity calls a web API and turns the response into a
 * Dataset so it can feed downstream transformations/analytics the same way any
 * other data source does. Top-level string config values (`url`, `headers`,
 * `body`, `queryParams`) are {{variable}}-interpolated by the workflow engine.
 */

'use strict';

const Dataset = require('../../dataset');
const { validateConfig } = require('./shared');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve a dotted path inside an object (same semantics as templateService).
 * @param {*} obj
 * @param {string} pathStr
 * @returns {*}
 */
function getPath(obj, pathStr) {
    if (obj === null || obj === undefined) return undefined;
    if (typeof pathStr !== 'string' || !pathStr.trim()) return obj;
    let current = obj;
    for (const part of pathStr.trim().split('.')) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }
    return current;
}

/**
 * Parse a JSON config value that may be an already-parsed object.
 * @param {string|Object|Array} raw
 * @param {string} fieldName
 * @returns {*} Parsed value or undefined
 * @throws {Error} When the value is a string that is not valid JSON
 */
function parseJsonValue(raw, fieldName) {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'string') return raw;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
        return JSON.parse(trimmed);
    } catch (err) {
        throw new Error(`HTTP Request: "${fieldName}" must be valid JSON — ${err.message}`);
    }
}

/**
 * Normalize a JSON object value into a plain headers/params map.
 * @param {string|Object} raw
 * @param {string} fieldName
 * @returns {Object|undefined}
 */
function toObjectMap(raw, fieldName) {
    const value = parseJsonValue(raw, fieldName);
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`HTTP Request: "${fieldName}" must be a JSON object`);
    }
    const map = {};
    for (const [key, v] of Object.entries(value)) {
        map[key] = v === null || v === undefined ? '' : String(v);
    }
    return map;
}

/**
 * Build the request body + content-type for a given contentType selection.
 * @param {string|Object|Array|undefined} rawBody
 * @param {string} contentType - json | text | form
 * @returns {{ data: *, contentType: string }}
 */
function buildBody(rawBody, contentType) {
    if (rawBody === undefined || rawBody === null) {
        return { data: undefined, contentType };
    }
    if (contentType === 'json') {
        const parsed = parseJsonValue(rawBody, 'body');
        if (parsed === undefined) return { data: undefined, contentType: 'application/json' };
        return { data: parsed, contentType: 'application/json' };
    }
    if (contentType === 'form') {
        const value = parseJsonValue(rawBody, 'body');
        if (value === undefined || !value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('HTTP Request: "body" must be a JSON object when content type is form');
        }
        return { data: new URLSearchParams(toObjectMap(value, 'body')), contentType: 'application/x-www-form-urlencoded' };
    }
    // text
    return { data: String(rawBody), contentType: 'text/plain; charset=utf-8' };
}

/**
 * Derive Dataset columns from a set of row objects (first-seen order).
 * @param {Array<Object>} rows
 * @returns {Array<string>}
 */
function deriveColumns(rows) {
    const columns = [];
    const seen = new Set();
    const sample = rows.slice(0, 50);
    for (const row of sample) {
        if (!row || typeof row !== 'object') continue;
        for (const key of Object.keys(row)) {
            if (!seen.has(key)) {
                seen.add(key);
                columns.push(key);
            }
        }
    }
    return columns;
}

/**
 * Turn a response body into { rows, columns }.
 * @param {*} data - Axios response.data
 * @param {string|null} responsePath - Optional dot path into the payload
 * @param {number} maxRows
 * @returns {{ rows: Array, columns: Array<string> }}
 */
function toRows(data, responsePath, maxRows) {
    let payload = data;
    if (responsePath && payload && typeof payload === 'object') {
        payload = getPath(payload, responsePath);
    }

    // JSON string responses (e.g. an endpoint returning a JSON string)
    if (typeof payload === 'string') {
        const trimmed = payload.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                payload = JSON.parse(trimmed);
            } catch (_err) {
                // keep as text below
            }
        }
    }

    if (Array.isArray(payload)) {
        let rows = payload.slice(0, maxRows);
        if (rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
            return { rows, columns: deriveColumns(rows) };
        }
        return { rows: rows.map((v) => ({ value: v })), columns: ['value'] };
    }

    if (payload && typeof payload === 'object') {
        // Single object → one row; nested objects/arrays are stringified.
        const row = {};
        for (const [key, value] of Object.entries(payload)) {
            if (value !== null && typeof value === 'object') {
                row[key] = JSON.stringify(value);
            } else {
                row[key] = value;
            }
        }
        return { rows: [row], columns: Object.keys(row) };
    }

    // Scalar / empty body
    return { rows: [{ value: payload === undefined || payload === null ? '' : payload }], columns: ['value'] };
}

// ─── HTTP Request ────────────────────────────────────────────────────────────

const httpActivities = [];
httpActivities.push({
    type: 'httpRequest',
    displayName: '🌐 HTTP Request',
    description: 'Calls a REST API (GET/POST/PUT/PATCH/DELETE/…) and converts the JSON response into a Dataset. {{variable}} interpolation is supported in URL, headers, query and body.',
    category: 'Integration',
    configRequirements: [
        {
            name: 'url',
            label: 'URL',
            type: 'string',
            required: true,
            description: 'Request URL — {{variable}} interpolation supported',
            placeholder: 'https://api.example.com/v1/orders'
        },
        {
            name: 'method',
            label: 'Method',
            type: 'select',
            required: true,
            defaultValue: 'GET',
            options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
            description: 'HTTP method to use'
        },
        {
            name: 'headers',
            label: 'Headers (JSON)',
            type: 'text',
            required: false,
            description: 'JSON object of request headers (may include Authorization)',
            placeholder: '{ "Authorization": "Bearer …" }'
        },
        {
            name: 'queryParams',
            label: 'Query Params (JSON)',
            type: 'text',
            required: false,
            description: 'JSON object appended to the URL as query string parameters',
            placeholder: '{ "status": "active", "limit": 100 }'
        },
        {
            name: 'contentType',
            label: 'Body Content Type',
            type: 'select',
            required: false,
            defaultValue: 'json',
            options: ['json', 'text', 'form'],
            description: 'How the request body is interpreted'
        },
        {
            name: 'body',
            label: 'Body',
            type: 'text',
            required: false,
            description: 'Request body — JSON when content type is json, {{variable}} interpolation supported',
            placeholder: '{ "query": "SELECT 1" }'
        },
        {
            name: 'responsePath',
            label: 'Response Path',
            type: 'string',
            required: false,
            description: 'Dot path into the response where the data array/object lives (e.g. "data.items"). Leave empty to use the whole body.',
            placeholder: 'data.items'
        },
        {
            name: 'timeout',
            label: 'Timeout (seconds)',
            type: 'number',
            required: false,
            defaultValue: 30,
            description: 'Request timeout in seconds'
        },
        {
            name: 'maxResponseRows',
            label: 'Max Rows',
            type: 'number',
            required: false,
            defaultValue: 10000,
            description: 'Maximum rows to keep when the response is an array'
        },
        {
            name: 'ignoreErrorStatus',
            label: 'Keep non-2xx Responses',
            type: 'boolean',
            required: false,
            defaultValue: false,
            description: 'When enabled, error status responses are kept as data instead of failing the workflow'
        }
    ],
    async execute(config, context, _inputDataset) {
        validateConfig(config, ['url'], 'HTTP Request');
        const axios = require('axios');

        const method = String(config.method || 'GET').trim().toUpperCase();
        const url = String(config.url).trim();
        const timeoutSec = parseInt(config.timeout, 10) > 0 ? parseInt(config.timeout, 10) : 30;
        const maxRows = parseInt(config.maxResponseRows, 10) > 0 ? parseInt(config.maxResponseRows, 10) : 10000;
        const ignoreErrorStatus = config.ignoreErrorStatus === true || config.ignoreErrorStatus === 'true';
        const responsePath = config.responsePath && String(config.responsePath).trim()
            ? String(config.responsePath).trim()
            : null;

        const headers = toObjectMap(config.headers, 'headers') || {};
        const params = toObjectMap(config.queryParams, 'queryParams');
        const contentType = (config.contentType || 'json').toLowerCase();
        const body = buildBody(config.body, contentType);
        if (body.data !== undefined && body.contentType) headers['Content-Type'] = body.contentType;

        let response;
        try {
            response = await axios({
                method,
                url,
                headers,
                params,
                data: body.data,
                timeout: timeoutSec * 1000,
                maxRedirects: 5,
                validateStatus: ignoreErrorStatus ? () => true : (status) => status >= 200 && status < 400,
                responseType: 'text'
            });
        } catch (err) {
            if (err && err.response) {
                throw new Error(`HTTP Request: ${method} ${url} failed with status ${err.response.status} — ${err.message}`);
            }
            throw new Error(`HTTP Request: ${method} ${url} failed — ${(err && err.message) || err}`);
        }

        const { rows, columns } = toRows(response.data, responsePath, maxRows);

        if (context && context.setActivityStats) {
            context.setActivityStats({
                httpStatus: response.status,
                outputRowCount: rows.length,
                columnCount: columns.length,
                url
            });
        }

        if (context && typeof context.setVariable === 'function') {
            context.setVariable('httpRequest', {
                status: response.status,
                statusText: response.statusText,
                url: url,
                headers: response.headers || {}
            });
        }

        return new Dataset(rows, columns);
    }
});

// ─── SOAP Request ────────────────────────────────────────────────────────────

/**
 * Wrap a body XML fragment into a SOAP envelope (1.1 or 1.2).
 * @param {Object} cfg - { body, soapVersion, namespace, operation }
 * @returns {string} Full SOAP envelope
 */
function buildSoapEnvelope(cfg) {
    const isSoap12 = String(cfg.soapVersion || 'soap11').trim().toLowerCase() === 'soap12';
    const envelopeNs = isSoap12
        ? 'http://www.w3.org/2003/05/soap-envelope'
        : 'http://schemas.xmlsoap.org/soap/envelope/';

    let body = String(cfg.body || '').trim();
    body = body.replace(/^\s*<\?xml[^>]*\?>\s*/, '');

    let inner = body;
    const operation = cfg.operation ? String(cfg.operation).trim() : '';
    if (operation) {
        const namespace = cfg.namespace ? ` xmlns="${String(cfg.namespace).trim()}"` : '';
        inner = `<${operation}${namespace}>${body}</${operation}>`;
    }

    return '<?xml version="1.0" encoding="utf-8"?>' +
        `<soapenv:Envelope xmlns:soapenv="${envelopeNs}">` +
        '<soapenv:Header/>' +
        `<soapenv:Body>${inner}</soapenv:Body>` +
        '</soapenv:Envelope>';
}

httpActivities.push({
    type: 'soapRequest',
    displayName: '🫧 SOAP Request',
    description: 'Calls a SOAP web service by wrapping an XML body in a SOAP envelope and returns the raw XML response as a dataset row. {{variable}} interpolation is supported in URL, body, auth and headers.',
    category: 'Integration',
    configRequirements: [
        {
            name: 'url',
            label: 'URL',
            type: 'string',
            required: true,
            description: 'SOAP endpoint URL — {{variable}} interpolation supported',
            placeholder: 'https://api.example.com/soap/service'
        },
        {
            name: 'body',
            label: 'Body XML',
            type: 'text',
            required: true,
            description: 'XML that goes inside <soapenv:Body> (the operation/method content). An XML declaration is stripped automatically. {{variable}} interpolation supported.',
            placeholder: '<GetQuote><symbol>{{symbol}}</symbol></GetQuote>'
        },
        {
            name: 'operation',
            label: 'Operation',
            type: 'string',
            required: false,
            description: 'Optional wrapper element for the body, e.g. "GetQuote". When set, the body is wrapped in <Operation xmlns="...">…</Operation>'
        },
        {
            name: 'namespace',
            label: 'Namespace',
            type: 'string',
            required: false,
            description: 'Optional xmlns for the operation wrapper element'
        },
        {
            name: 'soapAction',
            label: 'SOAPAction',
            type: 'string',
            required: false,
            description: 'SOAPAction header (SOAP 1.1) or action parameter in the Content-Type (SOAP 1.2). Some SOAP 1.1 endpoints require it.'
        },
        {
            name: 'soapVersion',
            label: 'SOAP Version',
            type: 'select',
            required: false,
            defaultValue: 'soap11',
            options: [
                { label: 'SOAP 1.1', value: 'soap11' },
                { label: 'SOAP 1.2', value: 'soap12' }
            ],
            description: 'SOAP envelope namespace and content type (default: SOAP 1.1)'
        },
        {
            name: 'authType',
            label: 'Auth Type',
            type: 'select',
            required: false,
            defaultValue: 'none',
            options: [
                { label: 'None', value: 'none' },
                { label: 'Basic Auth', value: 'basic' },
                { label: 'Bearer Token', value: 'bearer' }
            ],
            description: 'HTTP authentication to attach (default: none)'
        },
        {
            name: 'username',
            label: 'Username',
            type: 'string',
            required: false,
            description: 'Username for basic auth — {{variable}} interpolation supported'
        },
        {
            name: 'password',
            label: 'Password',
            type: 'string',
            required: false,
            description: 'Password for basic auth — {{variable}} interpolation supported'
        },
        {
            name: 'bearerToken',
            label: 'Bearer Token',
            type: 'string',
            required: false,
            description: 'Token for bearer auth — {{variable}} interpolation supported'
        },
        {
            name: 'timeout',
            label: 'Timeout (seconds)',
            type: 'number',
            required: false,
            defaultValue: 30,
            description: 'Request timeout in seconds'
        }
    ],
    async execute(config, context, _inputDataset) {
        validateConfig(config, ['url', 'body'], 'SOAP Request');
        const axios = require('axios');

        const url = String(config.url).trim();
        const timeoutSec = parseInt(config.timeout, 10) > 0 ? parseInt(config.timeout, 10) : 30;
        const soapVersion = String(config.soapVersion || 'soap11').trim().toLowerCase() === 'soap12' ? 'soap12' : 'soap11';
        const soapAction = config.soapAction ? String(config.soapAction).trim() : '';

        const envelope = buildSoapEnvelope(config);

        const headers = soapVersion === 'soap12'
            ? { 'Content-Type': `application/soap+xml; charset=utf-8${soapAction ? `; action="${soapAction}"` : ''}` }
            : { 'Content-Type': 'text/xml; charset=utf-8' };
        if (soapVersion === 'soap11' && soapAction) headers['SOAPAction'] = soapAction;

        const authType = String(config.authType || 'none').trim().toLowerCase();
        if (authType === 'basic') {
            const username = String(config.username || '');
            const password = String(config.password || '');
            headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
        } else if (authType === 'bearer') {
            headers.Authorization = `Bearer ${String(config.bearerToken || '')}`;
        }

        let response;
        try {
            response = await axios({
                method: 'POST',
                url,
                headers,
                data: envelope,
                timeout: timeoutSec * 1000,
                maxRedirects: 5,
                validateStatus: (status) => status >= 200 && status < 400,
                responseType: 'text'
            });
        } catch (err) {
            if (err && err.response) {
                throw new Error(`SOAP Request: POST ${url} failed with status ${err.response.status} — ${err.message}`);
            }
            throw new Error(`SOAP Request: POST ${url} failed — ${(err && err.message) || err}`);
        }

        const responseText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || '');
        const rows = [{ soapStatus: response.status, soapResponse: responseText }];
        const columns = ['soapStatus', 'soapResponse'];

        if (context && context.setActivityStats) {
            context.setActivityStats({
                soapStatus: response.status,
                soapVersion,
                responseLength: responseText.length,
                url
            });
        }

        if (context && typeof context.setVariable === 'function') {
            context.setVariable('soapRequest', {
                status: response.status,
                statusText: response.statusText,
                url,
                soapAction
            });
        }

        return new Dataset(rows, columns);
    }
});

module.exports = httpActivities;

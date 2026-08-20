/**
 * engine/workflow/workflowEngine.js
 *
 * Workflow execution engine for VizFlow.
 */

'use strict';

const { getActivity, getActivityExecutor } = require('./activityRegistryCore');
const templateService = require('../../services/templateService');

// ─── Constants ──────────────────────────────────────────────────────────────
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes default timeout

// ─── Cancellation helpers ───────────────────────────────────────────────────

/**
 * Return a human-readable reason from an aborted signal, or null if not aborted.
 * @param {AbortSignal|null} [signal]
 * @returns {string|null}
 */
function getAbortReason(signal) {
    if (!signal || !signal.aborted) return null;
    if (signal.reason && signal.reason.message) return signal.reason.message;
    return 'Workflow cancelled';
}

/**
 * Throw an AbortError when the signal has been aborted.
 * @param {AbortSignal|null} [signal]
 * @throws {Error}
 */
function throwIfAborted(signal) {
    if (signal && signal.aborted) {
        const err = new Error(getAbortReason(signal));
        err.name = 'AbortError';
        throw err;
    }
}

/**
 * Build a promise that rejects as soon as the signal is aborted.
 * @param {AbortSignal|null} [signal]
 * @returns {Promise<never>}
 */
function abortPromise(signal) {
    return new Promise((_, reject) => {
        const fail = () => {
            const err = new Error(getAbortReason(signal));
            err.name = 'AbortError';
            reject(err);
        };
        if (signal && signal.aborted) {
            fail();
        } else if (signal) {
            signal.addEventListener('abort', fail, { once: true });
        }
    });
}

function isAbortError(error) {
    return error && (error.name === 'AbortError' || (error.message && error.message.includes('cancel')));
}

/**
 * Validate nested steps recursively
 * @param {Array} steps - Array of step definitions
 * @param {string} parentId - Parent activity ID for error context
 * @param {Set} visitedRefs - Set of step objects seen in the current ancestry chain
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateNestedSteps(steps, parentId = 'workflow', visitedRefs = new Set()) {
    if (!Array.isArray(steps)) {
        return { valid: false, error: `Activity "${parentId}" has an invalid nested step list` };
    }

    const scopeIds = new Set();

    for (const step of steps) {
        if (!step || typeof step !== 'object') {
            return { valid: false, error: `Activity "${parentId}" contains an invalid nested step entry` };
        }

        // Circular reference detection by object identity: the same step
        // object must never appear twice within one ancestry chain
        if (visitedRefs.has(step)) {
            return { valid: false, error: `Circular reference detected in nested activity "${step.id || 'unknown'}"` };
        }
        visitedRefs.add(step);

        const stepId = step.id || 'unknown';

        // Duplicate IDs within the same scope break per-step state tracking
        if (scopeIds.has(stepId)) {
            return { valid: false, error: `Duplicate nested activity ID "${stepId}" in "${parentId}"` };
        }
        scopeIds.add(stepId);

        if (!step.type) {
            return { valid: false, error: `Nested activity "${stepId}" is missing "type"` };
        }

        const actDef = getActivity(step.type, true); // Pass true to include execute
        if (!actDef) {
            return { valid: false, error: `Unknown nested activity type: "${step.type}" in "${stepId}"` };
        }

        // Validate config object
        if (!step.config || typeof step.config !== 'object' || Array.isArray(step.config)) {
            return { valid: false, error: `Nested activity "${stepId}" has an invalid config object` };
        }

        const config = step.config;
        const configReqs = actDef.configRequirements || [];
        
        for (const req of configReqs) {
            if (req.required) {
                const value = config[req.name];
                // Check for undefined, null, or empty string (but allow false, 0, etc.)
                if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
                    return { valid: false, error: `Nested activity "${stepId}" is missing required config: "${req.name}"` };
                }
            }
        }

        // Recursively validate nested control structures. Each branch gets a
        // copy of the ancestry so sibling branches may reuse step objects
        // without being mistaken for cycles.
        if (step.type === 'ifElse') {
            const thenResult = validateNestedSteps(
                config.thenSteps || [], 
                `${stepId}:then`, 
                new Set(visitedRefs)
            );
            if (!thenResult.valid) return thenResult;
            
            const elseResult = validateNestedSteps(
                config.elseSteps || [], 
                `${stepId}:else`, 
                new Set(visitedRefs)
            );
            if (!elseResult.valid) return elseResult;
        }

        if (step.type === 'forEach') {
            const loopResult = validateNestedSteps(
                config.steps || [], 
                `${stepId}:loop`, 
                new Set(visitedRefs)
            );
            if (!loopResult.valid) return loopResult;
        }

        if (step.type === 'forEachFile') {
            const loopResult = validateNestedSteps(
                config.steps || [], 
                `${stepId}:loop`, 
                new Set(visitedRefs)
            );
            if (!loopResult.valid) return loopResult;
        }
    }

    return { valid: true, error: null };
}

/**
 * Coerce a parameter value to its declared type.
 * @param {*} value
 * @param {string} [type]
 * @returns {*}
 */
function coerceParameter(value, type) {
    if (value === undefined || value === null) return value;
    switch (String(type || '').toLowerCase()) {
        case 'number': {
            const n = Number(value);
            return Number.isNaN(n) ? value : n;
        }
        case 'boolean':
            return value === true || value === 'true' || value === 1 || value === '1';
        case 'array':
            return Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
        case 'object':
            if (typeof value === 'string') {
                try { return JSON.parse(value); } catch (e) { return value; }
            }
            return value;
        default:
            return value;
    }
}

/**
 * Resolve workflow-level parameters against initial variables.
 * - Applies declared defaults (with {{variable}} interpolation and type coercion)
 * - Validates that required parameters were provided
 * @param {Object} workflowDef
 * @param {Object} context - Execution context with variables
 * @returns {string|null} Error message or null when valid
 */
function resolveParameters(workflowDef, context) {
    const declared = workflowDef.parameters;
    if (!declared) return null;

    if (!Array.isArray(declared)) {
        return 'Workflow "parameters" must be an array';
    }

    for (const p of declared) {
        if (!p || typeof p !== 'object' || !p.name || typeof p.name !== 'string') {
            return 'Workflow "parameters" contains an invalid entry (missing "name")';
        }
        const name = p.name;
        const missing = (value) =>
            value === undefined || value === null ||
            (typeof value === 'string' && value.trim() === '');

        let resolved;
        if (!missing(context.variables[name])) {
            resolved = coerceParameter(context.variables[name], p.type);
        } else if (!missing(p.defaultValue)) {
            let val = p.defaultValue;
            if (typeof val === 'string') {
                val = templateService.interpolate(val, context.variables, {});
            }
            resolved = coerceParameter(val, p.type);
        } else {
            resolved = undefined;
        }

        if (missing(resolved)) {
            if (p.required) {
                return `Missing required parameter "${name}" for workflow "${workflowDef.name || 'unnamed'}"`;
            }
            continue;
        }

        context.variables[name] = resolved;
    }

    return null;
}

/**
 * Validate a complete workflow definition
 * @param {Object} workflowDef - Workflow definition
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateWorkflow(workflowDef) {
    if (!workflowDef) {
        return { valid: false, error: 'Workflow definition is required' };
    }
    
    if (!workflowDef.activities || !Array.isArray(workflowDef.activities)) {
        return { valid: false, error: 'Workflow must have an "activities" array' };
    }
    
    if (workflowDef.activities.length === 0) {
        return { valid: false, error: 'Workflow must have at least one activity' };
    }

    // Validate workflow-level parameters
    if (workflowDef.parameters !== undefined && workflowDef.parameters !== null) {
        if (!Array.isArray(workflowDef.parameters)) {
            return { valid: false, error: 'Workflow "parameters" must be an array' };
        }
        const paramNames = new Set();
        for (const p of workflowDef.parameters) {
            if (!p || typeof p !== 'object') {
                return { valid: false, error: 'Workflow "parameters" contains an invalid entry' };
            }
            if (!p.name || typeof p.name !== 'string' || !p.name.trim()) {
                return { valid: false, error: 'Workflow "parameters" entries must have a non-empty "name"' };
            }
            if (paramNames.has(p.name)) {
                return { valid: false, error: `Duplicate workflow parameter name: "${p.name}"` };
            }
            paramNames.add(p.name);
        }
    }

    // Check for duplicate activity IDs
    const activityIds = new Set();
    const duplicateIds = [];

    // Seed cycle detection with the top-level activities so nested structures
    // cannot reference them and create a cycle
    const visitedRefs = new Set(workflowDef.activities);

    // Check each activity
    for (let i = 0; i < workflowDef.activities.length; i++) {
        const activity = workflowDef.activities[i];
        
        if (!activity || typeof activity !== 'object') {
            return { valid: false, error: `Workflow contains an invalid activity entry at index ${i}` };
        }

        const activityId = activity.id || `activity_${i + 1}`;
        
        // Check for duplicate IDs
        if (activityIds.has(activityId)) {
            duplicateIds.push(activityId);
        }
        activityIds.add(activityId);

        if (!activity.type) {
            return { valid: false, error: `Activity "${activityId}" is missing "type"` };
        }

        const actDef = getActivity(activity.type, true); // Pass true to include execute
        if (!actDef) {
            return { valid: false, error: `Unknown activity type: "${activity.type}" in "${activityId}"` };
        }

        // Validate config object
        if (!activity.config || typeof activity.config !== 'object' || Array.isArray(activity.config)) {
            return { valid: false, error: `Activity "${activityId}" has an invalid config object` };
        }

        const config = activity.config;
        const configReqs = actDef.configRequirements || [];
        
        for (const req of configReqs) {
            if (req.required) {
                const value = config[req.name];
                if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
                    return { valid: false, error: `Activity "${activityId}" is missing required config: "${req.name}"` };
                }
            }
        }

        // Recursively validate nested control structures
        if (activity.type === 'ifElse') {
            const thenResult = validateNestedSteps(
                config.thenSteps || [], 
                `${activityId}:then`,
                new Set(visitedRefs)
            );
            if (!thenResult.valid) return thenResult;
            
            const elseResult = validateNestedSteps(
                config.elseSteps || [], 
                `${activityId}:else`,
                new Set(visitedRefs)
            );
            if (!elseResult.valid) return elseResult;
        }

        if (activity.type === 'forEach') {
            const loopResult = validateNestedSteps(
                config.steps || [], 
                `${activityId}:loop`,
                new Set(visitedRefs)
            );
            if (!loopResult.valid) return loopResult;
        }

        if (activity.type === 'forEachFile') {
            const loopResult = validateNestedSteps(
                config.steps || [], 
                `${activityId}:loop`,
                new Set(visitedRefs)
            );
            if (!loopResult.valid) return loopResult;
        }
    }

    if (duplicateIds.length > 0) {
        return { 
            valid: false, 
            error: `Duplicate activity IDs found: ${duplicateIds.join(', ')}` 
        };
    }

    return { valid: true, error: null };
}

/**
 * Execute a single activity with timeout and retry support
 * @param {Object} activity - Activity definition from workflow
 * @param {Object} context - Execution context
 * @param {Dataset} inputDataset - Input dataset
 * @param {Object} engineOptions - Options for engine
 * @param {number} retryCount - Current retry attempt
 * @returns {Promise<{ success: boolean, dataset?: Dataset, error?: string }>}
 */
async function executeActivity(activity, context, inputDataset, engineOptions = {}, retryCount = 0) {
    // Get the full activity with execute function
    const actDef = getActivity(activity.type, true);
    
    if (!actDef) {
        return { success: false, error: `Unknown activity type: "${activity.type}"` };
    }

    // Make sure execute function exists
    if (typeof actDef.execute !== 'function') {
        return { 
            success: false, 
            error: `Activity "${activity.type}" has no execute function. Available keys: ${Object.keys(actDef).join(', ')}` 
        };
    }

    const maxRetries = engineOptions.maxRetries || DEFAULT_MAX_RETRIES;
    const timeoutMs = engineOptions.timeoutMs || DEFAULT_TIMEOUT_MS;
    const signal = engineOptions.signal || null;

    try {
        throwIfAborted(signal);

        // Interpolate {{variable}} placeholders in top-level string config values so
        // workflow parameters can flow into any activity config. Nested arrays (e.g.
        // forEach steps, multiTransform actions) are left untouched — control activities
        // perform their own per-row/per-file substitution on those. setVariable is
        // excluded because it interpolates expressions itself with JS-eval quoting.
        const config = {};
        const rawConfig = activity.config || {};
        const interpolateConfig = context && typeof context.interpolate === 'function';
        if (activity.type === 'setVariable' || !interpolateConfig) {
            Object.assign(config, rawConfig);
        } else {
            for (const [key, value] of Object.entries(rawConfig)) {
                config[key] = typeof value === 'string' ? context.interpolate(value) : value;
            }
        }

        // Create a promise with timeout
        const executePromise = actDef.execute(config, context, inputDataset, engineOptions);

        let result;
        const races = [executePromise];
        if (signal) races.push(abortPromise(signal));
        if (timeoutMs > 0) {
            races.push(new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Activity "${activity.id || activity.type}" timed out after ${timeoutMs}ms`)), timeoutMs);
            }));
        }
        result = await Promise.race(races);

        throwIfAborted(signal);
        return { success: true, dataset: result };
    } catch (error) {
        const errorMessage = error.message || String(error);

        // Never retry cancelled / aborted activities
        if (isAbortError(error) || (signal && signal.aborted)) {
            return { success: false, error: getAbortReason(signal) || errorMessage };
        }

        // Retry logic if applicable
        if (retryCount < maxRetries && engineOptions.shouldRetry !== false) {
            const delay = engineOptions.retryDelay || 1000 * Math.pow(2, retryCount); // Exponential backoff
            console.warn(`[VizFlow] Retrying activity "${activity.id || activity.type}" (attempt ${retryCount + 1}/${maxRetries}) after ${delay}ms`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return executeActivity(activity, context, inputDataset, engineOptions, retryCount + 1);
        }
        
        return { success: false, error: errorMessage };
    }
}

/**
 * Execute a sequence of steps (used by control activities)
 * @param {Array} steps - Array of step definitions
 * @param {Object} context - Execution context
 * @param {Dataset} inputDataset - Input dataset
 * @param {Object} results - Results object to store step results
 * @param {Object} engineOptions - Engine options
 * @returns {Promise<{ success: boolean, dataset?: Dataset, error?: string }>}
 */
async function executeSteps(steps, context, inputDataset, results, engineOptions = {}) {
    let currentDataset = inputDataset;
    const signal = engineOptions.signal || null;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepId = step.id || `step_${i + 1}`;

        try {
            throwIfAborted(signal);
            const result = await executeActivity(step, context, currentDataset, engineOptions);
            
            if (!result.success) {
                return { success: false, error: result.error };
            }
            
            currentDataset = result.dataset;
            
            if (results) {
                results[stepId] = {
                    dataset: currentDataset,
                    success: true,
                    timestamp: new Date().toISOString()
                };
            }
        } catch (error) {
            return { 
                success: false, 
                error: `Step "${stepId}" failed: ${error.message || String(error)}` 
            };
        }
    }

    return { success: true, dataset: currentDataset };
}

/**
 * Execute a complete workflow
 * @param {Object} workflowDef - Workflow definition
 * @param {Object} options - Execution options
 * @param {Function} options.onStateChange - Callback for state changes
 * @param {Function} options.resolvePath - Path resolution function
 * @param {Object} options.initialVariables - Initial variables for workflow
 * @param {number} options.maxRetries - Maximum retry attempts per activity
 * @param {number} options.timeoutMs - Timeout per activity in milliseconds
 * @param {boolean} options.stopOnError - Stop execution on first error (default: true)
 * @param {AbortSignal} [options.signal] - Abort signal to cancel the run
 * @param {number} [options.workflowTimeoutMs] - Overall workflow timeout in ms (0 = none)
 * @param {Array<string>} [options.workflowStack] - Stack of sub-workflow paths (cycle guard for callWorkflow)
 * @returns {Promise<{ success: boolean, results?: Object, error?: string, variables?: Object }>}
 */
async function executeWorkflow(workflowDef, options = {}) {
    const { 
        onStateChange, 
        resolvePath, 
        initialVariables = {},
        maxRetries = DEFAULT_MAX_RETRIES,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        stopOnError = true,
        signal = null,
        workflowTimeoutMs = 0
    } = options;
    
    const results = {};
    const startTime = Date.now();
    const isTimedOut = () => workflowTimeoutMs > 0 && (Date.now() - startTime) > workflowTimeoutMs;

    // ─── Build context ──────────────────────────────────────────────────────
    const context = {
        resolvePath: resolvePath || ((p) => p),
        setActivityStats: (stats) => {
            if (!context.activityStats) context.activityStats = {};
            Object.assign(context.activityStats, stats);
        },
        getActivityStats: () => context.activityStats || {},
        
        // ─── Variable support ───────────────────────────────────────────────
        variables: { ...initialVariables },
        setVariable: (name, value) => {
            if (name && typeof name === 'string') {
                context.variables[name] = value;
            }
        },
        getVariable: (name) => {
            return context.variables[name];
        },
        hasVariable: (name) => {
            return name in context.variables;
        },
        // ─── Variable interpolation helper ─────────────────────────────────
        interpolate: (template, row = null) => {
            return templateService.interpolate(template, context.variables, { row });
        }
    };

    // Validate workflow before execution
    const validation = validateWorkflow(workflowDef);
    if (!validation.valid) {
        return { 
            success: false, 
            error: validation.error, 
            results: {},
            variables: context.variables 
        };
    }

    // Resolve workflow-level parameters (defaults, required checks, coercion)
    const paramError = resolveParameters(workflowDef, context);
    if (paramError) {
        return {
            success: false,
            error: paramError,
            results: {},
            variables: context.variables
        };
    }

    // ─── Emit Pending state for all activities before execution starts ──────
    const total = workflowDef.activities.length;
    for (let i = 0; i < total; i++) {
        const activity = workflowDef.activities[i];
        const activityId = activity.id || `activity_${i + 1}`;
        if (onStateChange) {
            onStateChange(activityId, 'Pending', {}, null);
        }
    }

    const engineOptions = {
        maxRetries,
        timeoutMs,
        shouldRetry: true,
        signal,
        workflowStack: options.workflowStack || null,
        onStateChange: onStateChange || null
    };

    // ─── Resolve execution order from edges (topological sort) ─────────────
    const edges = workflowDef.edges;
    const hasEdges = Array.isArray(edges) && edges.length > 0;

    // Build a map from nodeId → activity definition
    const activityMap = new Map();
    for (let i = 0; i < total; i++) {
        const a = workflowDef.activities[i];
        const aId = a.id || `activity_${i + 1}`;
        activityMap.set(aId, a);
    }

    let executionOrder;
    if (hasEdges) {
        // Topological sort using Kahn's algorithm
        const inDegree = new Map();
        const adj = new Map(); // parent → [children]
        for (const id of activityMap.keys()) {
            inDegree.set(id, 0);
            adj.set(id, []);
        }
        for (const edge of edges) {
            const src = edge.source.nodeId;
            const tgt = edge.target.nodeId;
            if (activityMap.has(src) && activityMap.has(tgt)) {
                adj.get(src).push(tgt);
                inDegree.set(tgt, (inDegree.get(tgt) || 0) + 1);
            }
        }
        const queue = [];
        for (const [id, deg] of inDegree) {
            if (deg === 0) queue.push(id);
        }
        executionOrder = [];
        while (queue.length > 0) {
            const id = queue.shift();
            executionOrder.push(id);
            for (const child of adj.get(id)) {
                inDegree.set(child, inDegree.get(child) - 1);
                if (inDegree.get(child) === 0) queue.push(child);
            }
        }
        // If topological sort didn't cover all nodes (disconnected), append remaining
        if (executionOrder.length < total) {
            for (const id of activityMap.keys()) {
                if (!executionOrder.includes(id)) executionOrder.push(id);
            }
        }
    } else {
        // No edges — fall back to array order (backward compatible)
        executionOrder = [];
        for (let i = 0; i < total; i++) {
            const a = workflowDef.activities[i];
            executionOrder.push(a.id || `activity_${i + 1}`);
        }
    }

    // Build parent map: each node → its parent (the node whose output feeds into it)
    const parentOf = new Map();
    if (hasEdges) {
        // For each node, find the edge whose target is this node.
        // If multiple edges target the same node, use the first one found
        // (the engine passes one dataset per activity).
        for (const edge of edges) {
            const tgt = edge.target.nodeId;
            if (!parentOf.has(tgt)) {
                parentOf.set(tgt, edge.source.nodeId);
            }
        }
    } else {
        // Sequential: each node's parent is the previous node in array order
        for (let i = 1; i < total; i++) {
            const prevId = workflowDef.activities[i - 1].id || `activity_${i}`;
            const curId = workflowDef.activities[i].id || `activity_${i + 1}`;
            parentOf.set(curId, prevId);
        }
    }

    // Store results keyed by activity ID (dataset output of each activity)
    const datasetResults = new Map();

    // Mark a set of activity IDs as Failed
    function markIdsFailed(ids, reason) {
        if (!onStateChange) return;
        for (const id of ids) {
            onStateChange(id, 'Failed', {}, reason);
        }
    }

    // ─── Execute each activity in topological order ────────────────────────
    let failedActivities = [];
    const executedIds = new Set();

    for (const activityId of executionOrder) {
        const activity = activityMap.get(activityId);
        if (!activity) continue;

        // Cancellation / overall timeout take priority between activities
        if (getAbortReason(signal)) {
            const reason = getAbortReason(signal);
            // Mark all remaining unexecuted activities as Failed
            const remaining = executionOrder.filter(id => !executedIds.has(id));
            markIdsFailed(remaining, reason);
            return { success: false, error: reason, results, variables: context.variables };
        }
        if (isTimedOut()) {
            const reason = `Workflow timed out after ${workflowTimeoutMs}ms`;
            const remaining = executionOrder.filter(id => !executedIds.has(id));
            markIdsFailed(remaining, reason);
            return { success: false, error: reason, results, variables: context.variables };
        }

        // Determine input dataset: use the parent's output dataset
        const parentId = parentOf.get(activityId);
        const inputDataset = parentId ? (datasetResults.get(parentId) || null) : null;

        try {
            // Reset per-activity stats so prior activity stats don't bleed through
            context.activityStats = {};

            // Update state: Running
            if (onStateChange) {
                onStateChange(activityId, 'Running', {}, null);
            }

            // Execute the activity
            const actStartTime = Date.now();
            const result = await executeActivity(activity, context, inputDataset, engineOptions);
            const executionTime = Date.now() - actStartTime;
            
            executedIds.add(activityId);

            if (!result.success) {
                failedActivities.push(activityId);
                if (onStateChange) {
                    onStateChange(activityId, 'Failed', { executionTime }, result.error);
                }

                // If execution was cancelled/timed out mid-activity, stop cleanly
                if (getAbortReason(signal)) {
                    const reason = getAbortReason(signal);
                    const remaining = executionOrder.filter(id => !executedIds.has(id));
                    markIdsFailed(remaining, reason);
                    return { success: false, error: reason, results, variables: context.variables };
                }
                if (isTimedOut()) {
                    const reason = `Workflow timed out after ${workflowTimeoutMs}ms`;
                    const remaining = executionOrder.filter(id => !executedIds.has(id));
                    markIdsFailed(remaining, reason);
                    return { success: false, error: reason, results, variables: context.variables };
                }
                
                if (stopOnError) {
                    return { 
                        success: false, 
                        error: `Activity "${activityId}" failed: ${result.error}`,
                        results,
                        variables: context.variables
                    };
                }
                
                // Continue despite error if stopOnError is false
                continue;
            }

            // Store the output dataset for this activity (used by downstream children)
            datasetResults.set(activityId, result.dataset);
            results[activityId] = {
                success: true,
                dataset: result.dataset,
                executionTime,
                timestamp: new Date().toISOString()
            };

            // Update state: Completed
            const stats = context.getActivityStats();
            stats.executionTime = executionTime;
            // Include a preview of the dataset for the webview data preview feature
            if (result.dataset && typeof result.dataset.getRowCount === 'function') {
                const previewRows = Math.min(50, result.dataset.getRowCount());
                stats.preview = {
                    columns: result.dataset.getColumns(),
                    rowCount: result.dataset.getRowCount(),
                    rows: result.dataset.rows.slice(0, previewRows)
                };
            }
            if (onStateChange) {
                onStateChange(activityId, 'Completed', stats, null);
            }

        } catch (error) {
            const errorMsg = error.message || String(error);
            failedActivities.push(activityId);
            executedIds.add(activityId);
            
            if (onStateChange) {
                onStateChange(activityId, 'Failed', {}, errorMsg);
            }
            
            if (stopOnError) {
                return { 
                    success: false, 
                    error: `Activity "${activityId}" threw error: ${errorMsg}`,
                    results,
                    variables: context.variables
                };
            }
        }
    }

    // Return result with summary
    const success = failedActivities.length === 0;
    return { 
        success, 
        results,
        error: success ? null : `${failedActivities.length} activity(s) failed: ${failedActivities.join(', ')}`,
        variables: context.variables
    };
}

module.exports = {
    validateWorkflow,
    executeActivity,
    executeSteps,
    executeWorkflow
};
/**
 * engine/workflow/workflowEngine.js
 *
 * Workflow execution engine for VizFlow.
 */

'use strict';

const { getActivity, getActivityExecutor } = require('./activityRegistryCore');

// ─── Constants ──────────────────────────────────────────────────────────────
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes default timeout

/**
 * Validate nested steps recursively
 * @param {Array} steps - Array of step definitions
 * @param {string} parentId - Parent activity ID for error context
 * @param {Set} visitedIds - Track visited IDs to detect circular references
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateNestedSteps(steps, parentId = 'workflow', visitedIds = new Set()) {
    if (!Array.isArray(steps)) {
        return { valid: false, error: `Activity "${parentId}" has an invalid nested step list` };
    }

    for (const step of steps) {
        if (!step || typeof step !== 'object') {
            return { valid: false, error: `Activity "${parentId}" contains an invalid nested step entry` };
        }

        const stepId = step.id || 'unknown';
        
        // Check for circular references
        const idKey = `${parentId}:${stepId}`;
        if (visitedIds.has(idKey)) {
            return { valid: false, error: `Circular reference detected in nested activity "${stepId}"` };
        }
        visitedIds.add(idKey);

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

        // Recursively validate nested control structures
        if (step.type === 'ifElse') {
            const thenResult = validateNestedSteps(
                config.thenSteps || [], 
                `${stepId}:then`, 
                visitedIds
            );
            if (!thenResult.valid) return thenResult;
            
            const elseResult = validateNestedSteps(
                config.elseSteps || [], 
                `${stepId}:else`, 
                visitedIds
            );
            if (!elseResult.valid) return elseResult;
        }

        if (step.type === 'forEach') {
            const loopResult = validateNestedSteps(
                config.steps || [], 
                `${stepId}:loop`, 
                visitedIds
            );
            if (!loopResult.valid) return loopResult;
        }

        // Remove from visited set after validation (allow reuse in different branches)
        visitedIds.delete(idKey);
    }

    return { valid: true, error: null };
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

    // Check for duplicate activity IDs
    const activityIds = new Set();
    const duplicateIds = [];

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
                `${activityId}:then`
            );
            if (!thenResult.valid) return thenResult;
            
            const elseResult = validateNestedSteps(
                config.elseSteps || [], 
                `${activityId}:else`
            );
            if (!elseResult.valid) return elseResult;
        }

        if (activity.type === 'forEach') {
            const loopResult = validateNestedSteps(
                config.steps || [], 
                `${activityId}:loop`
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

    try {
        // Create a promise with timeout
        const executePromise = actDef.execute(activity.config, context, inputDataset, engineOptions);
        
        let result;
        if (timeoutMs > 0) {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Activity "${activity.id || activity.type}" timed out after ${timeoutMs}ms`)), timeoutMs);
            });
            result = await Promise.race([executePromise, timeoutPromise]);
        } else {
            result = await executePromise;
        }
        
        return { success: true, dataset: result };
    } catch (error) {
        const errorMessage = error.message || String(error);
        
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

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepId = step.id || `step_${i + 1}`;

        try {
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
 * @returns {Promise<{ success: boolean, results?: Object, error?: string, variables?: Object }>}
 */
async function executeWorkflow(workflowDef, options = {}) {
    const { 
        onStateChange, 
        resolvePath, 
        initialVariables = {},
        maxRetries = DEFAULT_MAX_RETRIES,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        stopOnError = true
    } = options;
    
    const results = {};
    let currentDataset = null;

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
        interpolate: (template) => {
            if (typeof template !== 'string') return template;
            return template.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
                const value = context.getVariable(varName.trim());
                return value !== undefined ? String(value) : match;
            });
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
        shouldRetry: true
    };

    // ─── Execute each activity ─────────────────────────────────────────────
    let failedActivities = [];

    for (let i = 0; i < total; i++) {
        const activity = workflowDef.activities[i];
        const activityId = activity.id || `activity_${i + 1}`;

        try {
            // Reset per-activity stats so prior activity stats don't bleed through
            context.activityStats = {};

            // Update state: Running
            if (onStateChange) {
                onStateChange(activityId, 'Running', {}, null);
            }

            // Execute the activity
            const startTime = Date.now();
            const result = await executeActivity(activity, context, currentDataset, engineOptions);
            const executionTime = Date.now() - startTime;
            
            if (!result.success) {
                failedActivities.push(activityId);
                if (onStateChange) {
                    onStateChange(activityId, 'Failed', { executionTime }, result.error);
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

            // Store result
            currentDataset = result.dataset;
            results[activityId] = {
                success: true,
                dataset: currentDataset,
                executionTime,
                timestamp: new Date().toISOString()
            };

            // Update state: Completed
            const stats = context.getActivityStats();
            stats.executionTime = executionTime;
            if (onStateChange) {
                onStateChange(activityId, 'Completed', stats, null);
            }

        } catch (error) {
            const errorMsg = error.message || String(error);
            failedActivities.push(activityId);
            
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
/**
 * engine/workflow/activityRegistry.js
 *
 * Workflow Activity Registry for VizFlow.
 * Acts as the single source of truth for available activities.
 */

'use strict';

const { 
    registerActivity, 
    getActivities, 
    getActivity, 
    getActivityExecutor,
    hasActivity,
    getActivitiesByCategory,
    getCategories,
    searchActivities,
    getActivityCount,
    getActivityStats,
    VALID_CATEGORIES
} = require('./activityRegistryCore');

// ─── Import all activities from index.js ─────────────────────────────────────
let inputActivities = [];
let transformationActivities = [];
let queryActivities = [];
let analyticsActivities = [];
let outputActivities = [];
let controlActivities = [];
let powerShellActivities = [];
let databaseActivities = [];
let httpActivities = [];

try {
    const activityModules = require('./activities');
    inputActivities = activityModules.inputActivities || [];
    transformationActivities = activityModules.transformationActivities || [];
    queryActivities = activityModules.queryActivities || [];
    analyticsActivities = activityModules.analyticsActivities || [];
    outputActivities = activityModules.outputActivities || [];
    controlActivities = activityModules.controlActivities || [];
    powerShellActivities = activityModules.powerShellActivities || [];
    databaseActivities = activityModules.databaseActivities || [];
    httpActivities = activityModules.httpActivities || [];
} catch (error) {
    console.error('[VizFlow] Failed to load activity modules:', error.message);
    // Continue with empty arrays to allow partial functionality
}

// ─── Registration Tracking ──────────────────────────────────────────────────
let registrationAttempted = false;
let registrationSuccess = false;
let registrationErrors = [];

/**
 * Register all activities with error handling
 * @param {Object} options - Registration options
 * @param {boolean} options.silent - Suppress console logs
 * @param {boolean} options.continueOnError - Continue registration even if some activities fail
 * @returns {{ registered: number, errors: Array, skipped: number }}
 */
function registerAllActivities(options = {}) {
    const { silent = false, continueOnError = true } = options;
    
    if (registrationAttempted && !silent) {
        console.warn('[VizFlow] Activities already registered. Skipping duplicate registration.');
        return {
            registered: getActivityCount(),
            errors: registrationErrors,
            skipped: 0
        };
    }

    registrationAttempted = true;
    registrationErrors = [];
    let registered = 0;
    let skipped = 0;

    // Collect all activities from categories
    const allActivities = [
        ...inputActivities,
        ...transformationActivities,
        ...queryActivities,
        ...analyticsActivities,
        ...outputActivities,
        ...controlActivities,
        ...powerShellActivities,
        ...databaseActivities,
        ...httpActivities
    ];

    // Validate activity structure before registration
    const validActivities = allActivities.filter((activity, index) => {
        if (!activity || typeof activity !== 'object') {
            const error = `Activity at index ${index} is invalid (not an object)`;
            registrationErrors.push(error);
            if (!silent) console.warn(`[VizFlow] ${error}`);
            return false;
        }
        
        if (!activity.type || typeof activity.type !== 'string') {
            const error = `Activity at index ${index} is missing "type" or type is not a string`;
            registrationErrors.push(error);
            if (!silent) console.warn(`[VizFlow] ${error}`);
            return false;
        }
        
        if (!activity.execute || typeof activity.execute !== 'function') {
            const error = `Activity "${activity.type || 'unknown'}" is missing "execute" function`;
            registrationErrors.push(error);
            if (!silent) console.warn(`[VizFlow] ${error}`);
            return false;
        }
        
        return true;
    });

    // Check for duplicate types
    const typeSet = new Set();
    const duplicates = [];
    
    for (const activity of validActivities) {
        if (typeSet.has(activity.type)) {
            duplicates.push(activity.type);
        } else {
            typeSet.add(activity.type);
        }
    }
    
    if (duplicates.length > 0) {
        const error = `Duplicate activity types found: ${duplicates.join(', ')}`;
        registrationErrors.push(error);
        if (!silent) console.error(`[VizFlow] ${error}`);
        // Remove duplicates: keep first occurrence
        const uniqueActivities = [];
        const seen = new Set();
        for (const activity of validActivities) {
            if (!seen.has(activity.type)) {
                seen.add(activity.type);
                uniqueActivities.push(activity);
            }
        }
        validActivities.length = 0;
        validActivities.push(...uniqueActivities);
    }

    // Register each valid activity
    for (const activity of validActivities) {
        try {
            registerActivity(activity);
            registered++;
            if (!silent) {
                console.log(`[VizFlow] Registered activity: ${activity.displayName || activity.type}`);
            }
        } catch (error) {
            const errorMsg = `Failed to register activity "${activity.type}": ${error.message}`;
            registrationErrors.push(errorMsg);
            
            if (!silent) {
                console.error(`[VizFlow] ${errorMsg}`);
            }
            
            if (!continueOnError) {
                throw new Error(errorMsg);
            }
            skipped++;
        }
    }

    registrationSuccess = registered > 0;

    // Log summary
    if (!silent) {
        const total = allActivities.length;
        const failed = registrationErrors.length;
        console.log(`[VizFlow] Activity registration complete: ${registered}/${total} registered, ${failed} errors, ${skipped} skipped`);
    }

    return {
        registered,
        errors: registrationErrors,
        skipped,
        success: registrationSuccess
    };
}

// ─── Auto-register on load ───────────────────────────────────────────────────
const registrationResult = registerAllActivities({ silent: false });

// ─── Export enhanced API ────────────────────────────────────────────────────

/**
 * Get all registered activities with optional filtering
 * @param {Object} options - Filter options
 * @param {string} options.category - Filter by category
 * @param {boolean} options.includeExecute - Include execute functions
 * @param {string} options.search - Search query
 * @returns {Object[]} Array of activities
 */
function getActivitiesEnhanced(options = {}) {
    const { category, includeExecute = false, search } = options;
    
    if (search) {
        return searchActivities(search, { includeExecute, category });
    }
    
    if (category) {
        return getActivitiesByCategory(category, includeExecute);
    }
    
    return getActivities({ includeExecute });
}

/**
 * Get activity categories with counts
 * @returns {Object} Object with category names as keys and counts as values
 */
function getActivityCategories() {
    const categories = getCategories();
    const result = {};
    for (const category of categories) {
        result[category] = getActivityCount(category);
    }
    return result;
}

/**
 * Check if registry is ready
 * @returns {boolean} True if registry has activities
 */
function isRegistryReady() {
    return registrationSuccess && getActivityCount() > 0;
}

/**
 * Get registration status
 * @returns {Object} Registration status information
 */
function getRegistrationStatus() {
    return {
        attempted: registrationAttempted,
        success: registrationSuccess,
        errors: registrationErrors,
        count: getActivityCount(),
        categories: getActivityCategories(),
        stats: getActivityStats()
    };
}

/**
 * Get PowerShell activities specifically
 * @param {boolean} includeExecute - Include execute functions
 * @returns {Object[]} Array of PowerShell activities
 */
function getPowerShellActivities(includeExecute = false) {
    return getActivitiesByCategory('powerShell', { includeMetadata: false }).map(activity => {
        if (includeExecute) {
            return activity;
        }
        const { execute, ...rest } = activity;
        return rest;
    });
}

/**
 * Check if PowerShell is available
 * @returns {Promise<boolean>} True if PowerShell is available
 */
async function isPowerShellAvailable() {
    try {
        const PowerShellService = require('../../../services/powerShellService');
        const ps = new PowerShellService();
        return ps.isAvailable();
    } catch (error) {
        return false;
    }
}

// ─── Re-export core functionality ──────────────────────────────────────────
module.exports = {
    // Core functionality
    registerActivity,
    getActivity,
    getActivityExecutor,
    hasActivity,
    
    // Enhanced getters
    getActivities: getActivitiesEnhanced,
    getActivitiesByCategory,
    getCategories,
    getActivityCategories,
    searchActivities,
    
    // Registration management
    registerAllActivities,
    getRegistrationStatus,
    isRegistryReady,
    getActivityCount,
    getActivityStats,
    
    // PowerShell specific
    getPowerShellActivities,
    isPowerShellAvailable,
    
    // Constants
    VALID_CATEGORIES,
    
    // Legacy support (for backward compatibility)
    getActivitiesLegacy: getActivities
};
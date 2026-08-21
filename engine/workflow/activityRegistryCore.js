/**
 * engine/workflow/activityRegistryCore.js
 *
 * Core registry functionality for workflow activities.
 * Manages the central registry of all activities.
 */

'use strict';

// ─── Constants ──────────────────────────────────────────────────────────────
const VALID_CATEGORIES = [
    'Input',
    'Transformation',
    'Query',
    'Analytics',
    'Output',
    'Control',
    'Utility',
    'Integration'
];

// ─── Registry Storage ──────────────────────────────────────────────────────
const ACTIVITIES = {};
const ACTIVITY_INDEX = {
    byCategory: new Map(),
    byName: new Map()
};

// ─── Validation Helpers ────────────────────────────────────────────────────

/**
 * Validate activity configuration requirements
 * @param {Array} configRequirements - Array of config field definitions
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
function validateConfigRequirements(configRequirements) {
    if (!configRequirements) return true;
    if (!Array.isArray(configRequirements)) {
        throw new Error('configRequirements must be an array');
    }

    // Allowed types including special UI types
    const ALLOWED_TYPES = [
        'string', 'number', 'boolean', 'array', 'object', 'select',
        'file', 'multiAction', 'text', 'date', 'time', 'color', 'keyValue',
        'connection', 'columns', 'xmlMapper'
    ];

    const seenNames = new Set();
    for (const req of configRequirements) {
        if (!req || typeof req !== 'object') {
            throw new Error('Each config requirement must be an object');
        }
        
        if (!req.name || typeof req.name !== 'string') {
            throw new Error('Each config requirement must have a "name" string');
        }
        
        if (seenNames.has(req.name)) {
            throw new Error(`Duplicate config requirement name: "${req.name}"`);
        }
        seenNames.add(req.name);

        // Validate type - allow any type for UI flexibility, but warn about unknown ones
        if (req.type) {
            if (!ALLOWED_TYPES.includes(req.type)) {
                console.warn(`[VizFlow] Warning: Unknown config type "${req.type}" for "${req.name}" - treating as string`);
                // Don't throw, just treat as string for backward compatibility
            }
        }

        // Only validate select options if type is 'select' and options are
        // static. Dynamic selects (e.g. database tables/collections) declare a
        // `dynamic` hint and load their options at render time instead.
        if (req.type === 'select' && !req.dynamic) {
            if (!req.options || !Array.isArray(req.options) || req.options.length === 0) {
                throw new Error(`Select field "${req.name}" must have options array with at least one option`);
            }
            
            const optionValues = new Set();
            for (const opt of req.options) {
                // Support both string options and object options
                const optValue = typeof opt === 'string' ? opt : opt.value;
                const optLabel = typeof opt === 'string' ? opt : (opt.label || opt.value);
                
                if (optValue === undefined || optValue === null) {
                    throw new Error(`Option for "${req.name}" must have a "value" property`);
                }
                if (optionValues.has(optValue)) {
                    throw new Error(`Duplicate option value "${optValue}" in "${req.name}"`);
                }
                optionValues.add(optValue);
            }
        }

        // Validate multiAction has operationOptions
        if (req.type === 'multiAction') {
            if (!req.operationOptions || !Array.isArray(req.operationOptions) || req.operationOptions.length === 0) {
                throw new Error(`MultiAction field "${req.name}" must have operationOptions array`);
            }
        }
    }
    return true;
}

/**
 * Validate activity category
 * @param {string} category - Category name
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
function validateCategory(category) {
    if (!category) return true; // Category is optional
    if (typeof category !== 'string') {
        throw new Error('Category must be a string');
    }
    if (!VALID_CATEGORIES.includes(category)) {
        throw new Error(`Invalid category "${category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }
    return true;
}

/**
 * Validate activity object
 * @param {Object} activity - Activity to validate
 * @throws {Error} If validation fails
 */
function validateActivity(activity) {
    if (!activity || typeof activity !== 'object') {
        throw new Error('Activity must be an object');
    }

    if (!activity.type || typeof activity.type !== 'string') {
        throw new Error('Activity must have a "type" string');
    }

    if (!activity.displayName || typeof activity.displayName !== 'string') {
        throw new Error('Activity must have a "displayName" string');
    }

    if (activity.description && typeof activity.description !== 'string') {
        throw new Error('Activity "description" must be a string');
    }

    if (activity.category && !VALID_CATEGORIES.includes(activity.category)) {
        throw new Error(`Invalid category "${activity.category}" for activity "${activity.type}"`);
    }

    if (!activity.execute || typeof activity.execute !== 'function') {
        throw new Error(`Activity "${activity.type}" must have an "execute" function`);
    }

    validateCategory(activity.category);
    validateConfigRequirements(activity.configRequirements);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Register a workflow activity.
 * @param {Object} activity
 * @param {string} activity.type - Unique identifier for the activity
 * @param {string} activity.displayName - Human-readable name
 * @param {string} activity.description - Description of what the activity does
 * @param {string} activity.category - Category (Input, Transformation, Query, Analytics, Output, Control, Utility)
 * @param {Array} activity.configRequirements - Array of configuration field definitions
 * @param {Function} activity.execute - Async function that executes the activity
 * @throws {Error} If activity type is missing or already registered
 */
function registerActivity(activity) {
    try {
        // Validate activity
        validateActivity(activity);

        // Check if already registered
        if (ACTIVITIES[activity.type]) {
            throw new Error(`Activity type "${activity.type}" is already registered`);
        }

        // Deep clone to prevent external mutation
        const registeredActivity = {
            ...activity,
            configRequirements: activity.configRequirements 
                ? JSON.parse(JSON.stringify(activity.configRequirements))
                : []
        };

        // Store the activity
        ACTIVITIES[activity.type] = registeredActivity;

        // Update indexes
        if (activity.category) {
            if (!ACTIVITY_INDEX.byCategory.has(activity.category)) {
                ACTIVITY_INDEX.byCategory.set(activity.category, new Set());
            }
            ACTIVITY_INDEX.byCategory.get(activity.category).add(activity.type);
        }

        if (activity.displayName) {
            ACTIVITY_INDEX.byName.set(activity.displayName.toLowerCase(), activity.type);
        }
        
        return true;
    } catch (error) {
        // Re-throw with context
        throw new Error(`Failed to register "${activity.type}": ${error.message}`);
    }
}

/**
 * Get all registered activities.
 * @param {Object} options - Filter options
 * @param {string} options.category - Filter by category
 * @param {boolean} options.includeExecute - Include execute functions (default: false)
 * @returns {Object[]} Array of activity metadata objects
 */
function getActivities(options = {}) {
    const { category, includeExecute = false } = options;
    
    let activityTypes;
    if (category) {
        const types = ACTIVITY_INDEX.byCategory.get(category);
        activityTypes = types ? Array.from(types) : [];
    } else {
        activityTypes = Object.keys(ACTIVITIES);
    }

    return activityTypes.map(type => {
        const act = ACTIVITIES[type];
        const result = {
            type: act.type,
            displayName: act.displayName,
            description: act.description || '',
            category: act.category || 'Utility',
            configRequirements: act.configRequirements || []
        };
        
        if (includeExecute) {
            result.execute = act.execute;
        }
        
        return result;
    });
}

/**
 * Get a specific registered activity by type.
 * @param {string} type - Activity type identifier
 * @param {boolean} includeExecute - Include execute function (default: false)
 * @returns {Object|null} Full activity object or null if not found
 */
function getActivity(type, includeExecute = false) {
    const activity = ACTIVITIES[type];
    if (!activity) return null;

    if (!includeExecute) {
        // Return a copy without the execute function
        const { execute, ...metadata } = activity;
        return metadata;
    }
    
    return activity;
}

/**
 * Get an activity's execute function.
 * @param {string} type - Activity type identifier
 * @returns {Function|null} Execute function or null if not found
 */
function getActivityExecutor(type) {
    const activity = ACTIVITIES[type];
    return activity ? activity.execute : null;
}

/**
 * Check if an activity is registered
 * @param {string} type - Activity type identifier
 * @returns {boolean} True if registered
 */
function hasActivity(type) {
    return !!ACTIVITIES[type];
}

/**
 * Get activities by category
 * @param {string} category - Category name
 * @param {boolean} includeExecute - Include execute functions
 * @returns {Object[]} Array of activities in the category
 */
function getActivitiesByCategory(category, includeExecute = false) {
    if (!category) return getActivities({ includeExecute });
    
    const types = ACTIVITY_INDEX.byCategory.get(category);
    if (!types) return [];
    
    return Array.from(types).map(type => getActivity(type, includeExecute));
}

/**
 * Get all registered categories
 * @returns {string[]} Array of category names
 */
function getCategories() {
    const categories = new Set();
    for (const activity of Object.values(ACTIVITIES)) {
        if (activity.category) {
            categories.add(activity.category);
        }
    }
    return Array.from(categories).sort();
}

/**
 * Search activities by name or description
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {boolean} options.includeExecute - Include execute functions
 * @param {string} options.category - Filter by category
 * @returns {Object[]} Array of matching activities
 */
function searchActivities(query, options = {}) {
    const { includeExecute = false, category } = options;
    
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return getActivities({ category, includeExecute });
    }

    const searchTerm = query.toLowerCase().trim();
    let activities = Object.values(ACTIVITIES);

    // Filter by category if specified
    if (category) {
        activities = activities.filter(act => act.category === category);
    }

    // Search in type, displayName, and description
    const results = activities.filter(act => {
        const typeMatch = act.type.toLowerCase().includes(searchTerm);
        const nameMatch = act.displayName.toLowerCase().includes(searchTerm);
        const descMatch = act.description && act.description.toLowerCase().includes(searchTerm);
        return typeMatch || nameMatch || descMatch;
    });

    // Format results
    return results.map(act => {
        const result = {
            type: act.type,
            displayName: act.displayName,
            description: act.description || '',
            category: act.category || 'Utility',
            configRequirements: act.configRequirements || []
        };
        
        if (includeExecute) {
            result.execute = act.execute;
        }
        
        return result;
    });
}

/**
 * Unregister an activity (for testing purposes)
 * @param {string} type - Activity type to unregister
 * @returns {boolean} True if unregistered
 */
function unregisterActivity(type) {
    const activity = ACTIVITIES[type];
    if (!activity) return false;

    // Remove from indexes
    if (activity.category) {
        const categorySet = ACTIVITY_INDEX.byCategory.get(activity.category);
        if (categorySet) {
            categorySet.delete(type);
            if (categorySet.size === 0) {
                ACTIVITY_INDEX.byCategory.delete(activity.category);
            }
        }
    }

    if (activity.displayName) {
        ACTIVITY_INDEX.byName.delete(activity.displayName.toLowerCase());
    }

    delete ACTIVITIES[type];
    return true;
}

/**
 * Get activity count
 * @param {string} category - Optional category filter
 * @returns {number} Number of registered activities
 */
function getActivityCount(category) {
    if (category) {
        const types = ACTIVITY_INDEX.byCategory.get(category);
        return types ? types.size : 0;
    }
    return Object.keys(ACTIVITIES).length;
}

/**
 * Get activity statistics
 * @returns {Object} Statistics about registered activities
 */
function getActivityStats() {
    const total = Object.keys(ACTIVITIES).length;
    const byCategory = {};
    
    for (const [category, types] of ACTIVITY_INDEX.byCategory) {
        byCategory[category] = types.size;
    }
    
    return {
        total,
        categories: Object.keys(byCategory),
        byCategory,
        categoriesCount: Object.keys(byCategory).length
    };
}

module.exports = {
    registerActivity,
    getActivities,
    getActivity,
    getActivityExecutor,
    hasActivity,
    getActivitiesByCategory,
    getCategories,
    searchActivities,
    unregisterActivity,
    getActivityCount,
    getActivityStats,
    VALID_CATEGORIES
};
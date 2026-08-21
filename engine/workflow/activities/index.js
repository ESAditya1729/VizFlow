/**
 * engine/workflow/activities/index.js
 *
 * Convenience exports for all activity categories.
 * Serves as the central registration point for all workflow activities.
 */

'use strict';

// ─── Activity Category Imports ──────────────────────────────────────────────
let inputActivities = [];
let transformationActivities = [];
let queryActivities = [];
let analyticsActivities = [];
let outputActivities = [];
let controlActivities = [];
let powerShellActivities = [];
let databaseActivities = [];
let httpActivities = [];
let xmlActivities = [];

// ─── Safe Module Loading ────────────────────────────────────────────────────
try {
    inputActivities = require('./inputActivities');
    if (!Array.isArray(inputActivities)) {
        console.warn('[VizFlow] inputActivities is not an array, wrapping...');
        inputActivities = Array.isArray(inputActivities) ? inputActivities : [inputActivities];
    }
} catch (error) {
    console.error('[VizFlow] Failed to load inputActivities:', error.message);
    inputActivities = [];
}

try {
    transformationActivities = require('./transformationActivities');
    if (!Array.isArray(transformationActivities)) {
        console.warn('[VizFlow] transformationActivities is not an array, wrapping...');
        transformationActivities = Array.isArray(transformationActivities) ? transformationActivities : [transformationActivities];
    }
} catch (error) {
    console.error('[VizFlow] Failed to load transformationActivities:', error.message);
    transformationActivities = [];
}

try {
    queryActivities = require('./queryActivities');
    if (!Array.isArray(queryActivities)) {
        console.warn('[VizFlow] queryActivities is not an array, wrapping...');
        queryActivities = Array.isArray(queryActivities) ? queryActivities : [queryActivities];
    }
} catch (error) {
    console.error('[VizFlow] Failed to load queryActivities:', error.message);
    queryActivities = [];
}

try {
    analyticsActivities = require('./analyticsActivities');
    if (!Array.isArray(analyticsActivities)) {
        console.warn('[VizFlow] analyticsActivities is not an array, wrapping...');
        analyticsActivities = Array.isArray(analyticsActivities) ? analyticsActivities : [analyticsActivities];
    }
} catch (error) {
    console.error('[VizFlow] Failed to load analyticsActivities:', error.message);
    analyticsActivities = [];
}

try {
    outputActivities = require('./outputActivities');
    if (!Array.isArray(outputActivities)) {
        console.warn('[VizFlow] outputActivities is not an array, wrapping...');
        outputActivities = Array.isArray(outputActivities) ? outputActivities : [outputActivities];
    }
} catch (error) {
    console.error('[VizFlow] Failed to load outputActivities:', error.message);
    outputActivities = [];
}

try {
    controlActivities = require('./controlActivities');
    if (!Array.isArray(controlActivities)) {
        console.warn('[VizFlow] controlActivities is not an array, wrapping...');
        controlActivities = Array.isArray(controlActivities) ? controlActivities : [controlActivities];
    }
} catch (error) {
    console.error('[VizFlow] Failed to load controlActivities:', error.message);
    controlActivities = [];
}

// ─── Load PowerShell Activities ─────────────────────────────────────────────
try {
    powerShellActivities = require('./powerShellActivities');
    if (!Array.isArray(powerShellActivities)) {
        console.warn('[VizFlow] powerShellActivities is not an array, wrapping...');
        powerShellActivities = Array.isArray(powerShellActivities) ? powerShellActivities : [powerShellActivities];
    }
    console.log(`[VizFlow] Loaded ${powerShellActivities.length} PowerShell activities`);
} catch (error) {
    console.error('[VizFlow] Failed to load powerShellActivities:', error.message);
    powerShellActivities = [];
}

// ─── Load Database Activities ───────────────────────────────────────────────
try {
    databaseActivities = require('./databaseActivities');
    if (!Array.isArray(databaseActivities)) {
        console.warn('[VizFlow] databaseActivities is not an array, wrapping...');
        databaseActivities = Array.isArray(databaseActivities) ? databaseActivities : [databaseActivities];
    }
    console.log(`[VizFlow] Loaded ${databaseActivities.length} database activities`);
} catch (error) {
    console.error('[VizFlow] Failed to load databaseActivities:', error.message);
    databaseActivities = [];
}

// ─── Load HTTP / Integration Activities ─────────────────────────────────────
try {
    httpActivities = require('./httpActivities');
    if (!Array.isArray(httpActivities)) {
        console.warn('[VizFlow] httpActivities is not an array, wrapping...');
        httpActivities = Array.isArray(httpActivities) ? httpActivities : [httpActivities];
    }
    console.log(`[VizFlow] Loaded ${httpActivities.length} HTTP activities`);
} catch (error) {
    console.error('[VizFlow] Failed to load httpActivities:', error.message);
    httpActivities = [];
}

// ─── Load XML Activities ────────────────────────────────────────────────────
try {
    xmlActivities = require('./xmlActivities');
    if (!Array.isArray(xmlActivities)) {
        console.warn('[VizFlow] xmlActivities is not an array, wrapping...');
        xmlActivities = Array.isArray(xmlActivities) ? xmlActivities : [xmlActivities];
    }
    console.log(`[VizFlow] Loaded ${xmlActivities.length} XML activities`);
} catch (error) {
    console.error('[VizFlow] Failed to load xmlActivities:', error.message);
    xmlActivities = [];
}

// Merge XML activities into their existing categories by `category`, so
// readXml/writeXml/xmlTransform show up alongside readCsv/writeCsv/transform
// without a new top-level category or any change to activityRegistry.js.
inputActivities = [...inputActivities, ...xmlActivities.filter(a => a.category === 'Input')];
outputActivities = [...outputActivities, ...xmlActivities.filter(a => a.category === 'Output')];
transformationActivities = [...transformationActivities, ...xmlActivities.filter(a => a.category === 'Transformation')];

// ─── Category Registry ──────────────────────────────────────────────────────

/**
 * All activity categories with their activities
 */
const ACTIVITY_CATEGORIES = {
    input: {
        name: 'Input',
        icon: '📥',
        description: 'Activities for reading data from various sources',
        activities: inputActivities
    },
    transformation: {
        name: 'Transformation',
        icon: '🔄',
        description: 'Activities for modifying and transforming data',
        activities: transformationActivities
    },
    query: {
        name: 'Query',
        icon: '📊',
        description: 'Activities for querying and filtering data',
        activities: queryActivities
    },
    analytics: {
        name: 'Analytics',
        icon: '📈',
        description: 'Activities for data analysis and summarization',
        activities: analyticsActivities
    },
    output: {
        name: 'Output',
        icon: '💾',
        description: 'Activities for writing data to various destinations',
        activities: outputActivities
    },
    control: {
        name: 'Control',
        icon: '⚙️',
        description: 'Activities for workflow orchestration and flow control',
        activities: controlActivities
    },
    powerShell: {
        name: 'PowerShell',
        icon: '⚡',
        description: 'Activities for PowerShell integration and automation (file operations, system tasks, etc.)',
        activities: powerShellActivities
    },
    database: {
        name: 'Database',
        icon: '🗄️',
        description: 'Activities for reading from external data sources (MongoDB, MySQL, PostgreSQL)',
        activities: databaseActivities
    },
    integration: {
        name: 'Integration',
        icon: '🌐',
        description: 'Activities for calling external APIs and web services (HTTP/REST)',
        activities: httpActivities
    }
};

// ─── Helper Functions ──────────────────────────────────────────────────────

/**
 * Get all activities from all categories
 * @param {Object} options - Options for filtering
 * @param {Array<string>} options.categories - Specific categories to include
 * @param {boolean} options.includeMetadata - Include category metadata (default: false)
 * @returns {Array} Array of activity objects
 */
function getAllActivities(options = {}) {
    const { categories = null, includeMetadata = false } = options;
    
    let result = [];
    let categoryKeys = categories || Object.keys(ACTIVITY_CATEGORIES);
    
    if (typeof categoryKeys === 'string') {
        categoryKeys = [categoryKeys];
    }

    for (const key of categoryKeys) {
        const category = ACTIVITY_CATEGORIES[key];
        if (!category) continue;
        
        const activities = category.activities || [];
        for (const activity of activities) {
            if (includeMetadata) {
                result.push({
                    ...activity,
                    _category: {
                        key: key,
                        name: category.name,
                        icon: category.icon,
                        description: category.description
                    }
                });
            } else {
                result.push(activity);
            }
        }
    }
    
    return result;
}

/**
 * Get activities by category
 * @param {string} categoryKey - Category key (input, transformation, query, etc.)
 * @param {Object} options - Options
 * @param {boolean} options.includeMetadata - Include category metadata
 * @returns {Array} Array of activities in the category
 */
function getActivitiesByCategory(categoryKey, options = {}) {
    const { includeMetadata = false } = options;
    const category = ACTIVITY_CATEGORIES[categoryKey];
    if (!category) return [];
    
    const activities = category.activities || [];
    if (includeMetadata) {
        return activities.map(activity => ({
            ...activity,
            _category: {
                key: categoryKey,
                name: category.name,
                icon: category.icon,
                description: category.description
            }
        }));
    }
    
    return activities;
}

/**
 * Get all category names
 * @param {boolean} includeDetails - Include category details (name, icon, description)
 * @returns {Array|Object} Category names or detailed category info
 */
function getCategories(includeDetails = false) {
    if (includeDetails) {
        const result = {};
        for (const [key, value] of Object.entries(ACTIVITY_CATEGORIES)) {
            result[key] = {
                name: value.name,
                icon: value.icon,
                description: value.description,
                activityCount: (value.activities || []).length
            };
        }
        return result;
    }
    return Object.keys(ACTIVITY_CATEGORIES);
}

/**
 * Get category statistics
 * @returns {Object} Statistics for each category
 */
function getCategoryStats() {
    const stats = {};
    for (const [key, value] of Object.entries(ACTIVITY_CATEGORIES)) {
        const activities = value.activities || [];
        stats[key] = {
            name: value.name,
            icon: value.icon,
            activityCount: activities.length,
            activityTypes: activities.map(a => a.type)
        };
    }
    return stats;
}

/**
 * Find an activity by type across all categories
 * @param {string} type - Activity type to find
 * @param {boolean} includeCategory - Include category information in result
 * @returns {Object|null} Found activity or null
 */
function findActivity(type, includeCategory = false) {
    if (!type || typeof type !== 'string') return null;
    
    for (const [key, category] of Object.entries(ACTIVITY_CATEGORIES)) {
        const activities = category.activities || [];
        for (const activity of activities) {
            if (activity.type === type) {
                if (includeCategory) {
                    return {
                        ...activity,
                        _category: {
                            key: key,
                            name: category.name,
                            icon: category.icon,
                            description: category.description
                        }
                    };
                }
                return activity;
            }
        }
    }
    return null;
}

/**
 * Search activities by name, description, or type
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {Array<string>} options.categories - Categories to search in
 * @param {boolean} options.caseSensitive - Case sensitive search (default: false)
 * @param {boolean} options.includeMetadata - Include category metadata
 * @returns {Array} Matching activities
 */
function searchActivities(query, options = {}) {
    const { 
        categories = null, 
        caseSensitive = false,
        includeMetadata = false
    } = options;
    
    if (!query || typeof query !== 'string') {
        return getAllActivities({ categories, includeMetadata });
    }
    
    const searchTerm = caseSensitive ? query : query.toLowerCase();
    const results = [];
    
    let categoryKeys = categories || Object.keys(ACTIVITY_CATEGORIES);
    if (typeof categoryKeys === 'string') {
        categoryKeys = [categoryKeys];
    }
    
    for (const key of categoryKeys) {
        const category = ACTIVITY_CATEGORIES[key];
        if (!category) continue;
        
        const activities = category.activities || [];
        for (const activity of activities) {
            const type = caseSensitive ? activity.type : activity.type.toLowerCase();
            const displayName = caseSensitive ? activity.displayName : activity.displayName.toLowerCase();
            const description = caseSensitive ? (activity.description || '') : (activity.description || '').toLowerCase();
            
            if (type.includes(searchTerm) || displayName.includes(searchTerm) || description.includes(searchTerm)) {
                if (includeMetadata) {
                    results.push({
                        ...activity,
                        _category: {
                            key: key,
                            name: category.name,
                            icon: category.icon,
                            description: category.description
                        }
                    });
                } else {
                    results.push(activity);
                }
            }
        }
    }
    
    return results;
}

/**
 * Get the total number of activities across all categories
 * @param {Array<string>} categories - Specific categories to count
 * @returns {number} Total activity count
 */
function getTotalActivityCount(categories = null) {
    let count = 0;
    let categoryKeys = categories || Object.keys(ACTIVITY_CATEGORIES);
    
    if (typeof categoryKeys === 'string') {
        categoryKeys = [categoryKeys];
    }
    
    for (const key of categoryKeys) {
        const category = ACTIVITY_CATEGORIES[key];
        if (category) {
            count += (category.activities || []).length;
        }
    }
    
    return count;
}

/**
 * Validate that all activities have required fields
 * @param {string} categoryKey - Optional specific category to validate
 * @returns {Object} Validation results
 */
function validateActivities(categoryKey = null) {
    const errors = [];
    const warnings = [];
    let validatedCount = 0;
    
    let categories = categoryKey ? [categoryKey] : Object.keys(ACTIVITY_CATEGORIES);
    
    for (const key of categories) {
        const category = ACTIVITY_CATEGORIES[key];
        if (!category) {
            errors.push(`Category "${key}" not found`);
            continue;
        }
        
        const activities = category.activities || [];
        for (const activity of activities) {
            validatedCount++;
            
            // Check required fields
            if (!activity.type) {
                errors.push(`Activity in category "${key}" missing "type" field`);
            }
            if (!activity.displayName) {
                errors.push(`Activity "${activity.type || 'unknown'}" in category "${key}" missing "displayName" field`);
            }
            if (!activity.execute || typeof activity.execute !== 'function') {
                errors.push(`Activity "${activity.type || 'unknown'}" in category "${key}" missing or invalid "execute" function`);
            }
            
            // Check config requirements
            if (activity.configRequirements) {
                if (!Array.isArray(activity.configRequirements)) {
                    errors.push(`Activity "${activity.type}" has invalid "configRequirements" (must be array)`);
                } else {
                    for (const req of activity.configRequirements) {
                        if (!req.name) {
                            errors.push(`Activity "${activity.type}" has config requirement missing "name"`);
                        }
                        if (!req.label) {
                            warnings.push(`Activity "${activity.type}" config requirement "${req.name || 'unknown'}" missing "label"`);
                        }
                        if (req.type === 'select' && (!req.options || !Array.isArray(req.options) || req.options.length === 0)) {
                            errors.push(`Activity "${activity.type}" config requirement "${req.name}" is select but has no options`);
                        }
                    }
                }
            }
            
            // Check category consistency
            if (activity.category && activity.category !== category.name) {
                warnings.push(`Activity "${activity.type}" has category "${activity.category}" but is in "${category.name}"`);
            }
        }
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        validatedCount,
        totalCategories: categories.length
    };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    // Original exports (backward compatibility)
    inputActivities,
    transformationActivities,
    queryActivities,
    analyticsActivities,
    outputActivities,
    controlActivities,
    powerShellActivities,  // New: PowerShell activities
    databaseActivities,    // New: Database activities
    httpActivities,        // New: HTTP / integration activities
    xmlActivities,         // New: XML activities

    // Enhanced exports
    ACTIVITY_CATEGORIES,
    getAllActivities,
    getActivitiesByCategory,
    getCategories,
    getCategoryStats,
    findActivity,
    searchActivities,
    getTotalActivityCount,
    validateActivities
};
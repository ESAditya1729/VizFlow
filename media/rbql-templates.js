/**
 * media/rbql-templates.js
 *
 * RBQL Query Templates — keep this file separate so templates can be
 * added / edited without touching the HTML.  Each entry is:
 *   { category, label, desc, query }
 *
 * `category` must be one of RBQL_TEMPLATE_CATEGORIES (the display order).
 * Every template is executed against a sample dataset by test/rbql.test.js,
 * so keep queries valid for a table with at least 3 columns (a1..a3), and
 * for join templates a second table (b1, b2).
 */
'use strict';

var RBQL_TEMPLATE_CATEGORIES = [
    'Explore',
    'Filter',
    'Aggregate',
    'Transform',
    'Join'
];

var RBQL_TEMPLATES = [
    // ── Explore ─────────────────────────────────────────────
    {
        category: 'Explore',
        label: 'Preview 100 Rows',
        desc: 'View the first 100 rows',
        query: 'SELECT * LIMIT 100'
    },
    {
        category: 'Explore',
        label: 'Distinct Values',
        desc: 'List unique values in a column',
        query: 'SELECT DISTINCT a1'
    },
    {
        category: 'Explore',
        label: 'Deduplicate',
        desc: 'Remove duplicate key combinations',
        query: 'SELECT DISTINCT a1, a2'
    },
    {
        category: 'Explore',
        label: 'Top N Rows',
        desc: 'Smallest N values in a column',
        query: 'SELECT * ORDER BY a1 ASC LIMIT 10'
    },
    {
        category: 'Explore',
        label: 'Sort Ascending',
        desc: 'Sort by a column, excluding blanks',
        query: "SELECT * WHERE a1 != '' ORDER BY a1 ASC"
    },

    // ── Filter ──────────────────────────────────────────────
    {
        category: 'Filter',
        label: 'Filter Rows',
        desc: 'Keep rows where a column matches a value',
        query: "SELECT * WHERE a1 == 'value'"
    },
    {
        category: 'Filter',
        label: 'Filter by Multiple Values',
        desc: 'Keep rows matching any listed value',
        query: "SELECT a1, a2 WHERE a1 IN ('A', 'B', 'C')"
    },
    {
        category: 'Filter',
        label: 'Find Blank Values',
        desc: 'Find rows where a column is empty',
        query: "SELECT * WHERE a1 == ''"
    },
    {
        category: 'Filter',
        label: 'Combine Conditions',
        desc: 'Filter with && / || and like() pattern matching',
        query: "SELECT a1 WHERE a2 > 100 && like(a3, '%pattern%')"
    },

    // ── Aggregate ───────────────────────────────────────────
    {
        category: 'Aggregate',
        label: 'Group and Count',
        desc: 'Count rows per group',
        query: 'SELECT a1, COUNT(*) as cnt GROUP BY a1'
    },
    {
        category: 'Aggregate',
        label: 'Sum per Group',
        desc: 'Total a numeric column per group (RBQL cannot ORDER BY an aggregate)',
        query: 'SELECT a1, SUM(a2) as total GROUP BY a1'
    },
    {
        category: 'Aggregate',
        label: 'Group Statistics',
        desc: 'AVG, MAX and MIN per group',
        query: 'SELECT a1, AVG(a2) as avg_val, MAX(a2) as max_val, MIN(a2) as min_val GROUP BY a1'
    },
    {
        category: 'Aggregate',
        label: 'Count Distinct',
        desc: 'Count unique values per group',
        query: 'SELECT a1, ARRAY_AGG(a2, v => new Set(v).size) as unique_count GROUP BY a1'
    },

    // ── Transform ───────────────────────────────────────────
    {
        category: 'Transform',
        label: 'Rename Columns',
        desc: 'Alias output columns with AS',
        query: 'SELECT a1 as id, a2 as name, a3 as country'
    },
    {
        category: 'Transform',
        label: 'Calculate a Column',
        desc: 'Derive a new value from existing columns',
        query: 'SELECT a1, a2 * a3 as total'
    },
    {
        category: 'Transform',
        label: 'String Transform',
        desc: 'Uppercase a column (use .toLowerCase() for lowercase)',
        query: 'SELECT a1, a2.toUpperCase() as upper_value'
    },
    {
        category: 'Transform',
        label: 'Find and Replace (preview)',
        desc: 'Preview a conditional update — source file is not modified',
        query: "UPDATE SET a2 = 'new value' WHERE a1 == 'old value'"
    },
    {
        category: 'Transform',
        label: 'Trim Whitespace (preview)',
        desc: 'Preview a normalized text column — source file is not modified',
        query: 'UPDATE SET a1 = a1.trim()'
    },

    // ── Join (requires a join table) ────────────────────────
    {
        category: 'Join',
        label: 'Inner Join',
        desc: 'Join rows using the loaded join table',
        query: 'SELECT a1, a2, b2 INNER JOIN b ON a1 == b1',
        needsJoin: true
    },
    {
        category: 'Join',
        label: 'Left Join',
        desc: 'Keep all source rows plus join matches',
        query: 'SELECT a1, a2, b2 LEFT JOIN b ON a1 == b1',
        needsJoin: true
    },
    {
        category: 'Join',
        label: 'Rows Without a Match',
        desc: 'Source rows with no partner in the join table',
        query: "SELECT a1, a2 LEFT JOIN b ON a1 == b1 WHERE b1 === null",
        needsJoin: true
    }
];

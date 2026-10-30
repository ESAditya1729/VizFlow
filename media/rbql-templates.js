/**
 * media/rbql-templates.js
 *
 * RBQL Query Templates — keep this file separate so templates can be
 * added / edited without touching the HTML.  Each entry is:
 *   { label, desc, query }
 *
 * To add a new template just push another object to the array.
 */
'use strict';

var RBQL_TEMPLATES = [
    {
        label: 'Preview 100 Rows',
        desc: 'View the first 100 rows',
        query: 'SELECT * LIMIT 100'
    },
    {
        label: 'Filter Rows',
        desc: 'Keep rows where a column matches a value',
        query: "SELECT * WHERE a1 == 'value'"
    },
    {
        label: 'Filter by Multiple Values',
        desc: 'Keep rows matching any listed value',
        query: "SELECT a1, a2 WHERE a1 IN ('A', 'B', 'C')"
    },
    {
        label: 'Filter Blank Values',
        desc: 'Find rows where a column is empty',
        query: "SELECT * WHERE a1 == ''"
    },
    {
        label: 'Find and Replace',
        desc: 'Update a column conditionally',
        query: "UPDATE SET a2 = 'new value' WHERE a1 == 'old value'"
    },
    {
        label: 'Trim Whitespace',
        desc: 'Normalize a text column',
        query: 'UPDATE SET a1 = a1.trim()'
    },
    {
        label: 'Group and Count',
        desc: 'Count rows per group',
        query: 'SELECT a1, COUNT(*) as cnt GROUP BY a1'
    },
    {
        label: 'Sum and Sort',
        desc: 'Aggregate totals, largest first',
        query: 'SELECT a1, SUM(a2) as total GROUP BY a1 ORDER BY total DESC'
    },
    {
        label: 'Group Statistics',
        desc: 'AVG, MAX and MIN per group',
        query: 'SELECT a1, AVG(a2) as avg_val, MAX(a2) as max_val, MIN(a2) as min_val GROUP BY a1'
    },
    {
        label: 'Distinct Values',
        desc: 'List unique values in a column',
        query: 'SELECT DISTINCT a1'
    },
    {
        label: 'Count Distinct',
        desc: 'Count unique values per group',
        query: 'SELECT a1, COUNT(DISTINCT a2) as unique_count GROUP BY a1'
    },
    {
        label: 'String Transform',
        desc: 'Uppercase or lowercase a column',
        query: "SELECT a1, UPPER(a2) as upper_value"
    },
    {
        label: 'Combine Conditions',
        desc: 'Filter with AND / OR',
        query: "SELECT a1 WHERE a2 > 100 AND a3 LIKE '%pattern%'"
    },
    {
        label: 'Sort Ascending',
        desc: 'Sort by a column, excluding blanks',
        query: "SELECT * WHERE a1 != '' ORDER BY a1 ASC"
    },
    {
        label: 'Rename Columns',
        desc: 'Alias output columns with AS',
        query: 'SELECT a1 as id, a2 as name, a3 as country'
    },
    {
        label: 'Calculate a Column',
        desc: 'Derive a new value from existing columns',
        query: 'SELECT a1, a2 * a3 as total'
    },
    {
        label: 'Inner Join',
        desc: 'Join rows using the loaded join table',
        query: 'SELECT a1, a2, b2 INNER JOIN b ON a1 == b1'
    },
    {
        label: 'Left Join',
        desc: 'Keep all source rows plus join matches',
        query: 'SELECT a1, a2, b2 LEFT JOIN b ON a1 == b1'
    },
    {
        label: 'Deduplicate',
        desc: 'Remove duplicate key combinations',
        query: 'SELECT DISTINCT a1, a2'
    },
    {
        label: 'Top N Rows',
        desc: 'Smallest N values in a column',
        query: 'SELECT * ORDER BY a1 ASC LIMIT 10'
    }
];

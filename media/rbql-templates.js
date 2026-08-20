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
        label: 'Select All (Limit 100)',
        desc: 'View first 100 rows',
        query: 'SELECT * LIMIT 100'
    },
    {
        label: 'Filter by Column',
        desc: 'Filter rows matching condition',
        query: "SELECT * WHERE a1 == 'value'"
    },
    {
        label: 'IN Filter',
        desc: 'Filter by multiple values',
        query: "SELECT a1, a2 WHERE a1 IN ('A', 'B', 'C')"
    },
    {
        label: 'Group & Count',
        desc: 'Aggregate with GROUP BY',
        query: 'SELECT a1, a2, COUNT(*) as cnt GROUP BY a1, a2'
    },
    {
        label: 'Sum & Sort',
        desc: 'Sum values, sort descending',
        query: 'SELECT a1, SUM(a2) as total GROUP BY a1 ORDER BY total DESC'
    },
    {
        label: 'Distinct Values',
        desc: 'Get unique values in column',
        query: 'SELECT DISTINCT a1'
    },
    {
        label: 'String Transform',
        desc: 'Apply UPPER, LOWER, TRIM',
        query: 'SELECT a1, UPPER(a2) as upper_name'
    },
    {
        label: 'Multiple Conditions',
        desc: 'Combine WHERE clauses',
        query: "SELECT a1 WHERE a2 > 100 AND a3 LIKE '%pattern%'"
    },
    {
        label: 'Statistics',
        desc: 'AVG, MAX, MIN per group',
        query: 'SELECT a1, AVG(a2) as avg_val, MAX(a2) as max_val, MIN(a2) as min_val GROUP BY a1'
    },
    {
        label: 'Sort Ascending',
        desc: 'Sort by column, exclude nulls',
        query: 'SELECT * WHERE a1 != null ORDER BY a1 ASC'
    },
    {
        label: 'Rename Columns',
        desc: 'Rename output columns with AS',
        query: "SELECT a1 as id, a2 as name, a3 as country"
    },
    {
        label: 'Top N per Group',
        desc: 'LIMIT inside a GROUP (useful pattern)',
        query: "SELECT a1, a2 WHERE a1 == 'X' LIMIT 10"
    },
    {
        label: 'Update Values',
        desc: 'Modify column values in-place',
        query: "UPDATE SET a2 = a2 * 2 WHERE a1 != null"
    },
    {
        label: 'Inner Join',
        desc: 'Join with loaded join table (b1, b2...)',
        query: "SELECT a1, a2, b2 INNER JOIN b ON a1 == b1"
    },
    {
        label: 'Left Join',
        desc: 'Left join with loaded join table',
        query: "SELECT a1, a2, b2 LEFT JOIN b ON a1 == b1"
    },
    {
        label: 'Sample First 10',
        desc: 'Quick preview of data',
        query: 'SELECT * LIMIT 10'
    }
];

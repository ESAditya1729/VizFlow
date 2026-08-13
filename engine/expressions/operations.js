/**
 * engine/expressions/operations.js
 *
 * Registry of all transform operations available in VizFlow.
 * Each operation is a function that takes a value and optional parameters.
 */

const OPERATIONS = {};

/**
 * Register a new operation
 * @param {string} name - Operation key
 * @param {Function} fn - Function that takes (value, ...params)
 * @param {string} category - Category for UI grouping
 * @param {string} description - Human-readable description
 * @param {Array} paramDefs - Parameter definitions for UI
 */
function registerOperation(name, fn, category = 'String', description = '', paramDefs = []) {
    OPERATIONS[name] = { fn, category, description, paramDefs };
}

// ─── STRING OPERATIONS ────────────────────────────────────────────────

registerOperation('upper', 
    (val) => String(val).toUpperCase(),
    'String', 'Convert to UPPER CASE'
);

registerOperation('lower', 
    (val) => String(val).toLowerCase(),
    'String', 'Convert to lower case'
);

registerOperation('trim', 
    (val) => String(val).trim(),
    'String', 'Remove leading/trailing whitespace'
);

registerOperation('trimAll', 
    (val) => String(val).replace(/\s+/g, ''),
    'String', 'Remove ALL whitespace'
);

registerOperation('clean', 
    (val) => String(val).replace(/[^a-zA-Z0-9 ]/g, ''),
    'String', 'Remove special characters, keep alphanumeric and spaces'
);

registerOperation('replace', 
    (val, search, replace) => {
        if (search === undefined || search === null || search === '') {
            throw new Error('Search string is required');
        }
        const str = String(val);
        const searchStr = String(search);
        const replaceStr = replace !== undefined ? String(replace) : '';
        return str.split(searchStr).join(replaceStr);
    },
    'String', 'Replace text with another string',
    [
        { name: 'search', label: 'Search String', type: 'string', required: true },
        { name: 'replace', label: 'Replace With', type: 'string', required: false, default: '' }
    ]
);

registerOperation('regexReplace', 
    (val, pattern, replacement) => {
        if (!pattern) throw new Error('Regex pattern is required');
        const regex = new RegExp(pattern, 'g');
        return String(val).replace(regex, replacement || '');
    },
    'String', 'Replace text using regex pattern',
    [
        { name: 'pattern', label: 'Regex Pattern', type: 'string', required: true },
        { name: 'replacement', label: 'Replace With', type: 'string', required: false, default: '' }
    ]
);

registerOperation('regexExtract', 
    (val, pattern) => {
        if (!pattern) throw new Error('Regex pattern is required');
        const regex = new RegExp(pattern);
        const match = String(val).match(regex);
        return match ? (match[1] || match[0]) : '';
    },
    'String', 'Extract text using regex pattern',
    [
        { name: 'pattern', label: 'Regex Pattern', type: 'string', required: true }
    ]
);

registerOperation('concat', 
    (val, ...strings) => {
        if (!strings || strings.length === 0) {
            throw new Error('At least one string to concatenate is required');
        }
        return String(val) + strings.join('');
    },
    'String', 'Append text to the value',
    [
        { name: 'strings', label: 'Text to Append', type: 'string', required: true }
    ]
);

registerOperation('substring', 
    (val, start, end) => {
        const str = String(val);
        const startIdx = parseInt(start);
        if (isNaN(startIdx) || startIdx < 0) {
            throw new Error(`Invalid start index: "${start}". Must be a non-negative number.`);
        }
        
        if (end !== undefined && end !== '') {
            const endIdx = parseInt(end);
            if (isNaN(endIdx)) {
                throw new Error(`Invalid end index: "${end}". Must be a number.`);
            }
            if (endIdx < startIdx) {
                throw new Error(`End index (${endIdx}) must be greater than start index (${startIdx})`);
            }
            return str.substring(startIdx, endIdx);
        }
        return str.substring(startIdx);
    },
    'String', 'Extract substring by character positions (0-indexed)',
    [
        { name: 'start', label: 'Start Index', type: 'number', required: true, default: 0 },
        { name: 'end', label: 'End Index (optional)', type: 'number', required: false }
    ]
);

registerOperation('len', 
    (val) => String(val).length,
    'String', 'Get character length'
);

registerOperation('countWords', 
    (val) => String(val).split(/\s+/).filter(w => w.length > 0).length,
    'String', 'Count number of words'
);

registerOperation('titleCase', 
    (val) => String(val).replace(/\w\S*/g, 
        txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    ),
    'String', 'Convert to Title Case'
);

registerOperation('camelCase', 
    (val) => String(val)
        .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
        .replace(/^[A-Z]/, (char) => char.toLowerCase()),
    'String', 'Convert to camelCase'
);

registerOperation('snakeCase', 
    (val) => String(val)
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[\s\-]+/g, '_')
        .toLowerCase(),
    'String', 'Convert to snake_case'
);

registerOperation('kebabCase', 
    (val) => String(val)
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/[\s_]+/g, '-')
        .toLowerCase(),
    'String', 'Convert to kebab-case'
);

registerOperation('reverse', 
    (val) => String(val).split('').reverse().join(''),
    'String', 'Reverse the string'
);

registerOperation('padStart', 
    (val, targetLength, padString) => {
        const len = parseInt(targetLength);
        if (isNaN(len) || len < 0) {
            throw new Error(`Invalid target length: "${targetLength}". Must be a non-negative number.`);
        }
        return String(val).padStart(len, padString || ' ');
    },
    'String', 'Pad the start of string',
    [
        { name: 'targetLength', label: 'Target Length', type: 'number', required: true },
        { name: 'padString', label: 'Pad Character', type: 'string', required: false, default: ' ' }
    ]
);

registerOperation('padEnd', 
    (val, targetLength, padString) => {
        const len = parseInt(targetLength);
        if (isNaN(len) || len < 0) {
            throw new Error(`Invalid target length: "${targetLength}". Must be a non-negative number.`);
        }
        return String(val).padEnd(len, padString || ' ');
    },
    'String', 'Pad the end of string',
    [
        { name: 'targetLength', label: 'Target Length', type: 'number', required: true },
        { name: 'padString', label: 'Pad Character', type: 'string', required: false, default: ' ' }
    ]
);

registerOperation('truncate', 
    (val, maxLength, suffix) => {
        const len = parseInt(maxLength);
        if (isNaN(len) || len < 0) {
            throw new Error(`Invalid max length: "${maxLength}". Must be a non-negative number.`);
        }
        const str = String(val);
        if (str.length <= len) return str;
        return str.substring(0, len) + (suffix || '…');
    },
    'String', 'Truncate to maximum length',
    [
        { name: 'maxLength', label: 'Maximum Length', type: 'number', required: true },
        { name: 'suffix', label: 'Suffix', type: 'string', required: false, default: '…' }
    ]
);

registerOperation('slugify', 
    (val) => String(val)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    'String', 'Convert to URL-friendly slug'
);

// ─── NUMBER OPERATIONS ──────────────────────────────────────────────────

registerOperation('add', 
    (val, amount) => {
        const num = parseFloat(val);
        if (isNaN(num)) throw new Error(`Cannot add to non-numeric value: "${val}"`);
        const amt = parseFloat(amount);
        if (isNaN(amt)) throw new Error(`Invalid amount: "${amount}". Must be a number.`);
        return num + amt;
    },
    'Number', 'Add a number',
    [
        { name: 'amount', label: 'Amount to Add', type: 'number', required: true }
    ]
);

registerOperation('subtract', 
    (val, amount) => {
        const num = parseFloat(val);
        if (isNaN(num)) throw new Error(`Cannot subtract from non-numeric value: "${val}"`);
        const amt = parseFloat(amount);
        if (isNaN(amt)) throw new Error(`Invalid amount: "${amount}". Must be a number.`);
        return num - amt;
    },
    'Number', 'Subtract a number',
    [
        { name: 'amount', label: 'Amount to Subtract', type: 'number', required: true }
    ]
);

registerOperation('multiply', 
    (val, factor) => {
        const num = parseFloat(val);
        if (isNaN(num)) throw new Error(`Cannot multiply non-numeric value: "${val}"`);
        const factorNum = parseFloat(factor);
        if (isNaN(factorNum)) throw new Error(`Invalid factor: "${factor}". Must be a number.`);
        return num * factorNum;
    },
    'Number', 'Multiply by a factor',
    [
        { name: 'factor', label: 'Multiply By', type: 'number', required: true }
    ]
);

registerOperation('divide', 
    (val, divisor) => {
        const num = parseFloat(val);
        if (isNaN(num)) throw new Error(`Cannot divide non-numeric value: "${val}"`);
        const div = parseFloat(divisor);
        if (isNaN(div)) throw new Error(`Invalid divisor: "${divisor}". Must be a number.`);
        if (div === 0) throw new Error('Cannot divide by zero');
        return num / div;
    },
    'Number', 'Divide by a number',
    [
        { name: 'divisor', label: 'Divide By', type: 'number', required: true }
    ]
);

registerOperation('power', 
    (val, exponent) => {
        const num = parseFloat(val);
        if (isNaN(num)) throw new Error(`Cannot calculate power of non-numeric value: "${val}"`);
        const exp = parseFloat(exponent);
        if (isNaN(exp)) throw new Error(`Invalid exponent: "${exponent}". Must be a number.`);
        return Math.pow(num, exp);
    },
    'Number', 'Raise to power',
    [
        { name: 'exponent', label: 'Exponent', type: 'number', required: true, default: 2 }
    ]
);

registerOperation('sqrt', 
    (val) => {
        const num = parseFloat(val);
        if (isNaN(num)) throw new Error(`Cannot calculate sqrt of non-numeric value: "${val}"`);
        if (num < 0) throw new Error(`Cannot calculate sqrt of negative number: "${val}"`);
        return Math.sqrt(num);
    },
    'Number', 'Calculate square root'
);

registerOperation('round', 
    (val) => Math.round(parseFloat(val) || 0),
    'Number', 'Round to nearest integer'
);

registerOperation('roundTo', 
    (val, decimals) => {
        const num = parseFloat(val);
        if (isNaN(num)) throw new Error(`Cannot round non-numeric value: "${val}"`);
        const dec = parseInt(decimals);
        if (isNaN(dec) || dec < 0) {
            throw new Error(`Invalid decimals: "${decimals}". Must be a non-negative number.`);
        }
        return Number(num.toFixed(dec));
    },
    'Number', 'Round to decimal places',
    [
        { name: 'decimals', label: 'Decimal Places', type: 'number', required: true, default: 2 }
    ]
);

registerOperation('ceil', 
    (val) => Math.ceil(parseFloat(val) || 0),
    'Number', 'Round up to nearest integer'
);

registerOperation('floor', 
    (val) => Math.floor(parseFloat(val) || 0),
    'Number', 'Round down to nearest integer'
);

registerOperation('abs', 
    (val) => Math.abs(parseFloat(val) || 0),
    'Number', 'Absolute value'
);

registerOperation('clamp', 
    (val, min, max) => {
        const num = parseFloat(val);
        if (isNaN(num)) throw new Error(`Cannot clamp non-numeric value: "${val}"`);
        const minVal = parseFloat(min);
        if (isNaN(minVal)) throw new Error(`Invalid min value: "${min}". Must be a number.`);
        const maxVal = parseFloat(max);
        if (isNaN(maxVal)) throw new Error(`Invalid max value: "${max}". Must be a number.`);
        if (minVal > maxVal) {
            throw new Error(`Min value (${minVal}) cannot be greater than max value (${maxVal})`);
        }
        return Math.max(minVal, Math.min(maxVal, num));
    },
    'Number', 'Clamp value between min and max',
    [
        { name: 'min', label: 'Minimum', type: 'number', required: true },
        { name: 'max', label: 'Maximum', type: 'number', required: true }
    ]
);

registerOperation('sign', 
    (val) => {
        const num = parseFloat(val);
        if (isNaN(num)) throw new Error(`Cannot determine sign of non-numeric value: "${val}"`);
        return Math.sign(num);
    },
    'Number', 'Get sign (-1, 0, 1)'
);

registerOperation('percentOf', 
    (val, total) => {
        const num = parseFloat(val);
        if (isNaN(num)) throw new Error(`Cannot calculate percent of non-numeric value: "${val}"`);
        const totalVal = parseFloat(total);
        if (isNaN(totalVal) || totalVal === 0) {
            throw new Error(`Invalid total: "${total}". Must be a non-zero number.`);
        }
        return (num / totalVal) * 100;
    },
    'Number', 'Calculate percentage of total',
    [
        { name: 'total', label: 'Total Value', type: 'number', required: true }
    ]
);

// ─── DATE OPERATIONS ────────────────────────────────────────────────────

registerOperation('parseDate', 
    (val) => {
        const date = new Date(val);
        if (isNaN(date.getTime())) throw new Error(`Cannot parse date: "${val}"`);
        return date.toISOString();
    },
    'Date', 'Parse string to ISO date'
);

registerOperation('formatDate', 
    (val, format) => {
        const date = new Date(val);
        if (isNaN(date.getTime())) throw new Error(`Cannot format date: "${val}"`);
        const fmt = format || 'YYYY-MM-DD';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        
        return fmt
            .replace('YYYY', year)
            .replace('YY', String(year).slice(-2))
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    },
    'Date', 'Format date with pattern (YYYY-MM-DD, MM/DD/YYYY, etc.)',
    [
        { name: 'format', label: 'Format Pattern', type: 'string', required: false, default: 'YYYY-MM-DD' }
    ]
);

registerOperation('extractDatePart', 
    (val, part) => {
        const date = new Date(val);
        if (isNaN(date.getTime())) throw new Error(`Cannot extract date part from: "${val}"`);
        const p = (part || 'year').toLowerCase();
        switch(p) {
            case 'year': return date.getFullYear();
            case 'month': return date.getMonth() + 1;
            case 'day': return date.getDate();
            case 'hour': return date.getHours();
            case 'minute': return date.getMinutes();
            case 'second': return date.getSeconds();
            case 'weekday': return date.getDay();
            default: throw new Error(`Unknown date part: "${part}". Available: year, month, day, hour, minute, second, weekday`);
        }
    },
    'Date', 'Extract part from date (year, month, day, hour, minute, second, weekday)',
    [
        { name: 'part', label: 'Date Part', type: 'string', required: true, default: 'year' }
    ]
);

registerOperation('addDays', 
    (val, days) => {
        const date = new Date(val);
        if (isNaN(date.getTime())) throw new Error(`Cannot add days to date: "${val}"`);
        const daysNum = parseInt(days);
        if (isNaN(daysNum)) throw new Error(`Invalid days value: "${days}". Must be a number.`);
        date.setDate(date.getDate() + daysNum);
        return date.toISOString().split('T')[0]; // Return as YYYY-MM-DD
    },
    'Date', 'Add/subtract days from date',
    [
        { name: 'days', label: 'Days to Add', type: 'number', required: true, default: 1 }
    ]
);

registerOperation('dateDiff', 
    (val, compareDate, unit) => {
        const date1 = new Date(val);
        if (isNaN(date1.getTime())) throw new Error(`Cannot parse first date: "${val}"`);
        const date2 = compareDate && compareDate !== 'now' ? new Date(compareDate) : new Date();
        if (isNaN(date2.getTime())) throw new Error(`Cannot parse second date: "${compareDate}"`);
        
        const diffMs = Math.abs(date2 - date1);
        const u = (unit || 'days').toLowerCase();
        if (u === 'hours') return diffMs / (1000 * 60 * 60);
        if (u === 'days') return diffMs / (1000 * 60 * 60 * 24);
        if (u === 'weeks') return diffMs / (1000 * 60 * 60 * 24 * 7);
        if (u === 'months') return diffMs / (1000 * 60 * 60 * 24 * 30.44);
        if (u === 'years') return diffMs / (1000 * 60 * 60 * 24 * 365.25);
        return diffMs / (1000 * 60 * 60 * 24);
    },
    'Date', 'Difference between dates (hours, days, weeks, months, years)',
    [
        { name: 'compareDate', label: 'Compare Date (or "now")', type: 'string', required: false, default: 'now' },
        { name: 'unit', label: 'Unit (hours/days/weeks/months/years)', type: 'string', required: false, default: 'days' }
    ]
);

// ─── DATA QUALITY OPERATIONS ──────────────────────────────────────────

registerOperation('coalesce', 
    (val, fallback) => {
        if (val === null || val === undefined || val === '') {
            return fallback || '';
        }
        return val;
    },
    'Data Quality', 'Replace null/empty with fallback value',
    [
        { name: 'fallback', label: 'Fallback Value', type: 'string', required: true }
    ]
);

registerOperation('isNull', 
    (val) => (val === null || val === undefined || val === '') ? 1 : 0,
    'Data Quality', 'Check if value is null/empty (returns 1 or 0)'
);

registerOperation('isNumeric', 
    (val) => {
        if (val === null || val === undefined || val === '') return 0;
        return !isNaN(parseFloat(val)) && isFinite(val) ? 1 : 0;
    },
    'Data Quality', 'Check if value is numeric (returns 1 or 0)'
);

registerOperation('isEmail', 
    (val) => {
        if (val === null || val === undefined || val === '') return 0;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(String(val)) ? 1 : 0;
    },
    'Data Quality', 'Check if value is an email (returns 1 or 0)'
);

registerOperation('isPhone', 
    (val) => {
        if (val === null || val === undefined || val === '') return 0;
        const phoneRegex = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
        return phoneRegex.test(String(val)) ? 1 : 0;
    },
    'Data Quality', 'Check if value is a phone number (returns 1 or 0)'
);

registerOperation('mask', 
    (val, start, end, maskChar) => {
        const str = String(val);
        const s = parseInt(start);
        if (isNaN(s) || s < 0) {
            throw new Error(`Invalid start position: "${start}". Must be non-negative.`);
        }
        const e = parseInt(end);
        if (isNaN(e) || e < s) {
            throw new Error(`Invalid end position: "${end}". Must be greater than start.`);
        }
        const mask = maskChar || '*';
        const visibleStart = str.substring(0, s);
        const visibleEnd = str.substring(Math.min(e, str.length));
        const maskedLength = Math.min(e - s, str.length - s);
        return visibleStart + mask.repeat(Math.max(0, maskedLength)) + visibleEnd;
    },
    'Data Quality', 'Mask sensitive data with character',
    [
        { name: 'start', label: 'Start Position', type: 'number', required: true },
        { name: 'end', label: 'End Position', type: 'number', required: true },
        { name: 'maskChar', label: 'Mask Character', type: 'string', required: false, default: '*' }
    ]
);

// ─── COMPARISON OPERATIONS ─────────────────────────────────────────────

registerOperation('eq', 
    (val, compare) => (val == compare) ? 1 : 0,
    'Comparison', 'Equal to (==) returns 1 or 0',
    [
        { name: 'compare', label: 'Compare Value', type: 'string', required: true }
    ]
);

registerOperation('neq', 
    (val, compare) => (val != compare) ? 1 : 0,
    'Comparison', 'Not equal to (!=) returns 1 or 0',
    [
        { name: 'compare', label: 'Compare Value', type: 'string', required: true }
    ]
);

registerOperation('gt', 
    (val, compare) => {
        const num1 = parseFloat(val);
        const num2 = parseFloat(compare);
        if (isNaN(num1) || isNaN(num2)) {
            return String(val) > String(compare) ? 1 : 0;
        }
        return num1 > num2 ? 1 : 0;
    },
    'Comparison', 'Greater than (>) returns 1 or 0',
    [
        { name: 'compare', label: 'Compare Value', type: 'string', required: true }
    ]
);

registerOperation('gte', 
    (val, compare) => {
        const num1 = parseFloat(val);
        const num2 = parseFloat(compare);
        if (isNaN(num1) || isNaN(num2)) {
            return String(val) >= String(compare) ? 1 : 0;
        }
        return num1 >= num2 ? 1 : 0;
    },
    'Comparison', 'Greater than or equal (>=) returns 1 or 0',
    [
        { name: 'compare', label: 'Compare Value', type: 'string', required: true }
    ]
);

registerOperation('lt', 
    (val, compare) => {
        const num1 = parseFloat(val);
        const num2 = parseFloat(compare);
        if (isNaN(num1) || isNaN(num2)) {
            return String(val) < String(compare) ? 1 : 0;
        }
        return num1 < num2 ? 1 : 0;
    },
    'Comparison', 'Less than (<) returns 1 or 0',
    [
        { name: 'compare', label: 'Compare Value', type: 'string', required: true }
    ]
);

registerOperation('lte', 
    (val, compare) => {
        const num1 = parseFloat(val);
        const num2 = parseFloat(compare);
        if (isNaN(num1) || isNaN(num2)) {
            return String(val) <= String(compare) ? 1 : 0;
        }
        return num1 <= num2 ? 1 : 0;
    },
    'Comparison', 'Less than or equal (<=) returns 1 or 0',
    [
        { name: 'compare', label: 'Compare Value', type: 'string', required: true }
    ]
);

// ─── CONDITIONAL OPERATIONS ────────────────────────────────────────────

registerOperation('ifThen', 
    (val, conditionValue, trueResult, falseResult) => {
        if (conditionValue === undefined || conditionValue === '') {
            throw new Error('Condition value is required');
        }
        const result = (val == conditionValue) ? 
            (trueResult !== undefined ? trueResult : '') : 
            (falseResult !== undefined ? falseResult : '');
        return result;
    },
    'Conditional', 'If value equals condition, return true value, else false value',
    [
        { name: 'conditionValue', label: 'Condition Value', type: 'string', required: true },
        { name: 'trueResult', label: 'If True', type: 'string', required: true },
        { name: 'falseResult', label: 'If False', type: 'string', required: true }
    ]
);

// ─── EXPORT ─────────────────────────────────────────────────────────────

module.exports = {
    OPERATIONS,
    registerOperation
};
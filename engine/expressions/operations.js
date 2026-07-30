/**
 * Expression operations available for CSV column transforms.
 *
 * Every function takes `value` as the first argument (the current cell value)
 * followed by zero or more operands supplied by the user.  Functions must be
 * pure and must never mutate their arguments.
 *
 * Numeric helpers coerce with Number(); string helpers coerce with String() so
 * they work correctly regardless of the column's inferred type from PapaParse.
 */

// ─── Numeric ────────────────────────────────────────────────────────────────

/**
 * @param {*} value
 * @param {*} operand
 */
function add(value, operand) {
    return Number(value) + Number(operand);
}

/**
 * @param {*} value
 * @param {*} operand
 */
function subtract(value, operand) {
    return Number(value) - Number(operand);
}

/**
 * @param {*} value
 * @param {*} operand
 */
function multiply(value, operand) {
    return Number(value) * Number(operand);
}

/**
 * @param {*} value
 * @param {*} operand
 */
function divide(value, operand) {
    if (Number(operand) === 0) {
        throw new Error("Division by zero is not allowed.");
    }
    return Number(value) / Number(operand);
}

/**
 * @param {*} value
 * @param {*} exponent
 */
function power(value, exponent) {
    return Math.pow(Number(value), Number(exponent));
}

/**
 * Round a number to `decimals` decimal places (default 0).
 * @param {*} value
 * @param {number|string} [decimals=0]
 */
function round(value, decimals) {
    const d = decimals === undefined ? 0 : Number(decimals);
    const factor = Math.pow(10, d);
    return Math.round(Number(value) * factor) / factor;
}

/**
 * Absolute value of a number.
 * @param {*} value
 */
function abs(value) {
    return Math.abs(Number(value));
}

// ─── String ─────────────────────────────────────────────────────────────────

/**
 * @param {*} value
 * @param {*} operand
 */
function concat(value, operand) {
    return String(value) + String(operand);
}

/**
 * @param {*} value
 */
function upper(value) {
    return String(value).toUpperCase();
}

/**
 * @param {*} value
 */
function lower(value) {
    return String(value).toLowerCase();
}

/**
 * @param {*} value
 */
function trim(value) {
    return String(value).trim();
}

/**
 * Extract a portion of text.
 * @param {*} value
 * @param {number|string} start  zero-based start index
 * @param {number|string} [length]  number of characters to extract (optional)
 */
function substring(value, start, length) {
    const text = String(value);
    const s = Number(start);
    if (length === undefined || length === "") {
        return text.substring(s);
    }
    return text.substring(s, s + Number(length));
}

/**
 * Replace every occurrence of `search` with `replacement`.
 * @param {*} value
 * @param {string} search
 * @param {string} replacement
 */
function replace(value, search, replacement) {
    // replaceAll is ES2021; use split/join for broader compatibility.
    return String(value).split(String(search)).join(String(replacement));
}

/**
 * Number of characters in the string representation of the value.
 * @param {*} value
 */
function len(value) {
    return String(value).length;
}

/**
 * Left-pad a string to `targetLength` using `padChar` (default space).
 * @param {*} value
 * @param {number|string} targetLength
 * @param {string} [padChar=" "]
 */
function padStart(value, targetLength, padChar) {
    return String(value).padStart(Number(targetLength), padChar || " ");
}

/**
 * Right-pad a string to `targetLength` using `padChar` (default space).
 * @param {*} value
 * @param {number|string} targetLength
 * @param {string} [padChar=" "]
 */
function padEnd(value, targetLength, padChar) {
    return String(value).padEnd(Number(targetLength), padChar || " ");
}

// ─── Boolean / Conditional ──────────────────────────────────────────────────

/**
 * Returns `value` if it is not null/undefined/"", otherwise returns `fallback`.
 * @param {*} value
 * @param {*} fallback
 */
function coalesce(value, fallback) {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }
    return value;
}

/**
 * Returns `"true"` or `"false"` indicating whether the string starts with `prefix`.
 * @param {*} value
 * @param {string} prefix
 */
function startsWith(value, prefix) {
    return String(value).startsWith(String(prefix));
}

/**
 * Returns `"true"` or `"false"` indicating whether the string ends with `suffix`.
 * @param {*} value
 * @param {string} suffix
 */
function endsWith(value, suffix) {
    return String(value).endsWith(String(suffix));
}

/**
 * Returns `true` or `false` indicating whether the string contains `needle`.
 * @param {*} value
 * @param {string} needle
 */
function contains(value, needle) {
    return String(value).includes(String(needle));
}

// ─── Metadata (used by the evaluator to present the command palette) ─────────

/**
 * Descriptor for every operation.
 * `params` lists the extra arguments beyond `value` that the user must supply.
 * `category` is used to group operations in the quick-pick UI.
 *
 * @type {Record<string, { fn: Function, label: string, category: string, params: {name:string, placeholder:string}[] }>}
 */
const OPERATIONS = {
    // Numeric
    add:       { fn: add,       label: "Add (+)",            category: "Numeric",     params: [{ name: "operand",      placeholder: "e.g. 10"        }] },
    subtract:  { fn: subtract,  label: "Subtract (-)",       category: "Numeric",     params: [{ name: "operand",      placeholder: "e.g. 5"         }] },
    multiply:  { fn: multiply,  label: "Multiply (×)",       category: "Numeric",     params: [{ name: "operand",      placeholder: "e.g. 2"         }] },
    divide:    { fn: divide,    label: "Divide (÷)",         category: "Numeric",     params: [{ name: "operand",      placeholder: "e.g. 4 (≠ 0)"   }] },
    power:     { fn: power,     label: "Power (^)",          category: "Numeric",     params: [{ name: "exponent",     placeholder: "e.g. 2"         }] },
    round:     { fn: round,     label: "Round",              category: "Numeric",     params: [{ name: "decimal places", placeholder: "e.g. 2"       }] },
    abs:       { fn: abs,       label: "Absolute Value",     category: "Numeric",     params: []                                                        },

    // String
    concat:    { fn: concat,    label: "Concat (append)",    category: "String",      params: [{ name: "text to append", placeholder: "e.g. _2024"   }] },
    upper:     { fn: upper,     label: "UPPER CASE",         category: "String",      params: []                                                        },
    lower:     { fn: lower,     label: "lower case",         category: "String",      params: []                                                        },
    trim:      { fn: trim,      label: "Trim whitespace",    category: "String",      params: []                                                        },
    substring: { fn: substring, label: "Substring",          category: "String",      params: [{ name: "start index",  placeholder: "e.g. 0"         },
                                                                                                { name: "length",        placeholder: "e.g. 5 (optional)" }] },
    replace:   { fn: replace,   label: "Replace",            category: "String",      params: [{ name: "search",       placeholder: "text to find"   },
                                                                                                { name: "replacement",   placeholder: "replace with"   }] },
    len:       { fn: len,       label: "Length (char count)", category: "String",     params: []                                                        },
    padStart:  { fn: padStart,  label: "Pad Start (left)",   category: "String",      params: [{ name: "target length", placeholder: "e.g. 10"        },
                                                                                                { name: "pad character",  placeholder: "e.g. 0 (optional)" }] },
    padEnd:    { fn: padEnd,    label: "Pad End (right)",    category: "String",      params: [{ name: "target length", placeholder: "e.g. 10"        },
                                                                                                { name: "pad character",  placeholder: "e.g. - (optional)" }] },

    // Conditional
    coalesce:   { fn: coalesce,   label: "Coalesce (fallback)",   category: "Conditional", params: [{ name: "fallback value", placeholder: "e.g. N/A"  }] },
    startsWith: { fn: startsWith, label: "Starts With (check)",   category: "Conditional", params: [{ name: "prefix",         placeholder: "e.g. Mr."  }] },
    endsWith:   { fn: endsWith,   label: "Ends With (check)",     category: "Conditional", params: [{ name: "suffix",         placeholder: "e.g. .com" }] },
    contains:   { fn: contains,   label: "Contains (check)",      category: "Conditional", params: [{ name: "needle",         placeholder: "e.g. error" }] },
};

module.exports = {
    // Individual functions (used by evaluator)
    add,
    subtract,
    multiply,
    divide,
    power,
    round,
    abs,
    concat,
    upper,
    lower,
    trim,
    substring,
    replace,
    len,
    padStart,
    padEnd,
    coalesce,
    startsWith,
    endsWith,
    contains,
    // Metadata map (used by the command palette UI)
    OPERATIONS,
};

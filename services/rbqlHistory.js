/**
 * services/rbqlHistory.js
 *
 * Pure helpers for the RBQL query history: schema versioning/migration,
 * de-duplication, pinning and trimming. No VS Code dependency so the logic
 * can be unit-tested; the command layer is responsible for persistence.
 *
 * Stored shape (schema v2):
 *   { version: 2, entries: HistoryEntry[] }
 *
 * Legacy shape (v1) was a bare array of strings or entry objects; it is
 * migrated transparently on load.
 */

'use strict';

const SCHEMA_VERSION = 2;

/** Maximum number of un-pinned entries kept. Pinned entries are never trimmed. */
const MAX_UNPINNED = 100;

/**
 * @typedef {{
 *   query: string,
 *   timestamp: number | null,
 *   success: boolean,
 *   rowCount: number | null,
 *   durationMs: number | null,
 *   sourceFile: string,
 *   pinned: boolean,
 * }} HistoryEntry
 */

/**
 * @param {any} value
 * @returns {number | null}
 */
function finiteOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Coerce an arbitrary stored value into a well-formed entry, or null if it
 * has no usable query text.
 *
 * @param {any} item
 * @returns {HistoryEntry | null}
 */
function normalizeEntry(item) {
    if (typeof item === 'string') item = { query: item };
    if (!item || typeof item.query !== 'string' || !item.query.trim()) return null;
    return {
        query: item.query,
        timestamp: finiteOrNull(item.timestamp),
        success: item.success !== false,
        rowCount: finiteOrNull(item.rowCount),
        durationMs: finiteOrNull(item.durationMs),
        sourceFile: typeof item.sourceFile === 'string' ? item.sourceFile : '',
        pinned: item.pinned === true,
    };
}

/**
 * Drop duplicate queries (first occurrence wins) and keep pinned entries
 * plus the most recent MAX_UNPINNED others. Order is preserved.
 *
 * @param {HistoryEntry[]} entries
 * @returns {HistoryEntry[]}
 */
function tidy(entries) {
    const seen = new Set();
    const unique = [];
    for (const entry of entries) {
        if (seen.has(entry.query)) continue;
        seen.add(entry.query);
        unique.push(entry);
    }
    let unpinnedKept = 0;
    return unique.filter(entry => {
        if (entry.pinned) return true;
        unpinnedKept += 1;
        return unpinnedKept <= MAX_UNPINNED;
    });
}

/**
 * Convert whatever was persisted (nothing, a v1 array, or a v2 object) into
 * a clean entry list. Unknown/newer versions are read best-effort rather
 * than discarded.
 *
 * @param {any} stored
 * @returns {HistoryEntry[]}
 */
function fromStored(stored) {
    let raw = [];
    if (Array.isArray(stored)) {
        raw = stored;
    } else if (stored && typeof stored === 'object' && Array.isArray(stored.entries)) {
        raw = stored.entries;
    }
    return tidy(raw.map(normalizeEntry).filter(Boolean));
}

/**
 * Wrap entries in the current versioned envelope for persistence.
 *
 * @param {HistoryEntry[]} entries
 * @returns {{ version: number, entries: HistoryEntry[] }}
 */
function toStored(entries) {
    return { version: SCHEMA_VERSION, entries: tidy(entries) };
}

/**
 * Insert or refresh an entry. A re-run of an existing query moves it to the
 * front but keeps its pinned state.
 *
 * @param {HistoryEntry[]} entries
 * @param {any} entry
 * @returns {HistoryEntry[]}
 */
function upsert(entries, entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized) return entries;
    const previous = entries.find(item => item.query === normalized.query);
    const merged = { ...normalized, pinned: previous ? previous.pinned : normalized.pinned };
    return tidy([merged, ...entries.filter(item => item.query !== merged.query)]);
}

/**
 * @param {HistoryEntry[]} entries
 * @param {string} query
 * @returns {HistoryEntry[]}
 */
function remove(entries, query) {
    return entries.filter(item => item.query !== query);
}

/**
 * Flip the pinned flag of one entry.
 *
 * @param {HistoryEntry[]} entries
 * @param {string} query
 * @returns {HistoryEntry[]}
 */
function togglePin(entries, query) {
    return tidy(entries.map(item =>
        item.query === query ? { ...item, pinned: !item.pinned } : item
    ));
}

/**
 * Clear history. Pinned entries survive unless `includePinned` is set.
 *
 * @param {HistoryEntry[]} entries
 * @param {{ includePinned?: boolean }} [opts]
 * @returns {HistoryEntry[]}
 */
function clear(entries, opts = {}) {
    return opts.includePinned ? [] : entries.filter(item => item.pinned);
}

/**
 * Display order: pinned entries first, each group newest-first (the stored
 * order is already newest-first, and Array#sort is stable).
 *
 * @param {HistoryEntry[]} entries
 * @returns {HistoryEntry[]}
 */
function ordered(entries) {
    return entries
        .slice()
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
}

module.exports = {
    SCHEMA_VERSION,
    MAX_UNPINNED,
    normalizeEntry,
    fromStored,
    toStored,
    upsert,
    remove,
    togglePin,
    clear,
    ordered,
};

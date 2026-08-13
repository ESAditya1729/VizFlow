const Papa = require("papaparse");
const Dataset = require("../engine/dataset");

const MAX_INPUT_CHARS = 100 * 1024 * 1024; // 100 MB of text
const MAX_ROWS = 5000000;                   // 5 million rows

/**
 * Detect the delimiter used in a delimited text file.
 * Counts occurrences of tab, pipe, and comma in the first non-empty line
 * and returns whichever appears most often.
 * Falls back to comma when there is a tie or no candidate is found.
 *
 * @param {string} text
 * @returns {string}
 */
function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/).find(l => l.trim().length > 0) || "";

    const candidates = [
        { delimiter: "\t", count: (firstLine.match(/\t/g) || []).length },
        { delimiter: "|",  count: (firstLine.match(/\|/g) || []).length },
        { delimiter: ",",  count: (firstLine.match(/,/g)  || []).length },
    ];

    const best = candidates.reduce((a, b) => (b.count > a.count ? b : a));
    return best.count > 0 ? best.delimiter : ",";
}

/**
 * @param {string} csvText
 * @returns {import("../engine/dataset")}
 */
function parse(csvText) {

    if (typeof csvText !== 'string') {
        throw new Error('CSV parser: input must be a string');
    }

    if (csvText.length > MAX_INPUT_CHARS) {
        const sizeMb = (csvText.length / (1024 * 1024)).toFixed(1);
        throw new Error(`CSV input is too large (${sizeMb} MB). Maximum supported size is 100 MB.`);
    }

    const delimiter = detectDelimiter(csvText);

    const result = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        delimiter
    });

    if (result.errors.length > 0) {
        throw new Error(result.errors[0].message);
    }

    if (result.data.length > MAX_ROWS) {
        throw new Error(`CSV has too many rows (${result.data.length}). Maximum supported is ${MAX_ROWS.toLocaleString()} rows.`);
    }

    return new Dataset(
        result.data,
        result.meta.fields || []
    );
}

module.exports = {
    parse,
    detectDelimiter
};
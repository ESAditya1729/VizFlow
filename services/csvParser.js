const Papa = require("papaparse");
const Dataset = require("../engine/dataset");

/**
 * @param {string} csvText
 */
function parse(csvText) {

    const result = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true
    });

    if (result.errors.length > 0) {
        throw new Error(result.errors[0].message);
    }

    return new Dataset(
        result.data,
        result.meta.fields || []
    );
}

module.exports = {
    parse
};
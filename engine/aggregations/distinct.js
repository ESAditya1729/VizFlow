/**
 * @param {any[]} rows
 * @param {string | number} column
 */
function distinctValues(rows, column) {
    const values = rows
        .map(row => row[column])
        .filter(value => value !== undefined);

    return [...new Set(values)];
}

module.exports = distinctValues;
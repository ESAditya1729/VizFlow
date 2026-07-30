/**
 * @param {any[]} rows
 * @param {string | number} column
 */
function min(rows, column) {

    const numericValues = rows
        .map(row => row[column])
        .filter(value => typeof value === "number");

    if (numericValues.length === 0) {
        return null;
    }

    return Math.min(...numericValues);
}

/**
 * @param {any[]} rows
 * @param {string | number} column
 */
function max(rows, column) {

    const numericValues = rows
        .map(row => row[column])
        .filter(value => typeof value === "number");

    if (numericValues.length === 0) {
        return null;
    }

    return Math.max(...numericValues);
}

/**
 * @param {any[]} rows
 * @param {string | number} column
 */
function count(rows, column) {

    return rows.filter(row => {

        const value = row[column];

        return value !== null &&
               value !== undefined &&
               value !== "";

    }).length;

}

module.exports = {
    min,
    max,
    count
};
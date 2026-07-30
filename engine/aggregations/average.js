/**
 * @param {any[]} rows
 * @param {string | number} column
 */
function average(rows, column) {

    const numericValues = rows
        .map(row => row[column])
        .filter(value => typeof value === "number");

    if (numericValues.length === 0) {
        return 0;
    }

    const total = numericValues.reduce(
        (sum, value) => sum + value,
        0
    );

    return total / numericValues.length;
}

module.exports = average;
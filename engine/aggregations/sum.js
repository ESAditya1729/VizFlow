/**
 * @param {any[]} rows
 * @param {string | number} column
 */
function sum(rows, column) {

    return rows.reduce((total, row) => {

        const value = row[column];

        if (typeof value !== "number") {
            return total;
        }

        return total + value;

    }, 0);

}

module.exports = sum;
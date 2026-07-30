// @ts-nocheck
/**
 * Finds duplicate values in a column.
 *
 * @param {any[]} rows
 * @param {string|number} column
 * @returns {Array}
 */
function findDuplicates(rows, column) {

    const valueMap = new Map();

    rows.forEach((row, index) => {

        const value = row[column];

        if (value === null || value === undefined || value === "") {
            return;
        }

        if (!valueMap.has(value)) {

            valueMap.set(value, {
                value,
                count: 1,
                rows: [index + 2]     // +2 because row 1 is the CSV header
            });

        } else {

            const item = valueMap.get(value);

            item.count++;
            item.rows.push(index + 2);

        }

    });

    return [...valueMap.values()]
        .filter(item => item.count > 1);

}

module.exports = {
    findDuplicates
};
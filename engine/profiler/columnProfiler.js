/**
 * @param {{ findDuplicates: (arg0: any) => any; count: (arg0: any) => any; sum: (arg0: any) => any; average: (arg0: any) => any; min: (arg0: any) => any; max: (arg0: any) => any; }} dataset
 * @param {any} column
 */
function profile(dataset, column) {

    const duplicates = dataset.findDuplicates(column);

    return {

        column,

        count: dataset.count(column),

        sum: dataset.sum(column),

        average: dataset.average(column),

        min: dataset.min(column),

        max: dataset.max(column),

        duplicateValues: duplicates.length,

        duplicateRows: duplicates.reduce(
            (/** @type {any} */ total, /** @type {{ count: any; }} */ item) => total + item.count,
            0
        ),
        duplicates

    };

}

module.exports = {
    profile
};
const sum = require("./aggregations/sum");
const average = require("./aggregations/average");
const statistics = require("./aggregations/statistics");
const duplicateFinder = require("./duplicateFinder");
const columnProfiler = require("./profiler/columnProfiler");
const distinctValues = require('./aggregations/distinct');

class Dataset {

    /**
     * @param {any[]} rows
     * @param {string[]} columns
     */
    constructor(rows, columns) {
        this.rows = rows;
        this.columns = columns;
    }

    getRowCount() {
        return this.rows.length;
    }

    getColumnCount() {
        return this.columns.length;
    }

    getColumns() {
        return this.columns;
    }

    /**
     * @param {string | number} column
     */
    sum(column) {
        return sum(this.rows, column);
    }
    /**
     * @param {string | number} column
     */
    average(column) {
        return average(this.rows, column);
    }

    /**
     * @param {string | number} column
     */
    min(column) {
        return statistics.min(this.rows, column);
    }

    /**
     * @param {string | number} column
     */
    max(column) {
        return statistics.max(this.rows, column);
    }

    /**
     * @param {string | number} column
     */
    count(column) {
        // @ts-ignore
        return statistics.count(this.rows, column);
    }

    getNumericColumns() {

        return this.columns.filter(column => {

            return this.rows.every(row => {

                const value = row[column];

                return value === null ||
                    value === undefined ||
                    typeof value === "number";

            });

        });

    }

    /**
     * @param {string | number} column
     */
    findDuplicates(column) {
        return duplicateFinder.findDuplicates(this.rows, column);
    }

    /**
     * @param {string | number} column
     */
    // getStatistics(column) {

    //     const duplicates = this.findDuplicates(column);

    //     return {

    //         count: this.count(column),

    //         sum: this.sum(column),

    //         average: this.average(column),

    //         min: this.min(column),

    //         max: this.max(column),

    //         duplicateValues: duplicates.length,

    //         duplicateRows: duplicates.reduce(
    //             (total, item) => total + item.count,
    //             0
    //         ),
    //         duplicates

    //     };

    // }

    /**
 * @param {string | number} column
 */
    profileColumn(column) {
        return columnProfiler.profile(this, column);
    }

    /**
     * @param {string | number} column
     */
    distinctValues(column) {
        const values = distinctValues(this.rows, column);
        return { values, count: values.length };
    }

}

module.exports = Dataset;
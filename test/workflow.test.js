const assert = require('assert');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { executeWorkflow, validateWorkflow } = require('../engine/workflow/workflowEngine');
const { getActivities, getActivity } = require('../engine/workflow/activityRegistry');
const templateService = require('../services/templateService');
const { SchedulerEngine } = require('../engine/scheduler/schedulerEngine');

suite('Workflow Engine Test Suite', () => {
    const testDir = path.join(__dirname, 'temp_test_workflow');
    const inputCsvPath = path.join(testDir, 'input.csv');
    const outputCsvPath = path.join(testDir, 'output.csv');
    const ifElseOutputPath = path.join(testDir, 'if_else_output.csv');
    const forEachOutputPath = path.join(testDir, 'for_each_output.csv');
    const inputXlsxPath = path.join(testDir, 'input.xlsx');

    suiteSetup(async () => {
        if (!fs.existsSync(testDir)) {
            await fs.promises.mkdir(testDir, { recursive: true });
        }
        // Write standard test input CSV
        const csvContent = [
            'id,name,age,salary',
            '1,Alice,30,50000',
            '2,Bob,25,60000',
            '3,Charlie,35,70000',
            '4,Bob,25,60000', // duplicate
            '5,Eve,22,45000'
        ].join('\n');
        await fs.promises.writeFile(inputCsvPath, csvContent, 'utf8');

        // Write a test Excel file:
        //   Row 1-3: title/metadata rows (to verify headerRow/startRow offsets)
        //   Row 4:   header  →  id | name | Check Date | amount
        //   Row 5-7: data    →  3 data rows with Excel date serials in col 3
        //   Row 8:   footer total row (to verify skipFooter)
        // Excel serial 46237 = 2026-08-03, 46240 = 2026-08-06
        const ws = XLSX.utils.aoa_to_sheet([
            ['Report Title', '', '', ''],          // row 1
            ['Generated: today', '', '', ''],       // row 2
            ['', '', '', ''],                       // row 3
            ['id', 'name', 'Check Date', 'amount'], // row 4 header
            [1, 'Alice', 46237, 100],               // row 5 data
            [2, 'Bob',   46240, 200],               // row 6 data
            [3, 'Carol', 46237, 150],               // row 7 data
            ['', '', '', 450]                       // row 8 footer total
        ]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        XLSX.writeFile(wb, inputXlsxPath);
    });

    suiteTeardown(async () => {
        if (fs.existsSync(inputCsvPath)) {
            await fs.promises.unlink(inputCsvPath);
        }
        if (fs.existsSync(outputCsvPath)) {
            await fs.promises.unlink(outputCsvPath);
        }
        if (fs.existsSync(ifElseOutputPath)) {
            await fs.promises.unlink(ifElseOutputPath);
        }
        if (fs.existsSync(forEachOutputPath)) {
            await fs.promises.unlink(forEachOutputPath);
        }
        if (fs.existsSync(inputXlsxPath)) {
            await fs.promises.unlink(inputXlsxPath);
        }
        // Remove anything else left behind (e.g. scheduler config files)
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    test('Registry can retrieve all available activities', () => {
        const list = getActivities();
        assert.ok(list.length >= 8, 'Should have at least 8 activities');
        
        const types = list.map(a => a.type);
        assert.ok(types.includes('readCsv'));
        assert.ok(types.includes('readExcel'));
        assert.ok(types.includes('filter'));
        assert.ok(types.includes('transform'));
        assert.ok(types.includes('query'));
        assert.ok(types.includes('aggregate'));
        assert.ok(types.includes('removeDuplicates'));
        assert.ok(types.includes('writeCsv'));
    });

    test('Validates complete workflow definition correctly', () => {
        const validDef = {
            name: 'Test Workflow',
            version: '1.0.0',
            activities: [
                {
                    id: 'read_1',
                    type: 'readCsv',
                    config: { filePath: inputCsvPath }
                },
                {
                    id: 'write_1',
                    type: 'writeCsv',
                    config: { filePath: outputCsvPath }
                }
            ]
        };

        const result = validateWorkflow(validDef);
        assert.strictEqual(result.valid, true, `Should be valid: ${result.error}`);
    });

    test('Identifies missing required parameters in validation', () => {
        const invalidDef = {
            name: 'Test Workflow',
            version: '1.0.0',
            activities: [
                {
                    id: 'read_1',
                    type: 'readCsv',
                    config: {} // missing filePath
                }
            ]
        };

        const result = validateWorkflow(invalidDef);
        assert.strictEqual(result.valid, false);
        assert.ok(result.error.includes('filePath'));
    });

    test('Validates nested ifElse and forEach blocks recursively', () => {
        const nestedWorkflow = {
            name: 'Nested Control Flow Workflow',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_read',
                    type: 'readCsv',
                    config: { filePath: inputCsvPath }
                },
                {
                    id: 'step_if',
                    type: 'ifElse',
                    config: {
                        column: 'age',
                        operator: '>=',
                        value: '25',
                        thenSteps: [
                            {
                                id: 'step_then_transform',
                                type: 'transform',
                                config: {
                                    column: 'salary',
                                    opKey: 'add',
                                    params: ['1000']
                                }
                            }
                        ],
                        elseSteps: [
                            {
                                id: 'step_else_filter',
                                type: 'filter',
                                config: {
                                    column: 'age',
                                    operator: '<',
                                    value: '25'
                                }
                            }
                        ]
                    }
                },
                {
                    id: 'step_foreach',
                    type: 'forEach',
                    config: {
                        groupBy: 'name',
                        sortGroups: 'none',
                        steps: [
                            {
                                id: 'step_group_transform',
                                type: 'transform',
                                config: {
                                    column: 'salary',
                                    opKey: 'add',
                                    params: ['1']
                                }
                            }
                        ]
                    }
                }
            ]
        };

        const result = validateWorkflow(nestedWorkflow);
        assert.strictEqual(result.valid, true, `Nested workflow should validate: ${result.error}`);
    });

    test('Executes ifElse and forEach control-flow blocks correctly', async () => {
        const ifElseWorkflow = {
            name: 'If Else Test',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_read',
                    type: 'readCsv',
                    config: { filePath: inputCsvPath }
                },
                {
                    id: 'step_if',
                    type: 'ifElse',
                    config: {
                        column: 'age',
                        operator: '>=',
                        value: '25',
                        thenSteps: [
                            {
                                id: 'step_then_transform',
                                type: 'transform',
                                config: {
                                    column: 'salary',
                                    opKey: 'add',
                                    params: ['1000']
                                }
                            }
                        ],
                        elseSteps: [
                            {
                                id: 'step_else_transform',
                                type: 'transform',
                                config: {
                                    column: 'salary',
                                    opKey: 'subtract',
                                    params: ['500']
                                }
                            }
                        ]
                    }
                },
                {
                    id: 'step_write',
                    type: 'writeCsv',
                    config: { filePath: ifElseOutputPath }
                }
            ]
        };

        const ifElseExecution = await executeWorkflow(ifElseWorkflow);
        assert.strictEqual(ifElseExecution.success, true, `ifElse workflow failed: ${ifElseExecution.error}`);
        assert.ok(fs.existsSync(ifElseOutputPath));

        const forEachWorkflow = {
            name: 'For Each Test',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_read',
                    type: 'readCsv',
                    config: { filePath: inputCsvPath }
                },
                {
                    id: 'step_group',
                    type: 'forEach',
                    config: {
                        groupBy: 'name',
                        sortGroups: 'none',
                        steps: [
                            {
                                id: 'step_group_transform',
                                type: 'transform',
                                config: {
                                    column: 'salary',
                                    opKey: 'add',
                                    params: ['100']
                                }
                            }
                        ]
                    }
                },
                {
                    id: 'step_write',
                    type: 'writeCsv',
                    config: { filePath: forEachOutputPath }
                }
            ]
        };

        const forEachExecution = await executeWorkflow(forEachWorkflow);
        assert.strictEqual(forEachExecution.success, true, `forEach workflow failed: ${forEachExecution.error}`);
        assert.ok(fs.existsSync(forEachOutputPath));
    });

    test('Executes a sequential workflow successfully', async () => {
        const workflowDef = {
            name: 'Sequential ETL Workflow',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_read',
                    type: 'readCsv',
                    config: { filePath: inputCsvPath }
                },
                {
                    id: 'step_remove_dupes',
                    type: 'removeDuplicates',
                    config: { column: 'name' }
                },
                {
                    id: 'step_filter',
                    type: 'filter',
                    config: {
                        column: 'age',
                        operator: '>=',
                        value: '25'
                    }
                },
                {
                    id: 'step_transform',
                    type: 'transform',
                    config: {
                        column: 'salary',
                        opKey: 'multiply',
                        params: ['1.1']
                    }
                },
                {
                    id: 'step_write',
                    type: 'writeCsv',
                    config: { filePath: outputCsvPath }
                }
            ]
        };

        const states = [];
        const stateChanges = {};
        const onStateChange = (id, state, stats, error) => {
            states.push({ id, state, stats, error });
            if (!stateChanges[id]) {
                stateChanges[id] = [];
            }
            stateChanges[id].push(state);
        };

        const execution = await executeWorkflow(workflowDef, { onStateChange });
        assert.strictEqual(execution.success, true, `Execution failed: ${execution.error}`);

        // Verify state transitions for each step
        assert.ok(stateChanges['step_read'].includes('Pending'));
        assert.ok(stateChanges['step_read'].includes('Running'));
        assert.ok(stateChanges['step_read'].includes('Completed'));

        assert.ok(stateChanges['step_write'].includes('Pending'));
        assert.ok(stateChanges['step_write'].includes('Running'));
        assert.ok(stateChanges['step_write'].includes('Completed'));

        // Verify the file was written
        assert.ok(fs.existsSync(outputCsvPath));
        const fileContent = await fs.promises.readFile(outputCsvPath, 'utf8');
        
        // Let's parse output and check content
        // Input:
        // 1,Alice,30,50000 -> keep
        // 2,Bob,25,60000 -> keep
        // 3,Charlie,35,70000 -> keep
        // 4,Bob,25,60000 -> removed by removeDuplicates on 'name' (Bob already seen)
        // 5,Eve,22,45000 -> filtered out (age 22 is < 25)
        // Salary for kept rows multiplied by 1.1:
        // Alice: 50000 * 1.1 = 55000
        // Bob: 60000 * 1.1 = 66000
        // Charlie: 70000 * 1.1 = 77000

        const lines = fileContent.trim().split('\n');
        assert.strictEqual(lines.length, 4, 'Should be header + 3 data rows');
        assert.ok(lines[0].includes('id,name,age,salary'));
        assert.ok(lines[1].includes('1,Alice,30,55000'));
        assert.ok(lines[2].includes('2,Bob,25,66000'));
        assert.ok(lines[3].includes('3,Charlie,35,77000'));
    });

    test('Query / RBQL activity works correctly in workflow', async () => {
        const workflowDef = {
            name: 'RBQL Query Workflow',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_read',
                    type: 'readCsv',
                    config: { filePath: inputCsvPath }
                },
                {
                    id: 'step_query',
                    type: 'query',
                    config: {
                        query: 'SELECT a1, a2, a3 WHERE a3 > 25'
                    }
                },
                {
                    id: 'step_write',
                    type: 'writeCsv',
                    config: { filePath: outputCsvPath }
                }
            ]
        };

        const execution = await executeWorkflow(workflowDef);
        assert.strictEqual(execution.success, true, `Execution failed: ${execution.error}`);

        assert.ok(fs.existsSync(outputCsvPath));
        const fileContent = await fs.promises.readFile(outputCsvPath, 'utf8');
        const lines = fileContent.trim().split('\n');
        // Only rows where age > 25: Alice (30), Charlie (35)
        assert.strictEqual(lines.length, 3, 'Should be header + 2 data rows');
        assert.strictEqual(lines[0].trim(), 'id,name,age');
        assert.ok(lines[1].includes('1,Alice,30'));
        assert.ok(lines[2].includes('3,Charlie,35'));
    });

    test('Aggregate activity works correctly in workflow', async () => {
        const workflowDef = {
            name: 'Aggregate Workflow',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_read',
                    type: 'readCsv',
                    config: { filePath: inputCsvPath }
                },
                {
                    id: 'step_agg',
                    type: 'aggregate',
                    config: {
                        column: 'salary',
                        operation: 'average'
                    }
                },
                {
                    id: 'step_write',
                    type: 'writeCsv',
                    config: { filePath: outputCsvPath }
                }
            ]
        };

        const execution = await executeWorkflow(workflowDef);
        assert.strictEqual(execution.success, true, `Execution failed: ${execution.error}`);

        assert.ok(fs.existsSync(outputCsvPath));
        const fileContent = await fs.promises.readFile(outputCsvPath, 'utf8');
        const lines = fileContent.trim().split('\n');
        assert.strictEqual(lines.length, 2, 'Should be header + 1 value row');
        assert.strictEqual(lines[0].trim(), 'average_salary');
        // Salaries: 50000, 60000, 70000, 60000, 45000
        // Total = 285000 / 5 = 57000
        assert.strictEqual(lines[1].trim(), '57000');
    });

    test('Execution halts and reports failure on activity error', async () => {
        const workflowDef = {
            name: 'Error Workflow',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_read',
                    type: 'readCsv',
                    config: { filePath: 'non_existent.csv' } // fails
                },
                {
                    id: 'step_write',
                    type: 'writeCsv',
                    config: { filePath: outputCsvPath }
                }
            ]
        };

        const states = [];
        const onStateChange = (id, state, stats, error) => {
            states.push({ id, state, stats, error });
        };

        const execution = await executeWorkflow(workflowDef, { onStateChange });
        assert.strictEqual(execution.success, false);
        assert.ok(execution.error.includes('File not found'));

        const readState = states.find(s => s.id === 'step_read' && s.state === 'Failed');
        assert.ok(readState);
        assert.ok(readState.error.includes('File not found'));

        // step_write should still be pending and NOT run
        const writeStates = states.filter(s => s.id === 'step_write');
        assert.strictEqual(writeStates.length, 1);
        assert.strictEqual(writeStates[0].state, 'Pending');
    });

    test('readExcel reads correct rows, converts date serials, and respects headerRow/startRow/skipFooter', async () => {
        // Excel file created in suiteSetup:
        //   Row 4 = header (id, name, Check Date, amount)
        //   Rows 5-7 = data with Excel date serials (46237=8/3/2026, 46240=8/6/2026)
        //   Row 8 = footer (should be skipped)
        const workflowDef = {
            name: 'Excel Read Test',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_read',
                    type: 'readExcel',
                    config: {
                        filePath: inputXlsxPath,
                        sheetName: 'Sheet1',
                        headerRow: '4',
                        startRow: '5',
                        hasHeader: 'true',
                        skipEmptyRows: 'true',
                        skipFooter: '1'
                    }
                },
                {
                    id: 'step_write',
                    type: 'writeCsv',
                    config: { filePath: outputCsvPath }
                }
            ]
        };

        const execution = await executeWorkflow(workflowDef);
        assert.strictEqual(execution.success, true, `Execution failed: ${execution.error}`);

        const fileContent = await fs.promises.readFile(outputCsvPath, 'utf8');
        const lines = fileContent.trim().split('\n');

        // Expect: header row + 3 data rows (footer row 8 was skipped)
        assert.strictEqual(lines.length, 4, 'Should be header + 3 data rows');
        assert.ok(lines[0].includes('id'), 'First line should be the header');
        assert.ok(lines[0].includes('Check Date'), 'Header should include Check Date');

        // Date serials should be converted to M/D/YYYY strings
        assert.ok(lines[1].includes('8/3/2026'), `Row 1 Check Date should be 8/3/2026, got: ${lines[1]}`);
        assert.ok(lines[2].includes('8/6/2026'), `Row 2 Check Date should be 8/6/2026, got: ${lines[2]}`);
        assert.ok(lines[3].includes('8/3/2026'), `Row 3 Check Date should be 8/3/2026, got: ${lines[3]}`);
    });

    test('Find highest date workflow: readExcel + transform + query returns max check date', async () => {
        const workflowDef = {
            name: 'Find Highest Date',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_1',
                    type: 'readExcel',
                    config: {
                        filePath: inputXlsxPath,
                        sheetName: 'Sheet1',
                        headerRow: '4',
                        startRow: '5',
                        hasHeader: 'true',
                        skipEmptyRows: 'true',
                        skipFooter: '1'
                    }
                },
                {
                    id: 'step_2',
                    type: 'transform',
                    config: { column: 'Check Date', opKey: 'parseDate', params: '' }
                },
                {
                    id: 'step_3',
                    type: 'transform',
                    config: { column: 'Check Date', opKey: 'formatDate', params: 'YYYY-MM-DD' }
                },
                {
                    id: 'step_4',
                    type: 'query',
                    config: { query: 'SELECT a3 ORDER BY a3 DESC LIMIT 1' }
                }
            ]
        };

        const execution = await executeWorkflow(workflowDef);
        assert.strictEqual(execution.success, true, `Execution failed: ${execution.error}`);

        const finalDataset = execution.results['step_4'].dataset;
        assert.ok(finalDataset, 'step_4 should produce a dataset');
        assert.strictEqual(finalDataset.getRowCount(), 1, 'Should return exactly 1 row');

        const maxDate = finalDataset.rows[0][finalDataset.getColumns()[0]];
        // 46240 = 2026-08-06 is the highest date serial in the test file
        assert.strictEqual(maxDate, '2026-08-06', `Expected 2026-08-06, got ${maxDate}`);
    });

    test('Consolidated pipeline: query + multiTransform date ops + writeText row interpolation', async function () {
        this.timeout(15000);
        const reportPath = path.join(testDir, 'date_report.txt');

        const workflowDef = {
            name: 'Consolidated Date Report',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_read',
                    type: 'readExcel',
                    config: {
                        filePath: inputXlsxPath,
                        sheetName: 'Sheet1',
                        headerRow: '4',
                        startRow: '5',
                        hasHeader: 'true',
                        skipEmptyRows: 'true',
                        skipFooter: '1'
                    }
                },
                {
                    id: 'step_max',
                    type: 'query',
                    config: { query: 'SELECT a3 AS MaxDate, a3 AS D1, a3 AS D2 ORDER BY a3 DESC LIMIT 1' }
                },
                {
                    id: 'step_multi',
                    type: 'multiTransform',
                    config: {
                        stopOnError: true,
                        actions: [
                            { column: 'D1', opKey: 'addDays', params: '-1', asNewColumn: false },
                            { column: 'D1', opKey: 'formatDate', params: 'YYYYMMDD', asNewColumn: false },
                            { column: 'D2', opKey: 'addDays', params: '-2', asNewColumn: false },
                            { column: 'D2', opKey: 'formatDate', params: 'YYYYMMDD', asNewColumn: false }
                        ]
                    }
                },
                {
                    id: 'step_write',
                    type: 'writeText',
                    config: {
                        filePath: reportPath,
                        content: 'custom',
                        customText: '{{row.D2}}\t{{row.D1}}',
                        overwrite: true,
                        timestampSuffix: false
                    }
                }
            ]
        };

        const execution = await executeWorkflow(workflowDef);
        assert.strictEqual(execution.success, true, `Execution failed: ${execution.error}`);

        const content = await fs.promises.readFile(reportPath, 'utf8');
        // Max Check Date = 46240 = 2026-08-06 → max-2 = 20260804, max-1 = 20260805
        assert.strictEqual(content, '20260804\t20260805');
    });

    test('forEachFile with mergeResults drives the full loop-to-report pipeline', async function () {
        this.timeout(20000);
        if (process.platform !== 'win32') {
            this.skip();
        }

        const reportA = path.join(testDir, 'report_a.xlsx');
        const reportB = path.join(testDir, 'report_b.xlsx');
        const reportPath = path.join(testDir, 'loop_report.txt');

        const makeReport = (p, rows) => {
            const ws = XLSX.utils.aoa_to_sheet([
                ['Report Title', '', '', ''],
                ['Generated: today', '', '', ''],
                ['', '', '', ''],
                ['id', 'name', 'Check Date', 'amount'],
                ...rows,
                ['', '', '', 999]
            ]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Report1');
            XLSX.writeFile(wb, p);
        };

        // Report A max = 46240 (2026-08-06); Report B max = 46241 (2026-08-07)
        makeReport(reportA, [[1, 'Alice', 46237, 100], [2, 'Bob', 46240, 200]]);
        makeReport(reportB, [[1, 'Carol', 46238, 150], [2, 'Dave', 46241, 300]]);

        const workflowDef = {
            name: 'Loop to Report',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_loop',
                    type: 'forEachFile',
                    config: {
                        folderPath: testDir,
                        fileFilter: '*report*.xlsx',
                        mergeResults: true,
                        steps: [
                            {
                                id: 'step_read',
                                type: 'readExcel',
                                config: {
                                    filePath: '{{filePath}}',
                                    sheetName: 'Report1',
                                    headerRow: '4',
                                    startRow: '5',
                                    hasHeader: 'true',
                                    skipEmptyRows: 'true',
                                    skipFooterRows: '1',
                                    dateFormat: 'YYYY-MM-DD',
                                    dateDetection: 'true'
                                }
                            },
                            {
                                id: 'step_file_max',
                                type: 'query',
                                config: { query: 'SELECT a3 AS HighestDate ORDER BY a3 DESC LIMIT 1' }
                            }
                        ]
                    }
                },
                {
                    id: 'step_max',
                    type: 'query',
                    config: { query: 'SELECT a1 AS MaxDate, a1 AS D1, a1 AS D2 ORDER BY a1 DESC LIMIT 1' }
                },
                {
                    id: 'step_multi',
                    type: 'multiTransform',
                    config: {
                        stopOnError: true,
                        actions: [
                            { column: 'D1', opKey: 'addDays', params: '-1', asNewColumn: false },
                            { column: 'D1', opKey: 'formatDate', params: 'YYYYMMDD', asNewColumn: false },
                            { column: 'D2', opKey: 'addDays', params: '-2', asNewColumn: false },
                            { column: 'D2', opKey: 'formatDate', params: 'YYYYMMDD', asNewColumn: false }
                        ]
                    }
                },
                {
                    id: 'step_write',
                    type: 'writeText',
                    config: {
                        filePath: reportPath,
                        content: 'custom',
                        customText: '{{row.D2}}\t{{row.D1}}',
                        overwrite: true,
                        timestampSuffix: false
                    }
                }
            ]
        };

        const execution = await executeWorkflow(workflowDef);
        assert.strictEqual(execution.success, true, `Execution failed: ${execution.error}`);

        const content = await fs.promises.readFile(reportPath, 'utf8');
        // Overall max across both files = 46241 = 2026-08-07
        // → max-2 = 20260805, max-1 = 20260806
        assert.strictEqual(content, '20260805\t20260806');
    });

    test('Workflow parameters: defaults, coercion, and missing required errors', async () => {
        const workflowDef = {
            name: 'Parameter Test',
            version: '1.0.0',
            parameters: [
                { name: 'inputPath', label: 'Input', type: 'string', required: true },
                { name: 'limit', label: 'Limit', type: 'number', required: false, defaultValue: '5' },
                { name: 'mode', label: 'Mode', type: 'string', required: false, defaultValue: 'fast' }
            ],
            activities: [
                { id: 'step_set', type: 'setVariable', config: { variableName: 'probe', sourceType: 'variable', sourceVariable: 'limit' } }
            ]
        };

        // Missing required parameter → error
        const missing = await executeWorkflow(JSON.parse(JSON.stringify(workflowDef)));
        assert.strictEqual(missing.success, false);
        assert.ok(missing.error.includes('Missing required parameter "inputPath"'), `Got: ${missing.error}`);

        // Provided + defaults applied + number coercion
        const ok = await executeWorkflow(workflowDef, { initialVariables: { inputPath: 'a.csv', limit: '42' } });
        assert.strictEqual(ok.success, true, `Execution failed: ${ok.error}`);
        assert.strictEqual(ok.variables.inputPath, 'a.csv');
        assert.strictEqual(ok.variables.limit, 42, 'limit should be coerced to number');
        assert.strictEqual(ok.variables.mode, 'fast', 'default should be applied');

        // Default applies when only the required value is provided
        const defaultsOnly = await executeWorkflow(workflowDef, { initialVariables: { inputPath: 'b.csv' } });
        assert.strictEqual(defaultsOnly.success, true);
        assert.strictEqual(defaultsOnly.variables.limit, 5, 'numeric default should be coerced');
    });

    test('callWorkflow runs a sub-workflow with parameters and exports variables', async () => {
        const subPath = path.join(testDir, 'sub_add_days.vizflow');
        const outCsv = path.join(testDir, 'sub_out.csv');
        const subDef = {
            name: 'Add Days Sub',
            version: '1.0.0',
            parameters: [
                { name: 'inputPath', label: 'Input', type: 'string', required: true },
                { name: 'outputPath', label: 'Output', type: 'string', required: true },
                { name: 'column', label: 'Column', type: 'string', required: false, defaultValue: 'Check Date' },
                { name: 'days', label: 'Days', type: 'string', required: false, defaultValue: '0' }
            ],
            activities: [
                { id: 'step_read', type: 'readCsv', config: { filePath: '{{inputPath}}' } },
                { id: 'step_parse', type: 'transform', config: { column: '{{column}}', opKey: 'parseDate', params: '' } },
                { id: 'step_shift', type: 'transform', config: { column: '{{column}}', opKey: 'addDays', params: '{{days}}' } },
                { id: 'step_fmt', type: 'transform', config: { column: '{{column}}', opKey: 'formatDate', params: 'YYYY-MM-DD' } },
                { id: 'step_write', type: 'writeCsv', config: { filePath: '{{outputPath}}' } }
            ]
        };
        await fs.promises.writeFile(subPath, JSON.stringify(subDef, null, 2), 'utf8');

        const inputCsv = path.join(testDir, 'param_input.csv');
        await fs.promises.writeFile(inputCsv, ['id,name,Check Date,amount', '1,Alice,2026-08-06,100'].join('\n'), 'utf8');

        const callerDef = {
            name: 'Caller',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_call',
                    type: 'callWorkflow',
                    config: {
                        workflowPath: subPath,
                        parameters: {
                            inputPath: inputCsv,
                            outputPath: outCsv,
                            column: 'Check Date',
                            days: '-1'
                        },
                        exportVariables: true,
                        outputMode: 'passthrough'
                    }
                }
            ]
        };

        const execution = await executeWorkflow(callerDef);
        assert.strictEqual(execution.success, true, `Execution failed: ${execution.error}`);

        // Passthrough dataset = sub-workflow's final dataset (1 row)
        const passthrough = execution.results['step_call'].dataset;
        assert.ok(passthrough, 'callWorkflow should produce a dataset');
        assert.strictEqual(passthrough.getRowCount(), 1);

        // Output file written by the sub-workflow with shifted date
        const content = await fs.promises.readFile(outCsv, 'utf8');
        assert.ok(content.includes('2026-08-05'), `Shifted date missing, got:\n${content}`);

        // Parameters exported back to the caller
        assert.strictEqual(execution.variables.days, '-1');
        assert.strictEqual(execution.variables.outputPath, outCsv);

        await fs.promises.unlink(subPath).catch(() => {});
        await fs.promises.unlink(inputCsv).catch(() => {});
    });

    test('callWorkflow rejects unknown parameters and missing required parameters', async () => {
        const subPath = path.join(testDir, 'sub_required.vizflow');
        const subDef = {
            name: 'Required Sub',
            version: '1.0.0',
            parameters: [
                { name: 'inputPath', label: 'Input', type: 'string', required: true }
            ],
            activities: [
                { id: 'step_read', type: 'readCsv', config: { filePath: '{{inputPath}}' } }
            ]
        };
        await fs.promises.writeFile(subPath, JSON.stringify(subDef, null, 2), 'utf8');

        // Unknown parameter
        const unknown = await executeWorkflow({
            name: 'Unknown Param Caller',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_call',
                    type: 'callWorkflow',
                    config: { workflowPath: subPath, parameters: { bogus: 'x' } }
                }
            ]
        });
        assert.strictEqual(unknown.success, false);
        assert.ok(unknown.error.includes('unknown parameter "bogus"'), `Got: ${unknown.error}`);

        // Missing required parameter (no default) → sub-workflow errors cleanly
        const missing = await executeWorkflow({
            name: 'Missing Param Caller',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_call',
                    type: 'callWorkflow',
                    config: { workflowPath: subPath, parameters: {} }
                }
            ]
        });
        assert.strictEqual(missing.success, false);
        assert.ok(missing.error.includes('Missing required parameter "inputPath"'), `Got: ${missing.error}`);

        await fs.promises.unlink(subPath).catch(() => {});
    });

    test('callWorkflow detects circular workflow calls', async () => {
        const pathA = path.join(testDir, 'cycle_a.vizflow');
        const pathB = path.join(testDir, 'cycle_b.vizflow');

        const defA = {
            name: 'Cycle A',
            version: '1.0.0',
            parameters: [{ name: 'x', type: 'string', required: false, defaultValue: '1' }],
            activities: [
                { id: 'step_call', type: 'callWorkflow', config: { workflowPath: pathB, parameters: { x: '{{x}}' } } }
            ]
        };
        const defB = {
            name: 'Cycle B',
            version: '1.0.0',
            parameters: [{ name: 'x', type: 'string', required: false, defaultValue: '1' }],
            activities: [
                { id: 'step_call', type: 'callWorkflow', config: { workflowPath: pathA, parameters: { x: '{{x}}' } } }
            ]
        };
        await fs.promises.writeFile(pathA, JSON.stringify(defA, null, 2), 'utf8');
        await fs.promises.writeFile(pathB, JSON.stringify(defB, null, 2), 'utf8');

        const execution = await executeWorkflow(defA);
        assert.strictEqual(execution.success, false);
        assert.ok(
            execution.error.includes('circular workflow call detected'),
            `Expected circular-call error, got: ${execution.error}`
        );

        await fs.promises.unlink(pathA).catch(() => {});
        await fs.promises.unlink(pathB).catch(() => {});
    });

    test('Aborting the signal cancels the run and marks remaining steps Failed', async () => {
        const controller = new AbortController();
        const states = [];
        const onStateChange = (id, state, stats, error) => {
            states.push({ id, state, error });
        };

        const workflowDef = {
            name: 'Cancellation Test',
            version: '1.0.0',
            activities: [
                { id: 'step_read', type: 'readCsv', config: { filePath: inputCsvPath } },
                { id: 'step_wait', type: 'wait', config: { duration: 60 } },
                { id: 'step_write', type: 'writeCsv', config: { filePath: outputCsvPath } }
            ]
        };

        const executionPromise = executeWorkflow(workflowDef, { signal: controller.signal, onStateChange });
        setTimeout(() => controller.abort(new Error('Workflow cancelled by user')), 100);
        const execution = await executionPromise;

        assert.strictEqual(execution.success, false);
        assert.ok(execution.error.toLowerCase().includes('cancel'), `Error should mention cancel: ${execution.error}`);

        // Whatever the race with the fast readCsv, the write step must be
        // marked Failed instead of silently remaining Pending
        const writeStates = states.filter(s => s.id === 'step_write');
        assert.ok(writeStates.some(s => s.state === 'Failed'), 'step_write should be marked Failed on cancel');
    });

    test('templateService interpolates variables, paths, rows and missing values', () => {
        const variables = {
            folder: '/data/reports',
            profile: { name: 'Alice', age: 30 }
        };

        assert.strictEqual(
            templateService.interpolate('{{folder}}/file.csv', variables),
            '/data/reports/file.csv'
        );
        assert.strictEqual(
            templateService.interpolate('{{profile.name}} is {{profile.age}}', variables),
            'Alice is 30'
        );
        assert.strictEqual(
            templateService.interpolate('{{row.id}}-{{row.name}}', variables, { row: { id: 7, name: 'Bob' } }),
            '7-Bob'
        );
        // Missing placeholders are left untouched by default
        assert.strictEqual(
            templateService.interpolate('{{missing}} here', variables),
            '{{missing}} here'
        );
        // replaceMissingWith substitutes missing placeholders
        assert.strictEqual(
            templateService.interpolate('{{missing}} here', variables, { replaceMissingWith: '' }),
            ' here'
        );
    });

    test('Validation rejects duplicate IDs within nested steps', () => {
        const workflowDef = {
            name: 'Duplicate Nested IDs',
            version: '1.0.0',
            activities: [
                {
                    id: 'step_if',
                    type: 'ifElse',
                    config: {
                        column: 'age',
                        operator: '>=',
                        value: '25',
                        thenSteps: [
                            { id: 'dup', type: 'transform', config: { column: 'salary', opKey: 'add', params: ['1'] } },
                            { id: 'dup', type: 'filter', config: { column: 'age', operator: '>=', value: '1' } }
                        ],
                        elseSteps: []
                    }
                }
            ]
        };

        const result = validateWorkflow(workflowDef);
        assert.strictEqual(result.valid, false);
        assert.ok(result.error.toLowerCase().includes('duplicate'), `Expected duplicate-ID error, got: ${result.error}`);
    });

    test('Validation rejects circular nested references', () => {
        const forEachAct = {
            id: 'step_loop',
            type: 'forEach',
            config: { groupBy: 'name', sortGroups: 'none', steps: [] }
        };
        // Point the loop's steps back at itself to create a cycle
        forEachAct.config.steps.push(forEachAct);

        const workflowDef = {
            name: 'Circular',
            version: '1.0.0',
            activities: [forEachAct]
        };

        const result = validateWorkflow(workflowDef);
        assert.strictEqual(result.valid, false);
        assert.ok(result.error.toLowerCase().includes('circular'), `Expected circular error, got: ${result.error}`);
    });

    test('transform with asNewColumn creates the column from an empty source', async () => {
        const workflowDef = {
            name: 'New Column Test',
            version: '1.0.0',
            activities: [
                { id: 's1', type: 'readCsv', config: { filePath: inputCsvPath } },
                { id: 's2', type: 'transform', config: { column: 'flag', opKey: 'concat', params: ['X'], asNewColumn: true } }
            ]
        };

        const execution = await executeWorkflow(workflowDef);
        assert.strictEqual(execution.success, true, `Execution failed: ${execution.error}`);
        const ds = execution.results['s2'].dataset;
        assert.ok(ds.getColumns().includes('flag'), 'New column should be present');
        assert.strictEqual(ds.getRowCount(), 5);
        assert.ok(ds.rows.every(r => r.flag === 'X'), 'Every row should carry the new value');
    });

    test('Query UPDATE produces a new dataset with updated values', async () => {
        const workflowDef = {
            name: 'UPDATE Test',
            version: '1.0.0',
            activities: [
                { id: 'step_read', type: 'readCsv', config: { filePath: inputCsvPath } },
                { id: 'step_upd', type: 'query', config: { query: 'UPDATE a4 = a4 * 2', allowUpdate: true } },
                { id: 'step_write', type: 'writeCsv', config: { filePath: outputCsvPath } }
            ]
        };

        const execution = await executeWorkflow(workflowDef);
        assert.strictEqual(execution.success, true, `Execution failed: ${execution.error}`);
        const ds = execution.results['step_upd'].dataset;
        assert.strictEqual(ds.getRowCount(), 5);
        assert.ok(ds.getColumns().includes('salary'), 'Columns should be preserved');
        // Original salaries doubled: 50000, 60000, 70000, 60000, 45000
        assert.deepStrictEqual(ds.rows.map(r => r.salary), [100000, 120000, 140000, 120000, 90000]);
    });

    test('Scheduler computes next run times via node-cron', () => {
        const engine = new SchedulerEngine();
        const next = engine.getNextRun('0 9 * * 1-5');
        assert.ok(next, 'Next run should be computed');
        const d = new Date(next);
        assert.ok(!isNaN(d.getTime()), 'Next run should be a valid date');
        assert.ok(d.getTime() > Date.now(), 'Next run should be in the future');
    });

    test('Scheduler aborts a job on timeout', async () => {
        const engine = new SchedulerEngine();
        engine.configPath = path.join(testDir, 'scheduler_config.json');
        engine.configBaseDir = testDir;

        let timedOut = false;
        engine.on('jobTimedOut', () => { timedOut = true; });

        engine.addJob({
            id: 'timeout_job',
            name: 'Timeout Job',
            schedule: 'immediate',
            timeout: 1,
            retryCount: 0,
            workflowDef: {
                name: 'Slow Workflow',
                version: '1.0.0',
                activities: [{ id: 'step_wait', type: 'wait', config: { duration: 60 } }]
            }
        });

        // The job auto-executes ~500ms after being added; its 1s timeout
        // should abort the wait activity and emit jobTimedOut
        for (let i = 0; i < 40; i++) {
            await new Promise(resolve => setTimeout(resolve, 200));
            if (timedOut && !engine.runningJobs.has('timeout_job')) break;
        }

        assert.ok(timedOut, 'jobTimedOut should have fired');
        assert.strictEqual(engine.runningJobs.has('timeout_job'), false, 'Job should be cleaned up after timeout');

        if (fs.existsSync(engine.configPath)) {
            await fs.promises.unlink(engine.configPath);
        }
    });

    test('Scheduler queues jobs when maxConcurrent is reached', async function () {
        // The queue drains after both waits complete (~3.5s), which is longer
        // than the default per-test timeout
        this.timeout(15000);

        const engine = new SchedulerEngine();
        engine.configPath = path.join(testDir, 'scheduler_config2.json');
        engine.configBaseDir = testDir;

        engine.addJob({
            id: 'job1',
            name: 'Job One',
            schedule: 'immediate',
            retryCount: 0,
            maxConcurrent: 1,
            workflowDef: {
                name: 'Slow Workflow',
                version: '1.0.0',
                activities: [{ id: 'step_wait', type: 'wait', config: { duration: 2 } }]
            }
        });

        engine.addJob({
            id: 'job2',
            name: 'Job Two',
            schedule: 'immediate',
            retryCount: 0,
            maxConcurrent: 1,
            workflowDef: {
                name: 'Quick Workflow',
                version: '1.0.0',
                activities: [{ id: 'step_wait', type: 'wait', config: { duration: 1 } }]
            }
        });

        // Wait for job1 to start, then attempt job2 which should be queued
        for (let i = 0; i < 20 && !engine.runningJobs.has('job1'); i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        engine.executeJob('job2');
        assert.ok(engine.queue.includes('job2'), 'job2 should be queued while job1 runs');

        // Both jobs should eventually run to completion and drain the queue
        for (let i = 0; i < 50; i++) {
            await new Promise(resolve => setTimeout(resolve, 200));
            if (engine.runningJobs.size === 0 && engine.queue.length === 0) break;
        }
        assert.strictEqual(engine.runningJobs.size, 0, 'No jobs should be running after drain');
        assert.strictEqual(engine.queue.length, 0, 'Queue should be drained');

        if (fs.existsSync(engine.configPath)) {
            await fs.promises.unlink(engine.configPath);
        }
    });

    test('AI context artifacts (catalog + schema) match the live activity registry', async () => {
        const gen = require('../scripts/generate-ai-context');
        const { activities } = gen.getActivities();

        // The committed catalog/schema must equal a fresh generation, so adding
        // or changing an activity forces `npm run gen:context` (auto-update).
        const catalogPath = path.join(__dirname, '..', 'docs', 'workflow-catalog.md');
        const schemaPath = path.join(__dirname, '..', 'docs', 'workflow-schema.json');

        const committedCatalog = await fs.promises.readFile(catalogPath, 'utf8');
        const committedSchema = JSON.parse(await fs.promises.readFile(schemaPath, 'utf8'));

        // Normalize line endings so CRLF checkouts (git autocrlf) still match.
        const norm = (s) => s.replace(/\r\n/g, '\n');
        assert.strictEqual(norm(gen.buildCatalogMarkdown(gen.getActivities())), norm(committedCatalog),
            'docs/workflow-catalog.md is out of date - run `npm run gen:context`');
        assert.deepStrictEqual(gen.buildJsonSchema(gen.getActivities()), committedSchema,
            'docs/workflow-schema.json is out of date - run `npm run gen:context`');

        // Every registered activity must appear in the schema definitions.
        for (const act of activities) {
            assert.ok(committedSchema.definitions[`activity/${act.type}`],
                `Schema missing definition for activity "${act.type}"`);
        }
        const schemaActivityDefs = Object.keys(committedSchema.definitions)
            .filter((d) => d.startsWith('activity/'));
        assert.strictEqual(schemaActivityDefs.length, activities.length,
            'Schema activity definition count does not match the registry');
    });
});

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { executeWorkflow, validateWorkflow } = require('../engine/workflow/workflowEngine');
const { getActivities, getActivity } = require('../engine/workflow/activityRegistry');

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
        if (fs.existsSync(testDir)) {
            await fs.promises.rmdir(testDir);
        }
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
});

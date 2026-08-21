const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { parseXml, decodeEntities, XmlParseError } = require('../engine/xml/xmlParser');
const { serializeXml } = require('../engine/xml/xmlSerializer');
const { resolveAll, resolveOne, getAttr, getText } = require('../engine/xml/xmlPath');
const { mapToRows, mapToTree, autoMapping } = require('../engine/xml/xmlMapper');
const { evaluateTemplate } = require('../engine/expressions/safeEval');
const { executeWorkflow } = require('../engine/workflow/workflowEngine');
const { getActivity, getActivityCount, getRegistrationStatus } = require('../engine/workflow/activityRegistry');

suite('XML Feature Test Suite', () => {
    const testDir = path.join(__dirname, 'temp_test_xml');
    const sampleXmlPath = path.join(testDir, 'orders.xml');
    const readWorkflowCsvPath = path.join(testDir, 'read_workflow_output.csv');
    const transformOutputPath = path.join(testDir, 'transform_output.xml');

    const sampleXml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Orders>',
        '  <!-- first order -->',
        '  <Order id="1">',
        '    <Status>ok</Status>',
        '    <Total>10.5</Total>',
        '    <Note><![CDATA[<raw> & unescaped]]></Note>',
        '  </Order>',
        '  <Order id="2">',
        '    <Status>cancelled</Status>',
        '    <Total>5</Total>',
        '  </Order>',
        '</Orders>'
    ].join('\n');

    suiteSetup(async () => {
        if (!fs.existsSync(testDir)) {
            await fs.promises.mkdir(testDir, { recursive: true });
        }
        await fs.promises.writeFile(sampleXmlPath, sampleXml, 'utf8');
    });

    suiteTeardown(async () => {
        if (fs.existsSync(testDir)) {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        }
    });

    // ─── xmlParser ──────────────────────────────────────────────────────────

    suite('xmlParser', () => {
        test('parses elements, attributes, nesting, CDATA and comments', () => {
            const { root, declaration } = parseXml(sampleXml);
            assert.strictEqual(declaration.encoding, 'UTF-8');
            assert.strictEqual(root.name, 'Orders');
            assert.strictEqual(root.children.filter(c => c.type === 'element').length, 2);

            const firstOrder = root.children.find(c => c.type === 'element');
            assert.strictEqual(firstOrder.attributes.id, '1');

            const note = firstOrder.children.find(c => c.type === 'element' && c.name === 'Note');
            const cdata = note.children.find(c => c.type === 'cdata');
            assert.strictEqual(cdata.value, '<raw> & unescaped');
        });

        test('decodes standard entities and numeric character references', () => {
            assert.strictEqual(decodeEntities('&lt;a&gt; &amp; &#65; &#x42;'), '<a> & A B');
        });

        test('round-trips parse -> serialize -> parse to an equivalent tree', () => {
            const { root } = parseXml(sampleXml);
            const serialized = serializeXml(root);
            const { root: reparsed } = parseXml(serialized);
            assert.strictEqual(reparsed.name, root.name);
            assert.strictEqual(
                reparsed.children.filter(c => c.type === 'element').length,
                root.children.filter(c => c.type === 'element').length
            );
        });

        test('throws a descriptive XmlParseError on malformed input', () => {
            assert.throws(() => parseXml('<a><b></a>'), XmlParseError);
            try {
                parseXml('<a><b></a>');
                assert.fail('Expected parseXml to throw');
            } catch (error) {
                assert.ok(error instanceof XmlParseError);
                assert.ok(/Mismatched closing tag/.test(error.message));
            }
        });
    });

    // ─── xmlPath ────────────────────────────────────────────────────────────

    suite('xmlPath', () => {
        let root;
        suiteSetup(() => {
            root = parseXml(sampleXml).root;
        });

        test('resolveAll finds every matching element', () => {
            const orders = resolveAll(root, 'Order');
            assert.strictEqual(orders.length, 2);
        });

        test('resolveAll supports indexed segments', () => {
            const second = resolveOne(root, 'Order[2]');
            assert.strictEqual(getAttr(second, 'id'), '2');
        });

        test('resolveAll resolves an @attr path to its value', () => {
            const values = resolveAll(root, 'Order[1]/@id');
            assert.deepStrictEqual(values, ['1']);
        });

        test('getText concatenates direct text/cdata children', () => {
            const status = resolveOne(root, 'Order[1]/Status');
            assert.strictEqual(getText(status), 'ok');
        });
    });

    // ─── safeEval ───────────────────────────────────────────────────────────

    suite('safeEval', () => {
        test('evaluates pure arithmetic expressions after interpolation', () => {
            assert.strictEqual(evaluateTemplate('{{price}} * {{qty}}', { price: 2.5, qty: 4 }), 10);
        });

        test('falls back to literal string concatenation for non-arithmetic templates', () => {
            assert.strictEqual(evaluateTemplate('{{id}}-{{status}}', { id: '1', status: 'ok' }), '1-ok');
        });
    });

    // ─── xmlMapper ──────────────────────────────────────────────────────────

    suite('xmlMapper', () => {
        let root;
        suiteSetup(() => {
            root = parseXml(sampleXml).root;
        });

        test('autoMapping + mapToRows flattens a repeating element into rows/columns', () => {
            const mapping = autoMapping(root, 'Order');
            const { rows, columns } = mapToRows(root, mapping);
            assert.deepStrictEqual(columns.sort(), ['@id', 'Note', 'Status', 'Total'].sort());
            assert.strictEqual(rows.length, 2);
            assert.strictEqual(rows[0]['@id'], '1');
            assert.strictEqual(rows[0].Status, 'ok');
        });

        test('mapToRows applies binding operations, expressions and conditions', () => {
            const mapping = {
                loop: { path: 'Order', as: 'order' },
                condition: { path: 'Status', operator: '!=', value: 'cancelled' },
                children: [
                    { name: 'id', binding: { path: '@id' } },
                    { name: 'state', binding: { path: 'Status', op: 'upper' } },
                    { name: 'summary', expression: '{{id}} - {{state}}' }
                ]
            };
            const { rows } = mapToRows(root, mapping);
            assert.strictEqual(rows.length, 1, 'cancelled order should be filtered out');
            assert.strictEqual(rows[0].state, 'OK');
            assert.strictEqual(rows[0].summary, '1 - OK');
        });

        test('mapToTree builds a nested target tree with attributes, loop and static fallback', () => {
            const mapping = {
                kind: 'element',
                name: 'Summary',
                children: [
                    {
                        kind: 'element',
                        name: 'Item',
                        loop: { path: 'Order', as: 'order' },
                        children: [
                            { kind: 'attribute', name: 'orderId', binding: { path: '@id' } },
                            { name: 'State', binding: { path: 'Status' } },
                            { name: 'Currency', static: 'USD' }
                        ]
                    }
                ]
            };
            const target = mapToTree(root, mapping);
            assert.strictEqual(target.name, 'Summary');
            const items = target.children.filter(c => c.type === 'element');
            assert.strictEqual(items.length, 2);
            assert.strictEqual(items[0].attributes.orderId, '1');
            const currency = items[0].children.find(c => c.name === 'Currency');
            assert.strictEqual(getText(currency), 'USD');
        });

        test('mapToTree throws when the mapping produces no root element', () => {
            const mapping = {
                kind: 'element',
                name: 'Item',
                loop: { path: 'Order' },
                condition: { path: 'Status', operator: '==', value: 'never-matches' }
            };
            assert.throws(() => mapToTree(root, mapping), /produced no root element/);
        });
    });

    // ─── Registry sanity ────────────────────────────────────────────────────

    suite('XML activity registration', () => {
        test('readXml, writeXml and xmlTransform are all registered exactly once', () => {
            assert.ok(getActivity('readXml'), 'readXml should be registered');
            assert.ok(getActivity('writeXml'), 'writeXml should be registered');
            assert.ok(getActivity('xmlTransform'), 'xmlTransform should be registered');

            const status = getRegistrationStatus();
            const duplicateErrors = status.errors.filter(e => /already registered/.test(e));
            assert.strictEqual(duplicateErrors.length, 0, `Unexpected duplicate registrations: ${duplicateErrors.join(', ')}`);
            assert.ok(getActivityCount() > 0);
        });
    });

    // ─── Integration ────────────────────────────────────────────────────────

    suite('XML activities integration', () => {
        test('readXml -> query -> writeCsv end-to-end', async () => {
            const workflowDef = {
                name: 'XML Read Integration',
                version: '1.0.0',
                activities: [
                    { id: 'step_read', type: 'readXml', config: { filePath: sampleXmlPath, mode: 'auto', recordPath: 'Order' } },
                    { id: 'step_query', type: 'query', config: { query: "SELECT a1, a2, a3 WHERE a2 != 'cancelled'" } },
                    { id: 'step_write', type: 'writeCsv', config: { filePath: readWorkflowCsvPath } }
                ]
            };

            const execution = await executeWorkflow(workflowDef);
            assert.strictEqual(execution.success, true, `Execution failed: ${execution.error}`);

            const content = await fs.promises.readFile(readWorkflowCsvPath, 'utf8');
            const lines = content.trim().split('\n');
            assert.strictEqual(lines.length, 2, 'Should be header + 1 surviving (non-cancelled) row');
            assert.ok(lines[1].includes('1,ok,10.5'));
        });

        test('standalone xmlTransform reads and writes XML files directly', async () => {
            const workflowDef = {
                name: 'XML Transform Integration',
                version: '1.0.0',
                activities: [
                    {
                        id: 'step_transform',
                        type: 'xmlTransform',
                        config: {
                            inputFilePath: sampleXmlPath,
                            outputFilePath: transformOutputPath,
                            mapping: {
                                kind: 'element',
                                name: 'ActiveOrders',
                                children: [
                                    {
                                        kind: 'element',
                                        name: 'Order',
                                        loop: { path: 'Order' },
                                        condition: { path: 'Status', operator: '!=', value: 'cancelled' },
                                        children: [
                                            { kind: 'attribute', name: 'id', binding: { path: '@id' } }
                                        ]
                                    }
                                ]
                            }
                        }
                    }
                ]
            };

            const execution = await executeWorkflow(workflowDef);
            assert.strictEqual(execution.success, true, `Execution failed: ${execution.error}`);

            const outputXml = await fs.promises.readFile(transformOutputPath, 'utf8');
            const { root } = parseXml(outputXml);
            assert.strictEqual(root.name, 'ActiveOrders');
            const orders = root.children.filter(c => c.type === 'element');
            assert.strictEqual(orders.length, 1);
            assert.strictEqual(orders[0].attributes.id, '1');
        });
    });
});

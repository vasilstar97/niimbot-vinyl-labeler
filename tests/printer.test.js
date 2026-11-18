import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPrintTask, PrinterModel, NiimbotProtocol, ImageEncoder, PageColorType, RequestCommandId } from '@mmote/niimbluelib';
import { Printer, resolvePrintTask } from '../src/printer.js';
import { defaults } from '../src/label.js';

function fixture(failure, endResult = true) {
  const calls = [];
  const task = Object.fromEntries(['printInit','printPage','waitForPageFinished','waitForFinished','printEnd'].map(name => [name, async (...args) => {
    calls.push([name,...args]); if (name === failure) throw new Error('connection lost');
    if (name === 'printEnd') return endResult;
  }]));
  const client = {
    getModelMetadata: () => ({ model: 'B21S', dpi:203, printheadPixels:384 }),
    getPrintTaskType: () => 'D110',
    protocol: { newPrintTask: (type, options) => { calls.push(['task',type,options]); return task; } },
  };
  const printer = new Printer(() => {}, {
    createCanvas: () => ({ getContext: () => ({ drawImage() {} }) }),
    encode: canvas => ({ width:canvas.width, height:canvas.height }),
  });
  printer.client = client; printer.connected = true;
  return { printer, calls };
}
test('installed model map selects D110 protocol for B21S', () => {
  assert.equal(findPrintTask(PrinterModel.B21S, 1), 'D110');
});

test('B21S uses a copy-count-aware B1 task without changing other printers', () => {
  assert.equal(resolvePrintTask('B21S', 'D110'), 'B1');
  assert.equal(resolvePrintTask('B21S_C2B', 'D110'), 'B1');
  assert.equal(resolvePrintTask('D110', 'D110'), 'D110');
  assert.equal(resolvePrintTask('B21', 'B21_V1'), 'B21_V1');
  assert.equal(resolvePrintTask('B21S', 'D110M_V4'), 'D110M_V4');
  assert.equal(resolvePrintTask('UNKNOWN', undefined), undefined);
});

test('rejected printEnd is not reported as success and never resends page', async () => {
  const { printer, calls } = fixture(undefined, false);
  await assert.rejects(printer.print({width:400,height:240},defaults,'top',3), /did not confirm/);
  assert.equal(calls.filter(c => c[0] === 'printPage').length, 1);
  assert.equal(printer.busy, false);
  assert.ok(printer.getDiagnostics().entries.some(e => e.event === 'end-error'));
});

test('cleanup rejection preserves original print error', async () => {
  const { printer } = fixture('printPage', false);
  await assert.rejects(printer.print({width:400,height:240},defaults,'top',3), /connection lost/);
  assert.equal(printer.busy, false);
});
test('one click prints exactly one page, cropped to 384 dots', async () => {
  const { printer, calls } = fixture();
  await printer.print({ width:400, height:240 }, defaults, 'top', 3);
  assert.equal(calls[0][1], 'B1'); assert.equal(calls[0][2].totalPages, 1);
  assert.deepEqual(calls.find(c => c[0] === 'printPage'), ['printPage',{width:384,height:240},1]);
  assert.equal(calls.filter(c => c[0] === 'printPage').length, 1);
  assert.equal(calls.at(-1)[0], 'printEnd'); assert.equal(printer.busy, false);
});

test('real B21S packet stream declares one copy in PrintStart and six-byte SetPageSize', async () => {
  const packets = [], polls = [];
  const meta = { model: 'B21S', dpi: 203, printheadPixels: 384 };
  const client = { getModelMetadata: () => meta, getPrintTaskType: () => 'D110', emit() {} };
  const protocol = new NiimbotProtocol(client);
  client.protocol = protocol;
  protocol.sendAll = async batch => packets.push(...batch);
  protocol.waitUntilPrintFinishedByStatusPoll = async total => polls.push(total);
  protocol.printEnd = async () => { polls.push('end'); return true; };
  const printer = new Printer(() => {}, {
    createCanvas: () => ({ getContext: () => ({ drawImage() {} }) }),
    encode: canvas => ImageEncoder.encode({
      width: canvas.width, height: canvas.height,
      getPixelColor: (x, y) => (x > 40 && x < 340 && y % 12 < 5 ? 0 : 0xffffff),
    }, PageColorType.SingleColor, 'top'),
  });
  printer.client = client; printer.connected = true;
  await printer.print({ width: 400, height: 240 }, defaults, 'top', 3);
  const byCommand = name => packets.filter(packet => packet.command === RequestCommandId[name]);
  assert.equal(byCommand('PrintStart').length, 1);
  assert.deepEqual([...byCommand('PrintStart')[0].data], [0, 1, 0, 0, 0, 0, PageColorType.SingleColor]);
  assert.equal(byCommand('SetPageSize').length, 1);
  assert.deepEqual([...byCommand('SetPageSize')[0].data], [0, 240, 1, 128, 0, 1]);
  assert.equal(byCommand('PrintQuantity').length, 0);
  assert.equal(byCommand('PrintClear').length, 0);
  assert.equal(byCommand('PageStart').length, 1);
  assert.equal(byCommand('PageEnd').length, 1);
  assert.deepEqual(polls, [1, 'end']);
  const rows = packets.filter(p => ['PrintBitmapRow', 'PrintBitmapRowIndexed', 'PrintEmptyRow'].some(name => p.command === RequestCommandId[name]));
  let nextRow = 0;
  for (const row of rows) {
    assert.equal(row.data[0] * 256 + row.data[1], nextRow);
    const repeat = row.command === RequestCommandId.PrintEmptyRow ? row.data[2] : row.data[5];
    assert.ok(repeat > 0 && repeat <= 255);
    nextRow += repeat;
  }
  assert.equal(nextRow, 240);
});
test('does not retry after page or status failure; releases busy state', async () => {
  for (const failure of ['printPage','waitForPageFinished']) {
    const { printer, calls } = fixture(failure);
    await assert.rejects(printer.print({width:400,height:240},defaults,'top',3), /connection lost/);
    assert.equal(calls.filter(c => c[0] === 'printPage').length, 1);
    assert.equal(calls.at(-1)[0], 'printEnd'); assert.equal(printer.busy, false);
  }
});
test('disconnected, busy, wrong dpi and oversized label send no print commands', async () => {
  const { printer, calls } = fixture();
  printer.connected = false;
  await assert.rejects(printer.print({width:400,height:240},defaults,'top',3), /Connect/);
  printer.connected = true; printer.busy = true;
  await assert.rejects(printer.print({width:400,height:240},defaults,'top',3), /already running/);
  printer.busy = false;
  await assert.rejects(printer.print({width:400,height:240},{...defaults,dpi:300},'top',3), /203/);
  await assert.rejects(printer.print({width:700,height:240},defaults,'top',3), /printhead/);
  assert.deepEqual(calls, []);
});

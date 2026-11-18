import { instantiateClient, ImageEncoder, PageColorType, RequestCommandId, ResponseCommandId } from '@mmote/niimbluelib';
import { mmToPx, printCrop } from './label.js';

export function resolvePrintTask(model, detectedTask) {
  // B21S requires a six-byte page-size command including the copy count.
  // The library's D110 mapping uses a four-byte size plus a separate quantity.
  // https://github.com/AndBondStyle/niimprint/issues/33
  // https://github.com/labbots/NiimPrintX/pull/50
  if (['B21S', 'B21S_C2B'].includes(model) && detectedTask === 'D110') return 'B1';
  return detectedTask;
}

export class Printer {
  client = null;
  busy = false;
  connected = false;
  journal = [];
  activeJob = null;
  constructor(onState, dependencies = {}) {
    this.onState = onState;
    this.createClient = dependencies.createClient || instantiateClient;
    this.encode = dependencies.encode || ImageEncoder.encodeCanvas;
    this.createCanvas = dependencies.createCanvas || (() => document.createElement('canvas'));
  }
  record(event, details = {}) {
    this.journal.push({ at: new Date().toISOString(), job: this.activeJob, event, ...details });
    if (this.journal.length > 1500) this.journal.shift();
  }
  getDiagnostics() { return { version: 1, entries: this.journal.slice() }; }
  async connect(transport) {
    if (this.busy) throw new Error('Wait for the current operation to finish.');
    if (transport === 'serial' && !navigator.serial) throw new Error('Web Serial is unavailable. Use Chrome or Edge on a computer.');
    if (transport === 'bluetooth' && !navigator.bluetooth) throw new Error('Web Bluetooth is unavailable. Use Chrome or Edge.');
    await this.disconnect();
    this.busy = true;
    const client = this.createClient(transport);
    this.client = client;
    client.on('disconnect', () => { this.record('disconnect'); this.connected = false; this.onState('Disconnected. Reconnect to print.'); });
    client.on('printprogress', e => {
      if (this.activeJob) this.record('progress', { page: e.page, pagesTotal: e.pagesTotal, print: e.pagePrintProgress, feed: e.pageFeedProgress });
    });
    for (const [event, names] of [['packetsent', RequestCommandId], ['packetreceived', ResponseCommandId]]) {
      client.on(event, e => {
        if (!this.activeJob) return;
        const name = names[e.packet.command] || String(e.packet.command);
        // Log control/status bytes and row headers, never the label's bitmap.
        const isBitmap = /Bitmap|EmptyRow/.test(name);
        this.record(event, { command: name, bytes: e.packet.data.length, data: Array.from(e.packet.data.slice(0, isBitmap ? 6 : 16)) });
      });
    }
    try {
      if (transport === 'serial') {
        const ports = (await navigator.serial.getPorts()).filter(port => port.getInfo().usbVendorId === 0x3513);
        // Reuse a previously granted NIIMBOT port only when it is unambiguous.
        await client.connect(ports.length === 1 ? { authorizedPort: ports[0] } : undefined);
      } else {
        await client.connect();
      }
      const meta = client.getModelMetadata();
      const task = resolvePrintTask(meta?.model, client.getPrintTaskType());
      if (!meta || !task) throw new Error('Unknown printer model or protocol. Printing is disabled.');
      this.connected = true;
      this.record('connected', { transport, model: meta.model, dpi: meta.dpi, task });
      this.onState(`Connected: ${meta.model} · ${meta.dpi} dpi · ${meta.printheadPixels} dots`, meta);
      return meta;
    } catch (e) { await client.disconnect().catch(() => {}); this.connected = false; throw e; }
    finally { this.busy = false; }
  }
  async disconnect() {
    if (this.busy) throw new Error('Wait for the current operation to finish.');
    if (this.client) await this.client.disconnect();
    this.connected = false; this.client = null;
  }
  async print(canvas, settings, direction, density) {
    if (this.busy) throw new Error('A print job is already running.');
    if (!this.connected || !this.client) throw new Error('Connect a printer first.');
    const client = this.client, meta = client.getModelMetadata();
    if (settings.dpi !== meta.dpi) throw new Error(`This printer requires ${meta.dpi} dpi.`);
    const taskName = resolvePrintTask(meta.model, client.getPrintTaskType());
    if (!taskName) throw new Error('Unknown print protocol. Printing is disabled.');
    const crop = printCrop(canvas.width, canvas.height, meta.printheadPixels, direction, mmToPx(settings.margin, settings.dpi));
    const page = this.createCanvas(); page.width = crop.width; page.height = crop.height;
    page.getContext('2d').drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const encoded = this.encode(page, PageColorType.SingleColor, direction);
    const task = client.protocol.newPrintTask(taskName, {
      totalPages: 1, statusPollIntervalMs: 250, statusTimeoutMs: 15000,
      pageColor: PageColorType.SingleColor, density,
    });
    this.busy = true;
    this.activeJob = `print-${Date.now()}`;
    this.record('job-start', { model: meta.model, task: taskName, settings, direction, density, copies: 1,
      raster: { width: page.width, height: page.height, rows: encoded.rows, cols: encoded.cols,
        runs: encoded.rowsData?.map(r => ({ row: r.rowNumber, repeat: r.repeat, type: r.dataType })) } });
    let printError;
    try {
      await task.printInit();
      this.record('initialized');
      await task.printPage(encoded, 1);
      this.record('page-sent');
      await task.waitForPageFinished();
      await task.waitForFinished();
      this.record('completion-reported');
    } catch (error) {
      printError = error;
      this.record('print-error', { message: error.message });
      throw error;
    } finally {
      // End the session, but NEVER retry a page after timeout or disconnect.
      try {
        if (this.connected) {
          const result = await task.printEnd();
          this.record('session-end', { accepted: result });
          if (result === false) throw new Error('The printer did not confirm the end of the job. The print result is unconfirmed.');
        } else if (!printError) {
          throw new Error('Connection lost before the end of the job was confirmed.');
        }
      } catch (error) {
        this.record('end-error', { message: error.message });
        if (!printError) throw error;
      } finally {
        this.record('job-finished'); this.activeJob = null; this.busy = false;
      }
    }
  }
}

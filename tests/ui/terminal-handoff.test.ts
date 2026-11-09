import { Readable } from 'node:stream';
import { expect, it } from 'vitest';
import { InputReader } from '../../src/ui/input.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { normalizeEnhancedKeys } from '../../src/ui/keyboard-protocol.js';
import { deferCursorReport } from '../../src/ui/terminal-replies.js';
import { showPermissionPrompt } from '../../src/ui/permission-prompt.js';
import { createTtyHarness } from '../support/tty.js';

it('keeps disambiguation across BusyCapture to permission while a report is pending', async () => {
  const outputTTY = process.stdout.isTTY;
  const h = createTtyHarness(); process.stdout.isTTY = true;
  const capture = new InputReader(new ReplRenderer(process.stdout)).startBusyCapture();
  const input = new Readable({ read() {} });
  input.on('data', chunk => h.send(Buffer.from(chunk).toString()));
  await new Promise(resolve => setImmediate(resolve));
  const report = deferCursorReport(input);
  const abort = new AbortController();
  let pending: ReturnType<typeof showPermissionPrompt> | undefined;
  try {
    normalizeEnhancedKeys(Buffer.from('\x1b[27u'));
    input.push(Buffer.from('\x1b[?12;'));
    capture.pause();
    expect(h.output.raw).not.toContain('\x1b[<u');
    pending = showPermissionPrompt('bash', { command: 'echo handoff' }, { signal: abort.signal });
    input.push(Buffer.from('\x1b[27u'));
    expect(await pending).toEqual({ action: 'deny' });
    expect(report.active).toBe(true);
    input.push(Buffer.from('34R'));
    expect(report.active).toBe(false);
    expect(h.output.raw.split('\x1b[<u')).toHaveLength(2);
  } finally {
    abort.abort(); if (pending) await pending;
    report.cancel(); input.destroy(); capture.stop(); h.restore(); process.stdout.isTTY = outputTTY;
  }
});

it('accepts an already queued enhanced ESC after a pending report releases its lease', async () => {
  const outputTTY = process.stdout.isTTY;
  const h = createTtyHarness(); process.stdout.isTTY = true;
  const abort = new AbortController();
  const pending = showPermissionPrompt('bash', { command: 'echo queued' }, { signal: abort.signal });
  let settled = false; void pending.then(() => { settled = true; });
  try {
    h.send('\x1b[27u');
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(true);
    expect(await pending).toEqual({ action: 'deny' });
  } finally { abort.abort(); await pending; h.restore(); process.stdout.isTTY = outputTTY; }
});

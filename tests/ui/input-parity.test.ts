import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InputReader } from '../../src/ui/input.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { clearPastedImagePaths } from '../../src/ui/image-input.js';
import { createTtyHarness } from '../support/tty.js';

const tempDirs: string[] = [];

async function runIdle(chunks: string[], setup?: (reader: InputReader) => void): Promise<string | null> {
  const harness = createTtyHarness();
  const reader = new InputReader(new ReplRenderer(process.stdout));
  setup?.(reader);
  try {
    const pending = reader.read('> ');
    for (const chunk of chunks) {
      harness.send(chunk);
    }
    return await pending;
  } finally {
    harness.restore();
  }
}

function runBusy(chunks: string[], setup?: (reader: InputReader) => void): string | null {
  const harness = createTtyHarness();
  const reader = new InputReader(new ReplRenderer(process.stdout));
  setup?.(reader);
  try {
    const capture = reader.startBusyCapture({ placeholder: 'Finishing response...' });
    for (const chunk of chunks) {
      harness.send(chunk);
    }
    const queued = capture.consumeQueued();
    capture.stop();
    return queued;
  } finally {
    harness.restore();
  }
}

function writeTempImage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xiaok-input-parity-'));
  tempDirs.push(dir);
  const imagePath = join(dir, 'clipboard.png');
  writeFileSync(imagePath, Buffer.from('png-bytes'));
  return imagePath;
}

describe('idle and busy input parity', () => {
  afterEach(() => {
    clearPastedImagePaths();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps text insertion parity', async () => {
    const chunks = ['hello', '\r'];

    await expect(runIdle(chunks)).resolves.toBe('hello');
    expect(runBusy(chunks)).toBe('hello');
  });

  it('keeps newline insertion parity', async () => {
    const chunks = ['line1', '\n', 'line2', '\r'];

    await expect(runIdle(chunks)).resolves.toBe('line1\nline2');
    expect(runBusy(chunks)).toBe('line1\nline2');
  });

  it('keeps cursor movement parity', async () => {
    const chunks = ['ab', '\x1b[D', 'X', '\r'];

    await expect(runIdle(chunks)).resolves.toBe('aXb');
    expect(runBusy(chunks)).toBe('aXb');
  });

  it('keeps delete and backspace parity', async () => {
    const chunks = ['abc', '\x1b[D', '\x15', 'x', '\x7f', '\r'];

    await expect(runIdle(chunks)).resolves.toBe('c');
    expect(runBusy(chunks)).toBe('c');
  });

  it('keeps clipboard image placeholder parity', async () => {
    const imagePath = writeTempImage();
    const setup = (reader: InputReader) => reader.setClipboardImageSaver(() => imagePath);
    const chunks = ['\x16', ' describe', '\r'];

    await expect(runIdle(chunks, setup)).resolves.toBe('[image 0] describe');
    expect(runBusy(chunks, setup)).toBe('[image 0] describe');
  });

  it('keeps OSC 1337 image placeholder parity', async () => {
    const imageBytes = Buffer.from('png-bytes').toString('base64');
    const osc = `\x1b]1337;File=name=${Buffer.from('pasted.png').toString('base64')};inline=1:${imageBytes}\x07`;
    const chunks = [osc, ' describe', '\r'];

    await expect(runIdle(chunks)).resolves.toBe('[image 0] describe');
    expect(runBusy(chunks)).toBe('[image 0] describe');
  });

  it('keeps split OSC 1337 image placeholder parity', async () => {
    const imageBytes = Buffer.from('png-bytes'.repeat(20)).toString('base64');
    const osc = `\x1b]1337;File=name=${Buffer.from('pasted.png').toString('base64')};inline=1:${imageBytes}\x07`;
    const splitAt = osc.indexOf(imageBytes) + 8;
    const chunks = [osc.slice(0, splitAt), osc.slice(splitAt), ' describe', '\r'];

    await expect(runIdle(chunks)).resolves.toBe('[image 0] describe');
    expect(runBusy(chunks)).toBe('[image 0] describe');
  });
});

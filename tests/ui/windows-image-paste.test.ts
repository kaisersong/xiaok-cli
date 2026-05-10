import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InputReader } from '../../src/ui/input.js';
import { ReplRenderer } from '../../src/ui/repl-renderer.js';
import { createTtyHarness } from '../support/tty.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('windows clipboard image import', () => {
  it('imports a clipboard image placeholder on Alt+V for Windows terminals', async () => {
    const harness = createTtyHarness();
    const reader = new InputReader(new ReplRenderer(process.stdout));
    const imageDir = join(tmpdir(), `xiaok-input-image-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tempDirs.push(imageDir);
    mkdirSync(imageDir, { recursive: true });
    const imagePath = join(imageDir, 'clipboard-altv.png');
    writeFileSync(imagePath, Buffer.from('png-bytes'));
    reader.setClipboardImageSaver(() => imagePath);
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

    const pending = reader.read('> ');
    harness.send('\x1bv');
    harness.send(' explain this');
    expect(harness.output.normalized).toContain('[image 0] explain this');
    harness.send('\r');

    await expect(pending).resolves.toBe('[image 0] explain this');

    harness.restore();
  });

  it('ignores Alt+V when the Windows clipboard does not contain an image', async () => {
    const harness = createTtyHarness();
    const reader = new InputReader(new ReplRenderer(process.stdout));
    reader.setClipboardImageSaver(() => null);
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

    const pending = reader.read('> ');
    harness.send('\x1bv');
    harness.send('plain text');
    expect(harness.output.normalized).toContain('plain text');
    expect(harness.output.normalized).not.toContain('[image 0]');
    harness.send('\r');

    await expect(pending).resolves.toBe('plain text');

    harness.restore();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { clearPastedImagePaths, parseInputBlocks } from '../../src/ui/image-input.js';
import { createInputPasteController } from '../../src/ui/input-paste.js';

const tempDirs: string[] = [];

function writeTempImage(name: string, bytes = 'png-bytes'): string {
  const dir = mkdtempSync(join(tmpdir(), 'xiaok-input-paste-'));
  tempDirs.push(dir);
  const imagePath = join(dir, name);
  writeFileSync(imagePath, Buffer.from(bytes));
  return imagePath;
}

describe('input paste controller', () => {
  afterEach(() => {
    clearPastedImagePaths();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('imports clipboard images as registered placeholders', async () => {
    const imagePath = writeTempImage('clipboard.png');
    const controller = createInputPasteController({
      clipboardImageSaver: () => imagePath,
    });

    const placeholder = controller.importClipboardImage();

    expect(placeholder).toBe('[image 0]');
    const blocks = await parseInputBlocks(placeholder ?? '', true);
    expect(blocks[0]).toMatchObject({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
      },
    });
  });

  it('increments placeholders for multiple clipboard images', () => {
    const imagePaths = [
      writeTempImage('first.png', 'first-image'),
      writeTempImage('second.png', 'second-image'),
    ];
    const controller = createInputPasteController({
      clipboardImageSaver: () => imagePaths.shift() ?? null,
    });

    expect(controller.importClipboardImage()).toBe('[image 0]');
    expect(controller.importClipboardImage()).toBe('[image 1]');
  });

  it('returns null when clipboard import has no image', () => {
    const controller = createInputPasteController({
      clipboardImageSaver: () => null,
    });

    expect(controller.importClipboardImage()).toBeNull();
  });

  it('converts complete OSC 1337 image payloads into registered placeholders', async () => {
    const controller = createInputPasteController({
      clipboardImageSaver: () => null,
    });
    const imageBytes = Buffer.from('png-bytes').toString('base64');
    const osc = `\x1b]1337;File=name=${Buffer.from('pasted.png').toString('base64')};inline=1:${imageBytes}\x07`;

    const result = controller.handleChunk(osc);

    expect(result).toEqual({ handled: true, placeholder: '[image 0]' });
    const blocks = await parseInputBlocks(result.placeholder ?? '', true);
    expect(blocks[0]).toMatchObject({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
      },
    });
  });

  it('buffers split OSC 1337 image payloads until the final chunk', () => {
    const controller = createInputPasteController({
      clipboardImageSaver: () => null,
    });
    const imageBytes = Buffer.from('png-bytes'.repeat(20)).toString('base64');
    const osc = `\x1b]1337;File=name=${Buffer.from('pasted.png').toString('base64')};inline=1:${imageBytes}\x07`;
    const splitAt = osc.indexOf(imageBytes) + 8;

    expect(controller.handleChunk(osc.slice(0, splitAt))).toEqual({ handled: true });
    expect(controller.handleChunk(osc.slice(splitAt))).toEqual({
      handled: true,
      placeholder: '[image 0]',
    });
  });

  it('leaves ordinary text chunks unhandled', () => {
    const controller = createInputPasteController({
      clipboardImageSaver: () => null,
    });

    expect(controller.handleChunk('hello')).toEqual({ handled: false });
  });
});

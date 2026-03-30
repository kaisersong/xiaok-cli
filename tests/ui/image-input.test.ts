import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { parseInputBlocks } from '../../src/ui/image-input.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('image input parsing', () => {
  it('converts a local image path into an image block when the model supports it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xiaok-image-input-'));
    tempDirs.push(dir);
    const imagePath = join(dir, 'demo.png');
    writeFileSync(imagePath, Buffer.from('png-bytes'));

    const blocks = await parseInputBlocks(imagePath, true);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
      },
    });
  });

  it('keeps plain text input unchanged when it is not an image path', async () => {
    const blocks = await parseInputBlocks('please summarize this', true);

    expect(blocks).toEqual([{ type: 'text', text: 'please summarize this' }]);
  });

  it('throws when an image path is provided to a model without image support', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xiaok-image-input-'));
    tempDirs.push(dir);
    const imagePath = join(dir, 'demo.jpg');
    writeFileSync(imagePath, Buffer.from('jpg-bytes'));

    await expect(parseInputBlocks(imagePath, false)).rejects.toThrow(/不支持图片输入/);
  });
});

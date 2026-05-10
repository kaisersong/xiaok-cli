import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { clearPastedImagePaths, parseInputBlocks, setPastedImagePath } from '../../src/ui/image-input.js';

const tempDirs: string[] = [];

afterEach(() => {
  clearPastedImagePaths();
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

  it('converts pasted image placeholders mixed with text into text and image blocks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xiaok-image-input-'));
    tempDirs.push(dir);
    const imagePath = join(dir, 'clipboard.png');
    writeFileSync(imagePath, Buffer.from('png-bytes'));
    setPastedImagePath(0, imagePath);

    const blocks = await parseInputBlocks('please inspect [image 0] carefully', true);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: 'text', text: 'please inspect' });
    expect(blocks[1]).toMatchObject({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
      },
    });
    expect(blocks[2]).toEqual({ type: 'text', text: 'carefully' });
  });
});

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..');

describe('desktop icon generation', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('generates cross-platform icon assets from the bundled desktop source', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xiaok-desktop-icon-'));

    const generated = spawnSync('node', [
      'scripts/desktop-icon.mjs',
      '--out',
      tempDir,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(generated.status).toBe(0);
    const iconSource = await readFile(join(tempDir, 'icon-source.txt'), 'utf8');
    const appIcon = await readFile(join(tempDir, 'icon.png'));
    const windowsIcon = await readFile(join(tempDir, 'icon.ico'));
    const icns = await readFile(join(tempDir, 'icon.icns'));
    const png = await readFile(join(tempDir, 'icon.iconset', 'icon_512x512.png'));

    expect(iconSource.trim()).toBe('xiaok.png');
    expect(appIcon.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(windowsIcon.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x00, 0x01, 0x00]));
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns');
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect((await stat(join(tempDir, 'icon.png'))).size).toBeGreaterThan(1024);
    expect((await stat(join(tempDir, 'icon.ico'))).size).toBeGreaterThan(1024);
    expect((await stat(join(tempDir, 'icon.icns'))).size).toBeGreaterThan(1024);
    expect((await stat(join(tempDir, 'icon.iconset', 'icon_512x512.png'))).size).toBeGreaterThan(1024);

    const logoBounds = findForegroundBounds(decodePng(appIcon));
    const logoCenterX = (logoBounds.minX + logoBounds.maxX + 1) / 2;
    const logoCenterY = (logoBounds.minY + logoBounds.maxY + 1) / 2;

    expect(Math.abs(logoCenterX - 512)).toBeLessThan(1024 * 0.03);
    expect(Math.abs(logoCenterY - 512)).toBeLessThan(1024 * 0.03);
  });
});

function decodePng(png: Buffer): { width: number; height: number; rgba: Buffer } {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idatChunks: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === 'IDAT') {
      idatChunks.push(data);
    }
    offset += length + 12;
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const rgba = Buffer.alloc(width * height * 4);
  const scanlineLength = width * 4 + 1;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * scanlineLength];
    expect(filter).toBe(0);
    inflated.copy(rgba, y * width * 4, y * scanlineLength + 1, (y + 1) * scanlineLength);
  }
  return { width, height, rgba };
}

function findForegroundBounds(image: { width: number; height: number; rgba: Buffer }): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = image.width;
  let maxX = -1;
  let minY = image.height;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const r = image.rgba[offset];
      const g = image.rgba[offset + 1];
      const b = image.rgba[offset + 2];
      const a = image.rgba[offset + 3];
      if (r > 200 && g > 230 && b > 220 && a === 255) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  expect(maxX).toBeGreaterThan(-1);
  return { minX, maxX, minY, maxY };
}

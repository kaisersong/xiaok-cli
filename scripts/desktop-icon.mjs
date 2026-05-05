#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const outArgIndex = args.indexOf('--out');
const outputRoot = resolve(repoRoot, outArgIndex >= 0 ? args[outArgIndex + 1] ?? '' : 'desktop/build');
const skipIcns = args.includes('--skip-icns');

const srcPngPath = join(repoRoot, 'data', 'xiaok.png');
const iconsetPath = join(outputRoot, 'icon.iconset');
const pngPath = join(outputRoot, 'icon.png');
const icnsPath = join(outputRoot, 'icon.icns');

// Use PNG source if available, fall back to text logo
const usePng = existsSync(srcPngPath);

await rm(iconsetPath, { recursive: true, force: true });
await mkdir(iconsetPath, { recursive: true });

if (usePng) {
  await writeFile(join(outputRoot, 'icon-source.txt'), 'xiaok.png\n', 'utf8');
} else {
  const logoPath = join(repoRoot, 'data', 'logo.txt');
  const logo = (await readFile(logoPath, 'utf8')).replace(/\s+$/u, '');
  await writeFile(join(outputRoot, 'icon-source.txt'), logo + '\n', 'utf8');
}

const iconSizes = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

if (usePng) {
  // Resize PNG source for each icon size using sips
  for (const [name, size] of iconSizes) {
    const outPath = join(iconsetPath, name);
    const result = spawnSync('sips', ['-z', String(size), String(size), srcPngPath, '--out', outPath], { encoding: 'utf8' });
    if (result.status !== 0) {
      console.error('sips failed:', result.stderr);
    }
    if (size === 1024) {
      const { copyFileSync } = await import('node:fs');
      copyFileSync(outPath, pngPath);
    }
  }
} else {
  const logoPath = join(repoRoot, 'data', 'logo.txt');
  const logo = (await readFile(logoPath, 'utf8')).replace(/\s+$/u, '');
  for (const [name, size] of iconSizes) {
    const png = renderLogoPng(size, logo);
    await writeFile(join(iconsetPath, name), png);
    if (size === 1024) {
      await writeFile(pngPath, png);
    }
  }
}

if (!skipIcns) {
  await writeIcns(iconsetPath, icnsPath);

  const checked = spawnSync('file', [pngPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (checked.status !== 0 || !existsSync(pngPath)) {
    process.exit(checked.status ?? 1);
  }
}

function renderLogoPng(size, logoText) {
  const pixels = Buffer.alloc(size * size * 4, 0);
  drawRoundedRect(pixels, size, Math.floor(size * 0.08), Math.floor(size * 0.08), Math.floor(size * 0.84), Math.floor(size * 0.84), Math.floor(size * 0.18), [8, 28, 30, 255]);
  drawRoundedRect(pixels, size, Math.floor(size * 0.12), Math.floor(size * 0.12), Math.floor(size * 0.76), Math.floor(size * 0.76), Math.floor(size * 0.13), [13, 59, 61, 255]);

  const lines = logoText.split(/\r?\n/u).map((line) => Array.from(line));
  const bounds = findLogoBounds(lines);
  const columns = bounds.maxX - bounds.minX + 1;
  const rows = bounds.maxY - bounds.minY + 1;
  const cell = Math.floor(Math.min(size * 0.6 / columns, size * 0.58 / rows));
  const gap = Math.max(1, Math.floor(cell * 0.12));
  const cellFill = Math.max(1, cell - gap);
  const gridWidth = columns * cell;
  const gridHeight = rows * cell;
  const startX = Math.floor((size - gridWidth) / 2);
  const startY = Math.floor((size - gridHeight) / 2);

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (lines[y][x] === ' ') continue;
      const px = startX + (x - bounds.minX) * cell;
      const py = startY + (y - bounds.minY) * cell;
      drawRoundedRect(pixels, size, px, py, cellFill, cellFill, Math.max(1, Math.floor(cellFill * 0.15)), [225, 252, 247, 255]);
    }
  }

  return encodePng(size, size, pixels);
}

function findLogoBounds(lines) {
  let minX = Infinity;
  let maxX = -1;
  let minY = Infinity;
  let maxY = -1;
  for (let y = 0; y < lines.length; y += 1) {
    for (let x = 0; x < lines[y].length; x += 1) {
      if (lines[y][x] === ' ') continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  return { minX, maxX, minY, maxY };
}

function drawRoundedRect(pixels, imageSize, x, y, width, height, radius, color) {
  const right = x + width - 1;
  const bottom = y + height - 1;
  for (let py = y; py <= bottom; py += 1) {
    for (let px = x; px <= right; px += 1) {
      const dx = px < x + radius ? x + radius - px : px > right - radius ? px - (right - radius) : 0;
      const dy = py < y + radius ? y + radius - py : py > bottom - radius ? py - (bottom - radius) : 0;
      if (dx * dx + dy * dy > radius * radius) continue;
      setPixel(pixels, imageSize, px, py, color);
    }
  }
}

function setPixel(pixels, imageSize, x, y, color) {
  if (x < 0 || y < 0 || x >= imageSize || y >= imageSize) return;
  const offset = (y * imageSize + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function encodePng(width, height, rgba) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    scanlines[y * (width * 4 + 1)] = 0;
    rgba.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', createIhdr(width, height)),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createIhdr(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return ihdr;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

async function writeIcns(sourceIconsetPath, outputPath) {
  const entries = [
    ['icp4', 'icon_16x16.png'],
    ['icp5', 'icon_32x32.png'],
    ['icp6', 'icon_32x32@2x.png'],
    ['ic07', 'icon_128x128.png'],
    ['ic08', 'icon_256x256.png'],
    ['ic09', 'icon_512x512.png'],
    ['ic10', 'icon_512x512@2x.png'],
  ];
  const chunks = [];
  let totalLength = 8;
  for (const [type, name] of entries) {
    const data = await readFile(join(sourceIconsetPath, name));
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    chunks.push(header, data);
    totalLength += data.length + 8;
  }
  const fileHeader = Buffer.alloc(8);
  fileHeader.write('icns', 0, 'ascii');
  fileHeader.writeUInt32BE(totalLength, 4);
  await writeFile(outputPath, Buffer.concat([fileHeader, ...chunks], totalLength));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

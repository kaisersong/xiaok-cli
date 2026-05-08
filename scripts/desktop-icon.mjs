#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const outArgIndex = args.indexOf('--out');
const outputRoot = resolve(repoRoot, outArgIndex >= 0 ? args[outArgIndex + 1] ?? '' : 'desktop/build');
const skipIcns = args.includes('--skip-icns');

const srcPngPath = join(repoRoot, 'data', 'xiaok.png');
const logoPath = join(repoRoot, 'data', 'logo.txt');
const iconsetPath = join(outputRoot, 'icon.iconset');
const pngPath = join(outputRoot, 'icon.png');
const icnsPath = join(outputRoot, 'icon.icns');
const icoPath = join(outputRoot, 'icon.ico');

// Use PNG source if available, fall back to text logo
const usePng = existsSync(srcPngPath);

await rm(iconsetPath, { recursive: true, force: true });
await mkdir(iconsetPath, { recursive: true });

if (usePng) {
  await writeFile(join(outputRoot, 'icon-source.txt'), 'xiaok.png\n', 'utf8');
} else {
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

let sourceImage = null;
if (usePng) {
  sourceImage = decodePng(await readFile(srcPngPath));
}

const logo = sourceImage ? null : (await readFile(logoPath, 'utf8')).replace(/\s+$/u, '');
for (const [name, size] of iconSizes) {
  const png = sourceImage
    ? encodePng(size, size, resizeRgba(sourceImage, size, size))
    : renderLogoPng(size, logo);
  await writeFile(join(iconsetPath, name), png);
  if (size === 1024) {
    await writeFile(pngPath, png);
  }
}

await writeIco(iconsetPath, icoPath);

if (!skipIcns) {
  await writeIcns(iconsetPath, icnsPath);
}

if (!existsSync(pngPath) || !existsSync(icoPath) || (!skipIcns && !existsSync(icnsPath))) {
  process.exit(1);
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

function decodePng(png) {
  if (png.subarray(0, 8).compare(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) !== 0) {
    throw new Error('Unsupported PNG signature');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compression = 0;
  let filterMethod = 0;
  let interlace = 0;
  const idatChunks = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      compression = data[10];
      filterMethod = data[11];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  if (bitDepth !== 8 || colorType !== 6 || compression !== 0 || filterMethod !== 0 || interlace !== 0) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth} colorType=${colorType} compression=${compression} filter=${filterMethod} interlace=${interlace}`);
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const stride = width * 4;
  const scanlineLength = stride + 1;
  const rgba = Buffer.alloc(width * height * 4);
  let readOffset = 0;
  let prev = Buffer.alloc(stride, 0);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[readOffset];
    const current = Buffer.from(inflated.subarray(readOffset + 1, readOffset + scanlineLength));
    unfilterScanline(current, prev, filter);
    current.copy(rgba, y * stride);
    prev = current;
    readOffset += scanlineLength;
  }

  return { width, height, rgba };
}

function unfilterScanline(current, prev, filter) {
  switch (filter) {
    case 0:
      return;
    case 1:
      for (let i = 0; i < current.length; i += 1) {
        const left = i >= 4 ? current[i - 4] : 0;
        current[i] = (current[i] + left) & 0xff;
      }
      return;
    case 2:
      for (let i = 0; i < current.length; i += 1) {
        current[i] = (current[i] + prev[i]) & 0xff;
      }
      return;
    case 3:
      for (let i = 0; i < current.length; i += 1) {
        const left = i >= 4 ? current[i - 4] : 0;
        const up = prev[i];
        current[i] = (current[i] + Math.floor((left + up) / 2)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < current.length; i += 1) {
        const left = i >= 4 ? current[i - 4] : 0;
        const up = prev[i];
        const upLeft = i >= 4 ? prev[i - 4] : 0;
        current[i] = (current[i] + paethPredictor(left, up, upLeft)) & 0xff;
      }
      return;
    default:
      throw new Error(`Unsupported PNG filter type: ${filter}`);
  }
}

function paethPredictor(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function resizeRgba(image, targetWidth, targetHeight) {
  if (image.width === targetWidth && image.height === targetHeight) {
    return Buffer.from(image.rgba);
  }

  const output = Buffer.alloc(targetWidth * targetHeight * 4);
  const xScale = image.width / targetWidth;
  const yScale = image.height / targetHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = clamp((y + 0.5) * yScale - 0.5, 0, image.height - 1);
    const y0 = Math.floor(srcY);
    const y1 = Math.min(image.height - 1, y0 + 1);
    const yWeight = srcY - y0;

    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = clamp((x + 0.5) * xScale - 0.5, 0, image.width - 1);
      const x0 = Math.floor(srcX);
      const x1 = Math.min(image.width - 1, x0 + 1);
      const xWeight = srcX - x0;
      const destOffset = (y * targetWidth + x) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        const p00 = image.rgba[(y0 * image.width + x0) * 4 + channel];
        const p10 = image.rgba[(y0 * image.width + x1) * 4 + channel];
        const p01 = image.rgba[(y1 * image.width + x0) * 4 + channel];
        const p11 = image.rgba[(y1 * image.width + x1) * 4 + channel];
        const top = p00 + (p10 - p00) * xWeight;
        const bottom = p01 + (p11 - p01) * xWeight;
        output[destOffset + channel] = Math.round(top + (bottom - top) * yWeight);
      }
    }
  }

  return output;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

async function writeIco(sourceIconsetPath, outputPath) {
  const entries = [
    ['icon_16x16.png', 16],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_256x256.png', 256],
  ];

  const images = await Promise.all(entries.map(async ([name, size]) => ({
    size,
    data: await readFile(join(sourceIconsetPath, name)),
  })));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let dataOffset = header.length + directory.length;
  const imageBuffers = [];

  images.forEach((image, index) => {
    const entryOffset = index * 16;
    directory[entryOffset] = image.size >= 256 ? 0 : image.size;
    directory[entryOffset + 1] = image.size >= 256 ? 0 : image.size;
    directory[entryOffset + 2] = 0;
    directory[entryOffset + 3] = 0;
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(image.data.length, entryOffset + 8);
    directory.writeUInt32LE(dataOffset, entryOffset + 12);
    dataOffset += image.data.length;
    imageBuffers.push(image.data);
  });

  await writeFile(outputPath, Buffer.concat([header, directory, ...imageBuffers]));
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

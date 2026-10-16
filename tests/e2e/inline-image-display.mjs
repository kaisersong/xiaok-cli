#!/usr/bin/env node
// Run in a real Kitty/Ghostty terminal: node tests/e2e/inline-image-display.mjs
// --old reproduces the previous placement order for a visual comparison.
import { crc32, deflateSync } from 'node:zlib';
import { ScrollRegionManager } from '../../dist/ui/scroll-region.js';
import { detectImageProtocol, renderImageLines, renderInlineImageBlock } from '../../dist/ui/image-renderer.js';

// --wire exercises UTF-8 history cells inside an isolated tmux, without GPU claims.
const wireTest = process.argv.includes('--wire');
if (!process.stdout.isTTY || !process.stdin.isTTY || (!wireTest && detectImageProtocol() !== 'kitty')) {
  throw new Error('Run this script in a Kitty graphics terminal outside tmux (e.g. Ghostty).');
}
const width = 360, height = 216;
const pixels = Buffer.alloc(height * (width * 3 + 1));
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const p = y * (width * 3 + 1) + 1 + x * 3;
    const stripe = Math.floor(y / 36) % 3;
    pixels[p + stripe] = 230;
    if (x < 8 || x > width - 9) pixels.fill(255, p, p + 3);
  }
}
function chunk(kind, data) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); bytes.write(kind, 4, 'ascii'); data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, bytes.length - 4)), bytes.length - 4);
  return bytes;
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
const data = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
const manager = new ScrollRegionManager();
let imageId = 10000, outputId = 0;
function image() {
  if (!process.argv.includes('--old')) {
    const rendered = renderInlineImageBlock({ data, mediaType: 'image/png', protocol: 'kitty', unicodePlaceholders: wireTest || undefined, columns: process.stdout.columns, maxRows: Math.min(14, manager.maxContentRows - 1), imageId: imageId++ });
    if (!rendered.protocol) { manager.writeAtContentCursor(rendered.text); return; }
    manager.writeRawBlock(rendered.text, rendered.rows, { cursorStationary: rendered.cursorStationary });
    return;
  }
  const rendered = renderImageLines({ data, mediaType: 'image/png', protocol: 'kitty', columns: process.stdout.columns, maxRows: Math.min(12, manager.maxContentRows - 1), imageId: imageId++ });
  if (!rendered.protocol) { manager.writeAtContentCursor(`${rendered.lines[0]}\n`); return; }
  manager.writeRawBlock(process.argv.includes('--old') ? `${rendered.lines.join('\n')}\n` : rendered.lines[0], rendered.rows, { cursorStationary: !process.argv.includes('--old') });
}
manager.begin();
manager.renderPromptFrame({ inputValue: 'KEEP_DRAFT', cursor: 4, placeholder: '', statusLine: 'n: 3 lines | s: 80 lines | i: image | q: exit' });
for (let i = 1; i < manager.maxContentRows; i++) manager.writeAtContentCursor(`BEFORE_IMAGE_${i}\n`);
image();
process.stdin.setRawMode(true); process.stdin.resume();
function close() { manager.end(); process.stdin.setRawMode(false); process.stdin.pause(); process.exit(0); }
process.stdin.on('data', buffer => {
  for (const key of buffer.toString()) {
    if (key === 'q' || key === '\x03') close();
    if (key === 'n' || key === '\r') {
      for (let i = 0; i < 3; i++) manager.writeAtContentCursor(`AFTER_IMAGE_${++outputId}\n`);
      manager.renderActivity('Working — image should move with the transcript');
    }
    if (key === 'i') image();
    if (key === 's') {
      for (let i = 0; i < 80; i++) manager.writeAtContentCursor(`LONG_OUTPUT_${++outputId}\n`);
      manager.renderActivity('Working — scroll up to see images with padding');
    }
  }
});
process.stdout.on('resize', () => manager.updateSize(process.stdout.rows ?? 24, process.stdout.columns ?? 80));
process.on('SIGTERM', close);

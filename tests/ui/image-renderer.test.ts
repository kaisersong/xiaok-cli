import { describe, expect, it } from 'vitest';
import {
  detectImageProtocol,
  readImageDimensions,
  renderImageLines,
  formatImageFallbackLine,
} from '../../src/ui/image-renderer.js';

function pngBuffer(width: number, height: number, payloadBytes = 0): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  return Buffer.concat([header, ihdr, Buffer.alloc(payloadBytes, 0x41)]);
}

function jpegBuffer(width: number, height: number): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  // APP0 segment that must be skipped before the SOF0 marker is found.
  const app0 = Buffer.alloc(4 + 14);
  app0[0] = 0xff;
  app0[1] = 0xe0;
  app0.writeUInt16BE(16, 2);
  parts.push(app0);
  const sof = Buffer.alloc(2 + 2 + 1 + 2 + 2 + 1);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(8, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  parts.push(sof);
  return Buffer.concat(parts);
}

function gifBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(13);
  buffer.write('GIF89a', 0, 'ascii');
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  return buffer;
}

function webpVp8xBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  buffer.writeUInt32LE(10, 16);
  buffer[20] = 0x10;
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

function webpVp8Buffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8 ', 12, 'ascii');
  buffer.writeUInt32LE(10, 16);
  buffer[23] = 0x9d;
  buffer[24] = 0x01;
  buffer[25] = 0x2a;
  buffer.writeUInt16LE(width, 26);
  buffer.writeUInt16LE(height, 28);
  return buffer;
}

describe('detectImageProtocol', () => {
  it('returns null when stdout is not a TTY', () => {
    expect(detectImageProtocol({ TERM_PROGRAM: 'ghostty' }, false)).toBeNull();
  });

  it('returns null when XIAOK_INLINE_IMAGE=0 disables inline images', () => {
    expect(detectImageProtocol({ TERM_PROGRAM: 'ghostty', XIAOK_INLINE_IMAGE: '0' }, true)).toBeNull();
  });

  it('returns null inside tmux', () => {
    expect(detectImageProtocol({ TERM_PROGRAM: 'ghostty', TMUX: '/tmp/tmux-501/default,1,0' }, true)).toBeNull();
  });

  it('returns null under screen TERM', () => {
    expect(detectImageProtocol({ TERM: 'screen-256color', KITTY_WINDOW_ID: '1' }, true)).toBeNull();
  });

  it('detects kitty via KITTY_WINDOW_ID', () => {
    expect(detectImageProtocol({ KITTY_WINDOW_ID: '3', TERM: 'xterm-kitty' }, true)).toBe('kitty');
  });

  it('detects the kitty family terminals by TERM_PROGRAM', () => {
    for (const program of ['kitty', 'ghostty', 'WezTerm', 'WarpTerminal']) {
      expect(detectImageProtocol({ TERM_PROGRAM: program }, true)).toBe('kitty');
    }
  });

  it('detects iTerm2 via TERM_PROGRAM and ITERM_SESSION_ID', () => {
    expect(detectImageProtocol({ TERM_PROGRAM: 'iTerm.app' }, true)).toBe('iterm2');
    expect(detectImageProtocol({ ITERM_SESSION_ID: 'w0t0p0' }, true)).toBe('iterm2');
  });

  it('returns null for unknown terminals', () => {
    expect(detectImageProtocol({ TERM: 'xterm-256color', TERM_PROGRAM: 'Apple_Terminal' }, true)).toBeNull();
  });
});

describe('readImageDimensions', () => {
  it('parses PNG header dimensions', () => {
    expect(readImageDimensions(pngBuffer(1388, 278))).toEqual({ width: 1388, height: 278 });
  });

  it('parses JPEG SOF0 dimensions after skipping other segments', () => {
    expect(readImageDimensions(jpegBuffer(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it('parses GIF logical screen dimensions', () => {
    expect(readImageDimensions(gifBuffer(120, 90))).toEqual({ width: 120, height: 90 });
  });

  it('parses WebP VP8X canvas dimensions', () => {
    expect(readImageDimensions(webpVp8xBuffer(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it('parses WebP lossy VP8 dimensions', () => {
    expect(readImageDimensions(webpVp8Buffer(320, 200))).toEqual({ width: 320, height: 200 });
  });

  it('returns null for unrecognized bytes', () => {
    expect(readImageDimensions(Buffer.from('not an image at all', 'utf8'))).toBeNull();
  });
});

describe('formatImageFallbackLine', () => {
  it('includes the parsed pixel dimensions', () => {
    const line = formatImageFallbackLine({ width: 1388, height: 278 });
    expect(line).toContain('│ [Image 1388×278]');
    expect(line).not.toContain('↳');
  });

  it('omits dimensions when the header could not be parsed', () => {
    expect(formatImageFallbackLine(null)).toContain('│ [Image]');
    expect(formatImageFallbackLine(null)).not.toContain('↳');
  });
});

describe('renderImageLines', () => {
  it('falls back to a single text line when no protocol is available', () => {
    const rendered = renderImageLines({
      data: pngBuffer(1388, 278),
      mediaType: 'image/png',
      protocol: null,
    });

    expect(rendered.rows).toBe(1);
    expect(rendered.lines).toHaveLength(1);
    expect(rendered.lines[0]).toContain('[Image 1388×278]');
    expect(rendered.protocol).toBeNull();
  });

  it('renders a kitty APC sequence on the first row and pads the remaining rows', () => {
    const rendered = renderImageLines({
      data: pngBuffer(1388, 278),
      mediaType: 'image/png',
      protocol: 'kitty',
      columns: 80,
      imageId: 7,
    });

    // 1388x278 px / 9x18 cell => 155x16 cells, clamped to maxCols=40 => 40x4
    expect(rendered.rows).toBe(4);
    expect(rendered.cols).toBe(40);
    expect(rendered.lines).toHaveLength(4);
    expect(rendered.lines[0]).toContain('\x1b_G');
    expect(rendered.lines[0]).toContain('a=T');
    expect(rendered.lines[0]).toContain('f=100');
    expect(rendered.lines[0]).toContain('c=40');
    expect(rendered.lines[0]).toContain('r=4');
    expect(rendered.lines[0]).toContain('C=1');
    expect(rendered.lines[0]).toContain('i=7');
    expect(rendered.lines[0].endsWith('\x1b\\')).toBe(true);
    expect(rendered.lines.slice(1)).toEqual(['', '', '']);
  });

  it('chunks large kitty payloads with m=1 continuations and a final m=0 chunk', () => {
    const rendered = renderImageLines({
      data: pngBuffer(360, 360, 12_000),
      mediaType: 'image/png',
      protocol: 'kitty',
      imageId: 11,
    });

    const sequence = rendered.lines[0];
    const chunks = sequence.split('\x1b\\').filter((part) => part.length > 0);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain('m=1');
    expect(chunks[0]).toContain('i=11');
    for (const middle of chunks.slice(1, -1)) {
      expect(middle).toContain('m=1');
      expect(middle).not.toContain('a=T');
    }
    expect(chunks[chunks.length - 1]).toContain('m=0');

    const payload = chunks
      .map((chunk) => chunk.slice(chunk.indexOf(';') + 1))
      .join('');
    expect(payload).toBe(pngBuffer(360, 360, 12_000).toString('base64'));
    for (const chunk of chunks) {
      expect(chunk.slice(chunk.indexOf(';') + 1).length).toBeLessThanOrEqual(4096);
    }
  });

  it('falls back to text for non-PNG data on the kitty protocol', () => {
    const rendered = renderImageLines({
      data: jpegBuffer(640, 480),
      mediaType: 'image/jpeg',
      protocol: 'kitty',
    });

    expect(rendered.rows).toBe(1);
    expect(rendered.protocol).toBeNull();
    expect(rendered.lines[0]).toContain('[Image 640×480]');
  });

  it('renders iTerm2 images with an explicit height and cursor-up line model', () => {
    const data = jpegBuffer(640, 480);
    const rendered = renderImageLines({
      data,
      mediaType: 'image/jpeg',
      protocol: 'iterm2',
      columns: 80,
    });

    // 640x480 px / 9x18 cell => 72x27 cells; rows clamp to 12 => cols = round(72*12/27) = 32
    expect(rendered.rows).toBe(12);
    expect(rendered.cols).toBe(32);
    expect(rendered.lines).toHaveLength(12);
    expect(rendered.lines.slice(0, 11)).toEqual(Array(11).fill(''));

    const last = rendered.lines[11];
    expect(last.startsWith('\x1b[11A')).toBe(true);
    expect(last).toContain('\x1b]1337;File=inline=1');
    expect(last).toContain(`size=${data.length}`);
    expect(last).toContain('width=32');
    expect(last).toContain('height=12');
    expect(last).not.toContain('height=auto');
    expect(last.endsWith('\x07')).toBe(true);
    expect(last).toContain(`:${data.toString('base64')}\x07`);
  });

  it('does not emit a cursor-up prefix for single-row iTerm2 images', () => {
    const rendered = renderImageLines({
      data: gifBuffer(9, 18),
      mediaType: 'image/gif',
      protocol: 'iterm2',
    });

    expect(rendered.rows).toBe(1);
    expect(rendered.lines[0].startsWith('\x1b]1337;')).toBe(true);
  });

  it('honours explicit maxCols and maxRows limits', () => {
    const rendered = renderImageLines({
      data: pngBuffer(900, 900),
      mediaType: 'image/png',
      protocol: 'kitty',
      maxCols: 10,
      maxRows: 5,
      imageId: 1,
    });

    expect(rendered.cols).toBeLessThanOrEqual(10);
    expect(rendered.rows).toBeLessThanOrEqual(5);
    expect(rendered.lines).toHaveLength(rendered.rows);
  });

  it('derives maxCols from the terminal width when not provided', () => {
    const rendered = renderImageLines({
      data: pngBuffer(4000, 90),
      mediaType: 'image/png',
      protocol: 'kitty',
      columns: 20,
      imageId: 2,
    });

    expect(rendered.cols).toBe(18);
  });

  it('never scales an image below one cell', () => {
    const rendered = renderImageLines({
      data: pngBuffer(4000, 20),
      mediaType: 'image/png',
      protocol: 'kitty',
      maxCols: 4,
      maxRows: 12,
      imageId: 3,
    });

    expect(rendered.rows).toBe(1);
    expect(rendered.cols).toBe(4);
  });

  it('falls back to text when the header cannot be parsed', () => {
    const rendered = renderImageLines({
      data: Buffer.from('garbage', 'utf8'),
      mediaType: 'image/png',
      protocol: 'kitty',
    });

    expect(rendered.protocol).toBeNull();
    expect(rendered.lines[0]).toContain('[Image]');
  });
});

import { describe, expect, it } from 'vitest';
import { renderInlineImageBlock, supportsKittyUnicodePlaceholders } from '../../src/ui/image-renderer.js';

function png(width = 360, height = 216): Buffer {
  const data = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(data);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12, 'ascii');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

describe('inline image blocks', () => {
  it('only selects Unicode placements for terminals with known support', () => {
    expect(supportsKittyUnicodePlaceholders({ TERM_PROGRAM: 'ghostty' })).toBe(true);
    expect(supportsKittyUnicodePlaceholders({ KITTY_WINDOW_ID: '1' })).toBe(true);
    expect(supportsKittyUnicodePlaceholders({ TERM_PROGRAM: 'kitty' })).toBe(true);
    for (const program of ['WezTerm', 'WarpTerminal', 'iTerm.app', '']) {
      expect(supportsKittyUnicodePlaceholders({ TERM_PROGRAM: program })).toBe(false);
    }
  });

  it('prints padded text cells with a virtual placement instead of a clipped screen placement', () => {
    const rendered = renderInlineImageBlock({ data: png(), mediaType: 'image/png', protocol: 'kitty', unicodePlaceholders: true, imageId: 0x010203 });
    expect(rendered.cursorStationary).toBe(false);
    expect(rendered.rows).toBe(14);
    expect(rendered.cols).toBe(40);
    const lines = rendered.text.split('\n');
    expect(lines).toHaveLength(15);
    expect(lines[0]).toBe('');
    expect(lines.slice(-2)).toEqual(['', '']);
    expect(rendered.text).toContain('U=1');
    expect(rendered.text).toContain('i=66051');
    expect(lines[1]).toContain('  \x1b[38;2;1;2;3m\u{10eeee}\u0305\u0305');
    expect(lines[2]).toContain('  \x1b[38;2;1;2;3m\u{10eeee}\u030d\u0305');
    for (const line of lines.slice(1, 13)) {
      expect(Array.from(line).filter(ch => ch === '\u{10eeee}')).toHaveLength(40);
      expect(line.endsWith('\x1b[0m  ')).toBe(true);
    }
    expect(rendered.text).not.toContain('\x1b[12A');
  });

  it('keeps the entire padded footprint inside the terminal budget', () => {
    const rendered = renderInlineImageBlock({ data: png(2000, 2000), mediaType: 'image/png', protocol: 'kitty', unicodePlaceholders: true, columns: 15, maxRows: 7 });
    expect(rendered.rows).toBeLessThanOrEqual(7);
    expect(rendered.cols + 4).toBeLessThanOrEqual(15);
    expect(rendered.text).toContain(`r=${rendered.rows - 2}`);
  });

  it.each([{ columns: 4 }, { maxRows: 2 }])('falls back for a window with no padded image room: %j', budget => {
    const rendered = renderInlineImageBlock({ data: png(), mediaType: 'image/png', protocol: 'kitty', ...budget });
    expect(rendered.protocol).toBeNull();
    expect(rendered.rows).toBe(1);
    expect(rendered.text).toContain('[Image 360×216]');
    expect(rendered.text).not.toContain('\x1b_G');
  });

  it('preserves the stationary Kitty path with padding on unsupported extensions', () => {
    const rendered = renderInlineImageBlock({ data: png(), mediaType: 'image/png', protocol: 'kitty', unicodePlaceholders: false, imageId: 42 });
    expect(rendered.cursorStationary).toBe(true);
    expect(rendered.rows).toBe(14);
    expect(rendered.text.startsWith('\x1b[1B\x1b[3G\x1b_G')).toBe(true);
    expect(rendered.text.endsWith('\x1b[1A\r')).toBe(true);
    expect(rendered.text).not.toContain('U=1');
  });

  it('pads iTerm2 and preserves its line advancement', () => {
    const rendered = renderInlineImageBlock({ data: png(), mediaType: 'image/png', protocol: 'iterm2' });
    expect(rendered.cursorStationary).toBe(false);
    expect(rendered.rows).toBe(14);
    expect(rendered.text.startsWith('\n')).toBe(true);
    expect(rendered.text).toContain('\x1b[11A  \x1b]1337;');
    expect(rendered.text.endsWith('\x07\n\n')).toBe(true);
  });

  it('uses a fresh image ID for each submitted block rather than replacing history ID 1', () => {
    const ids = Array.from({ length: 20 }, () => {
      const rendered = renderInlineImageBlock({ data: png(), mediaType: 'image/png', protocol: 'kitty', unicodePlaceholders: true });
      return Number(rendered.text.match(/,i=(\d+)/)?.[1]);
    });
    expect(new Set(ids).size).toBe(20);
    expect(ids.every(id => id > 0 && id <= 0xffffff)).toBe(true);
  });
});

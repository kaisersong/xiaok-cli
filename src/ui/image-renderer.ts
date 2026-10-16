import { randomInt } from 'node:crypto';
import { formatRailLine } from './render.js';
import { readImageDimensions, type ImageDimensions } from '../shared/media/image.js';
export { readImageDimensions } from '../shared/media/image.js';
export type { ImageDimensions } from '../shared/media/image.js';

export type ImageProtocol = 'kitty' | 'iterm2' | null;

const CELL_PIXEL_WIDTH = 9;
const CELL_PIXEL_HEIGHT = 18;
const DEFAULT_MAX_ROWS = 12;
const DEFAULT_MAX_COLS = 40;
const KITTY_CHUNK_BYTES = 4096;
const KITTY_FAMILY = new Set(['kitty', 'ghostty', 'wezterm', 'warpterminal']);
// First 40 entries of Kitty's gen/rowcolumn-diacritics.txt (protocol order).
const PLACEHOLDER_DIACRITICS = [
  0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f,
  0x0346, 0x034a, 0x034b, 0x034c, 0x0350, 0x0351, 0x0352, 0x0357,
  0x035b, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
  0x036a, 0x036b, 0x036c, 0x036d, 0x036e, 0x036f, 0x0483, 0x0484,
  0x0485, 0x0486, 0x0487, 0x0592, 0x0593, 0x0594, 0x0595, 0x0597,
].map(code => String.fromCodePoint(code));

export function supportsKittyUnicodePlaceholders(env: NodeJS.ProcessEnv = process.env): boolean {
  const program = env.TERM_PROGRAM?.toLowerCase();
  return Boolean(env.KITTY_WINDOW_ID) || program === 'kitty' || program === 'ghostty';
}

export function detectImageProtocol(
  env: NodeJS.ProcessEnv = process.env,
  isTty: boolean = process.stdout.isTTY === true,
): ImageProtocol {
  if (!isTty) return null;
  if (env.XIAOK_INLINE_IMAGE === '0') return null;
  if (env.TMUX) return null;
  if (env.TERM?.includes('screen')) return null;

  const program = env.TERM_PROGRAM?.toLowerCase() ?? '';
  if (env.KITTY_WINDOW_ID || KITTY_FAMILY.has(program)) return 'kitty';
  if (env.ITERM_SESSION_ID || program === 'iterm.app') return 'iterm2';
  return null;
}

export function formatImagePlaceholder(dims: ImageDimensions | null): string {
  return dims ? `[Image ${dims.width}×${dims.height}]` : '[Image]';
}

export function formatImageFallbackLine(dims: ImageDimensions | null): string {
  return formatRailLine(formatImagePlaceholder(dims), 'result');
}

function computeCellBox(
  dims: ImageDimensions,
  maxCols: number,
  maxRows: number,
): { cols: number; rows: number } {
  let cols = Math.max(1, Math.ceil(dims.width / CELL_PIXEL_WIDTH));
  let rows = Math.max(1, Math.ceil(dims.height / CELL_PIXEL_HEIGHT));

  if (cols > maxCols) {
    rows = Math.max(1, Math.round((rows * maxCols) / cols));
    cols = maxCols;
  }
  if (rows > maxRows) {
    cols = Math.max(1, Math.round((cols * maxRows) / rows));
    rows = maxRows;
  }
  return { cols, rows };
}

function buildKittySequence(data: Buffer, cols: number, rows: number, imageId: number, virtual = false): string {
  const payload = data.toString('base64');
  const chunks: string[] = [];
  for (let offset = 0; offset < payload.length; offset += KITTY_CHUNK_BYTES) {
    chunks.push(payload.slice(offset, offset + KITTY_CHUNK_BYTES));
  }

  const multiChunk = chunks.length > 1;
  const head = `a=T,f=100,q=2,c=${cols},r=${rows},C=1,i=${imageId}${virtual ? ',U=1' : ''}${multiChunk ? ',m=1' : ''}`;
  const parts = [`\x1b_G${head};${chunks[0]}\x1b\\`];
  for (let index = 1; index < chunks.length; index += 1) {
    const more = index === chunks.length - 1 ? 0 : 1;
    parts.push(`\x1b_Gm=${more};${chunks[index]}\x1b\\`);
  }
  return parts.join('');
}

function buildIterm2Sequence(data: Buffer, cols: number, rows: number): string {
  return `\x1b]1337;File=inline=1;size=${data.length};width=${cols};height=${rows}:${data.toString('base64')}\x07`;
}

export function renderImageLines(opts: {
  data: Buffer;
  mediaType: string;
  protocol?: ImageProtocol;
  maxCols?: number;
  maxRows?: number;
  columns?: number;
  imageId?: number;
}): { lines: string[]; rows: number; cols: number; protocol: ImageProtocol } {
  const dims = readImageDimensions(opts.data);
  const fallback = {
    lines: [formatImageFallbackLine(dims)],
    rows: 1,
    cols: 0,
    protocol: null as ImageProtocol,
  };

  const protocol = opts.protocol ?? null;
  if (!protocol || !dims) return fallback;
  // Kitty transmits PNG only (f=100); other formats would need a decoder.
  if (protocol === 'kitty' && opts.mediaType !== 'image/png') return fallback;

  const maxCols = opts.maxCols ?? Math.min((opts.columns ?? 80) - 2, DEFAULT_MAX_COLS);
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  if (maxRows < 1 || maxCols < 1) return fallback;
  const { cols, rows } = computeCellBox(dims, Math.max(1, maxCols), Math.max(1, maxRows));

  if (protocol === 'kitty') {
    const sequence = buildKittySequence(opts.data, cols, rows, opts.imageId ?? 1);
    return { lines: [sequence, ...Array(rows - 1).fill('')], rows, cols, protocol };
  }

  const sequence = buildIterm2Sequence(opts.data, cols, rows);
  const prefix = rows > 1 ? `\x1b[${rows - 1}A` : '';
  return { lines: [...Array(rows - 1).fill(''), `${prefix}${sequence}`], rows, cols, protocol };
}

/** A transcript block whose footprint includes one blank row and two columns on each side. */
export function renderInlineImageBlock(opts: Parameters<typeof renderImageLines>[0] & {
  unicodePlaceholders?: boolean;
}): { text: string; rows: number; cols: number; protocol: ImageProtocol; cursorStationary: boolean } {
  // IDs are terminal-global: restarting the CLI must not replace earlier images.
  const imageId = opts.imageId ?? randomInt(1, 0x1000000);
  const rendered = renderImageLines({
    ...opts,
    imageId,
    maxCols: Math.min(opts.maxCols ?? DEFAULT_MAX_COLS, DEFAULT_MAX_COLS, (opts.columns ?? 80) - 4),
    maxRows: Math.min(DEFAULT_MAX_ROWS, (opts.maxRows ?? DEFAULT_MAX_ROWS + 2) - 2),
  });
  if (!rendered.protocol) {
    return { text: `${rendered.lines[0]}\n`, rows: 1, cols: 0, protocol: null, cursorStationary: false };
  }

  const { rows, cols, protocol } = rendered;
  if (protocol === 'kitty') {
    if (opts.unicodePlaceholders ?? supportsKittyUnicodePlaceholders()) {
      const sequence = buildKittySequence(opts.data, cols, rows, imageId, true);
      // Image identity uses RGB directly, independent of theme/color settings.
      const color = `\x1b[38;2;${(imageId >> 16) & 255};${(imageId >> 8) & 255};${imageId & 255}m`;
      const lines = Array.from({ length: rows }, (_, row) => {
        const cells = Array.from({ length: cols }, (_, col) => (
          `\u{10eeee}${PLACEHOLDER_DIACRITICS[row]}${PLACEHOLDER_DIACRITICS[col]}`
        )).join('');
        return `  ${color}${cells}\x1b[0m  `;
      });
      lines[0] = sequence + lines[0];
      return { text: `\n${lines.join('\n')}\n\n`, rows: rows + 2, cols, protocol, cursorStationary: false };
    }
    // The raw writer reserves the whole padded block before stationary placement.
    return {
      text: `\x1b[1B\x1b[3G${rendered.lines[0]}\x1b[1A\r`,
      rows: rows + 2, cols, protocol, cursorStationary: true,
    };
  }

  const lines = [...rendered.lines];
  const last = lines.length - 1;
  const prefix = rows > 1 ? `\x1b[${rows - 1}A` : '';
  lines[last] = `${prefix}  ${buildIterm2Sequence(opts.data, cols, rows)}`;
  return { text: `\n${lines.join('\n')}\n\n`, rows: rows + 2, cols, protocol, cursorStationary: false };
}

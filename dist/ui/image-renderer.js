import { formatRailLine } from './render.js';
const CELL_PIXEL_WIDTH = 9;
const CELL_PIXEL_HEIGHT = 18;
const DEFAULT_MAX_ROWS = 12;
const DEFAULT_MAX_COLS = 40;
const KITTY_CHUNK_BYTES = 4096;
const KITTY_FAMILY = new Set(['kitty', 'ghostty', 'wezterm', 'warpterminal']);
export function detectImageProtocol(env = process.env, isTty = process.stdout.isTTY === true) {
    if (!isTty)
        return null;
    if (env.XIAOK_INLINE_IMAGE === '0')
        return null;
    if (env.TMUX)
        return null;
    if (env.TERM?.includes('screen'))
        return null;
    const program = env.TERM_PROGRAM?.toLowerCase() ?? '';
    if (env.KITTY_WINDOW_ID || KITTY_FAMILY.has(program))
        return 'kitty';
    if (env.ITERM_SESSION_ID || program === 'iterm.app')
        return 'iterm2';
    return null;
}
export function readImageDimensions(data) {
    return readPngDimensions(data)
        ?? readJpegDimensions(data)
        ?? readGifDimensions(data)
        ?? readWebpDimensions(data);
}
function readPngDimensions(data) {
    if (data.length < 24)
        return null;
    if (data.readUInt32BE(0) !== 0x89504e47 || data.readUInt32BE(4) !== 0x0d0a1a0a)
        return null;
    if (data.toString('ascii', 12, 16) !== 'IHDR')
        return null;
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
function readJpegDimensions(data) {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8)
        return null;
    let offset = 2;
    while (offset + 9 < data.length) {
        if (data[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = data[offset + 1];
        const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3)
            || (marker >= 0xc5 && marker <= 0xc7)
            || (marker >= 0xc9 && marker <= 0xcb)
            || (marker >= 0xcd && marker <= 0xcf);
        if (isStartOfFrame) {
            return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
        }
        const segmentLength = data.readUInt16BE(offset + 2);
        if (segmentLength < 2)
            return null;
        offset += 2 + segmentLength;
    }
    return null;
}
function readGifDimensions(data) {
    if (data.length < 10)
        return null;
    const signature = data.toString('ascii', 0, 6);
    if (signature !== 'GIF87a' && signature !== 'GIF89a')
        return null;
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
}
function readWebpDimensions(data) {
    if (data.length < 30)
        return null;
    if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP')
        return null;
    const chunk = data.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
        return {
            width: data.readUIntLE(24, 3) + 1,
            height: data.readUIntLE(27, 3) + 1,
        };
    }
    if (chunk === 'VP8 ') {
        if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a)
            return null;
        return {
            width: data.readUInt16LE(26) & 0x3fff,
            height: data.readUInt16LE(28) & 0x3fff,
        };
    }
    return null;
}
export function formatImagePlaceholder(dims) {
    return dims ? `[Image ${dims.width}×${dims.height}]` : '[Image]';
}
export function formatImageFallbackLine(dims) {
    return formatRailLine(formatImagePlaceholder(dims), 'result');
}
function computeCellBox(dims, maxCols, maxRows) {
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
function buildKittySequence(data, cols, rows, imageId) {
    const payload = data.toString('base64');
    const chunks = [];
    for (let offset = 0; offset < payload.length; offset += KITTY_CHUNK_BYTES) {
        chunks.push(payload.slice(offset, offset + KITTY_CHUNK_BYTES));
    }
    const multiChunk = chunks.length > 1;
    const head = `a=T,f=100,q=2,c=${cols},r=${rows},C=1,i=${imageId}${multiChunk ? ',m=1' : ''}`;
    const parts = [`\x1b_G${head};${chunks[0]}\x1b\\`];
    for (let index = 1; index < chunks.length; index += 1) {
        const more = index === chunks.length - 1 ? 0 : 1;
        parts.push(`\x1b_Gm=${more};${chunks[index]}\x1b\\`);
    }
    return parts.join('');
}
function buildIterm2Sequence(data, cols, rows) {
    return `\x1b]1337;File=inline=1;size=${data.length};width=${cols};height=${rows}:${data.toString('base64')}\x07`;
}
export function renderImageLines(opts) {
    const dims = readImageDimensions(opts.data);
    const fallback = {
        lines: [formatImageFallbackLine(dims)],
        rows: 1,
        cols: 0,
        protocol: null,
    };
    const protocol = opts.protocol ?? null;
    if (!protocol || !dims)
        return fallback;
    // Kitty transmits PNG only (f=100); other formats would need a decoder.
    if (protocol === 'kitty' && opts.mediaType !== 'image/png')
        return fallback;
    const maxCols = opts.maxCols ?? Math.min((opts.columns ?? 80) - 2, DEFAULT_MAX_COLS);
    const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
    const { cols, rows } = computeCellBox(dims, Math.max(1, maxCols), Math.max(1, maxRows));
    if (protocol === 'kitty') {
        const sequence = buildKittySequence(opts.data, cols, rows, opts.imageId ?? 1);
        return { lines: [sequence, ...Array(rows - 1).fill('')], rows, cols, protocol };
    }
    const sequence = buildIterm2Sequence(opts.data, cols, rows);
    const prefix = rows > 1 ? `\x1b[${rows - 1}A` : '';
    return { lines: [...Array(rows - 1).fill(''), `${prefix}${sequence}`], rows, cols, protocol };
}

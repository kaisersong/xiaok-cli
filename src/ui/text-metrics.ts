const ANSI_SEQUENCE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE, '');
}

function isFullWidthCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 && (
      codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
      (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  );
}

export function splitSymbols(text: string): string[] {
  return Array.from(stripAnsi(text));
}

export function clampOffset(text: string, offset: number): number {
  return Math.max(0, Math.min(offset, splitSymbols(text).length));
}

export function getDisplayWidth(text: string): number {
  let width = 0;
  for (const symbol of splitSymbols(text)) {
    const codePoint = symbol.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) continue;
    width += isFullWidthCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

export function moveOffsetLeft(text: string, offset: number): number {
  return clampOffset(text, offset - 1);
}

export function moveOffsetRight(text: string, offset: number): number {
  return clampOffset(text, offset + 1);
}

export function offsetToDisplayColumn(text: string, offset: number): number {
  const symbols = splitSymbols(text);
  return getDisplayWidth(symbols.slice(0, clampOffset(text, offset)).join(''));
}

export function sliceByDisplayColumns(text: string, start: number, width: number): string {
  if (width <= 0) return '';

  let column = 0;
  let result = '';

  for (const symbol of splitSymbols(text)) {
    const symbolWidth = getDisplayWidth(symbol);
    const symbolStart = column;
    const symbolEnd = column + symbolWidth;
    column = symbolEnd;

    if (symbolEnd <= start) continue;
    if (symbolStart >= start + width) break;
    result += symbol;
  }

  return result;
}

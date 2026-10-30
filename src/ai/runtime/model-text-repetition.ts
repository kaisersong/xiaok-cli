export const MODEL_TEXT_REPETITION_CODE = 'MODEL_TEXT_REPETITION_DETECTED';
/** Matches diagnostic code prefix chains, never incidental mentions. */
export function isModelTextRepetitionMessage(text: string): boolean {
  return /^(?:[A-Za-z_][A-Za-z0-9_]*:\s*)*MODEL_TEXT_REPETITION_DETECTED(?![A-Za-z0-9_])/.test(text);
}

/** Prefer structured diagnostics throughout the cause chain before text fallback. */
export function isModelTextRepetitionError(error: unknown): boolean {
  const seen = new Set<object>();
  const messages: string[] = [];
  let current = error;
  while (current != null) {
    if (typeof current === 'string') { messages.push(current); break; }
    if (typeof current !== 'object' || seen.has(current)) break;
    seen.add(current);
    const diagnostic = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (diagnostic.code === MODEL_TEXT_REPETITION_CODE) return true;
    if (typeof diagnostic.message === 'string') messages.push(diagnostic.message);
    current = diagnostic.cause;
  }
  return messages.some(isModelTextRepetitionMessage);
}

export const REPETITION_MIN_COPIES = 8;
export const REPETITION_MIN_SPAN_CHARS = 512;
export const STRUCTURAL_LINE_BACKSTOP_REPEATS = 50;
export const BLOCK_MIN_LINES = 2;
export const BLOCK_MAX_LINES = 20;
export const BLOCK_REPEATS = 10;
export const MAX_REPLY_CHARS = 65536;
export const TANDEM_WINDOW_CHARS = 4096;
export const TANDEM_STEP_CHARS = 32;
export const TANDEM_ANCHOR_CHARS = 16;
export const LINE_PREFIX_CHARS = 64;
export const LINE_HISTORY_LIMIT = BLOCK_MAX_LINES * BLOCK_REPEATS;

type Reason = 'tandem' | 'line_backstop' | 'block' | 'length_cap';

/** Per reply; bounded line history and exact comparisons, never provider diagnostics. */
export class ModelTextRepetitionGuard {
  private tail = '';
  private line: string[] = [];
  private linePrefix = '';
  private total = 0;
  private fence: { marker: string; length: number } | undefined;
  private lines: string[] = [];
  private repeats = 0;
  private previous: string | undefined;

  private fail(reason: Reason): never {
    throw Object.assign(new Error(MODEL_TEXT_REPETITION_CODE), {
      code: MODEL_TEXT_REPETITION_CODE, retryable: false, reason,
    });
  }

  private exempt(): boolean {
    return Boolean(this.fence) || /^(?: {0,3}(?:`{3}|~{3})|\||\[?\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}|\[?(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)(?:\]|\b))/i.test(this.linePrefix);
  }

  private completeLine(): void {
    const raw = this.line.join('');
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    this.repeats = line === this.previous ? this.repeats + 1 : 1;
    this.previous = line;
    if (this.repeats >= STRUCTURAL_LINE_BACKSTOP_REPEATS) this.fail('line_backstop');
    this.lines.push(line);
    if (this.lines.length > LINE_HISTORY_LIMIT) this.lines.shift();
    const n = this.lines.length;
    for (let size = BLOCK_MIN_LINES; size <= BLOCK_MAX_LINES && size * BLOCK_REPEATS <= n; size++) {
      // Uniform blocks belong to the single-line backstop, including blank lines.
      if (this.lines.slice(n - size).every(value => value === line)) continue;
      let same = true;
      for (let i = n - size * BLOCK_REPEATS; i < n - size; i++) {
        if (this.lines[i] !== this.lines[i + size]) { same = false; break; }
      }
      if (same) this.fail('block');
    }
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!this.fence) this.fence = { marker: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === this.fence.marker && marker[1].length >= this.fence.length && !marker[2].trim()) this.fence = undefined;
    }
    this.line = [];
    this.linePrefix = '';
  }

  append(delta: string): void {
    for (let offset = 0; offset < delta.length; offset += TANDEM_STEP_CHARS) {
      const chunk = delta.slice(offset, offset + TANDEM_STEP_CHARS);
      for (const char of chunk.split('')) {
        if (++this.total > MAX_REPLY_CHARS) this.fail('length_cap');
        if (char === '\n') {
          if (this.exempt()) this.tail = '';
          else this.tail = (this.tail + char).slice(-TANDEM_WINDOW_CHARS);
          this.completeLine();
        } else {
          this.line.push(char);
          if (this.linePrefix.length < LINE_PREFIX_CHARS) this.linePrefix += char;
          if (this.exempt()) this.tail = '';
          else this.tail = (this.tail + char).slice(-TANDEM_WINDOW_CHARS);
        }
      }
      if (this.tail.length < REPETITION_MIN_SPAN_CHARS || !/\p{L}/u.test(this.tail)) continue;
      const maxPeriod = Math.min(REPETITION_MIN_SPAN_CHARS, Math.floor(this.tail.length / REPETITION_MIN_COPIES));
      // Native substring search narrows candidate periods before exact checks;
      // ordinary long responses must not stall Electron's main thread.
      const anchor = this.tail.slice(-TANDEM_ANCHOR_CHARS);
      const anchorEnd = this.tail.length - TANDEM_ANCHOR_CHARS;
      for (let at = this.tail.lastIndexOf(anchor, anchorEnd - TANDEM_ANCHOR_CHARS);
        at >= Math.max(0, anchorEnd - maxPeriod);
        at = at > 0 ? this.tail.lastIndexOf(anchor, at - 1) : -1) {
        const period = anchorEnd - at;
        const unit = this.tail.slice(-period);
        if (this.tail.slice(-2 * period, -period) !== unit) continue;
        const copies = Math.max(REPETITION_MIN_COPIES, Math.ceil(REPETITION_MIN_SPAN_CHARS / period));
        if (this.tail.endsWith(unit.repeat(copies)) && /\p{L}/u.test(unit)) {
          // Static diagnostics never retain provider text. The stream owner
          // cancels this attempt in finally instead of retrying the loop.
          this.fail('tandem');
        }
      }
    }
  }
}

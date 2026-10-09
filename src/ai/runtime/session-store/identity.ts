import { openSync, readSync, closeSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export interface NativeSessionIdentity {
  schemaVersion: 1; sessionId: string; cwd: string;
  ownership?: { state: string; ownerInstanceId?: string; previousOwnerInstanceId?: string };
}

/** Native identity header only. Never parses or materializes session messages.
 * New writes put the existing intent ledger before messages; legacy headers
 * without ownership stay readable but cannot grant producer execution. */
export function readNativeSessionIdentity(file: string): NativeSessionIdentity | null {
  let fd: number;
  try { fd = openSync(file, 'r'); } catch { return null; }
  const buffer = Buffer.alloc(64 * 1024);
  let text: string;
  try { text = buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0)).toString('utf8'); }
  finally { closeSync(fd); }
  let position = 0;
  const ws = () => { while (/\s/.test(text[position] ?? '') && position < text.length) position++; };
  const string = (): string => {
    const start = position; if (text[position++] !== '"') throw new Error('identity_invalid_json');
    while (position < text.length) {
      const char = text[position++]; if (char === '\\') position++; else if (char === '"') return JSON.parse(text.slice(start, position));
    }
    throw new Error('identity_header_incomplete');
  };
  const rawValue = (): string => {
    ws(); const start = position;
    if (text[position] === '"') { string(); return text.slice(start, position); }
    if (text[position] === '{' || text[position] === '[') {
      const stack: string[] = [];
      while (position < text.length) {
        const char = text[position];
        if (char === '"') { string(); continue; }
        position++;
        if (char === '{' || char === '[') { stack.push(char); if (stack.length > 64) throw new Error('identity_header_too_deep'); }
        else if (char === '}' || char === ']') {
          if (stack.pop() !== (char === '}' ? '{' : '[')) throw new Error('identity_invalid_json');
          if (!stack.length) return text.slice(start, position);
        }
      }
      throw new Error('identity_header_incomplete');
    }
    while (position < text.length && !/[\s,}\]]/.test(text[position])) position++;
    if (position === start) throw new Error('identity_invalid_json');
    return text.slice(start, position);
  };
  const result: Record<string, unknown> = {};
  const ownership = () => {
    ws(); if (text[position] !== '{') { rawValue(); return; } position++;
    for (;;) {
      ws(); if (text[position] === '}') { position++; return; }
      const key = string(); ws(); if (text[position++] !== ':') throw new Error('identity_invalid_json');
      if (key === 'ownership') { const raw = rawValue(); if (raw.length > 4096) throw new Error('identity_ownership_too_large'); result.ownership = JSON.parse(raw); return; }
      rawValue(); ws(); if (text[position] === ',') position++; else if (text[position] !== '}') throw new Error('identity_invalid_json');
    }
  };
  try {
    ws(); if (text[position++] !== '{') return null;
    for (;;) {
      ws(); if (text[position] === '}' || position >= text.length) break;
      const key = string(); ws(); if (text[position++] !== ':') return null;
      if (key === 'messages') break;
      if (key === 'intentDelegation') { ownership(); break; }
      const raw = rawValue();
      if (['schemaVersion','sessionId','cwd'].includes(key)) result[key] = JSON.parse(raw);
      ws(); if (text[position] === ',') position++; else if (text[position] !== '}') return null;
    }
  } catch { return null; }
  if (result.schemaVersion !== 1 || typeof result.sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(result.sessionId)
    || typeof result.cwd !== 'string' || result.cwd.length > 4096 || !isAbsolute(result.cwd)) return null;
  const record = result.ownership as Record<string, unknown> | undefined;
  if (record && (typeof record.state !== 'string' || record.ownerInstanceId !== undefined && typeof record.ownerInstanceId !== 'string')) return null;
  return result as unknown as NativeSessionIdentity;
}

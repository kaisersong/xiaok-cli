import type { Readable } from 'node:stream';
import { normalizeEnhancedKeys, retainKeyboardProtocol } from './keyboard-protocol.js';

export interface PendingCursorReport {
  readonly active: boolean;
  replay(bytes: Buffer): void;
  cancel(): void;
}

/** Keep a timed-out private CPR out of every stdin owner, including modal input. */
export function deferCursorReport(input: Readable): PendingCursorReport {
  const originalPush = input.push;
  // A modal can release the busy reader while its device reply is in flight.
  // Keep ESC disambiguated until that reply has been completely drained.
  const releaseKeyboard = retainKeyboardProtocol();
  let held = Buffer.alloc(0);
  let active = true;
  const cancel = () => {
    active = false;
    const unconfirmed = held.length && !/^\x1b\[\?/.test(held.toString('latin1')) ? held : Buffer.alloc(0);
    held = Buffer.alloc(0);
    if (input.push === push) input.push = originalPush;
    input.removeListener('close', cancel);
    releaseKeyboard();
    if (unconfirmed.length && !input.destroyed) originalPush.call(input, unconfirmed);
  };
  const deliver = (bytes: Buffer) => {
    if (bytes.length && !input.destroyed) originalPush.call(input, bytes);
  };
  const filter = (bytes: Buffer): Buffer => {
    if (!active) return bytes;
    // A complete enhanced key remains independent of a fragmented device reply.
    if (held.length && /^\x1b\[[\d;:]+u$/.test(bytes.toString('latin1'))) return normalizeEnhancedKeys(bytes);
    const data = Buffer.concat([held, bytes]).toString('latin1');
    held = Buffer.alloc(0);
    let output = '';
    for (let index = 0; index < data.length;) {
      const tail = data.slice(index);
      const report = /^\x1b\[\?\d+;\d+R/.exec(tail);
      if (report) {
        output += tail.slice(report[0].length);
        cancel();
        break;
      }
      const privatePrefix = /^\x1b\[\?\d*(?:;\d*)?$/.test(tail);
      if (tail === '\x1b' || tail === '\x1b[' || privatePrefix) {
        if (tail.length > 64) { cancel(); break; }
        held = Buffer.from(tail, 'latin1');
        // Queries are issued only after a real enhanced key confirms that
        // user ESC arrives as CSI 27 u. Never guess a report boundary by time.
        break;
      }
      output += data[index++];
    }
    return normalizeEnhancedKeys(Buffer.from(output, 'latin1'));
  };
  function push(this: Readable, chunk: unknown, encoding?: BufferEncoding): boolean {
    if (chunk === null) { cancel(); return originalPush.call(this, null); }
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk as Uint8Array);
    return originalPush.call(this, filter(bytes));
  }
  input.push = push;
  input.once('close', cancel);
  return {
    get active() { return active; },
    // Append behind already-buffered stdin bytes; repeated unshift reverses them.
    replay: bytes => deliver(filter(bytes)),
    cancel,
  };
}

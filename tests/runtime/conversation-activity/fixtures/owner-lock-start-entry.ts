import { DatabaseSync } from 'node:sqlite';
import { types } from 'node:util';
import { serveCanonicalConversationActivityOwner } from '../../../../src/runtime/conversation-activity/owner-runtime.js';

// Only the actual child entry is used. No owner/source/native membership is minted.
const retained: unknown[] = [];
function diagnostic(raw: unknown, depth = 0): object {
  retained.push(raw);
  if (depth > 4 || !raw || typeof raw !== 'object' || types.isProxy(raw)) return { type: typeof raw };
  const out: Record<string, unknown> = {};
  for (const key of ['message', 'code', 'errcode', 'cause']) {
    const slot = Object.getOwnPropertyDescriptor(raw, key);
    if (!slot || !Object.hasOwn(slot, 'value')) continue;
    out[key] = key === 'cause' ? diagnostic(slot.value, depth + 1)
      : ['string', 'number', 'boolean', 'undefined'].includes(typeof slot.value) || slot.value === null
        ? slot.value : { type: typeof slot.value };
  }
  return out;
}

if (process.argv[3] === 'reader') {
  const db = new DatabaseSync(process.argv[2]);
  db.exec('BEGIN; SELECT name FROM sqlite_schema');
  process.send?.({ phase: 'reader-ready', pid: process.pid });
  process.once('message', () => {
    setTimeout(() => {
      db.close();
      process.send?.({ phase: 'reader-closed', pid: process.pid }, () => process.disconnect());
    }, 20);
  });
} else {
  process.send?.({ phase: 'entry-ready', pid: process.pid });
  process.once('message', () => {
    void serveCanonicalConversationActivityOwner(process.argv[2]).catch(raw => {
      process.stderr.write(JSON.stringify({ pid: process.pid, error: diagnostic(raw) }) + '\n');
      process.exitCode = 1;
      process.disconnect();
    });
  });
}

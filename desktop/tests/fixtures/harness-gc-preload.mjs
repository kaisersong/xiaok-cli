// Test-only collector control; imported only by the forced-GC crash regression.
import { setImmediate } from 'node:timers/promises';
process.stdin.once('data', async bytes => {
  if (bytes.toString() !== 'fixture-gc\n' || typeof global.gc !== 'function') {
    throw new Error('fixture_gc_protocol_invalid');
  }
  global.gc();
  await setImmediate();
  await setImmediate();
  process.stdout.write(`${JSON.stringify({ fixtureGcComplete: true })}\n`);
});

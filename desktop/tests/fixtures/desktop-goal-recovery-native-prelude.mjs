import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
if (workerThreads.isMainThread) {
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const source = new URL('../../../src/runtime/task-host/protection-read-worker.ts', import.meta.url);
const target = process.env.XIAOK_TEST_RECOVERY_PROTECTION_ENTRY;
const sourceSha = process.env.XIAOK_TEST_RECOVERY_PROTECTION_SOURCE_SHA;
const targetSha = process.env.XIAOK_TEST_RECOVERY_PROTECTION_ENTRY_SHA;
const bundleSha = process.env.XIAOK_TEST_RECOVERY_PROTECTION_BUNDLE_SHA;
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
if (!target || hash(fileURLToPath(source)) !== sourceSha) throw Error('fresh_recovery_worker_source_changed');
const segments = relative(join(projectRoot, '.artifacts'), target).split(sep);
if (segments.length !== 4 || !segments[0].startsWith('fresh-protection-worker-')
  || segments.slice(1).join('/') !== 'runtime/task-host/protection-read-worker.js'
  || !existsSync(target) || hash(target) !== targetSha
  || hash(join(target, '..', 'protected-observation-store.js')) !== bundleSha) throw Error('fresh_recovery_worker_entry_required');
let starts = 0, exits = 0;
const NativeWorker = workerThreads.Worker;
workerThreads.Worker = class extends NativeWorker {
  constructor(filename, options) {
    const mapped = String(filename) === source.href;
    super(mapped ? target : filename, options);
    if (mapped) { starts++; this.once('exit', () => { exits++; }); }
  }
};
syncBuiltinESMExports();
process.once('beforeExit', () => writeSync(2, JSON.stringify({ nativeProtectionAudit: true, starts, exits, sourceSha, targetSha, bundleSha }) + '\n'));

}

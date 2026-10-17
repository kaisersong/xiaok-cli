import { parentPort, workerData } from 'node:worker_threads';

// Source development needs transpilation inside this thread. Compiled CLI,
// emitted tests and Electron use the fixed .js sibling without a dev loader.
const source = import.meta.url.endsWith('.ts');
if (source) {
  const { register } = await import('tsx/esm/api');
  register();
}
await import(source ? './protection-read-worker-body.ts' : './protection-read-worker-body.js');

import { parentPort, workerData } from 'node:worker_threads';

// Source development needs transpilation inside this thread. Compiled CLI,
// emitted tests and Electron use the fixed .js sibling without a dev loader.
const source = import.meta.url.endsWith('.ts');
if (source) {
  const { register } = await import('tsx/esm/api');
  register();
}
const { DesktopTaskObservationStore } = await import(source ? './protected-observation-store.ts' : './protected-observation-store.js');
try {
  const protection = await new DesktopTaskObservationStore(workerData.root, workerData.canonicalRoot).readProtection(workerData.taskId);
  parentPort?.postMessage({ taskId: workerData.taskId, protection });
} catch {
  parentPort?.postMessage({ taskId: workerData.taskId, unavailable: true });
} finally {
  parentPort?.close();
}

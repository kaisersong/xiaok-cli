import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const scenario = process.argv[2];
const root = mkdtempSync(join(tmpdir(), 'controller-ipc-fault-'));
const socketPath = process.platform === 'win32'
  ? '\\\\.\\pipe\\xiaok-ipc-fault-' + randomUUID()
  : join(root, 's');
const primary = new Error('original primary');
const cleanup = new Error('original cleanup');
const originalCreate = net.createConnection;
const originalTimer = globalThis.setTimeout;
const originalClear = globalThis.clearTimeout;
let actualTimer;
const facts = {
  scenario, pid: process.pid, nodeVersion: process.versions.node, entered: false, actualSocketBorn: false,
  callReturnedPromise: false, sdkHandleReturned: false, peerCalls: 0, writes: 0, dispatches: 0,
  productDestroyCalls: 0, closeObserved: false, settled: false,
  rejected: false, exactPrimary: false, uncaught: [], cleanupCalls: [],
  hasFateReader: false, physicalKnown: false, physicalKnownAfterCompletion: false,
  manualCleanupUsed: false, unhandled: [], timerEntered: 0, timerBorn: false,
};
const tick = () => new Promise(resolve => setImmediate(resolve));
let actualSocket;
if (scenario === 'entered_no_handle' || scenario === 'listen_sync_throw' || scenario === 'timer_no_handle') {
  net.createConnection = function(...args) {
    facts.entered = true;
    actualSocket = Reflect.apply(originalCreate, this, args);
    facts.actualSocketBorn = true;
    actualSocket.once('close', () => { facts.closeObserved = true; });
    if (scenario === 'entered_no_handle') throw primary;
    const on = actualSocket.on;
    actualSocket.on = function(name, ...rest) {
      if (name === 'data' && scenario === 'listen_sync_throw') throw primary;
      return Reflect.apply(on, this, [name, ...rest]);
    };
    facts.sdkHandleReturned = true;
    return actualSocket;
  };
  syncBuiltinESMExports();
}
if (scenario === 'timer_no_handle') {
  globalThis.setTimeout = function(fn, milliseconds, ...args) {
    if (milliseconds === 1234) {
      facts.timerEntered++;
      actualTimer = Reflect.apply(originalTimer, this, [fn, milliseconds, ...args]);
      facts.timerBorn = true; throw primary;
    }
    return Reflect.apply(originalTimer, this, [fn, milliseconds, ...args]);
  };
}
const { startControllerIpc, callControllerIpc, readOriginalControllerIpcPhysicalFate } =
  await import('../../../../src/runtime/verification/controller-ipc.ts');
const server = await startControllerIpc({ socketPath, async dispatch(body) {
  facts.dispatches++; return body;
} });
const control = new AbortController();
const uncaught = error => {
  facts.uncaught.push(error === cleanup ? 'exact_cleanup' : error === primary ? 'exact_primary' : String(error));
};
process.on('uncaughtException', uncaught);
const unhandled = error => { facts.unhandled.push(error === primary ? 'exact_primary' : String(error)); };
process.on('unhandledRejection', unhandled);
let done;
try {
  const raw = callControllerIpc(socketPath, Buffer.from('secret'), {
    signal: control.signal, timeoutMs: scenario === 'timer_no_handle' ? 1234 : 15000,
    verifyServerPeer(socket) {
      facts.peerCalls++; actualSocket = socket; facts.actualSocketBorn = true; facts.sdkHandleReturned = true;
      socket.once('close', () => { facts.closeObserved = true; });
      const destroy = socket.destroy;
      socket.destroy = function(...args) {
        facts.productDestroyCalls++; facts.cleanupCalls.push('destroy');
        return Reflect.apply(destroy, this, args);
      };
      if (scenario === 'cleanup_attempt_all') {
        const remove = control.signal.removeEventListener;
        control.signal.removeEventListener = function(...args) {
          facts.cleanupCalls.push('remove_abort');
          Reflect.apply(remove, this, args); throw cleanup;
        };
        throw primary;
      }
      throw Error('invalid fixture scenario');
    },
  });
  facts.callReturnedPromise = true;
  done = raw.then(() => { facts.settled = true; }, error => {
    facts.settled = true; facts.rejected = true; facts.exactPrimary = error === primary;
  });
  if (typeof readOriginalControllerIpcPhysicalFate === 'function') {
    facts.hasFateReader = true;
    const fate = readOriginalControllerIpcPhysicalFate(raw);
    try { fate.assertKnown(); facts.physicalKnown = true; } catch {}
  }
  for (let i = 0; i < 6; i++) await tick();
  if (typeof readOriginalControllerIpcPhysicalFate === 'function') {
    try { readOriginalControllerIpcPhysicalFate(raw).assertKnown(); facts.physicalKnownAfterCompletion = true; } catch {}
  }
  facts.beforeManualCleanup = {
    productDestroyCalls: facts.productDestroyCalls,
    settled: facts.settled, closeObserved: facts.closeObserved,
  };
} finally {
  net.createConnection = originalCreate; syncBuiltinESMExports();
  globalThis.setTimeout = originalTimer;
  if (actualTimer) originalClear(actualTimer);
  delete control.signal.removeEventListener;
  if (actualSocket && !facts.closeObserved) {
    facts.manualCleanupUsed = true;
    net.Socket.prototype.destroy.call(actualSocket);
  }
  await server.close();
  await tick(); await tick();
  process.removeListener('uncaughtException', uncaught);
  process.removeListener('unhandledRejection', unhandled);
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}
console.log(JSON.stringify(facts));

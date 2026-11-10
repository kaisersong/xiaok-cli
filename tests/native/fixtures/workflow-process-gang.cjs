'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {Worker} = require('node:worker_threads');
const {createHook} = require('node:async_hooks');
const {DatabaseSync} = require('node:sqlite');
const {createHash} = require('node:crypto');
const {app} = require('electron');
const [addon, domain, result, userData, mode] = process.argv.slice(2);
app.setPath('userData', userData);
app.disableHardwareAcceleration();
let native, issuer, db;
const workers = new Set();

function startWorker() {
  const worker = new Worker(`const {parentPort}=require('node:worker_threads');
    parentPort.once('message', () => parentPort.close());`, {eval: true});
  workers.add(worker);
  worker.once('exit', () => workers.delete(worker));
  return worker;
}
async function stopWorker(worker) {
  await new Promise((yes, no) => {
    worker.once('error', no);
    worker.once('exit', code => code === 0 ? yes() : no(Error('WORKER_EXIT_' + code)));
    worker.postMessage('finish');
  });
}

async function run() {
  await app.whenReady();
  native = require(addon);
  issuer = native.openOriginalMainIssuer();
  if (mode === 'legacy') {
    const file = path.join(domain, 'root-resource-v1.sqlite');
    const before = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.throws(() => native.readPolicy(issuer), /FLOOR_REQUIRED/);
    assert.throws(() => native.installFresh(issuer), /FRESH_REQUIRED/);
    native.close(issuer);
    issuer = null;
    const after = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(before, after);
    return {actualV3DatabaseHash: before, unchanged: true, notMigrated: true};
  }
  native.installFresh(issuer);
  assert.equal(typeof native.enqueueOriginalWorkflowVmProcess, 'function');
  if (mode === 'fault-api') {
    assert.equal(typeof native.armPhysicalWriteMismatch, 'function');
    assert.doesNotThrow(() => native.armCommitWrapperFailure(issuer, 'physical_claim'));
    return {fixedFixtureFaultApi: true, notSystemFsyncEvidence: true};
  }
  if (mode === 'api') return {fixedPairApi: true, notWholeProfileQualification: true};
  db = new DatabaseSync(path.join(domain, 'root-resource-v1.sqlite'), {readOnly: true});
  const rootKey = native.takeOriginalWorkflowRootSourceKey(issuer);
  const toolKey = native.takeOriginalToolWorkerSourceKey(issuer);
  const contexts = [];
  for (let i = 0; i < 2; i++) {
    const subject = native.importOriginalWorkflowRootSubject(rootKey,
      'profile', 'workspace', 'principal', 'durable-host',
      'workflow-' + i, 'job-' + i, 'run-' + i, 'a'.repeat(64), '{}', 'original-run-' + i);
    native.enqueue(issuer, subject);
    const reservation = native.claimNext(issuer).reservation;
    native.consumeLaunch(issuer, reservation);
    contexts.push(native.importOriginalPhysicalContext(rootKey, reservation,
      'profile', 'workspace', 'principal', 'durable-host', mode === 'parent-binding' ? 'same-ref' : 'vm-' + i));
  }
  if (mode === 'parent-binding') {
    const first = native.enqueueOriginalWorkflowVmProcess(contexts[0], 'same-vm', 'b'.repeat(64));
    const second = native.enqueueOriginalWorkflowVmProcess(contexts[1], 'same-vm', 'b'.repeat(64));
    assert.equal(second.disposition, 'new_queued');
    assert.notEqual(first.record.executionKey, second.record.executionKey);
    assert.equal(db.prepare("SELECT count(*) AS n FROM root_physical_resources WHERE allocation_role='workflow_vm'").get().n, 2);
    return {sameDataDistinctNativeParent: true};
  }
  if (mode === 'role-conflict') {
    native.enqueueOriginalProcess(contexts[0], 'same-invocation', 'b'.repeat(64));
    assert.throws(() => native.enqueueOriginalWorkflowVmProcess(contexts[0],
      'same-invocation', 'b'.repeat(64)), /INPUT_CONFLICT/);
    assert.ok(native.claimOriginalProcess(issuer).permit, 'known rejection must leave the issuer healthy');
    return {roleReplayRefused: true};
  }
  for (let i = 0; i < 2; i++) {
    native.enqueueOriginalWorkflowVmProcess(contexts[i], 'actual-vm-' + i, 'b'.repeat(64));
  }
  let traps = 0;
  const proxy = new Proxy({}, {get() { traps++; throw Error('trap'); },
    getPrototypeOf() { traps++; throw Error('trap'); }});
  assert.throws(() => native.enqueueOriginalWorkflowVmProcess(proxy, 'copy', 'b'.repeat(64)), /CONTEXT_REQUIRED/);
  assert.throws(() => native.enqueueOriginalWorkflowVmProcess({...contexts[0]}, 'copy', 'b'.repeat(64)), /CONTEXT_REQUIRED/);
  assert.equal(traps, 0);
  if (mode.startsWith('guard-')) {
    native.armPhysicalWriteMismatch(issuer, mode.slice(6));
    let fault;
    try { native.claimOriginalProcess(issuer); } catch (error) { fault = error; }
    assert.ok(fault);
    assert.equal(fault.sqliteExtendedCode, 1811, 'actual trigger, not only a CHECK or foreign key');
    assert.equal(db.prepare("SELECT count(*) AS n FROM root_physical_resources WHERE state<>'queued'").get().n, 0);
    assert.throws(() => native.readPolicy(issuer), /SESSION_UNCONFIRMED/);
    return {fullOldNewCellGuard: mode.slice(6), sqliteExtendedCode: fault.sqliteExtendedCode, traps, workerSdk: 0};
  }
  if (mode === 'commit-claim') {
    native.armCommitWrapperFailure(issuer, 'physical_claim');
    let fault;
    try { native.claimOriginalProcess(issuer); } catch (error) { fault = error; }
    assert.ok(fault);
    assert.equal(fault.durableCommitted, true);
    assert.equal(db.prepare("SELECT count(*) AS n FROM root_physical_resources WHERE state='reserved'").get().n, 2);
    assert.throws(() => native.claimOriginalProcess(issuer), /SESSION_UNCONFIRMED/);
    return {actualCommitThenWrapperFailure: 'claim', heldCapacity: 2, noReturnedGrant: true, workerSdk: 0};
  }
  const first = native.claimOriginalProcess(issuer);
  assert.ok(first.permit);
  assert.equal(first.record.executionClass, 'workflow_root');
  if (mode === 'commit-settle') {
    native.armCommitWrapperFailure(issuer, 'physical_settle');
    let fault;
    try { native.settleOriginalProcess(issuer, first.permit); } catch (error) { fault = error; }
    assert.ok(fault);
    assert.equal(fault.durableCommitted, true);
    assert.equal(db.prepare("SELECT count(*) AS n FROM root_physical_resources WHERE state='released'").get().n, 2);
    assert.throws(() => native.claimOriginalProcess(issuer), /SESSION_UNCONFIRMED/);
    return {actualCommitThenWrapperFailure: 'settle', durableReleased: 2, noNewGrant: true, workerSdk: 0};
  }
  assert.equal(native.claimOriginalProcess(issuer), null, 'second VM must not partially hold one P');
  const cuts = [];
  const hook = createHook({init(_id, type) {
    if (type === 'WORKER') cuts.push(db.prepare(`SELECT allocation_role,state FROM root_physical_resources
      WHERE state IN ('reserved','unknown') ORDER BY enqueue_seq`).all());
  }});
  hook.enable();
  const vm = startWorker();
  assert.equal(cuts.length, 1);
  assert.deepEqual(cuts[0].map(row => row.allocation_role), ['workflow_vm', 'workflow_child_slot']);
  const childContext = native.importOriginalPhysicalContext(toolKey, contexts[0],
    'profile', 'workspace', 'principal', 'durable-host', 'actual-tool');
  native.enqueueOriginalProcess(childContext, 'tool-1', 'c'.repeat(64));
  native.enqueueOriginalProcess(childContext, 'tool-2', 'd'.repeat(64));
  const child = native.claimOriginalProcess(issuer);
  assert.ok(child.permit, 'its own child slot must advance despite queued second VM and global P2');
  assert.equal(child.record.executionClass, 'tool_worker');
  assert.equal(native.claimOriginalProcess(issuer), null, 'same child slot cannot arm twice');
  assert.throws(() => native.settleOriginalProcess(issuer, first.permit), /WORKFLOW_CHILD_ACTIVE/);
  const tool = startWorker();
  await stopWorker(tool);
  assert.equal(native.settleOriginalProcess(issuer, child.permit).newlySettled, true);
  const nextChild = native.claimOriginalProcess(issuer);
  assert.ok(nextChild.permit);
  assert.equal(nextChild.record.executionClass, 'tool_worker');
  assert.equal(native.settleOriginalProcess(issuer, nextChild.permit).newlySettled, true);
  await stopWorker(vm);
  hook.disable();
  assert.equal(native.settleOriginalProcess(issuer, first.permit).newlySettled, true);
  assert.equal(native.settleOriginalProcess(issuer, first.permit).newlySettled, false);
  const second = native.claimOriginalProcess(issuer);
  assert.ok(second.permit);
  assert.equal(second.record.executionClass, 'workflow_root');
  assert.equal(native.settleOriginalProcess(issuer, second.permit).newlySettled, true);
  const rows = db.prepare('SELECT allocation_role,state FROM root_physical_resources').all();
  assert.ok(rows.every(row => row.state === 'released'));
  return {cuts, rows, sameOriginalP2: true, noSecondPool: true, notWholeProfileQualification: true};
}

run().then(facts => {
  fs.writeFileSync(result, JSON.stringify({pid: process.pid, ok: true, ...facts}));
}, error => {
  fs.writeFileSync(result, JSON.stringify({pid: process.pid, ok: false, error: error.stack}));
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
}).finally(async () => {
  for (const worker of workers) await worker.terminate();
  if (db) db.close();
  if (issuer) native.close(issuer);
  app.exit(process.exitCode || 0);
});

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {types} = require('node:util');
const [addon, domain, result, userData, mode, stage] = process.argv.slice(2);
const config = path.join(domain, 'config');
fs.mkdirSync(config, {recursive:true, mode:0o700});
process.env.XIAOK_CONFIG_DIR = config;
const {app} = require('electron');
const {DatabaseSync} = require('node:sqlite');
app.setPath('userData', userData);
app.disableHardwareAcceleration();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let native, issuer, permit, closePromise;
async function run() {
  await app.whenReady();
  native = require(addon);
  issuer = native.openOriginalMainIssuer();
  if (stage === 'cold') {
    const original = JSON.parse(fs.readFileSync(result, 'utf8'));
    if (mode.startsWith('corrupt-')) {
      assert.throws(() => native.readOriginalProcessHistory(issuer, original.executionKey), /PROCESS_INTENT_UNCONFIRMED/);
      assert.throws(() => native.claimOriginalProcess(issuer), /SESSION_UNCONFIRMED/);
      return {corruptHistoryRefused:true};
    }
    const history = native.readOriginalProcessHistory(issuer, original.executionKey);
    assert.deepEqual(history, original.history);
    assert.equal(Object.hasOwn(history, 'permit'), false);
    assert.equal(history.leafHistory.eligibility, 'history_only');
    assert.throws(() => native.installFresh(issuer), /FRESH_REQUIRED/);
    assert.throws(() => native.claimOriginalProcess(issuer), /RECONCILIATION_REQUIRED/);
    return {noColdGrant:true};
  }
  native.installFresh(issuer);
  for (const name of ['prepareOriginalReadonlyLeaf', 'waitOriginalReadonlyLeafReady', 'bindOriginalReadonlyLeaf',
    'goOriginalReadonlyLeaf', 'cancelOriginalReadonlyLeaf', 'waitOriginalReadonlyLeafClosed'])
    assert.equal(typeof native[name], 'function');
  const payload = JSON.stringify({kind:'worker', entry:'controlled-original-protocol', options:{
    workerData:{input:{patterns:'*.leaf', cwd:domain}, limits:{maxEntries:50000, maxDirectories:10000, maxResults:5000, maxPathBytes:2097152}, nativeSearchProfile:'ascii_regex_or_literal_v1'},
    resourceLimits:{maxOldGenerationSizeMb:96, maxYoungGenerationSizeMb:8, stackSizeMb:2}, execArgv:[], stdout:true, stderr:true,
  }});
  fs.writeFileSync(path.join(domain, 'expected.leaf'), 'same original JS search body');
  const key = native.takeOriginalMaterialTurnSourceKey(issuer);
  const context = native.importOriginalPhysicalContext(key, null, 'profile', 'workspace', 'principal', 'host', 'original-readonly-leaf');
  const queued = native.enqueueOriginalProcess(context, 'original-readonly-leaf', digest('["original-process-spec-v1",' + payload + ']'));
  permit = native.claimOriginalProcess(issuer).permit;
  let traps = 0;
  const foreign = new Proxy({}, {get(){traps++; throw Error('unexpected getter');}, getOwnPropertyDescriptor(){traps++; throw Error('unexpected descriptor');}});
  assert.throws(() => native.prepareOriginalReadonlyLeaf(issuer, foreign, payload), /PERMIT_REQUIRED/);
  assert.throws(() => native.prepareOriginalReadonlyLeaf(issuer, {...permit}, payload), /PERMIT_REQUIRED/);
  assert.equal(traps, 0);
  native.prepareOriginalReadonlyLeaf(issuer, permit, payload);
  native.prepareOriginalReadonlyLeaf(issuer, permit, payload);
  assert.throws(() => native.prepareOriginalReadonlyLeaf(issuer, permit, payload + ' '), /SPEC_CONFLICT/);
  const readyPromise = native.waitOriginalReadonlyLeafReady(issuer, permit);
  assert.equal(native.waitOriginalReadonlyLeafReady(issuer, permit), readyPromise);
  const ready = await readyPromise;
  assert.throws(() => native.bindOriginalReadonlyLeaf(issuer, permit, foreign), /READY_REQUIRED/);
  assert.throws(() => native.bindOriginalReadonlyLeaf(issuer, permit, {...ready}), /READY_REQUIRED/);
  assert.equal(traps, 0);
  assert.throws(() => native.goOriginalReadonlyLeaf(issuer, permit), /GO_REFUSED/);
  native.bindOriginalReadonlyLeaf(issuer, permit, ready);
  native.bindOriginalReadonlyLeaf(issuer, permit, ready);
  const read = new DatabaseSync(path.join(domain, 'root-resource-v1.sqlite'), {readOnly:true});
  try {
    assert.equal(read.prepare("SELECT count(*) n FROM root_physical_resources WHERE resource_kind=2 AND state='reserved'").get().n, 1);
    assert.equal(read.prepare("SELECT count(*) n FROM root_physical_receipts WHERE kind='process_binding_v1'").get().n, 1);
  } finally { read.close(); }
  assert.throws(() => native.settleOriginalProcess(issuer, permit), /LEAF_PENDING/);
  closePromise = native.waitOriginalReadonlyLeafClosed(issuer, permit);
  assert.equal(native.waitOriginalReadonlyLeafClosed(issuer, permit), closePromise);
  const cancelled = mode === 'cancel-ready' || mode.includes('fence');
  if (cancelled) {
    native.cancelOriginalReadonlyLeaf(issuer, permit);
    assert.throws(() => native.goOriginalReadonlyLeaf(issuer, permit), /GO_REFUSED/);
  } else {
    native.goOriginalReadonlyLeaf(issuer, permit);
    assert.throws(() => native.goOriginalReadonlyLeaf(issuer, permit), /GO_REFUSED/);
  }
  const closed = await closePromise;
  if (cancelled) assert.equal(closed.stdout, '');
  else {
    assert.equal(closed.exitCode, 0, closed.stderr);
    const body = JSON.parse(closed.stdout);
    assert.equal(body.ok, true);
    assert.deepEqual(body.entries.map(row => row.path), [path.join(domain, 'expected.leaf')]);
  }
  assert.equal(native.settleOriginalProcess(issuer, permit).newlySettled, true);
  const history = native.readOriginalProcessHistory(issuer, queued.record.executionKey);
  assert.equal(history.state, 'released');
  assert.equal(history.leafHistory.eligibility, 'history_only');
  assert.equal(JSON.parse(history.leafHistory.bindingReceipt).recordId, queued.record.recordId);
  assert.equal(JSON.parse(history.leafHistory.closedReceipt).waitKind, 'owned_waitpid');
  assert.equal(history.leafHistory.fenceReceipt === null, !cancelled);
  native.cancelOriginalReadonlyLeaf(issuer, permit); // immutable repeated cleanup
  native.close(issuer);
  issuer = undefined;
  if (mode.startsWith('corrupt-')) {
    const writer = new DatabaseSync(path.join(domain, 'root-resource-v1.sqlite'));
    try {
      // Explicit same-UID fixture forgery, never writer/VFS isolation evidence.
      const guard = writer.prepare('SELECT guard_abi FROM root_resource_floor').get().guard_abi;
      writer.function(guard, {varargs:true}, () => 1);
      const kind = mode.includes('binding-') ? 'process_binding_v1' : mode.includes('fence-') ? 'process_fence_v1' : 'process_closed_v1';
      if (mode.endsWith('-blob') || mode.endsWith('-nul')) {
        const column = mode.includes('-hash-') ? 'binding_hash' : 'receipt_json';
        const expression = mode.endsWith('-blob') ? `CAST(${column} AS BLOB)` : `${column} || char(0) || 'suffix'`;
        assert.equal(writer.prepare(`UPDATE root_physical_receipts SET ${column}=${expression} WHERE kind=?`).run(kind).changes, 1);
      } else {
        const stored = writer.prepare('SELECT receipt_json FROM root_physical_receipts WHERE kind=?').get(kind);
        assert.ok(stored);
        const body = JSON.parse(stored.receipt_json);
        if (mode === 'corrupt-binding-nonce') body.launchNonce = '0'.repeat(64);
        else if (mode === 'corrupt-binding-pid-type') body.pid = String(body.pid);
        else if (mode === 'corrupt-closed-binding') body.bindingHash = '0'.repeat(64);
        else if (mode === 'corrupt-closed-go-vs-fence') body.goEntered = true;
        else throw Error('unknown fixture corruption');
        const json = JSON.stringify(body);
        writer.prepare('UPDATE root_physical_receipts SET binding_hash=?,receipt_json=? WHERE kind=?').run(digest(json), json, kind);
      }
    } finally { writer.close(); }
  }
  return {actualLeafProtocol:true, singleOriginalP:true, sameSearchBody:true, executionKey:queued.record.executionKey, history};
}
run().then(async facts => {
  if (issuer) native.close(issuer);
  fs.writeFileSync(result, JSON.stringify({ok:true, pid:process.pid, notWholeProfileQualification:true, ...facts}));
  app.exit(0);
}, async raw => {
  // Preserve actual owned wait/FD cleanup even when an assertion fails.
  try { if (permit) native.cancelOriginalReadonlyLeaf(issuer, permit); } catch {}
  try { if (permit) await (closePromise || native.waitOriginalReadonlyLeafClosed(issuer, permit)); } catch {}
  try { if (issuer) native.close(issuer); } catch {}
  const message = raw && typeof raw === 'object' && !types.isProxy(raw) ? Object.getOwnPropertyDescriptor(raw, 'message') : null;
  const diagnostic = message && Object.hasOwn(message, 'value') && typeof message.value === 'string' ? message.value : 'opaque fixture failure';
  fs.writeFileSync(result, JSON.stringify({ok:false, pid:process.pid, diagnostic}));
  process.stderr.write(diagnostic + '\n');
  app.exit(1);
});

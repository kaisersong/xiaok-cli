'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const [addon, domain, result, userData, mode] = process.argv.slice(2);
fs.mkdirSync(path.join(domain, 'config'), { recursive: true, mode: 0o700 });
process.env.XIAOK_CONFIG_DIR = path.join(domain, 'config');
const { app } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
app.setPath('userData', userData);
app.disableHardwareAcceleration();
let native, issuer, db;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function run() {
  await app.whenReady();
  native = require(addon);
  issuer = native.openOriginalMainIssuer();
  if (mode === 'legacy') {
    const file = path.join(domain, 'root-resource-v1.sqlite');
    const before = digest(fs.readFileSync(file));
    assert.throws(() => native.readPolicy(issuer), /FLOOR_REQUIRED/);
    assert.throws(() => native.installFresh(issuer), /FRESH_REQUIRED/);
    assert.equal(digest(fs.readFileSync(file)), before);
    return { oldV4Unchanged: true };
  }
  if (mode === 'cold' || mode === 'cold-corrupt') {
    const prior = JSON.parse(fs.readFileSync(result, 'utf8'));
    if (mode === 'cold-corrupt') {
      assert.throws(
        () => native.readOriginalProcessHistory(issuer, prior.executionKey),
        /PROCESS_INTENT_UNCONFIRMED/,
      );
      assert.throws(
        () => native.claimOriginalProcess(issuer),
        /SESSION_UNCONFIRMED/,
      );
      return { corruptHistoryRefused: true };
    }
    const history = native.readOriginalProcessHistory(
      issuer,
      prior.executionKey,
    );
    assert.deepEqual(history.intent, prior.intent);
    assert.equal(Object.hasOwn(history, 'permit'), false);
    assert.throws(
      () => native.claimOriginalProcess(issuer),
      /RECONCILIATION_REQUIRED/,
    );
    return { durableIntent: true, noColdGrant: true };
  }
  native.installFresh(issuer);
  assert.equal(typeof native.readOriginalProcessIntent, 'function');
  assert.equal(typeof native.readOriginalProcessHistory, 'function');
  assert.equal(typeof native.armProcessIntentWriteFailure, 'function');
  if (mode === 'api') return { actualProtocolApi: true };
  const gang = mode === 'gang' || mode.startsWith('vm-rollback-');
  const key = gang
    ? native.takeOriginalWorkflowRootSourceKey(issuer)
    : native.takeOriginalMaterialTurnSourceKey(issuer);
  let rootReservation = null;
  if (gang) {
    const subject = native.importOriginalWorkflowRootSubject(
      key,
      'profile',
      'workspace',
      'principal',
      'host',
      'workflow',
      'job',
      'run',
      'a'.repeat(64),
      '{}',
      'original-intent-run',
    );
    native.enqueue(issuer, subject);
    rootReservation = native.claimNext(issuer).reservation;
    native.consumeLaunch(issuer, rootReservation);
  }
  const context = native.importOriginalPhysicalContext(
    key,
    rootReservation,
    'profile',
    'workspace',
    'principal',
    'host',
    'process-intent-test',
  );
  const queued = gang
    ? native.enqueueOriginalWorkflowVmProcess(
        context,
        'actual-invocation',
        'b'.repeat(64),
      )
    : native.enqueueOriginalProcess(
        context,
        'actual-invocation',
        'b'.repeat(64),
      );
  db = new DatabaseSync(path.join(domain, 'root-resource-v1.sqlite'), {
    readOnly: true,
  });
  const before = JSON.stringify(
    db.prepare('SELECT * FROM root_physical_resources').all(),
  );
  if (mode === 'commit')
    native.armCommitWrapperFailure(issuer, 'physical_claim');
  const rollbackIndex = mode.startsWith('vm-rollback-')
    ? Number(mode.slice(12))
    : mode.startsWith('rollback-')
      ? Number(mode.slice(9))
      : 0;
  if (rollbackIndex) native.armProcessIntentWriteFailure(issuer, rollbackIndex);
  let claimed, cause;
  try {
    claimed = native.claimOriginalProcess(issuer);
  } catch (raw) {
    cause = raw;
  }
  if (rollbackIndex) {
    assert.ok(cause);
    assert.equal(
      JSON.stringify(db.prepare('SELECT * FROM root_physical_resources').all()),
      before,
    );
    assert.equal(
      db.prepare('SELECT count(*) n FROM root_physical_receipts').get().n,
      0,
    );
    assert.equal(
      db
        .prepare('SELECT claim_seq n FROM root_physical_policy WHERE kind=2')
        .get().n,
      0,
    );
    return { rolledBackAll: true, afterWrite: rollbackIndex, gang };
  }
  const stored = db
    .prepare(
      "SELECT * FROM root_physical_receipts WHERE record_id=? AND kind='process_intent_v1'",
    )
    .get(queued.record.recordId);
  assert.ok(stored, 'original claim must durably record its intent');
  assert.equal(stored.binding_hash, digest(stored.receipt_json));
  const body = JSON.parse(stored.receipt_json);
  assert.equal(body.recordId, queued.record.recordId);
  assert.equal(body.specHash, 'b'.repeat(64));
  assert.equal(body.invocationId, 'actual-invocation');
  assert.equal(body.acquireGeneration, 1);
  assert.equal(body.issuerEpoch, 1);
  assert.equal(body.launchStage, 'claimed_unbound');
  assert.match(body.launchNonce, /^[a-f0-9]{64}$/);
  assert.notEqual(body.launchNonce, body.claimToken);
  if (gang) {
    const capacity = db
      .prepare(
        "SELECT * FROM root_physical_resources WHERE allocation_role='workflow_child_slot'",
      )
      .get();
    assert.equal(capacity.state, 'reserved');
    assert.equal(capacity.claim_token, null);
    assert.equal(
      native.readOriginalProcessHistory(issuer, capacity.execution_key),
      null,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM root_physical_receipts WHERE record_id=? AND kind='process_intent_v1'",
        )
        .get(capacity.record_id).n,
      0,
    );
  }
  if (mode === 'commit') {
    assert.ok(cause);
    assert.equal(claimed, undefined);
  } else {
    assert.ok(claimed.permit);
    assert.equal(claimed.fixtureClaimWriteCount, gang ? 6 : 4);
    assert.ok(claimed.fixtureClaimWriteCount <= 8);
    const first = native.readOriginalProcessIntent(issuer, claimed.permit);
    const again = native.readOriginalProcessIntent(issuer, claimed.permit);
    assert.deepEqual(first, again);
    assert.equal(first.intent.launchNonce, body.launchNonce);
    assert.equal(native.claimOriginalProcess(issuer), null);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM root_physical_receipts WHERE kind='process_intent_v1'",
        )
        .get().n,
      1,
    );
    let traps = 0;
    const fake = new Proxy(
      {},
      {
        get() {
          traps++;
          throw Error('fake');
        },
      },
    );
    assert.throws(() => native.readOriginalProcessIntent(issuer, fake));
    assert.throws(() =>
      native.readOriginalProcessIntent(issuer, { ...claimed.permit }),
    );
    assert.equal(traps, 0);
    if (mode === 'released') {
      assert.equal(
        native.settleOriginalProcess(issuer, claimed.permit).newlySettled,
        true,
      );
      const released = native.readOriginalProcessIntent(issuer, claimed.permit);
      assert.equal(released.state, 'released');
      assert.deepEqual(released.intent, first.intent);
      assert.equal(native.claimOriginalProcess(issuer), null);
    }
  }
  if (mode.startsWith('corrupt-')) {
    db.close();
    db = null;
    native.close(issuer);
    const writer = new DatabaseSync(
      path.join(domain, 'root-resource-v1.sqlite'),
    );
    try {
      // Deliberately external fixture corruption, not writer isolation evidence.
      const guard = writer
        .prepare('SELECT guard_abi FROM root_resource_floor')
        .get().guard_abi;
      writer.function(guard, { varargs: true }, () => 1);
      const column = mode.includes('hash') ? 'binding_hash' : 'receipt_json';
      const expression = mode.endsWith('blob')
        ? `CAST(${column} AS BLOB)`
        : `${column} || char(0) || 'suffix'`;
      writer
        .prepare(
          `UPDATE root_physical_receipts SET ${column}=${expression} WHERE kind='process_intent_v1'`,
        )
        .run();
    } finally {
      writer.close();
    }
  }
  return {
    durableIntent: true,
    executionKey: queued.record.executionKey,
    intent: body,
    wrapperCommitted: mode === 'commit',
  };
}
run().then(
  (facts) => {
    db?.close();
    native?.close(issuer);
    fs.writeFileSync(
      result,
      JSON.stringify({
        ok: true,
        pid: process.pid,
        protocolOnly: true,
        notWholeProfileQualification: true,
        ...facts,
      }),
    );
    app.exit(0);
  },
  (raw) => {
    try {
      db?.close();
      native?.close(issuer);
    } catch {}
    fs.writeFileSync(
      result,
      JSON.stringify({ ok: false, error: raw?.stack || String(raw) }),
    );
    console.error(raw);
    app.exit(1);
  },
);

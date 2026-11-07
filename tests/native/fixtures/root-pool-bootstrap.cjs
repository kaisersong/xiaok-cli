'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const [addon, domain, result, userData, mode] = process.argv.slice(2);
fs.mkdirSync(path.join(domain, 'config'), { recursive: true, mode: 0o700 });
process.env.XIAOK_CONFIG_DIR = path.join(domain, 'config');
const { app } = require('electron');
app.setPath('userData', userData);
app.disableHardwareAcceleration();
app
  .whenReady()
  .then(() => {
    const native = require(addon);
    assert.equal(typeof native.bootstrapOriginalMainPool, 'function');
    const issuer = native.openOriginalMainIssuer();
    let traps = 0;
    const foreign = new Proxy(
      {},
      {
        get() {
          traps++;
          throw Error('getter');
        },
        getOwnPropertyDescriptor() {
          traps++;
          throw Error('descriptor');
        },
      },
    );
    assert.throws(() => native.bootstrapOriginalMainPool(foreign), /REQUIRED/);
    assert.equal(traps, 0);
    if (mode.startsWith('reject:')) {
      assert.throws(
        () => native.bootstrapOriginalMainPool(issuer),
        new RegExp(mode.slice(7)),
      );
      assert.throws(
        () => native.bootstrapOriginalMainPool(issuer),
        /ALREADY_ATTEMPTED|UNCONFIRMED/,
      );
      native.close(issuer);
      fs.writeFileSync(
        result,
        JSON.stringify({ pid: process.pid, rejected: true }),
      );
      return;
    }
    if (mode.startsWith('fault:')) {
      assert.equal(typeof native.armPoolBootstrapFailure, 'function');
      native.armPoolBootstrapFailure(issuer, Number(mode.slice(6)));
      assert.throws(
        () => native.bootstrapOriginalMainPool(issuer),
        /INSTALL_UNCONFIRMED/,
      );
      assert.throws(
        () => native.assertOriginalMainIssuerCurrent(issuer),
        /UNCONFIRMED/,
      );
      native.close(issuer);
      fs.writeFileSync(
        result,
        JSON.stringify({ pid: process.pid, fault: mode.slice(6) }),
      );
      return;
    }
    const bootstrap = native.bootstrapOriginalMainPool(issuer);
    assert.equal(
      bootstrap,
      mode === 'fresh' || mode.startsWith('seed_') ? 'fresh' : 'restored',
    );
    assert.throws(
      () => native.bootstrapOriginalMainPool(issuer),
      /ALREADY_ATTEMPTED/,
    );
    const factsPath = path.join(domain, 'native-seed.json');
    function room(keyValue) {
      return native.importOriginalRoomTurnSubject(
        keyValue,
        'profile',
        'workspace',
        'principal',
        'host',
        'room',
        'message',
        'agent',
        'turn',
        'payload',
        'authorization',
      );
    }
    function subject(keyValue, index) {
      return native.importOriginalRoomTurnSubject(
        keyValue,
        'profile',
        'workspace',
        'principal',
        'host',
        'room',
        'message-' + index,
        'agent',
        'turn-' + index,
        'payload',
        'authorization',
      );
    }
    if (mode.startsWith('seed_') || mode.endsWith('_cold')) {
      const key = native.takeOriginalRoomDiscussionSourceKey(issuer);
      if (mode === 'seed_held' || mode === 'seed_queue') {
        const records = [];
        for (let i = 0; i < (mode === 'seed_held' ? 6 : 3); i++) {
          records.push(native.enqueue(issuer, subject(key, i)).record);
          if (i < (mode === 'seed_held' ? 5 : 1)) {
            const claim = native.claimNext(issuer);
            assert.ok(claim);
            native.consumeLaunch(issuer, claim.reservation);
          }
        }
        fs.writeFileSync(factsPath, JSON.stringify({ records }));
      } else if (mode === 'held_cold' || mode === 'queue_cold') {
        const before = JSON.parse(fs.readFileSync(factsPath, 'utf8'));
        assert.equal(
          native.claimNext(issuer),
          null,
          'historical queued rows have no new eligibility',
        );
        const old = native.enqueue(
          issuer,
          subject(key, before.records.length - 1),
        );
        assert.equal(old.disposition, 'existing_queued');
        assert.equal(
          native.claimNext(issuer),
          null,
          'replay cannot remint eligibility',
        );
        const fresh = native.enqueue(issuer, subject(key, 100));
        assert.equal(fresh.disposition, 'new_queued');
        const next = native.claimNext(issuer);
        if (mode === 'held_cold')
          assert.equal(
            next,
            null,
            'five historical held N still exhaust capacity',
          );
        else {
          assert.ok(next);
          assert.equal(next.record.executionKey, fresh.record.executionKey);
          assert.notEqual(next.record.executionKey, old.record.executionKey);
        }
      } else if (mode === 'seed_gang') {
        const r = native.enqueue(issuer, subject(key, 0));
        const claim = native.claimNext(issuer);
        native.consumeLaunch(issuer, claim.reservation);
        const workflowKey = native.takeOriginalWorkflowRootSourceKey(issuer);
        const ctx = native.importOriginalPhysicalContext(
          workflowKey,
          claim.reservation,
          'profile',
          'workspace',
          'principal',
          'host',
          'actual-workflow',
        );
        native.enqueueOriginalWorkflowVmProcess(
          ctx,
          'actual-vm',
          'a'.repeat(64),
        );
        const vm = native.claimOriginalProcess(issuer);
        assert.ok(vm);
        native.enqueueOriginalProcess(ctx, 'actual-child', 'b'.repeat(64));
        const child = native.claimOriginalProcess(issuer);
        assert.ok(child);
        native.settleOriginalProcess(issuer, child.permit);
        const mainKey = native.takeOriginalMainTurnSourceKey(issuer);
        const mctx = native.importOriginalPhysicalContext(
          mainKey,
          null,
          'profile',
          'workspace',
          'principal',
          'host',
          'main',
        );
        native.enqueueOriginalModel(mctx, 'actual-model', 'c'.repeat(64));
        assert.ok(native.claimOriginalModel(issuer));
        fs.writeFileSync(factsPath, JSON.stringify({ records: [r.record] }));
      } else if (mode === 'gang_cold') {
        assert.equal(native.claimOriginalProcess(issuer), null);
        assert.equal(native.claimOriginalModel(issuer), null);
        const mainKey = native.takeOriginalMainTurnSourceKey(issuer);
        const ctx = native.importOriginalPhysicalContext(
          mainKey,
          null,
          'profile',
          'workspace',
          'principal',
          'host',
          'cold-main',
        );
        native.enqueueOriginalProcess(ctx, 'cold-process', 'd'.repeat(64));
        assert.equal(
          native.claimOriginalProcess(issuer),
          null,
          'old VM plus slot retain original P2 capacity',
        );
        native.enqueueOriginalModel(ctx, 'cold-model', 'e'.repeat(64));
        assert.ok(
          native.claimOriginalModel(issuer),
          'remaining original M capacity is usable',
        );
      }
    }

    native.assertOriginalMainIssuerCurrent(issuer);
    native.close(issuer);
    fs.writeFileSync(result, JSON.stringify({ pid: process.pid, bootstrap }));
  })
  .then(
    () => app.exit(0),
    (e) => {
      process.stderr.write(e.stack + '\n');
      app.exit(1);
    },
  );

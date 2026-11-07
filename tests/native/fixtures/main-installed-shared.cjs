'use strict';
module.exports = function originalMainInstalledSharedFixture(options) {
  const fs = require('node:fs');
  const path = require('node:path');
  const assert = require('node:assert/strict');
  const {isProxy} = require('node:util').types;
  function ownFailure(raw) {
    if (raw === null || (typeof raw !== 'object' && typeof raw !== 'function'))
      return {kind: typeof raw, value: typeof raw === 'string' ? raw : null};
    if (isProxy(raw)) return {kind: 'proxy_not_read'};
    const result = {kind: typeof raw};
    for (const name of ['message', 'code', 'stack']) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, name);
      if (!descriptor) continue;
      if (!Object.hasOwn(descriptor, 'value')) result[name] = {kind: 'accessor_not_read'};
      else if (typeof descriptor.value === 'string' || typeof descriptor.value === 'number') result[name] = descriptor.value;
      else result[name] = {kind: typeof descriptor.value};
    }
    return result;
  }
  process.env.XIAOK_CONFIG_DIR = path.join(options.root, 'config');
  const {app} = require('electron');
  app.setPath('userData', path.join(options.root, 'userData'));
  app.disableHardwareAcceleration();
  let standalone, embedded, issuer, rootIssuer, firstFailure;
  const tails = [];
  const facts = {kind: 'original-main-installation-two-dso', pid: process.pid,
    actualMain: process.type === 'browser', productionQualified: false, foreignTraps: 0};
  try {
    assert.equal(facts.actualMain, true);
    standalone = require(options.standalone);
    issuer = standalone.createOriginalMainIssuer();
    assert.equal(standalone.connectOriginalMainInstallation(issuer), issuer);
    const initial = standalone.readOriginalMainInstallationFate(issuer);
    assert.equal(initial.connected, true);
    assert.equal(initial.seedClosed, true);
    assert.equal(initial.rootSequence, '0');
    assert.equal(initial.dispatchSequence, '0');
    embedded = require(options.embedded);
    rootIssuer = embedded.openOriginalMainIssuer();
    const foreign = new Proxy({}, {
      get() { facts.foreignTraps++; throw Error('foreign getter'); },
      getOwnPropertyDescriptor() { facts.foreignTraps++; throw Error('foreign descriptor'); },
    });
    assert.throws(() => embedded.adoptOriginalMainInstallation(rootIssuer, foreign));
    assert.equal(facts.foreignTraps, 0);
    const adopted = embedded.adoptOriginalMainInstallation(rootIssuer, issuer);
    assert.equal(adopted.rootSequence, '1');
    assert.equal(adopted.dispatchSequence, '1');
    const shared = standalone.readOriginalMainInstallationFate(issuer);
    assert.equal(shared.rootSequence, adopted.rootSequence);
    assert.equal(shared.dispatchSequence, adopted.dispatchSequence);
    assert.throws(() => standalone.connectOriginalMainInstallation(issuer), /ALREADY/);
    embedded.revokeOriginalMainIssuer(rootIssuer);
    standalone.revokeOriginalMainIssuer(issuer);
    assert.throws(() => standalone.assertOriginalMainIssuerCurrent(issuer));
    standalone.assertOriginalMainInstallationCurrent(issuer);
    standalone.pingOriginalMainInstallation(issuer);
    standalone.closeOriginalMainInstallation(issuer);
    const closed = standalone.readOriginalMainInstallationFate(issuer);
    assert.equal(closed.rootSequence, '3');
    assert.equal(closed.dispatchSequence, '3');
    assert.equal(closed.closed, true);
    assert.equal(closed.rootFilesClosed, true);
    assert.equal(closed.unknown, false);
    assert.equal(closed.productionQualified, false);
    assert.throws(() => standalone.assertOriginalMainInstallationCurrent(issuer));
    assert.throws(() => standalone.connectOriginalMainInstallation(issuer), /ALREADY/);
    Object.assign(facts, {initial, adopted, shared, closed, sameClientCounters: true});
  } catch (raw) {
    firstFailure = {raw};
  }
  if (standalone && issuer) {
    try { standalone.closeOriginalMainInstallation(issuer); } catch (raw) { tails.push({raw}); }
  }
  if (embedded && rootIssuer) {
    try { embedded.close(rootIssuer); } catch (raw) { tails.push({raw}); }
  }
  facts.failed = firstFailure !== undefined || tails.length !== 0;
  facts.cleanupErrorCount = tails.length;
  if (firstFailure !== undefined) facts.firstFailure = ownFailure(firstFailure.raw);
  if (tails.length) facts.cleanupFailures = tails.map(box => ownFailure(box.raw));
  fs.writeFileSync(path.join(options.root, 'facts.json'), JSON.stringify(facts, null, 2) + '\n');
  process.stdout.write(JSON.stringify(facts) + '\n');
  if (facts.failed) {
    process.stderr.write('ORIGINAL_MAIN_INSTALLATION_SHARED_FAILED\n');
    app.exit(1);
    return;
  }
  // Test-only observation barrier. No window or activation-policy mutation.
  // The parent may query this exact PID before releasing the original stdin.
  let stopped = false;
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', text => {
    input += text;
    if (input === 'STOP\n' && !stopped) {
      stopped = true;
      process.stdin.pause();
      app.exit(0);
    } else if (input.includes('\n')) {
      process.stderr.write('ORIGINAL_MAIN_INSTALLATION_CONTROL_INVALID\n');
      app.exit(1);
    }
  });
  process.stdin.once('end', () => {
    if (!stopped) app.exit(1);
  });
  app.whenReady().then(() => {
    facts.ready = {kind: 'original-main-installed-ready', pid: process.pid,
      type: process.type, dockVisible: app.dock.isVisible(),
      execPath: process.execPath, electron: process.versions.electron,
      node: process.versions.node};
    fs.writeFileSync(path.join(options.root, 'facts.json'), JSON.stringify(facts, null, 2) + '\n');
    process.stdout.write(JSON.stringify(facts.ready) + '\n');
  }, raw => {
    firstFailure = {raw};
    process.stderr.write('ORIGINAL_MAIN_INSTALLATION_READY_FAILED\n');
    app.exit(1);
  });
};

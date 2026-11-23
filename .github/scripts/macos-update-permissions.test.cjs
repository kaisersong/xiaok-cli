const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { repairLauncher, auditWritableTree, wrapAfterPack } = require('./macos-update-permissions.cjs');

function fixture(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaok-release-permissions-'));
  try { return action(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('owner write is added without changing bytes or group/other permissions', () => fixture(root => {
  const file = path.join(root, 'launcher'); fs.writeFileSync(file, 'fixed executable bytes'); fs.chmodSync(file, 0o555);
  const receipt = repairLauncher(file);
  assert.equal(receipt.beforeMode, '555'); assert.equal(receipt.afterMode, '755');
  assert.equal(fs.readFileSync(file, 'utf8'), 'fixed executable bytes');
  assert.equal(fs.statSync(file).mode & 0o022, 0);
}));
test('symlink, hardlink, non-executable and group-writable inputs are refused', () => fixture(root => {
  const file = path.join(root, 'launcher'); fs.writeFileSync(file, 'unchanged'); fs.chmodSync(file, 0o555);
  const link = path.join(root, 'link'); fs.symlinkSync(file, link); assert.throws(() => repairLauncher(link), /plain launcher/);
  fs.unlinkSync(link); fs.linkSync(file, link); assert.throws(() => repairLauncher(file), /plain launcher/); fs.unlinkSync(link);
  for (const mode of [0o444, 0o575]) {
    fs.chmodSync(file, mode); assert.throws(() => repairLauncher(file)); assert.equal(fs.statSync(file).mode & 0o777, mode);
  }
}));
test('actual quarantine removal fails readonly and succeeds after the owner-write repair', () => fixture(root => {
  assert.equal(process.platform, 'darwin'); assert.notEqual(process.getuid(), 0);
  const file = path.join(root, 'launcher'); fs.writeFileSync(file, 'quarantine probe'); fs.chmodSync(file, 0o700);
  execFileSync('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0001;00000000;XiaokReleaseProbe;', file]);
  fs.chmodSync(file, 0o500);
  assert.notEqual(spawnSync('/usr/bin/xattr', ['-d', 'com.apple.quarantine', file]).status, 0);
  assert.throws(() => auditWritableTree(root), /owner-readonly/);
  repairLauncher(file);
  execFileSync('/usr/bin/xattr', ['-d', 'com.apple.quarantine', file]);
  assert.equal(auditWritableTree(root), 2);
}));
test('the original complete hook finishes before permissions are changed', async () => {
  const order = [];
  await wrapAfterPack(async () => { await Promise.resolve(); order.push('original'); }, () => { order.push('repair'); })({ electronPlatformName: 'darwin', appOutDir: '/owned' });
  assert.deepEqual(order, ['original', 'repair']);
  order.length = 0;
  await assert.rejects(wrapAfterPack(async () => { throw Error('original gate refused'); }, () => { order.push('repair'); })({ electronPlatformName: 'darwin' }), /original gate refused/);
  assert.deepEqual(order, []);
});

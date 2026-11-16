// Release recipe only. Native staging stays private; signed distribution copies
// must permit their owner to remove quarantine during Squirrel installation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const names = ['broker-child-launcher', 'kswarm-child-launcher'];
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function repairLauncher(file) {
  const before = fs.lstatSync(file);
  assert(before.isFile() && !before.isSymbolicLink() && before.nlink === 1, 'plain launcher required');
  assert.equal(before.uid, process.getuid(), 'launcher owner mismatch');
  assert.equal(before.mode & 0o7022, 0, 'special or group/other writable launcher');
  assert(before.mode & 0o100, 'owner executable launcher required');
  const sha256 = hash(file), mode = before.mode & 0o777;
  fs.chmodSync(file, mode | 0o200);
  const after = fs.lstatSync(file);
  assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
  assert.equal(after.mode & 0o777, mode | 0o200);
  assert.equal(hash(file), sha256, 'launcher bytes changed');
  return { file, beforeMode: mode.toString(8), afterMode: (after.mode & 0o777).toString(8), sha256, bytesUnchanged: true };
}
function auditWritableTree(root) {
  let entries = 0;
  function walk(file) {
    assert(++entries <= 100_000, 'app inventory bound');
    const info = fs.lstatSync(file);
    if (info.isSymbolicLink()) return;
    assert(info.isDirectory() || info.isFile(), 'unexpected app entry');
    assert(info.mode & 0o200, `Squirrel cannot update owner-readonly entry: ${file}`);
    if (info.isDirectory()) for (const name of fs.readdirSync(file)) walk(path.join(file, name));
  }
  walk(root); return entries;
}
function repairApp(app) {
  const native = path.join(app, 'Contents', 'Resources', 'native');
  for (const directory of [app, path.join(app, 'Contents'), path.join(app, 'Contents', 'Resources'), native]) {
    const info = fs.lstatSync(directory);
    assert(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid(), 'plain owned app required');
  }
  const launchers = names.map(name => repairLauncher(path.join(native, name)));
  const entries = auditWritableTree(app);
  console.log(JSON.stringify({ kind: 'macos_squirrel_distribution_permissions', launchers, entries, beforeCodesign: true,
    sourceSha: process.env.RELEASE_SHA, recipeSha: process.env.GITHUB_WORKFLOW_SHA, hookSHA256: hash(__filename) }));
  return launchers;
}
function wrapAfterPack(original, repair = repairApp) {
  return async context => {
    assert.equal(context.electronPlatformName, 'darwin');
    await original(context); // Preserve every frozen-source packaging gate.
    return repair(path.join(context.appOutDir, 'xiaok.app'));
  };
}
module.exports = async context => {
  assert(process.env.GITHUB_WORKSPACE, 'release source checkout required');
  const original = require(path.join(process.env.GITHUB_WORKSPACE, 'desktop', 'scripts', 'after-pack.cjs'));
  return wrapAfterPack(original)(context);
};
Object.assign(module.exports, { repairLauncher, auditWritableTree, wrapAfterPack });

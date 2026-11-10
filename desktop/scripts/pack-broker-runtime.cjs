'use strict';
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const {join, resolve, dirname} = require('node:path');
const {execFileSync} = require('node:child_process');
const {targetEntry, expectedManifest, verifyRuntimeDirectory} = require('../electron/broker-runtime-package.cjs');
const {readPackageFile} = require('../electron/broker-runtime-file.cjs');
function directory(path) {
  const stat = fs.lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('broker_runtime_alias');
}
function ensureDirectory(path) {
  if (fs.existsSync(path)) { directory(path); return; }
  ensureDirectory(dirname(path)); fs.mkdirSync(path, {mode: 0o700}); directory(path);
}
function writeExclusive(path, bytes, mode = 0o400) {
  fs.writeFileSync(path, bytes, {flag: 'wx', mode});
  if (process.platform !== 'win32') fs.chmodSync(path, mode);
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function prepareBrokerRuntime({archive, cacheRoot, target}) {
  const entry = targetEntry(target); if (!entry) throw Error('broker_runtime_target');
  const data = readPackageFile(archive, entry.archiveSize);
  if (data.size !== entry.archiveSize || data.sha256 !== entry.archiveSha256) throw Error('broker_runtime_archive_digest');
  // A single verified buffer is the extractor's input. It cannot reopen a
  // replaced archive, and only two fixed members ever become output bytes.
  let zip;
  if(target==='win32-x64'){
    const rootRequire=require('node:module').createRequire(resolve(__dirname,'../../package.json'));
    if(rootRequire('adm-zip/package.json').version!=='0.5.17')throw Error('broker_runtime_zip_version');
    const Zip=rootRequire('adm-zip');zip=new Zip(data.bytes);
  }
  const extract = (member, size) => {
    if(zip){
      const selected=zip.getEntry(member);
      if(!selected||selected.isDirectory||selected.entryName!==member||selected.header.size!==size)throw Error('broker_runtime_archive_member');
      return selected.getData();
    }
    return execFileSync('tar', ['-xOf', '-', member], {input:data.bytes,maxBuffer:size+1024,timeout:120000,windowsHide:true});
  };
  const binary = extract(entry.member, entry.executableSize);
  const license = extract(entry.license, entry.licenseSize);
  if (binary.length !== entry.executableSize || digest(binary) !== entry.executableSha256 || license.length !== entry.licenseSize || digest(license) !== entry.licenseSha256) throw Error('broker_runtime_member_digest');
  ensureDirectory(resolve(cacheRoot));
  const destination = join(resolve(cacheRoot), target);
  if (fs.existsSync(destination)) throw Error('broker_runtime_cache_exists');
  const stage = fs.mkdtempSync(join(resolve(cacheRoot), '.prepare-'));
  writeExclusive(join(stage, entry.executable), binary, 0o500);
  writeExclusive(join(stage, 'LICENSE'), license);
  writeExclusive(join(stage, 'manifest.json'), JSON.stringify(expectedManifest(target), null, 2) + '\n');
  verifyRuntimeDirectory(stage, target);
  // mkdir is the exclusive publication claim; a concurrent prepare cannot
  // replace another profile. On uncertainty retain this directory for review.
  fs.mkdirSync(destination, {mode: 0o700});
  for (const name of [entry.executable, 'LICENSE', 'manifest.json']) fs.renameSync(join(stage, name), join(destination, name));
  fs.rmdirSync(stage);
  verifyRuntimeDirectory(destination, target);
  return expectedManifest(target);
}
function shipBrokerRuntime({cacheRoot, resources, target}) {
  const entry = targetEntry(target);
  if (!entry) return {target, qualified: false, reason: 'legacy_runtime_target'};
  const source = join(resolve(cacheRoot), target);
  verifyRuntimeDirectory(source, target);
  let root = fs.realpathSync(resources); directory(root);
  for (const name of ['services', 'intent-broker', 'runtime']) { root = join(root, name); if (!fs.existsSync(root)) fs.mkdirSync(root); directory(root); }
  const destination = join(root, target);
  fs.mkdirSync(destination); // Never overwrite existing shared resources.
  for (const name of [entry.executable, 'LICENSE', 'manifest.json']) {
    fs.copyFileSync(join(source, name), join(destination, name), fs.constants.COPYFILE_EXCL);
  }
  if (process.platform !== 'win32') {
    fs.chmodSync(join(destination, entry.executable), 0o755);
    for (const name of ['LICENSE', 'manifest.json']) fs.chmodSync(join(destination, name), 0o644);
  }
  verifyRuntimeDirectory(destination, target);
  return expectedManifest(target);
}
async function afterPack(context) {
  const {Arch} = require('electron-builder');
  const target = context.electronPlatformName + '-' + Arch[context.arch];
  const resources = context.electronPlatformName === 'darwin' ? join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents', 'Resources') : join(context.appOutDir, 'resources');
  return shipBrokerRuntime({cacheRoot: resolve(context.packager.projectDir, '..', '.artifacts', 'broker-runtimes'), resources, target});
}
module.exports = afterPack;
module.exports.prepareBrokerRuntime = prepareBrokerRuntime;
module.exports.shipBrokerRuntime = shipBrokerRuntime;
if (require.main === module) {
  const args = process.argv.slice(2);
  const option = name => { const n = args.indexOf(name); if (n < 0 || !args[n + 1]) throw Error('missing ' + name); return args[n + 1]; };
  try { console.log(JSON.stringify(prepareBrokerRuntime({archive: option('--archive'), cacheRoot: option('--cache'), target: option('--target')}))); }
  catch (raw) { console.error(raw); process.exitCode = 1; }
}

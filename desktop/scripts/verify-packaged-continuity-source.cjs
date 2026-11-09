const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Arch } = require('electron-builder');
const strictNativeArtifact = require('./verify-packaged-continuity-resources.cjs');
const sourceRoot = path.resolve(__dirname, '../..');
const binaryPin = '5319f2e03161415f75a88ccf251fc43fbc9a86c62481e2f8430f6b831cd54c6c';
const physicalFlags = ['physicalManagedOAuthQualified', 'privateVaultAndLifetimeLockQualified', 'workerCredentialLeaseAndFinalStdinQualified', 'fullHarnessQualified'];
function regular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== path.resolve(file)) throw Error('packaged continuity resource missing or escaping: ' + file);
  return file;
}
function tree(root) {
  if (fs.realpathSync(root) !== path.resolve(root)) throw Error('packaged continuity tree escaping');
  const files = [];
  function visit(dir, prefix = '') {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), relative = path.join(prefix, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw Error('packaged continuity tree symlink');
      if (stat.isDirectory()) { if (name === 'node_modules') throw Error('packaged continuity nested dependency'); visit(file, relative); }
      else { regular(file); files.push(relative); }
    }
  }
  visit(root); return files;
}
function packageAt(root, name, version) {
  const metadata = JSON.parse(fs.readFileSync(regular(path.join(root, 'package.json')), 'utf8'));
  if (metadata.name !== name || metadata.version !== version) throw Error('packaged continuity version mismatch: ' + name);
  tree(root);
}
function present(file) { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function verify({ resources, platform, arch }) {
  const metadata = JSON.parse(fs.readFileSync(regular(path.join(resources, 'continuity-native/auth-owner.json')), 'utf8'));
  if (physicalFlags.some(key => metadata[key] !== false)) throw Error('continuity native qualification requires separate release review');
  if (!fs.readFileSync(regular(path.join(sourceRoot, 'services/continuity-native/auth-owner.json'))).equals(fs.readFileSync(regular(path.join(resources, 'continuity-native/auth-owner.json'))))) throw Error('packaged continuity source recipe mismatch');
  const services = path.join(resources, 'services');
  for (const name of ['continuity-sync', 'continuity-device']) {
    const expected = path.join(sourceRoot, 'services', name), actual = path.join(services, name);
    const record = JSON.parse(fs.readFileSync(regular(path.join(actual, 'package.json')), 'utf8'));
    if (record.name !== '@xiaok/' + name || record.version !== '0.1.0') throw Error('packaged continuity version mismatch: ' + name);
    const expectedFiles = tree(path.join(expected, 'src')).filter(file => file.endsWith('.mjs')).sort();
    const actualFiles = tree(path.join(actual, 'src')).filter(file => file.endsWith('.mjs')).sort();
    if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) throw Error('packaged continuity source census mismatch');
    for (const file of expectedFiles) if (!fs.readFileSync(regular(path.join(expected, 'src', file))).equals(fs.readFileSync(regular(path.join(actual, 'src', file))))) throw Error('packaged continuity source mismatch: ' + file);
  }
  for (const pkg of ['libsodium', 'libsodium-wrappers']) {
    const root = path.join(services, 'continuity-sync/node_modules', pkg); packageAt(root, pkg, '0.8.4');
    for (const [folder, ext] of [['modules', 'js'], ['modules-esm', 'mjs']]) regular(path.join(root, 'dist', folder, pkg + '.' + ext));
  }
  packageAt(path.join(services, 'continuity-device/node_modules/@napi-rs/keyring'), '@napi-rs/keyring', '2.1.1');
  regular(path.join(services, 'continuity-device/node_modules/@napi-rs/keyring/index.js'));
  if (platform === 'darwin' && arch === 'arm64') {
    const root = path.join(services, 'continuity-device/node_modules/@napi-rs/keyring-darwin-arm64');
    packageAt(root, '@napi-rs/keyring-darwin-arm64', '2.1.1'); regular(path.join(root, 'keyring.darwin-arm64.node'));
  }
  const binary = path.join(resources, 'continuity-auth/darwin-arm64/codex-app-server');
  if (present(binary)) {
    if (platform !== 'darwin' || arch !== 'arm64') throw Error('continuity native artifact unsupported target');
    strictNativeArtifact.verify({ resources, platform, arch });
  }
  return { scope: 'source-completeness-only', sourceComplete: true, nativeRuntimeQualified: false, nativeArtifact: present(binary) ? 'present-pinned-inactive' : 'absent-inactive' };
}
module.exports = async context => {
  const platform = context.electronPlatformName, arch = Arch[context.arch];
  const resources = platform === 'darwin' ? path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app/Contents/Resources') : path.join(context.appOutDir, 'resources');
  if (platform === 'darwin' && arch === 'arm64') {
    const source = path.join(sourceRoot, 'services/continuity-device/node_modules/@napi-rs/keyring-darwin-arm64');
    const target = path.join(resources, 'services/continuity-device/node_modules/@napi-rs/keyring-darwin-arm64');
    tree(source);
    if (!present(target)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false }); }
    const staged = path.join(sourceRoot, 'desktop/resources/continuity-auth/darwin-arm64/codex-app-server');
    if (present(staged)) {
      const bytes = fs.readFileSync(regular(staged));
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== binaryPin) throw Error('continuity staged native artifact hash mismatch');
      const destination = path.join(resources, 'continuity-auth/darwin-arm64/codex-app-server');
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (present(destination)) {
        if (!fs.readFileSync(regular(destination)).equals(bytes)) throw Error('continuity existing native artifact mismatch');
      } else fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o755 });
    }
  }
  return verify({ resources, platform, arch });
};
module.exports.verify = verify;

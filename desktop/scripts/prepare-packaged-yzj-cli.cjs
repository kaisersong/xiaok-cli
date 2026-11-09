'use strict';
// Build-time only: invoke the locked original installer without its unrelated
// skill sources, then retain the existing packaged target/version verifier.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {verifyPackagedYzjCli} = require('./verify-packaged-yzj-cli.cjs');
const INSTALLER_SHA = '273eead5e1beec099ae77dab73e0b0a5c338d7eaac13f349f3ba59ff20779525';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function regular(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error('yzj_package_input_alias');
}
function directory(file) {
  const info = fs.lstatSync(file);
  const canonical = fs.realpathSync(file), requested = path.resolve(file);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform === 'win32'
    ? canonical.toLowerCase() !== requested.toLowerCase() : canonical !== requested)) throw Error('yzj_package_directory_alias');
}
function preparePackagedYzjCli(desktopDir = path.resolve(__dirname, '..')) {
  directory(desktopDir);
  const packageRoot = path.join(desktopDir, 'node_modules', '@yunzhijia', 'cli');
  for (const dir of [path.join(desktopDir, 'node_modules'), path.join(desktopDir, 'node_modules', '@yunzhijia'), packageRoot]) directory(dir);
  const manifestFile = path.join(packageRoot, 'package.json'), installerFile = path.join(packageRoot, 'scripts', 'install.js');
  directory(path.dirname(installerFile)); regular(manifestFile); regular(installerFile);
  const manifestBytes = fs.readFileSync(manifestFile), installer = fs.readFileSync(installerFile);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.name !== '@yunzhijia/cli' || manifest.version !== '0.1.8' || manifest.publishConfig?.tag !== 'latest'
    || hash(installer) !== INSTALLER_SHA) throw Error('yzj_package_installer_not_locked');
  const capsule = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'yzj-package-install-'));
  const config = path.join(capsule, 'config'); fs.mkdirSync(config, {mode: 0o700});
  const env = {XIAOK_CONFIG_DIR: config, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1'};
  const keep = new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','LANG','LC_ALL','HOME','USERPROFILE',
    'APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA',
    'HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','SSL_CERT_FILE','SSL_CERT_DIR']);
  for (const [key, value] of Object.entries(process.env)) if (keep.has(key.toUpperCase())) env[key] = value;
  const temporary = path.join(capsule, 'tmp'); fs.mkdirSync(temporary, {mode: 0o700});
  Object.assign(env, {TMPDIR: temporary, TMP: temporary, TEMP: temporary});
  const run = (file, args, options) => spawnSync(file, args, {...options, env});
  let complete = false;
  try {
    const binaryName = process.platform === 'win32' ? 'yzj-cli.exe' : 'yzj-cli';
    const destinationDir = path.join(packageRoot, 'bin'), destination = path.join(destinationDir, binaryName);
    try {
      directory(destinationDir); regular(destination); const result = verifyPackagedYzjCli({packageRoot, platform: process.platform, arch: process.arch, run});
      complete = true; return {...result, prepared: false};
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Keep original entry point and bytes. No skills/ directory is copied:
    // installSkills returns before os.homedir(), so HOME/USERPROFILE stay intact.
    fs.mkdirSync(path.join(capsule, 'scripts'), {mode: 0o700});
    fs.writeFileSync(path.join(capsule, 'package.json'), manifestBytes, {flag: 'wx', mode: 0o600});
    const entry = path.join(capsule, 'scripts', 'install.js'); fs.writeFileSync(entry, installer, {flag: 'wx', mode: 0o600});
    const result = run(process.execPath, [entry], {cwd: capsule, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024});
    if (result.error || result.status !== 0) throw new Error('yzj_package_original_install_failed', {cause: result.error ?? result});
    // The vendor installer returns exit0 even on a download failure. Actual
    // executable target+version must pass, rather than trusting that exit code.
    try { verifyPackagedYzjCli({packageRoot: capsule, platform: process.platform, arch: process.arch, run}); }
    catch (cause) {
      const error = new Error('yzj_package_original_installer_did_not_prepare_binary', {cause});
      Object.defineProperty(error, 'installerResult', {value: result}); throw error;
    }
    const source = path.join(capsule, 'bin', binaryName); regular(source);
    try { fs.mkdirSync(destinationDir, {mode: 0o755}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    directory(destinationDir); fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL); regular(destination);
    if (hash(fs.readFileSync(source)) !== hash(fs.readFileSync(destination))) throw Error('yzj_package_copy_changed');
    const verified = verifyPackagedYzjCli({packageRoot, platform: process.platform, arch: process.arch, run});
    complete = true; return {...verified, prepared: true};
  } catch (error) {
    // Failure/timeout may retain entered resources. Keep only this private
    // capsule as evidence; never remove another install or report success.
    throw new Error(`yzj_package_prepare_unconfirmed: ${capsule}`, {cause: error});
  } finally { if (complete) fs.rmSync(capsule, {recursive: true, force: true}); }
}
module.exports = {preparePackagedYzjCli};
if (require.main === module) {
  try { console.log(JSON.stringify(preparePackagedYzjCli())); }
  catch (error) { console.error(error); process.exitCode = 1; }
}

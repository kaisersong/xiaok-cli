// Test-only ordinary UI account mapping. Not an OS principal, SDK grant or custody port.
const os = require('node:os');
const {syncBuiltinESMExports} = require('node:module');
const {constants, lstatSync, realpathSync, mkdirSync, openSync, closeSync, fstatSync, readFileSync, writeFileSync} = require('node:fs');
const {basename, dirname, join, resolve, isAbsolute} = require('node:path');
if (!process.versions.electron || process.type !== 'browser' || !require('electron').app) throw Error('ordinary_ui_account_main_process');
// Remove only this test preload from inherited fork execArgv, preserving all original flags.
for (let i = process.execArgv.length - 2; i >= 0; i--) {
  if ((process.execArgv[i] === '-r' || process.execArgv[i] === '--require') && resolve(process.execArgv[i + 1]) === __filename) process.execArgv.splice(i, 2);
}

if (!['darwin', 'linux', 'win32'].includes(process.platform)) throw Error('ordinary_ui_account_platform');
// Existing Windows ordinary writer skips POSIX inventory. No Windows account fabrication.
if (process.platform !== 'win32') {
  const nativeUserInfo = os.userInfo, identity = nativeUserInfo();
  const uid = process.getuid?.(), euid = process.geteuid?.(), gid = process.getgid?.(), egid = process.getegid?.();
  if (!Number.isSafeInteger(uid) || uid < 1 || uid !== euid || identity.uid !== uid || identity.gid !== gid || gid !== egid) throw Error('ordinary_ui_account_identity');
  function ownedDirectory(path, mode) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw Error('ordinary_ui_account_path');
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o777) !== mode) throw Error('ordinary_ui_account_directory');
    return {path: realpathSync(path), stat};
  }
  function ownedEntry(path) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw Error('ordinary_ui_account_entry');
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== uid || (stat.mode & 0o022) !== 0) throw Error('ordinary_ui_account_entry');
    return realpathSync(path);
  }
  const sharedEntry = realpathSync(join(__dirname, 'multi-agent-electron-main.mjs'));
  const productionEntry = realpathSync(join(__dirname, '..', '..', '..', 'dist', 'main', 'desktop', 'electron', 'main.js'));
  // Playwright's loader removes its bootstrap prefix through --remote-debugging-port=0.
  // Accept only an app entry first, optionally preceded by this fixture's own require pair.
  let entryOffset = 1;
  if (process.argv[entryOffset] === '-r' || process.argv[entryOffset] === '--require') {
    const preload = process.argv[entryOffset + 1];
    if (typeof preload !== 'string' || resolve(preload) !== __filename) throw Error('ordinary_ui_account_entry');
    entryOffset += 2;
  }
  const appEntry = process.argv[entryOffset];
  if (typeof appEntry !== 'string' || !isAbsolute(appEntry)
      || (resolve(appEntry) !== sharedEntry && resolve(appEntry) !== productionEntry)) {
    // Test-fixture diagnostic: Electron's preload error dialog need not reach stderr.
    const error = Error('ordinary_ui_account_entry');
    console.error(error);
    throw error;
  }
  // A later known literal cannot replace an unknown first entry or duplicate the selected entry.
  const entries = process.argv.slice(1).filter(value => typeof value === 'string' && isAbsolute(value) && (resolve(value) === sharedEntry || resolve(value) === productionEntry));
  if (entries.length !== 1) throw Error('ordinary_ui_account_entry');
  const entry = ownedEntry(appEntry);
  const shared = entry === sharedEntry;
  if (!shared && entry !== productionEntry) throw Error('ordinary_ui_account_entry');
  const rawRoot = shared ? process.env.XIAOK_MULTI_AGENT_E2E_ROOT : dirname(process.env.XIAOK_CONFIG_DIR || '');
  const observed = ownedDirectory(rawRoot, 0o700), root = observed.path;
  const pattern = shared
    ? /^xiaok-(?:desktop-authorization-electron|desktop-readback-electron|desktop-multi-agent-electron|welcome-agents|summary-resume-e2e|execution-lanes-e2e|activity-electron)-[A-Za-z0-9]{6}$/
    : /^xiaok-(?:artifact-runtime-e2e|recorder-runtime-e2e|office-e2e)-[A-Za-z0-9]{6}$/;
  if (dirname(root) !== realpathSync(os.tmpdir()) || !pattern.test(basename(root))) throw Error('ordinary_ui_account_namespace');
  function intendedChild(value, name) {
    if (typeof value !== 'string' || resolve(value) !== resolve(join(rawRoot, name))) throw Error('ordinary_ui_account_child');
    try {
      const stat = lstatSync(value);
      if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== uid || realpathSync(value) !== join(root, name)) throw Error('ordinary_ui_account_child');
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  intendedChild(process.env.XIAOK_CONFIG_DIR, 'config');
  if (shared) intendedChild(process.env.XIAOK_E2E_USER_DATA, 'profile');
  else {
    const profiles = process.argv.filter(value => value.startsWith('--user-data-dir='));
    if (profiles.length !== 1) throw Error('ordinary_ui_account_profile');
    intendedChild(profiles[0].slice('--user-data-dir='.length), 'profile');
  }
  const home = join(root, '.ordinary-ui-account');
  try { mkdirSync(home, {mode: 0o700}); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
  const account = ownedDirectory(home, 0o700);
  if (account.path !== home || resolve(home) === resolve(identity.homedir)) throw Error('ordinary_ui_account_real_home');
  const contract = {version: 1, purpose: 'ordinary-ui-userInfo-homedir-only', entry, root, home,
    uid, gid, rootDevice: String(observed.stat.dev), rootInode: String(observed.stat.ino),
    homeDevice: String(account.stat.dev), homeInode: String(account.stat.ino)};
  // Restart fixture metadata only, never a release/ownership/authority receipt.
  const contractPath = join(root, '.ordinary-ui-account.json');
  try { writeFileSync(contractPath, JSON.stringify(contract), {flag: 'wx', mode: 0o600}); }
  catch (error) { if (error?.code !== 'EEXIST') throw error; }
  const fd = openSync(contractPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== uid || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 4096) throw Error('ordinary_ui_account_contract');
    if (JSON.stringify(JSON.parse(readFileSync(fd, 'utf8'))) !== JSON.stringify(contract)) throw Error('ordinary_ui_account_contract');
  } finally { closeSync(fd); }
  const wrap = options => {
    const info = nativeUserInfo(options);
    return {...info, homedir: Buffer.isBuffer(info.homedir) ? Buffer.from(home) : home};
  };
  const check = wrap();
  for (const key of Object.keys(identity)) if (key !== 'homedir' && !Object.is(check[key], identity[key])) throw Error('ordinary_ui_account_changed_identity');
  if (process.getuid() !== uid || process.geteuid() !== euid || process.getgid() !== gid || process.getegid() !== egid) throw Error('ordinary_ui_account_changed_identity');
  os.userInfo = wrap;
  syncBuiltinESMExports();
  // os.homedir, process env, actual UID/GID, installed reader and SDK paths stay original.
  writeFileSync(join(root, `.ordinary-ui-account-boot-${process.pid}.json`), JSON.stringify({version: 1,
    purpose: 'fixture-only-not-authority', pid: process.pid, entry, root, home,
    uid, gid, euid, egid,
    actualUidGidEuidEgidComparedAtBootstrap: true,
    defaultEncodingNonHomeUserInfoFieldsCompared: true,
    bindingScope: 'electron-main-only', syntheticUserInfoHomeMapping: true,
    globalRegistryBeforeAfter: 'NOT_OBSERVED', childBinding: 'NOT_PROVEN',
    accountGenerationOrGrantIssued: false}), {flag: 'wx', mode: 0o600});
}

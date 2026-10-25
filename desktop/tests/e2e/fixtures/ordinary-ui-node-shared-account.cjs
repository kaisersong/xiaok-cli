// Test fixture only: POSIX reuses Main's existing account; Windows preserves Main's native identity branch.
'use strict';
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const {syncBuiltinESMExports} = require('node:module');
function deny(code) {
  const error = Error(code);
  try { fs.writeSync(2, `${error.stack}\n`); } catch {}
  process.exit(78);
  throw error;
}
try {
  if (!process.versions.node || process.versions.electron || process.type !== undefined || !['darwin','linux','win32'].includes(process.platform)) deny('ordinary_ui_node_process');
  if (process.env.NODE_OPTIONS || process.env.ELECTRON_RUN_AS_NODE) deny('ordinary_ui_node_preload_environment');
  if (process.execArgv.length !== 2 || !['-r','--require'].includes(process.execArgv[0]) || path.resolve(process.execArgv[1]) !== __filename) deny('ordinary_ui_node_preload_arguments');
  const windows = process.platform === 'win32';
  const nativeUserInfo = os.userInfo, identity = windows ? undefined : nativeUserInfo();
  // Windows follows unchanged Main's no-POSIX-inventory branch: no POSIX API call or invented IDs.
  const uid = windows ? undefined : process.getuid(), euid = windows ? undefined : process.geteuid();
  const gid = windows ? undefined : process.getgid(), egid = windows ? undefined : process.getegid();
  if (!windows && (!Number.isSafeInteger(uid) || uid < 1 || uid !== euid || gid !== egid || identity.uid !== uid || identity.gid !== gid)) deny('ordinary_ui_node_identity');
  const same = (a,b) => a.dev === b.dev && a.ino === b.ino;
  function directory(value, mode) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) deny('ordinary_ui_node_directory');
    const stat = fs.lstatSync(value);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (!windows && (stat.uid !== uid || (mode !== undefined && (stat.mode & 0o777) !== mode)))) deny('ordinary_ui_node_directory');
    return {path:fs.realpathSync(value), stat};
  }
  function entry(value) {
    const stat = fs.lstatSync(value);
    if (stat.isSymbolicLink() || !stat.isFile() || (!windows && (stat.uid !== uid || (stat.mode & 0o022)))) deny('ordinary_ui_node_entry');
    if (fs.realpathSync(value) !== path.resolve(value)) deny('ordinary_ui_node_entry');
    return path.resolve(value);
  }
  const allowed = ['activity-native-source.mjs','activity-mcp-source.mjs'].map(name => entry(path.join(__dirname,name)));
  if (process.argv.length !== 5 || !allowed.includes(process.argv[1])) deny('ordinary_ui_node_entry');
  const selected = entry(process.argv[1]);
  const rawRoot = process.env.XIAOK_MULTI_AGENT_E2E_ROOT;
  const observed = directory(rawRoot,0o700), root = observed.path;
  if (path.dirname(root) !== fs.realpathSync(os.tmpdir()) || !/^xiaok-activity-electron-[A-Za-z0-9]{6}$/.test(path.basename(root))) deny('ordinary_ui_node_namespace');
  const compiled = directory(path.join(__dirname,'../../../dist/main')).path;
  if (process.argv[2] !== path.join(__dirname,'../../../dist/main')) deny('ordinary_ui_node_arguments');
  if (fs.realpathSync(process.argv[2]) !== compiled || path.resolve(process.argv[3]) !== path.resolve(rawRoot,'data') || directory(process.argv[3]).path !== path.join(root,'data') || process.argv[4] !== 'activity-thread') deny('ordinary_ui_node_arguments');
  if (typeof process.env.XIAOK_CONFIG_DIR !== 'string' || path.resolve(process.env.XIAOK_CONFIG_DIR) !== path.resolve(rawRoot,'config') || directory(process.env.XIAOK_CONFIG_DIR).path !== path.join(root,'config') || directory(path.join(rawRoot,'profile')).path !== path.join(root,'profile')) deny('ordinary_ui_node_config_profile');
  if (windows) {
    // Main creates no synthetic account/contract on Windows. Preserve native userInfo and all real product readers.
    // This structural fixture admission is not Windows principal, ACL, inventory or ordinary-profile qualification.
    for (let n=process.execArgv.length-2;n>=0;n--) if (['-r','--require'].includes(process.execArgv[n]) && path.resolve(process.execArgv[n+1]) === __filename) process.execArgv.splice(n,2);
    fs.writeFileSync(path.join(root,`.ordinary-ui-node-boot-${process.pid}.json`),JSON.stringify({version:1,purpose:'fixture-only-not-authority',bindingScope:'node-original-source-only-native-windows',entry:selected,root,pid:process.pid,syntheticUserInfoHomeMapping:false,posixInventory:'NOT_APPLICABLE_OR_ATTESTED',windowsQualification:'NOT_ATTESTED',groupState:'UNKNOWN',accountGenerationOrGrantIssued:false,globalRegistryBeforeAfter:'NOT_OBSERVED'}),{flag:'wx',mode:0o600});
  } else {
  const home = path.join(root,'.ordinary-ui-account'), account = directory(home,0o700);
  if (account.path !== home || path.resolve(identity.homedir) === home) deny('ordinary_ui_node_home');
  const sharedEntry = entry(path.join(__dirname,'multi-agent-electron-main.mjs'));
  const expected = {version:1,purpose:'ordinary-ui-userInfo-homedir-only',entry:sharedEntry,root,home,uid,gid,rootDevice:String(observed.stat.dev),rootInode:String(observed.stat.ino),homeDevice:String(account.stat.dev),homeInode:String(account.stat.ino)};
  const contractPath = path.join(root,'.ordinary-ui-account.json');
  const fd = fs.openSync(contractPath,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let contractStat;
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.uid !== uid || before.nlink !== 1 || (before.mode & 0o777) !== 0o600 || before.size < 1 || before.size > 4096) deny('ordinary_ui_node_contract');
    const buffer = Buffer.alloc(4097);
    let count = 0;
    while (count < buffer.length) { const read = fs.readSync(fd,buffer,count,buffer.length-count,null); if (!read) break; count += read; }
    if (count !== before.size || count > 4096 || JSON.stringify(JSON.parse(buffer.subarray(0,count).toString('utf8'))) !== JSON.stringify(expected)) deny('ordinary_ui_node_contract');
    const after = fs.fstatSync(fd), current = fs.lstatSync(contractPath);
    for (const stat of [after,current]) if (!same(before,stat) || stat.size !== before.size || stat.mtimeMs !== before.mtimeMs || stat.ctimeMs !== before.ctimeMs || stat.uid !== uid || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || !stat.isFile() || stat.isSymbolicLink()) deny('ordinary_ui_node_contract_current');
    contractStat = after;
  } finally { fs.closeSync(fd); }
  if (!same(directory(rawRoot,0o700).stat,observed.stat) || !same(directory(home,0o700).stat,account.stat)) deny('ordinary_ui_node_history_namespace');
  // These existing paths are never copied, cleared, created or replaced by this adapter.
  for (const name of ['.xiaok','.xiaok/profile-sources','.xiaok/profile-sources/writer-fences']) {
    const value = path.join(home,name);
    try { if (directory(value).path !== value) deny('ordinary_ui_node_history_namespace'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const wrap = options => { const info = nativeUserInfo(options); return {...info,homedir:Buffer.isBuffer(info.homedir)?Buffer.from(home):home}; };
  const check = wrap();
  for (const key of Object.keys(identity)) if (key !== 'homedir' && !Object.is(identity[key],check[key])) deny('ordinary_ui_node_changed_identity');
  const nativeBuffer = nativeUserInfo({encoding:'buffer'}), mappedBuffer = wrap({encoding:'buffer'});
  if (!Buffer.isBuffer(mappedBuffer.homedir) || mappedBuffer.homedir.toString() !== home) deny('ordinary_ui_node_buffer_shape');
  for (const key of Object.keys(nativeBuffer)) if (key !== 'homedir' && (Buffer.isBuffer(nativeBuffer[key]) ? !nativeBuffer[key].equals(mappedBuffer[key]) : !Object.is(nativeBuffer[key],mappedBuffer[key]))) deny('ordinary_ui_node_changed_identity');
  if (process.getuid() !== uid || process.geteuid() !== euid || process.getgid() !== gid || process.getegid() !== egid) deny('ordinary_ui_node_changed_identity');
  for (let n=process.execArgv.length-2;n>=0;n--) if (['-r','--require'].includes(process.execArgv[n]) && path.resolve(process.execArgv[n+1]) === __filename) process.execArgv.splice(n,2);
  os.userInfo = wrap;
  syncBuiltinESMExports();
  fs.writeFileSync(path.join(root,`.ordinary-ui-node-boot-${process.pid}.json`),JSON.stringify({version:1,purpose:'fixture-only-not-authority',bindingScope:'node-original-source-only',entry:selected,root,home,pid:process.pid,uid,euid,gid,egid,contractDevice:String(contractStat.dev),contractInode:String(contractStat.ino),syntheticUserInfoHomeMapping:true,groupState:'UNKNOWN',accountGenerationOrGrantIssued:false,fenceContents:'NOT_INTERPRETED',globalRegistryBeforeAfter:'NOT_OBSERVED'}),{flag:'wx',mode:0o600});
  }
} catch (error) { deny(error && /^ordinary_ui_node_/.test(error.message) ? error.message : 'ordinary_ui_node_contract_or_path_unavailable'); }

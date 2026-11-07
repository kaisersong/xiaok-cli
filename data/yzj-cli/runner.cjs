// Shared by CLI and Desktop. Only built-ins: Desktop needs no system Node/npm.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

function readVersion(binary) {
  const output = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  const match = /^yzj-cli (\d+\.\d+\.\d+)\s*$/.exec(output);
  if (!match) throw Error('无法识别云之家 CLI 版本');
  return match[1];
}
async function fetchMetadata() {
  const response = await fetch('https://registry.npmjs.org/@yunzhijia/cli/latest', { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`云之家 CLI 版本查询失败: HTTP ${response.status}`);
  return response.json();
}
async function install({ destination, version, installerPath, stage }) {
  const pkg = path.join(stage, 'package');
  fs.mkdirSync(path.join(pkg, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@yunzhijia/cli', version, publishConfig: { tag: 'latest' } }));
  const script = path.join(pkg, 'scripts', 'install.js');
  fs.copyFileSync(installerPath, script);
  const home = path.join(stage, 'installer-home'); fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, ELECTRON_RUN_AS_NODE: '1', YZJ_CLI_RUN: 'true' };
  delete env.YZJ_CLI_SKIP_INSTALL;
  const result = spawnSync(process.execPath, [script], { env, stdio: 'inherit', windowsHide: true, timeout: 420000 });
  if (result.error || result.status !== 0) throw Error(`云之家 CLI 下载失败: ${result.error?.message ?? result.status}`);
  // Upstream deliberately exits 0 on a failed download; require its real output file.
  const downloaded = path.join(pkg, 'bin', process.platform === 'win32' ? 'yzj-cli.exe' : 'yzj-cli');
  if (!fs.existsSync(downloaded)) throw Error('云之家 CLI 下载未产生二进制，请检查上述下载错误');
  fs.renameSync(downloaded, destination);
}
async function updateCli(input, deps = {}) {
  const platform = input.platform ?? process.platform;
  const log = deps.log ?? console.log;
  const versionOf = deps.readVersion ?? readVersion;
  const dir = path.dirname(input.binaryPath); const lock = path.join(dir, '.update-lock');
  try { fs.mkdirSync(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error(`云之家 CLI 更新已在运行。若前次异常退出，请确认无更新进程后删除 ${lock}`);
    throw error;
  }
  let stage;
  try {
    const { version } = await (deps.fetchMetadata ?? fetchMetadata)();
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw Error('云之家 CLI registry version 无效');
    const current = versionOf(input.binaryPath);
    const a = current.split('.').map(Number), b = version.split('.').map(Number);
    const comparison = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    if (!input.force && comparison >= 0) { log(`云之家 CLI 已是最新版本: ${current}`); return 0; }
    log(`更新云之家 CLI: ${current} -> ${version}`);
    stage = fs.mkdtempSync(path.join(dir, '.update-'));
    const candidate = path.join(stage, path.basename(input.binaryPath));
    await (deps.install ?? install)({ destination: candidate, version, installerPath: input.installerPath, stage });
    if (versionOf(candidate) !== version) throw Error('云之家 CLI 下载版本与 registry version 不一致');
    if (platform !== 'win32') fs.chmodSync(candidate, 0o755);
    if (platform === 'win32') {
      const old = input.binaryPath + '.old';
      // Both the active and candidate versions have been validated above.
      // A completed recovery or an earlier in-flight reader may leave .old.
      try { fs.rmSync(old, { force: true, maxRetries: 5, retryDelay: 200 }); }
      catch { throw Error(`无法清理上次更新恢复文件 ${old}，请关闭相关云之家 CLI 进程后重试`); }
      fs.renameSync(input.binaryPath, old);
      try { fs.renameSync(candidate, input.binaryPath); }
      catch (error) { fs.renameSync(old, input.binaryPath); throw error; }
      try { fs.rmSync(old); } catch { /* An in-flight native command may still hold .old. */ }
    } else fs.renameSync(candidate, input.binaryPath);
    log(`云之家 CLI 已更新: ${version}`);
    return 0;
  } finally {
    try { if (stage) fs.rmSync(stage, { recursive: true, force: true, maxRetries: 3 }); }
    finally { fs.rmdirSync(lock); }
  }
}
function isManagedUpdate(args) {
  const flags = new Set(['--force', '--debug', '--verbose']);
  let command;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' || args[i] === '--endpoint') { if (++i >= args.length) return false; continue; }
    if (flags.has(args[i])) continue;
    if (command || args[i] !== 'update') return false;
    command = 'update';
  }
  return command === 'update';
}
async function runCli(binaryPath, installerPath, args) {
  if (isManagedUpdate(args)) {
    // These upstream global flags select business API identity/endpoint, not a
    // software distribution mirror. Never send credentials to an update source.
    if (args.includes('--profile') || args.includes('--endpoint')) console.log('CLI 更新使用官方发行源；--profile / --endpoint 仅用于云之家业务 API。');
    return updateCli({ binaryPath, installerPath, force: args.includes('--force') });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { shell: false, stdio: 'inherit' });
    const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM');
    const cleanup = () => { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); };
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, signal) => { cleanup(); resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)); });
  });
}
if (require.main === module) {
  const [binary, installer, ...args] = process.argv.slice(2);
  runCli(binary, installer, args).then(code => { process.exitCode = code; }, error => { console.error(`[yzj-cli] ${error.message}`); process.exitCode = 1; });
}
module.exports = { updateCli, runCli, isManagedUpdate };

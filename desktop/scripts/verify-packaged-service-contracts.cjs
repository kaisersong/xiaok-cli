const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { existsSync, readFileSync, realpathSync } = require('node:fs');
const { mkdtemp, mkdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function fail(component, message) {
  throw new Error(`packaged service contract: ${component}: ${message}. Update sibling checkouts/dependencies and rebuild Desktop/plugin bundles before packaging.`);
}
function inside(root, file) {
  const relative = path.relative(realpathSync(root), realpathSync(file));
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function file(root, relative, component) {
  const candidate = path.resolve(root, relative);
  if (!existsSync(candidate) || !inside(root, candidate)) fail(component, `missing or escaping packaged file ${relative}`);
  return candidate;
}
function validateHealth(name, health, child, entry, label = name, workflowSupport) {
  if (health?.ok !== true) fail(label, 'health.ok must be true');
  const service = health.service;
  const hash = createHash('sha256').update(readFileSync(entry)).digest('hex');
  if (service?.pid !== child.pid || !service.instanceId || service.entryHash !== hash
    || typeof service.entryPath !== 'string' || realpathSync(service.entryPath) !== realpathSync(entry)
    || !/^[a-f0-9]{64}$/.test(service.sourceHash ?? '')) fail(label, 'health lacks the current process/entry identity');
  const protocol = health.protocols?.room_workspace_v1;
  if (!protocol || ['contextVersion','resultVersion','releaseVersion'].some(key => protocol[key] !== 1)) fail(label, 'room_workspace_v1 versions must all be 1');
  if (name === 'kswarm') {
    if (typeof workflowSupport !== 'function' || !workflowSupport(health)) fail(label, 'Desktop workflow readiness contract failed');
    if (!['dynamic_workflows','workflow_progress_batch','workflow_script_generated_runs'].every(value => health.features?.includes(value))) fail(label, 'required workflow capabilities are absent');
    if (!Number.isSafeInteger(health.roomEventOutbox?.retryOperationLimit) || health.roomEventOutbox.retryOperationLimit < 1
      || !Array.isArray(health.roomEventOutbox.retryCapacityProjects)) fail(label, 'durable activity outbox contract is absent');
  }
}
async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve)); return value;
}
function environment(root) {
  const env = {};
  for (const key of ['PATH','SystemRoot','SYSTEMROOT','ComSpec','WINDIR','TMP','TEMP','TMPDIR']) if (process.env[key]) env[key] = process.env[key];
  return { ...env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, ELECTRON_RUN_AS_NODE: '1', ENABLE_HUMAN_ESCALATION: '0' };
}
async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit').catch(() => {});
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  try { await exited; } finally { clearTimeout(timer); }
}
// Production starts the Broker with its own pinned packaged Node runtime
// (resolvePackagedBrokerRuntime), never the packaging host's Node. Probe the
// same executable and sanitized environment so a host Node version cannot
// decide the release; a supported target without a verified runtime fails.
function packagedBrokerRuntime(resources, platform, arch, env) {
  if (platform === undefined && arch === undefined) return null;
  const { resolvePackagedBrokerRuntime, targetEntry } = require('../electron/broker-runtime-package.cjs');
  if (!targetEntry(`${platform}-${arch}`)) return null;
  let runtime;
  try { runtime = resolvePackagedBrokerRuntime({ isPackaged: true, resourcesPath: resources, platform, arch, env }); }
  catch (error) { fail('intent-broker runtime', `packaged Broker Node runtime is invalid for ${platform}-${arch}: ${error.message}`); }
  if (!runtime) fail('intent-broker runtime', `packaged Broker Node runtime was not selected for ${platform}-${arch}`);
  return runtime;
}
function serviceLaunch(name, resources, env, platform, arch) {
  const runtime = name === 'intent-broker' ? packagedBrokerRuntime(resources, platform, arch, env) : null;
  return runtime ? { command: runtime.command, env: { ...runtime.env }, runtime } : { command: process.execPath, env, runtime: null };
}
function assertBrokerRuntimeHealth(label, health, runtime) {
  if (!runtime) return;
  const { brokerRuntimeMatchesHealth } = require('../electron/broker-runtime-package.cjs');
  if (!brokerRuntimeMatchesHealth(health, runtime)) fail(label, 'health does not report the pinned packaged Broker Node runtime');
}
async function serviceProbe(name, resources, root, timeoutMs, workflowSupport, platform, arch) {
  const serviceRoot = path.join(resources, 'services', name);
  const manifest = JSON.parse(readFileSync(file(serviceRoot, 'package.json', name), 'utf8'));
  const label = `${name}@${manifest.version}`;
  const entry = file(serviceRoot, name === 'kswarm' ? 'src/server/index.js' : 'src/cli.js', label);
  const cwd = path.join(root, name); await mkdir(cwd);
  const selectedPort = await port();
  const env = { ...environment(cwd), PORT: String(selectedPort), KSWARM_PORT: String(selectedPort), KSWARM_DATA_ROOT: cwd,
    BROKER_URL: 'http://127.0.0.1:1', INTENT_BROKER_SOCKET_PATH: '', INTENT_BROKER_DB: path.join(cwd, 'broker.sqlite'),
    INTENT_BROKER_CONFIG: path.join(cwd, 'absent.json'), INTENT_BROKER_LOCAL_CONFIG: path.join(cwd, 'absent-local.json') };
  const launch = serviceLaunch(name, resources, env, platform, arch);
  const child = spawn(launch.command, ['--experimental-sqlite', entry], { cwd, env: launch.env, stdio: ['ignore','pipe','pipe'], windowsHide: true });
  let output = '', spawnError;
  child.on('error', error => { spawnError = error; });
  for (const stream of [child.stdout,child.stderr]) stream.on('data', data => { output = (output + String(data)).slice(-4096); });
  try {
    const deadline = Date.now() + timeoutMs;
    let health;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) fail(label, `isolated startup failed: ${spawnError?.message ?? output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${selectedPort}/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { health = await response.json(); break; }
      } catch { /* bounded startup wait */ }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    if (!health) fail(label, `health timeout after ${timeoutMs}ms: ${output}`);
    validateHealth(name, health, child, entry, label, workflowSupport);
    assertBrokerRuntimeHealth(label, health, launch.runtime);
    if (name === 'kswarm') for (const route of ['activity','activity-identity']) {
      const response = await fetch(`http://127.0.0.1:${selectedPort}/projects/__pack_probe__/${route}`, { signal: AbortSignal.timeout(1000) });
      if (response.status !== 401) fail(label, `${route} must exist and reject an unauthenticated read (got ${response.status})`);
    }
    return { component: name, version: manifest.version, entryHash: health.service.entryHash };
  } finally { await stop(child); }
}
function pluginFiles(resources) {
  const results = [];
  for (const name of ['kai-report-creator','kai-slide-creator','cua-computer-use','kai-infinity-canvas','kai-meeting-assistant']) {
    const root = path.join(resources, 'bundled-plugins', name);
    const manifest = JSON.parse(readFileSync(file(root, 'plugin.json', name), 'utf8'));
    if (manifest.name !== name || typeof manifest.version !== 'string' || !manifest.version) fail(name, 'invalid plugin identity');
    for (const skill of manifest.skills ?? []) file(root, path.join(skill, 'SKILL.md'), name);
    for (const server of manifest.mcpServers ?? []) {
      if (name === 'cua-computer-use') continue; // Native driver belongs to the existing runtime/ABI gate.
      if (server.protocol?.mode !== 'modern' || server.protocol?.version !== '2026-07-28') fail(name, 'required MCP protocol is absent');
      if (!Array.isArray(server.args) || !server.args.length) fail(name, 'missing local MCP entry');
      file(root, server.args[0], name);
    }
    results.push({ component: name, version: manifest.version });
  }
  return results;
}
async function reportProbe(resources, projectDir, root, timeoutMs) {
  const bundle = file(path.join(resources, 'bundled-plugins', 'kai-report-creator'), 'mcp-servers/report-renderer/dist/server.bundle.js', 'kai-report-creator');
  const adapter = file(projectDir, 'dist/main/src/platform/mcp/transport.js', 'Desktop MCP adapter');
  const probe = path.join(__dirname, 'probe-packaged-report-task.mjs');
  const child = spawn(process.execPath, [probe, adapter, bundle, root], { cwd: root, env: environment(root), stdio: ['ignore','pipe','pipe'], windowsHide: true });
  let output = '';
  for (const stream of [child.stdout,child.stderr]) stream.on('data', data => { output = (output + String(data)).slice(-4096); });
  try {
    const exit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    if (exit !== 0) fail('kai-report-creator', `actual bundle Tasks probe failed: ${output}`);
  } catch (error) { fail('kai-report-creator', `actual bundle Tasks probe failed: ${error.message}`); }
  finally { await stop(child); }
}
// The packaged Broker sidecar (services/intent-broker/runtime/xiaok-source-runtime.cjs)
// resolves the Windows installation-absence helper next to itself. Without it the
// sidecar observes 'unavailable' and every ordinary source route fails closed.
const WINDOWS_ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' };
function brokerWindowsAbsenceHelper(resources, arch) {
  const component = 'intent-broker windows-installation-absence';
  if (!['x64','arm64'].includes(arch)) fail(component, `unsupported Windows package arch ${arch}`);
  const root = path.join(resources, 'services', 'intent-broker', 'runtime');
  const exe = file(root, path.join('native', `win32-${arch}`, 'windows-installation-absence.exe'), component);
  const manifest = JSON.parse(readFileSync(file(root, path.join('native', `win32-${arch}`, 'windows-installation-absence.json'), component), 'utf8'));
  if (manifest?.target !== `win32-${arch}` || createHash('sha256').update(readFileSync(exe)).digest('hex') !== manifest.sha256)
    fail(component, `packaged helper does not match its manifest for win32-${arch}`);
  return { component: 'intent-broker-windows-absence', version: `win32-${arch}` };
}
async function verify({ resources, projectDir, timeoutMs = 10000, platform, arch }) {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaok-pack-contract-'));
  try {
    const plugins = pluginFiles(resources);
    const helpers = platform === 'win32' ? [brokerWindowsAbsenceHelper(resources, arch)] : [];
    const contractPath = file(projectDir, 'dist/main/desktop/shared/kswarm-health-contract.js', 'Desktop health contract');
    const { hasDynamicWorkflowSupport } = await import(pathToFileURL(contractPath).href);
    const services = [];
    for (const name of ['kswarm','intent-broker']) services.push(await serviceProbe(name, resources, root, timeoutMs, hasDynamicWorkflowSupport, platform, arch));
    await reportProbe(resources, projectDir, root, timeoutMs);
    return [...services, ...helpers, ...plugins];
  } catch (error) {
    if (error.message.startsWith('packaged service contract:')) throw error;
    fail('resources', error.message);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
}
module.exports = async context => {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const arch = typeof context.arch === 'number' ? WINDOWS_ARCH_NAMES[context.arch] : context.arch;
  const result = await verify({ resources, projectDir: context.packager.projectDir, platform: context.electronPlatformName, arch });
  console.log('packaged service contracts verified:', result.map(item => `${item.component}@${item.version}`).join(', '));
};
module.exports.verify = verify;
module.exports.validateHealth = validateHealth;
module.exports.pluginFiles = pluginFiles;
module.exports.brokerWindowsAbsenceHelper = brokerWindowsAbsenceHelper;
module.exports.serviceLaunch = serviceLaunch;
module.exports.assertBrokerRuntimeHealth = assertBrokerRuntimeHealth;

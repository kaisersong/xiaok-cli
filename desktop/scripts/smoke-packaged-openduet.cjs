#!/usr/bin/env node
// Actual packaged Electron/main/preload only. No fixture bridge, model execution,
// calendar connection, profile import, or automatic activation is permitted.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

function argument(name) { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; }
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
const help = 'Usage: node desktop/scripts/smoke-packaged-openduet.cjs --app <unsigned xiaok.app> --output <new evidence directory>\nRun only after the final fresh build and full afterPack gates pass. Creates a private temporary userData/config/HOME, then removes it after cleanup. macOS only; no Windows acceptance claim.';
if (process.argv.includes('--help')) { console.log(help); process.exit(0); }
if (!argument('--app') || !argument('--output')) { console.error(help); process.exit(2); }

function processTable() {
  const probe = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart='], { encoding: 'utf8' });
  if (probe.status !== 0) throw Error('cannot inventory owned processes');
  const rows = probe.stdout;
  const table = new Map(rows.trim().split('\n').filter(Boolean).map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    return [Number(match[1]), { ppid: Number(match[2]), start: match[3] }];
  }));
  table.delete(probe.pid); return table;
}
async function assertPortFree(port, host) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host, port, exclusive: true }, resolve); });
  } catch (error) {
    if (host === '::1' && ['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(error.code)) return;
    throw new Error(`Refusing GUI launch: ${host}:${port} unavailable (${error.code}); never adopt or stop an existing service.`, { cause: error });
  } finally { if (server.listening) await new Promise(resolve => server.close(resolve)); }
}
function privateEnvironment(root) {
  const env = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'TZ', '__CF_USER_TEXT_ENCODING']) if (process.env[key]) env[key] = process.env[key];
  const dirs = { HOME: 'home', USERPROFILE: 'home', XIAOK_CONFIG_DIR: 'config', XDG_CONFIG_HOME: 'xdg-config',
    XDG_DATA_HOME: 'xdg-data', XDG_CACHE_HOME: 'xdg-cache', XDG_STATE_HOME: 'xdg-state', XDG_RUNTIME_DIR: 'xdg-runtime',
    TMPDIR: 'tmp', TEMP: 'tmp', TMP: 'tmp', APPDATA: 'appdata', LOCALAPPDATA: 'localappdata' };
  for (const [key, relative] of Object.entries(dirs)) { env[key] = path.join(root, relative); fs.mkdirSync(env[key], { recursive: true }); }
  // No inherited API keys, model endpoints, dev server, launch pilot, broker
  // sockets, signing credentials, NODE_OPTIONS, Electron-as-Node or test flags.
  Object.assign(env, { CSC_IDENTITY_AUTO_DISCOVERY: 'false', ENABLE_HUMAN_ESCALATION: '0',
    // Chromium's singleton uses the account's OS temp directory even with a
    // private TMPDIR. Keep strict write isolation; singleton itself was exercised
    // by the first launch and is outside this controlled GUI assertion pass.
    XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE: '1',
    KSWARM_DATA_ROOT: path.join(root, 'kswarm'), INTENT_BROKER_DB: path.join(root, 'broker', 'broker.sqlite'),
    INTENT_BROKER_CONFIG: path.join(root, 'broker', 'absent.json'), INTENT_BROKER_LOCAL_CONFIG: path.join(root, 'broker', 'absent-local.json'),
    INTENT_BROKER_SOCKET_PATH: path.join(root, 'broker', 'broker.sock'), INTENT_BROKER_HEARTBEAT_PATH: path.join(root, 'broker', 'heartbeat.json') });
  fs.mkdirSync(path.join(root, 'broker')); fs.mkdirSync(env.KSWARM_DATA_ROOT);
  // Only this new private config is written. Empty providers/models make model
  // execution unavailable; this is an isolation condition, not a fake preload.
  write(path.join(env.XIAOK_CONFIG_DIR, 'config.json'), { schemaVersion: 2, defaultProvider: 'anthropic', defaultModelId: '',
    providers: {}, models: {}, defaultMode: 'interactive', channels: {}, automations: { globalBackgroundAutoRunEnabled: false } });
  fs.chmodSync(path.join(env.XIAOK_CONFIG_DIR, 'config.json'), 0o600);
  return env;
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const api = window.xiaokDesktop;
    const required = ['getAssistantActionOverview', 'getAssistantPeriodicStatus', 'getAssistantCalendarStatus',
      'getAssistantAnalysisProvider', 'getAssistantQualityStatus', 'getTimedActions', 'getTimedActionRuns', 'pauseAssistant'];
    for (const name of required) if (typeof api?.[name] !== 'function') throw Error('missing actual preload method: ' + name);
    const overview = await api.getAssistantActionOverview();
    const periodic = await api.getAssistantPeriodicStatus(), calendar = await api.getAssistantCalendarStatus();
    const analysis = await api.getAssistantAnalysisProvider(), quality = await api.getAssistantQualityStatus();
    const actions = await api.getTimedActions();
    if (!Array.isArray(actions)) throw Error('unexpected timed action contract');
    const assistant = actions.filter(action => action.id.startsWith('assistant:'));
    const runs = []; for (const action of assistant) runs.push(...await api.getTimedActionRuns(action.id));
    return { profileStatus: overview.profile.status, calendarEnabled: calendar.enabled, calendarEvents: calendar.snapshot.events.length,
      periodic, analysis: { state: analysis.state, selectedModelId: analysis.selectedModelId, modelCount: analysis.models.length },
      quality: { state: quality.state, sampleCount: quality.sampleCount }, assistantJobs: assistant.map(action => ({ id: action.id, status: action.status })),
      assistantRunCount: runs.length, launchCount: overview.launches.length, viewport: { width: innerWidth, height: innerHeight } };
  });
}
function checkInactive(state, expectedStatus) {
  assert.equal(state.profileStatus, expectedStatus);
  assert.equal(state.periodic.enabled, false); assert.equal(state.periodic.notificationsEnabled, false);
  assert.equal(state.periodic.available, false); assert.equal(state.calendarEnabled, false); assert.equal(state.calendarEvents, 0);
  assert.equal(state.analysis.state, 'not_configured'); assert.equal(state.analysis.modelCount, 0); assert.equal(state.analysis.selectedModelId, null);
  assert.notEqual(state.quality.state, 'passed'); assert.equal(state.quality.sampleCount, 0);
  assert.ok(state.assistantJobs.length >= 2, 'must see real built-in schedules, not an empty fake result');
  assert.ok(state.assistantJobs.every(action => action.status === 'paused'), 'all assistant schedules must stay paused');
  assert.equal(state.assistantRunCount, 0); assert.equal(state.launchCount, 0);
}
function auditPrivateDatabases(root) {
  const { DatabaseSync } = require('node:sqlite');
  const result = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && /\.(?:sqlite|sqlite3|db)$/.test(entry.name)) {
        const db = new DatabaseSync(file, { readOnly: true });
        try {
          for (const table of ['assistant_analysis_attempts', 'assistant_launch_operations', 'assistant_active_work_claims']) {
            if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
              const count = Number(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count);
              result.push({ database: path.relative(root, file), table, count }); assert.equal(count, 0, table + ' must remain empty');
            }
          }
        } finally { db.close(); }
      }
    }
  }
  walk(root);
  for (const name of ['assistant_analysis_attempts', 'assistant_launch_operations', 'assistant_active_work_claims']) assert.ok(result.some(row => row.table === name), 'missing real table: ' + name);
  return result;
}
async function main() {
  assert.equal(process.platform, 'darwin', 'this smoke is macOS only');
  const appPath = fs.realpathSync(path.resolve(argument('--app'))), output = path.resolve(argument('--output'));
  assert.ok(appPath.endsWith('.app'));
  const executablePath = path.join(appPath, 'Contents', 'MacOS', 'xiaok');
  assert.ok(fs.statSync(executablePath).isFile());
  // Never overwrite or mingle prior evidence. Do not default to a real profile.
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.mkdirSync(output);
  const result = { status: 'running', runnerPid: process.pid, browser: 'Browser plugin not available; existing Playwright Electron',
    appPath, checks: {}, pageErrors: [], consoleErrors: [], runnerActions: ['read actual IPC', 'pause private assistant', 'expand controls', 'toggle local attestation only'] };
  write(path.join(output, 'result.json'), result);
  let app, privateRoot, monitor, page;
  const owned = new Map(), signals = [];
  function capture() {
    const table = processTable();
    if (app?.process().pid && table.has(app.process().pid)) owned.set(app.process().pid, table.get(app.process().pid).start);
    let changed;
    do { changed = false; for (const [pid, value] of table) if (!owned.has(pid) && (value.ppid === process.pid || owned.has(value.ppid))) { owned.set(pid, value.start); changed = true; } } while (changed);
    write(path.join(output, 'owned-pids.json'), [...owned].map(([pid, start]) => ({ pid, start })));
  }
  try {
    for (const port of [4400, 4318]) for (const host of ['127.0.0.1', '::1']) await assertPortFree(port, host);
    result.checks.servicePortsUnused = true;
    privateRoot = fs.realpathSync(fs.mkdtempSync(path.join('/private', 'tmp', 'od-gui-')));
    const env = privateEnvironment(privateRoot), userData = path.join(privateRoot, 'userData'); fs.mkdirSync(userData);
    result.privateRoot = privateRoot; result.userData = userData; result.configDir = env.XIAOK_CONFIG_DIR;
    // Chromium cannot apply a nested Seatbelt profile. This test uses the more
    // restrictive outer OS policy for every child; it is not a Chromium sandbox security test.
    const args = [`--user-data-dir=${userData}`, '--no-sandbox']; result.command = { executablePath, args, cwd: privateRoot };
    result.asarSha256 = createHash('sha256').update(fs.readFileSync(path.join(appPath, 'Contents', 'Resources', 'app.asar'))).digest('hex');
    const { _electron, expect } = require('@playwright/test');
    capture(); monitor = setInterval(capture, 250);
    // Seatbelt is an OS boundary, not an app/preload replacement: prevent the
    // packaged updater/sidecars from accessing external networks or writing any
    // user files even if a startup default changes. All children inherit it.
    const policy = '(version 1) (allow default) (deny network-outbound) '
      + '(allow network-outbound (remote ip "localhost:*")) (deny file-write*) '
      + '(allow file-write* (subpath ' + JSON.stringify(privateRoot) + ') (literal "/dev/null"))';
    const policyPath = path.join(privateRoot, 'isolation.sb'); fs.writeFileSync(policyPath, policy);
    const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    const wrapper = path.join(privateRoot, 'launch-isolated-electron');
    fs.writeFileSync(wrapper, '#!/bin/sh\nexec /usr/bin/sandbox-exec -f ' + shellQuote(policyPath) + ' ' + shellQuote(executablePath) + ' "$@"\n', { mode: 0o700 });
    result.isolationPolicy = policy;
    app = await _electron.launch({ executablePath: wrapper, args, env, cwd: privateRoot, timeout: 60000 });
    capture();
    const log = fs.createWriteStream(path.join(output, 'electron.log'));
    app.process().stdout?.pipe(log, { end: false }); app.process().stderr?.pipe(log, { end: false });
    app.process().once('exit', () => log.end());
    result.main = await app.evaluate(({ app, BrowserWindow }) => ({ isPackaged: app.isPackaged, userData: app.getPath('userData'),
      configDir: process.env.XIAOK_CONFIG_DIR, cwd: process.cwd(), pid: process.pid,
      windows: BrowserWindow.getAllWindows().map(w => ({ preload: w.webContents.getLastWebPreferences().preload, contextIsolation: w.webContents.getLastWebPreferences().contextIsolation })) }));
    assert.equal(result.main.isPackaged, true); assert.equal(fs.realpathSync(result.main.userData), userData);
    assert.equal(result.main.configDir, env.XIAOK_CONFIG_DIR); assert.equal(result.main.cwd, privateRoot);
    page = await app.firstWindow({ timeout: 60000 });
    page.on('pageerror', error => result.pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
    await page.waitForFunction(() => typeof window.xiaokDesktop?.getAssistantActionOverview === 'function', null, { timeout: 30000 });
    result.preload = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().includes('app.asar')).map(w => {
      const prefs = w.webContents.getLastWebPreferences(); return { preload: prefs.preload, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration };
    }));
    assert.ok(result.preload.length > 0, 'missing actual renderer window preferences');
    for (const prefs of result.preload) {
      assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
    }
    // Electron omits preload from getLastWebPreferences on this version. Read
    // the actual loaded debugger script and compare its source with the ASAR.
    const cdp = await page.context().newCDPSession(page), loadedScripts = [];
    cdp.on('Debugger.scriptParsed', script => { if (script.url.endsWith('/preload.cjs')) loadedScripts.push(script); });
    await cdp.send('Debugger.enable');
    const expectedSource = require('@electron/asar').extractFile(path.join(appPath, 'Contents', 'Resources', 'app.asar'),
      path.join('dist', 'main', 'desktop', 'electron', 'preload.cjs')).toString('utf8');
    result.preloadSources = [];
    for (const script of loadedScripts) {
      const source = await cdp.send('Debugger.getScriptSource', { scriptId: script.scriptId });
      if (source.scriptSource.includes(expectedSource)) result.preloadSources.push({ url: script.url,
        asarSourceSha256: createHash('sha256').update(expectedSource).digest('hex'), packagedSourceMatches: true });
    }
    assert.ok(result.preloadSources.length > 0, 'actual loaded preload source must match packaged bytes');
    await cdp.detach();
    result.page = { url: page.url(), title: await page.title() };
    assert.ok(result.page.url.startsWith('file:') && result.page.url.includes('app.asar'), 'must render actual packaged renderer');
    await expect(page.getByTestId('welcome-home')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#assistant-home-title')).toBeVisible();
    result.initial = await snapshot(page); checkInactive(result.initial, 'needs_consent');
    await page.screenshot({ path: path.join(output, 'default.png') });
    result.checks.defaultInactive = true;
    // This real user-only API only pauses the private profile. Never call
    // activate/resume/check/connect/configure/import/export or any model API.
    await page.evaluate(() => window.xiaokDesktop.pauseAssistant()); await page.reload();
    await expect(page.getByTestId('welcome-home')).toBeVisible({ timeout: 30000 });
    const card = page.locator('section[aria-labelledby="assistant-home-title"]');
    const controls = [
      ['source', /^(云之家日历|Yunzhijia calendar)$/],
      ['quality', /^(真实案例质量复核|Real-case quality review)$/],
      ['model', /^(助理分析模型|Assistant analysis model)$/],
      ['periodic', /^(周期检查（未启用）|Periodic checks \(off\))$/],
    ];
    for (const [name, text] of controls) {
      const section = card.locator('details').filter({ has: page.locator('summary').filter({ hasText: text }) });
      await expect(section).toHaveCount(1); await section.locator('summary').click();
      assert.equal(await section.getAttribute('open'), '');
      if (name === 'source') await expect(section.getByRole('button', { name: /^(连接只读日历|Connect read-only calendar)$/ })).toBeVisible();
      if (name === 'quality') {
        const button = section.getByRole('button', { name: /^(导入人工复核结果|Import human review)$/ });
        await expect(button).toBeDisabled();
        const attestation = section.getByRole('checkbox'); await attestation.check(); await expect(button).toBeEnabled();
        await attestation.uncheck(); await expect(button).toBeDisabled();
      }
      if (name === 'model') {
        await expect(section.getByRole('combobox')).toBeVisible();
        await expect(section.getByRole('button')).toBeDisabled();
      }
      if (name === 'periodic') {
        await expect(section.getByRole('checkbox').first()).not.toBeChecked();
        await expect(section.getByRole('checkbox').first()).toBeDisabled();
        await expect(section.getByRole('button', { name: /^(立即检查|Check now)$/ })).toBeDisabled();
      }
      await section.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, name + '.png') });
      result.checks[name + 'Controls'] = true; await section.locator('summary').click();
    }
    result.final = await snapshot(page); checkInactive(result.final, 'paused');
    assert.equal(result.pageErrors.length, 0, 'renderer runtime exceptions');
    assert.equal(result.consoleErrors.length, 0, 'renderer console errors require investigation');
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = { name: error.name, message: error.message };
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    if (monitor) { clearInterval(monitor); capture(); }
    if (app) {
      capture(); let timer;
      try { await Promise.race([app.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('graceful close timeout')), 15000); })]); }
      catch (error) { result.closeError = error.message; result.status = 'failed'; process.exitCode = 1; }
      finally { clearTimeout(timer); }
    }
    // Signal only PIDs captured as this launched app's descendants, and only if
    // ps start identity is unchanged. Never kill by name, socket, port or path.
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      const table = processTable();
      for (const [pid, start] of [...owned].reverse()) if (table.get(pid)?.start === start) {
        try { process.kill(pid, signal); signals.push({ pid, signal }); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const table = processTable(); result.cleanup = { signals, remaining: [...owned].filter(([pid, start]) => table.get(pid)?.start === start).map(([pid]) => pid) };
    if (result.cleanup.remaining.length) { result.status = 'failed'; process.exitCode = 1; }
    if (privateRoot && !result.cleanup.remaining.length) {
      try { result.databaseAudit = auditPrivateDatabases(path.join(privateRoot, 'config')); }
      catch (error) { result.databaseAuditError = error.message; result.status = 'failed'; process.exitCode = 1; }
      fs.rmSync(privateRoot, { recursive: true, force: true, maxRetries: 5 }); result.cleanup.privateProfileRemoved = !fs.existsSync(privateRoot);
    }
    write(path.join(output, 'result.json'), result);
    console.log(JSON.stringify({ status: result.status, result: path.join(output, 'result.json'), remainingOwnedPids: result.cleanup.remaining.length }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

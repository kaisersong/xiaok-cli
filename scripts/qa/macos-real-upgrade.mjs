// QA only: no build, feed override, app replacement, signing or publication.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, closeSync, existsSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, arch, platform } from 'node:os';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const REPO = 'kaisersong/xiaok-cli';
const APP_ID = 'com.xiaok.desktop';
const TEAM = 'Y9YR86UG94';
const DEFAULT_CDP_PORT = 9222; // Production default in both signed 1.5.14 and the new app.
const OLD = Object.freeze({ tag: 'desktop-v1.5.14', version: '1.5.14', release: 418149835,
  sha: 'dc221f9bac84d939b8fb543d4795396693fdc9b8', bytes: 228655718,
  zipSHA256: 'b7a3b6d6e23b5423d581f8b93ad05b82b34fc0fab429c14ea4c9736d358ebf37' });
const NEW = Object.freeze({ tag: process.env.QA_NEW_TAG, sha: process.env.QA_NEW_SHA,
  release: process.env.QA_NEW_RELEASE_ID, zipSHA256: process.env.QA_NEW_ZIP_SHA256 });
const START = performance.now();
const DEADLINE = START + 25 * 60_000; // New QA budget, not a product timeout change.
const qaUid = process.getuid?.();
const qaHome = homedir();
const owned = new Map();
const children = new Set();
let root, evidence, app, appExecutable, oldChild, oldIdentity, monitorPromise;
let monitorStopped = false, monitorError, latestProcesses = [], installedRequest = false;
let primary, resultFacts = {}, commandId = 0, cleaning = false, shipItSHA256;
const delay = ms => new Promise(r => setTimeout(r, ms));
const inside = (parent, value) => { const r = relative(parent, value); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`)); };
function remaining() { if (!cleaning) assert(performance.now() < DEADLINE, 'qa_wall_budget_exhausted'); }
function save(name, value) { writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); }
function event(kind, facts) { appendFileSync(join(evidence, 'timeline.ndjson'), JSON.stringify({ utc: new Date().toISOString(), elapsedMs: performance.now() - START, kind, ...facts }) + '\n'); }
function validInputs() {
  assert(/^desktop-v\d+\.\d+\.\d+$/.test(NEW.tag ?? ''), 'new_tag_required');
  assert(/^[0-9a-f]{40}$/.test(NEW.sha ?? ''), 'full_new_sha_required');
  assert(/^[1-9][0-9]{0,15}$/.test(NEW.release ?? ''), 'canonical_release_id_required');
  assert(/^[0-9a-f]{64}$/.test(NEW.zipSHA256 ?? ''), 'new_zip_sha256_required');
  const numbers = NEW.tag.slice(9).split('.').map(Number);
  assert(numbers[0] > 1 || (numbers[0] === 1 && (numbers[1] > 5 || (numbers[1] === 5 && numbers[2] > 14))), 'new_version_must_follow_1_5_14');
}
async function command(executable, args, { timeout = 60_000, allowFailure = false, quiet = false } = {}) {
  const id = ++commandId, started = performance.now();
  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() });
  children.add(child);
  let out = '', err = '', exited = false, timedOut = false, spawnError;
  const capturedPID = child.pid;
  const timer = setTimeout(() => { if (!exited && capturedPID !== undefined) { timedOut = true; child.kill('SIGTERM'); } }, timeout);
  const killTimer = setTimeout(() => { if (!exited && capturedPID !== undefined) child.kill('SIGKILL'); }, timeout + 2000);
  child.stdout.on('data', b => { out += b; if (out.length > 4 * 1024 * 1024 && !exited) child.kill('SIGTERM'); });
  child.stderr.on('data', b => { err += b; if (err.length > 4 * 1024 * 1024 && !exited) child.kill('SIGTERM'); });
  child.once('exit', () => { exited = true; clearTimeout(timer); clearTimeout(killTimer); });
  const exit = await new Promise(res => { child.once('error', e => { spawnError = e.code ?? e.message; }); child.once('close', (code, signal) => res({ code, signal })); })
    .finally(() => { clearTimeout(timer); clearTimeout(killTimer); children.delete(child); });
  const receipt = { id, executable, args, pid: capturedPID ?? null, ...exit, spawnError, timedOut, elapsedMs: performance.now() - started, actualWait: capturedPID !== undefined, reaped: capturedPID !== undefined, closeObserved: true };
  if (!quiet) {
    writeFileSync(join(evidence, `command-${id}.stdout`), out, { mode: 0o600 });
    writeFileSync(join(evidence, `command-${id}.stderr`), err, { mode: 0o600 });
  }
  event('command', { ...receipt, stdoutSHA256: createHash('sha256').update(out).digest('hex'), stderrSHA256: createHash('sha256').update(err).digest('hex') });
  if (!allowFailure) assert(!spawnError && !timedOut && exit.code === 0 && exit.signal === null, `command_failed_${basename(executable)}_${id}`);
  return { ...receipt, out, err };
}
function cleanEnv() {
  // No GitHub credential, model credential or CI secret is inherited by the app.
  return { HOME: qaHome, USER: process.env.USER, LOGNAME: process.env.LOGNAME,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: process.env.RUNNER_TEMP, LANG: 'en_US.UTF-8' };
}
async function boundedBody(response, maximum) {
  assert(response.ok, `http_${response.status}`);
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; assert(bytes <= maximum, 'http_body_bound'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function api(endpoint) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const r = await fetch(`https://api.github.com/repos/${REPO}/${endpoint}`, { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  return JSON.parse((await boundedBody(r, 2 * 1024 * 1024)).toString());
}
function metadata(release) {
  return { id: release.id, tag_name: release.tag_name, target_commitish: release.target_commitish,
    draft: release.draft, prerelease: release.prerelease, published_at: release.published_at,
    bodySHA256: createHash('sha256').update(release.body ?? '').digest('hex'),
    assets: release.assets.map(a => ({ id: a.id, name: a.name, size: a.size, digest: a.digest, state: a.state, updated_at: a.updated_at })).sort((a, b) => a.name.localeCompare(b.name)) };
}
async function releaseFacts(spec) {
  const release = await api(`releases/${spec.release}`);
  assert(release.id === Number(spec.release) && release.tag_name === spec.tag && !release.draft && !release.prerelease && release.published_at, 'release_identity');
  const tag = await api(`git/ref/tags/${spec.tag}`);
  let object = tag.object;
  if (object.type === 'tag') object = (await api(`git/tags/${object.sha}`)).object;
  assert(object.type === 'commit' && object.sha === spec.sha, 'tag_source_identity');
  if (spec === NEW) {
    assert(release.target_commitish === NEW.sha, 'canonical_target_identity');
    const latest = await api('releases/latest');
    assert(latest.id === Number(NEW.release) && latest.tag_name === NEW.tag, 'production_latest_is_not_expected_target');
  }
  const version = spec.tag.slice(9), name = `xiaok-${version}-arm64-mac.zip`;
  const assets = release.assets.filter(a => a.name === name);
  assert(assets.length === 1, 'one_exact_zip_required');
  const asset = assets[0];
  assert(asset.state === 'uploaded' && asset.digest === `sha256:${spec.zipSHA256}` && asset.size > 0 && asset.size <= 512 * 1024 * 1024, 'asset_digest_size');
  if (spec === OLD) assert(asset.size === OLD.bytes, 'old_zip_size');
  const expectedURL = `https://github.com/${REPO}/releases/download/${spec.tag}/${name}`;
  assert(asset.browser_download_url === expectedURL, 'asset_url_not_official');
  return { metadata: metadata(release), asset: { name, size: asset.size, url: expectedURL } };
}
async function download(spec, facts, file) {
  let url = facts.asset.url, response;
  for (let i = 0; i < 6; i++) {
    const parsed = new URL(url);
    assert(parsed.protocol === 'https:' && ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname), 'download_redirect_origin');
    remaining();
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, Math.min(300_000, Math.floor(DEADLINE - performance.now())))) }); // No Authorization on any asset request.
    if (response.status >= 300 && response.status < 400) { url = new URL(response.headers.get('location'), url).href; continue; }
    break;
  }
  assert(response?.ok, 'asset_download_failed');
  const fd = openSync(file, 'wx', 0o600), sha256 = createHash('sha256'), sha512 = createHash('sha512'); let size = 0;
  try {
    const { writeSync } = await import('node:fs');
    for await (const chunk of response.body) {
      remaining(); size += chunk.length; assert(size <= facts.asset.size, 'download_size_overflow'); sha256.update(chunk); sha512.update(chunk);
      for (let offset = 0; offset < chunk.length;) { const n = writeSync(fd, chunk, offset); assert(n > 0, 'download_short_write'); offset += n; }
    }
  } finally { closeSync(fd); }
  const digest = sha256.digest('hex');
  assert(size === facts.asset.size && digest === spec.zipSHA256, 'download_hash_mismatch');
  assert(await fileHash(file) === spec.zipSHA256, 'written_zip_hash_mismatch');
  return { file, size, sha256: digest, sha512: sha512.digest('base64') };
}
async function fileHash(file, algorithm = 'sha256', encoding = 'hex') {
  const before = lstatSync(file); assert(before.isFile() && !before.isSymbolicLink() && before.uid === qaUid, 'file_identity');
  const h = createHash(algorithm); for await (const chunk of createReadStream(file)) { remaining(); h.update(chunk); }
  const after = lstatSync(file); assert(before.ino === after.ino && before.dev === after.dev && before.size === after.size && before.mtimeMs === after.mtimeMs, 'file_changed_during_hash');
  return h.digest(encoding);
}
async function tree(directory) {
  const entries = []; let bytes = 0;
  async function walk(at) {
    remaining(); assert(entries.length < 100_000, 'bundle_entry_bound');
    const st = lstatSync(at), name = relative(directory, at), mode = st.mode & 0o777;
    if (st.isSymbolicLink()) entries.push({ name, kind: 'symlink', target: readlinkSync(at), mode });
    else if (st.isDirectory()) { entries.push({ name, kind: 'directory', mode }); for (const n of readdirSync(at).sort()) await walk(join(at, n)); }
    else { assert(st.isFile(), 'bundle_non_regular'); bytes += st.size; assert(bytes <= 4 * 1024 ** 3, 'bundle_byte_bound'); entries.push({ name, kind: 'file', mode, bytes: st.size, sha256: await fileHash(at) }); }
  }
  await walk(directory); return entries;
}
function feed(bundle) {
  const file = join(bundle, 'Contents', 'Resources', 'app-update.yml'), bytes = readFileSync(file);
  assert(bytes.toString().replace(/\r\n/g, '\n').trim() === 'provider: github\nowner: kaisersong\nrepo: xiaok-cli\nreleaseType: release', 'production_feed_changed');
  return { file, sha256: createHash('sha256').update(bytes).digest('hex') };
}
async function signature(bundle, version, label) {
  const plist = JSON.parse((await command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(bundle, 'Contents', 'Info.plist')])).out);
  assert(plist.CFBundleIdentifier === APP_ID && plist.CFBundleShortVersionString === version && plist.CFBundleExecutable === 'xiaok', 'bundle_identity');
  assert((await command('/usr/bin/lipo', ['-archs', join(bundle, 'Contents', 'MacOS', 'xiaok')])).out.trim() === 'arm64', 'bundle_architecture');
  await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
  const details = await command('/usr/bin/codesign', ['-d', '--verbose=4', bundle]);
  assert(`${details.out}${details.err}`.split('\n').includes(`TeamIdentifier=${TEAM}`), 'signature_team');
  await command('/usr/bin/xcrun', ['stapler', 'validate', bundle]);
  const assess = await command('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', bundle]);
  assert(`${assess.out}${assess.err}`.includes('accepted') && `${assess.out}${assess.err}`.includes('Notarized Developer ID'), 'notarized_assessment');
  const facts = { version, bundle, bundleId: plist.CFBundleIdentifier, team: TEAM, feed: feed(bundle) }; save(`signature-${label}.json`, facts); return facts;
}
async function processes() {
  const { out } = await command('/bin/ps', ['-ww', '-axo', 'pid=,ppid=,pgid=,uid=,lstart=,comm='], { quiet: true, timeout: 5000 });
  return out.split('\n').filter(Boolean).map(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+((?:\S+\s+){4}\S+)\s+(.+)$/.exec(line); assert(m, 'process_snapshot_shape');
    return { pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), uid: Number(m[4]), birth: m[5], executable: m[6] };
  });
}
function cacheRoots() {
  const base = join(qaHome, 'Library', 'Caches');
  return existsSync(base) ? readdirSync(base).filter(n => /xiaok/i.test(n)).map(n => join(base, n)) : [];
}
function profileInventory() {
  const roots = [...cacheRoots(), join(qaHome, 'Library', 'LaunchAgents', `${APP_ID}.ShipIt.plist`), join(qaHome, '.xiaok'), join(qaHome, 'Library', 'Application Support', 'xiaok')];
  const entries = [];
  function walk(file) {
    assert(entries.length < 20_000, 'profile_inventory_bound');
    if (!existsSync(file)) return;
    const st = lstatSync(file); assert(st.uid === qaUid, 'foreign_profile_owner');
    entries.push({ path: file, inode: st.ino, dev: st.dev, mode: st.mode, size: st.size, kind: st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'directory' : 'file' });
    if (st.isDirectory() && !st.isSymbolicLink()) for (const n of readdirSync(file).sort()) walk(join(file, n));
  }
  roots.forEach(walk); return entries;
}
async function sample() {
  const rows = await processes(); latestProcesses = rows;
  for (const row of rows) {
    if (row.uid !== qaUid || row.pid === process.pid) continue;
    const inApp = inside(app, row.executable), descendant = owned.has(row.ppid);
    const inFreshProfile = [join(qaHome, '.xiaok'), join(qaHome, 'Library', 'Application Support', 'xiaok'), join(root, 'user-data')].some(p => inside(p, row.executable));
    const ship = basename(row.executable) === 'ShipIt' && (inApp || inside(join(qaHome, 'Library', 'Caches', `${APP_ID}.ShipIt`), row.executable));
    if (inApp || descendant || ship || inFreshProfile) {
      if (!owned.has(row.pid)) {
        if (ship) assert(shipItSHA256 && await fileHash(row.executable) === shipItSHA256, 'shipit_executable_not_original_signed_helper');
        owned.set(row.pid, { ...row, observedAfterInstallRequest: installedRequest, shipIt: ship, directChild: row.pid === oldChild?.pid }); event('owned-process-observed', owned.get(row.pid));
      }
      else { const previous = owned.get(row.pid); assert(previous.birth === row.birth && previous.executable === row.executable && previous.uid === row.uid, 'owned_pid_identity_changed'); }
    }
  }
  const wrong = rows.filter(p => p.uid === qaUid && basename(p.executable) === 'xiaok' && p.executable.includes('.app/') && p.executable !== appExecutable);
  assert(wrong.length === 0, 'wrong_path_or_multiple_app');
  assert(rows.filter(p => p.uid === qaUid && p.executable === appExecutable).length <= 1, 'multiple_same_path_apps');
}
async function monitor() {
  while (!monitorStopped) { try { await sample(); } catch (e) { monitorError = e; break; } await delay(250); }
}
async function waitFor(predicate, timeout, code) {
  const end = Math.min(DEADLINE, performance.now() + timeout);
  while (performance.now() < end) { remaining(); if (monitorError) throw monitorError; const value = await predicate(); if (value) return value; await delay(500); }
  throw new Error(code);
}
async function listenerOwner(port, expectedPID) {
  const r = await command('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { allowFailure: true, quiet: true, timeout: 5000 });
  const pids = [...new Set(r.out.split('\n').filter(l => /^p\d+$/.test(l)).map(l => Number(l.slice(1))))];
  return pids.length === 1 && pids[0] === expectedPID;
}
async function cdp(port, expectedPID) {
  if (!await listenerOwner(port, expectedPID)) return null;
  let pages; try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json(); } catch { return null; }
  assert(Array.isArray(pages), 'cdp_page_shape');
  const page = pages.find(p => p.type === 'page' && p.url?.startsWith('file:') && fileURLToPath(p.url) === join(app, 'Contents', 'Resources', 'app.asar', 'dist', 'renderer', 'index.html'));
  if (!page) return null;
  const url = new URL(page.webSocketDebuggerUrl); assert(url.protocol === 'ws:' && url.hostname === '127.0.0.1' && Number(url.port) === port, 'cdp_socket_origin');
  const ws = new WebSocket(url); let nextId = 0; const pending = new Map();
  await new Promise((res, rej) => { const t = setTimeout(() => { ws.close(); rej(new Error('cdp_connect_timeout')); }, 5000); ws.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true }); ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('cdp_connect_error')); }, { once: true }); });
  ws.addEventListener('message', e => { const m = JSON.parse(String(e.data)); const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error('cdp_protocol_error')) : p.resolve(m.result); } });
  ws.addEventListener('close', () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('cdp_closed')); } pending.clear(); });
  return { close: () => ws.close(), async evaluate(expression) {
    const id = ++nextId;
    const result = await new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error('cdp_evaluate_timeout')); }, 10_000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, userGesture: true } })); });
    assert(!result.exceptionDetails, 'real_preload_exception'); return result.result?.value;
  } };
}
async function cacheDownload(expected) {
  const matches = [];
  for (const entry of profileInventory()) {
    if (entry.kind !== 'file' || !entry.path.endsWith('.zip') || entry.size !== expected.size) continue;
    if (!cacheRoots().some(r => inside(r, entry.path))) continue;
    const digest = await fileHash(entry.path, 'sha512', 'base64');
    if (digest === expected.sha512) matches.push({ path: entry.path, bytes: entry.size, sha512: digest, sha256: await fileHash(entry.path) });
  }
  assert(matches.length > 0 && matches.every(m => m.sha256 === NEW.zipSHA256), 'actual_updater_cache_hash_missing_or_wrong');
  save('updater-cache-downloads.json', matches);
}
async function cleanup() {
  const failures = [];
  cleaning = true;
  // Stop observing before exact per-PID cleanup; no process-name or group kill.
  monitorStopped = true; if (monitorPromise) await monitorPromise;
  if (monitorError) failures.push({ reason: monitorError.message });
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (app) { try { await sample(); } catch (e) { failures.push({ reason: e.message }); } }
    for (const record of [...owned.values()].reverse()) {
      const live = (await processes()).find(p => p.pid === record.pid); if (!live) continue;
      if (live.uid !== record.uid || live.birth !== record.birth || live.executable !== record.executable) { failures.push({ pid: record.pid, reason: 'identity_changed_not_signaled' }); continue; }
      try { process.kill(record.pid, signal); event('cleanup-signal', { ...record, signal, directChildWaitClaim: record.directChild, adoptedProcessReapClaim: false }); }
      catch (e) { if (e.code !== 'ESRCH') failures.push({ pid: record.pid, reason: e.code ?? e.message }); }
    }
    await delay(2000);
  }
  if (app) { try { await sample(); } catch (e) { failures.push({ reason: e.message }); } }
  const after = await processes();
  const residual = after.filter(p => owned.has(p.pid));
  const facts = { failures, residual, directAppExited: oldChild ? oldChild.exitCode !== null : null,
    directAppCloseObserved: Boolean(oldChild?.qaClosed), adoptedProcessesReapedByRunner: false,
    profile: profileInventory(), externalApplications: externalApplications() };
  save('cleanup.json', facts);
  const shipItLogs = [];
  for (const name of ['ShipIt_stdout.log', 'ShipIt_stderr.log']) {
    const file = join(qaHome, 'Library', 'Caches', `${APP_ID}.ShipIt`, name);
    if (!existsSync(file)) { shipItLogs.push({ file, exists: false }); continue; }
    const st = lstatSync(file); assert(st.isFile() && !st.isSymbolicLink() && st.uid === qaUid && st.size <= 4 * 1024 * 1024, 'shipit_log_identity_or_bound');
    const bytes = readFileSync(file); writeFileSync(join(evidence, name), bytes, { mode: 0o600 }); shipItLogs.push({ file, exists: true, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  save('shipit-log-capture.json', shipItLogs);
  assert(failures.length === 0 && residual.length === 0 && children.size === 0, 'owned_cleanup_unconfirmed');
  if (oldChild) assert(oldChild.qaClosed, 'direct_app_not_waited_closed');
  assert(externalApplications().every(p => !p.exists), 'external_application_path_changed');
}
function externalApplications() {
  return ['/Applications/xiaok.app', join(qaHome, 'Applications', 'xiaok.app')].map(path => ({ path, exists: existsSync(path) }));
}
async function main() {
  validInputs();
  assert(process.env.GITHUB_SHA === NEW.sha, 'workflow_source_not_published_new_sha');
  assert(platform() === 'darwin' && arch() === 'arm64' && qaUid !== 0, 'arm64_nonroot_mac_required');
  assert(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.env.RUNNER_OS === 'macOS' && process.env.RUNNER_ARCH === 'ARM64', 'disposable_hosted_mac_required');
  const temp = realpathSync(process.env.RUNNER_TEMP); assert(lstatSync(temp).isDirectory() && lstatSync(temp).uid === qaUid, 'runner_temp_owner');
  root = join(temp, 'xiaok-real-upgrade-qa'); mkdirSync(root, { mode: 0o700 }); evidence = join(root, 'evidence'); mkdirSync(evidence, { mode: 0o700 });
  save('inputs.json', { old: OLD, new: NEW, qaCodeSHA: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, root, home: qaHome, uid: qaUid });
  assert((await command('/usr/bin/uname', ['-m'])).out.trim() === 'arm64', 'actual_host_architecture');
  await command('/bin/launchctl', ['print', `gui/${qaUid}`], { quiet: true });
  assert(Number((await command('/usr/bin/stat', ['-f', '%u', '/dev/console'])).out.trim()) === qaUid, 'runner_gui_session_required');
  assert(externalApplications().every(p => !p.exists), 'existing_real_application');
  const beforeProfile = profileInventory(); save('profile-before.json', beforeProfile); assert(beforeProfile.length === 0, 'existing_xiaok_profile_or_shipit');
  const initialProcesses = await processes(); assert(!initialProcesses.some(p => p.uid === qaUid && (basename(p.executable) === 'ShipIt' || (basename(p.executable) === 'xiaok' && p.executable.includes('.app/')))), 'existing_xiaok_or_shipit_process');
  const beforeOld = await releaseFacts(OLD), beforeNew = await releaseFacts(NEW); save('release-before.json', { old: beforeOld, new: beforeNew });
  const oldZip = await download(OLD, beforeOld, join(root, 'old.zip')), newZip = await download(NEW, beforeNew, join(root, 'new-reference.zip'));
  save('downloads.json', { old: oldZip, new: newZip });
  const oldDir = join(root, 'installed'), referenceDir = join(root, 'reference-new'); mkdirSync(oldDir); mkdirSync(referenceDir);
  await command('/usr/bin/ditto', ['-x', '-k', oldZip.file, oldDir], { timeout: 120_000 });
  await command('/usr/bin/ditto', ['-x', '-k', newZip.file, referenceDir], { timeout: 120_000 });
  app = realpathSync(join(oldDir, 'xiaok.app')); const referenceApp = realpathSync(join(referenceDir, 'xiaok.app'));
  assert(inside(oldDir, app) && inside(referenceDir, referenceApp), 'extraction_path_escape'); appExecutable = join(app, 'Contents', 'MacOS', 'xiaok');
  await signature(app, OLD.version, 'old'); await signature(referenceApp, NEW.tag.slice(9), 'new-reference');
  const oldTree = await tree(app), newTree = await tree(referenceApp); save('old-bundle-tree.json', oldTree); save('expected-new-bundle-tree.json', newTree);
  const shipHelpers = oldTree.filter(e => e.kind === 'file' && e.name.endsWith('/Resources/ShipIt') && e.name.includes('/Squirrel.framework/'));
  assert(shipHelpers.length === 1, 'original_signed_shipit_helper_missing'); shipItSHA256 = shipHelpers[0].sha256;
  const port = DEFAULT_CDP_PORT;
  const priorListener = await command('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { allowFailure: true, timeout: 5000 });
  assert(priorListener.code === 1 && priorListener.signal === null && !priorListener.spawnError && !priorListener.timedOut && priorListener.out === '' && priorListener.err === '', 'production_cdp_port_not_proven_vacant');
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve); });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  event('production-default-cdp-preflight', { address: '127.0.0.1', port, noPriorListener: true, bindReleased: true, explicitAppCDPFlags: false });
  const out = openSync(join(evidence, 'app.stdout'), 'wx', 0o600), err = openSync(join(evidence, 'app.stderr'), 'wx', 0o600);
  try { oldChild = spawn(appExecutable, [], { env: cleanEnv(), detached: true, stdio: ['ignore', out, err] }); }
  finally { closeSync(out); closeSync(err); }
  oldChild.qaClosed = false; oldChild.once('close', () => { oldChild.qaClosed = true; }); oldChild.once('error', e => { monitorError = e; }); oldChild.once('exit', (code, signal) => event('direct-old-app-exit', { pid: oldChild.pid, code, signal, waitedReapedByNode: true }));
  monitorPromise = monitor();
  oldIdentity = await waitFor(async () => { await sample(); return owned.get(oldChild.pid); }, 30_000, 'old_app_identity_missing');
  const oldCDP = await waitFor(() => cdp(port, oldIdentity.pid), 120_000, 'runner_gui_old_window_unavailable');
  let downloaded;
  try {
    downloaded = await waitFor(async () => {
      const s = await oldCDP.evaluate('window.xiaokDesktop ? window.xiaokDesktop.getUpdateStatus() : null'); event('real-updater-status', { state: s });
      if (s === null) return false;
      assert(s && s.currentVersion === OLD.version && !s.error, 'old_updater_status_or_error');
      if (s.available) assert(s.version === NEW.tag.slice(9), 'updater_selected_unexpected_version');
      return s.available && s.downloaded === true && s.progress === 100 && s.version === NEW.tag.slice(9) ? s : false;
    }, 12 * 60_000, 'production_update_not_downloaded');
    await cacheDownload(newZip); assert.deepEqual(await tree(app), oldTree, 'old_bundle_changed_before_install');
    assert.deepEqual((await releaseFacts(NEW)).metadata, beforeNew.metadata, 'new_metadata_drift_before_install');
    installedRequest = true; event('one-real-quitAndInstall-request', { oldIdentity });
    try { const response = await oldCDP.evaluate('window.xiaokDesktop.quitAndInstall()'); event('install-ipc-response', { response }); assert(!response?.status || ['pending', 'already_handed_off'].includes(response.status), 'install_ipc_rejected'); }
    catch (e) { if (e.message !== 'cdp_closed') throw e; event('install-ipc-disconnected-during-quit', {}); }
  } finally { oldCDP.close(); }
  await waitFor(async () => oldChild.qaClosed && oldChild.exitCode === 0, 120_000, 'old_app_did_not_exit');
  const restarted = await waitFor(async () => { await sample(); const rows = latestProcesses.filter(p => p.uid === qaUid && p.executable === appExecutable && p.pid !== oldIdentity.pid); assert(rows.length <= 1, 'multiple_relaunched_apps'); return rows[0]; }, 180_000, 'nsworkspace_did_not_relaunch_same_path');
  assert(restarted.ppid !== process.pid && restarted.birth !== oldIdentity.birth, 'not_os_owned_new_launch'); event('os-owned-relaunch-observed', { ...restarted, directlySpawnedByRunner: false, reapClaim: false });
  assert([...owned.values()].some(p => p.shipIt), 'shipit_identity_not_observed');
  const newCDP = await waitFor(() => cdp(port, restarted.pid), 120_000, 'relaunched_app_production_default_cdp_unavailable');
  let current;
  try {
    const observed = await waitFor(async () => {
      const state = await newCDP.evaluate('window.xiaokDesktop ? window.xiaokDesktop.getUpdateStatus() : null');
      if (state === null) return false;
      assert(state.currentVersion === NEW.tag.slice(9) && !state.error, 'new_actual_version_or_error');
      const page = await newCDP.evaluate('({ready:document.readyState,visible:document.body.getBoundingClientRect().width>0&&document.body.getBoundingClientRect().height>0})');
      return page.ready === 'complete' && page.visible ? { state, page } : false;
    }, 30_000, 'new_first_window_not_ready');
    current = observed.state; save('new-actual-preload-state.json', { ...observed, restarted });
  }
  finally { newCDP.close(); }
  const mainLog = readFileSync(join(evidence, 'app.stdout'), 'utf8'); assert(mainLog.includes('updater:install-wrapper-entered') && mainLog.includes('updater:before-quit'), 'real_handoff_markers_missing');
  await signature(app, NEW.tag.slice(9), 'actually-upgraded'); const actualTree = await tree(app); save('actual-upgraded-bundle-tree.json', actualTree); assert.deepEqual(actualTree, newTree, 'upgraded_bundle_differs_from_published_zip');
  const afterOld = await releaseFacts(OLD), afterNew = await releaseFacts(NEW); save('release-after.json', { old: afterOld, new: afterNew });
  assert.deepEqual(afterOld.metadata, beforeOld.metadata, 'old_release_drift'); assert.deepEqual(afterNew.metadata, beforeNew.metadata, 'new_release_drift');
  resultFacts = { downloaded, current, oldIdentity, restarted, actualSamePathReplacement: true, treeMatchesPublishedNewZIP: true, productionFeedUnchanged: true, oneInstallRequest: true };
}
try { await main(); if (monitorError) throw monitorError; } catch (e) { primary = { message: e.message, stack: e.stack }; }
finally {
  if (evidence) {
    try { await cleanup(); } catch (e) { primary ??= { message: e.message, stack: e.stack }; event('cleanup-failed', { message: e.message }); }
    save('RESULT.json', { status: primary ? 'FAIL' : 'PASS_REAL_SIGNED_MAC_SHIPIT_UPGRADE', failure: primary ?? null, old: OLD, new: NEW, facts: resultFacts,
      elapsedSeconds: (performance.now() - START) / 1000, noProductBuildOrCopyReplacement: true, noFeedOverride: true, noModelSDKCUAGoalTask: true,
      profileDisposition: 'Retained until hosted disposable VM destruction; artifacts contain evidence only, not app binaries or caches.',
      notClaimed: ['Windows', 'Goal14', 'CUA3', 'held native qualification', 'signing or publication', 'reap of launchd-owned processes'] });
  }
}
if (primary) { console.error(primary.message); process.exitCode = 1; }

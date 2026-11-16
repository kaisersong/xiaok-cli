// QA only: no build, feed override, app replacement, signing or publication.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants, createReadStream, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  chmodSync, mkdtempSync, rmSync,
  readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, arch, platform, tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const REPO = 'kaisersong/xiaok-cli';
const APP_ID = 'com.xiaok.desktop';
const TEAM = 'Y9YR86UG94';
const DEFAULT_CDP_PORT = 9222; // QA explicitly opts the old app in; packaged apps no longer default to CDP.
const OLD14 = Object.freeze({ tag: 'desktop-v1.5.14', version: '1.5.14', release: 418149835,
  sha: 'dc221f9bac84d939b8fb543d4795396693fdc9b8', bytes: 228655718,
  zipSHA256: 'b7a3b6d6e23b5423d581f8b93ad05b82b34fc0fab429c14ea4c9736d358ebf37' });
const OLD15 = Object.freeze({ tag: 'desktop-v1.5.15', version: '1.5.15', release: 419987808,
  sha: '6770092945a42fb0e45ef0d68d0971bfc01b51a8', bytes: 231833178,
  zipSHA256: '1e6e73ca880994d6c7f23ef4919b020099e350702581040113beeb43779cc3c9' });
const OLD163 = Object.freeze({ tag: 'desktop-v1.6.3', version: '1.6.3', release: 444569883,
  sha: 'c453f03691cd5d10e07c486d3338b2fd810e30ae', bytes: 283759026,
  zipSHA256: '9d5713a2489ec9fb7c4fc85ee0fb874a64590e08882897ec8d2fb5b4c8d698ff' });
function selectOldPreset(version = '1.5.14') {
  if (version === '1.5.14') return OLD14;
  if (version === '1.5.15') return OLD15;
  if (version === '1.6.3') return OLD163;
  assert.fail('old_version_not_allowed');
}
const OLD = selectOldPreset(process.env.QA_OLD_VERSION);
function canonicalVersion(version) {
  assert(typeof version === 'string' && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version), 'version_not_canonical');
  const parts = version.split('.').map(Number);
  assert(parts.every(Number.isSafeInteger), 'version_integer_not_exact'); return parts;
}
function assertNewerVersion(next, previous) {
  const newer = canonicalVersion(next), older = canonicalVersion(previous), index = newer.findIndex((part, i) => part !== older[i]);
  assert(index >= 0 && newer[index] > older[index], 'new_version_must_follow_selected_old');
}
const NEW = Object.freeze({ tag: process.env.QA_NEW_TAG, sha: process.env.QA_NEW_SHA,
  release: process.env.QA_NEW_RELEASE_ID, zipSHA256: process.env.QA_NEW_ZIP_SHA256 });
function userQuitMode(raw) { assert(raw === undefined || raw === 'false' || raw === 'true', 'invalid_user_quit_mode'); return raw === 'true'; }
const GRACEFUL_USER_QUIT = userQuitMode(process.env.QA_GRACEFUL_USER_QUIT);
const profileEntryLimit = graceful => graceful ? 100_000 : 20_000;
const START = performance.now();
const DEADLINE = START + 25 * 60_000; // New QA budget, not a product timeout change.
const qaUid = process.getuid?.();
const qaHome = homedir();
const owned = new Map();
const pendingTerminal = new Map();
const pendingComm = new Map();
const pendingChildren = new Map();
const pendingFirstSeen = new Map();
let acceptedUserQuit = false;
const children = new Set();
let root, evidence, app, appExecutable, oldChild, oldIdentity, monitorPromise;
let monitorStopped = false, monitorError, latestGuiApplications = [], installedRequest = false;
let primary, resultFacts = {}, commandId = 0, cleaning = false, shipItSHA256, newShipItSHA256, qaSourceBinding;
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
  assertNewerVersion(NEW.tag.slice(9), OLD.version);
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
function parseProcessSnapshot(out) {
  return out.split('\n').filter(Boolean).map(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+((?:\S+\s+){4}\S+)\s+(\S+)\s+(.+)$/.exec(line); assert(m, 'process_snapshot_shape');
    return { pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), uid: Number(m[4]), birth: m[5], state: m[6], executable: m[7] };
  });
}
async function processes() {
  const { out } = await command('/bin/ps', ['-ww', '-axo', 'pid=,ppid=,pgid=,uid=,lstart=,stat=,comm='], { quiet: true, timeout: 5000 });
  return parseProcessSnapshot(out);
}
function terminalPlaceholder(row) {
  return typeof row?.state === 'string' && /^Z/.test(row.state) &&
    (row.executable === '<defunct>' || /^\([^()/]+\)$/.test(row.executable));
}
function knownTerminalSnapshot(previous, current) {
  return Boolean(previous && current && isAbsolute(previous.executable) && previous.pid === current.pid &&
    previous.uid === current.uid && previous.birth === current.birth && terminalPlaceholder(current));
}
function residualProcesses(rows) { return rows.filter(row => owned.has(row.pid) || pendingTerminal.has(row.pid) || pendingComm.has(row.pid) || pendingChildren.has(row.pid) || pendingFirstSeen.has(row.pid)); }
function cacheRoots() {
  const base = join(qaHome, 'Library', 'Caches');
  return existsSync(base) ? readdirSync(base).filter(n => /xiaok/i.test(n)).map(n => join(base, n)) : [];
}
function profileInventory() {
  const roots = [...cacheRoots(), join(qaHome, 'Library', 'LaunchAgents', `${APP_ID}.ShipIt.plist`), join(qaHome, '.xiaok'), join(qaHome, 'Library', 'Application Support', 'xiaok')];
  const entries = [];
  function walk(file) {
    assert(entries.length < profileEntryLimit(GRACEFUL_USER_QUIT), 'profile_inventory_bound');
    if (!existsSync(file)) return;
    const st = lstatSync(file); assert(st.uid === qaUid, 'foreign_profile_owner');
    entries.push({ path: file, inode: st.ino, dev: st.dev, mode: st.mode, size: st.size, kind: st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'directory' : 'file' });
    if (st.isDirectory() && !st.isSymbolicLink()) for (const n of readdirSync(file).sort()) walk(join(file, n));
  }
  roots.forEach(walk); return entries;
}
function officialShipItRole(actual, phase) {
  if (![actual, phase.oldReferenceSHA256, phase.newReferenceSHA256].every(value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value))) return null;
  if (actual === phase.oldReferenceSHA256) return 'old-reference';
  const exited = phase.oldExit;
  if (actual === phase.newReferenceSHA256 && phase.installedRequest === true && phase.originalHelperAfterRequest === true &&
      exited?.directAppExited === true && exited.directAppCloseObserved === true &&
      exited.directAppExitCode === 0 && exited.directAppSignal === null) return 'new-reference';
  return null;
}
function officialShipItPath(executable) {
  return isAbsolute(executable) && basename(executable) === 'ShipIt' &&
    (inside(app, executable) || inside(join(qaHome, 'Library', 'Caches', `${APP_ID}.ShipIt`), executable));
}
async function verifyOfficialShipItFile(row) {
  assert(diagnosticEvent('shipit-file-scope-observed', { current: row, pathScoped: officialShipItPath(row.executable),
    expectedUID: qaUid, signalAuthorized: false }), 'shipit_scope_evidence_unconfirmed');
  assert(row.uid === qaUid && officialShipItPath(row.executable), 'shipit_path_or_uid_not_scoped');
  const actual = await fileHash(row.executable);
  const phase = { oldReferenceSHA256: shipItSHA256, newReferenceSHA256: newShipItSHA256, installedRequest,
    originalHelperAfterRequest: [...owned.values()].some(p => p.shipIt && p.uid === qaUid && officialShipItPath(p.executable) && p.shipItFileRole === 'old-reference' &&
      p.shipItFileSHA256 === shipItSHA256 && p.observedAfterInstallRequest === true), oldExit: directAppExitFacts(oldChild) };
  const role = officialShipItRole(actual, phase);
  assert(diagnosticEvent('official-shipit-file-observed', { current: row, actualFileSHA256: actual,
    phase, role: role ?? 'rejected', kernelMemoryHashClaim: false, signalAuthorized: false }), 'shipit_digest_evidence_unconfirmed');
  assert(role, 'shipit_file_not_authorized_for_handoff_phase');
  return { shipItFileRole: role, shipItFileSHA256: actual };
}
function postQuitUnconfirmedImage(previous, current, context) {
  return Boolean(context.graceful === true && context.accepted === true && context.installRequested === true &&
    previous && current && isAbsolute(previous.executable) && inside(app, previous.executable) &&
    previous.pid === current.pid && previous.uid === current.uid && previous.birth === current.birth &&
    !String(current.state ?? '').startsWith('Z') &&
    current.executable === `(${basename(previous.executable)})`);
}
async function observeOwnedProcesses(rows, phase, { readProcesses = processes,
  quitContext = { graceful: GRACEFUL_USER_QUIT, accepted: acceptedUserQuit, installRequested: installedRequest } } = {}) {
  for (const row of rows) {
    if (row.pid === process.pid) continue;
    const firstSeen = pendingFirstSeen.get(row.pid);
    if (firstSeen) assert(row.uid === firstSeen.uid && row.birth === firstSeen.birth, 'pending_first_seen_pid_changed');
    if (row.uid !== qaUid) continue;
    const inApp = inside(app, row.executable), descendant = owned.has(row.ppid) && !pendingComm.has(row.ppid) && !pendingFirstSeen.has(row.ppid) && !pendingTerminal.has(row.ppid) && !pendingChildren.has(row.ppid);
    const inFreshProfile = [join(qaHome, '.xiaok'), join(qaHome, 'Library', 'Application Support', 'xiaok'), join(root, 'user-data')].some(p => inside(p, row.executable));
    const ship = basename(row.executable) === 'ShipIt' && (inApp || inside(join(qaHome, 'Library', 'Caches', `${APP_ID}.ShipIt`), row.executable));
    if (firstSeen) {
      // No ownership exists yet. Admit only independently scoped, stable full images.
      let freshOne, freshTwo;
      if (isAbsolute(row.executable) && /^[RSIUT]/.test(row.state) && (inApp || ship || inFreshProfile)) {
        const helperFacts = ship ? await verifyOfficialShipItFile(row) : {};
        freshOne = (await readProcesses()).find(p => p.pid === row.pid);
        if (freshOne) {
          assert(freshOne.uid === firstSeen.uid && freshOne.birth === firstSeen.birth, 'pending_first_seen_pid_changed');
          freshTwo = (await readProcesses()).find(p => p.pid === row.pid);
          if (freshTwo) assert(freshTwo.uid === firstSeen.uid && freshTwo.birth === firstSeen.birth, 'pending_first_seen_pid_changed');
        }
        if (sameProcessIdentity(row, freshOne) && sameProcessIdentity(freshOne, freshTwo) &&
            /^[RSIUT]/.test(freshOne.state) && /^[RSIUT]/.test(freshTwo.state)) {
          assert(diagnosticEvent('first-seen-full-image-confirmed', { firstSeen, current: row, freshOne, freshTwo,
            independentScope: true, signalSent: false, reaped: false }), 'first_seen_admission_evidence_unconfirmed');
          owned.set(row.pid, { ...freshTwo, observedAfterInstallRequest: installedRequest, shipIt: ship, directChild: false, ...helperFacts });
          pendingFirstSeen.delete(row.pid); pendingChildren.delete(row.pid); continue;
        }
      }
      assert(diagnosticEvent('first-seen-image-still-unconfirmed', { firstSeen, current: row,
        freshOne: freshOne ?? null, freshTwo: freshTwo ?? null, authorityGranted: false,
        signalAuthorized: false, reaped: false }), 'first_seen_observation_evidence_unconfirmed');
      continue;
    }
    if (!owned.has(row.pid) && (pendingComm.has(row.ppid) || pendingFirstSeen.has(row.ppid) || pendingTerminal.has(row.ppid) || pendingChildren.has(row.ppid)) && !inApp && !ship && !inFreshProfile) {
      assert(diagnosticEvent('child-of-unconfirmed-image-observed', { current: row, authorityGranted: false,
        signalAuthorized: false, reaped: false }), 'pending_child_evidence_unconfirmed');
      pendingChildren.set(row.pid, { ...row }); continue;
    }
    if (owned.has(row.pid) || pendingComm.has(row.pid) || inApp || descendant || ship || inFreshProfile) {
      if (terminalPlaceholder(row)) {
        const previous = owned.get(row.pid);
        if (previous && !knownTerminalSnapshot(previous, row)) {
          identityConflict(previous, row, phase, 'owned_pid_identity_changed'); assert.fail('owned_pid_identity_changed');
        }
        pendingTerminal.set(row.pid, { ...row });
        event('terminal-awaiting-reap-observed', { previous: previous ?? null, current: row, authorityGranted: false, reaped: false });
        continue;
      }
      if (!owned.has(row.pid)) {
        if (!isAbsolute(row.executable)) {
          const terminal = String(row.state ?? '').startsWith('Z');
          assert(diagnosticEvent('first-seen-image-unconfirmed', { current: row, terminalStateConfirmed: terminal,
            authorityGranted: false, signalAuthorized: false, reaped: false }), 'first_seen_evidence_unconfirmed');
          if (terminal) { pendingTerminal.set(row.pid, { ...row }); continue; }
          assert(pendingFirstSeen.size < 4096, 'first_seen_pending_bound');
          pendingFirstSeen.set(row.pid, { ...row }); continue;
        }
        const helperFacts = ship ? await verifyOfficialShipItFile(row) : {};
        owned.set(row.pid, { ...row, observedAfterInstallRequest: installedRequest, shipIt: ship, directChild: row.pid === oldChild?.pid, ...helperFacts }); pendingChildren.delete(row.pid); event('owned-process-observed', owned.get(row.pid));
      }
      else {
        const previous = owned.get(row.pid);
        let current = row;
        if (!sameProcessIdentity(previous, current)) {
          const rechecked = await recheckParenthesizedComm(previous, current, readProcesses);
          if (rechecked.kind === 'absent') continue;
          if (rechecked.kind === 'restored') current = rechecked.current;
          else if (postQuitUnconfirmedImage(previous, current, quitContext) &&
              postQuitUnconfirmedImage(previous, rechecked.current, quitContext)) {
            const observation = { previous, first: current, current: rechecked.current, phase,
              authorityGranted: false, signalAuthorized: false, terminalStateConfirmed: false, reaped: false };
            if (diagnosticEvent('post-user-quit-image-unconfirmed', observation)) {
              pendingComm.set(row.pid, observation); continue;
            }
          }
        }
        const matches = sameProcessIdentity(previous, current);
        if (!matches) identityConflict(previous, current, phase, 'owned_pid_identity_changed');
        assert(matches, 'owned_pid_identity_changed');
        pendingComm.delete(row.pid);
      }
    }
  }
  const wrong = rows.filter(p => p.uid === qaUid && basename(p.executable) === 'xiaok' && p.executable.includes('.app/') && p.executable !== appExecutable);
  assert(wrong.length === 0, 'wrong_path_or_multiple_app');
}
async function sample(phase) {
  const before = await processes(); await observeOwnedProcesses(before, phase);
  const applications = await registeredApplications();
  const after = await processes(); await observeOwnedProcesses(after, phase);
  latestGuiApplications = selectGuiApplications(applications, before, after, { uid: qaUid, bundle: app, executable: appExecutable });
  event('gui-identity-crosschecked', { applications: latestGuiApplications });
}
const QA_PATHS = Object.freeze(['.github/workflows/macos-real-upgrade-qa.yml', 'scripts/qa/macos-real-upgrade.mjs']);
const gitBlobOID = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
function assertQaCommit(actual, github, workflow) {
  assert(/^[0-9a-f]{40}$/.test(actual) && actual === github && actual === workflow, 'qa_checkout_workflow_sha_mismatch');
}
function parseGitTree(text) {
  assert(text.endsWith('\0'), 'git_tree_shape');
  const entries = new Map();
  for (const line of text.slice(0, -1).split('\0')) {
    const match = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]{40})\t(.+)$/.exec(line);
    assert(match && !entries.has(match[4]), 'git_tree_shape');
    entries.set(match[4], { mode: match[1], type: match[2], oid: match[3] });
  }
  return entries;
}
function compareQaTrees(product, qa) {
  const changed = [];
  for (const path of [...new Set([...product.keys(), ...qa.keys()])].sort()) {
    const before = product.get(path), after = qa.get(path);
    if (QA_PATHS.includes(path)) {
      for (const entry of [before, after]) assert(entry?.mode === '100644' && entry.type === 'blob', 'qa_regular_blob_required');
      if (before.oid !== after.oid) changed.push(path);
    } else assert.deepEqual(after, before, `non_qa_tree_changed:${path}`);
  }
  assert.deepEqual(changed, QA_PATHS, 'exact_two_qa_modifications_required');
  return { changed, nonQaEntries: [...qa].filter(([path]) => !QA_PATHS.includes(path)).sort(([a], [b]) => a.localeCompare(b)) };
}
function checkedQaFile(file, expected) {
  const signature = stat => ['dev', 'ino', 'uid', 'nlink', 'mode', 'size', 'mtimeNs', 'ctimeNs'].map(k => String(stat[k])).join(':');
  const before = lstatSync(file, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink() && (before.mode & 0o7777n) === 0o644n && Number(before.uid) === qaUid && realpathSync(file) === file, 'qa_checkout_regular_mode');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    assert.equal(signature(fstatSync(fd, { bigint: true })), signature(before), 'qa_checkout_identity_changed');
    const bytes = readFileSync(fd), oid = gitBlobOID(bytes);
    assert.equal(signature(fstatSync(fd, { bigint: true })), signature(before), 'qa_checkout_identity_changed');
    assert.equal(signature(lstatSync(file, { bigint: true })), signature(before), 'qa_checkout_identity_changed');
    assert.equal(realpathSync(file), file, 'qa_checkout_identity_changed');
    assert.equal(oid, expected.oid, 'qa_checkout_blob_mismatch');
    return { file, blobOID: oid, sha256: createHash('sha256').update(bytes).digest('hex'), stableIdentity: signature(before), mode: '100644' };
  } finally { closeSync(fd); }
}
async function bindQaSource() {
  const git = async args => (await command('/usr/bin/git', args)).out.trimEnd();
  const qaSHA = await git(['rev-parse', 'HEAD']); assertQaCommit(qaSHA, process.env.GITHUB_SHA, process.env.GITHUB_WORKFLOW_SHA);
  const checkout = realpathSync(await git(['rev-parse', '--show-toplevel']));
  assert(fileURLToPath(import.meta.url) === join(checkout, QA_PATHS[1]), 'qa_executed_script_not_checkout');
  const origin = await git(['remote', 'get-url', 'origin']);
  assert(['https://github.com/kaisersong/xiaok-cli', 'https://github.com/kaisersong/xiaok-cli.git'].includes(origin), 'qa_origin_not_fixed_repo');
  assert(/^[0-9a-f]{40}$/.test(NEW.sha), 'full_new_sha_required');
  await git(['fetch', '--no-tags', '--depth=1', 'origin', NEW.sha]);
  assert.equal(await git(['cat-file', '-t', NEW.sha]), 'commit', 'product_commit_required');
  // Keep the NUL terminator: trimming the raw tree would destroy the parser boundary.
  const productRaw = (await command('/usr/bin/git', ['ls-tree', '-r', '-z', '--full-tree', NEW.sha])).out;
  const qaRaw = (await command('/usr/bin/git', ['ls-tree', '-r', '-z', '--full-tree', qaSHA])).out;
  const product = parseGitTree(productRaw), qa = parseGitTree(qaRaw), bridge = compareQaTrees(product, qa);
  const files = QA_PATHS.map(path => checkedQaFile(join(checkout, path), qa.get(path)));
  assert.equal(await git(['rev-parse', 'HEAD']), qaSHA, 'qa_head_changed');
  const proof = { qaSHA, githubSHA: process.env.GITHUB_SHA, workflowSHA: process.env.GITHUB_WORKFLOW_SHA, productSHA: NEW.sha,
    origin, changedPaths: bridge.changed, actualCheckoutFiles: files, nonQaTreeSHA256: createHash('sha256').update(JSON.stringify(bridge.nonQaEntries)).digest('hex'),
    productTreeOutputSHA256: createHash('sha256').update(productRaw).digest('hex'), qaTreeOutputSHA256: createHash('sha256').update(qaRaw).digest('hex'),
    claim: 'All non-QA path/mode/type/blob tuples equal; actual checked-out QA bytes equal the QA-head blobs. Not whole-tree equality or upgrade qualification.' };
  save('qa-source-binding.json', proof); return proof;
}
function parseApplications(text) {
  const rows = JSON.parse(text); assert(Array.isArray(rows), 'gui_snapshot_shape');
  for (const row of rows) {
    assert(row && Number.isSafeInteger(row.pid) && row.pid > 0 && typeof row.terminated === 'boolean' &&
      ['bundleIdentifier', 'bundleURL', 'executableURL'].every(k => row[k] === null || typeof row[k] === 'string'), 'gui_snapshot_shape');
  }
  return rows;
}
function selectGuiApplications(applications, before, after, expected) {
  const matched = [], seen = new Set();
  for (const application of applications) {
    if (application.terminated) continue;
    if (application.bundleIdentifier !== APP_ID && application.bundleURL !== expected.bundle && application.executableURL !== expected.executable) continue;
    const first = before.find(p => p.pid === application.pid), current = after.find(p => p.pid === application.pid);
    if (!first || !current) continue; // Stale/start/exit race: not a positive ready or duplicate identity.
    assert(first.uid === current.uid && first.birth === current.birth && first.executable === current.executable, 'gui_ps_identity_changed');
    assert(current.uid === expected.uid && current.executable === expected.executable && application.bundleIdentifier === APP_ID &&
      application.bundleURL === expected.bundle && application.executableURL === expected.executable, 'gui_application_identity');
    assert(!seen.has(current.pid), 'duplicate_application_registration'); seen.add(current.pid);
    matched.push({ ...current, application });
  }
  assert(matched.length <= 1, 'multiple_same_path_apps');
  return matched;
}
async function registeredApplications() {
  const source = `ObjC.import('AppKit');
function nullable(value) { if (value === null || value === undefined) return null; const text = ObjC.unwrap(value); return typeof text === 'string' ? text : null; }
const apps = $.NSWorkspace.sharedWorkspace.runningApplications, rows = [];
for (let i = 0; i < apps.count; i++) {
  const app = apps.objectAtIndex(i), bundle = app.bundleURL, executable = app.executableURL;
  rows.push({ pid: Number(app.processIdentifier), terminated: Boolean(app.isTerminated), bundleIdentifier: nullable(app.bundleIdentifier),
    bundleURL: bundle ? nullable(bundle.path) : null, executableURL: executable ? nullable(executable.path) : null });
}
JSON.stringify(rows);`;
  const observed = await command('/usr/bin/osascript', ['-l', 'JavaScript', '-e', source], { quiet: true, timeout: 5000 });
  const rows = parseApplications(observed.out);
  event('running-applications-observed', { commandId: observed.id, applications: rows }); return rows;
}
function relaunchedGui(applications, previous, runnerPID) {
  const rows = applications.filter(p => p.pid !== previous.pid);
  assert(rows.length <= 1, 'multiple_relaunched_apps');
  const row = rows[0];
  if (row) assert(row.ppid !== runnerPID && row.birth !== previous.birth, 'not_os_owned_new_launch');
  return row;
}

function gracefulQuitTargetMatches(expected, current, application) {
  return sameProcessIdentity(expected, current) && Boolean(application && !application.terminated &&
    application.pid === expected.pid && application.bundleIdentifier === expected.bundleIdentifier &&
    application.bundleURL === expected.bundle && application.executableURL === expected.executable);
}
function parseQuitProcessRow(text) {
  const match = /^\s*(\d+)\s+(\d+)\s+((?:\S+\s+){4}\S+)\s+(.+)$/.exec(text.trim());
  if (!match || text.trim().includes('\n')) throw new Error('quit_process_snapshot_shape');
  return { pid: Number(match[1]), uid: Number(match[2]), birth: match[3], executable: match[4] };
}
async function requestGracefulUserQuit(identity) {
  assert(GRACEFUL_USER_QUIT && installedRequest && sameProcessIdentity(identity, owned.get(identity.pid)), 'user_quit_not_authorized');
  const expected = { ...identity, bundle: app, bundleIdentifier: APP_ID };
  const source = `ObjC.import('AppKit'); ObjC.import('Foundation');
${sameProcessIdentity.toString()}
${gracefulQuitTargetMatches.toString()}
${parseQuitProcessRow.toString()}
const expected = ${JSON.stringify(expected)};
const applications = $.NSWorkspace.sharedWorkspace.runningApplications, matching = [];
for (let i = 0; i < applications.count; i++) { const a = applications.objectAtIndex(i); if (Number(a.processIdentifier) === expected.pid) matching.push(a); }
if (matching.length !== 1) throw new Error('user_quit_app_not_unique');
const application = matching[0];
const task = $.NSTask.alloc.init, pipe = $.NSPipe.pipe;
task.launchPath = '/bin/ps'; task.arguments = ['-ww', '-p', String(expected.pid), '-o', 'pid=,uid=,lstart=,comm=']; task.standardOutput = pipe;
task.launch; const data = pipe.fileHandleForReading.readDataToEndOfFile; task.waitUntilExit;
if (Number(task.terminationStatus) !== 0) throw new Error('user_quit_ps_failed');
const current = parseQuitProcessRow(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)));
const facts = { pid: Number(application.processIdentifier), terminated: Boolean(application.isTerminated), bundleIdentifier: ObjC.unwrap(application.bundleIdentifier), bundleURL: ObjC.unwrap(application.bundleURL.path), executableURL: ObjC.unwrap(application.executableURL.path) };
if (!gracefulQuitTargetMatches(expected, current, facts)) throw new Error('user_quit_identity_mismatch');
const accepted = Boolean(application.terminate);
JSON.stringify({ accepted, current, application: facts, forced: false, signalSent: false });`;
  const receipt = await command('/usr/bin/osascript', ['-l', 'JavaScript', '-e', source], { timeout: 5000 });
  const result = JSON.parse(receipt.out); assert(result.accepted === true && result.forced === false && result.signalSent === false, 'user_quit_not_accepted');
  acceptedUserQuit = true;
  event('normal-user-quit-requested', result);
}
async function monitor() {
  while (!monitorStopped) { try { await sample('monitor'); } catch (e) { monitorError = e; break; } await delay(250); }
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

const qaDiagnostics = [];
function diagnosticError(phase, error) {
  qaDiagnostics.push({ phase, message: error?.message ?? String(error), stack: error?.stack ?? null });
}
function diagnosticSave(name, value) {
  try { save(name, value); } catch (error) { diagnosticError(`save:${name}`, error); }
}
function diagnosticEvent(kind, value) {
  try { event(kind, value); return true; } catch (error) { diagnosticError(`event:${kind}`, error); return false; }
}
function sameProcessIdentity(previous, current) {
  return Boolean(previous && current && previous.pid === current.pid && previous.uid === current.uid &&
    previous.birth === current.birth && previous.executable === current.executable);
}
async function recheckParenthesizedComm(previous, current, readProcesses = processes) {
  const candidate = previous && current && previous.pid === current.pid && previous.uid === current.uid &&
    previous.birth === current.birth && isAbsolute(previous.executable) && /^\([^()/]+\)$/.test(current.executable);
  if (!candidate) return { kind: 'not-candidate' };
  const fresh = (await readProcesses()).find(row => row.pid === previous.pid);
  const kind = !fresh ? 'absent' : sameProcessIdentity(previous, fresh) ? 'restored' : 'unconfirmed';
  if (!diagnosticEvent('owned-comm-snapshot-rechecked', { previous, current, fresh: fresh ?? null, outcome: kind, signalAuthorized: false })) {
    return { kind: 'unconfirmed' };
  }
  return { kind, current: fresh };
}
function identityConflict(previous, current, phase, reason) {
  diagnosticEvent('owned-identity-conflict', { previous: previous ?? null, current: current ?? null, phase, reason, installedRequest,
    comparisons: { pid: previous?.pid === current?.pid, uid: previous?.uid === current?.uid,
      birth: previous?.birth === current?.birth, executable: previous?.executable === current?.executable } });
}
async function signalOwnedProcess(record, requestedSignal, { readProcesses = processes, sendSignal = (pid, signal) => process.kill(pid, signal) } = {}) {
  let live = (await readProcesses()).find(p => p.pid === record.pid);
  if (!live) return { kind: 'absent', pid: record.pid };
  if (sameProcessIdentity(record, owned.get(record.pid)) && knownTerminalSnapshot(record, live)) {
    pendingTerminal.set(live.pid, { ...live });
    if (!diagnosticEvent('terminal-awaiting-reap-not-signalled', { current: live, signalSent: false, reaped: false })) {
      return { kind: 'rejected', failure: { pid: record.pid, reason: 'terminal_evidence_unconfirmed' } };
    }
    return { kind: 'terminal-awaiting-reap', pid: record.pid };
  }
  if (!sameProcessIdentity(record, live)) {
    const rechecked = await recheckParenthesizedComm(record, live, readProcesses);
    if (rechecked.kind === 'absent') return { kind: 'absent', pid: record.pid };
    if (rechecked.kind === 'restored') live = rechecked.current;
  }
  const known = owned.get(record.pid);
  if (!sameProcessIdentity(record, known) || !sameProcessIdentity(record, live)) {
    identityConflict(record, live, 'cleanup', 'identity_changed_not_signaled');
    return { kind: 'rejected', failure: { pid: record.pid, reason: 'identity_changed_not_signaled' } };
  }
  const special = (primary !== undefined || monitorError !== undefined) && !installedRequest && record.pid === oldChild?.pid;
  if (special && (!oldIdentity || !sameProcessIdentity(record, oldIdentity) || oldIdentity.pid !== oldChild.pid ||
      record.uid !== qaUid || record.executable !== appExecutable)) {
    identityConflict(oldIdentity, live, 'cleanup', 'failure_old_gui_identity_unconfirmed');
    return { kind: 'rejected', failure: { pid: record.pid, reason: 'failure_old_gui_identity_unconfirmed' } };
  }
  const signal = special ? 'SIGKILL' : requestedSignal;
  try {
    // No await or I/O between this fresh identity decision and the exact per-PID signal.
    assert(sendSignal(record.pid, signal) === true, 'signal_dispatch_unconfirmed');
    const recorded = diagnosticEvent('cleanup-signal', { ...record, signal, directChildWaitClaim: record.directChild, adoptedProcessReapClaim: false });
    if (special) diagnosticEvent('failure-old-gui-hard-stop', { previous: oldIdentity, current: live, requestedSignal, signal,
      phase: 'cleanup', installedRequest, primary: primary?.message ?? null, monitorError: monitorError?.message ?? null,
      signalSent: true, normalExitClaim: false, upgradeSuccessClaim: false });
    return { kind: 'signalled', pid: record.pid, signal, ...(recorded ? {} : { failure: { pid: record.pid, reason: 'signal_evidence_unconfirmed' } }) };
  } catch (error) {
    if (special) diagnosticEvent('failure-old-gui-hard-stop', { previous: oldIdentity, current: live, requestedSignal, signal,
      phase: 'cleanup', installedRequest, signalSent: false, reason: error.code ?? error.message, normalExitClaim: false, upgradeSuccessClaim: false });
    return { kind: error.code === 'ESRCH' ? 'absent' : 'signal-error', pid: record.pid,
      ...(error.code === 'ESRCH' ? {} : { failure: { pid: record.pid, reason: error.code ?? error.message } }) };
  }
}
function successfulCodesign(receipt) {
  return Boolean(receipt && (receipt.spawnError === undefined || receipt.spawnError === null) && receipt.timedOut === false &&
    receipt.code === 0 && receipt.signal === null && receipt.actualWait === true && receipt.reaped === true && receipt.closeObserved === true);
}
function treeDelta(before, after) {
  const old = new Map(before.map(entry => [entry.name, entry])), live = new Map(after.map(entry => [entry.name, entry]));
  const delta = { added: [], removed: [], changed: [] };
  for (const name of [...new Set([...old.keys(), ...live.keys()])].sort()) {
    if (!old.has(name)) delta.added.push(live.get(name));
    else if (!live.has(name)) delta.removed.push(old.get(name));
    else if (JSON.stringify(old.get(name)) !== JSON.stringify(live.get(name))) delta.changed.push({ before: old.get(name), after: live.get(name) });
  }
  return delta;
}
async function assertOldLivePreinstall(oldTree) {
  const live = await tree(app), diagnosticsStart = qaDiagnostics.length;
  diagnosticSave('old-live-preinstall-tree.json', live);
  diagnosticSave('old-live-preinstall-delta.json', treeDelta(oldTree, live));
  let signature;
  try {
    const observed = await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { allowFailure: true });
    const { out, err, ...receipt } = observed;
    signature = { ...receipt, verifiedSuccessfulProcess: successfulCodesign(receipt),
      stdoutFile: `command-${receipt.id}.stdout`, stderrFile: `command-${receipt.id}.stderr`,
      stdoutSHA256: createHash('sha256').update(out).digest('hex'), stderrSHA256: createHash('sha256').update(err).digest('hex') };
  } catch (error) { diagnosticError('old-live-preinstall-codesign', error); signature = { verifiedSuccessfulProcess: false, failure: error.message }; }
  diagnosticSave('old-live-preinstall-signature.json', signature);
  // This original guard deliberately remains primary over all diagnostic failures.
  assert.deepEqual(live, oldTree, 'old_bundle_changed_before_install');
  if (monitorError) throw monitorError;
  assert(signature.verifiedSuccessfulProcess, 'old_live_preinstall_signature_invalid_or_unknown');
  assert(qaDiagnostics.length === diagnosticsStart, 'old_live_preinstall_diagnostic_evidence_unconfirmed');
}

function directAppExitFacts(child) {
  return { directAppExited: child ? Boolean(child.qaClosed) && (child.exitCode !== null || child.signalCode !== null) : null,
    directAppCloseObserved: Boolean(child?.qaClosed), directAppExitCode: child?.exitCode ?? null, directAppSignal: child?.signalCode ?? null };
}
async function cleanup() {
  const failures = [];
  cleaning = true;
  // Stop observing before exact per-PID cleanup; no process-name or group kill.
  monitorStopped = true; if (monitorPromise) await monitorPromise;
  if (monitorError) failures.push({ reason: monitorError.message });
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (app) { try { await sample('cleanup'); } catch (e) { failures.push({ reason: e.message }); } }
    const records = [...owned.values()].reverse();
    if ((primary !== undefined || monitorError !== undefined) && !installedRequest) {
      // Stop the exact old GUI before graceful child cleanup can induce its quit path.
      const oldIndex = records.findIndex(record => record.pid === oldChild?.pid);
      if (oldIndex > 0) records.unshift(...records.splice(oldIndex, 1));
    }
    for (const record of records) {
      const outcome = await signalOwnedProcess(record, signal);
      if (outcome.failure) failures.push(outcome.failure);
    }
    await delay(2000);
  }
  if (app) { try { await sample('cleanup'); } catch (e) { failures.push({ reason: e.message }); } }
  const after = await processes();
  const residual = residualProcesses(after);
  const shipItLogs = [];
  for (const name of ['ShipIt_stdout.log', 'ShipIt_stderr.log']) {
    const file = join(qaHome, 'Library', 'Caches', `${APP_ID}.ShipIt`, name);
    if (!existsSync(file)) { shipItLogs.push({ file, exists: false }); continue; }
    const st = lstatSync(file); assert(st.isFile() && !st.isSymbolicLink() && st.uid === qaUid && st.size <= 4 * 1024 * 1024, 'shipit_log_identity_or_bound');
    const bytes = readFileSync(file); writeFileSync(join(evidence, name), bytes, { mode: 0o600 }); shipItLogs.push({ file, exists: true, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  save('shipit-log-capture.json', shipItLogs);
  let profile = [];
  try { profile = profileInventory(); } catch (error) { failures.push({ owner: 'profile-inventory', reason: error.message }); }
  const facts = { failures, residual, terminalAwaitingReapObserved: [...pendingTerminal.values()], imageUnconfirmedObservations: [...pendingComm.values()], unconfirmedParentChildren: [...pendingChildren.values()], firstSeenUnconfirmedImages: [...pendingFirstSeen.values()], ...directAppExitFacts(oldChild), adoptedProcessesReapedByRunner: false,
    profile, externalApplications: externalApplications() };
  save('cleanup.json', facts);
  assert(failures.length === 0 && residual.length === 0 && children.size === 0, 'owned_cleanup_unconfirmed');
  if (oldChild) assert(oldChild.qaClosed, 'direct_app_not_waited_closed');
  assert(externalApplications().every(p => !p.exists), 'external_application_path_changed');
}
function externalApplications() {
  return ['/Applications/xiaok.app', join(qaHome, 'Applications', 'xiaok.app')].map(path => ({ path, exists: existsSync(path) }));
}
async function main() {
  validInputs();
  assert(platform() === 'darwin' && arch() === 'arm64' && qaUid !== 0, 'arm64_nonroot_mac_required');
  assert(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.env.RUNNER_OS === 'macOS' && process.env.RUNNER_ARCH === 'ARM64', 'disposable_hosted_mac_required');
  const temp = realpathSync(process.env.RUNNER_TEMP); assert(lstatSync(temp).isDirectory() && lstatSync(temp).uid === qaUid, 'runner_temp_owner');
  root = join(temp, 'xiaok-real-upgrade-qa'); mkdirSync(root, { mode: 0o700 }); evidence = join(root, 'evidence'); mkdirSync(evidence, { mode: 0o700 });
  qaSourceBinding = await bindQaSource();
  save('inputs.json', { oldVersion: OLD.version, old: OLD, new: NEW, qaCodeSHA: qaSourceBinding.qaSHA, qaSourceBinding, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, root, home: qaHome, uid: qaUid });
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
  const newShipHelpers = newTree.filter(e => e.kind === 'file' && e.name.endsWith('/Resources/ShipIt') && e.name.includes('/Squirrel.framework/'));
  assert(newShipHelpers.length === 1, 'new_reference_signed_shipit_helper_missing'); newShipItSHA256 = newShipHelpers[0].sha256;
  save('shipit-reference-pins.json', { oldReference: { source: OLD.sha, version: OLD.version, fileSHA256: shipItSHA256 },
    newReference: { source: NEW.sha, version: NEW.tag.slice(9), fileSHA256: newShipItSHA256 },
    bothReferenceBundleSignaturesVerified: true, kernelMemoryHashClaim: false });
  const port = DEFAULT_CDP_PORT;
  const priorListener = await command('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { allowFailure: true, timeout: 5000 });
  assert(priorListener.code === 1 && priorListener.signal === null && !priorListener.spawnError && !priorListener.timedOut && priorListener.out === '' && priorListener.err === '', 'production_cdp_port_not_proven_vacant');
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve); });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  event('explicit-old-cdp-preflight', { address: '127.0.0.1', port, noPriorListener: true, bindReleased: true, explicitAppCDPFlags: true });
  const out = openSync(join(evidence, 'app.stdout'), 'wx', 0o600), err = openSync(join(evidence, 'app.stderr'), 'wx', 0o600);
  try { oldChild = spawn(appExecutable, ['--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1'], { env: cleanEnv(), detached: true, stdio: ['ignore', out, err] }); }
  finally { closeSync(out); closeSync(err); }
  oldChild.qaClosed = false; oldChild.once('close', () => { oldChild.qaClosed = true; }); oldChild.once('error', e => { monitorError = e; }); oldChild.once('exit', (code, signal) => event('direct-old-app-exit', { pid: oldChild.pid, code, signal, waitedReapedByNode: true }));
  monitorPromise = monitor();
  oldIdentity = await waitFor(async () => { await sample('old-ready'); return latestGuiApplications.find(p => p.pid === oldChild.pid); }, 30_000, 'old_app_identity_missing');
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
    await cacheDownload(newZip); await assertOldLivePreinstall(oldTree);
    assert.deepEqual((await releaseFacts(NEW)).metadata, beforeNew.metadata, 'new_metadata_drift_before_install');
    installedRequest = true; event('one-real-quitAndInstall-request', { oldIdentity });
    try { const response = await oldCDP.evaluate('window.xiaokDesktop.quitAndInstall()'); event('install-ipc-response', { response }); assert(!response?.status || ['pending', 'already_handed_off'].includes(response.status), 'install_ipc_rejected'); }
    catch (e) { if (e.message !== 'cdp_closed') throw e; event('install-ipc-disconnected-during-quit', {}); }
  } finally { oldCDP.close(); }
  if (GRACEFUL_USER_QUIT) {
    await waitFor(async () => {
      await sample('squirrel-staged-before-user-quit');
      return [...owned.values()].some(record => record.shipIt && record.shipItFileRole === 'old-reference' && record.observedAfterInstallRequest) &&
        readFileSync(join(evidence, 'app.stdout'), 'utf8').includes('nativeUpdater.update-downloaded');
    }, 60_000, 'native_squirrel_stage_not_observed');
    await requestGracefulUserQuit(oldIdentity);
  }
  await waitFor(async () => oldChild.qaClosed && oldChild.exitCode === 0, 120_000, 'old_app_did_not_exit');
  const restarted = await waitFor(async () => { await sample('relaunch'); return relaunchedGui(latestGuiApplications, oldIdentity, process.pid); }, 180_000, 'nsworkspace_did_not_relaunch_same_path');
  assert(restarted.ppid !== process.pid && restarted.birth !== oldIdentity.birth, 'not_os_owned_new_launch'); event('os-owned-relaunch-observed', { ...restarted, directlySpawnedByRunner: false, reapClaim: false });
  assert([...owned.values()].some(p => p.shipIt), 'shipit_identity_not_observed');
  // #166: the OS relaunched packaged app must not expose default CDP.
  // Signature/tree below establish the installed version; this only observes a native window.
  const nativeWindows = await waitFor(async () => {
    const probe = await command('/usr/bin/swift', ['-e', `
import CoreGraphics
import Foundation
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let visible = windows.filter { window in
  guard let pid = window[kCGWindowOwnerPID as String] as? Int,
        let layer = window[kCGWindowLayer as String] as? Int,
        let bounds = window[kCGWindowBounds as String] as? [String: Any],
        let width = bounds["Width"] as? Double, let height = bounds["Height"] as? Double else { return false }
  return pid == ${restarted.pid} && layer == 0 && width > 0 && height > 0
}
let data = try JSONSerialization.data(withJSONObject: visible)
print(String(decoding: data, as: UTF8.self))
`], { timeout: 60_000 });
    const windows = JSON.parse(probe.out);
    return windows.length > 0 ? windows : false;
  }, 120_000, 'new_native_window_not_visible');
  save('new-native-window.json', { restarted, windows: nativeWindows, rendererReadinessClaim: false });
  // Sample after a visible window, then again during a live observation period.
  const noCDP = [];
  for (let i = 0; i < 5; i++) {
    const live = (await processes()).find(p => p.pid === restarted.pid);
    assert(live && live.birth === restarted.birth && live.executable === appExecutable, 'relaunched_app_not_alive');
    const listener = await command('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { allowFailure: true, timeout: 5000 });
    assert(listener.code === 1 && listener.signal === null && !listener.spawnError && !listener.timedOut && listener.out === '' && listener.err === '', 'packaged_default_cdp_must_not_listen');
    noCDP.push({ pid: restarted.pid, port, listening: false, elapsedMs: performance.now() - START });
    if (i < 4) await delay(1000);
  }
  save('new-no-default-cdp.json', noCDP);
  const mainLog = readFileSync(join(evidence, 'app.stdout'), 'utf8'); assert(mainLog.includes('updater:install-wrapper-entered') && mainLog.includes('updater:before-quit'), 'real_handoff_markers_missing');
  await signature(app, NEW.tag.slice(9), 'actually-upgraded'); const actualTree = await tree(app); save('actual-upgraded-bundle-tree.json', actualTree); assert.deepEqual(actualTree, newTree, 'upgraded_bundle_differs_from_published_zip');
  const afterOld = await releaseFacts(OLD), afterNew = await releaseFacts(NEW); save('release-after.json', { old: afterOld, new: afterNew });
  assert.deepEqual(afterOld.metadata, beforeOld.metadata, 'old_release_drift'); assert.deepEqual(afterNew.metadata, beforeNew.metadata, 'new_release_drift');
  resultFacts = { downloaded, nativeWindows, noCDP, oldIdentity, restarted, actualSamePathReplacement: true, treeMatchesPublishedNewZIP: true, productionFeedUnchanged: true, oneInstallRequest: true };
}
if (process.argv.length === 3 && process.argv[2] === '--self-test') {
  await pureControls();
} else {
assert(process.argv.length === 2, 'qa_arguments');
try { await main(); if (monitorError) throw monitorError; } catch (e) { primary = { message: e.message, stack: e.stack }; }
finally {
  if (evidence) {
    try { await cleanup(); } catch (e) { primary ??= { message: e.message, stack: e.stack }; event('cleanup-failed', { message: e.message }); }
    if (qaDiagnostics.length && !primary) primary = { message: 'qa_diagnostic_evidence_unconfirmed' };
    save('RESULT.json', { oldVersion: OLD.version, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, qaDiagnostics, status: primary ? 'FAIL' : GRACEFUL_USER_QUIT ? 'PASS_REAL_SIGNED_MAC_SHIPIT_UPGRADE_AFTER_USER_QUIT' : 'PASS_REAL_SIGNED_MAC_SHIPIT_UPGRADE', gracefulUserQuitMode: GRACEFUL_USER_QUIT, failure: primary ?? null, old: OLD, new: NEW, qaSourceBinding: qaSourceBinding ?? null, facts: resultFacts,
      elapsedSeconds: (performance.now() - START) / 1000, noProductBuildOrCopyReplacement: true, noFeedOverride: true, noModelSDKCUAGoalTask: true,
      profileDisposition: 'Retained until hosted disposable VM destruction; artifacts contain evidence only, not app binaries or caches.',
      notClaimed: ['Windows', 'Goal14', 'CUA3', 'held native qualification', 'signing or publication', 'reap of launchd-owned processes'] });
  }
}
if (primary) { console.error(primary.message); process.exitCode = 1; }
}

async function pureControls() {
  let passed = 0;
  const check = (name, action) => { action(); passed++; console.log(`PASS ${name}`); };
  check('graceful user Quit is explicit opt-in and stock default remains false', () => {
    assert.equal(userQuitMode(undefined), false); assert.equal(userQuitMode('false'), false); assert.equal(userQuitMode('true'), true);
    assert.throws(() => userQuitMode('yes'), /invalid_user_quit_mode/);
    assert.equal(profileEntryLimit(false), 20_000); assert.equal(profileEntryLimit(true), 100_000);
  });
  const path = '/qa/installed/xiaok.app', exe = `${path}/Contents/MacOS/xiaok`, uid = 501;
  const old = { pid: 10, uid, birth: 'old-birth', executable: exe }, child = { ...old, pid: 11, birth: 'child-birth' };
  const registration = { pid: 10, bundleIdentifier: APP_ID, bundleURL: path, executableURL: exe, terminated: false };
  check('normal user Quit requires exact process and AppKit application identities', () => {
    const expected = { ...old, bundle: path, bundleIdentifier: APP_ID };
    assert.equal(gracefulQuitTargetMatches(expected, old, registration), true);
    for (const [key, value] of [['pid', 99], ['uid', 999], ['birth', 'new'], ['executable', '/foreign']]) {
      assert.equal(gracefulQuitTargetMatches(expected, { ...old, [key]: value }, registration), false);
    }
    for (const [key, value] of [['pid', 99], ['terminated', true], ['bundleIdentifier', 'foreign'], ['bundleURL', '/foreign'], ['executableURL', '/foreign']]) {
      assert.equal(gracefulQuitTargetMatches(expected, old, { ...registration, [key]: value }), false);
    }
    const row = parseQuitProcessRow(' 10 501 Mon Nov 16 03:00:00 2026 /qa/app with spaces\n');
    assert.equal(row.executable, '/qa/app with spaces'); assert.equal(row.birth, 'Mon Nov 16 03:00:00 2026');
    assert.throws(() => parseQuitProcessRow('10 501 bad\n11 501 duplicate'), /quit_process_snapshot_shape/);
  });

  const choose = (apps, before = [old, child], after = before) => selectGuiApplications(apps, before, after, { uid, bundle: path, executable: exe });
  await (async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'xiaok-qa-owned-pure-'));
    const saved = { root, evidence, app, appExecutable, oldChild, owned: new Map(owned) };
    try {
      root = temporary; evidence = join(root, 'evidence'); mkdirSync(evidence, { mode: 0o700 });
      app = join(root, 'installed', 'xiaok.app'); appExecutable = join(app, 'Contents', 'MacOS', 'xiaok');
      oldChild = { pid: old.pid }; owned.clear();
      const rows = [{ ...old, uid: qaUid, executable: appExecutable, ppid: process.pid, pgid: old.pid },
        { ...child, uid: qaUid, executable: appExecutable, ppid: old.pid, pgid: child.pid }];
      await observeOwnedProcesses(rows);
      assert.deepEqual([...owned.keys()], [old.pid, child.pid]);
      assert.equal(owned.get(old.pid).directChild, true); assert.equal(owned.get(child.pid).directChild, false);
      assert.equal(owned.get(child.pid).executable, appExecutable); assert.equal(owned.get(child.pid).ppid, old.pid);
      const applications = [{ ...registration, bundleURL: app, executableURL: appExecutable }];
      assert.deepEqual(selectGuiApplications(applications, rows, rows, { uid: qaUid, bundle: app, executable: appExecutable }).map(p => p.pid), [old.pid]);
    } finally {
      ({ root, evidence, app, appExecutable, oldChild } = saved);
      owned.clear(); for (const [pid, record] of saved.owned) owned.set(pid, record);
      rmSync(temporary, { recursive: true, force: true });
    }
  })();
  passed++; console.log('PASS same-executable child remains in actual owned cleanup while only old GUI is selected');
  check('two live target GUI registrations reject', () => assert.throws(() => choose([registration, { ...registration, pid: 11 }]), /multiple_same_path_apps/));
  check('terminated registration never counts as ready or duplicate', () => assert.deepEqual(choose([registration, { ...registration, pid: 11, terminated: true }]).map(p => p.pid), [10]));
  check('missing current ps identity yields no match', () => assert.deepEqual(choose([registration], [old], []), []));
  for (const [field, value] of [['bundleIdentifier', 'wrong.bundle'], ['bundleURL', '/other/xiaok.app'], ['executableURL', '/other/xiaok.app/Contents/MacOS/xiaok']]) {
    check(`live contradictory registration ${field} rejects`, () => assert.throws(() => choose([{ ...registration, [field]: value }]), /gui_application_identity/));
  }
  check('live wrong UID rejects', () => assert.throws(() => choose([registration], [{ ...old, uid: 502 }], [{ ...old, uid: 502 }]), /gui_application_identity/));
  check('live ps birth contradiction rejects', () => assert.throws(() => choose([registration], [old], [{ ...old, birth: 'reused' }]), /gui_ps_identity_changed/));
  check('live ps executable contradiction rejects', () => assert.throws(() => choose([registration], [old], [{ ...old, executable: '/other' }]), /gui_ps_identity_changed/));
  check('relaunch selection excludes old PID and requires fresh birth/non-runner parent', () => {
    const newer = { ...child, ppid: 1 }, gui = choose([{ ...registration, pid: 11 }], [newer]);
    assert.equal(relaunchedGui([old], old, 99), undefined); assert.equal(relaunchedGui(gui, old, 99).pid, 11);
    assert.throws(() => relaunchedGui([{ ...newer, ppid: 99 }], old, 99), /not_os_owned_new_launch/);
    assert.throws(() => relaunchedGui([{ ...newer, birth: old.birth }], old, 99), /not_os_owned_new_launch/);
  });
  check('bad observer data cannot be interpreted as an empty successful observation', () => {
    assert.throws(() => parseApplications('not-json')); assert.throws(() => parseApplications('{}'));
    assert.throws(() => parseApplications(JSON.stringify([{ ...registration, terminated: 'false' }])));
  });
  const one = '1'.repeat(40), two = '2'.repeat(40), three = '3'.repeat(40);
  const entry = oid => ({ mode: '100644', type: 'blob', oid });
  const product = new Map([...QA_PATHS.map(p => [p, entry(one)]), ['src/main.ts', entry(three)]]);
  const qa = new Map([...QA_PATHS.map(p => [p, entry(two)]), ['src/main.ts', entry(three)]]);
  check('independent QA/product commits with exactly two QA modifications pass', () => { assertQaCommit(one, one, one); assert.deepEqual(compareQaTrees(product, qa).changed, QA_PATHS); });
  check('checkout or workflow SHA mismatch rejects', () => { assert.throws(() => assertQaCommit(one, two, one)); assert.throws(() => assertQaCommit(one, one, two)); });
  check('third-file blob/mode changes or additions reject', () => {
    for (const [path, changed] of [['src/main.ts', entry(one)], ['src/main.ts', { ...entry(three), mode: '100755' }], ['new.txt', entry(three)]]) {
      const next = new Map(qa); next.set(path, changed); assert.throws(() => compareQaTrees(product, next), /non_qa_tree_changed/);
    }
  });
  check('QA symlink/type or missing entries reject', () => {
    const next = new Map(qa); next.set(QA_PATHS[0], { ...entry(two), mode: '120000' }); assert.throws(() => compareQaTrees(product, next), /qa_regular_blob_required/);
    next.delete(QA_PATHS[0]); assert.throws(() => compareQaTrees(product, next), /qa_regular_blob_required/);
  });
  check('Git tree malformed/duplicate entries reject', () => { assert.throws(() => parseGitTree('bad')); assert.throws(() => parseGitTree(`100644 blob ${one}\ta\0` .repeat(2))); });
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'xiaok-qa-pure-'));
  try {
    const file = join(directory, 'qa.mjs'), bytes = Buffer.from('// frozen QA\n'); writeFileSync(file, bytes, { mode: 0o644 }); chmodSync(file, 0o644);
    const expected = entry(gitBlobOID(bytes));
    check('actual regular checkout bytes match the QA-head blob', () => assert.equal(checkedQaFile(file, expected).blobOID, expected.oid));
    check('changed actual checkout bytes reject despite unchanged tree', () => { writeFileSync(file, '// modified\n'); assert.throws(() => checkedQaFile(file, expected), /qa_checkout_blob_mismatch/); });
    check('actual executable mode is not an approved 100644 QA file', () => { writeFileSync(file, bytes); chmodSync(file, 0o755); assert.throws(() => checkedQaFile(file, expected), /qa_checkout_regular_mode/); });
  } finally { rmSync(directory, { recursive: true, force: true }); }

  const signalTemp = mkdtempSync(join(realpathSync(tmpdir()), 'xiaok-qa-signal-pure-'));
  const savedSignalState = { root, evidence, app, appExecutable, oldChild, oldIdentity, primary, monitorError, installedRequest,
    owned: new Map(owned), pendingTerminal: new Map(pendingTerminal), pendingComm: new Map(pendingComm), pendingChildren: new Map(pendingChildren), pendingFirstSeen: new Map(pendingFirstSeen), acceptedUserQuit, shipItSHA256, newShipItSHA256, diagnostics: [...qaDiagnostics] };
  const signalCheck = async (name, action) => { await action(); passed++; console.log(`PASS ${name}`); };
  try {
    root = signalTemp; evidence = join(root, 'evidence'); mkdirSync(evidence, { mode: 0o700 });
    app = join(root, 'installed', 'xiaok.app'); appExecutable = join(app, 'Contents', 'MacOS', 'xiaok');
    const gui = { pid: 50, ppid: process.pid, pgid: 50, uid: qaUid, birth: 'old-gui-birth', executable: appExecutable, directChild: true };
    oldChild = { pid: gui.pid }; oldIdentity = { ...gui }; primary = { message: 'expected-primary' }; monitorError = undefined; installedRequest = false;
    owned.clear(); owned.set(gui.pid, gui);
    const invokeSignal = async (record, rows) => {
      const actions = [];
      const outcome = await signalOwnedProcess(record, 'SIGTERM', {
        readProcesses: async () => { actions.push(['fresh-ps']); return rows; },
        sendSignal: (pid, signal) => { actions.push(['signal', pid, signal]); return true; },
      });
      return { actions, outcome };
    };
    await signalCheck('failed preinstall old GUI is hard-stopped only after the fresh exact ps match', async () => {
      const actual = await invokeSignal(gui, [gui]); assert.deepEqual(actual.actions, [['fresh-ps'], ['signal', gui.pid, 'SIGKILL']]);
      assert.equal(actual.outcome.failure, undefined); assert.equal(actual.outcome.signal, 'SIGKILL');
    });
    await signalCheck('normal cleanup and explicit-install cleanup keep original TERM behavior', async () => {
      primary = undefined; assert.equal((await invokeSignal(gui, [gui])).outcome.signal, 'SIGTERM');
      primary = { message: 'expected-primary' }; installedRequest = true; assert.equal((await invokeSignal(gui, [gui])).outcome.signal, 'SIGTERM'); installedRequest = false;
    });
    await signalCheck('another owned same-executable PID receives no old-GUI special signal', async () => {
      const other = { ...gui, pid: 51, ppid: gui.pid, directChild: false }; owned.set(other.pid, other);
      assert.equal((await invokeSignal(other, [other])).outcome.signal, 'SIGTERM'); owned.delete(other.pid);
    });
    await signalCheck('missing old identity or fresh PID cannot signal the old GUI', async () => {
      oldIdentity = undefined; let actual = await invokeSignal(gui, [gui]); assert.deepEqual(actual.actions, [['fresh-ps']]); assert(actual.outcome.failure);
      oldIdentity = { ...gui }; actual = await invokeSignal(gui, []); assert.deepEqual(actual.actions, [['fresh-ps']]);
    });
    for (const [key, value] of [['uid', qaUid + 1], ['birth', 'different-birth'], ['executable', '/different-executable']]) {
      await signalCheck(`live ${key} mismatch rejects without signal`, async () => {
        const actual = await invokeSignal(gui, [{ ...gui, [key]: value }]); assert.deepEqual(actual.actions, [['fresh-ps']]); assert.equal(actual.outcome.failure.reason, 'identity_changed_not_signaled');
      });
    }
    const python = { ...gui, pid: 52, ppid: gui.pid, birth: 'python-birth', executable: join(root, 'python3'), directChild: false };
    const parenthesized = { ...python, executable: '(python3.11)' }; owned.set(python.pid, python);
    for (const [name, rows, expected] of [
      ['absent', [], 'absent'], ['restored', [python], 'restored'], ['still-parenthesized', [parenthesized], 'unconfirmed'],
      ['uid-changed', [{ ...python, uid: qaUid + 1 }], 'unconfirmed'],
      ['birth-changed', [{ ...python, birth: 'new-birth' }], 'unconfirmed'],
      ['image-changed', [{ ...python, executable: '/other-image' }], 'unconfirmed'],
    ]) {
      await signalCheck(`parenthesized comm ${name} requires exact second-snapshot facts`, async () => {
        let reads = 0, signals = 0;
        const proof = await recheckParenthesizedComm(python, parenthesized, async () => { reads++; return rows; });
        assert.equal(proof.kind, expected); assert.equal(reads, 1);
        reads = 0;
        const outcome = await signalOwnedProcess(python, 'SIGTERM', {
          readProcesses: async () => ++reads === 1 ? [parenthesized] : rows,
          sendSignal: () => { signals++; return true; },
        });
        assert.equal(reads, 2); assert.equal(signals, expected === 'restored' ? 1 : 0);
        if (expected === 'unconfirmed') assert.equal(outcome.kind, 'rejected');
        if (expected === 'absent') assert.equal(outcome.kind, 'absent');
      });
    }
    await signalCheck('observer rejects unresolved comm and accepts only absent or restored re-read', async () => {
      await observeOwnedProcesses([parenthesized], 'pure-reread', { readProcesses: async () => [] });
      await observeOwnedProcesses([parenthesized], 'pure-reread', { readProcesses: async () => [python] });
      await assert.rejects(observeOwnedProcesses([parenthesized], 'pure-reread', { readProcesses: async () => [parenthesized] }), /owned_pid_identity_changed/);
      assert.equal(owned.get(python.pid), python);
    });
    const quittingChild = { ...gui, pid: 54, ppid: gui.pid, birth: 'quitting-child', state: 'R<', directChild: false };
    const unknownQuittingChild = { ...quittingChild, state: 'S<', executable: '(xiaok)' };
    const quitContext = { graceful: true, accepted: true, installRequested: true };
    owned.set(quittingChild.pid, quittingChild);
    await signalCheck('accepted normal Quit observes the exact unconfirmed image without altering ownership or proving absence', async () => {
      await observeOwnedProcesses([unknownQuittingChild], 'pure-post-quit', { readProcesses: async () => [unknownQuittingChild], quitContext });
      assert.equal(owned.get(quittingChild.pid), quittingChild);
      assert.equal(residualProcesses([unknownQuittingChild]).length, 1);
      assert.equal(residualProcesses([]).length, 0);
    });
    await signalCheck('pending image grants no signal and no descendant ownership; present candidates still fail final closure', async () => {
      let signals = 0;
      const outcome = await signalOwnedProcess(quittingChild, 'SIGTERM', {
        readProcesses: async () => [unknownQuittingChild], sendSignal: () => { signals++; return true; },
      });
      assert.equal(signals, 0); assert.equal(outcome.kind, 'rejected');
      const candidate = { ...quittingChild, pid: 55, ppid: quittingChild.pid, executable: '/usr/bin/true' };
      await observeOwnedProcesses([candidate], 'pure-pending-parent', { quitContext });
      assert.equal(owned.has(candidate.pid), false); assert.equal(pendingChildren.has(candidate.pid), true);
      assert.equal(residualProcesses([candidate]).length, 1); assert.equal(residualProcesses([]).length, 0);
      pendingChildren.delete(candidate.pid);
    });
    for (const [name, context] of [
      ['before normal Quit accepted', { ...quitContext, accepted: false }],
      ['outside user Quit mode', { ...quitContext, graceful: false }],
      ['before installation request', { ...quitContext, installRequested: false }],
    ]) {
      await signalCheck(`unconfirmed image rejects ${name}`, async () => {
        await assert.rejects(observeOwnedProcesses([unknownQuittingChild], 'pure-quit-negative', {
          readProcesses: async () => [unknownQuittingChild], quitContext: context,
        }), /owned_pid_identity_changed/);
      });
    }
    for (const [name, fresh] of [
      ['changed UID', { ...unknownQuittingChild, uid: qaUid + 1 }],
      ['changed birth', { ...unknownQuittingChild, birth: 'reused-pid' }],
      ['foreign full image', { ...unknownQuittingChild, executable: '/foreign-image' }],
      ['different basename', { ...unknownQuittingChild, executable: '(xiaok-helper)' }],
    ]) {
      await signalCheck(`unconfirmed image fresh snapshot rejects ${name}`, async () => {
        await assert.rejects(observeOwnedProcesses([unknownQuittingChild], 'pure-fresh-negative', {
          readProcesses: async () => [fresh], quitContext,
        }), /owned_pid_identity_changed/);
        assert.equal(owned.get(quittingChild.pid), quittingChild);
      });
    }
    await signalCheck('first-seen nonterminal pseudo image cannot gain ownership', async () => {
      const firstSeen = { ...unknownQuittingChild, pid: 56 };
      await observeOwnedProcesses([firstSeen], 'pure-first-seen', { quitContext });
      assert.equal(owned.has(firstSeen.pid), false);
      assert.equal(residualProcesses([firstSeen]).length, 1);
    });
    const initialUnknown = { ...unknownQuittingChild, pid: 56 };
    const confirmedFirstSeen = { ...initialUnknown, executable: appExecutable, state: 'S<' };
    await signalCheck('first-seen unconfirmed image has no signal authority and cannot grant descendant ownership', async () => {
      assert.equal(pendingFirstSeen.has(initialUnknown.pid), true);
      let signals = 0;
      const rejected = await signalOwnedProcess(initialUnknown, 'SIGTERM', {
        readProcesses: async () => [initialUnknown], sendSignal: () => { signals++; return true; },
      });
      assert.equal(rejected.kind, 'rejected'); assert.equal(signals, 0);
      const child = { ...initialUnknown, pid: 57, ppid: initialUnknown.pid, executable: '/usr/bin/true' };
      await observeOwnedProcesses([child], 'pure-first-pending-child');
      assert.equal(owned.has(child.pid), false); assert.equal(pendingChildren.has(child.pid), true);
      assert.equal(residualProcesses([initialUnknown, child]).length, 2);
      pendingChildren.delete(child.pid);
    });
    await signalCheck('parent-only and foreign-root full images cannot admit a first-seen unknown PID', async () => {
      let reads = 0;
      for (const executable of ['/usr/bin/true', '/foreign/xiaok']) {
        await observeOwnedProcesses([{ ...confirmedFirstSeen, executable }], 'pure-first-wrong-root', {
          readProcesses: async () => { reads++; return [confirmedFirstSeen]; },
        });
        assert.equal(owned.has(initialUnknown.pid), false);
      }
      assert.equal(reads, 0); assert.equal(residualProcesses([initialUnknown]).length, 1);
    });
    for (const [name, drift] of [['UID', { uid: qaUid + 1 }], ['birth', { birth: 'reused-birth' }]]) {
      await signalCheck(`first-seen ${name} drift rejects both the current and fresh snapshot`, async () => {
        await assert.rejects(observeOwnedProcesses([{ ...confirmedFirstSeen, ...drift }], 'pure-first-drift'), /pending_first_seen_pid_changed/);
        await assert.rejects(observeOwnedProcesses([confirmedFirstSeen], 'pure-first-fresh-drift', {
          readProcesses: async () => [{ ...confirmedFirstSeen, ...drift }],
        }), /pending_first_seen_pid_changed/);
        assert.equal(owned.has(initialUnknown.pid), false);
      });
    }
    await signalCheck('first-seen path drift between fresh snapshots cannot grant ownership', async () => {
      let reads = 0;
      await observeOwnedProcesses([confirmedFirstSeen], 'pure-first-path-drift', {
        readProcesses: async () => [{ ...confirmedFirstSeen, executable: ++reads === 1 ? appExecutable : '/foreign-image' }],
      });
      assert.equal(reads, 2); assert.equal(owned.has(initialUnknown.pid), false);
    });
    await signalCheck('first-seen absence or terminal state confers no ownership and present PID still prevents closure', async () => {
      await observeOwnedProcesses([confirmedFirstSeen], 'pure-first-absent', { readProcesses: async () => [] });
      await observeOwnedProcesses([{ ...initialUnknown, state: 'Z' }], 'pure-first-terminal');
      assert.equal(owned.has(initialUnknown.pid), false); assert.equal(residualProcesses([initialUnknown]).length, 1);
      assert.equal(residualProcesses([]).length, 0);
    });
    await signalCheck('only two fresh complete independent-scope identities admit the previously unowned PID', async () => {
      let reads = 0; pendingChildren.set(initialUnknown.pid, { ...initialUnknown });
      await observeOwnedProcesses([confirmedFirstSeen], 'pure-first-admission', {
        readProcesses: async () => { reads++; return [confirmedFirstSeen]; },
      });
      assert.equal(reads, 2); assert(sameProcessIdentity(owned.get(initialUnknown.pid), confirmedFirstSeen));
      assert.equal(pendingFirstSeen.has(initialUnknown.pid), false); assert.equal(pendingChildren.has(initialUnknown.pid), false);
      assert.equal(residualProcesses([confirmedFirstSeen]).length, 1);
      owned.delete(initialUnknown.pid);
    });
    for (const [index, state] of ['E', 'W', '?', ''].entries()) {
      await signalCheck(`unclassified initial state ${JSON.stringify(state)} stays non-authoritative even with a full path`, async () => {
        const unknown = { ...initialUnknown, pid: 60 + index, state };
        const full = { ...unknown, executable: appExecutable };
        await observeOwnedProcesses([unknown], 'pure-unclassified-initial');
        await observeOwnedProcesses([full], 'pure-unclassified-full', { readProcesses: async () => [full] });
        assert.equal(owned.has(unknown.pid), false); assert.equal(pendingFirstSeen.has(unknown.pid), true);
        let signals = 0;
        const outcome = await signalOwnedProcess(full, 'SIGTERM', {
          readProcesses: async () => [full], sendSignal: () => { signals++; return true; },
        });
        assert.equal(signals, 0); assert.equal(outcome.kind, 'rejected');
        assert.equal(residualProcesses([full]).length, 1); pendingFirstSeen.delete(unknown.pid);
      });
    }
    await signalCheck('first-seen Z with bare relative comm is pending terminal without signal authority', async () => {
      const terminal = { ...initialUnknown, pid: 69, state: 'Z<', executable: 'xiaok' };
      await observeOwnedProcesses([terminal], 'pure-bare-terminal');
      assert.equal(owned.has(terminal.pid), false); assert.equal(pendingTerminal.has(terminal.pid), true);
      assert.equal(residualProcesses([terminal]).length, 1); assert.equal(residualProcesses([]).length, 0);
      pendingTerminal.delete(terminal.pid);
    });
    await signalCheck('an owned terminal parent cannot grant a new descendant authority', async () => {
      const parent = { ...gui, pid: 70, birth: 'terminal-parent' };
      owned.set(parent.pid, parent); pendingTerminal.set(parent.pid, { ...parent, state: 'Z', executable: '<defunct>' });
      const child = { ...gui, pid: 71, ppid: parent.pid, birth: 'unconfirmed-terminal-child', state: 'S', executable: '/usr/bin/true' };
      await observeOwnedProcesses([child], 'pure-terminal-parent-child');
      assert.equal(owned.has(child.pid), false); assert.equal(pendingChildren.has(child.pid), true);
      assert.equal(residualProcesses([child]).length, 1);
      owned.delete(parent.pid); pendingTerminal.delete(parent.pid); pendingChildren.delete(child.pid);
    });
    await signalCheck('post-quit unclassified states remain observations and never authorize a signal', async () => {
      for (const state of ['E', 'W', '?', '']) {
        const current = { ...unknownQuittingChild, state };
        await observeOwnedProcesses([current], 'pure-unclassified-postquit', { readProcesses: async () => [current], quitContext });
        let signals = 0;
        const outcome = await signalOwnedProcess(quittingChild, 'SIGTERM', {
          readProcesses: async () => [current], sendSignal: () => { signals++; return true; },
        });
        assert.equal(owned.get(quittingChild.pid), quittingChild); assert.equal(signals, 0); assert.equal(outcome.kind, 'rejected');
      }
    });
    await signalCheck('only exact restored full image restores the original signal gate; absent never receives a signal', async () => {
      await observeOwnedProcesses([quittingChild], 'pure-restored', { quitContext });
      assert.equal(pendingComm.has(quittingChild.pid), false);
      let signals = 0;
      const restored = await signalOwnedProcess(quittingChild, 'SIGTERM', {
        readProcesses: async () => [quittingChild], sendSignal: () => { signals++; return true; },
      });
      assert.equal(signals, 1); assert.equal(restored.signal, 'SIGTERM');
      const absent = await signalOwnedProcess(quittingChild, 'SIGTERM', {
        readProcesses: async () => [], sendSignal: () => { signals++; return true; },
      });
      assert.equal(absent.kind, 'absent'); assert.equal(signals, 1);
    });
    owned.delete(quittingChild.pid); pendingComm.delete(quittingChild.pid);
    owned.delete(python.pid);
    await signalCheck('OS terminal state is parsed and never treated as a reaped PID', async () => {
      const rows = parseProcessSnapshot('52 50 50 501 Mon Nov 16 03:00:00 2026 Z <defunct>\n53 50 50 501 Mon Nov 16 03:00:00 2026 S /qa/path with spaces\n');
      assert.equal(rows[0].state, 'Z'); assert.equal(rows[0].executable, '<defunct>'); assert.equal(rows[1].executable, '/qa/path with spaces');
      const record = { ...gui, pid: 52, ppid: gui.pid, birth: 'terminal-birth', executable: join(root, 'python3'), directChild: false };
      const terminal = { ...record, state: 'Z', executable: '<defunct>' }; owned.set(record.pid, record);
      let signals = 0;
      const outcome = await signalOwnedProcess(record, 'SIGTERM', { readProcesses: async () => [terminal], sendSignal: () => { signals++; return true; } });
      assert.equal(outcome.kind, 'terminal-awaiting-reap'); assert.equal(signals, 0); assert.equal(owned.get(record.pid), record);
      await observeOwnedProcesses([terminal], 'pure-terminal'); assert.equal(owned.get(record.pid), record);
      assert.equal(residualProcesses([terminal]).length, 1); assert.equal(residualProcesses([]).length, 0);
      for (const change of [{ state: 'S' }, { birth: 'different-birth' }, { uid: qaUid + 1 }, { executable: '/foreign-image' }]) {
        signals = 0;
        const rejected = await signalOwnedProcess(record, 'SIGTERM', { readProcesses: async () => [{ ...terminal, ...change }], sendSignal: () => { signals++; return true; } });
        assert.equal(rejected.kind, 'rejected'); assert.equal(signals, 0);
      }
      const firstSeen = { ...terminal, pid: 53, birth: 'first-seen-terminal' };
      await observeOwnedProcesses([firstSeen], 'pure-terminal-first-seen');
      assert.equal(owned.has(firstSeen.pid), false); assert.equal(pendingTerminal.has(firstSeen.pid), true);
      assert.equal(residualProcesses([firstSeen]).length, 1);
      owned.delete(record.pid); pendingTerminal.clear();
    });
    await signalCheck('a signal failure remains a cleanup failure', async () => {
      const outcome = await signalOwnedProcess(gui, 'SIGTERM', { readProcesses: async () => [gui], sendSignal: () => { throw Object.assign(new Error('fixture-denied'), { code: 'EPERM' }); } });
      assert.equal(outcome.failure.reason, 'EPERM');
    });
    await signalCheck('identity evidence-write failure retains original ownership rejection', async () => {
      const previousEvidence = evidence, before = qaDiagnostics.length; evidence = join(root, 'missing', 'evidence');
      try { await assert.rejects(observeOwnedProcesses([{ ...gui, birth: 'changed' }], 'pure-conflict'), /owned_pid_identity_changed/); }
      finally { evidence = previousEvidence; }
      assert.equal(qaDiagnostics.length, before + 1); assert.equal(owned.get(gui.pid), gui);
    });
    await signalCheck('official new-reference ShipIt is observed only after the original handoff facts', async () => {
      const helperDir = join(app, 'Contents', 'Frameworks', 'Squirrel.framework', 'Resources'); mkdirSync(helperDir, { recursive: true });
      const helper = join(helperDir, 'ShipIt'); const nextBytes = Buffer.from('new reference helper fixture; no signing claim');
      writeFileSync(helper, nextBytes);
      shipItSHA256 = createHash('sha256').update('old reference helper fixture').digest('hex');
      newShipItSHA256 = createHash('sha256').update(nextBytes).digest('hex');
      installedRequest = true; oldChild = { ...oldChild, qaClosed: true, exitCode: 0, signalCode: null };
      owned.set(79, { ...gui, pid: 79, birth: 'old-helper', executable: helper, shipIt: true, shipItFileRole: 'old-reference', shipItFileSHA256: shipItSHA256, observedAfterInstallRequest: true });
      const nextHelper = { ...gui, pid: 80, ppid: 1, birth: 'new-official-helper', state: 'S', executable: helper, directChild: false };
      await observeOwnedProcesses([nextHelper], 'pure-new-helper');
      assert.equal(owned.get(nextHelper.pid).shipItFileRole, 'new-reference');
      assert.equal(owned.get(nextHelper.pid).shipItFileSHA256, newShipItSHA256);
      owned.delete(80);
    });
    await signalCheck('first-seen helper promotion uses the same two-reference phase validator', async () => {
      const executable = join(app, 'Contents', 'Frameworks', 'Squirrel.framework', 'Resources', 'ShipIt');
      const first = { ...gui, pid: 81, ppid: 79, birth: 'first-seen-new-helper', state: 'S', executable: '(ShipIt)', directChild: false };
      const complete = { ...first, executable };
      await observeOwnedProcesses([first], 'pure-pending-new-helper');
      assert.equal(owned.has(first.pid), false);
      await observeOwnedProcesses([complete], 'pure-admit-new-helper', { readProcesses: async () => [complete] });
      assert.equal(owned.get(first.pid).shipItFileRole, 'new-reference');
      assert.equal(pendingFirstSeen.has(first.pid), false); owned.delete(first.pid); owned.delete(79);
      await assert.rejects(verifyOfficialShipItFile(complete), /shipit_file_not_authorized_for_handoff_phase/);
    });
    const goodHelperPhase = { oldReferenceSHA256: shipItSHA256, newReferenceSHA256: newShipItSHA256,
      installedRequest: true, originalHelperAfterRequest: true,
      oldExit: { directAppExited: true, directAppCloseObserved: true, directAppExitCode: 0, directAppSignal: null } };
    check('original helper is mandatory and accepted before any handoff; new helper requires all phase facts', () => {
      assert.equal(officialShipItRole(shipItSHA256, { ...goodHelperPhase, installedRequest: false, originalHelperAfterRequest: false, oldExit: null }), 'old-reference');
      assert.equal(officialShipItRole(newShipItSHA256, goodHelperPhase), 'new-reference');
      for (const phase of [
        { ...goodHelperPhase, installedRequest: false }, { ...goodHelperPhase, originalHelperAfterRequest: false },
        ...Object.entries({ directAppExited: false, directAppCloseObserved: false, directAppExitCode: 1, directAppSignal: 'SIGTERM' })
          .map(([key, value]) => ({ ...goodHelperPhase, oldExit: { ...goodHelperPhase.oldExit, [key]: value } })),
      ]) assert.equal(officialShipItRole(newShipItSHA256, phase), null);
      assert.equal(officialShipItRole('f'.repeat(64), goodHelperPhase), null);
      assert.equal(officialShipItRole(newShipItSHA256, { ...goodHelperPhase, oldReferenceSHA256: undefined }), null);
    });
    await signalCheck('correct helper digest never authorizes a foreign path, relative path or UID', async () => {
      const executable = join(app, 'Contents', 'Frameworks', 'Squirrel.framework', 'Resources', 'ShipIt');
      for (const change of [{ executable: join(root, 'outside', 'ShipIt') }, { executable: 'ShipIt' }, { uid: qaUid + 1 }]) {
        await assert.rejects(verifyOfficialShipItFile({ ...gui, executable, ...change }), /shipit_path_or_uid_not_scoped/);
      }
    });
    check('codesign success requires the complete successful process tuple', () => {
      const good = { spawnError: undefined, timedOut: false, code: 0, signal: null, actualWait: true, reaped: true, closeObserved: true };
      assert.equal(successfulCodesign(good), true);
      for (const [key, value] of [['spawnError', 'ENOENT'], ['timedOut', true], ['code', 1], ['signal', 'SIGKILL'], ['actualWait', false], ['reaped', false], ['closeObserved', false]]) assert.equal(successfulCodesign({ ...good, [key]: value }), false);
    });
  } finally {
    ({ root, evidence, app, appExecutable, oldChild, oldIdentity, primary, monitorError, installedRequest } = savedSignalState);
    owned.clear(); for (const [pid, record] of savedSignalState.owned) owned.set(pid, record);
    pendingTerminal.clear(); for (const [pid, record] of savedSignalState.pendingTerminal) pendingTerminal.set(pid, record);
    pendingComm.clear(); for (const [pid, record] of savedSignalState.pendingComm) pendingComm.set(pid, record);
    pendingChildren.clear(); for (const [pid, record] of savedSignalState.pendingChildren) pendingChildren.set(pid, record);
    pendingFirstSeen.clear(); for (const [pid, record] of savedSignalState.pendingFirstSeen) pendingFirstSeen.set(pid, record);
    acceptedUserQuit = savedSignalState.acceptedUserQuit; shipItSHA256 = savedSignalState.shipItSHA256; newShipItSHA256 = savedSignalState.newShipItSHA256;
    qaDiagnostics.splice(0, qaDiagnostics.length, ...savedSignalState.diagnostics);
    rmSync(signalTemp, { recursive: true, force: true });
  }


  check('old version defaults to the unchanged immutable 1.5.14 preset', () => {
    assert.equal(selectOldPreset(), OLD14); assert(Object.isFrozen(OLD14));
    assert.deepEqual(OLD14, { tag: 'desktop-v1.5.14', version: '1.5.14', release: 418149835,
      sha: 'dc221f9bac84d939b8fb543d4795396693fdc9b8', bytes: 228655718,
      zipSHA256: 'b7a3b6d6e23b5423d581f8b93ad05b82b34fc0fab429c14ea4c9736d358ebf37' });
  });
  check('old15 selects exactly the published frozen asset identity', () => {
    const selected = selectOldPreset('1.5.15'); assert(Object.isFrozen(selected));
    assert.deepEqual(selected, { tag: 'desktop-v1.5.15', version: '1.5.15', release: 419987808,
      sha: '6770092945a42fb0e45ef0d68d0971bfc01b51a8', bytes: 231833178,
      zipSHA256: '1e6e73ca880994d6c7f23ef4919b020099e350702581040113beeb43779cc3c9' });
    assert.throws(() => { selected.release = 1; }, TypeError);
  });
  check('published 1.6.3 preset is immutable and 1.6.4 is newer', () => {
    const selected=selectOldPreset('1.6.3');assert(Object.isFrozen(selected));
    assert.deepEqual(selected,{tag:'desktop-v1.6.3',version:'1.6.3',release:444569883,
      sha:'c453f03691cd5d10e07c486d3338b2fd810e30ae',bytes:283759026,
      zipSHA256:'9d5713a2489ec9fb7c4fc85ee0fb874a64590e08882897ec8d2fb5b4c8d698ff'});
    assert.doesNotThrow(()=>assertNewerVersion('1.6.4',selected.version));
    assert.throws(()=>assertNewerVersion('1.6.3',selected.version),/new_version_must_follow_selected_old/);
  });
  check('unknown old versions cannot select or override a preset', () => {
    for (const version of ['1.5.13', '1.5.16', '', '__proto__']) assert.throws(() => selectOldPreset(version), /old_version_not_allowed/);
  });
  check('new16 is strictly newer than either old preset; equal or older rejects', () => {
    for (const version of ['1.5.14', '1.5.15']) assert.doesNotThrow(() => assertNewerVersion('1.5.16', selectOldPreset(version).version));
    assert.throws(() => assertNewerVersion('1.5.15', '1.5.15'), /new_version_must_follow_selected_old/);
    assert.throws(() => assertNewerVersion('1.5.14', '1.5.15'), /new_version_must_follow_selected_old/);
    assert.doesNotThrow(() => assertNewerVersion('1.6.0', '1.5.15'));
  });
  check('version comparison refuses noncanonical or inexact integer components', () => {
    for (const version of ['1.5', '01.5.16', '1.5.16.1', '1.5.x', '9007199254740992.0.0']) assert.throws(() => assertNewerVersion(version, '1.5.15'));
  });

  check('direct-child exit metadata distinguishes SIGKILL from normal exit and waits for close', () => {
    assert.deepEqual(directAppExitFacts({ qaClosed: true, exitCode: null, signalCode: 'SIGKILL' }), {
      directAppExited: true, directAppCloseObserved: true, directAppExitCode: null, directAppSignal: 'SIGKILL' });
    assert.deepEqual(directAppExitFacts({ qaClosed: true, exitCode: 0, signalCode: null }), {
      directAppExited: true, directAppCloseObserved: true, directAppExitCode: 0, directAppSignal: null });
    assert.equal(directAppExitFacts({ qaClosed: false, exitCode: 0, signalCode: null }).directAppExited, false);
    assert.equal(directAppExitFacts({ qaClosed: false, exitCode: null, signalCode: null }).directAppExited, false);
  });
  console.log(JSON.stringify({ status: 'PASS_PURE_QA_CONTROLS_ONLY', passed, AppKitOrAppExecuted: false }));
}

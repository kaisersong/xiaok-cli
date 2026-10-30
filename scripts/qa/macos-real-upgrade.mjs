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
const DEFAULT_CDP_PORT = 9222; // Production default in both signed 1.5.14 and the new app.
const OLD14 = Object.freeze({ tag: 'desktop-v1.5.14', version: '1.5.14', release: 418149835,
  sha: 'dc221f9bac84d939b8fb543d4795396693fdc9b8', bytes: 228655718,
  zipSHA256: 'b7a3b6d6e23b5423d581f8b93ad05b82b34fc0fab429c14ea4c9736d358ebf37' });
const OLD15 = Object.freeze({ tag: 'desktop-v1.5.15', version: '1.5.15', release: 419987808,
  sha: '6770092945a42fb0e45ef0d68d0971bfc01b51a8', bytes: 231833178,
  zipSHA256: '1e6e73ca880994d6c7f23ef4919b020099e350702581040113beeb43779cc3c9' });
function selectOldPreset(version = '1.5.14') {
  if (version === '1.5.14') return OLD14;
  if (version === '1.5.15') return OLD15;
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
const START = performance.now();
const DEADLINE = START + 25 * 60_000; // New QA budget, not a product timeout change.
const qaUid = process.getuid?.();
const qaHome = homedir();
const owned = new Map();
const children = new Set();
let root, evidence, app, appExecutable, oldChild, oldIdentity, monitorPromise;
let monitorStopped = false, monitorError, latestGuiApplications = [], installedRequest = false;
let primary, resultFacts = {}, commandId = 0, cleaning = false, shipItSHA256, qaSourceBinding;
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
async function observeOwnedProcesses(rows, phase) {
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
      else {
        const previous = owned.get(row.pid), matches = sameProcessIdentity(previous, row);
        if (!matches) identityConflict(previous, row, phase, 'owned_pid_identity_changed');
        assert(matches, 'owned_pid_identity_changed');
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
function identityConflict(previous, current, phase, reason) {
  diagnosticEvent('owned-identity-conflict', { previous: previous ?? null, current: current ?? null, phase, reason, installedRequest,
    comparisons: { pid: previous?.pid === current?.pid, uid: previous?.uid === current?.uid,
      birth: previous?.birth === current?.birth, executable: previous?.executable === current?.executable } });
}
async function signalOwnedProcess(record, requestedSignal, { readProcesses = processes, sendSignal = (pid, signal) => process.kill(pid, signal) } = {}) {
  const live = (await readProcesses()).find(p => p.pid === record.pid);
  if (!live) return { kind: 'absent', pid: record.pid };
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
  const residual = after.filter(p => owned.has(p.pid));
  const facts = { failures, residual, ...directAppExitFacts(oldChild), adoptedProcessesReapedByRunner: false,
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
  await waitFor(async () => oldChild.qaClosed && oldChild.exitCode === 0, 120_000, 'old_app_did_not_exit');
  const restarted = await waitFor(async () => { await sample('relaunch'); return relaunchedGui(latestGuiApplications, oldIdentity, process.pid); }, 180_000, 'nsworkspace_did_not_relaunch_same_path');
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
if (process.argv.length === 3 && process.argv[2] === '--self-test') {
  await pureControls();
} else {
assert(process.argv.length === 2, 'qa_arguments');
try { await main(); if (monitorError) throw monitorError; } catch (e) { primary = { message: e.message, stack: e.stack }; }
finally {
  if (evidence) {
    try { await cleanup(); } catch (e) { primary ??= { message: e.message, stack: e.stack }; event('cleanup-failed', { message: e.message }); }
    if (qaDiagnostics.length && !primary) primary = { message: 'qa_diagnostic_evidence_unconfirmed' };
    save('RESULT.json', { oldVersion: OLD.version, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, qaDiagnostics, status: primary ? 'FAIL' : 'PASS_REAL_SIGNED_MAC_SHIPIT_UPGRADE', failure: primary ?? null, old: OLD, new: NEW, qaSourceBinding: qaSourceBinding ?? null, facts: resultFacts,
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
  const path = '/qa/installed/xiaok.app', exe = `${path}/Contents/MacOS/xiaok`, uid = 501;
  const old = { pid: 10, uid, birth: 'old-birth', executable: exe }, child = { ...old, pid: 11, birth: 'child-birth' };
  const registration = { pid: 10, bundleIdentifier: APP_ID, bundleURL: path, executableURL: exe, terminated: false };
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
    owned: new Map(owned), diagnostics: [...qaDiagnostics] };
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
    check('codesign success requires the complete successful process tuple', () => {
      const good = { spawnError: undefined, timedOut: false, code: 0, signal: null, actualWait: true, reaped: true, closeObserved: true };
      assert.equal(successfulCodesign(good), true);
      for (const [key, value] of [['spawnError', 'ENOENT'], ['timedOut', true], ['code', 1], ['signal', 'SIGKILL'], ['actualWait', false], ['reaped', false], ['closeObserved', false]]) assert.equal(successfulCodesign({ ...good, [key]: value }), false);
    });
  } finally {
    ({ root, evidence, app, appExecutable, oldChild, oldIdentity, primary, monitorError, installedRequest } = savedSignalState);
    owned.clear(); for (const [pid, record] of savedSignalState.owned) owned.set(pid, record);
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

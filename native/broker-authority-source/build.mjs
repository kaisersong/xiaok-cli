import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, realpathSync, statSync, lstatSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative, basename, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
// Build data only. No installed role, Main/helper launch, signing, or namespace.
const source = dirname(fileURLToPath(import.meta.url)), repo = resolve(source, '../..');
if (process.argv.length !== 4) throw Error('BROKER_AUTHORITY_BUILD_HEADERS_OUTPUT_REQUIRED');
const output = resolve(process.argv[3]), nativeBuild = process.platform === 'darwin';
const headers = nativeBuild ? realpathSync(process.argv[2]) : null;
if (headers && !lstatSync(join(headers, 'node_api.h')).isFile()) throw Error('BROKER_AUTHORITY_NODE_HEADERS_REQUIRED');
if (!existsSync(output)) mkdirSync(output, { recursive: true, mode: 0o700 });
if (lstatSync(output).isSymbolicLink() || !lstatSync(output).isDirectory() || realpathSync(output) !== output || readdirSync(output).length) throw Error('BROKER_AUTHORITY_BUILD_EMPTY_PRIVATE_OUTPUT_REQUIRED');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const inputs = new Map(), children = [];
const native = join(repo, 'native/root-resource-authority'), wire = join(repo, 'native/main-installation'), facade = join(repo, 'native/protected-sqlite-facade');
function capture(path) {
  path = realpathSync(path); if (inputs.has(path)) return;
  const facts = statSync(path, { bigint: true });
  inputs.set(path, { sha256: hash(path), bytes: String(facts.size), mtimeNs: String(facts.mtimeNs) });
  for (const match of readFileSync(path, 'utf8').matchAll(/^\s*#include\s+"([^"]+)"/gm)) {
    const next = [resolve(dirname(path), match[1]), ...[native, wire, facade, source, headers].filter(Boolean).map(dir => join(dir, match[1]))].find(existsSync);
    if (!next) throw Error('BROKER_AUTHORITY_INCLUDE_MISSING'); capture(next);
  }
}
function run(command, args) {
  const p = spawnSync(command, args, { cwd: repo, encoding: 'utf8', timeout: 60000 });
  children.push({ command, args, pid: p.pid, status: p.status, signal: p.signal, stdout: p.stdout, stderr: p.stderr });
  writeFileSync(join(output, 'build-runs.json'), JSON.stringify(children, null, 2) + '\n');
  if (p.error) throw p.error;
  if (p.status !== 0 || p.signal) throw Error('BROKER_AUTHORITY_BUILD_FAILED: ' + (p.stderr || p.stdout));
  return p.stdout;
}
const files = [], architectures = [];
if (nativeBuild) {
  const sdk = run('/usr/bin/xcrun', ['--show-sdk-path']).trim();
  const common = ['-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0', '-Werror', '-Werror=unguarded-availability-new', '-Wno-deprecated-declarations', '-ffile-prefix-map=' + repo + '=xiaok-cli', '-isysroot', sdk, '-std=c11', '-I', headers, '-I', native, '-I', wire, '-I', facade, '-I', source, '-DNAPI_VERSION=8'];
  const addon = [join(source, 'broker-child-addon.c'), join(facade, 'protected-sqlite-facade.c'), join(native, 'original-root-io-vfs.c'), join(native, 'installed-main-client.c'), join(wire, 'wire.c')];
  for (const path of [...addon, join(source, 'broker-child-launcher.c')]) capture(path);
  run('/usr/bin/cc', [...common, '-bundle', '-undefined', 'dynamic_lookup', ...addon, '-lsqlite3', '-framework', 'Security', '-lbsm', '-o', join(output, 'protected_sqlite.node')]);
  run('/usr/bin/cc', [...common, join(source, 'broker-child-launcher.c'), join(wire, 'wire.c'), '-framework', 'Security', '-lbsm', '-o', join(output, 'broker-child-launcher')]);
  chmodSync(join(output, 'broker-child-launcher'), 0o500);
  for (const [path, name] of [[join(facade, 'index.cjs'), 'index.cjs'], [join(source, 'original-authority-sqlite.cjs'), 'original-authority-sqlite.cjs']]) { capture(path); copyFileSync(path, join(output, name)); }
  files.push('protected_sqlite.node', 'broker-child-launcher', 'index.cjs', 'original-authority-sqlite.cjs');
  architectures.push(...run('/usr/bin/lipo', ['-archs', join(output, 'protected_sqlite.node')]).trim().split(/\s+/).sort());
  if (JSON.stringify(architectures) !== JSON.stringify(['arm64', 'x86_64'])) throw Error('BROKER_AUTHORITY_UNIVERSAL_REQUIRED');
}
run(process.execPath, [join(repo, 'native/sidecar-source-runtime/build.mjs'), join(output, 'xiaok-source-runtime.cjs')]);
files.push('xiaok-source-runtime.cjs');
const runtime = JSON.parse(readFileSync(join(output, 'xiaok-source-runtime.cjs.manifest.json'), 'utf8'));
for (const [path, facts] of Object.entries(runtime.inputs)) inputs.set(path, { ...facts, bytes: String(facts.bytes) });
for (const [path, facts] of inputs) {
  const current = statSync(path, { bigint: true });
  if (hash(path) !== facts.sha256 || String(current.mtimeNs) !== facts.mtimeNs) throw Error('BROKER_AUTHORITY_SOURCE_DRIFT');
}
writeFileSync(join(output, 'source-manifest.json'), JSON.stringify({ kind: 'original_broker_authority_build_v1', inputs: Object.fromEntries(inputs), children, fixture: false, qualification: false }, null, 2) + '\n');
const distributedInputs = [...inputs].map(([path, facts]) => {
  const local = relative(repo, path), inside = local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local);
  return { path: inside ? local.split('\\').join('/') : 'node-headers/' + basename(path), sha256: facts.sha256, bytes: facts.bytes };
}).sort((a, b) => a.path.localeCompare(b.path));
const artifacts = files.map(path => ({ path, sha256: hash(join(output, path)), bytes: statSync(join(output, path)).size }));
const portableInputs = Object.entries(runtime.inputs).map(([path, facts]) => ({ path: relative(repo, path).split('\\').join('/'), sha256: facts.sha256, bytes: String(facts.bytes) })).sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(join(output, 'source-runtime-manifest.json'), JSON.stringify({ kind: 'original_broker_portable_runtime_v1', target: 'node22.14', inputs: portableInputs, files: artifacts.filter(row => row.path === 'xiaok-source-runtime.cjs'), qualification: false }, null, 2) + '\n');
writeFileSync(join(output, 'artifact-manifest.json'), JSON.stringify({ kind: 'original_broker_authority_artifacts_v1', platform: process.platform, architectures, napiVersion: nativeBuild ? 8 : null, minimumMacOS: nativeBuild ? '11.0' : null, protectedSQLiteApiMinimumMacOS: nativeBuild ? '12.3' : null, inputs: distributedInputs, files: artifacts, qualification: false, installed: false }, null, 2) + '\n');
console.log(JSON.stringify({ output, nativeBuild, files: artifacts.length, fixture: false, installed: false, qualification: false }));

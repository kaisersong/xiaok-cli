import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Existing gates succeed; the new service gate must still reject missing resources.
for (const name of ['verify-packaged-main-freshness','verify-packaged-runtime-dependencies','pack-bundled-runtimes']) {
  const path = require.resolve(`../../desktop/scripts/${name}.cjs`);
  require.cache[path] = { id: path, filename: path, loaded: true, exports: async () => {} };
}
const afterPack = require('../../desktop/scripts/after-pack.cjs');
test('every Desktop packaging entry rejects absent sidecars before release', async () => {
  await assert.rejects(afterPack({ electronPlatformName: 'linux', appOutDir: '/missing-pack-fixture',
    packager: { projectDir: '/missing-desktop-fixture' } }), /packaged service contract/);
});

import { mkdtemp, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync, readFileSync } from 'node:fs';
const { verify, validateHealth, pluginFiles } = require('../../desktop/scripts/verify-packaged-service-contracts.cjs');
const main = resolve(process.env.XIAOK_PACK_CONTRACT_TEST_ROOT ?? resolve(import.meta.dirname, '../..'));
const siblings = resolve(main, '..');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pack-sidecar-test-'));
  const resources = join(root, 'resources');
  for (const name of ['kswarm','intent-broker']) {
    const target = join(resources, 'services', name); await mkdir(target, { recursive: true });
    for (const part of ['src','package.json','node_modules/ws', ...(name === 'kswarm' ? ['scripts'] : ['adapters','bin'])]) {
      await cp(join(siblings, name, part), join(target, part), { recursive: true, dereference: true });
    }
  }
  for (const name of ['kai-report-creator','kai-slide-creator','cua-computer-use','kai-infinity-canvas','kai-meeting-assistant']) {
    await cp(join(siblings, 'kai-xiaok-plugins', 'plugins', name), join(resources, 'bundled-plugins', name), {
      recursive: true, filter: source => !source.split(/[\\/]/).includes('node_modules'),
    });
  }
  return { root, resources, projectDir: join(main, 'desktop') };
}
test('actual copied current services and report Tasks bundle pass without user services', { timeout: 25000 }, async () => {
  const f = await fixture();
  try { const result = await verify(f); assert.equal(result.length, 7); }
  finally { await rm(f.root, { recursive: true, force: true, maxRetries: 5 }); }
});
test('new manifest cannot hide an old actual synchronous report bundle', { timeout: 25000 }, async () => {
  const f = await fixture();
  try {
    const oldBundle = execFileSync('git', ['show', '3395d845a9041c6f101b194751e8544bc640f6c5:plugins/kai-report-creator/mcp-servers/report-renderer/dist/server.bundle.js'], { cwd: join(siblings, 'kai-xiaok-plugins'), maxBuffer: 16 * 1024 * 1024 });
    await writeFile(join(f.resources, 'bundled-plugins/kai-report-creator/mcp-servers/report-renderer/dist/server.bundle.js'), oldBundle);
    await assert.rejects(verify(f), /render_report returned synchronously|Tasks capability absent/);
  } finally { await rm(f.root, { recursive: true, force: true, maxRetries: 5 }); }
});
test('a merely healthy old service cannot satisfy current process and workspace contracts', () => {
  assert.throws(() => validateHealth('kswarm', { ok: true }, { pid: 1 }, import.meta.filename), /current process\/entry identity/);
  const health = { ok: true, service: { pid: 1, instanceId: 'fixture', entryPath: realpathSync(import.meta.filename),
    entryHash: createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex'), sourceHash: 'a'.repeat(64) } };
  assert.throws(() => validateHealth('intent-broker', health, { pid: 1 }, import.meta.filename), /room_workspace_v1/);
});
test('a copied service missing an imported module blocks the package with component diagnostics', { timeout: 25000 }, async () => {
  const f = await fixture();
  try {
    await rm(join(f.resources, 'services/kswarm/src/core/project-activity.js'));
    await assert.rejects(verify(f), /kswarm@.*isolated startup failed/);
  } finally { await rm(f.root, { recursive: true, force: true, maxRetries: 5 }); }
});
test('an unhealthy source times out and its owned process is stopped', { timeout: 25000 }, async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.resources, 'services/kswarm/src/server/index.js'), 'process.stdout.write("PROBE_PID="+process.pid); setInterval(()=>{},1000);');
    let failure;
    try { await verify({ ...f, timeoutMs: 250 }); } catch (error) { failure = error; }
    assert.match(failure?.message ?? '', /health timeout/);
    const pid = Number(/PROBE_PID=(\d+)/.exec(failure.message)?.[1]);
    assert.ok(pid > 0);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { await rm(f.root, { recursive: true, force: true, maxRetries: 5 }); }
});
test('packaged Plugin entry outside its directory is rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pack-plugin-path-'));
  const plugin = join(root, 'bundled-plugins', 'kai-report-creator');
  try {
    await mkdir(plugin, { recursive: true }); await writeFile(join(root, 'outside.js'), '');
    await writeFile(join(plugin, 'plugin.json'), JSON.stringify({ name: 'kai-report-creator', version: '2.5.0', mcpServers: [{ args: ['../../outside.js'], protocol: { mode: 'modern', version: '2026-07-28' } }] }));
    assert.throws(() => pluginFiles(root), /escaping packaged file/);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
});

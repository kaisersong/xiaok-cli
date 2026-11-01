// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { finished } from 'node:stream/promises';
import { createPackageWithOptions, extractFile, statFile, uncache } from '@electron/asar';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 }); });
function pkg(root: string, name: string, version: string, dependencies = {}, optionalDependencies = {}) {
  const dest = join(root, 'node_modules', name); mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'package.json'), JSON.stringify({ name, version, main: 'index.js', dependencies, optionalDependencies }));
  writeFileSync(join(dest, 'index.js'), `module.exports = ${JSON.stringify(version)};`); return dest;
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-copy-deps-')); roots.push(root);
  const projectDir = join(root, 'installed'), app = join(root, 'app'), asarPath = join(root, 'app.asar');
  mkdirSync(projectDir); mkdirSync(app);
  const manifest = { dependencies: { parent: '1.0.0', other: '1.0.0' } };
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(app, 'package.json'), JSON.stringify(manifest));
  pkg(projectDir, 'parent', '1.0.0', { leaf: '^1.0.0' });
  pkg(projectDir, 'other', '1.0.0', { leaf: '^2.0.0' });
  pkg(projectDir, 'leaf', '1.0.0', { parent: '1.0.0' }, { absent: '*' });
  pkg(join(projectDir, 'node_modules', 'other'), 'leaf', '2.0.0');
  pkg(app, 'parent', '1.0.0', { leaf: '^1.0.0' });
  mkdirSync(join(app, 'dist')); writeFileSync(join(app, 'dist', 'native.node'), 'preserved-unpacked');
  await finished(await createPackageWithOptions(app, asarPath, { unpack: '**/*.node' }), { cleanup: true });
  return { root, projectDir, app, asarPath };
}
function copy(options: any) { return require('../../scripts/copy-packaged-dependencies.cjs').copyPackagedDependencies(options); }
describe('production dependency closure copy', () => {
  it('repairs the actual cross-spawn closure and passes the unchanged packaged Electron import gate', async () => {
    const f = await fixture();
    rmSync(join(f.projectDir, 'node_modules'), { recursive: true });
    symlinkSync(join(process.cwd(), 'node_modules'), join(f.projectDir, 'node_modules'), 'junction');
    const manifest = { dependencies: { 'cross-spawn': '7.0.6' } };
    writeFileSync(join(f.app, 'package.json'), JSON.stringify(manifest));
    mkdirSync(join(f.app, 'dist', 'main'), { recursive: true });
    writeFileSync(join(f.app, 'dist', 'main', 'entry.js'), "import spawn from 'cross-spawn';\n");
    await finished(await createPackageWithOptions(f.app, f.asarPath, {}), { cleanup: true }); uncache(f.asarPath);
    const { verifyPackagedRuntimeDependencies: verify } = require('../../scripts/verify-packaged-runtime-dependencies.cjs');
    const options = { asarPath: f.asarPath, electronPath: require('electron') };
    expect(() => verify(options)).toThrow(/packaged runtime verification failed/);
    await copy(f);
    expect(verify(options)).toEqual({ specifiers: ['cross-spawn'], runtimeVerified: true });
  });

  it('fills transitive dependencies, keeps nested versions and terminates cycles without installing optional missing packages', async () => {
    const f = await fixture(); const result = await copy(f);
    expect(result.copied.length).toBeGreaterThan(0);
    expect(JSON.parse(extractFile(f.asarPath, normalize('node_modules/leaf/package.json')).toString()).version).toBe('1.0.0');
    expect(JSON.parse(extractFile(f.asarPath, normalize('node_modules/other/node_modules/leaf/package.json')).toString()).version).toBe('2.0.0');
    expect(extractFile(f.asarPath, normalize('dist/native.node')).toString()).toBe('preserved-unpacked');
    expect(statFile(f.asarPath, normalize('dist/native.node')).unpacked).toBe(true);
    const bytes = readFileSync(f.asarPath); expect((await copy(f)).copied).toEqual([]);
    expect(readFileSync(f.asarPath).equals(bytes)).toBe(true);
  });
  it('fails closed on a missing required installed dependency and leaves the original archive untouched', async () => {
    const f = await fixture(); rmSync(join(f.projectDir, 'node_modules', 'leaf'), { recursive: true });
    const before = readFileSync(f.asarPath);
    await expect(copy(f)).rejects.toThrow(/missing required.*leaf/);
    uncache(f.asarPath); expect(readFileSync(f.asarPath).equals(before)).toBe(true);
  });
  it('rejects mismatched packaged dependency versions instead of silently replacing existing code', async () => {
    const f = await fixture(); pkg(f.app, 'parent', '9.0.0');
    await finished(await createPackageWithOptions(f.app, f.asarPath, { unpack: '**/*.node' }), { cleanup: true }); uncache(f.asarPath);
    await expect(copy(f)).rejects.toThrow(/version mismatch.*parent/);
  });
});

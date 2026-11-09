import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
const require = createRequire(import.meta.url), roots: string[] = [];
const repo = resolve(__dirname, '../../..');
function fixture(loadVerifier = true) {
  const verifier = loadVerifier ? require('../../scripts/verify-packaged-continuity-source.cjs').verify : null;
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'xiaok-continuity-artifact-'))); roots.push(root);
  const put = (name: string, value = 'fixture') => { const file = join(root, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value); };
  for (const name of ['continuity-sync', 'continuity-device']) {
    cpSync(join(repo, 'services', name, 'src'), join(root, 'services', name, 'src'), { recursive: true });
    cpSync(join(repo, 'services', name, 'package.json'), join(root, 'services', name, 'package.json'));
  }
  put('continuity-native/auth-owner.json', readFileSync(join(repo, 'services/continuity-native/auth-owner.json'), 'utf8'));
  for (const [location, name, version] of [
    ['continuity-sync/node_modules/libsodium', 'libsodium', '0.8.4'],
    ['continuity-sync/node_modules/libsodium-wrappers', 'libsodium-wrappers', '0.8.4'],
    ['continuity-device/node_modules/@napi-rs/keyring', '@napi-rs/keyring', '2.1.1'],
    ['continuity-device/node_modules/@napi-rs/keyring-darwin-arm64', '@napi-rs/keyring-darwin-arm64', '2.1.1'],
  ]) put('services/' + location + '/package.json', JSON.stringify({ name, version }));
  for (const pkg of ['libsodium', 'libsodium-wrappers']) for (const [folder, ext] of [['modules', 'js'], ['modules-esm', 'mjs']]) put(`services/continuity-sync/node_modules/${pkg}/dist/${folder}/${pkg}.${ext}`);
  put('services/continuity-device/node_modules/@napi-rs/keyring/index.js');
  put('services/continuity-device/node_modules/@napi-rs/keyring-darwin-arm64/keyring.darwin-arm64.node');
  mkdirSync(join(root, 'continuity-auth/darwin-arm64'), { recursive: true });
  return { root, put, verify: (platform = 'darwin', arch = 'arm64') => verifier({ resources: root, platform, arch }) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('actual packaged continuity source boundary', () => {
  it.each([['darwin', 'arm64'], ['win32', 'x64'], ['linux', 'x64']])('reports only inactive source completeness for %s/%s without inventing a native binary', (platform, arch) => {
    const f = fixture(); expect(f.verify(platform, arch)).toMatchObject({ sourceComplete: true, nativeRuntimeQualified: false, nativeArtifact: 'absent-inactive' });
  });
  it('rejects a missing source module', () => { const f = fixture(); rmSync(join(f.root, 'services/continuity-sync/src/device-owner.mjs')); expect(() => f.verify()).toThrow(); });
  it('rejects source bytes differing from the actual build input', () => { const f = fixture(); f.put('services/continuity-sync/src/device-owner.mjs', 'changed'); expect(() => f.verify()).toThrow(/source/); });
  it('rejects wrong private dependency versions', () => { const f = fixture(); f.put('services/continuity-sync/node_modules/libsodium/package.json', JSON.stringify({ name: 'libsodium', version: '0.0.0' })); expect(() => f.verify()).toThrow(/version/); });
  it.each([true, undefined])('rejects an unsupported native qualification value %s', value => {
    const f = fixture(), file = join(f.root, 'continuity-native/auth-owner.json'), metadata = JSON.parse(readFileSync(file, 'utf8'));
    metadata.physicalManagedOAuthQualified = value; writeFileSync(file, JSON.stringify(metadata)); expect(() => f.verify()).toThrow(/qualification/);
  });
  it('requires the exact native keyring resource for the originally supported target', () => { const f = fixture(); rmSync(join(f.root, 'services/continuity-device/node_modules/@napi-rs/keyring-darwin-arm64/keyring.darwin-arm64.node')); expect(() => f.verify()).toThrow(); });
  it.skipIf(process.platform === 'win32')('rejects a source symlink instead of accepting matching bytes outside the artifact', () => {
    const f = fixture(), file = join(f.root, 'services/continuity-sync/src/device-owner.mjs'); rmSync(file); symlinkSync(join(repo, 'services/continuity-sync/src/device-owner.mjs'), file); expect(() => f.verify()).toThrow();
  });
  it('preserves the original strict native verifier missing-binary rejection', () => {
    const f = fixture(false); expect(() => require('../../scripts/verify-packaged-continuity-resources.cjs').verify({ resources: f.root, platform: 'darwin', arch: 'arm64' })).toThrow(/codex-app-server/);
  });
});

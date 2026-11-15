import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {withMacOSMinimumRelease} from '../../scripts/macos-release-policy.mjs';
const require = createRequire(import.meta.url);
const source = 'version: 1.6.4\nfiles:\n  - url: xiaok-1.6.4-arm64-mac.zip\n    sha512: unchanged\npath: xiaok-1.6.4-arm64-mac.zip\nsha512: unchanged\n';
test('the installer declares macOS 13.5 independently of the Darwin update bound', () => {
  const config = JSON.parse(readFileSync(new URL('../../desktop/electron-builder.json', import.meta.url), 'utf8'));
  assert.equal(config.mac.minimumSystemVersion, '13.5');
});
test('adds the Darwin lower bound without rewriting asset metadata and is idempotent', () => {
  const result = withMacOSMinimumRelease(source);
  assert.equal(result, source + 'minimumSystemVersion: 22.6.0\n');
  assert.equal(withMacOSMinimumRelease(result), result);
  assert.equal(withMacOSMinimumRelease(source + 'minimumSystemVersion: 13.5\n'), result);
  assert.throws(() => withMacOSMinimumRelease(source + 'minimumSystemVersion: 22.6.0\nminimumSystemVersion: 23.0.0\n'), /duplicate/);
});
test('the production updater rejects Darwin 21 and 22.5 but admits 22.6 and later', () => {
  const os = require('node:os');
  const original = os.release;
  const {AppUpdater} = require('../../desktop/node_modules/electron-updater/out/AppUpdater.js');
  const minimumSystemVersion = /^minimumSystemVersion: (.+)$/m.exec(withMacOSMinimumRelease(source))[1];
  try {
    for (const [release, accepted] of [['21.6.0', false], ['22.5.0', false], ['22.6.0', true], ['23.0.0', true]]) {
      os.release = () => release;
      assert.equal(AppUpdater.prototype.checkIfUpdateSupported.call({_logger: {info() {}, warn() {}}}, {minimumSystemVersion}), accepted, release);
    }
  } finally { os.release = original; }
});

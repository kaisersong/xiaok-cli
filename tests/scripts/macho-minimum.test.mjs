import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertMacOS12Deployment} from '../native/helpers/macho-minimum.mjs';
const modern = min => `Load command 1\n      cmd LC_BUILD_VERSION\n  cmdsize 32\n platform 1\n    minos ${min}\n      sdk 26.5\n   ntools 1\n`;
const legacy = 'Load command 2\n      cmd LC_VERSION_MIN_MACOSX\n  cmdsize 16\n  version 11.0\n      sdk 14.0\n';
test('parses modern and legacy minimums while ignoring SDK version', () => {
  assert.deepEqual(assertMacOS12Deployment(modern('12.0')), ['12.0']);
  assert.deepEqual(assertMacOS12Deployment(legacy), ['11.0']);
});
test('checks all universal slices and rejects a newer or missing second slice', () => {
  const fat = second => '/tmp/Electron (architecture arm64):\n' + modern('12.0') + '/tmp/Electron (architecture x86_64):\n' + second;
  assert.deepEqual(assertMacOS12Deployment(fat(legacy)), ['12.0', '11.0']);
  assert.throws(() => assertMacOS12Deployment(fat(modern('13.0'))), /unsupported/);
  assert.throws(() => assertMacOS12Deployment(fat('Load command 0\n cmd LC_UUID\n')), /missing/);
});
test('fails closed on absent, malformed, ambiguous and macOS 12.1 targets', () => {
  for (const text of ['', modern('unknown'), modern('12.1'), modern('12.0') + legacy]) {
    assert.throws(() => assertMacOS12Deployment(text));
  }
});

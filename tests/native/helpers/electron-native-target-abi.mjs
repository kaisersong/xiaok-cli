import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {realpathSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

// Inspect the actual copied target image, not the Node process running tests.
export function assertElectronNativeTargetSymbols(binary, executable, receiptFile) {
  const framework = realpathSync(join(dirname(dirname(executable)),
    'Frameworks', 'Electron Framework.framework', 'Electron Framework'));
  const required = spawnSync('/usr/bin/nm', ['-u', binary], {encoding: 'utf8'});
  const provided = spawnSync('/usr/bin/nm', ['-gU', framework], {encoding: 'utf8'});
  assert.equal(required.status, 0, required.stderr); assert.equal(provided.status, 0, provided.stderr);
  const exported = new Set(provided.stdout.split('\n').map(line => line.trim().split(/\s+/).at(-1)));
  const symbols = required.stdout.split('\n').map(line => line.trim()).filter(symbol =>
    /N(?:K)?(?:2v8|4node)/.test(symbol));
  const missing = symbols.filter(symbol => !exported.has(symbol));
  const receipt = {framework, requiredSymbols: symbols, missing, targetElectronFramework: true};
  writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  assert.deepEqual(missing, [], 'Native V8/Node symbols must exist in the actual target Electron');
  return receipt;
}

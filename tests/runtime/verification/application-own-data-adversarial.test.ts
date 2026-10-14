import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Native replacements run in fresh processes so neither Vitest nor a prior
// decoded artifact cache can hide dispatch. The worker imports real production
// first, prepares baseline/fresh/recovery fixtures, restores, then serializes.
interface AdversarialCase { kind: string; id: string; [key: string]: unknown }
const manifest = JSON.parse(readFileSync(new URL('../../support/application-own-data-adversarial-cases.json', import.meta.url), 'utf8')) as {
  matrix: AdversarialCase[]; cases: AdversarialCase[];
};
const worker = fileURLToPath(new URL('../../support/application-own-data-adversarial-worker.mjs', import.meta.url));
const loader = createRequire(import.meta.url).resolve('tsx');
function run(row: AdversarialCase) {
  const loaderArgs = worker.includes(sep+'.test-dist'+sep) ? [] : ['--import', loader];
  const child = spawnSync(process.execPath, [...loaderArgs, worker, JSON.stringify(row)], {
    encoding: 'utf8', timeout: 10_000,
  });
  expect(child.status, child.stderr).toBe(0);
  const receipt = JSON.parse(child.stdout.trim());
  expect(receipt.setupError).toBeUndefined();
  expect(receipt.pass, JSON.stringify(receipt)).toBe(true);
  return receipt;
}
describe('application own-data existing error order characterization', () => {
  it.each(manifest.matrix.map(row => [row.id, row] as const))('%s', (_id, row) => {
    const receipt = run(row);
    expect(receipt.getterCalls).toBe(0);
    expect(receipt.error).toBe(row.expectedError);
  });
});
describe('application own-data native and exported-array replacement regressions', () => {
  // Preserve all 100 families/980 variants, 6 malformed error branches,
  // 5 exported arrays, and 7 ASCII boundaries with 6 separate poison operations.
  // Descriptor cases include original snapshots and producer/reader sibling paths.
  it.each(manifest.cases.map(row => [row.compatibilityCharacterization ? 'compatibility characterization '+row.id : row.id, row] as const))('%s', (_id, row) => {
    const receipt = run(row);
    if (row.compatibilityCharacterization) {
      expect(receipt.poisonCalls).toBe(1);
      expect(receipt.patched).toEqual({success:false,error:'loop_application_trigger'});
      expect(receipt.artifactReturned).toBe(false);
    } else { expect(receipt.poisonCalls).toBe(0); expect(receipt.patched).toEqual(receipt.baseline); }
    expect(receipt.installationError).toBeUndefined();
    if (row.kind !== 'export') expect(receipt.descriptorRestored).toBe(true);
    expect(receipt.restored).toEqual(receipt.baseline);
  });
});

import { ownDataFixedAsciiEscape } from '../../../src/runtime/verification/application-native-intrinsics.js';
import { ASCII_ESCAPE_BOUNDARIES } from '../../support/application-own-data-r65-ascii-boundaries.js';
describe('actual fixed ASCII escaping preserves UTF-16 boundary semantics', () => {
  it.each(ASCII_ESCAPE_BOUNDARIES.map(row => [row.id, row] as const))('%s', (_id, row) => {
    // Literal expectations are independently frozen design vectors. This calls
    // the production helper, including raw lone surrogates; reader cases remain
    // separate because well-formed JSON preescapes those code units.
    expect(ownDataFixedAsciiEscape(row.input)).toBe(row.expectedEscape);
    expect(ownDataFixedAsciiEscape(row.canonicalJson)).toBe(row.expectedCanonicalEscape);
  });
});

import { ownDataArrayPrototypeMap, ownDataArrayPrototypeFilter, ownDataArrayPrototypeFlatMap } from '../../../src/runtime/verification/application-native-intrinsics.js';
describe('species-free loops preserve native callback and hole behavior', () => {
  it('map preserves captured length, input indices and trailing holes', () => {
    const input: number[] = []; input.length = 4; input[1] = 3;
    const seen: number[] = [];
    const result = ownDataArrayPrototypeMap(input, (value, index, array) => {
      expect(array).toBe(input); seen.push(index); input.push(99); return value + 1;
    });
    expect(seen).toEqual([1]); expect(result.length).toBe(4);
    expect(Object.keys(result)).toEqual(['1']); expect(result[1]).toBe(4);
  });
  it('filter includes inherited indices and returns a dense ordinary array', () => {
    const input: number[] = []; input.length = 3; input[2] = 9;
    const prototype = Object.create(Array.prototype, {0: {value: 7, configurable: true}});
    Object.setPrototypeOf(input, prototype);
    const seen: number[] = [];
    const result = ownDataArrayPrototypeFilter(input, (value, index) => {seen.push(index); return value > 0;});
    expect(seen).toEqual([0,2]); expect(result).toEqual([7,9]); expect(Object.getPrototypeOf(result)).toBe(Array.prototype);
  });
  it('flatMap skips holes and flattens only one level', () => {
    const input = [1, , 2];
    const dense = ownDataArrayPrototypeFlatMap(input, value => [value, , value! + 1]);
    expect(dense).toEqual([1,2,2,3]);
    expect(ownDataArrayPrototypeFlatMap([1,2], value => [[value]])).toEqual([[1],[2]]);
  });
  it('preserves thisArg, three callback arguments and the original thrown error', () => {
    const context = {id:'context'}, input = [3,4], sentinel = Error('callback_sentinel');
    type NumberOperation = (
      value: readonly number[],
      callback: (value: number, index: number, array: number[]) => number,
      thisArg?: unknown,
    ) => number[];
    const operations: readonly NumberOperation[] = [
      ownDataArrayPrototypeMap, ownDataArrayPrototypeFilter, ownDataArrayPrototypeFlatMap,
    ];
    for (const invoke of operations) {
      const seen: number[] = [];
      expect(() => invoke(input, function(this: typeof context, value, index, array) {
        expect(this).toBe(context); expect(array).toBe(input); expect(value).toBe(input[index]); seen.push(index);
        if (index === 1) throw sentinel;
        return value;
      },context)).toThrow(sentinel);
      expect(seen).toEqual([0,1]);
    }
  });
});

// Fixed child entry. Importing the original algorithm does not run a search.
// Only the Native-owned stdin GO frame can supply the original request.
import { readFileSync, writeSync, closeSync } from 'node:fs';
import { createHash, Hash } from 'node:crypto';
import { getHeapStatistics } from 'node:v8';
import { types } from 'node:util';
import { searchBoundedGlob } from './bounded-glob-body.mjs';

const apply = Reflect.apply;
const hashUpdate = Hash.prototype.update;
const hashDigest = Hash.prototype.digest;
const parse = JSON.parse;
const stringify = JSON.stringify;
const [nonce, expectedHash] = process.argv.slice(2);
const codes = new Set([
  'glob_scan_limit', 'glob_result_limit', 'glob_worker_heap_config',
  'grep_scan_limit', 'grep_result_limit', 'grep_invalid_regex',
  'grep_native_regex_profile_unavailable',
]);
function hash(value) {
  const state = createHash('sha256');
  apply(hashUpdate, state, [value]);
  return apply(hashDigest, state, ['hex']);
}
function errorCode(raw) {
  const field = raw && typeof raw === 'object' && !types.isProxy(raw)
    ? Object.getOwnPropertyDescriptor(raw, 'message') : undefined;
  return field && Object.hasOwn(field, 'value') && codes.has(field.value)
    ? field.value : 'glob_search_failed';
}
if (!/^[a-f0-9]{64}$/.test(nonce ?? '') || !/^[a-f0-9]{64}$/.test(expectedHash ?? ''))
  throw Error('READONLY_LEAF_BOOTSTRAP_INVALID');
if (getHeapStatistics().heap_size_limit > 128 * 1024 * 1024)
  throw Error('glob_worker_heap_config');

// This frame is not an authority certificate. The original Native parent must
// verify the actual child/kernel sandbox and commit its binding before GO.
writeSync(3, `READY ${nonce} ${expectedHash}\n`);
closeSync(3);
let output;
try {
  const bytes = readFileSync(0, 'utf8');
  const split = bytes.indexOf('\n');
  if (split < 0 || bytes.slice(0, split) !== `GO ${nonce} ${expectedHash}`)
    throw Error('READONLY_LEAF_GO_INVALID');
  const specCanonical = bytes.slice(split + 1);
  if (hash('["original-process-spec-v1",' + specCanonical + ']') !== expectedHash)
    throw Error('READONLY_LEAF_GO_INVALID');
  const spec = parse(specCanonical);
  if (spec?.kind !== 'worker' || !spec.options?.workerData)
    throw Error('READONLY_LEAF_INPUT_INVALID');
  const {input, limits, nativeSearchProfile} = spec.options.workerData;
  output = {ok: true, entries: await searchBoundedGlob(input, limits, nativeSearchProfile)};
} catch (raw) {
  output = {ok: false, code: errorCode(raw)};
}
writeSync(1, stringify(output));
closeSync(0);

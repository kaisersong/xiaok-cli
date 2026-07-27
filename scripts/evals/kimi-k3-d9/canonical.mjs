import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CANONICAL_JSON_V1_ENCODER_ID,
  canonicalJsonV1,
} from '../../../dist/ai/runtime/canonical-json.js';

const HELPER_RELATIVE_PATH = 'dist/ai/runtime/canonical-json.js';
const helperUrl = new URL('../../../dist/ai/runtime/canonical-json.js', import.meta.url);
const helperSha256 = createHash('sha256')
  .update(readFileSync(helperUrl))
  .digest('hex');

export const CANONICAL_HELPER_ATTESTATION = Object.freeze({
  encoderId: CANONICAL_JSON_V1_ENCODER_ID,
  helperRelativePath: HELPER_RELATIVE_PATH,
  helperSha256,
});

export function canonicalize(value) {
  return canonicalJsonV1(value);
}

export function canonicalSha256(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

export async function getCanonicalHelperAttestation() {
  return CANONICAL_HELPER_ATTESTATION;
}

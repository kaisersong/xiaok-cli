import { createHash } from 'node:crypto';
import { canonicalJsonV1 } from '../../../dist/ai/runtime/canonical-json.js';

const MAX_U64 = 18_446_744_073_709_551_615n;
const COUNTER_FIELDS = Object.freeze([
  'fixtureMcpInvocation',
  'networkRequest',
  'evidenceWrite',
  'childSpawn',
  'filesystemWrite',
  'externalIpc',
]);

function fail(code) {
  throw new Error(code);
}

function assertIdentity(identity) {
  if (
    identity === null
    || typeof identity !== 'object'
    || !/^[0-9a-f]{64}$/u.test(identity.armNonceHex)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      .test(identity.sessionInvocationUuid)
    || typeof identity.invocationIndex !== 'bigint'
    || identity.invocationIndex < 0n
  ) {
    fail('KIMI_D9_COUNTER_IDENTITY_INVALID');
  }
  if (identity.invocationIndex > MAX_U64) {
    fail('KIMI_D9_COUNTER_INDEX_OVERFLOW');
  }
}

export function deriveCounterNamespaceKey(identity) {
  assertIdentity(identity);
  const canonical = canonicalJsonV1({
    armNonceHex: identity.armNonceHex,
    invocationIndexU64beHex: identity.invocationIndex.toString(16).padStart(16, '0'),
    sessionInvocationUuid: identity.sessionInvocationUuid,
    v: 1,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export class InvocationCounterStore {
  #records = new Map();

  accept(key) {
    if (!/^[0-9a-f]{64}$/u.test(key)) {
      fail('KIMI_D9_COUNTER_KEY_INVALID');
    }
    if (this.#records.has(key)) {
      fail('KIMI_D9_COUNTER_REPLAY');
    }
    this.#records.set(key, Object.fromEntries(COUNTER_FIELDS.map((field) => [field, 0])));
  }

  increment(key, field) {
    const counters = this.#records.get(key);
    if (!counters) {
      fail('KIMI_D9_COUNTER_UNKNOWN_KEY');
    }
    if (!COUNTER_FIELDS.includes(field)) {
      fail('KIMI_D9_COUNTER_FIELD_INVALID');
    }
    if (!Number.isSafeInteger(counters[field]) || counters[field] === Number.MAX_SAFE_INTEGER) {
      fail('KIMI_D9_COUNTER_OVERFLOW');
    }
    counters[field] += 1;
  }

  snapshot(key) {
    const counters = this.#records.get(key);
    if (!counters) {
      fail('KIMI_D9_COUNTER_UNKNOWN_KEY');
    }
    return Object.freeze({ ...counters });
  }
}

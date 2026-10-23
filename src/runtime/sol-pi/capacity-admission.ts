import { isFrozenDeepSeekCounter, countDeepSeekSerializedRequest, type FrozenDeepSeekCounter } from './deepseek-capacity-profile.js';
import { createTransportAuthorizationError } from './transport-lease.js';

export interface VerifiedCapacityProfile { readonly opaqueCapacityProfile: never }
interface Profile {
  readonly qualification: 'test-fixture' | 'official-deepseek-recipe';
  readonly destination: string;
  readonly model: string;
  readonly windowTokens: number;
  readonly outputLimitField: string;
  readonly defaultOutputTokens?: number;
  readonly safetyMarginTokens: number;
  readonly countSerializedInput: (body: string) => number;
}
const profiles = new WeakMap<object, Readonly<Profile>>();
function fail(reason = 'CAPACITY_NOT_READY'): never {
  const error = createTransportAuthorizationError(); error.message += `:${reason}`; throw error;
}
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }

/** Explicit host-frozen official recipe only; no automatic dependency provisioning. */
export function resolveProductionCapacityProfile(identity: { destination: string; model: string; protocol?: string; profileId?: string; counter?: FrozenDeepSeekCounter }): VerifiedCapacityProfile | undefined {
  if (!['https://api.deepseek.com/chat/completions', 'https://api.deepseek.com/v1/chat/completions'].includes(identity.destination)
    || identity.model !== 'deepseek-flash' || identity.protocol !== 'openai_legacy' || identity.profileId !== 'generic-openai'
    || !isFrozenDeepSeekCounter(identity.counter)) return undefined;
  const counter = identity.counter;
  const cap = Object.freeze(Object.create(null)) as VerifiedCapacityProfile;
  profiles.set(cap, Object.freeze({ qualification: 'official-deepseek-recipe', destination: identity.destination, model: identity.model,
    windowTokens: 1_000_000, outputLimitField: 'max_tokens', defaultOutputTokens: 393216, safetyMarginTokens: 4096,
    countSerializedInput: (body: string) => countDeepSeekSerializedRequest(counter, body) }));
  return cap;
}

/** HOST TEST HARNESS ONLY. This registers a controlled-protocol fixture, not a
 * verified real-provider profile. Never select this factory in product config or
 * live eval. The trust boundary is host code capability, not NODE_ENV/evidenceId. */
export function createTestOnlyCapacityProfile(input: Omit<Profile, 'qualification'>): VerifiedCapacityProfile {
  if (!input.destination || !input.model || !integer(input.windowTokens) || input.windowTokens === 0
    || !integer(input.safetyMarginTokens) || input.safetyMarginTokens === 0 || !input.outputLimitField
    || typeof input.countSerializedInput !== 'function'
    || (input.defaultOutputTokens !== undefined && (!integer(input.defaultOutputTokens) || input.defaultOutputTokens === 0))) fail();
  const cap = Object.freeze(Object.create(null)) as VerifiedCapacityProfile;
  profiles.set(cap, Object.freeze({ ...input, qualification: 'test-fixture' }));
  return cap;
}
export function assertCapacityProfileReady(profile: VerifiedCapacityProfile | undefined, destination: string, model: string): void {
  const value = profile && profiles.get(profile);
  if (!value || value.destination !== destination || value.model !== model) fail();
}
export function measureRequestCapacity(profile: VerifiedCapacityProfile | undefined, input: {
  destination: string; model: string; serializedBody: string;
}): { inputTokenUpperBound: number; actualOutputReserve: number; totalTokenUpperBound: number; qualification: 'test-fixture' | 'official-deepseek-recipe' } {
  assertCapacityProfileReady(profile, input.destination, input.model);
  const value = profiles.get(profile!)!;
  let parsed: Record<string, unknown>;
  try {
    const candidate: unknown = JSON.parse(input.serializedBody);
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) fail();
    parsed = candidate as Record<string, unknown>;
  } catch { fail(); }
  if (parsed.model !== value.model) fail();
  // Competing output-limit dialects are not interchangeable. A profile may not
  // reserve one field while the provider obeys another larger field.
  for (const field of ['max_tokens', 'max_completion_tokens', 'max_output_tokens']) {
    if (field !== value.outputLimitField && Object.hasOwn(parsed, field)) fail();
  }
  const output = Object.hasOwn(parsed, value.outputLimitField) ? parsed[value.outputLimitField] : value.defaultOutputTokens;
  if (!integer(output) || output === 0) fail();
  let count: unknown;
  try { count = value.countSerializedInput(input.serializedBody); } catch { fail(); }
  if (!integer(count)) {
    // A mistaken async host counter must not leak a rejected promise.
    if (count instanceof Promise) void count.catch(() => {});
    fail();
  }
  const total = count + output + value.safetyMarginTokens;
  if (!integer(total)) fail();
  return { inputTokenUpperBound: count, actualOutputReserve: output, totalTokenUpperBound: total, qualification: value.qualification };
}

export function getCapacityProfileBudget(profile: VerifiedCapacityProfile): { windowTokens: number; outputLimitField: string; defaultOutputTokens?: number; safetyMarginTokens: number } {
  const value = profiles.get(profile); if (!value) fail();
  return { windowTokens: value.windowTokens, outputLimitField: value.outputLimitField,
    defaultOutputTokens: value.defaultOutputTokens, safetyMarginTokens: value.safetyMarginTokens };
}
export function checkRequestCapacity(profile: VerifiedCapacityProfile | undefined, input: { destination: string; model: string; serializedBody: string }): ReturnType<typeof measureRequestCapacity> {
  const result = measureRequestCapacity(profile, input);
  if (result.totalTokenUpperBound > getCapacityProfileBudget(profile!).windowTokens) fail('CONTEXT_BUDGET_EXCEEDED');
  return result;
}

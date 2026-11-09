import { createHash, Hash } from 'node:crypto';
import { dshAFields, dshAJson, dshAHash } from '../multi-agent/dsh-admission-data.js';

const nativeCreateHash = createHash;
const hashUpdate = Hash.prototype.update;
const hashDigest = Hash.prototype.digest;
const apply = Reflect.apply;
const descriptor = Object.getOwnPropertyDescriptor;
const define = Object.defineProperty;
const create = Object.create;
const freeze = Object.freeze;
const isInteger = Number.isSafeInteger;
const byteLength = Buffer.byteLength;
const charCodeAt = String.prototype.charCodeAt;
const regexTest = RegExp.prototype.test;
const NativeBigInt = BigInt;
const NativeNumber = Number;
const NativeError = Error;
const NativeURL = URL;
const urlHref = descriptor(NativeURL.prototype, 'href')!.get!;
const urlProtocol = descriptor(NativeURL.prototype, 'protocol')!.get!;
const urlUsername = descriptor(NativeURL.prototype, 'username')!.get!;
const urlPassword = descriptor(NativeURL.prototype, 'password')!.get!;
const urlHash = descriptor(NativeURL.prototype, 'hash')!.get!;
const MAX = 1_000_000_000_000;
const inputFields = freeze(['quote', 'purpose', 'systemText', 'userText', 'maxOutputTokens', 'sourceManifestHash']);
const quoteFields = freeze([
  'version', 'providerId', 'modelId', 'modelProfileId', 'protocol', 'destination',
  'contextTokenLimit', 'maxOutputTokens', 'inputMicrosPerMillion', 'outputMicrosPerMillion',
  'currency', 'scale', 'validUntil', 'pricingEvidenceHash', 'contextSemantics', 'outputSemantics',
]);

export interface DshBoundedRequestPlan {
  readonly kind: 'unverified_request_plan';
  readonly purpose: 'assessment' | 'preview' | 'draft';
  readonly providerId: string;
  readonly modelId: string;
  readonly modelProfileId: string;
  readonly protocol: 'openai_legacy';
  readonly destination: string;
  readonly serializedBody: string;
  readonly bodyHash: string;
  readonly sourceManifestHash: string;
  readonly pricingHash: string;
  readonly pricingEvidenceHash: string;
  readonly validUntil: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxTokens: number;
  readonly maxCostMicros: number;
  readonly toolRounds: 0;
}

function invalid(): never { throw new NativeError('DSH_REQUEST_BOUND_INVALID'); }
function copyRecord(raw: unknown, names: readonly string[]): Record<string, unknown> {
  dshAFields(raw, names);
  const result = create(null) as Record<string, unknown>;
  for (let i = 0; i < names.length; i++) {
    const key = names[i]!;
    define(result, key, { __proto__: null, value: descriptor(raw, key)!.value, enumerable: true } as PropertyDescriptor);
  }
  return result;
}
function integer(value: unknown, minimum = 0, maximum = MAX): number {
  if (!isInteger(value) || typeof value !== 'number' || value < minimum || value > maximum) invalid();
  return value;
}
function text(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string' || !value.length || byteLength(value, 'utf8') > maxBytes) invalid();
  for (let i = 0; i < value.length; i++) {
    const unit = apply(charCodeAt, value, [i]) as number;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = apply(charCodeAt, value, [++i]) as number;
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) invalid();
  }
  return value;
}
function id(value: unknown): string {
  const result = text(value, 1024);
  if (result.length > 256 || apply(regexTest, /[\x00-\x1f\x7f]/, [result])) invalid();
  return result;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !apply(regexTest, /^[a-f0-9]{64}$/, [value])) invalid();
  return value;
}
function rawHash(value: string): string {
  const state = nativeCreateHash('sha256');
  apply(hashUpdate, state, [value, 'utf8']);
  return apply(hashDigest, state, ['hex']) as string;
}

/** Data and arithmetic only. The caller must independently authenticate the
 * profile, price, source and destination, then reserve in the original owner.
 * Neither this DTO nor its hashes are an authorization or a pricing receipt. */
export function buildDshBoundedRequest(input: unknown, now: number): DshBoundedRequestPlan {
  try {
    const value = copyRecord(input, inputFields);
    const quote = copyRecord(value.quote, quoteFields);
    integer(now, 0, 1e15);
    if (quote.version !== 1 || quote.protocol !== 'openai_legacy' || quote.currency !== 'USD'
      || quote.scale !== 6 || quote.contextSemantics !== 'input_and_output'
      || quote.outputSemantics !== 'total_completion_tokens') invalid();
    if (value.purpose !== 'assessment' && value.purpose !== 'preview' && value.purpose !== 'draft') invalid();
    const providerId = id(quote.providerId), modelId = id(quote.modelId), modelProfileId = id(quote.modelProfileId);
    const destination = text(quote.destination, 4096), url = new NativeURL(destination);
    // Ports and IP literals are only syntax here. The original egress owner
    // must separately authenticate an exact destination allowlist.
    if (apply(urlHref, url, []) !== destination || apply(urlProtocol, url, []) !== 'https:'
      || apply(urlUsername, url, []) || apply(urlPassword, url, []) || apply(urlHash, url, [])) invalid();
    const contextTokens = integer(quote.contextTokenLimit, 1);
    const profileOutput = integer(quote.maxOutputTokens, 1);
    const outputTokens = integer(value.maxOutputTokens, 1);
    if (profileOutput > contextTokens || outputTokens > profileOutput) invalid();
    const inputPrice = integer(quote.inputMicrosPerMillion);
    const outputPrice = integer(quote.outputMicrosPerMillion);
    const validUntil = integer(quote.validUntil, 0, 1e15);
    if (now >= validUntil) invalid();
    const pricingEvidenceHash = hash(quote.pricingEvidenceHash);
    const sourceManifestHash = hash(value.sourceManifestHash);
    const systemText = text(value.systemText, 64 * 1024);
    const userText = text(value.userText, 64 * 1024);
    const serializedBody = dshAJson({ model: modelId, messages: [
      { role: 'system', content: systemText }, { role: 'user', content: userText },
    ], max_tokens: outputTokens, stream: false });
    if (byteLength(serializedBody, 'utf8') > 128 * 1024) invalid();
    const maxTokens = integer(contextTokens + outputTokens, 1);
    const numerator = NativeBigInt(contextTokens) * NativeBigInt(inputPrice)
      + NativeBigInt(outputTokens) * NativeBigInt(outputPrice);
    let cost = (numerator + 999_999n) / 1_000_000n;
    if (cost === 0n) cost = 1n;
    if (cost > NativeBigInt(MAX)) invalid();
    const output: DshBoundedRequestPlan = {
      kind: 'unverified_request_plan', purpose: value.purpose, providerId, modelId, modelProfileId,
      protocol: 'openai_legacy', destination, serializedBody, bodyHash: rawHash(serializedBody),
      sourceManifestHash, pricingHash: dshAHash(['dsh-request-pricing-v1', quote]),
      pricingEvidenceHash, validUntil, maxInputTokens: contextTokens, maxOutputTokens: outputTokens,
      maxTokens, maxCostMicros: NativeNumber(cost), toolRounds: 0,
    };
    return freeze(output);
  } catch {
    return invalid();
  }
}

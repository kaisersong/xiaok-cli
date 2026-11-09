import { describe, expect, it } from 'vitest';
import { createHash, Hash } from 'node:crypto';

const now = 1_800_000_000_000;
const sourceHash = '1'.repeat(64);
function input() {
  return {
    quote: {
      version: 1, providerId: 'fixture-provider', modelId: 'fixture-model',
      modelProfileId: 'fixture-profile', protocol: 'openai_legacy',
      destination: 'https://provider.invalid/v1/chat/completions',
      contextTokenLimit: 100_000, maxOutputTokens: 8192,
      inputMicrosPerMillion: 300_000, outputMicrosPerMillion: 1_200_000,
      currency: 'USD', scale: 6, validUntil: now + 60_000,
      pricingEvidenceHash: '2'.repeat(64),
      contextSemantics: 'input_and_output', outputSemantics: 'total_completion_tokens',
    },
    purpose: 'assessment', systemText: 'Return JSON only.', userText: '请写一份本地方案 🚀',
    maxOutputTokens: 2048, sourceManifestHash: sourceHash,
  };
}
async function build(raw: unknown, clock = now) {
  const { buildDshBoundedRequest } = await import('../../../src/runtime/admission/request-bounds.js');
  return buildDshBoundedRequest(raw, clock);
}

describe('DSH pure request bounds are data plans, never permits', () => {
  it('binds exact final body bytes and conservative input/output bounds', async () => {
    const value = input(), plan = await build(value);
    expect(plan.kind).toBe('unverified_request_plan');
    expect(JSON.parse(plan.serializedBody)).toEqual({ model: 'fixture-model', messages: [
      { role: 'system', content: value.systemText }, { role: 'user', content: value.userText },
    ], max_tokens: 2048, stream: false });
    expect(plan.bodyHash).toBe(createHash('sha256').update(plan.serializedBody, 'utf8').digest('hex'));
    expect(plan.bodyHash).not.toBe(createHash('sha256').update(JSON.stringify(plan.serializedBody)).digest('hex'));
    expect(plan).toMatchObject({ maxInputTokens: 100_000, maxOutputTokens: 2048,
      maxTokens: 102_048, maxCostMicros: 32_458, toolRounds: 0, sourceManifestHash: sourceHash });
    expect(plan).not.toHaveProperty('pricingKnown');
    expect(plan).not.toHaveProperty('permit');
    expect(plan).not.toHaveProperty('apiKey');
    expect(Object.isFrozen(plan)).toBe(true);
  });
  it('keeps pricing identity independent from body and binds every pricing field', async () => {
    const original = await build(input()), text = input(); text.userText += ' another';
    const changedText = await build(text);
    expect(changedText.bodyHash).not.toBe(original.bodyHash);
    expect(changedText.pricingHash).toBe(original.pricingHash);
    for (const field of ['modelId', 'modelProfileId', 'pricingEvidenceHash'] as const) {
      const changed = input(); changed.quote[field] += 'a';
      if (field === 'pricingEvidenceHash') changed.quote[field] = '3'.repeat(64);
      expect((await build(changed)).pricingHash).not.toBe(original.pricingHash);
    }
    const changed = input(); changed.quote.inputMicrosPerMillion++;
    expect((await build(changed)).pricingHash).not.toBe(original.pricingHash);
  });
  it('uses exact BigInt ceiling even when multiplication exceeds Number precision', async () => {
    const value = input(); value.quote.contextTokenLimit = 9_000_000_007;
    value.quote.inputMicrosPerMillion = 99_999_991;
    value.quote.outputMicrosPerMillion = 999_999_937; value.maxOutputTokens = 8191;
    expect((await build(value)).maxCostMicros).toBe(900_008_110_700);
  });
  it('reserves one microUSD for a zero-priced request and rounds positive fractions up', async () => {
    const value = input(); value.quote.inputMicrosPerMillion = 0;
    value.quote.outputMicrosPerMillion = 0;
    expect((await build(value)).maxCostMicros).toBe(1);
    value.quote.inputMicrosPerMillion = 1;
    expect((await build(value)).maxCostMicros).toBe(1);
  });
  it('does not retain mutable caller data', async () => {
    const value = input(), plan = await build(value), before = JSON.stringify(plan);
    value.userText = 'changed'; value.quote.modelId = 'other';
    expect(JSON.stringify(plan)).toBe(before);
  });
  it('fits the original budget reserve parser without treating a quote as authenticated', async () => {
    const plan = await build(input());
    const { parseDshInput } = await import('../../../desktop/electron/harness-dsh-budget-data.mjs');
    const request = { accountId: 'fixture-account', operation: {
      operationKey: 'fixture-operation', purpose: 'assessment', inputId: 'fixture-input',
      evidenceHash: sourceHash, semanticHash: sourceHash, threadHash: sourceHash,
      workId: null, maxAttempts: 2, deadline: now + 60_000,
    }, attempt: {
      attemptId: 'fixture-attempt', sequence: 1, bodyHash: plan.bodyHash,
      providerId: plan.providerId, modelId: plan.modelId, modelProfileId: plan.modelProfileId,
      pricingHash: plan.pricingHash,
      // Controlled parser compatibility only. A real producer must authenticate
      // pricing; the pure request plan deliberately cannot supply this fact.
      pricingKnown: true, maxInputTokens: plan.maxInputTokens, maxOutputTokens: plan.maxOutputTokens,
      maxTokens: plan.maxTokens, maxCostMicros: plan.maxCostMicros, toolRounds: plan.toolRounds,
    } };
    expect(parseDshInput('reserve', request)).toEqual(request);
    expect(plan).not.toHaveProperty('pricingKnown');
  });
  it('uses module-born hash methods after a late public prototype replacement', async () => {
    const value = input(), control = await build(value);
    const update = Hash.prototype.update, digest = Hash.prototype.digest;
    let hits = 0, actual;
    Hash.prototype.update = function () { hits++; throw Error('late update'); } as typeof update;
    Hash.prototype.digest = function () { hits++; throw Error('late digest'); } as typeof digest;
    try { actual = await build(value); } finally { Hash.prototype.update = update; Hash.prototype.digest = digest; }
    expect(actual).toEqual(control); expect(hits).toBe(0);
  });
  it('rejects getter/Proxy fields without executing caller code', async () => {
    let calls = 0;
    const getter = input(); Object.defineProperty(getter.quote, 'modelId', { enumerable: true, get() { calls++; return 'forged'; } });
    await expect(build(getter)).rejects.toThrow('DSH_REQUEST_BOUND_INVALID');
    await expect(build(new Proxy(input(), { ownKeys() { calls++; return []; } }))).rejects.toThrow('DSH_REQUEST_BOUND_INVALID');
    const nested = input(); nested.quote = new Proxy(nested.quote, { get() { calls++; return 'forged'; } });
    await expect(build(nested)).rejects.toThrow('DSH_REQUEST_BOUND_INVALID'); expect(calls).toBe(0);
  });
  it('accepts null-prototype own-data input without inherited serialization hooks', async () => {
    const value = input(), plain = await build(value);
    Object.setPrototypeOf(value, null); Object.setPrototypeOf(value.quote, null);
    expect(await build(value)).toEqual(plain);
  });
  for (const patch of [
    { currency: 'CNY' }, { scale: 9 }, { protocol: 'anthropic' },
    { contextSemantics: 'unknown' }, { outputSemantics: 'visible_only' },
    { inputMicrosPerMillion: undefined }, { pricingEvidenceHash: null },
    { maxOutputTokens: 100_001 }, { destination: 'http://provider.invalid/' },
    { destination: 'https://u:p@provider.invalid/' }, { destination: 'https://provider.invalid/#fragment' },
    { inputMicrosPerMillion: -1 }, { outputMicrosPerMillion: 1.5 },
  ]) it('rejects unknown or incompatible quote: ' + JSON.stringify(patch), async () => {
    const value = input(); Object.assign(value.quote, patch); await expect(build(value)).rejects.toThrow('DSH_REQUEST_BOUND_INVALID');
  });
  it('rejects extra/symbol/nonenumerable fields and inherited required fields', async () => {
    for (const place of ['input', 'quote']) {
      const value = input(), target = place === 'input' ? value : value.quote;
      Object.defineProperty(target, 'extra', { value: true }); await expect(build(value)).rejects.toThrow('DSH_REQUEST_BOUND_INVALID');
    }
    const value = input(); Object.defineProperty(value, Symbol('hidden'), { value: 1 });
    await expect(build(value)).rejects.toThrow('DSH_REQUEST_BOUND_INVALID');
    const missing = input(); Object.setPrototypeOf(missing.quote, { modelId: missing.quote.modelId });
    delete (missing.quote as Partial<typeof missing.quote>).modelId;
    await expect(build(missing)).rejects.toThrow('DSH_REQUEST_BOUND_INVALID');
    const hidden = input(); Object.defineProperty(hidden.quote, 'modelId', { enumerable: false });
    await expect(build(hidden)).rejects.toThrow('DSH_REQUEST_BOUND_INVALID');
  });
  it('rejects expiration at the exact boundary and invalid clocks', async () => {
    const value = input();
    await expect(build(value, value.quote.validUntil - 1)).resolves.toHaveProperty('bodyHash');
    for (const clock of [value.quote.validUntil, value.quote.validUntil + 1, -1, NaN, 1.5])
      await expect(build(value, clock)).rejects.toThrow('DSH_REQUEST_BOUND_INVALID');
  });
  it('rejects output, token and monetary overflow before any dispatch plan escapes', async () => {
    const value = input(); value.maxOutputTokens = 8193; await expect(build(value)).rejects.toThrow('DSH_REQUEST_BOUND_INVALID');
    value.maxOutputTokens = 1; value.quote.contextTokenLimit = 1e12; await expect(build(value)).rejects.toThrow('DSH_REQUEST_BOUND_INVALID');
    value.quote.contextTokenLimit = 1e11; value.quote.inputMicrosPerMillion = 1e12;
    await expect(build(value)).rejects.toThrow('DSH_REQUEST_BOUND_INVALID');
  });
  it('enforces final UTF8 body bytes, empty text and well-formed Unicode', async () => {
    for (const text of ['', '\ud800', '\udc00', 'x'.repeat(65537)]) {
      const value = input(); value.userText = text; await expect(build(value)).rejects.toThrow('DSH_REQUEST_BOUND_INVALID');
    }
    const value = input(); value.systemText = 'x'.repeat(65536); value.userText = 'x'.repeat(65536);
    await expect(build(value)).rejects.toThrow('DSH_REQUEST_BOUND_INVALID');
    value.systemText = 'x'; value.userText = '中'.repeat(21845);
    await expect(build(value)).resolves.toHaveProperty('bodyHash');
  });
});

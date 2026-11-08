import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { classifyModelFailure, createModelProviderError, getModelFailure, formatModelFailure } from '../../../src/ai/runtime/model-failure.js';
import { recoverModelStream } from '../../../src/ai/runtime/model-stream-recovery.js';
import { normalizeRuntimeError } from '../../../src/ai/runtime/runtime-errors.js';
import { formatModelRecoveryNotice } from '../../../src/commands/chat-model-recovery.js';

const raw = (code: string, message = 'PRIVATE_KEY_CANARY') => Object.assign(new Error(message), { status: 429, error: { code, message } });
async function collect(stream: AsyncIterable<unknown>) { for await (const _ of stream) { /* drain */ } }
describe('safe model failure semantics', () => {
  it.each(['1113', '1308', '1309', '1310', '1311', '1313', '1314', '1315', '1316', '1317', '1318', '1319', '1320', '1321'])('GLM %s terminates rather than treating quota/account errors as a connection outage', code => {
    const failure = classifyModelFailure(raw(code), 'glm');
    expect(failure.retryable).toBe(false);
    expect(failure).toMatchObject({ provider: 'glm', source: 'provider', status: 429, providerCode: code });
    expect(formatModelFailure(failure)).not.toContain('PRIVATE_KEY_CANARY');
  });
  it.each(['1302', '1305'])('GLM %s remains transient', code => expect(classifyModelFailure(raw(code), 'glm').retryable).toBe(true));
  it('does not apply GLM business codes to a custom provider', () => expect(classifyModelFailure(raw('1308'), 'other')).toMatchObject({ category: 'rate_limit', retryable: true, source: 'provider' }));
  it.each([
    ["You've reached your weekly (7-day) usage limit", 'quota', false],
    ["You've reached your 5-hour usage limit", 'quota', false],
    ["You've reached your monthly usage limit for this billing cycle", 'quota', false],
    ['Your credit balance is insufficient', 'balance', false],
    ["Your organization's Extra Usage balance has run out", 'balance', false],
    ["You've reached the Extra Usage limit set for your account by your organization", 'quota', false],
    ["You've reached your concurrent request limit", 'account_restricted', false],
    ["We're receiving too many requests", 'rate_limit', true],
    ['The engine is currently overloaded', 'server', true],
  ])('Kimi official reason %s', (message, category, retryable) => {
    const error = Object.assign(new Error(message), { status: 429, error: { message, type: 'exceeded_current_quota_error' } });
    expect(classifyModelFailure(error, 'kimi')).toMatchObject({ category, retryable });
  });
  it("does not guess quota from Kimi's ambiguous quota type when the reason is unknown", () => {
    expect(classifyModelFailure(Object.assign(new Error('PRIVATE_KEY_CANARY'), { status: 429, type: 'exceeded_current_quota_error' }), 'kimi')).toMatchObject({ category: 'rate_limit', retryable: true });
  });
  it('an explicit permanent Kimi code wins over conflicting transient text', () => {
    expect(classifyModelFailure(Object.assign(new Error("We're receiving too many requests"), { status: 429, code: 'insufficient_quota' }), 'kimi')).toMatchObject({ category: 'quota', retryable: false });
  });
  it('permanent causes beat a transient wrapper without retaining payloads', () => {
    const error = Object.assign(new Error('network PRIVATE_KEY_CANARY'), { status: 503, retryable: true, cause: raw('1308') });
    const safe = createModelProviderError(error, 'glm');
    expect(getModelFailure(safe)).toMatchObject({ category: 'quota', retryable: false, status: 429 });
    expect(JSON.stringify(safe) + safe.message).not.toContain('PRIVATE_KEY_CANARY');
    expect(safe).not.toHaveProperty('cause');
    expect(normalizeRuntimeError(safe)).toMatchObject({ code: 'model_failed', retryable: false, message: expect.stringContaining('额度') });
  });
  it('validates reset times and never forwards arbitrary response messages', () => {
    const failure = classifyModelFailure(raw('1310', '您已达到每周/每月使用上限，您的限额将在 2026-12-10 09:30:00 重置。PRIVATE_KEY_CANARY'), 'glm');
    expect(failure.resetAt).toBe('2026-12-10 09:30:00');
    expect(formatModelFailure(failure)).toContain('2026-12-10 09:30:00');
    expect(classifyModelFailure(raw('1310', '限额将在 2026-02-31 99:88:77 重置'), 'glm').resetAt).toBeUndefined();
  });
  it.each(['60', 'Mon, 02 Nov 2026 00:01:00 GMT'])('reads valid Retry-After %s', value => {
    expect(classifyModelFailure(Object.assign(raw('1302'), { headers: new Headers({ 'retry-after': value }) }), 'glm', Date.UTC(2026, 10, 2)).retryAfterMs).toBe(60000);
  });
  it.each(['-1', 'garbage', 'Infinity'])('ignores invalid or excessive Retry-After %s', value => {
    expect(classifyModelFailure(Object.assign(raw('1302'), { headers: { 'retry-after': value } }), 'glm').retryAfterMs).toBeUndefined();
  });
  it('stops rather than shortening an excessive provider wait', () => {
    expect(classifyModelFailure(Object.assign(raw('1302'), { headers: { 'retry-after': '999999999' } }), 'glm')).toMatchObject({ retryAfterTooLong: true });
  });
  it('keeps an SDK-owned timeout abort distinct from user cancellation', () => {
    const error = new OpenAI.APIConnectionTimeoutError({ cause: new DOMException('PRIVATE_KEY_CANARY', 'AbortError') });
    expect(classifyModelFailure(error, 'glm')).toMatchObject({ category: 'timeout', retryable: true });
    expect(classifyModelFailure(new Error('network', { cause: new DOMException('cancelled', 'AbortError') }), 'glm')).toMatchObject({ category: 'aborted', retryable: false });
  });
  it('does not invoke untrusted accessors, traverse cycles forever or echo arbitrary codes', () => {
    const getter = vi.fn(() => { throw Error('PRIVATE_KEY_CANARY'); });
    const error = Object.defineProperty(new Error('PRIVATE_KEY_CANARY'), 'error', { get: getter });
    Object.assign(error, { status: 429, code: 'sk-PRIVATE_KEY_CANARY', cause: error });
    const failure = classifyModelFailure(error, 'kimi');
    expect(failure).toMatchObject({ category: 'rate_limit', retryable: true });
    expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(failure)).not.toContain('CANARY');
  });
  it('preserves model-read local error identity while identifying xiaok rather than tools', async () => {
    const error = new TypeError('PRIVATE_KEY_CANARY');
    await expect(collect(recoverModelStream({ signal: new AbortController().signal, open: async function* () { throw error; } }))).rejects.toBe(error);
    expect(normalizeRuntimeError(error)).toMatchObject({ code: 'model_failed', message: expect.stringContaining('xiaok'), retryable: false });
    expect(normalizeRuntimeError(error).message).not.toContain('CANARY');
    expect(normalizeRuntimeError(new TypeError('ordinary tool failure')).code).toBe('tool_failed');
  });
  it('emits the safe provider reason and respects Retry-After in the recovery owner', async () => {
    vi.useFakeTimers();
    try {
      const failure = createModelProviderError(Object.assign(raw('1302'), { headers: { 'retry-after': '2' } }), 'glm');
      const retry = vi.fn(); let calls = 0;
      const done = collect(recoverModelStream({ signal: new AbortController().signal,
        policy: { windowMs: 5000, idleMs: 0, initialDelayMs: 1, maxDelayMs: 10 }, onRetry: retry,
        open: async function* () { if (++calls === 1) throw failure; yield { type: 'done' as const }; } }));
      await vi.advanceTimersByTimeAsync(1999);
      expect(calls).toBe(1);
      expect(retry).toHaveBeenCalledWith(expect.objectContaining({ delayMs: 2000, failure: expect.objectContaining({ category: 'rate_limit', providerCode: '1302' }) }));
      const notice = formatModelRecoveryNotice(retry.mock.calls[0][0]);
      expect(notice).toContain('GLM'); expect(notice).toContain('频率'); expect(notice).toContain('1302'); expect(notice).not.toContain('连接中断');
      await vi.advanceTimersByTimeAsync(1); await done; expect(calls).toBe(2);
    } finally { vi.useRealTimers(); }
  });
  it('a later explicit stop marker cannot be overridden by cached transient metadata', () => {
    const error = createModelProviderError(raw('1302'), 'glm');
    Object.assign(error, { retryable: false });
    expect(getModelFailure(error)?.retryable).toBe(false);
  });
  it('does not echo arbitrary exhaustion messages', () => {
    expect(normalizeRuntimeError(Object.assign(new Error('PRIVATE_KEY_CANARY'), { code: 'MODEL_RECOVERY_EXHAUSTED' })).message).not.toContain('CANARY');
  });
  it('a permanent quota code wins even when Retry-After is present', async () => {
    const error = createModelProviderError(Object.assign(raw('1308'), { headers: { 'retry-after': '1' } }), 'glm');
    const open = vi.fn(async function* () { throw error; }), retry = vi.fn();
    await expect(collect(recoverModelStream({ signal: new AbortController().signal, open, onRetry: retry }))).rejects.toBe(error);
    expect(open).toHaveBeenCalledTimes(1); expect(retry).not.toHaveBeenCalled();
  });
  it('does not retry beyond the window and keeps the provider cause on exhaustion', async () => {
    const failure = createModelProviderError(Object.assign(raw('1302'), { headers: { 'retry-after': '60' } }), 'glm');
    const retry = vi.fn(), open = vi.fn(async function* () { throw failure; });
    let error: unknown;
    try { await collect(recoverModelStream({ signal: new AbortController().signal, policy: { windowMs: 100, idleMs: 0, initialDelayMs: 1, maxDelayMs: 10 }, onRetry: retry, open })); } catch (e) { error = e; }
    expect(error).toMatchObject({ code: 'MODEL_RECOVERY_EXHAUSTED', retryable: false });
    expect(normalizeRuntimeError(error).message).toContain('1302');
    expect(retry).not.toHaveBeenCalled(); expect(open).toHaveBeenCalledTimes(1);
  });
});

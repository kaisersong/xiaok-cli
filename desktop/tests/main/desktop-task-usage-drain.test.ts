// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createProjectAgentModel } from '../../electron/project-agent-model.js';
import { streamDesktopTaskRecovery, createDesktopModelPhysicalScope, admitDesktopModelPhysicalRead, closeDesktopModelPhysicalScope } from '../../electron/desktop-task-stream.js';
import { DEFAULT_CONFIG, type Config, type StreamChunk } from '../../../src/types.js';
import * as desktopServices from '../../electron/desktop-services.js';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function deferred<T = void>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const usage = { type: 'usage' as const, usage: { inputTokens: 17, outputTokens: 19 } };
function request(adapter: unknown, extra: Record<string, unknown> = {}) {
  return { adapter, messages: [{ role: 'user', content: [{ type: 'text', text: 'continue' }] }], tools: [], systemPrompt: '',
    invocationId: 'original-request', deadline: Date.now() + 2000, options: { signal: new AbortController().signal },
    policy: { windowMs: 100, idleMs: 1000, initialDelayMs: 0, maxDelayMs: 0 }, ...extra } as any;
}
const collect = async (source: AsyncIterable<StreamChunk>) => { const chunks: StreamChunk[] = []; for await (const chunk of source) chunks.push(chunk); return chunks; };
function contains(error: unknown, original: unknown): boolean { return error === original || error instanceof AggregateError && error.errors.some(value => contains(value, original)); }

it.each(['committed', 'failed', 'failed-return'] as const)('late usage keeps physical ownership through its async consumer: %s', async mode => {
  const entered = deferred(), release = deferred(), consuming = deferred(), commit = deferred();
  const scope = createDesktopModelPhysicalScope(), run = admitDesktopModelPhysicalRead(scope), ctl = new AbortController();
  const abort = new DOMException('original outward cancellation', 'AbortError');
  const failure = Object.assign(new Error('terminated usage journal'), { code: 'ECONNRESET' });
  const returnFailure = new Error('original provider return failed independently');
  let calls = 0;
  const consumer = vi.fn(async (chunk: StreamChunk, id: string) => { consuming.resolve(); await commit.promise; expect(chunk).toEqual(usage); expect(id).toBe('original-request'); });
  const adapter = { async *stream() { try { calls++; entered.resolve(); await release.promise; yield usage; yield { type: 'text' as const, delta: 'must stay abandoned' }; } finally { if (mode === 'failed-return') throw returnFailure; } } };
  const outward = collect(streamDesktopTaskRecovery(request(adapter, { options: { signal: ctl.signal }, onUsage: consumer }), run)).finally(() => run.finish()).catch(error => error);
  cleanup.push(async () => { release.resolve(); commit.resolve(); await outward; await closeDesktopModelPhysicalScope(scope, abort).catch(() => {}); });
  await entered.promise; ctl.abort(abort);
  expect(await outward).toBe(abort);
  let closed = false;
  const closing = closeDesktopModelPhysicalScope(scope, abort).then(() => { closed = true; }, error => { closed = true; throw error; });
  const observed = closing.catch(error => error);
  release.resolve();
  await vi.waitFor(() => expect(consumer).toHaveBeenCalledOnce());
  await consuming.promise; await turn(); expect(closed).toBe(false);
  if (mode !== 'committed') commit.reject(failure); else commit.resolve();
  const result = await observed;
  if (mode !== 'committed') expect(contains(result, failure)).toBe(true); else expect(result).toBeUndefined();
  if (mode === 'failed-return') expect(contains(result, returnFailure)).toBe(true);
  expect(calls).toBe(1); expect(consumer).toHaveBeenCalledOnce();
});

it('normal usage is consumed once and a network-shaped consumer failure never retries', async () => {
  const failure = Object.assign(new Error('terminated usage persistence'), { code: 'ECONNRESET' });
  for (const fail of [false, true]) {
    let calls = 0; const retry = vi.fn();
    const consumer = vi.fn(async () => { if (fail) throw failure; });
    const stream = streamDesktopTaskRecovery(request({ async *stream() { calls++; yield usage; yield { type: 'done' as const }; } }, { onUsage: consumer, onRecovery: retry }));
    if (fail) await expect(collect(stream)).rejects.toBe(failure);
    else expect(await collect(stream)).toEqual([usage, { type: 'done' }]);
    expect(consumer).toHaveBeenCalledOnce(); expect(calls).toBe(1); expect(retry).not.toHaveBeenCalled();
  }
});

it.each([null, 'selected'] as const)('project model %s keeps unique usage consumption and consumer errors never switch models', async selected => {
  const cfg: Config = { ...structuredClone(DEFAULT_CONFIG), schemaVersion: 2, defaultProvider: 'local', defaultModelId: 'current',
    providers: { local: { type: 'custom', protocol: 'openai_legacy', baseUrl: 'http://localhost:1234/v1' } },
    models: { current: { provider: 'local', model: 'current', label: 'Current' }, selected: { provider: 'local', model: 'selected', label: 'Selected' } } };
  const failure = Object.assign(new Error('terminated durable usage'), { code: 'ECONNRESET' });
  for (const fail of [false, true]) {
    const calls: string[] = [], ids: string[] = [], recovery = vi.fn();
    const model = await createProjectAgentModel({ modelId: selected, loadConfig: async () => cfg, createAdapter: binding => ({ getModelName: () => binding.wireModel,
      async *stream() { calls.push(binding.modelId!); yield usage; yield { type: 'text', delta: 'done' }; yield { type: 'done' }; } }) });
    const consumer = vi.fn(async (_chunk: StreamChunk, id: string) => { ids.push(id); if (fail) throw failure; });
    const stream = model.stream(request(undefined, { onUsage: consumer, onRecovery: recovery }));
    if (fail) await expect(collect(stream)).rejects.toBe(failure); else await collect(stream);
    expect(calls).toEqual([selected ?? 'current']); expect(consumer).toHaveBeenCalledOnce(); expect(ids[0]).toBeTruthy(); expect(recovery).not.toHaveBeenCalled();
  }
});

it.each([null, 'selected'] as const)('project model %s retains an async late consumer rejection in physical drain', async selected => {
  const cfg: Config = { ...structuredClone(DEFAULT_CONFIG), schemaVersion: 2, defaultProvider: 'local', defaultModelId: 'current',
    providers: { local: { type: 'custom', protocol: 'openai_legacy', baseUrl: 'http://localhost:1234/v1' } },
    models: { current: { provider: 'local', model: 'current', label: 'Current' }, selected: { provider: 'local', model: 'selected', label: 'Selected' } } };
  const entered = deferred(), release = deferred(), commit = deferred();
  const failure = Object.assign(new Error('network-shaped late usage commit failed'), { code: 'ECONNRESET' });
  const ctl = new AbortController(), abort = new DOMException('original project cancellation', 'AbortError');
  const scope = createDesktopModelPhysicalScope(), run = admitDesktopModelPhysicalRead(scope); let calls = 0;
  const model = await createProjectAgentModel({ modelId: selected, loadConfig: async () => cfg, createAdapter: binding => ({ getModelName: () => binding.wireModel,
    async *stream() { calls++; entered.resolve(); await release.promise; yield usage; yield { type: 'text', delta: 'abandoned' }; yield { type: 'done' }; } }) });
  const consumer = vi.fn(async () => { await commit.promise; });
  const outward = collect(model.stream(request(undefined, { options: { signal: ctl.signal }, onUsage: consumer }), run)).finally(() => run.finish()).catch(error => error);
  cleanup.push(async () => { release.resolve(); commit.resolve(); await outward; await closeDesktopModelPhysicalScope(scope, abort).catch(() => {}); });
  await entered.promise; ctl.abort(abort); await turn();
  let drained = false;
  const closing = closeDesktopModelPhysicalScope(scope, abort).then(() => { drained = true; }, error => { drained = true; throw error; }).catch(error => error);
  release.resolve(); await vi.waitFor(() => expect(consumer).toHaveBeenCalledOnce());
  await turn(); expect(drained).toBe(false);
  commit.reject(failure);
  const outwardError = await outward, physicalError = await closing;
  expect(outwardError).toBe(selected ? failure : abort); expect(contains(physicalError, failure)).toBe(true);
  expect(calls).toBe(1);
});

it.each(['committed', 'failed'] as const)('actual private finalization retains late usage and async commit ownership: %s', async mode => {
  // Existing test loader exposes this exact private function from the same full
  // production module read; no finalization implementation is copied here.
  const finalize = (desktopServices as unknown as { __testFinalization(input: unknown): Promise<unknown> }).__testFinalization;
  expect(finalize).toBeTypeOf('function');
  const entered = deferred(), release = deferred(), commit = deferred();
  const ctl = new AbortController(), abort = new DOMException('original finalization cancellation', 'AbortError');
  const failure = Object.assign(new Error('terminated finalization usage journal'), { code: 'ECONNRESET' });
  const scope = createDesktopModelPhysicalScope();
  let calls = 0;
  const consumer = vi.fn(async (chunk: StreamChunk, id: string) => { expect(chunk).toEqual(usage); expect(id).toBeTruthy(); await commit.promise; });
  const result = finalize({ adapter: { async *stream() { calls++; entered.resolve(); await release.promise; yield usage; yield { type: 'text', delta: 'abandoned finalization' }; yield { type: 'done' }; } },
    modelPhysicalScope: scope, apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'finalize' }] }], systemPrompt: '', streamOptions: { signal: ctl.signal }, signal: ctl.signal,
    sessionId: 'session', turnId: 'turn', intentId: 'intent', stepId: 'step', emitRuntimeEvent: async () => {}, onUsage: consumer,
  }).catch(error => error);
  cleanup.push(async () => { release.resolve(); commit.resolve(); await result; await closeDesktopModelPhysicalScope(scope, abort).catch(() => {}); });
  await entered.promise; ctl.abort(abort); expect(await result).toBe(abort);
  let drained = false;
  const closing = closeDesktopModelPhysicalScope(scope, abort).then(() => { drained = true; }, error => { drained = true; throw error; }).catch(error => error);
  release.resolve(); await vi.waitFor(() => expect(consumer).toHaveBeenCalledOnce()); await turn(); expect(drained).toBe(false);
  if (mode === 'failed') commit.reject(failure); else commit.resolve();
  const error = await closing;
  if (mode === 'failed') expect(contains(error, failure)).toBe(true); else expect(error).toBeUndefined();
  expect(calls).toBe(1); expect(consumer).toHaveBeenCalledOnce();
});

it.each(['main', 'finalization'].flatMap(route => [undefined, null, new Error('original usage commit failed')].map(original => [route, original] as const)))('actual %s loop preserves nullable usage %s and a failing diagnostic', async (route, original) => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-usage-consumer-'));
    const registry = new ToolRegistry({ autoMode: true }, [{ permission: 'safe', definition: { name: 'probe', description: 'original task tool', inputSchema: { type: 'object', properties: {} } }, execute: async () => 'original tool result' }]);
    let calls = 0, effects = 0;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => { if (original instanceof Error) throw new Error('independent diagnostic failure'); });
    try {
      const error = await desktopServices.runDesktopToolLoop({
        adapter: { async *stream(_messages, tools) {
          calls++;
          if (route === 'finalization' && tools.length) { yield { type: 'tool_use', id: 'original-tool', name: 'probe', input: {} }; yield { type: 'done' }; return; }
          yield usage; yield { type: 'text', delta: 'must not turn a failed commit into success' }; yield { type: 'done' };
        } },
        registry, allToolDefs: registry.getToolDefinitions(), systemPrompt: '', messages: [{ role: 'user', content: [{ type: 'text', text: 'execute' }] }],
        signal: new AbortController().signal, taskDeadline: Date.now() + 2000, sessionId: 'session', turnId: 'turn', intentId: 'intent', stepId: 'step', taskId: 'task',
        materials: [], emitRuntimeEvent: async () => {}, skillInvocation: null, skillCatalog: {} as never, dataRoot: root, taskStartTime: Date.now(), maxIterations: 1,
        onUsage: async () => { effects++; throw original; },
        strategies: { compact: { enabled: false, shouldCompact: () => false, doCompact: async () => {} }, buildApiView: value => value, processToolResult: value => value,
          trackAutoProgress: false, trackReferenceReads: false, emitSkillArtifactTrace: false },
      }).then(() => ({ unexpectedSuccess: true }), error => error);
      expect(error).toBeInstanceOf(AggregateError); expect(contains(error, original)).toBe(true);
      expect(effects).toBe(1); expect(calls).toBe(route === 'main' ? 1 : 2);
    } finally { warning.mockRestore(); registry.dispose(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
});

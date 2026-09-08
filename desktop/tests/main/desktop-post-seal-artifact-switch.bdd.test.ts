// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as syncFs from 'node:fs';
import * as asyncFs from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bounded, createPostSealHarness, type PostSealHarness } from '../fixtures/desktop-post-seal-harness.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

const nativeWorker = vi.hoisted(() => ({ output: '', root: '' }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
      super(mapped ? nativeWorker.output : filename, options);
    }
  } };
});
beforeAll(async () => { Object.assign(nativeWorker, await compileVerifierEntry('delivery-verifier-worker.ts')); });
afterAll(() => { if (nativeWorker.root) syncFs.rmSync(nativeWorker.root, { recursive: true, force: true, maxRetries: 3 }); });

vi.mock('node:fs', async original => { const actual = await original<typeof import('node:fs')>(); return { ...actual, openSync: vi.fn(actual.openSync) }; });
vi.mock('node:fs/promises', async original => { const actual = await original<typeof import('node:fs/promises')>(); return { ...actual, open: vi.fn(actual.open) }; });

describe('R4 compatibility: existing explicit artifactEvidence switch does not disable plan/empty rules', () => {
  const fixtures: PostSealHarness[] = [];
  afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); vi.clearAllMocks(); });
  const switches = [true, false, undefined] as const;

  it.each(switches)('existing artifactEvidence=%s retains only the artifact guard decision switch', async enabled => {
    const f = await createPostSealHarness({ spawnChild: false, prompt: '生成 PDF 文件',
      aheGuards: enabled === undefined ? undefined : { artifactEvidence: enabled } }); fixtures.push(f);
    const taskId = await f.start(); await bounded(f.host.drain()); const saved = await f.host.inspectTask(taskId);
    expect(saved?.status).toBe(enabled ? 'failed' : 'completed');
    const blocked = saved?.events.filter(event => event.type === 'progress' && event.eventId === `${taskId}:guard:artifact-evidence`) ?? [];
    expect(blocked).toHaveLength(enabled ? 1 : 0);
    if (!enabled) expect(saved?.result?.degraded).toBe(true);
    expect(f.runnerCalls).toBe(1);
  });

  it.each(switches)('existing artifactEvidence=%s cannot bypass the built-in incomplete plan', async enabled => {
    const f = await createPostSealHarness({ spawnChild: false, prompt: '生成一份报告和一份演示文稿',
      aheGuards: enabled === undefined ? undefined : { artifactEvidence: enabled }, emit: input => input.emitRuntimeEvent({
        type: 'progress_plan_reported', sessionId: input.sessionId,
        steps: [{ id: 'report', label: 'report', status: 'completed' }, { id: 'slides', label: 'slides', status: 'pending' }],
      }) }); fixtures.push(f);
    const taskId = await f.start(); await bounded(f.host.drain());
    expect(await f.host.inspectTask(taskId)).toMatchObject({ status: 'failed', salvage: { reason: 'needs_explicit_followup' } });
    expect(f.runnerCalls).toBe(1);
  });

  it.each(switches)('existing artifactEvidence=%s still records empty delivery as degraded', async enabled => {
    const f = await createPostSealHarness({ spawnChild: false, prompt: 'Hello',
      aheGuards: enabled === undefined ? undefined : { artifactEvidence: enabled } }); fixtures.push(f);
    const taskId = await f.start(); await bounded(f.host.drain());
    expect(await f.host.inspectTask(taskId)).toMatchObject({ status: 'completed', result: { degraded: true } });
    expect(f.runnerCalls).toBe(1);
  });

  it.skipIf(process.platform === 'win32').each(switches)('existing artifactEvidence=%s permits PDF file IO only when enabled (legacy file URI population)', async enabled => {
    let path = '';
    const f = await createPostSealHarness({ spawnChild: false, prompt: '生成 PDF 文件',
      aheGuards: enabled === undefined ? undefined : { artifactEvidence: enabled }, emit: input => input.emitRuntimeEvent({
        type: 'artifact_recorded', sessionId: input.sessionId, turnId: 'turn', intentId: 'intent', stageId: 'stage',
        artifactId: 'saved', kind: 'pdf', label: 'Saved PDF', path: pathToFileURL(path).href,
      }) }); fixtures.push(f);
    path = join(f.root, 'saved.pdf'); syncFs.writeFileSync(path, '%PDF-1.7');
    const taskId = await f.start(); await bounded(f.host.drain());
    const opens = [...vi.mocked(syncFs.openSync).mock.calls, ...vi.mocked(asyncFs.open).mock.calls].filter(args => String(args[0]) === path);
    expect(opens).toHaveLength(enabled ? 1 : 0);
    expect((await f.host.inspectTask(taskId))?.status).toBe('completed');
  });
});

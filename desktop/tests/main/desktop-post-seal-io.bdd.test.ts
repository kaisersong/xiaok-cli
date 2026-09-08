// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import * as evidenceGuard from '../../../src/runtime/guards/artifact-evidence-guard.js';
import { validateCompletionEvidence, type CompletionEvidenceInput } from '../../../src/runtime/guards/completion-evidence.js';
import { validateCompletionEvidenceAsync } from '../../../src/runtime/guards/completion-evidence-async.js';
import { createPostSealHarness, bounded } from '../fixtures/desktop-post-seal-harness.js';
import { loadVerifierContract, snapshotFixture } from '../fixtures/desktop-post-seal-verifier-contract.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

describe('R4 explicit raw async IO and unchanged guard language', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.useRealTimers(); });
  function directory() { const root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-io-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 })); return root; }

  it.skipIf(process.platform === 'win32')('D4/D6 real recoverTask FIFO abort rejects continuation while its raw read Promise stays pending until OS IO settles', async () => {
    const source = await createPostSealHarness(); cleanup.push(() => source.close());
    const prepared = await source.host.prepareTask({ prompt: 'A saved fixture', materials: [] });
    const original = await source.host.inspectTask(prepared.taskId);
    const root = directory(); mkdirSync(join(root, 'snapshots'));
    const fifo = join(root, 'snapshots', `${prepared.taskId}.json`); execFileSync('mkfifo', [fifo]);
    const store = new FileTaskSnapshotStore(root); const controller = new AbortController();
    const raw: Promise<unknown>[] = []; let rawSettles = 0; let waitSettled = false; let result: unknown;
    const read = (store.recoverTask as (id: string, options: { signal: AbortSignal; trackPending(raw: Promise<unknown>): void }) => Promise<TaskSnapshot | null>)(prepared.taskId,
      { signal: controller.signal, trackPending: promise => { raw.push(promise); void promise.then(() => { rawSettles++; }, () => { rawSettles++; }); } });
    const observed = read.then(value => { waitSettled = true; result = value; }, error => { waitSettled = true; result = error; });
    // Genuine libuv IO, not a rejected replacement Promise. A writer remains
    // absent until cleanup below, so the kernel FIFO open cannot finish early.
    await new Promise(resolve => setTimeout(resolve, 30));
    controller.abort(new DOMException('delivery_timeout', 'AbortError'));
    await new Promise(resolve => setTimeout(resolve, 30));
    try {
      expect.soft(waitSettled).toBe(true);
      expect.soft(result).toMatchObject({ name: 'AbortError' });
      expect.soft(raw.length).toBeGreaterThan(0); expect(rawSettles).toBe(0);
    } finally {
      const writer = await open(fifo, 'w'); await writer.writeFile(JSON.stringify(original)); await writer.close();
      await bounded(observed); await Promise.allSettled(raw);
    }
    expect(rawSettles).toBe(raw.length);
    expect(result).toMatchObject({ name: 'AbortError' });
  });

  it.each(['valid.pdf', 'invalid.pdf', 'valid.pptx', 'invalid.pptx', 'missing.pdf', 'answer'])('D5 async verifier preserves actual sync guard result for %s without a new quality policy', async scenario => {
    // Guard events carry a generation timestamp. Keep IO and monotonic timers real.
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-07T00:00:00Z'));
    const root = directory(); const path = join(root, scenario);
    if (scenario.startsWith('valid.pdf')) writeFileSync(path, '%PDF-1.7\nfixture');
    if (scenario.startsWith('valid.pptx')) writeFileSync(path, 'PK\x03\x04[Content_Types].xml');
    if (scenario.startsWith('invalid')) writeFileSync(path, 'not an artifact');
    const answer = scenario === 'answer';
    const input: Parameters<typeof evidenceGuard.evaluateArtifactEvidenceGuard>[0] = { taskId: 'task-fixture', status: 'completed',
      expectation: { ownerKind: 'task', ownerId: 'task-fixture', expectedKinds: ['file_artifact'], source: 'task_spec', confidence: 'explicit' },
      evidence: [{ ownerKind: 'task', ownerId: 'task-fixture', kind: answer ? 'answer' : 'file_artifact', summary: 'Real fixture evidence',
        ...(answer ? { metadata: { responseId: 'task-fixture:result:0' } } : { uri: pathToFileURL(path).href, metadata: { kind: 'file' } }) }] };
    const actualSync = evidenceGuard.evaluateArtifactEvidenceGuard(input);
    const asyncGuard = (evidenceGuard as typeof evidenceGuard & { evaluateArtifactEvidenceGuardAsync?:
      (request: Parameters<typeof evidenceGuard.evaluateArtifactEvidenceGuard>[0], options: { signal: AbortSignal; trackPending(raw: Promise<unknown>): void }) => Promise<typeof actualSync> }).evaluateArtifactEvidenceGuardAsync;
    expect(asyncGuard, 'new async entry must call shared production rules, not a test implementation').toBeTypeOf('function');
    const raw: Promise<unknown>[] = [];
    const actualAsync = await asyncGuard!(input, { signal: new AbortController().signal, trackPending: promise => raw.push(promise) });
    expect(actualAsync).toEqual(actualSync);
    const outcomes = await Promise.allSettled(raw);
    if (scenario === 'missing.pdf') expect(outcomes.some(value => value.status === 'rejected' && value.reason.code === 'ENOENT')).toBe(true);
    else if (process.platform === 'win32' && !answer) expect(outcomes.some(value => value.status === 'rejected' && typeof value.reason.code === 'string')).toBe(true);
    else expect(outcomes.every(value => value.status === 'fulfilled')).toBe(true);
  });

  it.each(['valid.pdf', 'invalid.pdf', 'tiny.pdf', 'valid.pptx', 'invalid.pptx', 'tiny.pptx', 'late-content.pptx', 'missing.pdf'])(
    'D5 shared async byte rules preserve direct validation result and warnings for %s through all existing local-path siblings', async scenario => {
      const root = directory(); const path = join(root, scenario);
      if (scenario === 'valid.pdf') writeFileSync(path, '%PDF-1.7');
      if (scenario === 'tiny.pdf') writeFileSync(path, '%PD');
      if (scenario.startsWith('invalid')) writeFileSync(path, 'invalid structure');
      if (scenario === 'valid.pptx') writeFileSync(path, 'PK\x03\x04[Content_Types].xml');
      if (scenario === 'tiny.pptx') writeFileSync(path, 'PK');
      if (scenario === 'late-content.pptx') writeFileSync(path, Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(65536), Buffer.from('[Content_Types].xml')]));
      for (const route of ['uri', 'paths', 'localPaths'] as const) {
        const input: CompletionEvidenceInput = { ownerKind: 'task', ownerId: 'task', targetStatus: 'completed',
          expectation: { ownerKind: 'task', ownerId: 'task', expectedKinds: ['file_artifact'], source: 'task_spec', confidence: 'explicit' },
          evidence: [{ ownerKind: 'task', ownerId: 'task', kind: 'file_artifact', summary: 'Saved evidence',
            ...(route === 'uri' ? { uri: pathToFileURL(path).href } : { metadata: route === 'paths' ? { paths: [path] } : { workspaceRoot: root, localPaths: [scenario] } }) }] };
        const expected = validateCompletionEvidence(input); const raw: Promise<unknown>[] = [];
        const actual = await validateCompletionEvidenceAsync(input, { signal: new AbortController().signal, trackPending: promise => raw.push(promise) });
        expect(actual).toEqual(expected);
        if (scenario === 'missing.pdf' && route === 'localPaths') expect(actual).toMatchObject({ ok: false, failureKind: 'validation_failed' });
        // Preserve the existing Windows URL.pathname behavior (/C:/...), rather
        // than quietly fixing URI decoding/path selection in an async rewrite.
        else if (scenario.startsWith('valid') || scenario.startsWith('missing') || (process.platform === 'win32' && route === 'uri')) expect(actual).toEqual({ ok: true });
        else expect(actual).toMatchObject({ ok: true, warning: expect.stringContaining('Artifact structural issue') });
        expect(raw.length).toBeGreaterThan(0); await Promise.allSettled(raw);
      }
    });

  it('D5 original URI priority and unsupported kinds do not gain new file reads; localPaths still has its existing priority', async () => {
    const root = directory(); const path = join(root, 'bad.pdf'); writeFileSync(path, 'invalid');
    for (const uri of ['artifact://owned', 'https://example.test/file.pdf', path]) {
      const input: CompletionEvidenceInput = { ownerKind: 'task', ownerId: 'task', targetStatus: 'completed',
        expectation: { ownerKind: 'task', ownerId: 'task', expectedKinds: ['file_artifact'], source: 'task_spec', confidence: 'explicit' },
        evidence: [{ ownerKind: 'task', ownerId: 'task', kind: 'file_artifact', summary: 'Saved evidence', uri, metadata: { paths: [path] } }] };
      const raw: Promise<unknown>[] = [];
      expect(await validateCompletionEvidenceAsync(input, { signal: new AbortController().signal, trackPending: promise => raw.push(promise) })).toEqual(validateCompletionEvidence(input));
      expect(raw).toHaveLength(0);
      input.evidence![0]!.metadata = { localPaths: [path], workspaceRoot: root };
      expect(await validateCompletionEvidenceAsync(input, { signal: new AbortController().signal, trackPending: promise => raw.push(promise) })).toMatchObject({ ok: true, warning: expect.stringContaining('pdf') });
      expect(raw.length).toBeGreaterThan(0); await Promise.allSettled(raw);
    }
  });

  it('D5 pre-abort cannot become answer fallback or structural fail-open and starts no raw IO', async () => {
    const abort = new DOMException('Stop readonly delivery', 'AbortError'); const controller = new AbortController(); controller.abort(abort);
    const raw: Promise<unknown>[] = [];
    const input: Parameters<typeof evidenceGuard.evaluateArtifactEvidenceGuard>[0] = { taskId: 'task', status: 'completed',
      expectation: { ownerKind: 'task', ownerId: 'task', expectedKinds: ['file_artifact'], source: 'task_spec', confidence: 'explicit' },
      evidence: [{ ownerKind: 'task', ownerId: 'task', kind: 'answer', summary: 'Fallback answer', metadata: { responseId: 'task:result:0' } }] };
    await expect(evidenceGuard.evaluateArtifactEvidenceGuardAsync(input, { signal: controller.signal, trackPending: promise => raw.push(promise) })).rejects.toBe(abort);
    expect(raw).toHaveLength(0);
  });

  it.skipIf(process.platform === 'win32')('D6 actual CPU Worker exit plus two native FIFO opens keep the tracked physical drain pending after outward failure', async () => {
    const compiled = await loadVerifierContract(); cleanup.push(() => rmSync(compiled.root, { recursive: true, force: true, maxRetries: 3 }));
    const verifier = new compiled.api.DeliveryVerifier(); const root = directory();
    const paths = [join(root, 'first.pdf'), join(root, 'second.pdf')]; paths.forEach(path => execFileSync('mkfifo', [path]));
    const controllers = paths.map(() => new AbortController()); const raw = paths.map(() => [] as Promise<unknown>[]);
    let opensObserved!: () => void; const entered = new Promise<void>(resolve => { opensObserved = resolve; });
    const tasks = paths.map((path, index) => verifier.verify(snapshotFixture({ taskId: `fifo-task-${index}`, prompt: '生成 PDF 文件',
      events: [{ type: 'artifact_recorded', artifactId: 'saved', kind: 'pdf', label: 'Saved PDF', filePath: pathToFileURL(path).href, previewAvailable: false, turnId: 'turn' }] }),
    { signal: controllers[index].signal, deadline: performance.now() + 5000, trackPending: promise => {
      raw[index].push(promise); if (raw.every(items => items.length >= 3)) opensObserved();
    } }).then(value => ({ ok: true, value }), error => ({ ok: false, error })));
    let physicalDrains = 0;
    try {
      await bounded(entered);
      // The final native effect in each attempt still waits in the kernel.
      let rawSettles = 0; raw.flat().forEach(promise => { void promise.then(() => rawSettles++, () => rawSettles++); });
      const heartbeat = performance.now(); await new Promise(resolve => setTimeout(resolve, 25));
      expect(performance.now() - heartbeat).toBeLessThan(500); expect(rawSettles).toBe(2);
      controllers.forEach(controller => controller.abort(new DOMException('Stop delivery', 'AbortError')));
      expect(await bounded(Promise.all(tasks))).toEqual([expect.objectContaining({ ok: false }), expect.objectContaining({ ok: false })]);
      await expect(verifier.verify(snapshotFixture(), { signal: new AbortController().signal, deadline: performance.now() + 1000,
        trackPending: () => { throw new Error('third attempt must not start IO'); } })).rejects.toMatchObject({ code: 'verifier_capacity' });
      expect.soft(raw.flat()).toHaveLength(6); // physical receipt + original access + original open per attempt
      raw.forEach(items => { void items[0].then(() => physicalDrains++); });
      await Promise.resolve(); expect.soft(physicalDrains).toBe(0);
      expect(rawSettles).toBe(2);
    } finally {
      controllers.forEach(controller => controller.abort());
      // Real writers release the kernel opens. No substitute/rejected IO Promise.
      for (const path of paths) { const writer = await open(path, 'w'); await writer.close(); }
      await Promise.allSettled(raw.flat());
    }
    expect(physicalDrains).toBe(2);
    const finalTracked: Promise<unknown>[] = [];
    await expect(verifier.verify(snapshotFixture(), { signal: new AbortController().signal, deadline: performance.now() + 2000,
      trackPending: promise => finalTracked.push(promise) })).resolves.toBeDefined();
    expect(finalTracked).toHaveLength(1); await finalTracked[0]; // receipt only; no file IO for skip facts
  });

  it.skipIf(process.platform === 'win32')('D5 native FIFO read at the legacy position zero is ESPIPE fail-open, not evidence for a pending read window', async () => {
    const root = directory(); const path = join(root, 'legacy.pdf'); execFileSync('mkfifo', [path]);
    const raw: Promise<unknown>[] = [];
    const read = evidenceGuard.evaluateArtifactEvidenceGuardAsync({ taskId: 'task', status: 'completed',
      expectation: { ownerKind: 'task', ownerId: 'task', expectedKinds: ['file_artifact'], source: 'task_spec', confidence: 'explicit' },
      evidence: [{ ownerKind: 'task', ownerId: 'task', kind: 'file_artifact', summary: 'Saved PDF', uri: pathToFileURL(path).href }] },
    { signal: new AbortController().signal, trackPending: promise => raw.push(promise) });
    const writer = await open(path, 'w');
    try {
      expect(await bounded(read)).toMatchObject({ ok: true });
      expect(await Promise.allSettled(raw)).toContainEqual(expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ code: 'ESPIPE' }) }));
      expect(raw).toHaveLength(4); // original access/open/read/close, all actually settled
    } finally { await writer.close(); }
  });
});

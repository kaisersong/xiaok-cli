// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { rmSync } from 'node:fs';
import { runDeliverableGate } from '../../../src/runtime/task-host/deliverable-gate.js';
import type { TaskSnapshot, DesktopTaskEvent } from '../../../src/runtime/task-host/types.js';
import { createPostSealHarness, bounded } from '../fixtures/desktop-post-seal-harness.js';
import { compileVerifierEntry, loadVerifierContract, loadActualLegacyCollectors, snapshotFixture } from '../fixtures/desktop-post-seal-verifier-contract.js';

describe('R4 raw facts preserve actual production collector and gate semantics', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
  const result = (summary: string): DesktopTaskEvent => ({ type: 'result', result: { summary, artifacts: [] } });
  function sample(kind: string): TaskSnapshot {
    if (kind === 'null-result') return Object.assign(snapshotFixture(), { result: null }) as unknown as TaskSnapshot;
    if (kind === 'multiple-result-indices') return snapshotFixture({ prompt: '解释结果', events: [
      { type: 'progress', eventId: 'ignored', message: 'ignore', stage: 'tool' }, result('first answer'),
      { type: 'assistant_delta', eventId: 'delta', delta: 'not copied' }, result('second answer') ] });
    if (kind === 'repeated-plan-last-wins') return snapshotFixture({ prompt: '生成一份报告和一份演示文稿', events: [
      { type: 'progress_plan_reported', steps: [{ id: 'a', label: 'a', status: 'planned' }] },
      { type: 'progress_plan_reported', steps: [{ id: 'a', label: 'a', status: 'completed' }] }, result('completed response') ] });
    if (kind === 'same-invocation-last-wins') return snapshotFixture({ prompt: '生成文件', events: [
      { type: 'goal_tool_fact', invocationId: 'inv', toolName: 'write', factKind: 'file_mutation', normalizedFilePaths: ['/fixture/a'] },
      { type: 'goal_tool_finished', invocationId: 'inv', toolName: 'write', ok: true },
      { type: 'goal_tool_fact', invocationId: 'inv', toolName: 'write', factKind: 'file_mutation', normalizedFilePaths: ['/fixture/b'] },
      { type: 'goal_tool_finished', invocationId: 'inv', toolName: 'write', ok: false } ] });
    if (kind === 'file-uri') return snapshotFixture({ prompt: '生成 PDF 文件', events: [
      { type: 'artifact_recorded', artifactId: 'a', kind: 'pdf', label: 'PDF', filePath: 'file:///fixture/a.pdf', previewAvailable: false, turnId: 'turn' } ] });
    if (kind === 'result-artifacts') return snapshotFixture({ prompt: '生成 PDF 文件', result: { summary: '', artifacts: [
      { artifactId: 'a', title: 'PDF', kind: 'pdf', createdAt: '2026-09-07', previewAvailable: false, filePath: 'file:///fixture/a.pdf' } ] } });
    if (kind === 'project') return snapshotFixture({ prompt: 'Create a project', events: [
      { type: 'canvas_tool_call', toolName: 'create_project', input: {}, toolUseId: 'p', eventId: 'p1' },
      { type: 'canvas_tool_result', toolName: 'create_project', toolUseId: 'p', ok: true, response: JSON.stringify({ type: 'project_card', projectId: 'project-1', name: 'fixture' }), eventId: 'p2' } ] });
    return snapshotFixture();
  }
  it.each(['multiple-result-indices', 'repeated-plan-last-wins', 'same-invocation-last-wins', 'file-uri', 'result-artifacts', 'project', 'no-result', 'null-result'])('D14 %s matches unmodified ordinary production helpers, not a test classifier', async kind => {
    const helper = await loadVerifierContract(); cleanup.push(() => rmSync(helper.root, { recursive: true, force: true, maxRetries: 3 }));
    const legacy = await loadActualLegacyCollectors(); cleanup.push(() => rmSync(legacy.root, { recursive: true, force: true, maxRetries: 3 }));
    const f = await createPostSealHarness({ explicit: false }); cleanup.push(() => f.close());
    const original = sample(kind); const originalCopy = structuredClone(original); const requestId = randomUUID();
    const raw = helper.api.buildDeliveryFactsV1(original, requestId);
    expect(original).toEqual(originalCopy); expect(raw).toMatchObject({ eventCount: original.events.length, requestId });
    const compiled = await compileVerifierEntry('delivery-verifier-worker.ts'); cleanup.push(() => rmSync(compiled.root, { recursive: true, force: true, maxRetries: 3 }));
    const worker = new Worker(compiled.output, { stdout: true, stderr: true }); const messages: unknown[] = [];
    worker.on('message', value => messages.push(value)); const exit = new Promise<number>(resolve => worker.once('exit', resolve));
    cleanup.push(async () => { await worker.terminate(); await exit; }); worker.postMessage(JSON.stringify(raw) + '\n');
    expect(await bounded(exit)).toBe(0); expect(messages).toHaveLength(1);
    const context = legacy.actual.buildCompletionEvidenceContext(original.taskId, original);
    const expected = { kind: 'facts', planComplete: await runDeliverableGate(original, undefined, new AbortController().signal),
      emptyDelivery: (f.host as unknown as { isEmptyDelivery(snapshot: TaskSnapshot): boolean }).isEmptyDelivery(original),
      guard: context.expectation ? { kind: 'evaluate', expectation: context.expectation,
        evidence: legacy.actual.evidenceForExpectation(context.expectation, context.evidence) } : { kind: 'skip' } };
    expect(JSON.parse(String(messages[0]))).toEqual({ version: 1, requestId, result: expected });
  });

  it.each(['events', 'artifacts'] as const)('D13 builder refuses cumulative %s bytes before touching the next source item', async kind => {
    const helper = await loadVerifierContract(); cleanup.push(() => rmSync(helper.root, { recursive: true, force: true, maxRetries: 3 }));
    const snapshot = snapshotFixture(); const touched = { count: 0 };
    if (kind === 'events') {
      snapshot.events = [result('x'.repeat(65536)), result('y'.repeat(65536)), result('never read')];
      Object.defineProperty(snapshot.events, '2', { get: () => { touched.count++; throw new Error('unbounded source read'); } });
    } else {
      const artifact = (title: string) => ({ artifactId: 'a', kind: 'pdf' as const, title, createdAt: '', previewAvailable: false });
      snapshot.result = { summary: '', artifacts: [artifact('x'.repeat(65536)), artifact('y'.repeat(65536)), artifact('never read')] };
      Object.defineProperty(snapshot.result.artifacts, '2', { get: () => { touched.count++; throw new Error('unbounded source read'); } });
    }
    expect(() => helper.api.buildDeliveryFactsV1(snapshot, randomUUID())).toThrowError(expect.objectContaining({ code: 'validation_limit' }));
    expect(touched.count).toBe(0);
  });

  const retainedTail = (kind: string): { event: DesktopTaskEvent; payload: object; key: string } => {
    let event: DesktopTaskEvent;
    if (kind === 'result') { const entry = result('never read'); return { event: entry, payload: (entry as Extract<DesktopTaskEvent, { type: 'result' }>).result, key: 'summary' }; }
    if (kind === 'progress_plan_reported') event = { type: kind, steps: [] };
    else if (kind === 'artifact_recorded') event = { type: kind, artifactId: 'tail', kind: 'file', label: '', filePath: '', previewAvailable: false, turnId: 'turn' };
    else if (kind === 'canvas_file_changed') event = { type: kind, filePath: '', change: 'add', eventId: 'tail' };
    else if (kind === 'goal_tool_fact') event = { type: kind, factKind: 'file_mutation', invocationId: 'tail', toolName: 'write', normalizedFilePaths: [] };
    else if (kind === 'goal_tool_finished') event = { type: kind, invocationId: 'tail', toolName: 'write', ok: true };
    else if (kind === 'canvas_tool_result') event = { type: kind, toolName: 'create_project', toolUseId: 'tail', eventId: 'tail', ok: true, response: '{}' };
    else if (kind === 'canvas_tool_call') event = { type: kind, toolName: 'create_project', toolUseId: 'tail', eventId: 'tail', input: {} };
    else event = { type: 'assistant_delta', eventId: 'tail', delta: '' };
    const key = ({ progress_plan_reported: 'steps', artifact_recorded: 'artifactId', canvas_file_changed: 'filePath',
      goal_tool_fact: 'normalizedFilePaths', goal_tool_finished: 'ok', canvas_tool_result: 'response', canvas_tool_call: 'input', assistant_delta: 'delta' } as Record<string, string>)[kind]!;
    return { event, payload: event, key };
  };

  it.each(['result', 'progress_plan_reported', 'artifact_recorded', 'canvas_file_changed', 'goal_tool_fact', 'goal_tool_finished', 'canvas_tool_result', 'canvas_tool_call', 'assistant_delta'])('D13 retained fact 257 (%s) refuses before reading its payload', async kind => {
    const helper = await loadVerifierContract(); cleanup.push(() => rmSync(helper.root, { recursive: true, force: true, maxRetries: 3 }));
    const tail = retainedTail(kind); let touched = 0;
    Object.defineProperty(tail.payload, tail.key, { get: () => { touched++; throw new Error('257th payload must not be read'); } });
    const snapshot = snapshotFixture({ events: [...Array.from({ length: 256 }, () => result('bounded')), tail.event] });
    expect.soft(() => helper.api.buildDeliveryFactsV1(snapshot, randomUUID())).toThrowError(expect.objectContaining({ code: 'validation_limit' }));
    expect(touched).toBe(0);
  });

  it.each(['goal_tool_fact', 'canvas_tool_call', 'canvas_tool_result', 'assistant_delta'])('D13 conditional retained %s exactly fills slot 256 without an off-by-one refusal', async kind => {
    const helper = await loadVerifierContract(); cleanup.push(() => rmSync(helper.root, { recursive: true, force: true, maxRetries: 3 }));
    const tail = retainedTail(kind).event;
    const snapshot = snapshotFixture({ events: [...Array.from({ length: 255 }, () => result('bounded')), tail] });
    const facts = helper.api.buildDeliveryFactsV1(snapshot, randomUUID());
    expect(facts.eventFacts).toHaveLength(256); expect(facts.eventFacts.at(-1)).toMatchObject({ index: 255, event: { type: kind } });
  });

  it.each(['goal_tool_fact', 'canvas_tool_call', 'canvas_tool_result', 'assistant_delta', 'progress'])('D13 non-retained %s after slot 256 is ignored without payload access or a false limit failure', async kind => {
    const helper = await loadVerifierContract(); cleanup.push(() => rmSync(helper.root, { recursive: true, force: true, maxRetries: 3 }));
    const head = Array.from({ length: 256 }, () => result('bounded'));
    let event: DesktopTaskEvent; let key: string;
    if (kind === 'goal_tool_fact') { event = { type: kind, factKind: 'command_result', invocationId: 'tail', toolName: 'bash' }; key = 'normalizedFilePaths'; }
    else if (kind === 'canvas_tool_call') { event = { type: kind, toolName: 'other', toolUseId: 'tail', eventId: 'tail', input: {} }; key = 'input'; }
    else if (kind === 'canvas_tool_result') { event = { type: kind, toolName: 'other', toolUseId: 'tail', eventId: 'tail', ok: true, response: '{}' }; key = 'response'; }
    else if (kind === 'assistant_delta') { head[0] = { type: kind, eventId: 'first', delta: '' }; event = { type: kind, eventId: 'tail', delta: '' }; key = 'delta'; }
    else { event = { type: 'progress', eventId: 'tail', stage: 'tool', message: '' }; key = 'message'; }
    let touched = 0;
    Object.defineProperty(event, key, { get: () => { touched++; throw new Error('ignored payload must not be read'); } });
    const facts = helper.api.buildDeliveryFactsV1(snapshotFixture({ events: [...head, event] }), randomUUID());
    expect(facts.eventCount).toBe(257); expect(facts.eventFacts).toHaveLength(256); expect(facts.eventFacts.at(-1)?.index).toBe(255);
    expect(touched).toBe(0);
  });

  it.each(['artifact-id', 'artifact-label', 'goal-invocation', 'plan-step', 'file-path', 'result-summary', 'result-artifact-id'] as const)('D13 exact structural budget stops at %s before reading the next field/item', async stage => {
    const helper = await loadVerifierContract(); cleanup.push(() => rmSync(helper.root, { recursive: true, force: true, maxRetries: 3 }));
    const events = Array.from({ length: 255 }, () => result(''));
    const snapshot = snapshotFixture({ events });
    let payload: object; let key: string; let next: object; let nextKey: string;
    if (stage === 'artifact-id' || stage === 'artifact-label') {
      const tail = { type: 'artifact_recorded' as const, artifactId: '', kind: 'file', label: '', filePath: '', previewAvailable: false, turnId: 'turn' };
      events.push(tail); payload = tail; key = stage === 'artifact-id' ? 'artifactId' : 'label'; next = tail; nextKey = stage === 'artifact-id' ? 'kind' : 'filePath';
    } else if (stage === 'goal-invocation' || stage === 'file-path') {
      const tail = { type: 'goal_tool_fact' as const, factKind: 'file_mutation' as const, invocationId: '', toolName: 'write', normalizedFilePaths: ['', ''] };
      events.push(tail);
      payload = stage === 'goal-invocation' ? tail : tail.normalizedFilePaths; key = stage === 'goal-invocation' ? 'invocationId' : '0';
      next = stage === 'goal-invocation' ? tail : tail.normalizedFilePaths; nextKey = stage === 'goal-invocation' ? 'normalizedFilePaths' : '1';
    } else if (stage === 'plan-step') {
      const tail = { type: 'progress_plan_reported' as const, steps: [{ id: 'a', label: '', status: 'completed' as const }, { id: 'b', label: '', status: 'completed' as const }] };
      events.push(tail); payload = tail.steps[0]!; key = 'status'; next = tail.steps; nextKey = '1';
    } else {
      const artifact = { artifactId: '', kind: 'text' as const, title: '', createdAt: '', previewAvailable: false };
      const finalResult = { summary: '', artifacts: [artifact] }; snapshot.result = finalResult;
      payload = stage === 'result-summary' ? finalResult : artifact; key = stage === 'result-summary' ? 'summary' : 'artifactId';
      next = stage === 'result-summary' ? finalResult : artifact; nextKey = stage === 'result-summary' ? 'artifacts' : 'kind';
    }
    const requestId = randomUUID();
    // Native JSON encoding of an actual production DTO is the size oracle; the
    // test does not reproduce the incremental counter or its field traversal.
    const raw = helper.api.buildDeliveryFactsV1(snapshot, requestId);
    let padding = 131072 - 4 - Buffer.byteLength(JSON.stringify(raw) + '\n');
    for (const entry of events) {
      if (entry.type !== 'result' || !padding) continue;
      const amount = Math.min(65536, padding); entry.result.summary = 'x'.repeat(amount); padding -= amount;
    }
    expect(padding).toBe(0);
    expect(Buffer.byteLength(JSON.stringify(helper.api.buildDeliveryFactsV1(snapshot, requestId)) + '\n')).toBe(131068);
    // Reserve enough excess to cross the boundary using only the current
    // field plus already-known structure, even if later arrays are still empty.
    let currentReads = 0, nextReads = 0;
    const previous = (payload as Record<string, unknown>)[key] as string;
    Object.defineProperty(payload, key, { get: () => { currentReads++; return previous + 'y'.repeat(100); } });
    Object.defineProperty(next, nextKey, { get: () => { nextReads++; throw new Error('next source read after exact limit'); } });
    expect.soft(() => helper.api.buildDeliveryFactsV1(snapshot, requestId)).toThrowError(expect.objectContaining({ code: 'validation_limit' }));
    expect(currentReads).toBe(1); expect(nextReads).toBe(0);
  });

  it.each([-1, 0, 1])('D13 mixed fixed-schema JSON accepts exactly the wire limit plus %i bytes, without omitting fields', async delta => {
    const helper = await loadVerifierContract(); cleanup.push(() => rmSync(helper.root, { recursive: true, force: true, maxRetries: 3 }));
    const escaped = '丙😀\u0000\n"\\';
    const first = { type: 'result' as const, result: { summary: '', artifacts: [] } };
    const second = { type: 'result' as const, result: { summary: '', artifacts: [] } };
    const snapshot = snapshotFixture({ prompt: escaped, events: [
      first, second,
      { type: 'progress_plan_reported', steps: [{ id: 'a', label: '', status: 'planned' }, { id: 'b', label: '', status: 'completed' }] },
      { type: 'artifact_recorded', artifactId: escaped, kind: 'text', label: escaped, filePath: escaped, previewAvailable: false, turnId: 'turn' },
      { type: 'canvas_file_changed', filePath: escaped, change: 'add', eventId: 'changed' },
      { type: 'goal_tool_fact', invocationId: escaped, toolName: 'write', factKind: 'file_mutation', normalizedFilePaths: [escaped, ''] },
      { type: 'goal_tool_fact', invocationId: 'no-paths', toolName: 'write', factKind: 'file_mutation' },
      { type: 'goal_tool_finished', invocationId: escaped, toolName: 'write', ok: false },
      { type: 'goal_tool_finished', invocationId: 'no-paths', toolName: 'write', ok: true },
      { type: 'canvas_tool_call', toolName: 'create_project', input: {}, toolUseId: 'p', eventId: 'call' },
      { type: 'canvas_tool_result', toolName: 'create_project', response: escaped, ok: false, toolUseId: 'p', eventId: 'reply' },
      { type: 'assistant_delta', eventId: 'first', delta: 'not copied' },
    ], result: { summary: escaped, artifacts: [
      { artifactId: escaped, kind: 'text', title: escaped, filePath: escaped, createdAt: '', previewAvailable: false },
      { artifactId: 'without-path', kind: 'text', title: '', createdAt: '', previewAvailable: false },
    ] } });
    const requestId = randomUUID(), base = helper.api.buildDeliveryFactsV1(snapshot, requestId);
    const padding = 131072 + delta - Buffer.byteLength(JSON.stringify(base) + '\n');
    first.result.summary = 'x'.repeat(65536); second.result.summary = 'y'.repeat(padding - 65536);
    const expected = structuredClone(base);
    (expected.eventFacts[0]!.event as typeof first).result.summary = first.result.summary;
    (expected.eventFacts[1]!.event as typeof second).result.summary = second.result.summary;
    expect(Buffer.byteLength(JSON.stringify(expected) + '\n')).toBe(131072 + delta);
    if (delta > 0) expect(() => helper.api.buildDeliveryFactsV1(snapshot, requestId)).toThrowError(expect.objectContaining({ code: 'validation_limit' }));
    else expect(helper.api.buildDeliveryFactsV1(snapshot, requestId)).toEqual(expected);
  });
});

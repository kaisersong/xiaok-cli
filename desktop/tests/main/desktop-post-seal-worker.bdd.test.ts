// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { compileVerifierEntry, type DeliveryFactsFixture } from '../fixtures/desktop-post-seal-verifier-contract.js';
import { bounded } from '../fixtures/desktop-post-seal-harness.js';

describe('R4 fixed compiled CPU-only Worker, actual native thread contract', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
  const facts = (): DeliveryFactsFixture => ({ version: 1, requestId: randomUUID(), taskId: 'task-fixture', prompt: 'Hello', eventCount: 0, eventFacts: [] });
  async function start(frame: string) {
    const compiled = await compileVerifierEntry('delivery-verifier-worker.ts');
    cleanup.push(() => rmSync(compiled.root, { recursive: true, force: true, maxRetries: 3 }));
    const worker = new Worker(compiled.output, { stdout: true, stderr: true });
    const messages: unknown[] = []; const errors: Error[] = []; let stdout = 0; let stderr = 0; let exited = false;
    worker.on('message', value => messages.push(value)); worker.on('error', error => errors.push(error));
    worker.stdout!.on('data', value => { stdout += value.length; }); worker.stderr!.on('data', value => { stderr += value.length; });
    const exit = new Promise<number>(resolve => worker.once('exit', code => { exited = true; resolve(code); }));
    cleanup.push(async () => { if (!exited) await worker.terminate(); await exit; });
    await bounded(new Promise<void>((resolve, reject) => { worker.once('online', resolve); worker.once('error', reject); }));
    worker.postMessage(frame);
    return { worker, messages, errors, exit, compiled, get stdout() { return stdout; }, get stderr() { return stderr; } };
  }

  it('D7 fixed entry emits exactly one JSON facts frame, no stdio, then physically exits', async () => {
    const input = facts(); const f = await start(JSON.stringify(input) + '\n');
    expect(await bounded(f.exit)).toBe(0); expect(f.errors).toEqual([]); expect(f.messages).toHaveLength(1);
    expect(f.stdout).toBe(0); expect(f.stderr).toBe(0);
    expect(JSON.parse(String(f.messages[0]))).toMatchObject({ version: 1, requestId: input.requestId, result: { kind: 'facts' } });
    expect(Buffer.byteLength(String(f.messages[0]))).toBeLessThanOrEqual(65536);
  });

  it('D7 native pathological production regex terminates at 100ms with actual exit, never a busy-loop substitute', async () => {
    const input = facts(); input.prompt = 'create' + ' '.repeat(65529) + 'x';
    const f = await start(JSON.stringify(input) + '\n');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(f.messages).toEqual([]);
    const started = performance.now(); const terminated = f.worker.terminate();
    const [code, exitCode] = await bounded(Promise.all([terminated, f.exit]));
    expect(code).toBe(exitCode); expect(exitCode).not.toBe(0); expect(performance.now() - started).toBeLessThan(500);
    expect(f.messages).toEqual([]);
  });

  it('D7 compilation dependency closure excludes IO/network/process/provider/model execution', async () => {
    const compiled = await compileVerifierEntry('delivery-verifier-worker.ts'); cleanup.push(() => rmSync(compiled.root, { recursive: true, force: true, maxRetries: 3 }));
    const imports = Object.values(compiled.metafile.inputs).flatMap(input => input.imports.map(value => value.path));
    expect(imports.filter(path => /(?:^|node:)(?:fs(?:\/promises)?|net|http|https|tls|child_process|process)$/.test(path))).toEqual([]);
    expect(Object.keys(compiled.metafile.inputs).filter(path => /(?:provider|registry-factory|agent-runtime|desktop-services)/.test(path))).toEqual([]);
  });

  it.each(['json', 'extra-key', 'unknown-event', 'repeated-index', 'out-of-range-index', 'wrong-request', 'wrong-task', 'extra-metadata', 'non-object'] as const)('D7/D14 input %s is rejected by actual Worker with no file effects', async attack => {
    const input = facts(); let frame: string;
    if (attack === 'extra-key') Object.assign(input, { module: 'node:fs' });
    if (attack === 'unknown-event') { input.eventCount = 1; input.eventFacts = [{ index: 0, event: { type: 'tool_call', name: 'write' } }]; }
    if (attack === 'repeated-index') { input.eventCount = 2; input.eventFacts = [{ index: 0, event: { type: 'assistant_delta' } }, { index: 0, event: { type: 'assistant_delta' } }]; }
    if (attack === 'out-of-range-index') input.eventFacts = [{ index: 0, event: { type: 'assistant_delta' } }];
    if (attack === 'wrong-request') input.requestId = 'not-a-uuid';
    if (attack === 'wrong-task') input.taskId = '';
    if (attack === 'extra-metadata') { input.eventCount = 1; input.eventFacts = [{ index: 0, event: { type: 'assistant_delta', delta: 'not permitted' } }]; }
    frame = attack === 'json' ? '{invalid\n' : attack === 'non-object' ? '[]\n' : JSON.stringify(input) + '\n';
    const f = await start(frame); await bounded(f.exit);
    expect(f.stdout).toBe(0); expect(f.stderr).toBe(0); expect(f.messages).toHaveLength(1);
    expect(JSON.parse(String(f.messages[0])).result).toMatchObject({ kind: 'error', code: 'verifier_input_invalid' });
  });

  it.each([65535, 65536, 65537])('D13 Worker single UTF-8 string %i bytes uses exact bounds, not UTF-16 length', async size => {
    const input = facts(); input.prompt = '中'.repeat(Math.floor(size / 3)) + 'x'.repeat(size % 3);
    expect(Buffer.byteLength(input.prompt)).toBe(size);
    const f = await start(JSON.stringify(input) + '\n'); await bounded(f.exit);
    expect(JSON.parse(String(f.messages[0])).result).toMatchObject(size > 65536 ? { kind: 'error', code: 'validation_limit' } : { kind: 'facts' });
  });

  it.each([255, 256, 257])('D13 retained facts count %i is enforced without dropping valid repeated history', async size => {
    const input = facts(); input.eventCount = size;
    input.eventFacts = Array.from({ length: size }, (_, index) => ({ index, event: { type: 'result', result: { summary: 'answer' } } }));
    const f = await start(JSON.stringify(input) + '\n'); await bounded(f.exit);
    expect(JSON.parse(String(f.messages[0])).result).toMatchObject(size > 256 ? { kind: 'error', code: 'validation_limit' } : { kind: 'facts' });
  });

  it.each([16383, 16384, 16385])('D13 sentinel eventCount %i never allocates an unbounded source history', async eventCount => {
    const input = facts(); input.eventCount = eventCount;
    const f = await start(JSON.stringify(input) + '\n'); await bounded(f.exit);
    expect(JSON.parse(String(f.messages[0])).result).toMatchObject(eventCount > 16384 ? { kind: 'error', code: 'validation_limit' } : { kind: 'facts' });
  });

  it.each([131071, 131072, 131073])('D13 full request frame %i bytes includes newline and JSON escaping', async size => {
    const input = facts(); input.prompt = '\0'.repeat(10000); input.eventCount = 2;
    input.eventFacts = [{ index: 0, event: { type: 'result', result: { summary: '\0'.repeat(10000) } } },
      { index: 1, event: { type: 'result', result: { summary: '' } } }];
    const base = Buffer.byteLength(JSON.stringify(input) + '\n');
    (input.eventFacts[1].event as { result: { summary: string } }).result.summary = 'x'.repeat(size - base);
    const frame = JSON.stringify(input) + '\n'; expect(Buffer.byteLength(frame)).toBe(size);
    const f = await start(frame); await bounded(f.exit);
    expect(JSON.parse(String(f.messages[0])).result).toMatchObject(size > 131072 ? { kind: 'error', code: 'validation_limit' } : { kind: 'facts' });
  });

  it.each(['artifacts', 'steps', 'paths'].flatMap(kind => [255, 256, 257].map(size => ({ kind, size }))))('D13 $kind array count $size and Windows/UNC/Unicode paths retain exact CPU facts', async ({ kind, size }) => {
    const input = facts();
    if (kind === 'artifacts') input.result = { summary: '', artifacts: Array.from({ length: size }, (_, index) => ({ artifactId: `artifact-${index}`,
      kind: 'pdf', title: '文件', filePath: index % 2 ? 'C:\\工作区\\报告.pdf' : '\\\\server\\share\\报告.pdf' })) };
    if (kind === 'steps') { input.prompt = '生成一份报告和一份演示文稿'; input.eventCount = 1;
      input.eventFacts = [{ index: 0, event: { type: 'progress_plan_reported', steps: Array.from({ length: size }, () => ({ status: 'completed' })) } }]; }
    if (kind === 'paths') { input.prompt = '生成文件'; input.eventCount = 2;
      input.eventFacts = [{ index: 0, event: { type: 'goal_tool_fact', factKind: 'file_mutation', invocationId: 'inv',
        normalizedFilePaths: Array.from({ length: size }, (_, index) => `C:\\工作区\\报告${index}.pdf`) } },
      { index: 1, event: { type: 'goal_tool_finished', invocationId: 'inv', ok: true } }]; }
    const f = await start(JSON.stringify(input) + '\n'); await bounded(f.exit);
    const result = JSON.parse(String(f.messages[0])).result;
    expect(result).toMatchObject(size > 256 ? { kind: 'error', code: 'validation_limit' } : { kind: 'facts' });
    if (kind === 'paths' && size <= 256) expect(result.guard.evidence[0].metadata.paths).toEqual(
      (input.eventFacts[0].event as { normalizedFilePaths: string[] }).normalizedFilePaths);
  });
});
